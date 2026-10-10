'use strict';
/** Fake Discord objects + a test environment that runs real actions through the real executor. */
const { Collection, PermissionsBitField } = require('discord.js');
const database = require('../../src/database');
const { buildRegistry } = require('../../src/commands');
const { createServices } = require('../../src/services');
const { createExecutor } = require('../../src/core/executor');
const { parseConfig } = require('../../src/config');
const { IDENTITY } = require('../../src/constants');
const { Music } = require('../../src/services/music');
const { RateLimiter } = require('../../src/security/ratelimit');
const { Lookup } = require('../../src/services/lookup');

let idSeq = 100000000000000000n;
const nextId = () => String((idSeq += 1n));

/** Any unknown method records the call and resolves to a generic fake object. */
function loose(base = {}, calls = [], label = '') {
  return new Proxy(base, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON') return undefined;
      return (...args) => { calls.push({ label, method: p, args }); return Promise.resolve({ id: nextId(), name: 'fake', url: 'https://discord.test/fake', ...(typeof args[0] === 'object' && args[0] ? args[0] : {}) }); };
    },
  });
}

function fakeUser(name = 'tester', id = nextId(), extra = {}) {
  const u = { id, username: name, bot: false, discriminator: '0', displayAvatarURL: () => `https://cdn.test/${id}.png`, bannerURL: () => null, send: async () => ({}), ...extra };
  u.fetch = async () => u; u.fetchFlags = async () => ({ toArray: () => ['Staff'] });
  return u;
}

function fakeMember(user, { perms = [], position = 1, guild = null, calls = [] } = {}) {
  const permissions = new PermissionsBitField(perms);
  const roles = new Collection();
  const m = {
    id: user.id, user, displayName: user.username, joinedTimestamp: 1_700_000_000_000, permissions,
    roles: { cache: roles, highest: { position, id: 'role-high' }, add: async (r) => { calls.push({ method: 'roles.add', args: [r] }); roles.set(r.id || r, r); }, remove: async (r) => { calls.push({ method: 'roles.remove', args: [r] }); roles.delete(r.id || r); } },
    voice: { channel: null, disconnect: async () => calls.push({ method: 'voice.disconnect' }), setMute: async (v) => calls.push({ method: 'voice.setMute', args: [v] }), setDeaf: async (v) => calls.push({ method: 'voice.setDeaf', args: [v] }), setChannel: async (c) => calls.push({ method: 'voice.setChannel', args: [c] }) },
    kick: async (r) => calls.push({ method: 'kick', args: [r] }), ban: async (o) => calls.push({ method: 'ban', args: [o] }),
    timeout: async (ms, r) => calls.push({ method: 'timeout', args: [ms, r] }), setNickname: async (n) => calls.push({ method: 'setNickname', args: [n] }),
    send: async () => ({}), guild,
  };
  return m;
}

function fakeChannel(name, type = 0, calls = [], extra = {}) {
  const id = nextId();
  const sent = [];
  const messages = new Collection();
  const ch = {
    id, name, type, topic: null, nsfw: false, rawPosition: 0, sent, isTextBased: () => type === 0, messages: {
      fetch: async (arg) => (typeof arg === 'string' ? messages.get(arg) : messages), cache: messages,
    },
    send: async (p) => { const m = { id: nextId(), channelId: id, ...p, edit: async () => {}, react: async () => {}, delete: async () => {}, pin: async () => {} }; sent.push(p); return m; },
    bulkDelete: async (list) => ({ size: Array.isArray(list) ? list.length : list }),
    permissionOverwrites: loose({}, calls, 'overwrites'), setName: async (n) => calls.push({ method: 'setName', args: [n] }),
    setTopic: async (t) => calls.push({ method: 'setTopic', args: [t] }), setNSFW: async (v) => calls.push({ method: 'setNSFW', args: [v] }),
    setRateLimitPerUser: async (v) => calls.push({ method: 'setRateLimitPerUser', args: [v] }), setPosition: async (v) => calls.push({ method: 'setPosition', args: [v] }),
    setParent: async (p) => calls.push({ method: 'setParent', args: [p] }), delete: async () => calls.push({ method: 'delete' }), clone: async () => fakeChannel(`${name}-clone`, type, calls),
    createWebhook: async (o) => ({ id: nextId(), name: o.name, url: 'https://discord.com/api/webhooks/1/secret', send: async () => ({}) }),
    fetchWebhooks: async () => new Collection(), createInvite: async () => ({ url: 'https://discord.gg/test', code: 'test' }), threads: loose({}, calls, 'threads'),
    guild: null, ...extra,
  };
  return ch;
}

function makeEnv({ configEnv = {}, fetchImpl = null } = {}) {
  const calls = [];
  const db = database.open(':memory:');
  database.migrate(db);
  const registry = buildRegistry();
  const { config } = parseConfig({ DISCORD_CLIENT_ID: '123456789012345678', ...configEnv }, { requireToken: false });
  const state = { now: 1_800_000_000, rnd: 0.5 };
  const clock = { now: () => state.now, random: () => state.rnd };
  const music = new Music({ config, settings: null });
  const lookupSvc = new Lookup({ fetchImpl: fetchImpl || (async () => { throw new Error('network disabled in tests'); }) });
  const svc = createServices({ db, config, registry, music, lookup: lookupSvc, clock });
  music.settings = svc.settings;
  svc.rateLimiter = new RateLimiter({ max: 1_000_000 });
  const exec = createExecutor({ services: svc, rateLimiter: svc.rateLimiter });
  registry.bindExecutor(exec);

  const guild = { id: nextId(), name: 'Test Guild', ownerId: nextId(), memberCount: 42, premiumTier: 1, premiumSubscriptionCount: 3, shardId: 0, features: ['COMMUNITY'], iconURL: () => 'https://cdn.test/icon.png', bannerURL: () => null, large: false };
  const members = new Collection();
  guild.members = loose({ cache: members, fetch: async (id) => { if (id === undefined || (id && typeof id === 'object' && !id.user)) return members; const m = members.get(typeof id === 'string' ? id : id && id.user); if (!m) throw new Error('Unknown Member'); return m; }, search: async () => new Collection(),
    ban: async (id, o) => { calls.push({ method: 'ban', args: [id, o] }); return {}; }, unban: async (id) => { calls.push({ method: 'unban', args: [id] }); return {}; }, kick: async (id) => calls.push({ method: 'kick', args: [id] }), prune: async () => 3 }, calls, 'members');
  guild.bans = { fetch: async (id) => { if (id) { throw new Error('Unknown Ban'); } return new Collection(); } };
  const everyone = { id: guild.id, name: '@everyone', position: 0, managed: false, members: new Collection(), hexColor: '#000000', hoist: false, mentionable: false, permissions: new PermissionsBitField(['ViewChannel']) };
  const roles = new Collection([[everyone.id, everyone]]);
  const mkRole = (name, position) => { const r = { id: nextId(), name, position, managed: false, members: new Collection(), hexColor: '#112233', hoist: false, mentionable: false, permissions: new PermissionsBitField(['SendMessages']), setName: async (n) => calls.push({ method: 'role.setName', args: [n] }), setColor: async (c) => calls.push({ method: 'role.setColor', args: [c] }), setHoist: async (v) => calls.push({ method: 'role.setHoist', args: [v] }), setMentionable: async (v) => calls.push({ method: 'role.setMentionable', args: [v] }), setPosition: async (v) => calls.push({ method: 'role.setPosition', args: [v] }), setPermissions: async (v) => calls.push({ method: 'role.setPermissions', args: [v] }), delete: async () => calls.push({ method: 'role.delete' }) }; roles.set(r.id, r); return r; };
  guild.roles = loose({ cache: roles, everyone, create: async (o) => { const r = mkRole(o.name, 1); calls.push({ method: 'roles.create', args: [o] }); return r; }, fetch: async (id) => (id ? roles.get(id) : roles) }, calls, 'roles');
  const channels = new Collection();
  guild.channels = loose({ cache: channels, create: async (o) => { const c = fakeChannel(o.name, o.type ?? 0, calls); c.guild = guild; channels.set(c.id, c); calls.push({ method: 'channels.create', args: [o] }); return c; }, fetch: async (id) => (id ? channels.get(id) : channels) }, calls, 'channels');
  guild.emojis = loose({ cache: new Collection(), create: async (o) => { calls.push({ method: 'emojis.create', args: [o] }); return { id: nextId(), name: o.name, toString: () => `:${o.name}:`, delete: async () => {} }; } }, calls, 'emojis');
  guild.stickers = { cache: new Collection() };
  guild.invites = { fetch: async () => new Collection() };
  guild.fetchWebhooks = async () => new Collection();
  guild.fetchAuditLogs = async () => ({ entries: new Collection() });
  guild.setName = async (n) => calls.push({ method: 'guild.setName', args: [n] });
  guild.setSystemChannel = async (c) => calls.push({ method: 'guild.setSystemChannel', args: [c] });
  guild.setAFKChannel = async (c) => calls.push({ method: 'guild.setAFKChannel', args: [c] });
  guild.setAFKTimeout = async (c) => calls.push({ method: 'guild.setAFKTimeout', args: [c] });
  guild.setVerificationLevel = async (c) => calls.push({ method: 'guild.setVerificationLevel', args: [c] });
  guild.setDefaultMessageNotifications = async (c) => calls.push({ method: 'guild.setDefaultMessageNotifications', args: [c] });
  guild.setExplicitContentFilter = async (c) => calls.push({ method: 'guild.setExplicitContentFilter', args: [c] });
  guild.setRulesChannel = async (c) => calls.push({ method: 'guild.setRulesChannel', args: [c] });
  guild.setPublicUpdatesChannel = async (c) => calls.push({ method: 'guild.setPublicUpdatesChannel', args: [c] });
  guild.setIcon = async (c) => calls.push({ method: 'guild.setIcon', args: [c] });
  guild.setPreferredLocale = async (c) => calls.push({ method: 'guild.setPreferredLocale', args: [c] });
  guild.setDescription = async (c) => calls.push({ method: 'guild.setDescription', args: [c] });
  guild.leave = async () => calls.push({ method: 'guild.leave' });

  const botUser = fakeUser('TanveerPrime', '999999999999999001', { bot: true });
  const bot = fakeMember(botUser, { perms: ['Administrator'], position: 50, guild, calls });
  guild.members.me = bot; members.set(bot.id, bot);
  const botHigh = mkRole('bot-role', 50); void botHigh;

  const textChannel = fakeChannel('general', 0, calls); textChannel.guild = guild; channels.set(textChannel.id, textChannel);
  const voiceChannel = fakeChannel('Voice', 2, calls); voiceChannel.guild = guild; channels.set(voiceChannel.id, voiceChannel);

  const people = new Map();
  function person(name, { perms = [], position = 1, id } = {}) {
    if (people.has(name)) return people.get(name);
    const user = fakeUser(name, id);
    const member = fakeMember(user, { perms, position, guild, calls });
    members.set(member.id, member);
    const p = { user, member }; people.set(name, p); return p;
  }
  const admin = person('admin', { perms: ['Administrator'], position: 40 });
  const regular = person('regular', { perms: ['ViewChannel', 'SendMessages'], position: 5 });
  const victim = person('victim', { perms: [], position: 2 });
  const owner = person('globalowner', { perms: ['ViewChannel', 'SendMessages'], position: 5, id: IDENTITY.GLOBAL_OWNER_ID });
  guild.ownerId = person('guildowner', { perms: ['Administrator'], position: 45 }).user.id;

  function lookup() {
    return {
      user: async (s) => { const id = (/^<@!?(\d+)>$/.exec(s) || [])[1] || s; const m = members.get(id) || [...members.values()].find((x) => x.user.username === s); return m ? m.user : /^\d{15,25}$/.test(id) ? fakeUser(`user-${id}`, id) : null; },
      channel: async (s) => { const id = (/^<#(\d+)>$/.exec(s) || [])[1] || s; return channels.get(id) || [...channels.values()].find((c) => c.name === s) || null; },
      role: async (s) => { const id = (/^<@&(\d+)>$/.exec(s) || [])[1] || s; return roles.get(id) || [...roles.values()].find((r) => r.name === s) || null; },
    };
  }

  function makeCtx({ as = 'admin', values = {}, tokens = null, raw = '', inGuild = true, voice = false, channel = textChannel, source } = {}) {
    const who = typeof as === 'string' ? people.get(as) || person(as) : as;
    if (voice) who.member.voice.channel = voiceChannel; else who.member.voice.channel = null;
    return {
      source: source || (tokens ? 'prefix' : 'test'), client: { ws: { ping: 42 }, guilds: { cache: new Collection([[guild.id, guild]]) }, users: { cache: new Collection() } },
      guild: inGuild ? guild : null, guildId: inGuild ? guild.id : null, channel, member: inGuild ? who.member : null, user: who.user,
      input: tokens ? { kind: 'prefix', tokens, raw } : { kind: 'values', values }, prefix: '!', lookup: lookup(),
      getMember: async (u) => members.get(u.id) || null, voiceChannelId: voice ? voiceChannel.id : null,
    };
  }

  /** Execute `key` through the real executor. */
  async function run(key, values = {}, opts = {}) {
    const action = registry.get(key);
    if (!action) throw new Error(`unknown action ${key}`);
    if (!opts.keepCooldowns) svc.rateLimiter.cooldowns.clear();
    return action.execute(makeCtx({ values, ...opts }));
  }

  return { db, registry, svc, config, guild, people, person, admin, regular, victim, owner, textChannel, voiceChannel, channels, roles, mkRole, members, calls, state, makeCtx, run, lookup, exec, clock };
}

module.exports = { makeEnv, fakeUser, fakeMember, fakeChannel, loose, nextId };

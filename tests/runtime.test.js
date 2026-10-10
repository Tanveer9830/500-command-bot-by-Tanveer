'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { makeEnv } = require('./helpers/mock');
const { createMessageHandler } = require('../src/handlers/message');
const { createInteractionHandler, actionForSlash, actionForButton } = require('../src/handlers/interaction');
const { createMemberHandlers } = require('../src/events/members');
const { createReactionHandlers } = require('../src/events/reactions');
const { IDENTITY } = require('../src/constants');

function setup() {
  const env = makeEnv(); const dms = [];
  const client = { user: { id: '999999999999999001', tag: 'bot#0' }, ws: { ping: 12 }, guilds: { cache: new Collection([[env.guild.id, env.guild]]) },
    channels: { cache: new Collection([[env.textChannel.id, env.textChannel]]), fetch: async () => null },
    users: { cache: new Collection(), fetch: async (id) => ({ id, username: `u${id}`, send: async (p) => { dms.push({ id, p }); } }) } };
  env.svc.client = client;
  const timers = { setTimeout: (fn) => { env.pendingTimers = (env.pendingTimers || []).concat(fn); return { unref() {} }; } };
  const onMessage = createMessageHandler({ client, svc: env.svc, registry: env.registry, timers });
  const msg = (content, who = 'regular', extra = {}) => {
    const p = env.person(who); const replies = []; const state = { deleted: false };
    const m = { id: `m${Math.random()}`, author: p.user, member: p.member, guild: env.guild, guildId: env.guild.id, channel: env.textChannel, channelId: env.textChannel.id, content,
      mentions: { users: new Collection(), roles: new Collection(), everyone: false }, createdTimestamp: Date.now(), replies, state,
      delete: async () => { state.deleted = true; }, reply: async (b) => { replies.push(b); return { id: 'r1' }; }, react: async () => {}, ...extra };
    return m;
  };
  return { env, client, dms, onMessage, msg };
}
const text = (r) => `${r.content || ''}${JSON.stringify(r.embeds || '')}`;

test('prefix commands run through the shared registry and replies never allow mentions', async () => {
  const { onMessage, msg } = setup();
  const m = msg('!ping'); await onMessage(m);
  assert.equal(m.replies.length, 1);
  assert.deepEqual(m.replies[0].allowedMentions.parse, []);
  const calc = msg('!calc expr 2+2*3'); await onMessage(calc);
  assert.match(text(calc.replies[0]), /8/);
});

test('admin commands are denied to regular users via prefix, with no side effect', async () => {
  const { onMessage, msg, env } = setup();
  const m = msg(`!ban ${env.victim.user.id} spam`); await onMessage(m);
  assert.match(m.replies[0].content, /⛔/);
  assert.ok(!env.calls.some((c) => c.method === 'ban'));
});

test('a group without a subcommand shows its help instead of failing silently', async () => {
  const { onMessage, msg } = setup();
  const m = msg('!gcustom'); await onMessage(m);
  assert.equal(m.replies.length, 1); assert.match(text(m.replies[0]), /gcustom/);
});

test('unknown commands are ignored, custom commands render safely, blacklist silences them', async () => {
  const { onMessage, msg, env } = setup();
  const actor = { userId: env.admin.user.id, member: env.admin.member, guildId: env.guild.id };
  env.svc.customCommands.add(env.guild.id, 'hello', 'Hi {username}, you are #{uses}', actor);
  const none = msg('!nosuchcommand'); await onMessage(none); assert.equal(none.replies.length + env.textChannel.sent.length, 0);
  const m = msg('!hello'); await onMessage(m);
  assert.match(env.textChannel.sent.at(-1).content, /Hi regular, you are #1/);
  assert.deepEqual(env.textChannel.sent.at(-1).allowedMentions.parse, []);
  env.db.prepare("INSERT INTO blacklist (user_id, by) VALUES (?, 'x')").run(env.regular.user.id);
  const before = env.textChannel.sent.length; await onMessage(msg('!hello')); assert.equal(env.textChannel.sent.length, before);
});

test('private results are DMed for prefix commands, never posted in the channel', async () => {
  const { onMessage, msg, dms, env } = setup();
  const m = msg('!random password 16'); await onMessage(m);
  assert.equal(dms.length, 1); assert.match(dms[0].p.content, /`/);
  assert.equal(m.replies.length, 0); assert.equal(env.textChannel.sent.length, 0);
});

test('automod removes violating messages from normal members but never from staff', async () => {
  const { onMessage, msg, env } = setup();
  env.svc.settings.set(env.guild.id, 'automod_enabled', true); env.svc.settings.set(env.guild.id, 'automod_invites', true);
  const bad = msg('join https://discord.gg/abcdef now'); await onMessage(bad);
  assert.equal(bad.state.deleted, true); assert.match(env.textChannel.sent.at(-1).content, /removed \(invite\)/);
  const staff = msg('join https://discord.gg/abcdef now', 'admin'); await onMessage(staff);
  assert.equal(staff.state.deleted, false);
});

test('automod warn action records a case', async () => {
  const { onMessage, msg, env } = setup();
  env.svc.settings.set(env.guild.id, 'automod_enabled', true); env.svc.settings.set(env.guild.id, 'automod_invites', true); env.svc.settings.set(env.guild.id, 'automod_action', 'warn');
  await onMessage(msg('discord.gg/zzzzzz'));
  assert.equal(env.svc.moderation.forTarget(env.guild.id, env.regular.user.id, 'warn').length, 1);
});

test('AFK: mentions get a notice without pinging, and the author is welcomed back', async () => {
  const { onMessage, msg, env } = setup();
  env.db.prepare('INSERT INTO afk (guild_id, user_id, reason) VALUES (?, ?, ?)').run(env.guild.id, env.victim.user.id, 'lunch');
  const m = msg('hey there', 'regular'); m.mentions.users.set(env.victim.user.id, env.victim.user);
  await onMessage(m);
  const note = env.textChannel.sent.at(-1);
  assert.match(note.content, /victim.*AFK: lunch/); assert.ok(!/<@/.test(note.content));
  await onMessage(msg('im back', 'victim'));
  assert.match(env.textChannel.sent.at(-1).content, /Welcome back/);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM afk').get().n, 0);
});

test('XP is granted for normal messages (not commands), autoresponders match whole words', async () => {
  const { onMessage, msg, env } = setup();
  await onMessage(msg('just chatting'));
  assert.equal(env.svc.levels.get(env.guild.id, env.regular.user.id).messages, 1);
  await onMessage(msg('!ping')); await onMessage(msg('!ping'));
  assert.equal(env.svc.levels.get(env.guild.id, env.regular.user.id).messages, 1, 'commands do not count');
  env.db.prepare('INSERT INTO autoresponders (guild_id, trigger, response) VALUES (?, ?, ?)').run(env.guild.id, 'hello', 'Hi {username}!');
  await onMessage(msg('say hello please', 'victim')); assert.match(env.textChannel.sent.at(-1).content, /Hi victim!/);
  const n = env.textChannel.sent.length; await onMessage(msg('othelloing', 'admin')); assert.equal(env.textChannel.sent.length, n);
});

test('sticky messages are re-posted after a quiet moment', async () => {
  const { onMessage, msg, env } = setup();
  env.db.prepare('INSERT INTO sticky (guild_id, channel_id, content) VALUES (?, ?, ?)').run(env.guild.id, env.textChannel.id, 'Read the rules');
  await onMessage(msg('hi')); await onMessage(msg('hi again'));
  assert.equal(env.pendingTimers.length, 1, 'debounced');
  await env.pendingTimers[0]();
  assert.match(env.textChannel.sent.at(-1).content, /📌 Read the rules/);
  assert.ok(env.db.prepare('SELECT last_message_id FROM sticky').get().last_message_id);
});

test('bots and webhooks are ignored entirely', async () => {
  const { onMessage, msg, env } = setup();
  const b = msg('!ping'); b.author = { ...b.author, bot: true }; await onMessage(b); assert.equal(b.replies.length, 0);
  const w = msg('!ping', 'regular', { webhookId: '1' }); await onMessage(w); assert.equal(w.replies.length, 0);
  assert.equal(env.textChannel.sent.length, 0);
});

// ------------------------------------------------------------------ interactions
function slash(env, name, { group = null, sub = null, opts = {}, who = 'regular' } = {}) {
  const p = env.person(who); const out = { replies: [] };
  const options = { getSubcommand: () => sub, getSubcommandGroup: () => group, get: (n) => (n in opts ? opts[n] : null) };
  return { out, i: { isChatInputCommand: () => true, isButton: () => false, commandName: name, options, user: p.user, member: p.member, guild: env.guild, channel: env.textChannel, channelId: env.textChannel.id, inCachedGuild: () => true,
    replied: false, deferred: false, reply: async (b) => { out.replies.push(b); }, deferReply: async () => {}, editReply: async () => {}, followUp: async (b) => out.replies.push(b) } };
}

test('slash interactions map to the same actions as prefix commands', async () => {
  const { env, client } = setup();
  const h = createInteractionHandler({ client, svc: env.svc, registry: env.registry });
  const s = slash(env, 'ping'); await h(s.i);
  assert.equal(s.out.replies.length, 1); assert.deepEqual(s.out.replies[0].allowedMentions.parse, []);
  const g = slash(env, 'calc', { sub: 'expr', opts: { expression: { value: '6*7' } } }); await h(g.i);
  assert.match(JSON.stringify(g.out.replies[0]), /42/);
  assert.equal(actionForSlash(env.registry, g.i).key, 'calc.expr');
});

test('slash: admin actions are denied ephemerally to regular users', async () => {
  const { env, client } = setup();
  const h = createInteractionHandler({ client, svc: env.svc, registry: env.registry });
  const s = slash(env, 'ban', { opts: { user: { user: env.victim.user, value: env.victim.user.id } } }); await h(s.i);
  assert.match(s.out.replies[0].content, /⛔/); assert.equal(s.out.replies[0].flags, 64);
  assert.ok(!env.calls.some((c) => c.method === 'ban'));
});

test('buttons only route to known actions', () => {
  assert.deepEqual(actionForButton('tp:poll:7:2'), { key: 'poll.vote', values: { id: 7, option: 3 } });
  assert.deepEqual(actionForButton('tp:gw:12'), { key: 'giveaway.enter', values: { id: 12 } });
  assert.equal(actionForButton('tp:ticket:open').key, 'ticket.open');
  assert.equal(actionForButton('tp:evil:1'), null);
  assert.equal(actionForButton('other:poll:1:1'), null);
  assert.equal(actionForButton('tp:poll:x:y'), null);
});

test('a poll button casts a vote and answers ephemerally', async () => {
  const { env, client } = setup();
  const poll = env.svc.polls.create({ guildId: env.guild.id, channelId: env.textChannel.id, question: 'Pizza?', options: ['yes', 'no'], authorId: '1' });
  const h = createInteractionHandler({ client, svc: env.svc, registry: env.registry });
  const p = env.person('regular'); const out = [];
  await h({ isChatInputCommand: () => false, isButton: () => true, customId: `tp:poll:${poll.id}:1`, user: p.user, member: p.member, guild: env.guild, channel: env.textChannel, inCachedGuild: () => true, replied: false, deferred: false, reply: async (b) => out.push(b), deferReply: async () => {}, editReply: async () => {}, followUp: async (b) => out.push(b) });
  assert.equal(out[0].flags, 64);
  assert.equal(env.svc.polls.results(env.guild.id, poll.id).counts[1], 1);
});

// --------------------------------------------------------------- members + reactions
test('join: welcome message uses a name (no mention); auto-roles apply; anti-raid kicks young accounts', async () => {
  const { env, client } = setup();
  const h = createMemberHandlers({ client, svc: env.svc }); const g = env.guild.id; const s = env.svc.settings;
  s.set(g, 'welcome_enabled', true); s.set(g, 'welcome_channel', env.textChannel.id);
  const role = env.mkRole('Member', 3); s.set(g, 'autoroles', [role.id]);
  const mk = (name, ageMs) => { const p = env.person(name); p.user.createdTimestamp = Date.now() - ageMs; p.member.kickable = true; p.member.guild = env.guild; return p.member; };
  await h.onAdd(mk('newbie', 30 * 86_400_000));
  assert.match(env.textChannel.sent.at(-1).content, /Welcome to .*, newbie!/); assert.ok(!/<@/.test(env.textChannel.sent.at(-1).content));
  assert.ok(env.calls.some((c) => c.method === 'roles.add'));
  s.set(g, 'raid_enabled', true); s.set(g, 'raid_min_age_days', 7); s.set(g, 'raid_action', 'kick');
  await h.onAdd(mk('fresh', 3600_000));
  assert.ok(env.calls.some((c) => c.method === 'kick'));
  assert.equal(env.svc.moderation.forTarget(g, env.person('fresh').user.id, 'kick').length, 1);
});

test('reaction roles grant and revoke; the starboard needs the threshold and ignores self-stars', async () => {
  const { env, client } = setup(); const g = env.guild.id;
  const r = createReactionHandlers({ client, svc: env.svc });
  const role = env.mkRole('Gamer', 3);
  env.db.prepare('INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)').run(g, 'msg1', '🎮', role.id);
  env.guild.members.fetch = async (id) => env.person('regular').user.id === id ? env.regular.member : null;
  const reaction = (emoji, users, author) => ({ partial: false, emoji: { id: null, name: emoji }, message: { partial: false, id: 'msg1', guildId: g, guild: env.guild, channelId: env.textChannel.id, author, content: 'great post', createdTimestamp: Date.now(), url: 'https://discord.com/x', attachments: new Collection(), member: null }, users: { fetch: async () => new Collection(users.map((u) => [u.id, u])) } });
  await r.onAdd(reaction('🎮', [env.regular.user], env.victim.user), env.regular.user);
  assert.ok(env.regular.member.roles.cache.has(role.id));
  await r.onRemove(reaction('🎮', [], env.victim.user), env.regular.user);
  assert.ok(!env.regular.member.roles.cache.has(role.id));
  const starCh = env.channels.get(env.voiceChannel.id); void starCh;
  env.svc.settings.set(g, 'star_channel', '555000000000000001'); env.svc.settings.set(g, 'star_threshold', 2);
  const sent = []; env.svc.sendToChannel = async (c, p) => { sent.push(p); return { id: 'star1' }; };
  const author = env.victim.user; const a = env.regular.user; const b = env.admin.user;
  await r.onAdd(reaction('⭐', [author, a], author), a); assert.equal(sent.length, 0, 'self-star ignored → only 1 star');
  await r.onAdd(reaction('⭐', [author, a, b], author), b); assert.equal(sent.length, 1);
  assert.equal(env.db.prepare('SELECT stars FROM starboard').get().stars, 2);
});

test('owner constant is exactly the required ID', () => { assert.equal(IDENTITY.GLOBAL_OWNER_ID, '1131248987173814336'); });

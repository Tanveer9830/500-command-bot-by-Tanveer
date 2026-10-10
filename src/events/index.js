'use strict';
/** Wires every Discord gateway event to its handler. Each handler isolates its own errors. */
const { Events, ActivityType } = require('discord.js');
const { createInteractionHandler } = require('../handlers/interaction');
const { createMessageHandler } = require('../handlers/message');
const { createMemberHandlers } = require('./members');
const { createReactionHandlers } = require('./reactions');
const { createLoggingHandlers } = require('./logging');
const log = require('../utils/logger').child('events');

const guard = (name, fn) => async (...a) => { try { await fn(...a); } catch (e) { log.error(`${name} handler failed`, { err: e }); } };

function registerEvents({ client, svc, registry, onReady }) {
  const interaction = createInteractionHandler({ client, svc, registry });
  const message = createMessageHandler({ client, svc, registry });
  const members = createMemberHandlers({ client, svc });
  const reactions = createReactionHandlers({ client, svc });
  const lg = createLoggingHandlers({ svc });
  const pending = new Map(); // idle-leave timers per guild

  client.once(Events.ClientReady, guard('ready', async () => {
    client.user.setPresence({ activities: [{ name: '/help • !help', type: ActivityType.Listening }], status: 'online' });
    log.info('connected to Discord', { tag: client.user.tag, guilds: client.guilds.cache.size });
    if (onReady) await onReady();
  }));
  client.on(Events.InteractionCreate, interaction);
  client.on(Events.MessageCreate, message);
  client.on(Events.GuildMemberAdd, members.onAdd);
  client.on(Events.GuildMemberRemove, members.onRemove);
  client.on(Events.MessageReactionAdd, reactions.onAdd);
  client.on(Events.MessageReactionRemove, reactions.onRemove);
  client.on(Events.MessageDelete, guard('messageDelete', lg.messageDelete));
  client.on(Events.MessageUpdate, guard('messageUpdate', lg.messageUpdate));
  client.on(Events.GuildBanAdd, guard('banAdd', lg.banAdd));
  client.on(Events.GuildBanRemove, guard('banRemove', lg.banRemove));
  client.on(Events.ChannelCreate, guard('channelCreate', lg.channelCreate));
  client.on(Events.ChannelDelete, guard('channelDelete', lg.channelDelete));
  client.on(Events.GuildRoleCreate, guard('roleCreate', lg.roleCreate));
  client.on(Events.GuildRoleDelete, guard('roleDelete', lg.roleDelete));
  client.on(Events.GuildMemberUpdate, guard('nickname', lg.nickname));
  client.on(Events.GuildCreate, (g) => log.info('joined guild', { guild: g.id, members: g.memberCount }));
  client.on(Events.GuildDelete, (g) => { if (g.available !== false) log.info('left guild', { guild: g.id }); });

  // Leave an empty voice channel after 90s unless 24/7 mode is on.
  client.on(Events.VoiceStateUpdate, guard('voice', async (a, b) => {
    await lg.voice(a, b);
    const guild = (b.guild || a.guild); const st = svc.music && svc.music.state(guild.id); if (!st) return;
    const ch = guild.channels.cache.get(st.voiceChannelId); if (!ch) return;
    const humans = [...ch.members.values()].filter((m) => !m.user.bot).length;
    if (humans > 0) { clearTimeout(pending.get(guild.id)); pending.delete(guild.id); return; }
    if (svc.settings.get(guild.id, 'music_247') || pending.has(guild.id)) return;
    const t = setTimeout(async () => {
      pending.delete(guild.id);
      const c = guild.channels.cache.get(st.voiceChannelId);
      if (c && [...c.members.values()].some((m) => !m.user.bot)) return;
      await svc.music.leave(guild.id).catch(() => {});
    }, 90_000); t.unref();
    pending.set(guild.id, t);
  }));

  client.on(Events.Error, (e) => log.error('client error', { err: e }));
  client.on(Events.Warn, (m) => log.warn('client warning', { msg: m }));
  client.on(Events.ShardDisconnect, (ev, id) => log.warn('shard disconnected', { shard: id, code: ev && ev.code }));
  client.on(Events.ShardReconnecting, (id) => log.info('shard reconnecting', { shard: id }));
  client.on(Events.ShardResume, (id) => log.info('shard resumed', { shard: id }));
  return { message, interaction };
}

module.exports = { registerEvents };

'use strict';
const { Settings } = require('./settings');
const { Economy } = require('./economy');
const { Levels } = require('./levels');
const { Moderation } = require('./moderation');
const { CustomCommands } = require('./customCommands');
const { Music } = require('./music');
const { Giveaways, Polls, Tickets } = require('./community');
const { Lookup } = require('./lookup');
const { AutoMod } = require('../security/automod');
const { AntiRaid } = require('../security/antiraid');
const { RateLimiter } = require('../security/ratelimit');
const { NO_MENTIONS } = require('../core/reply');
const log = require('../utils/logger').child('svc');
const pkg = require('../../package.json');

/** Dependency container shared by commands, events and the dashboard. */
function createServices({ db, config, registry, client = null, music = null, lookup = null, clock = {} }) {
  const now = clock.now || (() => Math.floor(Date.now() / 1000));
  const random = clock.random || Math.random;
  const settings = new Settings(db);
  const svc = {
    db, config, registry, client, settings, log,
    now, random,
    bot: { name: config.botName, version: pkg.version, startedAt: Date.now() },
    economy: new Economy({ db, settings, now, random }),
    levels: new Levels({ db, settings, now, random }),
    moderation: new Moderation({ db, now }),
    customCommands: new CustomCommands({ db, registry, settings, now, random }),
    giveaways: new Giveaways({ db, now, random }),
    polls: new Polls({ db, now }),
    tickets: new Tickets({ db, settings, now }),
    music: music || new Music({ config, settings }),
    lookup: lookup || new Lookup(),
    automod: new AutoMod({ settings }),
    antiraid: new AntiRaid({ settings }),
    rateLimiter: new RateLimiter(),
    games: new Map(), // in-memory per-user game sessions
    scheduler: null,
  };

  /** Append to the bot's own audit log (never throws). */
  svc.audit = ({ guildId = null, actorId, action, target = null, details = null, source = null }) => {
    try {
      db.prepare('INSERT INTO audit_log (guild_id, actor_id, action, target, details, source, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(guildId, actorId, action, target, details, source, now());
    } catch (e) { log.error('audit write failed', { err: e }); }
  };

  /** Send a message to a channel by ID with mentions disabled. Returns the message or null. */
  svc.sendToChannel = async (channelId, payload) => {
    if (!svc.client || !channelId) return null;
    try {
      const ch = svc.client.channels.cache.get(channelId) || await svc.client.channels.fetch(channelId);
      if (!ch || !ch.send) return null;
      return await ch.send({ ...payload, allowedMentions: NO_MENTIONS });
    } catch (e) { log.warn('sendToChannel failed', { channelId, err: e.message }); return null; }
  };
  /** Edit a previously sent bot message (best effort). */
  svc.editMessage = async (channelId, messageId, payload) => {
    if (!svc.client || !channelId || !messageId) return false;
    try {
      const ch = svc.client.channels.cache.get(channelId) || await svc.client.channels.fetch(channelId);
      const msg = await ch.messages.fetch(messageId);
      await msg.edit({ ...payload, allowedMentions: NO_MENTIONS });
      return true;
    } catch (e) { log.debug('editMessage failed', { err: e.message }); return false; }
  };
  svc.dm = async (userId, payload) => {
    if (!svc.client) return false;
    try { const u = await svc.client.users.fetch(userId); await u.send({ ...payload, allowedMentions: NO_MENTIONS }); return true; } catch { return false; }
  };
  /** Log an event to the configured log channel for `type` (falls back to the "all" channel). */
  svc.logEvent = async (guildId, type, embed) => {
    const map = settings.get(guildId, 'log_channels');
    if (settings.get(guildId, 'log_disabled_events').includes(type)) return;
    const ch = map[type] || map.all;
    if (ch) await svc.sendToChannel(ch, { embeds: [embed] });
  };
  return svc;
}

module.exports = { createServices };

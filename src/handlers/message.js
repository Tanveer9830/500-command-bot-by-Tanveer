'use strict';
/**
 * messageCreate pipeline.
 *   1. automod (guild text only)         — delete / warn / timeout
 *   2. prefix commands + custom commands — through the shared registry/executor
 *   3. everything else                   — AFK, XP, autoresponders, sticky messages
 * Nothing here ever pings anyone: every send uses allowedMentions { parse: [] }.
 */
const { baseContext, respondMessage } = require('../core/context');
const { NO_MENTIONS } = require('../core/reply');
const { tokenize, fillTemplate, safe, ts, formatDuration } = require('../utils/text');
const { DEFAULT_PREFIX } = require('../constants');
const { isGlobalOwner } = require('../security/authz');
const { matchAutoresponder } = require('../commands/communityadmin');
const { applyRewards } = require('../commands/progress');
const log = require('../utils/logger').child('message');


function createMessageHandler({ client, svc, registry, timers = { setTimeout } }) {
  const { db, settings } = svc;
  const respCooldown = new Map(); // channelId -> ms of last autoresponder
  const stickyTimers = new Map();

  const isBlocked = (userId) => {
    if (isGlobalOwner(userId)) return false;
    if (db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(userId)) return true;
    const m = db.prepare("SELECT value FROM global_state WHERE key = 'maintenance'").get();
    return Boolean(m && m.value === '1');
  };
  const say = (channel, content) => channel.send({ content: String(content).slice(0, 2000), allowedMentions: NO_MENTIONS }).catch(() => null);
  const sayTemp = async (channel, content, ms = 8000) => { const m = await say(channel, content); if (m && m.delete) timers.setTimeout(() => m.delete().catch(() => {}), ms).unref?.(); return m; };

  // ------------------------------------------------------------------ automod
  async function automod(message, member) {
    if (!settings.get(message.guildId, 'automod_enabled')) return false;
    if (!member || member.permissions.has('Administrator') || member.permissions.has('ManageMessages')) return false; // staff are never moderated
    const mentionCount = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    const hit = svc.automod.inspect({ guildId: message.guildId, userId: message.author.id, content: message.content, mentionCount, memberRoleIds: [...member.roles.cache.keys()], channelId: message.channelId });
    if (!hit) return false;
    const action = settings.get(message.guildId, 'automod_action');
    try { if (message.deletable !== false) await message.delete(); } catch { /* missing permission or already deleted */ }
    const name = safe(member.displayName);
    let note = `🛡️ ${name}, your message was removed (${hit.rule}).`;
    let caseNo = null;
    if (action === 'warn' || action === 'timeout') {
      const c = svc.moderation.createCase({ guildId: message.guildId, type: action === 'warn' ? 'warn' : 'timeout', targetId: member.id, moderatorId: client.user ? client.user.id : 'automod', reason: `AutoMod: ${hit.rule} (${hit.detail})`, durationSecs: action === 'timeout' ? settings.get(message.guildId, 'automod_timeout') : null });
      caseNo = c.case_no;
      if (action === 'timeout' && member.moderatable) {
        const secs = settings.get(message.guildId, 'automod_timeout');
        await member.timeout(secs * 1000, `AutoMod: ${hit.rule}`).then(() => { note += ` You are timed out for ${formatDuration(secs)}.`; }).catch(() => {});
      } else if (action === 'warn') note += ' A warning was recorded.';
    }
    await sayTemp(message.channel, note);
    await svc.logEvent(message.guildId, 'mod', { color: 0x7b4dff, title: '🛡️ AutoMod', description: `**User:** ${name} (${member.id})\n**Channel:** <#${message.channelId}>\n**Rule:** ${hit.rule} — ${safe(hit.detail)}\n**Action:** ${action}${caseNo ? ` (case #${caseNo})` : ''}`, timestamp: true });
    return true;
  }

  // -------------------------------------------------------- command dispatch
  function groupHelp(res, prefix) {
    const g = res.group;
    const subs = res.subgroup ? g.actions.filter((a) => a.subgroup === res.subgroup) : g.actions.filter((a) => !a.subgroup);
    const lines = subs.slice(0, 25).map((a) => `\`${prefix}${[g.name, a.subgroup, a.sub].filter(Boolean).join(' ')}\` — ${a.description}${a.access !== 'user' ? ' 🔒' : ''}`);
    if (!res.subgroup && g.subgroups.size) lines.push(`Sub-groups: ${[...g.subgroups.keys()].map((s) => `\`${prefix}${g.name} ${s}\``).join(', ')}`);
    return { embed: { title: `${g.name} commands`, description: lines.join('\n') || '_nothing here_' } };
  }

  async function command(message, prefix) {
    const body = message.content.slice(prefix.length);
    const tokens = tokenize(body);
    if (!tokens.length) return false;
    const res = registry.resolve(tokens);
    const uid = message.author.id;
    if (!res) {
      const custom = svc.customCommands.resolve(message.guildId, tokens[0].value);
      if (!custom) return false;
      if (isBlocked(uid)) return true;
      if (!isGlobalOwner(uid)) { if (svc.rateLimiter.limit(uid) || svc.rateLimiter.cooldown(uid, `custom:${custom.id}`, 3)) return true; }
      const text = svc.customCommands.render(custom, { user: message.author, guild: message.guild, channel: message.channel, args: tokens.slice(1).map((t) => t.value) });
      await say(message.channel, safe(text));
      return true;
    }
    if (!res.action) {
      if (isBlocked(uid)) return true;
      const { toPayload } = require('../core/reply');
      await message.reply({ ...toPayload(groupHelp(res, prefix)), allowedMentions: NO_MENTIONS }).catch(() => {});
      return true;
    }
    const ctx = await baseContext({ client, guild: message.guild, channel: message.channel, user: message.author, member: message.member, source: 'prefix', input: { kind: 'prefix', tokens: res.rest, raw: body }, prefix });
    const outcome = await res.action.execute(ctx);
    await respondMessage(message, outcome, svc);
    return true;
  }

  // ------------------------------------------------------------- passive flows
  async function afk(message, member) {
    const g = message.guildId; const uid = message.author.id;
    const mine = db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(g, uid);
    if (mine) { db.prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ?').run(g, uid); await sayTemp(message.channel, `👋 Welcome back, ${safe(member ? member.displayName : message.author.username)}! I removed your AFK status.`); }
    const notes = [];
    for (const u of [...message.mentions.users.values()].slice(0, 5)) {
      if (u.id === uid) continue;
      const row = db.prepare('SELECT reason, since FROM afk WHERE guild_id = ? AND user_id = ?').get(g, u.id);
      if (row) notes.push(`💤 **${safe(u.username)}** is AFK${row.reason ? `: ${safe(row.reason)}` : ''} (since ${ts(row.since, 'R')})`);
    }
    if (notes.length) await sayTemp(message.channel, notes.join('\n'), 15000);
  }

  async function xp(message, member) {
    const res = svc.levels.onMessage(message.guildId, message.author.id, message.channelId);
    if (!res || !res.leveledUp) return;
    if (member) { try { await applyRewards(message.guild, member, svc, res.level); } catch (e) { log.debug('reward failed', { err: e.message }); } }
    try { svc.levels.evaluate(message.guildId, message.author.id); } catch { /* achievements are optional */ }
    if (!settings.get(message.guildId, 'lvl_announce')) return;
    const pref = db.prepare("SELECT value FROM user_prefs WHERE user_id = ? AND key = 'levelup_notify'").get(message.author.id);
    const mode = pref ? pref.value : 'channel';
    if (mode === 'off') return;
    const text = fillTemplate(settings.get(message.guildId, 'lvl_message'), { user: message.author.username, username: message.author.username, level: res.level, server: message.guild.name });
    if (mode === 'dm') { await svc.dm(message.author.id, { content: text }); return; }
    const chId = settings.get(message.guildId, 'lvl_channel');
    if (chId && chId !== message.channelId) await svc.sendToChannel(chId, { content: text }); else await say(message.channel, text);
  }

  async function autoresponder(message) {
    const rows = db.prepare('SELECT * FROM autoresponders WHERE guild_id = ? AND enabled = 1').all(message.guildId);
    if (!rows.length) return;
    const hit = matchAutoresponder(message.content, rows); if (!hit) return;
    const last = respCooldown.get(message.channelId) || 0; const now = Date.now();
    if (now - last < 5000) return;
    respCooldown.set(message.channelId, now);
    await say(message.channel, fillTemplate(hit.response, { user: message.author.username, username: message.author.username, server: message.guild.name }));
  }

  function sticky(message) {
    const row = db.prepare('SELECT * FROM sticky WHERE guild_id = ? AND channel_id = ?').get(message.guildId, message.channelId);
    if (!row || stickyTimers.has(message.channelId)) return;
    const t = timers.setTimeout(async () => {
      stickyTimers.delete(message.channelId);
      try {
        const cur = db.prepare('SELECT * FROM sticky WHERE guild_id = ? AND channel_id = ?').get(message.guildId, message.channelId); if (!cur) return;
        if (cur.last_message_id) await message.channel.messages.delete(cur.last_message_id).catch(() => {});
        const sent = await say(message.channel, `📌 ${cur.content}`);
        if (sent) db.prepare('UPDATE sticky SET last_message_id = ? WHERE guild_id = ? AND channel_id = ?').run(sent.id, message.guildId, message.channelId);
      } catch (e) { log.debug('sticky repost failed', { err: e.message }); }
    }, 3000);
    if (t && t.unref) t.unref();
    stickyTimers.set(message.channelId, t);
  }

  return async function onMessage(message) {
    try {
      if (message.author.bot || message.webhookId || message.system) return;
      const inGuild = Boolean(message.guildId);
      let member = message.member;
      if (inGuild && !member) member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (inGuild && await automod(message, member)) return;
      const prefix = inGuild ? settings.get(message.guildId, 'prefix') : DEFAULT_PREFIX;
      if (prefix && message.content.startsWith(prefix) && await command(message, prefix)) return;
      if (!inGuild || isBlocked(message.author.id)) return;
      await afk(message, member);
      await xp(message, member);
      await autoresponder(message);
      sticky(message);
    } catch (err) {
      log.error('message handler failed', { err });
    }
  };
}

module.exports = { createMessageHandler };

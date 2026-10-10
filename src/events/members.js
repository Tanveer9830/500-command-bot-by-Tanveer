'use strict';
/** Member join/leave: anti-raid, welcome/farewell, auto-roles, logging. No pings anywhere. */
const { fillTemplate, safe, ts } = require('../utils/text');
const { NO_MENTIONS } = require('../core/reply');
const log = require('../utils/logger').child('members');

function createMemberHandlers({ client, svc }) {
  const { settings } = svc;
  const botId = () => (client.user ? client.user.id : 'system');
  const vars = (m) => ({ user: m.displayName || m.user.username, username: m.user.username, server: m.guild.name, count: m.guild.memberCount });

  async function raidAction(member, d) {
    const g = member.guild.id; const reason = `Anti-raid: ${d.reason}`;
    let done = null;
    try {
      if (d.action === 'kick' && member.kickable) { await member.kick(reason); done = 'kick'; }
      else if (d.action === 'ban' && member.bannable) { await member.ban({ reason, deleteMessageSeconds: 0 }); done = 'ban'; }
      else if (d.action === 'timeout' && member.moderatable) { await member.timeout(3600 * 1000, reason); done = 'timeout'; }
    } catch (e) { log.warn('anti-raid action failed', { err: e.message }); }
    if (done) svc.moderation.createCase({ guildId: g, type: done, targetId: member.id, moderatorId: botId(), reason, durationSecs: done === 'timeout' ? 3600 : null });
    await svc.logEvent(g, 'mod', { color: 0x7b4dff, title: '🚨 Anti-raid', description: `**User:** ${safe(member.user.username)} (${member.id})\n**Account created:** ${ts(Math.floor(member.user.createdTimestamp / 1000), 'R')}\n**Reason:** ${safe(d.reason)}\n**Action:** ${done || 'alert only'}`, timestamp: true });
    return done;
  }

  async function onAdd(member) {
    try {
      const g = member.guild.id;
      if (!member.user.bot) {
        const d = svc.antiraid.onJoin({ guildId: g, userId: member.id, accountCreatedMs: member.user.createdTimestamp });
        if (d.raid) { const done = await raidAction(member, d); if (done === 'kick' || done === 'ban') return; }
      }
      for (const rid of settings.get(g, 'autoroles')) {
        const role = member.guild.roles.cache.get(rid); const me = member.guild.members.me;
        if (!role || role.managed || (me && role.position >= me.roles.highest.position)) continue;
        await member.roles.add(role, 'Auto-role').catch((e) => log.debug('autorole failed', { err: e.message }));
      }
      if (settings.get(g, 'welcome_enabled') && settings.get(g, 'welcome_channel')) {
        await svc.sendToChannel(settings.get(g, 'welcome_channel'), { content: fillTemplate(settings.get(g, 'welcome_message'), vars(member)) });
      }
      if (settings.get(g, 'welcome_dm_enabled') && !member.user.bot) await svc.dm(member.id, { content: fillTemplate(settings.get(g, 'welcome_dm'), vars(member)) });
      await svc.logEvent(g, 'member', { color: 0x1f6bff, title: '📥 Member joined', description: `${safe(member.user.username)} (${member.id})\nAccount created ${ts(Math.floor(member.user.createdTimestamp / 1000), 'R')}`, timestamp: true });
    } catch (e) { log.error('member add handler failed', { err: e }); }
  }

  async function onRemove(member) {
    try {
      const g = member.guild.id;
      if (settings.get(g, 'leave_enabled') && settings.get(g, 'leave_channel') && !member.user.bot) {
        await svc.sendToChannel(settings.get(g, 'leave_channel'), { content: fillTemplate(settings.get(g, 'leave_message'), vars(member)) });
      }
      await svc.logEvent(g, 'member', { color: 0x7b4dff, title: '📤 Member left', description: `${safe(member.user.username)} (${member.id})`, timestamp: true });
    } catch (e) { log.error('member remove handler failed', { err: e }); }
  }

  return { onAdd, onRemove, NO_MENTIONS };
}

module.exports = { createMemberHandlers };

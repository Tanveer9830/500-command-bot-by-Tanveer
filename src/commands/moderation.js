'use strict';
const { Collection } = require('discord.js');
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { formatDuration, truncate, ts } = require('../utils/text');

const MAX_TIMEOUT = 28 * 86400;
const auditReason = (ctx, reason) => truncate(`${ctx.user.username || ctx.user.id} (${ctx.user.id}): ${reason || 'No reason provided'}`, 512);
const fmtCase = (c) => `**#${c.case_no}** ${c.type}${c.active ? '' : ' (inactive)'} • <@\u200b${c.target_id}> \`${c.target_id}\` • ${c.reason || 'no reason'} • ${ts(c.ts)}`;
const durationOpt = (max = MAX_TIMEOUT) => ({ name: 'duration', type: 'duration', description: 'e.g. 10m, 2h, 1d', required: true, min: 1, max });

module.exports = function register(registry) {
  const mod = registry.group({ name: 'mod', description: 'Moderation tools', category: 'Moderation', aliases: ['moderation', 'm'] });
  const A = (sub, spec, run) => mod.action(sub, { access: 'admin', guildOnly: true, cooldown: 2, ...spec }, run);
  const reasonOpt = H.reasonOpt; const userOpt = H.userOpt;

  async function punish(ctx, { type, user, reason, durationSecs, deleteSecs = 0 }) {
    const { guild } = ctx;
    H.assertNotProtected(ctx, user);
    const member = await ctx.getMember(user);
    if (member) H.assertCanModerate(ctx, member);
    return { member };
  }

  A('ban', { description: 'Ban a user from the server', perms: ['BanMembers'], botPerms: ['BanMembers'], options: [userOpt('User to ban'), reasonOpt] }, async (ctx) => {
    const { user, reason } = ctx.args; await punish(ctx, { user });
    await ctx.guild.members.ban(user.id, { reason: auditReason(ctx, reason) });
    const c = await H.recordCase(ctx, { type: 'ban', user, reason });
    return H.ok(`Banned **${user.username || user.id}** (\`${user.id}\`) — case #${c.case_no}`);
  });
  A('tempban', { description: 'Ban a user for a limited time', perms: ['BanMembers'], botPerms: ['BanMembers'], options: [userOpt('User to ban'), durationOpt(365 * 86400), reasonOpt] }, async (ctx) => {
    const { user, duration, reason } = ctx.args; await punish(ctx, { user });
    await ctx.guild.members.ban(user.id, { reason: auditReason(ctx, `[tempban ${formatDuration(duration)}] ${reason || ''}`) });
    const c = await H.recordCase(ctx, { type: 'tempban', user, reason, durationSecs: duration });
    return H.ok(`Temp-banned **${user.username || user.id}** for ${formatDuration(duration)} — case #${c.case_no}`);
  });
  A('softban', { description: 'Ban and unban to delete recent messages', perms: ['BanMembers'], botPerms: ['BanMembers'], options: [userOpt('User to softban'), reasonOpt] }, async (ctx) => {
    const { user, reason } = ctx.args; await punish(ctx, { user });
    await ctx.guild.members.ban(user.id, { reason: auditReason(ctx, `[softban] ${reason || ''}`), deleteMessageSeconds: 7 * 86400 });
    await ctx.guild.members.unban(user.id, 'softban: immediate unban');
    const c = await H.recordCase(ctx, { type: 'softban', user, reason });
    return H.ok(`Softbanned **${user.username || user.id}** (messages from the last 7 days removed) — case #${c.case_no}`);
  });
  A('unban', { description: 'Remove a ban by user ID', perms: ['BanMembers'], botPerms: ['BanMembers'], options: [{ name: 'user', type: 'user', description: 'User (ID) to unban', required: true }, reasonOpt] }, async (ctx) => {
    const { user, reason } = ctx.args;
    await ctx.guild.members.unban(user.id, auditReason(ctx, reason));
    ctx.db.prepare("UPDATE cases SET active = 0 WHERE guild_id = ? AND target_id = ? AND type = 'tempban' AND active = 1").run(ctx.guildId, user.id);
    const c = await H.recordCase(ctx, { type: 'unban', user, reason });
    return H.ok(`Unbanned **${user.username || user.id}** — case #${c.case_no}`);
  });
  A('kick', { description: 'Kick a member from the server', perms: ['KickMembers'], botPerms: ['KickMembers'], options: [userOpt('Member to kick'), reasonOpt] }, async (ctx) => {
    const { user, reason } = ctx.args;
    const m = await H.requireMember(ctx, user); H.assertCanModerate(ctx, m);
    await m.kick(auditReason(ctx, reason));
    const c = await H.recordCase(ctx, { type: 'kick', user, reason });
    return H.ok(`Kicked **${m.displayName || user.username}** — case #${c.case_no}`);
  });
  A('timeout', { description: 'Time a member out (mute) for a duration', aliases: ['mute'], perms: ['ModerateMembers'], botPerms: ['ModerateMembers'], options: [userOpt('Member'), durationOpt(), reasonOpt] }, async (ctx) => {
    const { user, duration, reason } = ctx.args;
    const m = await H.requireMember(ctx, user); H.assertCanModerate(ctx, m);
    await m.timeout(duration * 1000, auditReason(ctx, reason));
    const c = await H.recordCase(ctx, { type: 'timeout', user, reason, durationSecs: duration });
    return H.ok(`Timed out **${m.displayName || user.username}** for ${formatDuration(duration)} — case #${c.case_no}`);
  });
  A('untimeout', { description: 'Remove a timeout from a member', aliases: ['unmute'], perms: ['ModerateMembers'], botPerms: ['ModerateMembers'], options: [userOpt('Member'), reasonOpt] }, async (ctx) => {
    const { user, reason } = ctx.args;
    const m = await H.requireMember(ctx, user);
    await m.timeout(null, auditReason(ctx, reason));
    const c = await H.recordCase(ctx, { type: 'untimeout', user, reason });
    return H.ok(`Removed timeout from **${m.displayName || user.username}** — case #${c.case_no}`);
  });
  A('warn', { description: 'Warn a member (recorded in the case log)', perms: ['ModerateMembers'], options: [userOpt('Member to warn'), { ...reasonOpt, required: true, description: 'Reason for the warning' }] }, async (ctx) => {
    const { user, reason } = ctx.args;
    const m = await H.requireMember(ctx, user); H.assertCanModerate(ctx, m);
    const c = await H.recordCase(ctx, { type: 'warn', user, reason });
    const count = ctx.svc.moderation.activeWarnings(ctx.guildId, user.id).length;
    let extra = '';
    const esc = ctx.svc.moderation.warnAction(ctx.guildId, count);
    if (esc) {
      const me = ctx.guild.members.me;
      if (esc.action === 'timeout' && me.permissions.has('ModerateMembers')) { await m.timeout((esc.duration || 3600) * 1000, `Auto: ${count} warnings`); extra = ` Auto-action: timeout ${formatDuration(esc.duration || 3600)}.`; }
      else if (esc.action === 'kick' && me.permissions.has('KickMembers')) { await m.kick(`Auto: ${count} warnings`); extra = ' Auto-action: kick.'; }
      else if (esc.action === 'ban' && me.permissions.has('BanMembers')) { await ctx.guild.members.ban(user.id, { reason: `Auto: ${count} warnings` }); extra = ' Auto-action: ban.'; }
      else extra = ` (auto-action ${esc.action} skipped: missing permission)`;
    }
    return H.ok(`Warned **${m.displayName || user.username}** — case #${c.case_no} (${count} active warning${count === 1 ? '' : 's'}).${extra}`);
  });
  A('unwarn', { description: 'Deactivate a warning by case number', perms: ['ModerateMembers'], options: [{ name: 'case', type: 'integer', description: 'Case number of the warning', required: true, min: 1 }] }, (ctx) => {
    const c = ctx.svc.moderation.getCase(ctx.guildId, ctx.args.case);
    if (c.type !== 'warn') throw new UserError(`Case #${c.case_no} is not a warning.`);
    if (!c.active) throw new UserError('That warning is already inactive.');
    ctx.svc.moderation.deactivate(ctx.guildId, c.case_no);
    return H.ok(`Warning #${c.case_no} deactivated.`);
  });
  A('warnings', { description: "List a user's warnings", perms: ['ModerateMembers'], options: [userOpt()] }, (ctx) => {
    const list = ctx.svc.moderation.forTarget(ctx.guildId, ctx.args.user.id, 'warn');
    return H.embed(ctx, { title: `Warnings for ${ctx.args.user.username || ctx.args.user.id}`, description: H.listLines(list, fmtCase, 15) });
  });
  A('clearwarnings', { description: "Deactivate all of a user's warnings", perms: ['ModerateMembers'], options: [userOpt()] }, (ctx) => {
    const n = ctx.svc.moderation.clearWarnings(ctx.guildId, ctx.args.user.id);
    return H.ok(`Cleared ${n} warning(s) for **${ctx.args.user.username || ctx.args.user.id}**.`);
  });
  A('note', { description: 'Add a private moderator note about a user', perms: ['ModerateMembers'], options: [userOpt(), { name: 'text', type: 'string', description: 'The note', required: true, maxLength: 400, rest: true }] }, async (ctx) => {
    const c = ctx.svc.moderation.createCase({ guildId: ctx.guildId, type: 'note', targetId: ctx.args.user.id, moderatorId: ctx.user.id, reason: ctx.args.text });
    return H.ok(`Note saved as case #${c.case_no}.`);
  });
  A('notes', { description: 'Show moderator notes about a user', perms: ['ModerateMembers'], options: [userOpt()] }, (ctx) => {
    const list = ctx.svc.moderation.forTarget(ctx.guildId, ctx.args.user.id, 'note');
    return H.embed(ctx, { title: 'Moderator notes', description: H.listLines(list, fmtCase, 15) });
  });
  A('case', { description: 'Look up a moderation case', perms: ['ModerateMembers'], options: [{ name: 'number', type: 'integer', description: 'Case number', required: true, min: 1 }] }, (ctx) => {
    const c = ctx.svc.moderation.getCase(ctx.guildId, ctx.args.number);
    return H.embed(ctx, { title: `Case #${c.case_no} — ${c.type}`, fields: [
      { name: 'Target', value: `\`${c.target_id}\``, inline: true }, { name: 'Moderator', value: `\`${c.moderator_id}\``, inline: true },
      { name: 'Active', value: c.active ? 'yes' : 'no', inline: true }, { name: 'Reason', value: c.reason || 'none' },
      { name: 'When', value: ts(c.ts, 'F') }, ...(c.expires_at ? [{ name: 'Expires', value: ts(c.expires_at, 'F') }] : []) ] });
  });
  A('cases', { description: 'List recent moderation cases', perms: ['ModerateMembers'], options: [{ name: 'limit', type: 'integer', description: 'How many (1-25)', min: 1, max: 25, default: 10 }] }, (ctx) =>
    H.embed(ctx, { title: 'Recent cases', description: H.listLines(ctx.svc.moderation.recent(ctx.guildId, ctx.args.limit), fmtCase, 25) }));
  A('banids', { description: 'Ban several users by ID (up to 10)', perms: ['BanMembers'], botPerms: ['BanMembers'], options: [{ name: 'ids', type: 'string', description: 'Space/comma-separated user IDs', required: true, maxLength: 400, rest: true }] }, async (ctx) => {
    const ids = [...new Set(ctx.args.ids.split(/[\s,]+/).filter(Boolean))];
    if (ids.length > 10) throw new UserError('At most 10 IDs at once.');
    if (ids.some((i) => !/^\d{15,25}$/.test(i))) throw new UserError('All entries must be numeric user IDs.');
    const done = []; const failed = [];
    for (const id of ids) {
      try { H.assertNotProtected(ctx, { id }); await ctx.guild.members.ban(id, { reason: auditReason(ctx, 'mass ban by ID') }); await H.recordCase(ctx, { type: 'ban', user: { id }, reason: 'mass ban by ID' }); done.push(id); } catch (e) { failed.push(`${id} (${e.message})`); }
    }
    return `Banned ${done.length}/${ids.length}.${failed.length ? `\nFailed: ${failed.join('; ')}` : ''}`;
  });
  A('reason', { description: 'Change the reason of a case', perms: ['ModerateMembers'], options: [{ name: 'case', type: 'integer', description: 'Case number', required: true, min: 1 }, { ...reasonOpt, required: true }] }, (ctx) => {
    ctx.svc.moderation.updateReason(ctx.guildId, ctx.args.case, ctx.args.reason);
    return H.ok(`Updated the reason of case #${ctx.args.case}.`);
  });
  A('modstats', { description: 'Moderation action counts by type', perms: ['ModerateMembers'] }, (ctx) => {
    const rows = ctx.db.prepare('SELECT type, COUNT(*) c FROM cases WHERE guild_id = ? GROUP BY type ORDER BY c DESC').all(ctx.guildId);
    return H.embed(ctx, { title: 'Moderation statistics', description: H.listLines(rows, (r) => `**${r.type}**: ${r.c}`, 20) });
  });
  A('checkban', { description: 'Check whether a user ID is banned', perms: ['BanMembers'], botPerms: ['BanMembers'], options: [userOpt()] }, async (ctx) => {
    let ban = null;
    try { ban = await ctx.guild.bans.fetch(ctx.args.user.id); } catch { /* not banned */ }
    return ban ? `🔨 \`${ctx.args.user.id}\` is banned${ban.reason ? `: ${ban.reason}` : ''}.` : `\`${ctx.args.user.id}\` is not banned.`;
  });
  A('warnaction-set', { description: 'Auto-action at N active warnings', perms: ['ManageGuild'], options: [{ name: 'threshold', type: 'integer', description: 'Warning count', required: true, min: 1, max: 20 }, { name: 'action', type: 'string', description: 'timeout, kick or ban', required: true, choices: ['timeout', 'kick', 'ban'] }, { name: 'duration', type: 'duration', description: 'Timeout length (default 1h)', min: 60, max: MAX_TIMEOUT }] }, (ctx) => {
    const { threshold, action, duration } = ctx.args;
    ctx.db.prepare('INSERT INTO warn_actions (guild_id, threshold, action, duration) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, threshold) DO UPDATE SET action = excluded.action, duration = excluded.duration').run(ctx.guildId, threshold, action, action === 'timeout' ? (duration || 3600) : null);
    return H.ok(`At **${threshold}** active warnings: **${action}**${action === 'timeout' ? ` (${formatDuration(duration || 3600)})` : ''}.`);
  });
  A('warnaction-remove', { description: 'Remove an auto-action threshold', perms: ['ManageGuild'], options: [{ name: 'threshold', type: 'integer', description: 'Warning count', required: true, min: 1, max: 20 }] }, (ctx) => {
    const r = ctx.db.prepare('DELETE FROM warn_actions WHERE guild_id = ? AND threshold = ?').run(ctx.guildId, ctx.args.threshold);
    if (!r.changes) throw new UserError('No auto-action at that threshold.');
    return H.ok('Removed.');
  });
  A('warnaction-list', { description: 'List warning auto-actions', perms: ['ManageGuild'] }, (ctx) => {
    const rows = ctx.db.prepare('SELECT * FROM warn_actions WHERE guild_id = ? ORDER BY threshold').all(ctx.guildId);
    return H.embed(ctx, { title: 'Warning auto-actions', description: H.listLines(rows, (r) => `At **${r.threshold}** → ${r.action}${r.duration ? ` (${formatDuration(r.duration)})` : ''}`) });
  });

  // ------------------------------------------------------------------- purge
  const purge = registry.group({ name: 'purge', description: 'Bulk-delete messages', category: 'Moderation', aliases: ['clean', 'clear'] });
  const P = (sub, description, extra, filter) => purge.action(sub, {
    description, access: 'admin', guildOnly: true, perms: ['ManageMessages'], botPerms: ['ManageMessages', 'ReadMessageHistory'], cooldown: 3,
    options: [...(extra || []), { name: 'count', type: 'integer', description: 'Messages to scan (1-100)', min: 1, max: 100, default: 50 }],
  }, async (ctx) => {
    const ch = ctx.channel;
    const fetched = await ch.messages.fetch({ limit: 100 });
    const cutoff = Date.now() - 14 * 86400_000;
    const matched = [...fetched.values()].filter((m) => !m.pinned && m.createdTimestamp > cutoff && filter(m, ctx)).slice(0, ctx.args.count);
    if (!matched.length) throw new UserError('No matching recent messages (messages older than 14 days cannot be bulk deleted).');
    const deleted = await ch.bulkDelete(matched, true);
    return H.ok(`Deleted **${deleted.size ?? matched.length}** message(s).`);
  });
  P('messages', 'Delete the latest messages in this channel', [], () => true);
  P('user', 'Delete recent messages from one user', [{ name: 'user', type: 'user', description: 'Author', required: true }], (m, ctx) => m.author.id === ctx.args.user.id);
  P('bots', 'Delete recent messages sent by bots', [], (m) => m.author.bot);
  P('humans', 'Delete recent messages sent by people', [], (m) => !m.author.bot);
  P('contains', 'Delete recent messages containing text', [{ name: 'text', type: 'string', description: 'Text to match', required: true, maxLength: 100 }], (m, ctx) => (m.content || '').toLowerCase().includes(ctx.args.text.toLowerCase()));
  P('links', 'Delete recent messages that contain links', [], (m) => /https?:\/\//i.test(m.content || ''));
  P('attachments', 'Delete recent messages with attachments', [], (m) => m.attachments && m.attachments.size > 0);
  P('embeds', 'Delete recent messages with embeds', [], (m) => m.embeds && m.embeds.length > 0);

  // ------------------------------------------------------------------ member
  const mem = registry.group({ name: 'member', description: 'Manage members: nicknames and voice', category: 'Moderation', aliases: ['mm'] });
  const M = (sub, spec, run) => mem.action(sub, { access: 'admin', guildOnly: true, ...spec }, run);
  M('nick', { description: 'Change a member nickname', perms: ['ManageNicknames'], botPerms: ['ManageNicknames'], options: [userOpt('Member'), { name: 'nickname', type: 'string', description: 'New nickname', required: true, maxLength: 32, rest: true }] }, async (ctx) => {
    const m = await H.requireMember(ctx, ctx.args.user); H.assertCanModerate(ctx, m);
    await m.setNickname(ctx.args.nickname, auditReason(ctx, 'nickname change'));
    return H.ok(`Nickname set to **${ctx.args.nickname}**.`);
  });
  M('resetnick', { description: 'Reset a member nickname', perms: ['ManageNicknames'], botPerms: ['ManageNicknames'], options: [userOpt('Member')] }, async (ctx) => {
    const m = await H.requireMember(ctx, ctx.args.user); H.assertCanModerate(ctx, m);
    await m.setNickname(null, auditReason(ctx, 'nickname reset'));
    return H.ok('Nickname reset.');
  });
  const voiceAction = (sub, description, perm, fn, msg) => M(sub, { description, perms: [perm], botPerms: [perm], options: [userOpt('Member')] }, async (ctx) => {
    const m = await H.requireMember(ctx, ctx.args.user); H.assertCanModerate(ctx, m);
    if (!m.voice || !m.voice.channel) throw new UserError('That member is not in a voice channel.');
    await fn(m, ctx); return H.ok(msg);
  });
  voiceAction('vckick', 'Disconnect a member from voice', 'MoveMembers', (m) => m.voice.disconnect('vckick'), 'Disconnected from voice.');
  voiceAction('vcmute', 'Server-mute a member in voice', 'MuteMembers', (m) => m.voice.setMute(true), 'Muted in voice.');
  voiceAction('vcunmute', 'Remove a voice server-mute', 'MuteMembers', (m) => m.voice.setMute(false), 'Unmuted in voice.');
  voiceAction('vcdeafen', 'Server-deafen a member in voice', 'DeafenMembers', (m) => m.voice.setDeaf(true), 'Deafened in voice.');
  voiceAction('vcundeafen', 'Remove a voice server-deafen', 'DeafenMembers', (m) => m.voice.setDeaf(false), 'Undeafened in voice.');
  M('vcmove', { description: 'Move a member to another voice channel', perms: ['MoveMembers'], botPerms: ['MoveMembers'], options: [userOpt('Member'), { name: 'channel', type: 'channel', description: 'Voice channel', required: true }] }, async (ctx) => {
    const m = await H.requireMember(ctx, ctx.args.user); H.assertCanModerate(ctx, m);
    if (!m.voice || !m.voice.channel) throw new UserError('That member is not in a voice channel.');
    const ch = ctx.args.channel;
    if (![2, 13].includes(ch.type)) throw new UserError('Target must be a voice or stage channel.');
    await m.voice.setChannel(ch, auditReason(ctx, 'vcmove'));
    return H.ok(`Moved to **${ch.name}**.`);
  });
  void Collection;
};

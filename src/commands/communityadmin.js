'use strict';
/** Community automation: reaction roles, autoresponders, starboard, sticky messages, scheduled messages, music admin. */
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { truncate, safe, ts, formatDuration } = require('../utils/text');

const channelOpt = { name: 'channel', type: 'channel', description: 'Text channel', required: true };
const confirmOpt = { name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] };

/** Normalise an emoji argument to the key stored in the DB (custom emoji id, or the unicode char). */
function emojiKey(s) {
  const t = String(s).trim();
  const m = /^<a?:\w+:(\d+)>$/.exec(t); if (m) return m[1];
  if (/^\d{15,25}$/.test(t)) return t;
  if (/^[\p{Extended_Pictographic}\u200d\ufe0f\u20e3\p{Regional_Indicator}]+$/u.test(t) && t.length <= 16) return t;
  throw new UserError('Use a standard emoji or a custom emoji from this server.');
}

/** Whole-word, case-insensitive trigger matching used by the message handler. */
function matchAutoresponder(text, rows) {
  const lower = String(text).toLowerCase();
  for (const r of rows) {
    if (!r.enabled) continue;
    const t = r.trigger.toLowerCase();
    const i = lower.indexOf(t);
    if (i === -1) continue;
    const before = i === 0 ? ' ' : lower[i - 1]; const after = i + t.length >= lower.length ? ' ' : lower[i + t.length];
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return r;
  }
  return null;
}

module.exports = function register(registry) {
  // -------------------------------------------------------- reaction roles
  const RR = registry.group({ name: 'reactionroles', description: 'Self-assignable roles via reactions', category: 'Community Admin', aliases: ['rr'] });
  const RA = (sub, spec, run) => RR.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageRoles'], ...spec }, run);
  const msgOpt = { name: 'message', type: 'string', description: 'Message ID', required: true, pattern: /^\d{15,25}$/, patternHelp: 'a message ID' };
  RA('add', { description: 'Bind an emoji on a message to a role', botPerms: ['ManageRoles', 'AddReactions'], options: [channelOpt, msgOpt, { name: 'emoji', type: 'string', description: 'Emoji', required: true, maxLength: 64 }, { name: 'role', type: 'role', description: 'Role to grant', required: true }] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    const key = emojiKey(ctx.args.emoji);
    const count = ctx.db.prepare('SELECT COUNT(*) n FROM reaction_roles WHERE guild_id = ?').get(ctx.guildId).n; if (count >= 100) throw new UserError('At most 100 reaction roles per server.');
    let msg; try { msg = await ctx.args.channel.messages.fetch(ctx.args.message); } catch { throw new UserError('I could not find that message in that channel.'); }
    ctx.db.prepare('INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, message_id, emoji) DO UPDATE SET role_id = excluded.role_id').run(ctx.guildId, ctx.args.message, key, ctx.args.role.id);
    try { await msg.react(/^\d+$/.test(key) ? key : ctx.args.emoji); } catch { /* reaction is cosmetic */ }
    return H.ok(`${ctx.args.emoji} on that message now grants <@&${ctx.args.role.id}>.`);
  });
  RA('remove', { description: 'Remove a binding', options: [msgOpt, { name: 'emoji', type: 'string', description: 'Emoji', required: true, maxLength: 64 }] }, (ctx) => { const n = ctx.db.prepare('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?').run(ctx.guildId, ctx.args.message, emojiKey(ctx.args.emoji)).changes; if (!n) throw new UserError('No such binding.'); return H.ok('Binding removed.'); });
  RA('list', { description: 'List all reaction roles' }, (ctx) => H.embed(ctx, { title: 'Reaction roles', description: H.listLines(ctx.db.prepare('SELECT * FROM reaction_roles WHERE guild_id = ? ORDER BY message_id').all(ctx.guildId), (r) => `${/^\d+$/.test(r.emoji) ? `<:e:${r.emoji}>` : r.emoji} → <@&${r.role_id}> on \`${r.message_id}\``, 25) }));
  RA('clear', { description: 'Remove all bindings (optionally for one message)', options: [confirmOpt, { name: 'message', type: 'string', description: 'Message ID (omit = all)', pattern: /^\d{15,25}$/, patternHelp: 'a message ID' }] }, (ctx) => H.ok(`Removed ${(ctx.args.message ? ctx.db.prepare('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ?').run(ctx.guildId, ctx.args.message) : ctx.db.prepare('DELETE FROM reaction_roles WHERE guild_id = ?').run(ctx.guildId)).changes} binding(s).`));

  // --------------------------------------------------------- autoresponders
  const AR = registry.group({ name: 'autoresponder', description: 'Automatic replies to trigger words', category: 'Community Admin', aliases: ['ar'] });
  const AA = (sub, spec, run) => AR.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  const trig = { name: 'trigger', type: 'string', description: 'Trigger word/phrase (use quotes for spaces)', required: true, minLength: 2, maxLength: 60 };
  AA('add', { description: 'Add an autoresponder', options: [trig, { name: 'response', type: 'string', description: 'Reply text', required: true, maxLength: 1000, rest: true }] }, (ctx) => {
    if (ctx.db.prepare('SELECT COUNT(*) n FROM autoresponders WHERE guild_id = ?').get(ctx.guildId).n >= 100) throw new UserError('At most 100 autoresponders per server.');
    try { ctx.db.prepare('INSERT INTO autoresponders (guild_id, trigger, response) VALUES (?, ?, ?)').run(ctx.guildId, ctx.args.trigger, ctx.args.response); } catch (e) { if (/UNIQUE/.test(e.message)) throw new UserError('That trigger already exists.'); throw e; }
    return H.ok(`I will reply when someone says **${safe(ctx.args.trigger)}**.`);
  });
  AA('remove', { description: 'Delete an autoresponder', options: [trig] }, (ctx) => { if (!ctx.db.prepare('DELETE FROM autoresponders WHERE guild_id = ? AND trigger = ?').run(ctx.guildId, ctx.args.trigger).changes) throw new UserError('No such trigger.'); return H.ok('Removed.'); });
  AA('list', { description: 'List autoresponders' }, (ctx) => H.embed(ctx, { title: 'Autoresponders', description: H.listLines(ctx.db.prepare('SELECT * FROM autoresponders WHERE guild_id = ? ORDER BY trigger').all(ctx.guildId), (r) => `${r.enabled ? '🟢' : '⚪'} **${safe(r.trigger)}** → ${safe(truncate(r.response, 60))}`, 25) }));
  AA('toggle', { description: 'Enable or disable one autoresponder', options: [trig] }, (ctx) => { const r = ctx.db.prepare('SELECT * FROM autoresponders WHERE guild_id = ? AND trigger = ?').get(ctx.guildId, ctx.args.trigger); if (!r) throw new UserError('No such trigger.'); ctx.db.prepare('UPDATE autoresponders SET enabled = ? WHERE id = ?').run(r.enabled ? 0 : 1, r.id); return H.ok(`**${safe(r.trigger)}** is now ${r.enabled ? 'disabled' : 'enabled'}.`); });
  AA('clear', { description: 'Delete all autoresponders', options: [confirmOpt] }, (ctx) => H.ok(`Removed ${ctx.db.prepare('DELETE FROM autoresponders WHERE guild_id = ?').run(ctx.guildId).changes} autoresponder(s).`));
  AA('test', { description: 'See which autoresponder a message would trigger', options: [{ name: 'text', type: 'string', description: 'Sample message', required: true, maxLength: 300, rest: true }] }, (ctx) => { const hit = matchAutoresponder(ctx.args.text, ctx.db.prepare('SELECT * FROM autoresponders WHERE guild_id = ?').all(ctx.guildId)); return hit ? `✅ Would trigger **${safe(hit.trigger)}**.` : 'No autoresponder would trigger.'; });

  // -------------------------------------------------------------- starboard
  const SB = registry.group({ name: 'starboard', description: 'Highlight popular messages', category: 'Community Admin', aliases: ['stars'] });
  H.configAction(SB, 'channel', { description: 'Set the starboard channel (omit to disable)', key: 'star_channel', kind: 'channel', label: 'Starboard channel' });
  H.configAction(SB, 'threshold', { description: 'Reactions needed to reach the starboard', key: 'star_threshold', kind: 'int', label: 'Starboard threshold' });
  H.configAction(SB, 'emoji', { description: 'Reaction emoji to count', key: 'star_emoji', kind: 'text', label: 'Starboard emoji' });
  SB.action('status', { description: 'Show starboard settings and totals', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, (ctx) => { const n = ctx.db.prepare('SELECT COUNT(*) n, COALESCE(MAX(stars),0) m FROM starboard WHERE guild_id = ?').get(ctx.guildId); return H.embed(ctx, { title: 'Starboard', description: `Channel: ${ctx.cfg('star_channel') ? `<#${ctx.cfg('star_channel')}>` : '_disabled_'}\nThreshold: **${ctx.cfg('star_threshold')}** ${ctx.cfg('star_emoji')}\nHighlighted: **${n.n}** (best: ${n.m})` }); });

  // ----------------------------------------------------------------- sticky
  const ST = registry.group({ name: 'sticky', description: 'Messages that stay at the bottom of a channel', category: 'Community Admin' });
  const SA = (sub, spec, run) => ST.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageMessages'], ...spec }, run);
  SA('set', { description: 'Set the sticky message of a channel', options: [channelOpt, { name: 'content', type: 'string', description: 'Message text', required: true, maxLength: 1500, rest: true }] }, (ctx) => { ctx.db.prepare('INSERT INTO sticky (guild_id, channel_id, content) VALUES (?, ?, ?) ON CONFLICT(guild_id, channel_id) DO UPDATE SET content = excluded.content, last_message_id = NULL').run(ctx.guildId, ctx.args.channel.id, ctx.args.content); return H.ok(`Sticky message set in <#${ctx.args.channel.id}>.`); });
  SA('remove', { description: 'Remove the sticky message of a channel', options: [channelOpt] }, (ctx) => { if (!ctx.db.prepare('DELETE FROM sticky WHERE guild_id = ? AND channel_id = ?').run(ctx.guildId, ctx.args.channel.id).changes) throw new UserError('That channel has no sticky message.'); return H.ok('Sticky removed.'); });
  SA('list', { description: 'List sticky messages' }, (ctx) => H.embed(ctx, { title: 'Sticky messages', description: H.listLines(ctx.db.prepare('SELECT * FROM sticky WHERE guild_id = ?').all(ctx.guildId), (s) => `<#${s.channel_id}> — ${safe(truncate(s.content, 80))}`, 25) }));
  SA('clear', { description: 'Remove every sticky message', options: [confirmOpt] }, (ctx) => H.ok(`Removed ${ctx.db.prepare('DELETE FROM sticky WHERE guild_id = ?').run(ctx.guildId).changes} sticky message(s).`));

  // --------------------------------------------------------------- schedule
  const SC = registry.group({ name: 'schedule', description: 'Scheduled and repeating announcements', category: 'Community Admin' });
  const CA = (sub, spec, run) => SC.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageMessages'], ...spec }, run);
  const body = { name: 'text', type: 'string', description: 'Message text', required: true, maxLength: 1500, rest: true };
  const mk = (ctx, secs, repeat) => {
    if (ctx.db.prepare("SELECT COUNT(*) n FROM scheduled_messages WHERE guild_id = ? AND status = 'pending'").get(ctx.guildId).n >= 50) throw new UserError('At most 50 scheduled messages per server.');
    const due = ctx.svc.now() + secs;
    const id = Number(ctx.db.prepare('INSERT INTO scheduled_messages (guild_id, channel_id, content, due_at, repeat_secs, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(ctx.guildId, ctx.args.channel.id, ctx.args.text, due, repeat || null, ctx.user.id).lastInsertRowid);
    return { id, due };
  };
  CA('add', { description: 'Post a message after a delay', options: [channelOpt, { name: 'in', type: 'duration', description: 'e.g. 30m, 6h, 2d', required: true, min: 30, max: 365 * 86400 }, body] }, (ctx) => { const r = mk(ctx, ctx.args.in); return H.ok(`Scheduled #${r.id} for ${ts(r.due)} in <#${ctx.args.channel.id}>.`); });
  CA('repeat', { description: 'Post a message repeatedly', options: [channelOpt, { name: 'every', type: 'duration', description: 'Interval (min 5m)', required: true, min: 300, max: 365 * 86400 }, body] }, (ctx) => { const r = mk(ctx, ctx.args.every, ctx.args.every); return H.ok(`Repeating every ${formatDuration(ctx.args.every)} (#${r.id}), first ${ts(r.due)}.`); });
  CA('list', { description: 'List scheduled messages' }, (ctx) => H.embed(ctx, { title: 'Scheduled messages', description: H.listLines(ctx.db.prepare("SELECT * FROM scheduled_messages WHERE guild_id = ? AND status = 'pending' ORDER BY due_at").all(ctx.guildId), (s) => `**#${s.id}** ${ts(s.due_at)}${s.repeat_secs ? ` 🔁 ${formatDuration(s.repeat_secs)}` : ''} <#${s.channel_id}> — ${safe(truncate(s.content, 60))}`, 20) }));
  CA('remove', { description: 'Cancel a scheduled message', options: [{ name: 'id', type: 'integer', description: 'Schedule ID', required: true, min: 1, max: 2_000_000_000 }] }, (ctx) => { if (!ctx.db.prepare("UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ? AND guild_id = ? AND status = 'pending'").run(ctx.args.id, ctx.guildId).changes) throw new UserError('No such pending schedule.'); return H.ok('Cancelled.'); });
  CA('clear', { description: 'Cancel all scheduled messages', options: [confirmOpt] }, (ctx) => H.ok(`Cancelled ${ctx.db.prepare("UPDATE scheduled_messages SET status = 'cancelled' WHERE guild_id = ? AND status = 'pending'").run(ctx.guildId).changes}.`));

  // --------------------------------------------------------------- music admin
  const MS = registry.group({ name: 'musicset', description: 'Music settings and controls (admin)', category: 'Community Admin' });
  H.configAction(MS, 'djrole', { description: 'Role allowed to control music (omit = anyone in the channel)', key: 'music_dj_role', kind: 'role', label: 'DJ role' });
  H.configAction(MS, 'maxqueue', { description: 'Maximum queue length', key: 'music_max_queue', kind: 'int', label: 'Max queue' });
  H.configAction(MS, 'volume', { description: 'Default volume for new sessions', key: 'music_default_volume', kind: 'int', label: 'Default volume' });
  H.configAction(MS, 'voteskip', { description: 'Require votes for non-DJ skips', key: 'music_vote_skip', kind: 'bool', label: 'Vote skip' });
  H.configAction(MS, 'channel', { description: 'Restrict music announcements to a channel', key: 'music_channel', kind: 'channel', label: 'Music channel' });
  H.configAction(MS, 'always', { description: 'Stay in the voice channel when idle', key: 'music_247', kind: 'bool', label: '24/7 mode' });
  MS.action('forcestop', { description: 'Stop playback and clear the queue', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, async (ctx) => { await ctx.svc.music.stop(ctx.guildId); return H.ok('Playback stopped.'); });
  MS.action('forceleave', { description: 'Make the bot leave voice', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, async (ctx) => { await ctx.svc.music.leave(ctx.guildId); return H.ok('Left the voice channel.'); });
};
module.exports.matchAutoresponder = matchAutoresponder;
module.exports.emojiKey = emojiKey;

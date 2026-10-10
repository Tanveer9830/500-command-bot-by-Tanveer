'use strict';
/** Shared helpers for command handlers. */
const { UserError } = require('../core/errors');
const { canModerate } = require('../security/authz');
const { truncate, fmtNum } = require('../utils/text');
const { COLORS } = require('../constants');

function colorOf(ctx) {
  const hex = ctx.guildId ? ctx.svc.settings.get(ctx.guildId, 'embed_color') : '#00e5ff';
  return parseInt(String(hex).replace('#', ''), 16) || COLORS.CYAN;
}

/** Build a result with a single embed. */
function embed(ctx, { title, description, fields, footer, thumbnail, image, url, color } = {}) {
  return { embed: { color: color ?? colorOf(ctx), title, description, fields, footer, thumbnail, image, url } };
}

/** Render a list with a cap and a "+N more" tail. */
function listLines(items, fmt, max = 15) {
  if (!items.length) return '_none_';
  const lines = items.slice(0, max).map(fmt);
  if (items.length > max) lines.push(`… and ${fmtNum(items.length - max)} more`);
  return truncate(lines.join('\n'), 3900);
}

function needGuild(ctx) {
  if (!ctx.guild) throw new UserError('This command can only be used inside a server.');
  return ctx.guild;
}

/** Resolve a GuildMember for a user argument or fail with a friendly message. */
async function requireMember(ctx, user) {
  needGuild(ctx);
  const m = await ctx.getMember(user);
  if (!m) throw new UserError(`${user.username || user.id} is not a member of this server.`);
  return m;
}

/** Hierarchy + self/owner/bot protection for moderation on a member. */
function assertCanModerate(ctx, targetMember) {
  const r = canModerate({ guild: ctx.guild, actor: ctx.member, target: targetMember, me: ctx.guild.members.me });
  if (!r.ok) throw new UserError(r.reason);
}
/** Protection checks that also work for non-members (e.g. ban by ID). */
function assertNotProtected(ctx, user) {
  const r = canModerate({ guild: ctx.guild, actor: ctx.member, target: { id: user.id }, me: ctx.guild.members.me });
  if (!r.ok && !/role is equal/.test(r.reason)) throw new UserError(r.reason);
}

function assertRoleManageable(ctx, role) {
  const me = ctx.guild.members.me;
  if (role.managed) throw new UserError('That role is managed by an integration and cannot be assigned manually.');
  if (role.id === ctx.guild.id) throw new UserError('That is the @everyone role.');
  if (me && role.position >= me.roles.highest.position) throw new UserError('That role is above my highest role.');
  if (ctx.member && ctx.guild.ownerId !== ctx.member.id && role.position >= ctx.member.roles.highest.position) throw new UserError('That role is above your highest role.');
}

/** Persist a moderation case, optionally DM the target (only when the server enabled it), and log. */
async function recordCase(ctx, { type, user, reason, durationSecs = null }) {
  const c = ctx.svc.moderation.createCase({ guildId: ctx.guildId, type, targetId: user.id, moderatorId: ctx.user.id, reason, durationSecs });
  if (ctx.svc.settings.get(ctx.guildId, 'mod_dm_on_action')) {
    await ctx.svc.dm(user.id, { content: `You received a **${type}** in **${ctx.guild.name}**${reason ? `: ${reason}` : ''}.` });
  }
  await ctx.svc.logEvent(ctx.guildId, 'mod', { color: COLORS.AMBER, title: `Case #${c.case_no} • ${type}`, description: `Target: ${user.username || user.id} (${user.id})\nModerator: ${ctx.user.username || ctx.user.id}\nReason: ${reason || 'none'}` });
  return c;
}
const reasonOpt = { name: 'reason', type: 'string', description: 'Reason for the action', maxLength: 400, rest: true };
const userOpt = (description = 'The user') => ({ name: 'user', type: 'user', description, required: true });

/** Truthy "ok" reply with a check mark. */
const ok = (msg) => `✅ ${msg}`;

/** Parse a #hex colour. */
function parseColor(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) throw new UserError('Colour must be a 6-digit hex value such as `#00e5ff`.');
  return parseInt(m[1], 16);
}

/** The text channel to treat as a "target" argument: given channel or the current one. */
function textTarget(ctx, ch) {
  const c = ch || ctx.channel;
  if (!c) throw new UserError('Channel not available.');
  return c;
}

function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }

function percent(n, d) { return d ? Math.round((n / d) * 100) : 0; }

module.exports = { colorOf, embed, listLines, needGuild, requireMember, assertCanModerate, assertNotProtected, assertRoleManageable, recordCase, reasonOpt, userOpt, ok, parseColor, textTarget, pick, percent };

// ---------------------------------------------------------------------------
// Config-setting actions: validated, persisted, audited writes to guild settings.
// ---------------------------------------------------------------------------
const { SCHEMA } = require('../services/settings');

function show(v) {
  if (v === null || v === undefined || v === '') return '_not set_';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '_empty_';
  return String(v);
}

/**
 * Register an admin action that sets one guild setting.
 * kind: bool | int | enum | channel | role | text | duration
 */
function configAction(g, sub, { description, key, kind, perms = ['ManageGuild'], label, aliases, textChannelsOnly = true, formatValue, subgroup }) {
  const def = SCHEMA[key];
  if (!def) throw new Error(`configAction: unknown setting ${key}`);
  const name = label || key;
  const options = [];
  if (kind === 'bool') options.push({ name: 'enabled', type: 'boolean', description: 'on or off', required: true });
  else if (kind === 'int') options.push({ name: 'value', type: 'integer', description: `${def.min} to ${def.max}`, required: true, min: def.min, max: def.max });
  else if (kind === 'duration') options.push({ name: 'value', type: 'duration', description: 'e.g. 30s, 5m, 1h', required: true, min: def.min, max: def.max });
  else if (kind === 'enum') options.push({ name: 'value', type: 'string', description: def.values.join(' | '), required: true, choices: def.values });
  else if (kind === 'channel') options.push({ name: 'channel', type: 'channel', description: 'Channel (omit to clear)' });
  else if (kind === 'role') options.push({ name: 'role', type: 'role', description: 'Role (omit to clear)' });
  else if (kind === 'text') options.push({ name: 'text', type: 'string', description: 'The text', required: true, maxLength: Math.min(def.max || 500, 1500), rest: true });
  else throw new Error(`bad kind ${kind}`);
  return g.action(sub, { description, access: 'admin', guildOnly: true, perms, options, aliases, subgroup }, (ctx) => {
    let v;
    if (kind === 'bool') v = ctx.args.enabled;
    else if (kind === 'int' || kind === 'duration' || kind === 'enum') v = ctx.args.value;
    else if (kind === 'text') v = ctx.args.text;
    else if (kind === 'channel') {
      const c = ctx.args.channel;
      if (c && textChannelsOnly && ![0, 5, 15].includes(c.type)) throw new UserError('Pick a text channel.');
      if (c && c.guild && c.guild.id !== ctx.guildId) throw new UserError('That channel is not in this server.');
      v = c ? c.id : null;
    } else if (kind === 'role') {
      const r = ctx.args.role;
      if (r && r.id === ctx.guildId) throw new UserError('@everyone cannot be used here.');
      v = r ? r.id : null;
    }
    const saved = ctx.svc.settings.set(ctx.guildId, key, v);
    const shown = formatValue ? formatValue(saved) : kind === 'channel' ? (saved ? `<#${saved}>` : null) : kind === 'role' ? (saved ? `<@&${saved}>` : null) : saved;
    return ok(`**${name}** is now ${show(shown)}.`);
  });
}

/** Register add/remove actions for a list setting of IDs or strings. */
function listActions(g, { key, noun, addSub, removeSub, listSub, perms = ['ManageGuild'], type = 'string', optName = 'value', normalize = (x) => x, describeItem = (x) => x, desc }) {
  const typeOpt = { name: optName, type, description: desc || noun, required: true, ...(type === 'string' ? { maxLength: 100, rest: true } : {}) };
  const idOf = (v) => (v && typeof v === 'object' ? v.id : normalize(String(v)));
  if (addSub) g.action(addSub, { description: `Add to: ${noun}`, access: 'admin', guildOnly: true, perms, options: [typeOpt] }, (ctx) => {
    const id = idOf(ctx.args[optName]);
    const list = ctx.svc.settings.get(ctx.guildId, key);
    if (list.includes(id)) throw new UserError('Already in the list.');
    ctx.svc.settings.addTo(ctx.guildId, key, id);
    return ok(`Added **${describeItem(ctx.args[optName])}** (${list.length + 1} total).`);
  });
  if (removeSub) g.action(removeSub, { description: `Remove from: ${noun}`, access: 'admin', guildOnly: true, perms, options: [typeOpt] }, (ctx) => {
    const id = idOf(ctx.args[optName]);
    const list = ctx.svc.settings.get(ctx.guildId, key);
    if (!list.includes(id)) throw new UserError('That entry is not in the list.');
    ctx.svc.settings.removeFrom(ctx.guildId, key, id);
    return ok(`Removed **${describeItem(ctx.args[optName])}**.`);
  });
  if (listSub) g.action(listSub, { description: `Show: ${noun}`, access: 'admin', guildOnly: true, perms, ephemeral: true }, (ctx) => {
    const list = ctx.svc.settings.get(ctx.guildId, key);
    return embed(ctx, { title: noun, description: listLines(list, (x) => `• ${/^\d{15,25}$/.test(x) ? `\`${x}\`` : x}`, 40) });
  });
}

module.exports.configAction = configAction;
module.exports.listActions = listActions;
module.exports.show = show;

'use strict';
const { ChannelType, PermissionsBitField } = require('discord.js');
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { truncate, safe, ts } = require('../utils/text');

const CONFIRM = { name: 'confirm', type: 'string', description: 'Type "confirm" to proceed', required: true, choices: ['confirm'] };
const chanOpt = (description = 'Channel (default: current)', required = false) => ({ name: 'channel', type: 'channel', description, required });
const roleOpt = (description = 'The role') => ({ name: 'role', type: 'role', description, required: true });
const why = (ctx, text) => truncate(`${ctx.user.username} (${ctx.user.id}): ${text}`, 512);
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

function guildChannel(ctx, ch) {
  const c = ch || ctx.channel;
  if (!c || !c.guild || c.guild.id !== ctx.guildId) throw new UserError('That channel is not in this server.');
  return c;
}

module.exports = function register(registry) {
  // ----------------------------------------------------------------- channel
  const ch = registry.group({ name: 'channel', description: 'Create and manage channels', category: 'Channels & Roles', aliases: ['ch'] });
  const C = (sub, spec, run) => ch.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageChannels'], botPerms: ['ManageChannels'], ...spec }, run);
  const setLock = (locked) => async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel);
    await c.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: locked ? false : null }, { reason: why(ctx, locked ? 'lock' : 'unlock') });
    return H.ok(`${locked ? '🔒 Locked' : '🔓 Unlocked'} **#${c.name}**.`);
  };
  C('lock', { description: 'Stop @everyone from sending messages', options: [chanOpt()] }, setLock(true));
  C('unlock', { description: 'Restore @everyone sending permission', options: [chanOpt()] }, setLock(false));
  C('slowmode', { description: 'Set channel slowmode (0 = off)', options: [{ name: 'seconds', type: 'integer', description: '0-21600', required: true, min: 0, max: 21600 }, chanOpt()] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.setRateLimitPerUser(ctx.args.seconds, why(ctx, 'slowmode'));
    return H.ok(ctx.args.seconds ? `Slowmode in **#${c.name}** set to ${ctx.args.seconds}s.` : `Slowmode disabled in **#${c.name}**.`);
  });
  const creator = (sub, type, label) => C(sub, { description: `Create a ${label}`, options: [{ name: 'name', type: 'string', description: 'Channel name', required: true, minLength: 1, maxLength: 100, rest: true }] }, async (ctx) => {
    const name = type === ChannelType.GuildText ? ctx.args.name.toLowerCase().replace(/[^a-z0-9_ -]/g, '').trim().replace(/\s+/g, '-') : ctx.args.name;
    if (!name) throw new UserError('That name has no valid characters.');
    const created = await ctx.guild.channels.create({ name, type, reason: why(ctx, `create ${label}`) });
    return H.ok(`Created ${label} **${created.name}**.`);
  });
  creator('createtext', ChannelType.GuildText, 'text channel');
  creator('createvoice', ChannelType.GuildVoice, 'voice channel');
  creator('createcategory', ChannelType.GuildCategory, 'category');
  C('delete', { description: 'Delete a channel', options: [chanOpt('Channel to delete', true), CONFIRM] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); const name = c.name;
    await c.delete(why(ctx, 'delete channel'));
    return H.ok(`Deleted channel **${name}**.`);
  });
  C('rename', { description: 'Rename a channel', options: [chanOpt('Channel', true), { name: 'name', type: 'string', description: 'New name', required: true, minLength: 1, maxLength: 100, rest: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.setName(ctx.args.name, why(ctx, 'rename')); return H.ok(`Renamed to **${ctx.args.name}**.`);
  });
  C('topic', { description: 'Set the channel topic', options: [chanOpt('Channel', true), { name: 'topic', type: 'string', description: 'New topic', required: true, maxLength: 1024, rest: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.setTopic(ctx.args.topic, why(ctx, 'topic')); return H.ok('Topic updated.');
  });
  C('nsfw', { description: 'Toggle the age-restricted flag', options: [{ name: 'enabled', type: 'boolean', description: 'on/off', required: true }, chanOpt()] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.setNSFW(ctx.args.enabled, why(ctx, 'nsfw')); return H.ok(`NSFW ${ctx.args.enabled ? 'enabled' : 'disabled'} for **#${c.name}**.`);
  });
  C('clone', { description: 'Duplicate a channel with its settings', options: [chanOpt('Channel', true)] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); const n = await c.clone({ reason: why(ctx, 'clone') }); return H.ok(`Cloned as **${n.name}**.`);
  });
  C('move', { description: 'Change a channel position', options: [chanOpt('Channel', true), { name: 'position', type: 'integer', description: 'New position', required: true, min: 0, max: 500 }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.setPosition(ctx.args.position); return H.ok(`Moved **#${c.name}** to position ${ctx.args.position}.`);
  });
  C('setcategory', { description: 'Move a channel into a category', options: [chanOpt('Channel', true), { name: 'category', type: 'channel', description: 'Category channel', required: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel);
    if (ctx.args.category.type !== ChannelType.GuildCategory) throw new UserError('Target must be a category.');
    await c.setParent(ctx.args.category, { lockPermissions: false }); return H.ok(`Moved **#${c.name}** into **${ctx.args.category.name}**.`);
  });
  const vis = (hide) => async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel);
    await c.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: hide ? false : null }, { reason: why(ctx, hide ? 'hide' : 'unhide') });
    return H.ok(`**#${c.name}** is now ${hide ? 'hidden from' : 'visible to'} @everyone.`);
  };
  C('hide', { description: 'Hide a channel from @everyone', options: [chanOpt()] }, vis(true));
  C('unhide', { description: 'Make a channel visible again', options: [chanOpt()] }, vis(false));

  // -------------------------------------------------------------------- role
  const rl = registry.group({ name: 'role', description: 'Create and manage roles', category: 'Channels & Roles', aliases: ['roles-admin'] });
  const R = (sub, spec, run) => rl.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageRoles'], botPerms: ['ManageRoles'], ...spec }, run);
  R('create', { description: 'Create a role', options: [{ name: 'name', type: 'string', description: 'Role name', required: true, minLength: 1, maxLength: 100 }, { name: 'color', type: 'string', description: 'Hex colour such as #ff8800' }] }, async (ctx) => {
    const r = await ctx.guild.roles.create({ name: ctx.args.name, color: ctx.args.color ? H.parseColor(ctx.args.color) : undefined, reason: why(ctx, 'create role'), permissions: [] });
    return H.ok(`Created role **${r.name}**.`);
  });
  R('delete', { description: 'Delete a role', options: [roleOpt('Role to delete'), CONFIRM] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role); const n = ctx.args.role.name; await ctx.args.role.delete(why(ctx, 'delete role')); return H.ok(`Deleted role **${n}**.`);
  });
  R('rename', { description: 'Rename a role', options: [roleOpt(), { name: 'name', type: 'string', description: 'New name', required: true, minLength: 1, maxLength: 100, rest: true }] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role); await ctx.args.role.setName(ctx.args.name, why(ctx, 'rename')); return H.ok(`Renamed to **${ctx.args.name}**.`);
  });
  R('color', { description: 'Change a role colour', options: [roleOpt(), { name: 'color', type: 'string', description: 'Hex colour', required: true, maxLength: 7 }] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role); await ctx.args.role.setColor(H.parseColor(ctx.args.color), why(ctx, 'colour')); return H.ok('Colour updated.');
  });
  R('hoist', { description: 'Show a role separately in the member list', options: [roleOpt(), { name: 'enabled', type: 'boolean', description: 'on/off', required: true }] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role); await ctx.args.role.setHoist(ctx.args.enabled); return H.ok(`Hoist ${ctx.args.enabled ? 'on' : 'off'}.`);
  });
  R('give', { description: 'Give a role to a member', options: [H.userOpt('Member'), roleOpt()] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    const m = await H.requireMember(ctx, ctx.args.user); await m.roles.add(ctx.args.role, why(ctx, 'role give'));
    return H.ok(`Gave **${ctx.args.role.name}** to **${m.displayName}**.`);
  });
  R('take', { description: 'Remove a role from a member', options: [H.userOpt('Member'), roleOpt()] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    const m = await H.requireMember(ctx, ctx.args.user); await m.roles.remove(ctx.args.role, why(ctx, 'role take'));
    return H.ok(`Removed **${ctx.args.role.name}** from **${m.displayName}**.`);
  });
  const bulk = (give) => async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    const all = await ctx.guild.members.fetch();
    const list = [...all.values()].filter((m) => !m.user.bot && (give ? !m.roles.cache.has(ctx.args.role.id) : m.roles.cache.has(ctx.args.role.id)));
    if (list.length > 200) throw new UserError(`That would affect ${list.length} members; the limit is 200 per run.`);
    let n = 0;
    for (const m of list) { try { if (give) await m.roles.add(ctx.args.role); else await m.roles.remove(ctx.args.role); n++; } catch { /* skip */ } }
    return H.ok(`${give ? 'Added' : 'Removed'} **${ctx.args.role.name}** for ${n} member(s).`);
  };
  R('giveall', { description: 'Give a role to every human member (max 200)', cooldown: 30, options: [roleOpt(), CONFIRM] }, bulk(true));
  R('takeall', { description: 'Remove a role from all members (max 200)', cooldown: 30, options: [roleOpt(), CONFIRM] }, bulk(false));
  R('clone', { description: 'Duplicate a role', options: [roleOpt()] }, async (ctx) => {
    const r = ctx.args.role; const n = await ctx.guild.roles.create({ name: `${r.name} copy`.slice(0, 100), color: r.color, hoist: r.hoist, permissions: r.permissions, reason: why(ctx, 'clone') });
    return H.ok(`Cloned as **${n.name}**.`);
  });
  R('position', { description: 'Move a role to a position', options: [roleOpt(), { name: 'position', type: 'integer', description: 'New position', required: true, min: 1, max: 250 }] }, async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    const me = ctx.guild.members.me;
    if (ctx.args.position >= me.roles.highest.position) throw new UserError('Position must be below my highest role.');
    await ctx.args.role.setPosition(ctx.args.position); return H.ok(`Moved to position ${ctx.args.position}.`);
  });
  const permChange = (add) => async (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    const flag = Object.keys(PermissionsBitField.Flags).find((f) => f.toLowerCase() === ctx.args.permission.toLowerCase());
    if (!flag) throw new UserError('Unknown permission name (use the Discord permission name, e.g. `ManageMessages`).');
    if (!ctx.member.permissions.has(flag)) throw new UserError('You cannot grant or revoke a permission you do not have yourself.');
    const next = new PermissionsBitField(ctx.args.role.permissions);
    if (add) next.add(flag); else next.remove(flag);
    await ctx.args.role.setPermissions(next, why(ctx, `${add ? 'add' : 'remove'} ${flag}`));
    return H.ok(`${add ? 'Granted' : 'Revoked'} **${flag}** ${add ? 'to' : 'from'} **${ctx.args.role.name}**.`);
  };
  R('permadd', { description: 'Grant a permission to a role', options: [roleOpt(), { name: 'permission', type: 'string', description: 'Permission name, e.g. ManageMessages', required: true, maxLength: 40 }] }, permChange(true));
  R('permremove', { description: 'Revoke a permission from a role', options: [roleOpt(), { name: 'permission', type: 'string', description: 'Permission name', required: true, maxLength: 40 }] }, permChange(false));
  R('members', { description: 'List members that have a role', options: [roleOpt()] }, async (ctx) => {
    const all = await ctx.guild.members.fetch();
    const list = [...all.values()].filter((m) => m.roles.cache.has(ctx.args.role.id));
    return H.embed(ctx, { title: `Members with ${ctx.args.role.name} (${list.length})`, description: H.listLines(list, (m) => `• ${safe(m.displayName)} (${m.id})`, 30) });
  });

  // ------------------------------------------------------------------ server
  const sv = registry.group({ name: 'server', description: 'Server management utilities', category: 'Server Management', aliases: ['srv'] });
  const S = (sub, spec, run) => sv.action(sub, { access: 'admin', guildOnly: true, ...spec }, run);
  S('rename', { description: 'Rename the server', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [{ name: 'name', type: 'string', description: 'New server name', required: true, minLength: 2, maxLength: 100, rest: true }] }, async (ctx) => { await ctx.guild.setName(ctx.args.name, why(ctx, 'rename server')); return H.ok(`Server renamed to **${ctx.args.name}**.`); });
  S('say', { description: 'Make the bot send a plain message', perms: ['ManageMessages'], options: [chanOpt('Channel', true), { name: 'text', type: 'string', description: 'Message text', required: true, maxLength: 1800, rest: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.send({ content: safe(ctx.args.text), allowedMentions: { parse: [] } }); return H.ok(`Sent to **#${c.name}**.`);
  });
  S('embed', { description: 'Send an embed as the bot', perms: ['ManageMessages'], options: [chanOpt('Channel', true), { name: 'title', type: 'string', description: 'Embed title', required: true, maxLength: 200 }, { name: 'text', type: 'string', description: 'Embed text', required: true, maxLength: 3500, rest: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.send({ embeds: [{ color: H.colorOf(ctx), title: safe(ctx.args.title), description: safe(ctx.args.text) }], allowedMentions: { parse: [] } }); return H.ok(`Embed sent to **#${c.name}**.`);
  });
  S('announce', { description: 'Post an announcement embed', perms: ['ManageGuild'], options: [chanOpt('Channel', true), { name: 'text', type: 'string', description: 'Announcement text', required: true, maxLength: 3500, rest: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); await c.send({ embeds: [{ color: 0x8a4dff, title: '📢 Announcement', description: safe(ctx.args.text), footer: { text: `By ${ctx.user.username}` } }], allowedMentions: { parse: [] } }); return H.ok('Announcement posted.');
  });
  S('emojiadd', { description: 'Add a custom emoji from a Discord emoji or CDN URL', perms: ['ManageGuildExpressions'], botPerms: ['ManageGuildExpressions'], options: [{ name: 'emoji', type: 'string', description: 'A custom emoji or https://cdn.discordapp.com URL', required: true, maxLength: 300 }, { name: 'name', type: 'string', description: 'Emoji name (2-32 chars)', required: true, minLength: 2, maxLength: 32, pattern: /^\w+$/, patternHelp: 'letters, digits and underscores only' }] }, async (ctx) => {
    let url; const m = /<(a?):\w+:(\d+)>/.exec(ctx.args.emoji);
    if (m) url = `https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? 'gif' : 'png'}`;
    else { try { const u = new URL(ctx.args.emoji); if (u.protocol !== 'https:' || !CDN_HOSTS.has(u.hostname)) throw new Error(); url = u.href; } catch { throw new UserError('Provide a custom emoji or an https://cdn.discordapp.com URL.'); } }
    const e = await ctx.guild.emojis.create({ attachment: url, name: ctx.args.name, reason: why(ctx, 'emojiadd') }); return H.ok(`Added emoji **${e.name}**.`);
  });
  S('emojiremove', { description: 'Delete a custom emoji by name', perms: ['ManageGuildExpressions'], botPerms: ['ManageGuildExpressions'], options: [{ name: 'name', type: 'string', description: 'Emoji name', required: true, maxLength: 32 }] }, async (ctx) => {
    const e = [...ctx.guild.emojis.cache.values()].find((x) => x.name === ctx.args.name); if (!e) throw new UserError('No emoji with that name.');
    await e.delete(why(ctx, 'emojiremove')); return H.ok(`Deleted emoji **${ctx.args.name}**.`);
  });
  S('systemchannel', { description: 'Set the system messages channel', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [chanOpt('Text channel', true)] }, async (ctx) => { await ctx.guild.setSystemChannel(guildChannel(ctx, ctx.args.channel), why(ctx, 'system channel')); return H.ok('System channel updated.'); });
  S('afkchannel', { description: 'Set the AFK voice channel', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [chanOpt('Voice channel', true)] }, async (ctx) => {
    if (ctx.args.channel.type !== ChannelType.GuildVoice) throw new UserError('Pick a voice channel.');
    await ctx.guild.setAFKChannel(ctx.args.channel, why(ctx, 'afk channel')); return H.ok('AFK channel updated.');
  });
  S('afktimeout', { description: 'Set the AFK timeout', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [{ name: 'seconds', type: 'integer', description: '60, 300, 900, 1800 or 3600', required: true, choices: [{ name: '1 minute', value: 60 }, { name: '5 minutes', value: 300 }, { name: '15 minutes', value: 900 }, { name: '30 minutes', value: 1800 }, { name: '1 hour', value: 3600 }] }] }, async (ctx) => {
    const v = Number(ctx.args.seconds); if (![60, 300, 900, 1800, 3600].includes(v)) throw new UserError('Choose 60, 300, 900, 1800 or 3600.');
    await ctx.guild.setAFKTimeout(v, why(ctx, 'afk timeout')); return H.ok(`AFK timeout set to ${v}s.`);
  });
  const LEVELS = { none: 0, low: 1, medium: 2, high: 3, veryhigh: 4 };
  S('verifylevel', { description: 'Set the server verification level', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [{ name: 'level', type: 'string', description: 'none, low, medium, high, veryhigh', required: true, choices: Object.keys(LEVELS) }] }, async (ctx) => { await ctx.guild.setVerificationLevel(LEVELS[ctx.args.level], why(ctx, 'verification level')); return H.ok(`Verification level: **${ctx.args.level}**.`); });
  S('notifications', { description: 'Set default notification level', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [{ name: 'level', type: 'string', description: 'all or mentions', required: true, choices: ['all', 'mentions'] }] }, async (ctx) => { await ctx.guild.setDefaultMessageNotifications(ctx.args.level === 'all' ? 0 : 1, why(ctx, 'notifications')); return H.ok(`Default notifications: **${ctx.args.level}**.`); });
  S('contentfilter', { description: 'Set the explicit-content filter', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [{ name: 'level', type: 'string', description: 'off, no-roles or all', required: true, choices: ['off', 'no-roles', 'all'] }] }, async (ctx) => { await ctx.guild.setExplicitContentFilter({ off: 0, 'no-roles': 1, all: 2 }[ctx.args.level], why(ctx, 'content filter')); return H.ok(`Content filter: **${ctx.args.level}**.`); });
  S('prune', { description: 'Preview how many inactive members would be pruned', perms: ['KickMembers'], botPerms: ['KickMembers'], options: [{ name: 'days', type: 'integer', description: 'Inactive days (1-30)', required: true, min: 1, max: 30 }] }, async (ctx) => {
    const n = await ctx.guild.members.prune({ days: ctx.args.days, dry: true }); return `🧹 ${n} member(s) inactive for ${ctx.args.days}+ days would be removed. Use \`prune-run\` to proceed.`;
  });
  S('prune-run', { description: 'Kick members inactive for N days', perms: ['KickMembers'], botPerms: ['KickMembers'], cooldown: 60, options: [{ name: 'days', type: 'integer', description: 'Inactive days (7-30)', required: true, min: 7, max: 30 }, CONFIRM] }, async (ctx) => {
    const n = await ctx.guild.members.prune({ days: ctx.args.days, reason: why(ctx, 'prune') }); return H.ok(`Pruned ${n} member(s).`);
  });
  S('banlist', { description: 'List banned users', perms: ['BanMembers'], botPerms: ['BanMembers'] }, async (ctx) => {
    const bans = await ctx.guild.bans.fetch(); const list = [...bans.values()];
    return H.embed(ctx, { title: `Bans (${list.length})`, description: H.listLines(list, (b) => `• ${safe(b.user.username)} (\`${b.user.id}\`)${b.reason ? ` — ${truncate(safe(b.reason), 60)}` : ''}`, 25) });
  });
  S('auditlog', { description: "Show recent entries from Discord's audit log", perms: ['ViewAuditLog'], botPerms: ['ViewAuditLog'], options: [{ name: 'limit', type: 'integer', description: '1-25', min: 1, max: 25, default: 10 }] }, async (ctx) => {
    const logs = await ctx.guild.fetchAuditLogs({ limit: ctx.args.limit }); const list = [...logs.entries.values()];
    return H.embed(ctx, { title: 'Audit log', description: H.listLines(list, (e) => `• ${e.action} by ${e.executor ? safe(e.executor.username) : '?'} ${e.createdTimestamp ? ts(e.createdTimestamp / 1000) : ''}`, 25) });
  });
  S('invites', { description: 'List active invites', perms: ['ManageGuild'], botPerms: ['ManageGuild'] }, async (ctx) => {
    const inv = [...(await ctx.guild.invites.fetch()).values()];
    return H.embed(ctx, { title: `Invites (${inv.length})`, description: H.listLines(inv, (i) => `• \`${i.code}\` — ${i.uses ?? 0} uses${i.inviter ? ` — by ${safe(i.inviter.username)}` : ''}`, 25) });
  });
  S('invite-create', { description: 'Create an invite link', perms: ['CreateInstantInvite'], botPerms: ['CreateInstantInvite'], options: [chanOpt('Channel (default: current)'), { name: 'max_age', type: 'duration', description: 'Expiry (0 = never)', min: 0, max: 604800, default: 86400 }, { name: 'max_uses', type: 'integer', description: '0 = unlimited', min: 0, max: 100, default: 0 }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); const inv = await c.createInvite({ maxAge: ctx.args.max_age, maxUses: ctx.args.max_uses, unique: true, reason: why(ctx, 'invite') });
    return `🔗 ${inv.url}`;
  });
  S('invite-delete', { description: 'Delete an invite by code', perms: ['ManageGuild'], botPerms: ['ManageGuild'], options: [{ name: 'code', type: 'string', description: 'Invite code', required: true, pattern: /^[\w-]{2,32}$/, patternHelp: 'invite code only' }] }, async (ctx) => {
    const all = await ctx.guild.invites.fetch(); const inv = all.get(ctx.args.code); if (!inv) throw new UserError('No invite with that code in this server.');
    await inv.delete(why(ctx, 'invite delete')); return H.ok('Invite deleted.');
  });

  // ------------------------------------------------------------ integrations
  const ig = registry.group({ name: 'integration', description: 'Webhooks and integrations', category: 'Integrations', aliases: ['webhook'] });
  const I = (sub, spec, run) => ig.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageWebhooks'], botPerms: ['ManageWebhooks'], ...spec }, run);
  I('create', { description: 'Create a webhook in a channel', options: [chanOpt('Channel', true), { name: 'name', type: 'string', description: 'Webhook name', required: true, minLength: 1, maxLength: 80, rest: true }] }, async (ctx) => {
    const c = guildChannel(ctx, ctx.args.channel); const w = await c.createWebhook({ name: ctx.args.name, reason: why(ctx, 'webhook') });
    return { ephemeral: true, content: `✅ Webhook **${w.name}** created (ID \`${w.id}\`). The URL is intentionally not shown; manage it in Server Settings → Integrations.` };
  });
  I('list', { description: 'List webhooks (names and IDs only)' }, async (ctx) => {
    const list = [...(await ctx.guild.fetchWebhooks()).values()];
    return { ephemeral: true, ...H.embed(ctx, { title: `Webhooks (${list.length})`, description: H.listLines(list, (w) => `• ${safe(w.name)} — \`${w.id}\``, 25) }) };
  });
  I('delete', { description: 'Delete a webhook by ID', options: [{ name: 'id', type: 'string', description: 'Webhook ID', required: true, pattern: /^\d{15,25}$/, patternHelp: 'numeric webhook ID' }] }, async (ctx) => {
    const w = (await ctx.guild.fetchWebhooks()).get(ctx.args.id); if (!w) throw new UserError('No webhook with that ID in this server.');
    await w.delete(why(ctx, 'webhook delete')); return H.ok('Webhook deleted.');
  });
  I('send', { description: 'Send a message through a webhook', options: [{ name: 'id', type: 'string', description: 'Webhook ID', required: true, pattern: /^\d{15,25}$/, patternHelp: 'numeric webhook ID' }, { name: 'text', type: 'string', description: 'Message', required: true, maxLength: 1800, rest: true }] }, async (ctx) => {
    const w = (await ctx.guild.fetchWebhooks()).get(ctx.args.id); if (!w) throw new UserError('No webhook with that ID in this server.');
    await w.send({ content: safe(ctx.args.text), allowedMentions: { parse: [] } }); return H.ok('Sent.');
  });
  I('rename', { description: 'Rename a webhook', options: [{ name: 'id', type: 'string', description: 'Webhook ID', required: true, pattern: /^\d{15,25}$/, patternHelp: 'numeric webhook ID' }, { name: 'name', type: 'string', description: 'New name', required: true, minLength: 1, maxLength: 80, rest: true }] }, async (ctx) => {
    const w = (await ctx.guild.fetchWebhooks()).get(ctx.args.id); if (!w) throw new UserError('No webhook with that ID in this server.');
    await w.edit({ name: ctx.args.name }); return H.ok('Webhook renamed.');
  });
};

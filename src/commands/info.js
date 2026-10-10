'use strict';
const { embed, listLines, needGuild, requireMember } = require('./_helpers');
const { UserError } = require('../core/errors');
const { fmtNum, ts } = require('../utils/text');

const DISCORD_EPOCH = 1420070400000n;
const snowflakeMs = (id) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
const snowflakeSecs = (id) => Math.floor(snowflakeMs(id) / 1000);

module.exports = function register(registry) {
  // ------------------------------------------------------------------ guild
  const g = registry.group({ name: 'guild', description: 'Information about this server', category: 'Server & User Info', aliases: ['server-info', 'si'] });
  const G = (sub, spec, run) => g.action(sub, { guildOnly: true, ...spec }, run);

  G('info', { description: 'Overview of this server', aliases: ['serverinfo'] }, (ctx) => {
    const s = needGuild(ctx);
    return embed(ctx, { title: s.name, thumbnail: s.iconURL ? s.iconURL() : undefined, fields: [
      { name: 'ID', value: s.id, inline: true }, { name: 'Owner ID', value: s.ownerId, inline: true },
      { name: 'Members', value: fmtNum(s.memberCount), inline: true }, { name: 'Channels', value: fmtNum(s.channels.cache.size), inline: true },
      { name: 'Roles', value: fmtNum(s.roles.cache.size), inline: true }, { name: 'Boost tier', value: String(s.premiumTier ?? 0), inline: true },
      { name: 'Created', value: ts(snowflakeSecs(s.id), 'F'), inline: false } ] });
  });
  G('icon', { description: 'Show the server icon' }, (ctx) => {
    const url = ctx.guild.iconURL && ctx.guild.iconURL({ size: 1024 });
    if (!url) throw new UserError('This server has no icon.');
    return embed(ctx, { title: `${ctx.guild.name} icon`, image: url });
  });
  G('banner', { description: 'Show the server banner' }, (ctx) => {
    const url = ctx.guild.bannerURL && ctx.guild.bannerURL({ size: 1024 });
    if (!url) throw new UserError('This server has no banner.');
    return embed(ctx, { title: `${ctx.guild.name} banner`, image: url });
  });
  G('roles', { description: 'List the server roles' }, (ctx) => {
    const roles = [...ctx.guild.roles.cache.values()].filter((r) => r.id !== ctx.guild.id).sort((a, b) => b.position - a.position);
    return embed(ctx, { title: `Roles (${roles.length})`, description: listLines(roles, (r) => `• ${r.name} — ${r.members ? r.members.size : 0} members`, 30) });
  });
  G('channels', { description: 'List the server channels' }, (ctx) => {
    const chans = [...ctx.guild.channels.cache.values()].sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));
    return embed(ctx, { title: `Channels (${chans.length})`, description: listLines(chans, (c) => `• ${c.name} (${c.type})`, 30) });
  });
  G('emojis', { description: 'List the custom emojis' }, (ctx) => {
    const em = [...ctx.guild.emojis.cache.values()];
    return embed(ctx, { title: `Emojis (${em.length})`, description: em.length ? em.slice(0, 40).map((e) => e.toString()).join(' ') : '_none_' });
  });
  G('membercount', { description: 'Member count of the server', aliases: ['members'] }, (ctx) => `👥 **${fmtNum(ctx.guild.memberCount)}** members in ${ctx.guild.name}`);
  G('boosts', { description: 'Server boost status' }, (ctx) => `🚀 Tier **${ctx.guild.premiumTier ?? 0}** with **${ctx.guild.premiumSubscriptionCount ?? 0}** boosts`);
  G('age', { description: 'When this server was created' }, (ctx) => `🎂 ${ctx.guild.name} was created ${ts(snowflakeSecs(ctx.guild.id), 'F')} (${ts(snowflakeSecs(ctx.guild.id))})`);
  G('stickers', { description: 'List the custom stickers' }, (ctx) => {
    const st = [...(ctx.guild.stickers ? ctx.guild.stickers.cache.values() : [])];
    return embed(ctx, { title: `Stickers (${st.length})`, description: listLines(st, (s) => `• ${s.name}`, 30) });
  });
  G('roleinfo', { description: 'Details about a role', options: [{ name: 'role', type: 'role', description: 'The role', required: true }] }, (ctx) => {
    const r = ctx.args.role;
    return embed(ctx, { title: `Role: ${r.name}`, fields: [
      { name: 'ID', value: r.id, inline: true }, { name: 'Colour', value: r.hexColor || 'none', inline: true },
      { name: 'Position', value: String(r.position), inline: true }, { name: 'Members', value: String(r.members ? r.members.size : '?'), inline: true },
      { name: 'Hoisted', value: r.hoist ? 'yes' : 'no', inline: true }, { name: 'Mentionable', value: r.mentionable ? 'yes' : 'no', inline: true },
      { name: 'Created', value: ts(snowflakeSecs(r.id), 'F') } ] });
  });
  G('channelinfo', { description: 'Details about a channel', options: [{ name: 'channel', type: 'channel', description: 'The channel (default: current)' }] }, (ctx) => {
    const c = ctx.args.channel || ctx.channel;
    return embed(ctx, { title: `Channel: ${c.name}`, fields: [
      { name: 'ID', value: c.id, inline: true }, { name: 'Type', value: String(c.type), inline: true },
      { name: 'Topic', value: c.topic || 'none' }, { name: 'Created', value: ts(snowflakeSecs(c.id), 'F') } ] });
  });
  G('emojiinfo', { description: 'Details about a custom emoji', options: [{ name: 'emoji', type: 'string', description: 'A custom emoji', required: true, maxLength: 64 }] }, (ctx) => {
    const m = /<(a?):(\w+):(\d+)>/.exec(ctx.args.emoji);
    if (!m) throw new UserError('Provide a custom emoji like `<:name:123456789012345678>`.');
    return embed(ctx, { title: `:${m[2]}:`, description: `ID: ${m[3]}\nAnimated: ${m[1] ? 'yes' : 'no'}\nCreated ${ts(snowflakeSecs(m[3]), 'F')}`, image: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}?size=256` });
  });
  G('owner', { description: 'Show who owns the server' }, async (ctx) => {
    const m = await ctx.getMember({ id: ctx.guild.ownerId });
    return `👑 Owner: **${m ? m.displayName : ctx.guild.ownerId}** (${ctx.guild.ownerId})`;
  });
  G('features', { description: 'Show enabled server features' }, (ctx) => embed(ctx, { title: 'Server features', description: (ctx.guild.features || []).length ? ctx.guild.features.map((f) => `• ${f}`).join('\n') : '_No special features_' }));

  // ------------------------------------------------------------------- user
  const u = registry.group({ name: 'user', description: 'Information about users', category: 'Server & User Info', aliases: ['u'] });
  const optUser = { name: 'user', type: 'user', description: 'The user (default: you)' };

  const target = (ctx) => ctx.args.user || ctx.user;
  u.action('info', { description: 'Show information about a user', options: [optUser], aliases: ['userinfo', 'whois'] }, async (ctx) => {
    const usr = target(ctx); const m = ctx.guild ? await ctx.getMember(usr) : null;
    const fields = [
      { name: 'ID', value: usr.id, inline: true }, { name: 'Bot', value: usr.bot ? 'yes' : 'no', inline: true },
      { name: 'Account created', value: ts(snowflakeSecs(usr.id), 'F') },
    ];
    if (m) {
      fields.push({ name: 'Joined server', value: m.joinedTimestamp ? ts(m.joinedTimestamp / 1000, 'F') : 'unknown' });
      fields.push({ name: 'Top role', value: m.roles && m.roles.highest ? m.roles.highest.name : 'none', inline: true });
    }
    return embed(ctx, { title: m && m.displayName ? m.displayName : usr.username, thumbnail: usr.displayAvatarURL ? usr.displayAvatarURL({ size: 256 }) : undefined, fields });
  });
  u.action('avatar', { description: 'Show a user avatar', options: [optUser], aliases: ['av', 'pfp'] }, (ctx) => {
    const usr = target(ctx);
    return embed(ctx, { title: `${usr.username}'s avatar`, image: usr.displayAvatarURL ? usr.displayAvatarURL({ size: 1024 }) : undefined });
  });
  u.action('banner', { description: 'Show a user profile banner', options: [optUser] }, async (ctx) => {
    let usr = target(ctx);
    if (usr.fetch) usr = await usr.fetch(true);
    const url = usr.bannerURL && usr.bannerURL({ size: 1024 });
    if (!url) throw new UserError('That user has no banner.');
    return embed(ctx, { title: `${usr.username}'s banner`, image: url });
  });
  u.action('roles', { description: "List a member's roles", options: [optUser], guildOnly: true }, async (ctx) => {
    const m = await requireMember(ctx, target(ctx));
    const roles = [...m.roles.cache.values()].filter((r) => r.id !== ctx.guild.id);
    return embed(ctx, { title: `Roles of ${m.displayName}`, description: listLines(roles, (r) => `• ${r.name}`, 30) });
  });
  u.action('joined', { description: 'When a member joined this server', options: [optUser], guildOnly: true }, async (ctx) => {
    const m = await requireMember(ctx, target(ctx));
    return `📥 ${m.displayName} joined ${m.joinedTimestamp ? `${ts(m.joinedTimestamp / 1000, 'F')} (${ts(m.joinedTimestamp / 1000)})` : 'at an unknown time'}`;
  });
  u.action('age', { description: 'Account age of a user', options: [optUser] }, (ctx) => {
    const usr = target(ctx); const s = snowflakeSecs(usr.id);
    return `🎂 ${usr.username}'s account was created ${ts(s, 'F')} (${ts(s)})`;
  });
  u.action('perms', { description: "Show a member's key permissions", options: [optUser], guildOnly: true }, async (ctx) => {
    const m = await requireMember(ctx, target(ctx));
    const names = Object.keys(require('discord.js').PermissionsBitField.Flags).filter((p) => m.permissions.has(p));
    return embed(ctx, { title: `Permissions of ${m.displayName}`, description: m.permissions.has('Administrator') ? '**Administrator** (all permissions)' : listLines(names, (n) => `• ${n}`, 30) });
  });
  u.action('badges', { description: 'Show public Discord badges', options: [optUser] }, async (ctx) => {
    let usr = target(ctx);
    if (usr.fetchFlags) { const f = await usr.fetchFlags(); const arr = f.toArray(); return `🏅 ${usr.username}: ${arr.length ? arr.join(', ') : 'no public badges'}`; }
    return `🏅 ${usr.username}: no public badges`;
  });
  u.action('compare', { description: 'Compare two accounts by age', options: [{ name: 'user', type: 'user', description: 'First user', required: true }, { name: 'other', type: 'user', description: 'Second user (default: you)' }] }, (ctx) => {
    const a = ctx.args.user; const b = ctx.args.other || ctx.user;
    const da = snowflakeMs(a.id); const db = snowflakeMs(b.id);
    const older = da <= db ? a : b;
    return `📊 ${a.username}: ${ts(da / 1000, 'D')}\n${b.username}: ${ts(db / 1000, 'D')}\n**${older.username}** has the older account.`;
  });
  u.action('id', { description: 'Show a user ID and its creation time', options: [optUser] }, (ctx) => `🆔 ${target(ctx).username}: \`${target(ctx).id}\``);

  registry.standalone('userinfo', 'user.info');
  registry.standalone('serverinfo', 'guild.info');
  registry.standalone('avatar', 'user.avatar');
};
module.exports.snowflakeMs = snowflakeMs;

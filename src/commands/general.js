'use strict';
const os = require('node:os');
const { PermissionsBitField } = require('discord.js');
const { IDENTITY } = require('../constants');
const branding = require('../utils/branding');
const { embed, listLines } = require('./_helpers');
const { UserError } = require('../core/errors');
const { formatDuration, fmtNum, titleCase } = require('../utils/text');

const INVITE_PERMS = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis', 'Connect', 'Speak', 'ManageMessages', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames', 'CreateInstantInvite', 'ManageWebhooks'];

module.exports = function register(registry) {
  const g = registry.group({ name: 'general', description: 'Bot information and basic utilities', category: 'General', aliases: ['bot'] });

  g.action('ping', { description: 'Check the bot latency', aliases: ['pong'], cooldown: 3 }, (ctx) => {
    const ws = ctx.client && ctx.client.ws ? Math.round(ctx.client.ws.ping) : -1;
    return `🏓 Pong! Gateway latency: **${ws >= 0 ? `${ws}ms` : 'n/a'}**`;
  });

  g.action('about', { description: 'About this bot and its creator', aliases: ['info'] }, (ctx) => {
    const { svc } = ctx;
    return { embed: branding.aboutEmbed({ botName: svc.bot.name, version: svc.bot.version, stats: {
      Servers: ctx.client && ctx.client.guilds ? ctx.client.guilds.cache.size : 0,
      Actions: svc.registry.all().length,
      Prefix: ctx.guildId ? svc.settings.get(ctx.guildId, 'prefix') : '!',
    } }) };
  });

  g.action('help', { description: 'Show help for commands and categories', aliases: ['h', 'commands-help'], options: [{ name: 'query', type: 'string', description: 'A category, command group or command', maxLength: 60, rest: true }] }, (ctx) => {
    const { svc, args } = ctx;
    const prefix = ctx.guildId ? svc.settings.get(ctx.guildId, 'prefix') : '!';
    const reg = svc.registry;
    const base = { botName: svc.bot.name, prefix };
    if (!args.query) {
      const cats = new Map();
      for (const grp of reg.groups.values()) cats.set(grp.category, [...(cats.get(grp.category) || []), grp]);
      const e = branding.helpEmbed(base);
      e.fields = [...cats].map(([cat, groups]) => ({ name: `${cat} (${groups.reduce((n, x) => n + x.actions.length, 0)})`, value: groups.map((x) => `\`${x.name}\``).join(' '), inline: false })).slice(0, 25);
      e.fields.push({ name: 'More help', value: `\`${prefix}help <group>\` lists a group's commands • \`${prefix}help <command>\` shows usage.\nSlash: \`/<group> <command>\`.`, inline: false });
      return { embed: e };
    }
    const q = args.query.toLowerCase().trim().replace(/^[!/]/, '');
    const words = q.split(/\s+/);
    const grp = reg.groups.get(words[0]) || [...reg.groups.values()].find((x) => x.aliases.includes(words[0]) || x.category.toLowerCase() === q);
    if (grp && !words[1]) {
      const e = branding.helpEmbed(base); e.title = `◈ ${grp.name} — ${grp.description}`;
      e.description = listLines(grp.actions, (a) => `${a.access === 'user' ? '' : '🔒 '}\`${a.usage}\` — ${a.description}`, 25);
      return { embed: e };
    }
    const hit = reg.flat.get(words[0]) || (grp && grp.actions.find((a) => a.sub === words[words.length - 1]));
    if (hit) {
      const e = branding.helpEmbed(base); e.title = `◈ ${hit.group.name} ${hit.sub}`;
      e.description = hit.description;
      e.fields = [
        { name: 'Usage', value: `\`${prefix}${hit.usage}\`\n\`/${hit.usage}\``, inline: false },
        { name: 'Access', value: hit.access === 'owner' ? 'Global Owner only' : hit.access === 'admin' ? `Admin (${hit.perms.join(', ')})` : 'Everyone', inline: true },
        { name: 'Cooldown', value: `${hit.cooldown}s`, inline: true },
        ...(hit.aliases.length ? [{ name: 'Aliases', value: hit.aliases.map((a) => `\`${prefix}${a}\``).join(' '), inline: true }] : []),
      ];
      return { embed: e };
    }
    throw new UserError(`No command or category called \`${args.query}\`. Try \`${prefix}help\`.`);
  });

  g.action('uptime', { description: 'How long the bot has been running' }, (ctx) => `⏱️ Online for **${formatDuration((Date.now() - ctx.svc.bot.startedAt) / 1000)}**`);

  g.action('invite', { description: 'Get the bot invite link', ephemeral: true }, (ctx) => {
    const id = ctx.svc.config.clientId;
    if (!id) throw new UserError('The bot client ID is not configured.');
    const perms = new PermissionsBitField(INVITE_PERMS).bitfield;
    return `🔗 https://discord.com/oauth2/authorize?client_id=${id}&permissions=${perms}&scope=bot%20applications.commands`;
  });

  g.action('botstats', { description: 'Runtime statistics for the bot', aliases: ['stats'] }, (ctx) => {
    const c = ctx.client;
    const mem = process.memoryUsage().rss / 1048576;
    return embed(ctx, { title: `${ctx.svc.bot.name} statistics`, fields: [
      { name: 'Servers', value: fmtNum(c && c.guilds ? c.guilds.cache.size : 0), inline: true },
      { name: 'Users (cached)', value: fmtNum(c && c.users ? c.users.cache.size : 0), inline: true },
      { name: 'Actions', value: fmtNum(ctx.svc.registry.all().length), inline: true },
      { name: 'Memory', value: `${mem.toFixed(1)} MB`, inline: true },
      { name: 'Node.js', value: process.version, inline: true },
      { name: 'Host', value: `${os.platform()} ${os.arch()}`, inline: true },
    ] });
  });

  g.action('changelog', { description: 'Recent changes' }, () => ({ embed: { color: 0x8a4dff, title: 'Changelog', description: `**1.0.0**\n• Initial release: 500+ actions, "/" and "!" commands, SQLite, Lavalink music, OAuth2 dashboard.\n\n${IDENTITY.ATTRIBUTION}` } }));
  g.action('version', { description: 'Show the bot version' }, (ctx) => `${ctx.svc.bot.name} v${ctx.svc.bot.version} • Node ${process.version} • discord.js ${require('discord.js').version}`);
  g.action('creator', { description: 'Show the permanent creator attribution', aliases: ['credits'] }, () => ({ embed: { color: 0x8a4dff, title: IDENTITY.SIGNATURE, description: `${IDENTITY.ATTRIBUTION}\n\`${IDENTITY.ATTRIBUTION_UPPER}\`` } }));
  g.action('privacy', { description: 'What data the bot stores' }, (ctx) => embed(ctx, { title: 'Privacy', description: 'Stored per server/user: settings, moderation cases, economy and XP balances, reminders, notes, todos, playlists and profile fields you set. Message *content* is only inspected in memory for commands, automod and XP and is not stored. Use `/prefs export` to see your data and `/prefs delete` to erase it.' }));
  g.action('source', { description: 'Link to the source repository' }, () => `📦 https://github.com/${IDENTITY.DEFAULT_REPO}`);
  g.action('commands', { description: 'Show the number of actions per category' }, (ctx) => {
    const counts = new Map();
    for (const a of ctx.svc.registry.all()) counts.set(a.category, (counts.get(a.category) || 0) + 1);
    return embed(ctx, { title: 'Actions per category', description: [...counts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `**${c}**: ${n}`).join('\n') + `\n\nTotal: **${ctx.svc.registry.all().length}**` });
  });
  g.action('prefix', { description: 'Show the command prefix for this server' }, (ctx) => `The prefix here is \`${ctx.guildId ? ctx.cfg('prefix') : '!'}\` — slash commands always work too.`);
  void titleCase;

  registry.standalone('ping', 'general.ping');
  registry.standalone('about', 'general.about');
  registry.standalone('help', 'general.help');
};

module.exports.INVITE_PERMS = INVITE_PERMS;

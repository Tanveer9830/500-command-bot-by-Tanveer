'use strict';
const fs = require('node:fs');
const H = require('./_helpers');
const { SCHEMA } = require('../services/settings');
const { UserError } = require('../core/errors');
const { fillTemplate, formatDuration, ts, safe, truncate } = require('../utils/text');
const { isGlobalOwner } = require('../security/authz');
const database = require('../database');

const CONFIRM = { name: 'confirm', type: 'string', description: 'Type "confirm" to proceed', required: true, choices: ['confirm'] };
const LOG_TYPES = ['all', 'mod', 'message', 'member', 'voice', 'server'];

function resolveCommandKey(registry, text) {
  const t = String(text).toLowerCase().trim().replace(/^[!/]/, '').replace(/\s+/g, '.');
  if (registry.groups.has(t) || registry.actions.has(t)) return t;
  const flat = registry.flat.get(t);
  if (flat) return flat.key;
  throw new UserError(`Unknown command \`${text}\`. Use a group (\`economy\`) or a command (\`economy.daily\`).`);
}

function snapshotGuild(svc, guild) {
    const g = guild.id; const d = svc.db;
    return {
      version: 1, guild: guild.name, takenAt: svc.now(),
      settings: svc.settings.stored(g),
      shop: d.prepare('SELECT name, description, price, stock, role_id, sellable FROM shop_items WHERE guild_id = ?').all(g),
      levelRewards: d.prepare('SELECT level, role_id FROM level_rewards WHERE guild_id = ?').all(g),
      autoresponders: d.prepare('SELECT trigger, response, enabled FROM autoresponders WHERE guild_id = ?').all(g),
      customCommands: d.prepare('SELECT name, response, enabled FROM custom_commands WHERE scope = ? AND deleted = 0').all(g),
      warnActions: d.prepare('SELECT threshold, action, duration FROM warn_actions WHERE guild_id = ?').all(g),
      reactionRoles: d.prepare('SELECT message_id, emoji, role_id FROM reaction_roles WHERE guild_id = ?').all(g),
      structure: { roles: [...guild.roles.cache.values()].filter((r) => r.id !== g).map((r) => ({ name: r.name, color: r.hexColor, position: r.position })), channels: [...guild.channels.cache.values()].map((c) => ({ name: c.name, type: c.type })) },
    };
  }

module.exports = function register(registry) {
  // ---------------------------------------------------------------- settings
  const st = registry.group({ name: 'settings', description: 'Server settings and configuration', category: 'Configuration', aliases: ['config', 'setting'], defaultSub: 'view' });
  const SA = (sub, spec, run) => st.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  SA('view', { description: 'Show the main server settings' }, (ctx) => H.embed(ctx, { title: 'Server settings', fields: [
    { name: 'Prefix', value: `\`${ctx.cfg('prefix')}\``, inline: true }, { name: 'Timezone', value: ctx.cfg('timezone'), inline: true }, { name: 'Embed colour', value: ctx.cfg('embed_color'), inline: true },
    { name: 'Slash only', value: H.show(ctx.cfg('slash_only')), inline: true }, { name: 'DM on mod action', value: H.show(ctx.cfg('mod_dm_on_action')), inline: true }, { name: 'Warn expiry', value: `${ctx.cfg('warn_expiry_days') || 'never'} day(s)`, inline: true },
    { name: 'Custom commands', value: ctx.cfg('custom_commands_policy'), inline: true }, { name: 'Dashboard', value: H.show(ctx.cfg('dashboard_enabled')), inline: true },
    { name: 'Changed settings', value: String(Object.keys(ctx.svc.settings.stored(ctx.guildId)).length), inline: true } ] }));
  SA('keys', { description: 'List every available setting key' }, (ctx) => H.embed(ctx, { title: 'Setting keys', description: truncate(ctx.svc.settings.keys().map((k) => `\`${k}\``).join(' '), 3900) }));
  SA('get', { description: 'Show the value of one setting', options: [{ name: 'key', type: 'string', description: 'Setting key', required: true, maxLength: 40 }] }, (ctx) => {
    if (!SCHEMA[ctx.args.key]) throw new UserError(`Unknown setting \`${ctx.args.key}\`. Use \`settings keys\`.`);
    const v = ctx.cfg(ctx.args.key);
    return `\`${ctx.args.key}\` = ${typeof v === 'object' && v !== null ? `\`${truncate(JSON.stringify(v), 900)}\`` : H.show(v)}`;
  });
  SA('set', { description: 'Set a simple (text/number/on-off) setting', options: [{ name: 'key', type: 'string', description: 'Setting key', required: true, maxLength: 40 }, { name: 'value', type: 'string', description: 'New value', required: true, maxLength: 1500, rest: true }] }, (ctx) => {
    const def = SCHEMA[ctx.args.key]; if (!def) throw new UserError(`Unknown setting \`${ctx.args.key}\`. Use \`settings keys\`.`);
    if (def.type === 'list' || def.type === 'map') throw new UserError('List/map settings have dedicated commands (automod, perms, log, welcome…).');
    let v = ctx.args.value;
    if (def.type === 'bool') { if (!/^(on|true|yes|1|off|false|no|0)$/i.test(v)) throw new UserError('Use on/off.'); v = /^(on|true|yes|1)$/i.test(v); }
    else if (def.type === 'int') { v = Number(v); }
    else if (def.type === 'string' && /^(none|null|off|clear)$/i.test(v)) v = null;
    ctx.svc.settings.set(ctx.guildId, ctx.args.key, v);
    return H.ok(`\`${ctx.args.key}\` updated.`);
  });
  SA('reset', { description: 'Reset one setting to its default', options: [{ name: 'key', type: 'string', description: 'Setting key', required: true, maxLength: 40 }] }, (ctx) => { ctx.svc.settings.reset(ctx.guildId, ctx.args.key); return H.ok(`\`${ctx.args.key}\` reset to default.`); });
  SA('resetall', { description: 'Reset ALL settings of this server', perms: ['Administrator'], options: [CONFIRM] }, (ctx) => { ctx.svc.settings.resetAll(ctx.guildId); return H.ok('All settings reset to defaults.'); });
  SA('prefix', { description: 'Set the "!" prefix for this server', options: [{ name: 'prefix', type: 'string', description: '1-5 punctuation characters', required: true, maxLength: 5 }] }, (ctx) => { ctx.svc.settings.set(ctx.guildId, 'prefix', ctx.args.prefix); return H.ok(`Prefix set to \`${ctx.args.prefix}\`. Slash commands are unaffected.`); });
  SA('timezone', { description: 'Set the server timezone (IANA name)', options: [{ name: 'timezone', type: 'string', description: 'e.g. Asia/Kolkata', required: true, maxLength: 64 }] }, (ctx) => {
    try { new Intl.DateTimeFormat('en', { timeZone: ctx.args.timezone }); } catch { throw new UserError('Unknown timezone. Use an IANA name like `Europe/London`.'); }
    ctx.svc.settings.set(ctx.guildId, 'timezone', ctx.args.timezone); return H.ok(`Timezone set to **${ctx.args.timezone}**.`);
  });
  SA('color', { description: 'Set the embed colour', options: [{ name: 'color', type: 'string', description: 'Hex colour such as #00e5ff', required: true, maxLength: 7 }] }, (ctx) => { H.parseColor(ctx.args.color); ctx.svc.settings.set(ctx.guildId, 'embed_color', `#${ctx.args.color.replace('#', '').toLowerCase()}`); return H.ok('Embed colour updated.'); });
  H.configAction(st, 'slashonly', { description: 'Only allow slash commands for members', key: 'slash_only', kind: 'bool', label: 'Slash-only mode' });
  H.configAction(st, 'moddm', { description: 'DM users when they receive a mod action', key: 'mod_dm_on_action', kind: 'bool', label: 'Moderation DMs' });
  H.configAction(st, 'warnexpiry', { description: 'Days until warnings expire (0 = never)', key: 'warn_expiry_days', kind: 'int', label: 'Warning expiry (days)' });
  H.configAction(st, 'custompolicy', { description: 'Policy for server custom commands', key: 'custom_commands_policy', kind: 'enum', label: 'Custom command policy' });
  SA('export', { description: 'Export non-default settings as JSON', ephemeral: true }, (ctx) => ({ ephemeral: true, content: 'Settings export attached.', files: [{ name: `settings-${ctx.guildId}.json`, data: JSON.stringify(ctx.svc.settings.stored(ctx.guildId), null, 2) }] }));
  SA('import', { description: 'Import settings from exported JSON text', perms: ['Administrator'], options: [CONFIRM, { name: 'json', type: 'string', description: 'JSON from settings export', required: true, maxLength: 4000, rest: true }] }, (ctx) => {
    let parsed; try { parsed = JSON.parse(ctx.args.json); } catch { throw new UserError('That is not valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UserError('Expected a JSON object.');
    const n = ctx.svc.settings.restore(ctx.guildId, parsed); return H.ok(`Imported ${n} setting(s).`);
  });

  // ------------------------------------------------------------------- perms
  const pm = registry.group({ name: 'perms', description: 'Command permission configuration', category: 'Configuration', aliases: ['permissions'] });
  const PA = (sub, spec, run) => pm.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  const cmdOpt = { name: 'command', type: 'string', description: 'Command group or group.command', required: true, maxLength: 60 };
  PA('disable', { description: 'Disable a command or group in this server', options: [cmdOpt] }, (ctx) => {
    const key = resolveCommandKey(ctx.svc.registry, ctx.args.command);
    if (['settings', 'perms', 'owner'].includes(key.split('.')[0])) throw new UserError('Configuration commands cannot be disabled.');
    ctx.svc.settings.addTo(ctx.guildId, 'disabled_commands', key); return H.ok(`\`${key}\` is now disabled here.`);
  });
  PA('enable', { description: 'Re-enable a disabled command or group', options: [cmdOpt] }, (ctx) => {
    const key = resolveCommandKey(ctx.svc.registry, ctx.args.command);
    if (!ctx.cfg('disabled_commands').includes(key)) throw new UserError('That command is not disabled.');
    ctx.svc.settings.removeFrom(ctx.guildId, 'disabled_commands', key); return H.ok(`\`${key}\` is enabled again.`);
  });
  PA('disabled', { description: 'List disabled commands' }, (ctx) => H.embed(ctx, { title: 'Disabled commands', description: H.listLines(ctx.cfg('disabled_commands'), (k) => `• \`${k}\``, 40) }));
  PA('requirerole', { description: 'Require a role to use a command (restricts only)', options: [cmdOpt, { name: 'role', type: 'role', description: 'Required role', required: true }] }, (ctx) => {
    const key = resolveCommandKey(ctx.svc.registry, ctx.args.command);
    if (['settings', 'perms', 'owner'].includes(key.split('.')[0])) throw new UserError('Configuration commands cannot be role-restricted.');
    if (ctx.args.role.id === ctx.guildId) throw new UserError('Pick a real role, not @everyone.');
    ctx.svc.settings.mapSet(ctx.guildId, 'command_roles', key, ctx.args.role.id); return H.ok(`\`${key}\` now requires **${ctx.args.role.name}** (Discord permissions still apply).`);
  });
  PA('clearrole', { description: 'Remove a command role requirement', options: [cmdOpt] }, (ctx) => {
    const key = resolveCommandKey(ctx.svc.registry, ctx.args.command);
    if (!(key in ctx.cfg('command_roles'))) throw new UserError('No role requirement on that command.');
    ctx.svc.settings.mapDel(ctx.guildId, 'command_roles', key); return H.ok('Requirement removed.');
  });
  PA('rolelist', { description: 'List command role requirements' }, (ctx) => H.embed(ctx, { title: 'Command role requirements', description: H.listLines(Object.entries(ctx.cfg('command_roles')), ([k, r]) => `• \`${k}\` → <@&${r}>`, 40) }));
  H.listActions(pm, { key: 'blocked_channels', noun: 'channels where commands are blocked', addSub: 'blockchannel', removeSub: 'unblockchannel', type: 'channel', optName: 'channel', describeItem: (c) => c.name });
  H.listActions(pm, { key: 'allowed_channels', noun: 'command-only channels (if any are set, commands work only there)', addSub: 'allowchannel-add', removeSub: 'allowchannel-remove', type: 'channel', optName: 'channel', describeItem: (c) => c.name });
  PA('clearall', { description: 'Clear every command restriction', options: [CONFIRM] }, (ctx) => { for (const k of ['disabled_commands', 'command_roles', 'blocked_channels', 'allowed_channels']) ctx.svc.settings.reset(ctx.guildId, k); return H.ok('All command restrictions cleared.'); });
  PA('check', { description: 'Show what a command requires', options: [cmdOpt] }, (ctx) => {
    const key = resolveCommandKey(ctx.svc.registry, ctx.args.command);
    const a = ctx.svc.registry.get(key);
    const lines = a ? [`Access: **${a.access}**`, `Discord permissions: ${a.perms.join(', ') || 'none'}`, `Bot permissions: ${a.botPerms.join(', ') || 'none'}`, `Cooldown: ${a.cooldown}s`] : [`Group \`${key}\`: ${ctx.svc.registry.groups.get(key).actions.length} commands`];
    lines.push(`Disabled here: ${ctx.cfg('disabled_commands').includes(key) ? 'yes' : 'no'}`, `Role requirement: ${ctx.cfg('command_roles')[key] ? `<@&${ctx.cfg('command_roles')[key]}>` : 'none'}`);
    return H.embed(ctx, { title: `Permissions for ${key}`, description: lines.join('\n') });
  });

  // --------------------------------------------------------------------- log
  const lg = registry.group({ name: 'log', description: 'Event and audit logging', category: 'Logging', aliases: ['logging'] });
  const LA = (sub, spec, run) => lg.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  const typeOpt = { name: 'type', type: 'string', description: LOG_TYPES.join(' | '), required: true, choices: LOG_TYPES };
  LA('set', { description: 'Send a log type to a channel', options: [typeOpt, { name: 'channel', type: 'channel', description: 'Log channel', required: true }] }, (ctx) => {
    if (![0, 5].includes(ctx.args.channel.type)) throw new UserError('Pick a text channel.');
    ctx.svc.settings.mapSet(ctx.guildId, 'log_channels', ctx.args.type, ctx.args.channel.id); return H.ok(`**${ctx.args.type}** logs → <#${ctx.args.channel.id}>.`);
  });
  LA('clear', { description: 'Stop logging a type', options: [typeOpt] }, (ctx) => {
    if (!(ctx.args.type in ctx.cfg('log_channels'))) throw new UserError('That type has no channel.');
    ctx.svc.settings.mapDel(ctx.guildId, 'log_channels', ctx.args.type); return H.ok(`**${ctx.args.type}** logging cleared.`);
  });
  LA('all', { description: 'Send every log type to one channel', options: [{ name: 'channel', type: 'channel', description: 'Log channel', required: true }] }, (ctx) => {
    if (![0, 5].includes(ctx.args.channel.type)) throw new UserError('Pick a text channel.');
    ctx.svc.settings.mapSet(ctx.guildId, 'log_channels', 'all', ctx.args.channel.id); return H.ok(`All logs → <#${ctx.args.channel.id}>.`);
  });
  LA('modlog', { description: 'Set the moderation-case log channel', options: [{ name: 'channel', type: 'channel', description: 'Log channel', required: true }] }, (ctx) => {
    if (![0, 5].includes(ctx.args.channel.type)) throw new UserError('Pick a text channel.');
    ctx.svc.settings.mapSet(ctx.guildId, 'log_channels', 'mod', ctx.args.channel.id); return H.ok(`Mod log → <#${ctx.args.channel.id}>.`);
  });
  LA('status', { description: 'Show log channels and disabled types' }, (ctx) => H.embed(ctx, { title: 'Logging', description: H.listLines(Object.entries(ctx.cfg('log_channels')), ([t, c]) => `• **${t}** → <#${c}>`) + `\nDisabled types: ${H.show(ctx.cfg('log_disabled_events'))}` }));
  LA('disable', { description: 'Pause logging of a type', options: [typeOpt] }, (ctx) => { ctx.svc.settings.addTo(ctx.guildId, 'log_disabled_events', ctx.args.type); return H.ok(`**${ctx.args.type}** logging paused.`); });
  LA('enable', { description: 'Resume logging of a type', options: [typeOpt] }, (ctx) => { ctx.svc.settings.removeFrom(ctx.guildId, 'log_disabled_events', ctx.args.type); return H.ok(`**${ctx.args.type}** logging resumed.`); });
  LA('recent', { description: 'Show recent bot audit-log entries', options: [{ name: 'limit', type: 'integer', description: '1-25', min: 1, max: 25, default: 10 }] }, (ctx) => {
    const rows = ctx.db.prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(ctx.guildId, ctx.args.limit);
    return H.embed(ctx, { title: 'Recent actions', description: H.listLines(rows, (r) => `• ${ts(r.ts)} \`${r.actor_id}\` **${r.action}**${r.details ? ` ${truncate(safe(r.details), 80)}` : ''}`, 25) });
  });
  LA('search', { description: 'Search the bot audit log', options: [{ name: 'query', type: 'string', description: 'Action or user ID', required: true, maxLength: 60, rest: true }] }, (ctx) => {
    const q = `%${ctx.args.query.replace(/[%_]/g, '')}%`;
    const rows = ctx.db.prepare('SELECT * FROM audit_log WHERE guild_id = ? AND (action LIKE ? OR actor_id LIKE ? OR target LIKE ?) ORDER BY id DESC LIMIT 20').all(ctx.guildId, q, q, q);
    return H.embed(ctx, { title: `Audit search: ${ctx.args.query}`, description: H.listLines(rows, (r) => `• ${ts(r.ts)} \`${r.actor_id}\` **${r.action}**`, 20) });
  });
  LA('export', { description: 'Export the audit log as a text file', ephemeral: true, perms: ['ViewAuditLog'] }, (ctx) => {
    const rows = ctx.db.prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT 500').all(ctx.guildId);
    return { ephemeral: true, content: `Exported ${rows.length} entries.`, files: [{ name: 'audit-log.txt', data: rows.map((r) => `${new Date(r.ts * 1000).toISOString()} ${r.actor_id} ${r.action} ${r.target || ''} ${r.details || ''} [${r.source || ''}]`).join('\n') || '(empty)' }] };
  });

  // ----------------------------------------------------------------- welcome
  const wl = registry.group({ name: 'welcome', description: 'Welcome and farewell messages', category: 'Welcome', aliases: ['greet'] });
  const WC = (sub, spec) => H.configAction(wl, sub, spec);
  WC('toggle', { description: 'Enable or disable welcome messages', key: 'welcome_enabled', kind: 'bool', label: 'Welcome messages' });
  WC('channel', { description: 'Channel for welcome messages', key: 'welcome_channel', kind: 'channel', label: 'Welcome channel' });
  WC('message', { description: 'Welcome text: {user} {username} {server} {count}', key: 'welcome_message', kind: 'text', label: 'Welcome message' });
  WC('dmtoggle', { description: 'Enable or disable the welcome DM', key: 'welcome_dm_enabled', kind: 'bool', label: 'Welcome DM' });
  WC('dm', { description: 'Text sent privately to new members', key: 'welcome_dm', kind: 'text', label: 'Welcome DM text' });
  WC('leavetoggle', { description: 'Enable or disable farewell messages', key: 'leave_enabled', kind: 'bool', label: 'Farewell messages' });
  WC('leavechannel', { description: 'Channel for farewell messages', key: 'leave_channel', kind: 'channel', label: 'Farewell channel' });
  WC('leavemessage', { description: 'Farewell text: {username} {server} {count}', key: 'leave_message', kind: 'text', label: 'Farewell message' });
  H.listActions(wl, { key: 'autoroles', noun: 'roles given automatically on join', addSub: 'autorole-add', removeSub: 'autorole-remove', listSub: 'autorole-list', type: 'role', optName: 'role', perms: ['ManageGuild', 'ManageRoles'], describeItem: (r) => r.name });
  wl.action('preview', { description: 'Preview the welcome and farewell messages', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, (ctx) => {
    const v = { user: ctx.member.displayName, username: ctx.user.username, server: ctx.guild.name, count: ctx.guild.memberCount };
    return H.embed(ctx, { title: 'Preview', fields: [{ name: 'Welcome', value: fillTemplate(ctx.cfg('welcome_message'), v) }, { name: 'Farewell', value: fillTemplate(ctx.cfg('leave_message'), v) }] });
  });
  wl.action('reset', { description: 'Reset all welcome settings', access: 'admin', guildOnly: true, perms: ['ManageGuild'], options: [CONFIRM] }, (ctx) => {
    for (const k of ctx.svc.settings.keys().filter((x) => /^(welcome_|leave_|autoroles)/.test(x))) ctx.svc.settings.reset(ctx.guildId, k);
    return H.ok('Welcome settings reset.');
  });

  // --------------------------------------------------------------- dashboard
  const db = registry.group({ name: 'dashboard', description: 'Web dashboard access and settings', category: 'Dashboard', aliases: ['web'] });
  db.action('link', { description: 'Get the dashboard link', ephemeral: true, cooldown: 5 }, (ctx) => `🌐 ${ctx.svc.config.dashboard.enabled ? ctx.svc.config.dashboard.baseUrl : 'The dashboard is not enabled on this bot.'}`);
  db.action('status', { description: 'Show dashboard availability', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, (ctx) => `Dashboard (global): **${ctx.svc.config.dashboard.enabled ? 'enabled' : 'disabled'}** • This server: **${H.show(ctx.cfg('dashboard_enabled'))}** • Theme: **${ctx.cfg('dashboard_theme')}**`);
  H.configAction(db, 'toggle', { description: 'Allow or block dashboard access for this server', key: 'dashboard_enabled', kind: 'bool', label: 'Dashboard access' });
  H.configAction(db, 'theme', { description: 'Dashboard theme for this server', key: 'dashboard_theme', kind: 'enum', label: 'Dashboard theme' });
  db.action('who', { description: 'Explain who can use the dashboard here', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, () => 'Only members who have **Manage Server** or **Administrator** in this server can open its dashboard page. This is checked from Discord on every request and cannot be changed from the dashboard.');

  // ------------------------------------------------------------------ backup
  const bk = registry.group({ name: 'backup', description: 'Server configuration backups', category: 'Backup', aliases: ['backups'] });
  const BA = (sub, spec, run) => bk.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ephemeral: true, ...spec }, run);
  const nameOpt = { name: 'name', type: 'string', description: 'Backup name', required: true, minLength: 1, maxLength: 40, pattern: /^[\w .-]+$/, patternHelp: 'letters, digits, space, . _ -' };
  const snapshot = (ctx) => snapshotGuild(ctx.svc, ctx.guild);
  const load = (ctx, name) => {
    const row = ctx.db.prepare('SELECT * FROM backups WHERE guild_id = ? AND name = ?').get(ctx.guildId, name);
    if (!row) throw new UserError(`No backup named **${name}**.`);
    return { row, data: JSON.parse(row.data) };
  };
  BA('create', { description: 'Create a configuration backup', options: [nameOpt], cooldown: 10 }, (ctx) => {
    const n = ctx.db.prepare('SELECT COUNT(*) c FROM backups WHERE guild_id = ?').get(ctx.guildId).c;
    if (n >= 25) throw new UserError('Backup limit reached (25). Delete one first.');
    try { ctx.db.prepare('INSERT INTO backups (guild_id, name, data, created_by, ts) VALUES (?, ?, ?, ?, ?)').run(ctx.guildId, ctx.args.name, JSON.stringify(snapshot(ctx)), ctx.user.id, ctx.svc.now()); } catch (e) { if (/UNIQUE/.test(e.message)) throw new UserError('A backup with that name already exists.'); throw e; }
    return H.ok(`Backup **${ctx.args.name}** created.`);
  });
  BA('list', { description: 'List backups' }, (ctx) => H.embed(ctx, { title: 'Backups', description: H.listLines(ctx.db.prepare('SELECT name, ts, LENGTH(data) size FROM backups WHERE guild_id = ? ORDER BY ts DESC').all(ctx.guildId), (b) => `• **${b.name}** — ${ts(b.ts)} (${Math.ceil(b.size / 1024)} KB)`, 25) }));
  BA('info', { description: 'Show what a backup contains', options: [nameOpt] }, (ctx) => {
    const { data } = load(ctx, ctx.args.name);
    return H.embed(ctx, { title: `Backup ${ctx.args.name}`, description: `Settings: ${Object.keys(data.settings).length}\nShop items: ${data.shop.length}\nLevel rewards: ${data.levelRewards.length}\nAutoresponders: ${data.autoresponders.length}\nCustom commands: ${data.customCommands.length}\nStructure: ${data.structure.roles.length} roles, ${data.structure.channels.length} channels (reference only)` });
  });
  BA('delete', { description: 'Delete a backup', perms: ['Administrator'], options: [nameOpt] }, (ctx) => {
    if (!ctx.db.prepare('DELETE FROM backups WHERE guild_id = ? AND name = ?').run(ctx.guildId, ctx.args.name).changes) throw new UserError('No such backup.');
    return H.ok('Backup deleted.');
  });
  BA('restore', { description: 'Restore settings, shop, rewards and commands from a backup', perms: ['Administrator'], cooldown: 30, options: [nameOpt, CONFIRM] }, (ctx) => {
    const { data } = load(ctx, ctx.args.name);
    // Safety copy first so a restore can itself be undone.
    ctx.db.prepare('INSERT OR REPLACE INTO backups (guild_id, name, data, created_by, ts) VALUES (?, ?, ?, ?, ?)').run(ctx.guildId, 'auto-before-restore', JSON.stringify(snapshot(ctx)), ctx.user.id, ctx.svc.now());
    const g = ctx.guildId;
    ctx.db.transaction(() => {
      ctx.svc.settings.restore(g, data.settings);
      for (const it of data.shop || []) ctx.db.prepare('INSERT OR REPLACE INTO shop_items (id, guild_id, name, description, price, stock, role_id, sellable) VALUES ((SELECT id FROM shop_items WHERE guild_id = ? AND name = ?), ?, ?, ?, ?, ?, ?, ?)').run(g, it.name, g, it.name, it.description, it.price, it.stock, it.role_id, it.sellable);
      ctx.db.prepare('DELETE FROM level_rewards WHERE guild_id = ?').run(g);
      for (const r of data.levelRewards || []) ctx.db.prepare('INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)').run(g, r.level, r.role_id);
      ctx.db.prepare('DELETE FROM autoresponders WHERE guild_id = ?').run(g);
      for (const a of data.autoresponders || []) ctx.db.prepare('INSERT INTO autoresponders (guild_id, trigger, response, enabled) VALUES (?, ?, ?, ?)').run(g, a.trigger, a.response, a.enabled);
      ctx.db.prepare('DELETE FROM warn_actions WHERE guild_id = ?').run(g);
      for (const w of data.warnActions || []) ctx.db.prepare('INSERT INTO warn_actions (guild_id, threshold, action, duration) VALUES (?, ?, ?, ?)').run(g, w.threshold, w.action, w.duration);
    })();
    return H.ok(`Restored **${ctx.args.name}**. A safety backup named \`auto-before-restore\` was saved first. (Roles and channels are never recreated automatically.)`);
  });
  BA('export', { description: 'Export a backup as a JSON file', options: [nameOpt] }, (ctx) => ({ ephemeral: true, content: 'Backup attached.', files: [{ name: `${ctx.args.name.replace(/\W+/g, '_')}.json`, data: JSON.stringify(load(ctx, ctx.args.name).data, null, 2) }] }));
  BA('verify', { description: 'Check that a backup is intact', options: [nameOpt] }, (ctx) => {
    const { data } = load(ctx, ctx.args.name); const problems = [];
    for (const k of Object.keys(data.settings)) if (!SCHEMA[k]) problems.push(`unknown setting ${k}`);
    if (!Array.isArray(data.shop)) problems.push('shop missing');
    return problems.length ? `⚠️ ${problems.join('; ')}` : `✅ Backup **${ctx.args.name}** looks intact.`;
  });
  BA('diff', { description: 'Compare a backup with current settings', options: [nameOpt] }, (ctx) => {
    const { data } = load(ctx, ctx.args.name); const cur = ctx.svc.settings.stored(ctx.guildId);
    const keys = new Set([...Object.keys(data.settings), ...Object.keys(cur)]);
    const diffs = [...keys].filter((k) => JSON.stringify(data.settings[k]) !== JSON.stringify(cur[k]));
    return H.embed(ctx, { title: `Backup ${ctx.args.name} vs now`, description: H.listLines(diffs, (k) => `• \`${k}\` differs`, 30) });
  });
  H.configAction(bk, 'schedule', { description: 'Hours between automatic backups (0 = off)', key: 'backup_interval_h', kind: 'int', label: 'Auto-backup interval (h)' });

  // ------------------------------------------------------------ global owner
  const ow = registry.group({ name: 'owner', description: 'Global Owner controls', category: 'Owner', aliases: ['globalowner'] });
  const OA = (sub, spec, run) => ow.action(sub, { access: 'owner', guildOnly: false, ephemeral: true, ...spec }, run);
  OA('maintenance', { description: 'Toggle maintenance mode for everyone else', options: [{ name: 'enabled', type: 'boolean', description: 'on/off', required: true }] }, (ctx) => {
    ctx.db.prepare("INSERT INTO global_state (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(ctx.args.enabled ? '1' : '0');
    return H.ok(`Maintenance mode ${ctx.args.enabled ? 'ON' : 'OFF'}.`);
  });
  OA('blacklist', { description: 'Block a user from using the bot', options: [H.userOpt('User'), H.reasonOpt] }, (ctx) => {
    if (isGlobalOwner(ctx.args.user.id)) throw new UserError('The Global Owner cannot be blacklisted.');
    ctx.db.prepare('INSERT OR REPLACE INTO blacklist (user_id, reason, by, ts) VALUES (?, ?, ?, ?)').run(ctx.args.user.id, ctx.args.reason || null, ctx.user.id, ctx.svc.now());
    return H.ok(`Blacklisted \`${ctx.args.user.id}\`.`);
  });
  OA('unblacklist', { description: 'Allow a blacklisted user again', options: [H.userOpt('User')] }, (ctx) => {
    if (!ctx.db.prepare('DELETE FROM blacklist WHERE user_id = ?').run(ctx.args.user.id).changes) throw new UserError('That user is not blacklisted.');
    return H.ok('Removed from the blacklist.');
  });
  OA('blacklist-list', { description: 'List blacklisted users' }, (ctx) => H.embed(ctx, { title: 'Blacklist', description: H.listLines(ctx.db.prepare('SELECT * FROM blacklist ORDER BY ts DESC LIMIT 50').all(), (b) => `• \`${b.user_id}\` — ${safe(b.reason || 'no reason')}`, 30) }));
  OA('presence', { description: 'Set the bot status text', options: [{ name: 'text', type: 'string', description: 'Status text', required: true, maxLength: 100, rest: true }] }, (ctx) => {
    if (ctx.client && ctx.client.user && ctx.client.user.setPresence) ctx.client.user.setPresence({ activities: [{ name: ctx.args.text, type: 4 }] });
    ctx.db.prepare("INSERT INTO global_state (key, value) VALUES ('presence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(ctx.args.text);
    return H.ok('Presence updated.');
  });
  OA('stats', { description: 'Global bot statistics' }, (ctx) => {
    const c = (t) => ctx.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    return H.embed(ctx, { title: 'Global statistics', description: `Guilds: ${ctx.client && ctx.client.guilds ? ctx.client.guilds.cache.size : 0}\nCases: ${c('cases')}\nWallets: ${c('wallets')}\nLevel rows: ${c('levels')}\nCustom commands: ${c('custom_commands')}\nAudit entries: ${c('audit_log')}` });
  });
  OA('leaveguild', { description: 'Make the bot leave a server', options: [{ name: 'guild_id', type: 'string', description: 'Server ID', required: true, pattern: /^\d{15,25}$/, patternHelp: 'numeric server ID' }, CONFIRM] }, async (ctx) => {
    const guild = ctx.client && ctx.client.guilds.cache.get(ctx.args.guild_id); if (!guild) throw new UserError('I am not in that server.');
    await guild.leave(); return H.ok(`Left **${guild.name}**.`);
  });
  OA('botname', { description: 'Set the bot display name (creator attribution never changes)', options: [{ name: 'name', type: 'string', description: 'Display name', required: true, minLength: 2, maxLength: 32, rest: true }] }, (ctx) => {
    ctx.db.prepare("INSERT INTO global_state (key, value) VALUES ('bot_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(ctx.args.name);
    ctx.svc.bot.name = ctx.args.name; return H.ok(`Display name is now **${ctx.args.name}**. Creator attribution is unchanged.`);
  });
  OA('auditlog', { description: 'Show the global audit log', options: [{ name: 'limit', type: 'integer', description: '1-25', min: 1, max: 25, default: 15 }] }, (ctx) => H.embed(ctx, { title: 'Global audit log', description: H.listLines(ctx.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(ctx.args.limit), (r) => `• ${ts(r.ts)} \`${r.actor_id}\` **${r.action}** ${r.guild_id ? `(${r.guild_id})` : ''}`, 25) }));
  OA('dbbackup', { description: 'Create a database backup file on the server' }, (ctx) => { const f = database.backupTo(ctx.db, ctx.svc.config.backupDir, 'owner'); return H.ok(`Database backup written: \`${require('node:path').basename(f)}\` (${Math.ceil(fs.statSync(f).size / 1024)} KB).`); });
  OA('dbcheck', { description: 'Run a database integrity check' }, (ctx) => `Integrity check: **${database.integrityCheck(ctx.db)}**`);
  OA('guilds', { description: 'List servers the bot is in' }, (ctx) => H.embed(ctx, { title: 'Servers', description: H.listLines([...(ctx.client && ctx.client.guilds ? ctx.client.guilds.cache.values() : [])], (g) => `• ${safe(g.name)} (\`${g.id}\`) — ${g.memberCount} members`, 30) }));
  OA('register', { description: 'Re-register slash commands with Discord', cooldown: 30 }, async (ctx) => {
    if (!ctx.svc.registerCommands) throw new UserError('Slash registration is not available in this process.');
    const r = await ctx.svc.registerCommands(); return H.ok(`Registered ${r.count} slash command(s) (${r.scope}).`);
  });
  void formatDuration;
};
module.exports.snapshotGuild = snapshotGuild;

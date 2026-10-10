'use strict';
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { truncate, safe, ts } = require('../utils/text');

module.exports = function register(registry) {
  const nameOpt = { name: 'name', type: 'string', description: 'Command name', required: true, maxLength: 32 };
  const respOpt = { name: 'response', type: 'string', description: 'Response template (placeholders: {user} {args} {random:a|b})', required: true, maxLength: 1500, rest: true };
  const actor = (ctx) => ({ userId: ctx.user.id, member: ctx.member, guildId: ctx.guildId });
  const line = (c) => `• \`${c.name}\`${c.enabled ? '' : ' (disabled)'}${c.deleted ? ' (deleted)' : ''} — ${truncate(safe(c.response), 60)} • ${c.uses} uses`;

  function define(g, scope, { admin }) {
    const sc = (ctx) => (scope === 'global' ? 'global' : ctx.guildId);
    const A = (sub, spec, run) => g.action(sub, scope === 'global'
      ? { access: 'owner', guildOnly: false, ephemeral: true, ...spec }
      : { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
    A('add', { description: `Create a ${scope === 'global' ? 'global ' : 'server '}custom command`, options: [nameOpt, respOpt] }, (ctx) => {
      const c = ctx.svc.customCommands.add(sc(ctx), ctx.args.name, ctx.args.response, actor(ctx)); return H.ok(`Created \`${c.name}\`.`);
    });
    A('edit', { description: 'Change a custom command response', options: [nameOpt, respOpt] }, (ctx) => {
      const c = ctx.svc.customCommands.edit(sc(ctx), ctx.args.name, ctx.args.response, actor(ctx)); return H.ok(`Updated \`${c.name}\` (v${c.version}).`);
    });
    A('delete', { description: 'Delete a custom command (recoverable)', options: [nameOpt] }, (ctx) => { const c = ctx.svc.customCommands.remove(sc(ctx), ctx.args.name, actor(ctx)); return H.ok(`Deleted \`${c.name}\`. Use \`restore\` to bring it back.`); });
    A('restore', { description: 'Restore a deleted custom command', options: [nameOpt] }, (ctx) => { const c = ctx.svc.customCommands.restore(sc(ctx), ctx.args.name, actor(ctx)); return H.ok(`Restored \`${c.name}\`.`); });
    A('toggle', { description: 'Enable or disable a custom command', options: [nameOpt, { name: 'enabled', type: 'boolean', description: 'on/off', required: true }] }, (ctx) => { const c = ctx.svc.customCommands.setEnabled(sc(ctx), ctx.args.name, ctx.args.enabled, actor(ctx)); return H.ok(`\`${c.name}\` is now ${c.enabled ? 'enabled' : 'disabled'}.`); });
    A('history', { description: 'Show the change history of a command', options: [nameOpt] }, (ctx) => H.embed(ctx, { title: `History: ${ctx.args.name}`, description: H.listLines(ctx.svc.customCommands.history(sc(ctx), ctx.args.name, 15), (h) => `• #${h.id} ${ts(h.ts)} **${h.action}** by \`${h.actor_id}\``, 15) }));
    A('rollback', { description: 'Restore the response from a history entry', options: [nameOpt, { name: 'history_id', type: 'integer', description: 'History entry ID', required: true, min: 1 }] }, (ctx) => { const c = ctx.svc.customCommands.rollback(sc(ctx), ctx.args.name, ctx.args.history_id, actor(ctx)); return H.ok(`Rolled back \`${c.name}\` to history #${ctx.args.history_id} (now v${c.version}).`); });
    if (scope === 'global') A('list', { description: 'List global custom commands (including deleted)' }, (ctx) => H.embed(ctx, { title: 'Global custom commands', description: H.listLines(ctx.svc.customCommands.list('global', true), line, 30) }));
    void admin;
  }

  const gc = registry.group({ name: 'gcustom', description: 'Global custom commands (Global Owner only)', category: 'Custom Commands', aliases: ['globalcustom'] });
  define(gc, 'global', { admin: true });

  const cc = registry.group({ name: 'custom', description: 'Server custom commands', category: 'Custom Commands', aliases: ['cc'] });
  define(cc, 'guild', { admin: true });
  cc.action('list', { description: 'List custom commands available here', guildOnly: true }, (ctx) => {
    const all = [...ctx.svc.customCommands.list('global'), ...ctx.svc.customCommands.list(ctx.guildId)].filter((c) => c.enabled);
    return H.embed(ctx, { title: 'Custom commands', description: H.listLines(all, line, 30) });
  });
  cc.action('info', { description: 'Show details about a custom command', guildOnly: true, options: [nameOpt] }, (ctx) => {
    const c = ctx.svc.customCommands.resolve(ctx.guildId, ctx.args.name); if (!c) throw new UserError('No such custom command.');
    return H.embed(ctx, { title: `Custom command: ${c.name}`, description: `Scope: ${c.scope === 'global' ? 'global' : 'this server'}\nVersion: ${c.version} • Uses: ${c.uses}\n\n\`\`\`${truncate(c.response.replace(/`/g, "'"), 900)}\`\`\`` });
  });
  cc.action('run', { description: 'Run a custom command', aliases: ['ccrun'], guildOnly: true, options: [nameOpt, { name: 'args', type: 'string', description: 'Arguments', maxLength: 300, rest: true }] }, (ctx) => {
    const c = ctx.svc.customCommands.resolve(ctx.guildId, ctx.args.name); if (!c) throw new UserError('No such custom command.');
    return ctx.svc.customCommands.render(c, { user: ctx.user, guild: ctx.guild, channel: ctx.channel, args: (ctx.args.args || '').split(/\s+/).filter(Boolean) });
  });
  cc.action('search', { description: 'Search custom commands by name', guildOnly: true, options: [{ name: 'query', type: 'string', description: 'Search text', required: true, maxLength: 32 }] }, (ctx) => {
    const q = ctx.args.query.toLowerCase();
    const all = [...ctx.svc.customCommands.list('global'), ...ctx.svc.customCommands.list(ctx.guildId)].filter((c) => c.enabled && c.name.includes(q));
    return H.embed(ctx, { title: `Search: ${q}`, description: H.listLines(all, line, 20) });
  });
};

'use strict';
/**
 * The ONE authorization + validation pipeline every action goes through, whether
 * it was triggered by "/", "!", a custom command, a button or the test-suite.
 */
const crypto = require('node:crypto');
const { UserError, PermissionError } = require('./errors');
const { resolveArgs } = require('./args');
const { checkAccess, isGlobalOwner, missingPerms } = require('../security/authz');
const { formatDuration } = require('../utils/text');
const log = require('../utils/logger').child('exec');

// Settings that must never be lockable, so admins cannot brick the bot configuration.
const UNBLOCKABLE_GROUPS = new Set(['settings', 'perms', 'owner']);

function createExecutor({ services, rateLimiter }) {
  const { db, settings } = services;

  return async function executor(action, ctx) {
    const started = Date.now();
    const deny = (message) => ({ status: 'denied', message });
    try {
      ctx.svc = services; ctx.db = db; ctx.action = action;
      ctx.cfg = (key) => settings.get(ctx.guildId, key);
      const uid = ctx.user && ctx.user.id;
      if (!uid) return deny('Unknown user.');

      // 1. global blacklist & maintenance (owner is exempt from both; owner can never be blacklisted)
      if (!isGlobalOwner(uid)) {
        const bl = db.prepare('SELECT reason FROM blacklist WHERE user_id = ?').get(uid);
        if (bl) return deny('You are not allowed to use this bot.');
        const maint = db.prepare("SELECT value FROM global_state WHERE key = 'maintenance'").get();
        if (maint && maint.value === '1') return deny('The bot is in maintenance mode. Please try again later.');
      }

      // 2. guild policy (restrictive only; cannot grant access)
      if (ctx.guildId && !isGlobalOwner(uid) && !UNBLOCKABLE_GROUPS.has(action.group.name)) {
        if (settings.get(ctx.guildId, 'disabled_commands').some((k) => k === action.key || k === action.group.name)) {
          return deny('This command is disabled in this server.');
        }
        const roleMap = settings.get(ctx.guildId, 'command_roles');
        const needed = roleMap[action.key] || roleMap[action.group.name];
        if (needed && ctx.member && ctx.member.roles && !ctx.member.roles.cache.has(needed) && !(ctx.member.permissions && ctx.member.permissions.has('Administrator'))) {
          return deny('You do not have the role required for this command.');
        }
        const blocked = settings.get(ctx.guildId, 'blocked_channels');
        const allowed = settings.get(ctx.guildId, 'allowed_channels');
        const chId = ctx.channel && ctx.channel.id;
        const isAdmin = ctx.member && ctx.member.permissions && ctx.member.permissions.has('ManageGuild');
        if (chId && !isAdmin && (blocked.includes(chId) || (allowed.length && !allowed.includes(chId)))) {
          return deny('Commands are not allowed in this channel.');
        }
        if (ctx.source === 'prefix' && settings.get(ctx.guildId, 'slash_only') && action.access === 'user' && !isAdmin) {
          return deny('This server only allows slash commands.');
        }
      }

      // 3. authorization (same function for both invocation methods)
      const access = checkAccess(action, ctx);
      if (!access.ok) {
        if (action.access === 'owner' || action.access === 'admin') {
          services.audit({ guildId: ctx.guildId, actorId: uid, action: `denied:${action.key}`, source: ctx.source });
        }
        return deny(access.reason);
      }
      if (action.botPerms.length && ctx.guild) {
        const me = ctx.guild.members && ctx.guild.members.me;
        const missing = missingPerms(me && me.permissions, action.botPerms);
        if (missing.length) return deny(`I am missing permissions: **${missing.join(', ')}**.`);
      }

      // 4. rate limit + cooldown
      if (!isGlobalOwner(uid)) {
        const wait = rateLimiter.limit(uid);
        if (wait) return { status: 'ratelimited', message: `You are sending commands too quickly. Try again in ${wait}s.` };
        const cd = rateLimiter.cooldown(uid, action.key, action.cooldown);
        if (cd) return { status: 'cooldown', message: `Slow down! Try again in ${formatDuration(cd)}.` };
      }

      // 5. arguments
      const args = await resolveArgs(action, ctx);
      ctx.args = args;

      // 6. run
      const result = await action._invoke(ctx);
      if (action.access === 'owner' || action.audit) {
        services.audit({ guildId: ctx.guildId, actorId: uid, action: action.key, details: summarize(args), source: ctx.source });
      }
      return { status: 'ok', result, ms: Date.now() - started };
    } catch (err) {
      if (err instanceof UserError) return { status: 'usage', message: err.message, hint: err.hint };
      if (err instanceof PermissionError) return deny(err.message);
      const id = crypto.randomBytes(3).toString('hex');
      log.error('action failed', { id, action: action.key, err });
      return { status: 'error', message: `Something went wrong running that command. (error \`${id}\`)`, errorId: id, error: err };
    }
  };
}

function summarize(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = v && typeof v === 'object' && v.id ? `${v.id}` : typeof v === 'string' ? v.slice(0, 120) : v;
  }
  return JSON.stringify(out).slice(0, 500);
}

module.exports = { createExecutor, UNBLOCKABLE_GROUPS };

'use strict';
/**
 * Centralised authorization. There is exactly ONE Global Owner and it is a
 * hard-coded constant: no configuration, database row, dashboard control or
 * command can add another. Identity is verified by Discord user ID only.
 */
const { PermissionsBitField } = require('discord.js');
const { IDENTITY } = require('../constants');

const OWNER_ID = IDENTITY.GLOBAL_OWNER_ID;

function isGlobalOwner(userId) {
  return typeof userId === 'string' && userId === OWNER_ID;
}

const VALID_PERMS = new Set(Object.keys(PermissionsBitField.Flags));

function hasPerms(member, perms = []) {
  if (!perms.length) return true;
  if (!member || !member.permissions) return false;
  return perms.every((p) => member.permissions.has(p));
}

function missingPerms(permissions, perms = []) {
  if (!permissions) return [...perms];
  return perms.filter((p) => !permissions.has(p));
}

/**
 * Decide whether `ctx.user` may run `action`. Pure function; does not touch Discord.
 * Returns { ok: true } or { ok: false, reason }.
 */
function checkAccess(action, ctx) {
  const userId = ctx.user && ctx.user.id;
  if (action.access === 'owner') {
    return isGlobalOwner(userId) ? { ok: true } : { ok: false, reason: 'This action is restricted to the Global Owner.' };
  }
  if (action.guildOnly && !ctx.guild) return { ok: false, reason: 'This command can only be used inside a server.' };
  if (action.access === 'admin') {
    if (!ctx.guild) return { ok: false, reason: 'This command can only be used inside a server.' };
    const perms = action.perms.length ? action.perms : ['ManageGuild'];
    if (!hasPerms(ctx.member, perms)) {
      return { ok: false, reason: `You need the **${perms.join(', ')}** permission to use this command.` };
    }
    return { ok: true };
  }
  if (action.perms.length && !hasPerms(ctx.member, action.perms)) {
    return { ok: false, reason: `You need the **${action.perms.join(', ')}** permission to use this command.` };
  }
  return { ok: true };
}

/** Can `actor` moderate `target` (role hierarchy, owner, self, bot)? */
function canModerate({ guild, actor, target, me }) {
  if (!target) return { ok: true };
  if (actor && target.id === actor.id) return { ok: false, reason: 'You cannot do that to yourself.' };
  if (guild && target.id === guild.ownerId) return { ok: false, reason: 'You cannot moderate the server owner.' };
  if (me && target.id === me.id) return { ok: false, reason: 'I will not do that to myself.' };
  if (isGlobalOwner(target.id)) return { ok: false, reason: 'That user is protected.' };
  const pos = (m) => (m && m.roles && m.roles.highest ? m.roles.highest.position : 0);
  if (actor && guild && actor.id !== guild.ownerId && pos(actor) <= pos(target)) {
    return { ok: false, reason: 'Their highest role is equal to or above yours.' };
  }
  if (me && pos(me) <= pos(target)) return { ok: false, reason: 'Their highest role is equal to or above mine.' };
  return { ok: true };
}

module.exports = { OWNER_ID, isGlobalOwner, hasPerms, missingPerms, checkAccess, canModerate, VALID_PERMS };

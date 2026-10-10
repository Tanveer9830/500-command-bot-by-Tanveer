'use strict';
/** Expected, user-facing failure (bad input, missing state). Message is safe to show. */
class UserError extends Error {
  constructor(message, { hint } = {}) { super(message); this.name = 'UserError'; this.hint = hint; }
}
/** Authorization failure. Message is safe to show. */
class PermissionError extends Error {
  constructor(message) { super(message); this.name = 'PermissionError'; }
}
module.exports = { UserError, PermissionError };

'use strict';
/**
 * Permanent identity of TANVEER PRIME.
 *
 * These values are intentionally hard-coded and frozen. They are NOT read from
 * the environment, the database or the dashboard, so renaming the bot (display
 * name) can never change the creator attribution or the Global Owner.
 */
const IDENTITY = Object.freeze({
  CREATOR: 'TANVEER',
  DISCORD_USERNAME: 'tanveer5637',
  GLOBAL_OWNER_ID: '1131248987173814336',
  SIGNATURE: 'MADE BY TANVEER',
  ATTRIBUTION: 'Made by Tanveer | Discord: tanveer5637',
  ATTRIBUTION_UPPER: 'MADE BY TANVEER | DISCORD: TANVEER5637',
  PRODUCT: 'TANVEER PRIME',
  REPOSITORY_NAME: 'tanveer-prime-discord-bot',
  SERVICE_NAME: 'tanveer-prime',
  DEFAULT_REPO: 'Tanveer9830/500-command-bot-by-Tanveer',
});

const DEFAULT_PREFIX = '!';

const COLORS = Object.freeze({
  CYAN: 0x00e5ff,
  BLUE: 0x1f6bff,
  VIOLET: 0x8a4dff,
  WHITE: 0xffffff,
  GREEN: 0x2ecc71,
  RED: 0xe74c3c,
  AMBER: 0xf1c40f,
});

/** Invite-link permission integer (moderation, roles, channels, messages, voice; NOT Administrator). Verified against general.js by a test. */
const INVITE_PERMISSIONS = '1100454685783';

module.exports = { IDENTITY, DEFAULT_PREFIX, COLORS, INVITE_PERMISSIONS };

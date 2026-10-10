'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function loadDotenv() {
  try {
    // Never override variables that systemd / the shell already provided.
    require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true, override: false });
    // Management scripts run by root point at the service's 0600 env file instead of a repo-local .env.
    if (process.env.TP_ENV_FILE) require('dotenv').config({ path: process.env.TP_ENV_FILE, quiet: true, override: false });
  } catch { /* dotenv is optional at runtime */ }
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const snowflake = /^\d{15,25}$/;

/**
 * Parse and validate configuration from an env object.
 * Returns { config, errors, warnings }. Never throws and never logs secrets.
 */
function parseConfig(env = process.env, { requireToken = true } = {}) {
  const errors = [];
  const warnings = [];
  const dataDir = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));

  const token = (env.DISCORD_TOKEN || '').trim();
  const clientId = (env.DISCORD_CLIENT_ID || '').trim();
  if (requireToken) {
    if (!token) errors.push('DISCORD_TOKEN is missing');
    else if (token.split('.').length !== 3 || token.length < 50) errors.push('DISCORD_TOKEN does not look like a bot token');
  }
  if (!clientId) { if (requireToken) errors.push('DISCORD_CLIENT_ID is missing'); }
  else if (!snowflake.test(clientId)) errors.push('DISCORD_CLIENT_ID must be a numeric snowflake');

  const devGuildId = (env.DEV_GUILD_ID || '').trim();
  if (devGuildId && !snowflake.test(devGuildId)) errors.push('DEV_GUILD_ID must be a numeric snowflake');

  const dashboardPort = Number(env.DASHBOARD_PORT || 3000);
  if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) errors.push('DASHBOARD_PORT must be 1-65535');
  const dashboardEnabled = bool(env.DASHBOARD_ENABLED, false);
  const baseUrl = (env.DASHBOARD_BASE_URL || `http://localhost:${dashboardPort}`).replace(/\/+$/, '');
  if (dashboardEnabled) {
    if (!env.DISCORD_CLIENT_SECRET) errors.push('DASHBOARD_ENABLED=true requires DISCORD_CLIENT_SECRET');
    if (!/^https?:\/\//.test(baseUrl)) errors.push('DASHBOARD_BASE_URL must start with http:// or https://');
    else if (!baseUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
      warnings.push('DASHBOARD_BASE_URL is not HTTPS: put the dashboard behind an HTTPS reverse proxy (see docs/DASHBOARD.md)');
    }
  }

  const lavalinkHost = (env.LAVALINK_HOST || '').trim();
  const lavalinkPort = Number(env.LAVALINK_PORT || 2333);
  if (lavalinkHost && (!Number.isInteger(lavalinkPort) || lavalinkPort < 1 || lavalinkPort > 65535)) errors.push('LAVALINK_PORT must be 1-65535');

  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) errors.push('LOG_LEVEL must be debug|info|warn|error');

  const botName = (env.BOT_NAME || 'TANVEER PRIME').trim().slice(0, 32) || 'TANVEER PRIME';

  const config = {
    root: ROOT,
    dataDir,
    dbPath: path.join(dataDir, 'tanveer-prime.sqlite'),
    backupDir: path.join(dataDir, 'backups'),
    token,
    clientId,
    clientSecret: (env.DISCORD_CLIENT_SECRET || '').trim(),
    devGuildId,
    botName,
    logLevel,
    intents: {
      messageContent: bool(env.ENABLE_MESSAGE_CONTENT, true),
      guildMembers: bool(env.ENABLE_GUILD_MEMBERS, true),
    },
    dashboard: {
      enabled: dashboardEnabled,
      host: env.DASHBOARD_HOST || '127.0.0.1',
      port: dashboardPort,
      baseUrl,
      sessionSecret: (env.SESSION_SECRET || '').trim(),
      secureCookies: baseUrl.startsWith('https://'),
      trustProxy: bool(env.DASHBOARD_TRUST_PROXY, false),
    },
    lavalink: {
      enabled: Boolean(lavalinkHost),
      host: lavalinkHost,
      port: lavalinkPort,
      password: env.LAVALINK_PASSWORD || '',
      secure: bool(env.LAVALINK_SECURE, false),
      name: env.LAVALINK_NAME || 'main',
    },
  };
  return { config, errors, warnings };
}

/** Session secret: env wins, otherwise generated once and stored (0600) in the data dir. */
function ensureSessionSecret(config) {
  if (config.dashboard.sessionSecret && config.dashboard.sessionSecret.length >= 32) return config.dashboard.sessionSecret;
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o750 });
  const file = path.join(config.dataDir, '.session-secret');
  let secret;
  try { secret = fs.readFileSync(file, 'utf8').trim(); } catch { /* generate below */ }
  if (!secret || secret.length < 32) {
    secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  config.dashboard.sessionSecret = secret;
  return secret;
}

function load(opts) {
  loadDotenv();
  return parseConfig(process.env, opts);
}

/** Names/values of secrets used by the log redactor. */
function secretValues(config) {
  return [config.token, config.clientSecret, config.lavalink && config.lavalink.password, config.dashboard && config.dashboard.sessionSecret]
    .filter((s) => s && s.length >= 8);
}

module.exports = { parseConfig, load, ensureSessionSecret, secretValues, ROOT };

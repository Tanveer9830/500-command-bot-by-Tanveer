'use strict';
/** Slash-command registration (bulk overwrite). Used by the bot at startup, `npm run register`, and the installer. */
const crypto = require('node:crypto');
const { REST, Routes } = require('discord.js');

function hashOf(body) { return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16); }

async function registerCommands({ registry, config, db = null, rest = null, force = true }) {
  const body = registry.toSlashJSON();
  const scope = config.devGuildId ? `guild ${config.devGuildId}` : 'global';
  const hash = `${scope}:${hashOf(body)}`;
  if (!force && db) {
    const cur = db.prepare("SELECT value FROM global_state WHERE key = 'slash_hash'").get();
    if (cur && cur.value === hash) return { count: body.length, scope, skipped: true };
  }
  const client = rest || new REST({ version: '10' }).setToken(config.token);
  const route = config.devGuildId ? Routes.applicationGuildCommands(config.clientId, config.devGuildId) : Routes.applicationCommands(config.clientId);
  await client.put(route, { body });
  if (db) db.prepare("INSERT INTO global_state (key, value) VALUES ('slash_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(hash);
  return { count: body.length, scope, skipped: false };
}

module.exports = { registerCommands, hashOf };

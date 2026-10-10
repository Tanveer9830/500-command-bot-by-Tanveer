#!/usr/bin/env node
'use strict';
/** Register the slash commands with Discord (global, or DEV_GUILD_ID for instant updates). */
const { loadConfig, say } = require('./_lib');
const { buildRegistry } = require('../src/commands');
const { registerCommands } = require('../src/services/registerCommands');

(async () => {
  const { config, errors } = loadConfig({ requireToken: true });
  if (errors.length) { for (const e of errors) say('error', e); process.exit(78); }
  const registry = buildRegistry();
  try {
    const r = await registerCommands({ registry, config, force: true });
    say('success', `Registered ${r.count} slash commands (${r.scope}).${r.scope === 'global' ? ' Global commands can take a few minutes to appear.' : ''}`);
  } catch (e) {
    say('error', `Registration failed: ${String(e.message).replace(config.token, '[redacted]')}`); process.exit(1);
  }
})();

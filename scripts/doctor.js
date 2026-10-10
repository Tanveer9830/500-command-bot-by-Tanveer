#!/usr/bin/env node
'use strict';
/** Local diagnostics. Never prints secrets; only reports whether they are set. */
const fs = require('node:fs');
const { loadConfig, say, branding } = require('./_lib');
const database = require('../src/database');
const { buildRegistry } = require('../src/commands');
const { counts, validate } = require('../src/inventory');

(async () => {
  const lines = []; let bad = 0;
  const ok = (m) => lines.push(`✔ ${m}`); const warn = (m) => lines.push(`! ${m}`); const fail = (m) => { bad++; lines.push(`✘ ${m}`); };
  const major = Number(process.versions.node.split('.')[0]);
  (major >= 22 ? ok : fail)(`Node.js ${process.versions.node} (needs >= 22)`);
  const { config, errors, warnings } = loadConfig({ requireToken: true });
  if (errors.length) errors.forEach(fail); else ok('Configuration is valid (token present, not shown)');
  warnings.forEach(warn);
  try {
    const db = database.open(config.dbPath); const m = database.migrate(db, { dbPath: config.dbPath, backupDir: config.backupDir });
    ok(`Database OK (${config.dbPath}); integrity: ${database.integrityCheck(db)}${m.applied.length ? `; applied ${m.applied.length} migration(s)` : ''}`); db.close();
    const mode = (fs.statSync(config.dbPath).mode & 0o777).toString(8); if (mode.endsWith('44') || mode.endsWith('66') || mode.endsWith('77')) warn(`Database file mode is ${mode}; consider chmod 600`);
  } catch (e) { fail(`Database: ${e.message}`); }
  try { const reg = buildRegistry(); const c = counts(reg); const p = validate(reg); (p.length ? fail : ok)(p.length ? p.join('; ') : `Registry: ${c.totalActions} actions, ${c.slashTopLevel} slash entries`); } catch (e) { fail(`Registry: ${e.message}`); }
  lines.push(config.lavalink.enabled ? `i Lavalink configured at ${config.lavalink.host}:${config.lavalink.port} (connection is checked by the bot at runtime)` : 'i Lavalink not configured (music disabled)');
  lines.push(config.dashboard.enabled ? `i Dashboard enabled on ${config.dashboard.host}:${config.dashboard.port}` : 'i Dashboard disabled');
  if (config.token) {
    try { const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bot ${config.token}` }, signal: AbortSignal.timeout(8000) }); (r.ok ? ok : fail)(r.ok ? 'Discord accepted the bot token' : `Discord rejected the token (HTTP ${r.status})`); } catch (e) { warn(`Could not reach Discord: ${e.message}`); }
  }
  branding.print((bad ? branding.errorBanner : branding.diagnosticsBanner)('DOCTOR', lines));
  process.exit(bad ? 1 : 0);
})();

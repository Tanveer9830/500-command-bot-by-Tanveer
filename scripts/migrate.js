#!/usr/bin/env node
'use strict';
/** Apply pending database migrations (a backup is taken first when the DB already has data). */
const { loadConfig, say } = require('./_lib');
const database = require('../src/database');

const { config } = loadConfig();
const db = database.open(config.dbPath);
const r = database.migrate(db, { dbPath: config.dbPath, backupDir: config.backupDir });
say('success', r.applied.length ? `Applied: ${r.applied.join(', ')}${r.backupFile ? ` (backup: ${r.backupFile})` : ''}` : 'Database is up to date.');
db.close();

#!/usr/bin/env node
'use strict';
/** Create a consistent copy of the SQLite database in the backups folder (safe while the bot runs). */
const { loadConfig, say } = require('./_lib');
const database = require('../src/database');

const { config } = loadConfig();
const db = database.open(config.dbPath);
try {
  const file = database.backupTo(db, config.backupDir, 'manual');
  say('success', `Backup written: ${file}`);
} finally { db.close(); }

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function listMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort().map((file) => ({
    version: parseInt(file, 10), name: file.replace(/\.sql$/, ''), sql: fs.readFileSync(path.join(dir, file), 'utf8'),
  }));
}

/** Open the database with safe pragmas. `:memory:` is accepted for tests. */
function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o750 });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

/**
 * Apply pending migrations. Each migration runs in its own transaction.
 * If an existing database has pending migrations, a consistent backup is taken first.
 */
function migrate(db, { dbPath, backupDir, dir } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const pending = listMigrations(dir).filter((m) => !applied.has(m.version));
  let backupFile = null;
  if (pending.length && applied.size > 0 && dbPath && dbPath !== ':memory:' && backupDir) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o750 });
    backupFile = path.join(backupDir, `pre-migrate-${Date.now()}.sqlite`);
    // VACUUM INTO produces a consistent snapshot even with WAL enabled.
    db.prepare('VACUUM INTO ?').run(backupFile);
  }
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    })();
  }
  return { applied: pending.map((m) => m.name), backupFile };
}

/** Consistent online backup (VACUUM INTO). Returns the file path. */
function backupTo(db, dir, label = 'manual') {
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const file = path.join(dir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  db.prepare('VACUUM INTO ?').run(file);
  fs.chmodSync(file, 0o600);
  return file;
}

function integrityCheck(db) {
  return db.pragma('integrity_check', { simple: true });
}

module.exports = { open, migrate, backupTo, integrityCheck, listMigrations };

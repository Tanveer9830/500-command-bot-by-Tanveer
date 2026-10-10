CREATE TABLE guild_config (
  guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (guild_id, key)
);
CREATE TABLE user_prefs (
  user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, key)
);
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY, bio TEXT, color TEXT, title TEXT, birthday TEXT, pronouns TEXT, timezone TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, details TEXT, source TEXT, ts INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_audit_guild ON audit_log (guild_id, id DESC);
CREATE TABLE blacklist (user_id TEXT PRIMARY KEY, reason TEXT, by TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE global_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, case_no INTEGER NOT NULL, type TEXT NOT NULL,
  target_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT, active INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER, ts INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (guild_id, case_no)
);
CREATE INDEX idx_cases_target ON cases (guild_id, target_id, type);
CREATE TABLE cooldowns (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, until INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, key)
);

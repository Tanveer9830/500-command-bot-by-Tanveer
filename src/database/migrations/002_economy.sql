CREATE TABLE wallets (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  wallet INTEGER NOT NULL DEFAULT 0 CHECK (wallet >= 0),
  bank INTEGER NOT NULL DEFAULT 0 CHECK (bank >= 0),
  earned INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  delta INTEGER NOT NULL, balance_after INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT,
  ts INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_tx_user ON transactions (guild_id, user_id, id DESC);
CREATE TABLE shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL CHECK (price > 0),
  stock INTEGER NOT NULL DEFAULT -1, role_id TEXT, sellable INTEGER NOT NULL DEFAULT 1,
  UNIQUE (guild_id, name)
);
CREATE TABLE inventory (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (guild_id, user_id, item_id)
);
CREATE TABLE levels (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0, last_xp_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_levels_rank ON levels (guild_id, xp DESC);
CREATE TABLE level_rewards (guild_id TEXT NOT NULL, level INTEGER NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (guild_id, level));
CREATE TABLE achievements (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (guild_id, user_id, key));
CREATE TABLE rep (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id));
CREATE TABLE rep_log (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, reason TEXT, ts INTEGER NOT NULL DEFAULT (unixepoch()));

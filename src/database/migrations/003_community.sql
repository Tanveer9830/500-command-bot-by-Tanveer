CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, ticket_no INTEGER NOT NULL, channel_id TEXT, user_id TEXT NOT NULL,
  subject TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', claimed_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), closed_at INTEGER, closed_by TEXT,
  UNIQUE (guild_id, ticket_no)
);
CREATE TABLE ticket_blacklist (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, PRIMARY KEY (guild_id, user_id));
CREATE TABLE giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
  prize TEXT NOT NULL, winners INTEGER NOT NULL DEFAULT 1, ends_at INTEGER NOT NULL, host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', winner_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE giveaway_entries (giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE, user_id TEXT NOT NULL, PRIMARY KEY (giveaway_id, user_id));
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT, message_id TEXT, question TEXT NOT NULL,
  options TEXT NOT NULL, multi INTEGER NOT NULL DEFAULT 0, ends_at INTEGER, status TEXT NOT NULL DEFAULT 'open', author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE poll_votes (poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE, user_id TEXT NOT NULL, option_idx INTEGER NOT NULL, PRIMARY KEY (poll_id, user_id, option_idx));
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, guild_id TEXT, channel_id TEXT, text TEXT NOT NULL,
  due_at INTEGER NOT NULL, repeat_secs INTEGER, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_reminders_due ON reminders (status, due_at);
CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 2, ts INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, ts INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE (user_id, name));
CREATE TABLE playlist_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, query TEXT NOT NULL, title TEXT);
CREATE TABLE custom_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, response TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (scope, name)
);
CREATE TABLE custom_command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, command_id INTEGER NOT NULL, scope TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL,
  response TEXT, actor_id TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE afk (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, since INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (guild_id, user_id));
CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, by TEXT, ts INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE autoresponders (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, trigger TEXT NOT NULL COLLATE NOCASE, response TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, UNIQUE (guild_id, trigger));
CREATE TABLE reaction_roles (guild_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (guild_id, message_id, emoji));
CREATE TABLE starboard (guild_id TEXT NOT NULL, message_id TEXT NOT NULL, star_message_id TEXT, stars INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, message_id));
CREATE TABLE sticky (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL, last_message_id TEXT, PRIMARY KEY (guild_id, channel_id));
CREATE TABLE scheduled_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL, due_at INTEGER NOT NULL, repeat_secs INTEGER, status TEXT NOT NULL DEFAULT 'pending', created_by TEXT NOT NULL);
CREATE TABLE backups (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE (guild_id, name));
CREATE TABLE suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT, message_id TEXT, ts INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE trivia_scores (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id));
CREATE TABLE game_stats (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, game TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id, game));
CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE warn_actions (guild_id TEXT NOT NULL, threshold INTEGER NOT NULL, action TEXT NOT NULL, duration INTEGER, PRIMARY KEY (guild_id, threshold));

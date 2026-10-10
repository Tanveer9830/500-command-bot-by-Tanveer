'use strict';
/** Per-guild configuration: validated key/value store on top of SQLite. */
const { UserError } = require('../core/errors');

const S = (def) => ({ type: 'string', max: 500, default: null, ...def });
const SCHEMA = {
  prefix: S({ default: '!', max: 5, pattern: /^[^\s\w@#`]{1,5}$/, help: 'Prefix: 1-5 punctuation characters.' }),
  timezone: S({ default: 'UTC', max: 64 }),
  embed_color: S({ default: '#00e5ff', pattern: /^#[0-9a-f]{6}$/i }),
  disabled_commands: { type: 'list', default: [], maxItems: 200 },
  command_roles: { type: 'map', default: {}, maxItems: 200 },
  blocked_channels: { type: 'list', default: [], maxItems: 100 },
  allowed_channels: { type: 'list', default: [], maxItems: 100 },
  // automod
  automod_enabled: { type: 'bool', default: false },
  automod_spam: { type: 'bool', default: true },
  automod_spam_threshold: { type: 'int', default: 6, min: 3, max: 30 },
  automod_spam_window: { type: 'int', default: 5, min: 2, max: 60 },
  automod_links: { type: 'bool', default: false },
  automod_invites: { type: 'bool', default: false },
  automod_caps_pct: { type: 'int', default: 0, min: 0, max: 100 },
  automod_mentions: { type: 'int', default: 0, min: 0, max: 50 },
  automod_emojis: { type: 'int', default: 0, min: 0, max: 100 },
  automod_badwords: { type: 'list', default: [], maxItems: 200 },
  automod_domains: { type: 'list', default: [], maxItems: 200 },
  automod_action: { type: 'enum', default: 'delete', values: ['delete', 'warn', 'timeout'] },
  automod_timeout: { type: 'int', default: 300, min: 10, max: 2_419_200 },
  automod_exempt_channels: { type: 'list', default: [], maxItems: 100 },
  automod_exempt_roles: { type: 'list', default: [], maxItems: 100 },
  // anti-raid
  raid_enabled: { type: 'bool', default: false },
  raid_threshold: { type: 'int', default: 8, min: 3, max: 100 },
  raid_window: { type: 'int', default: 30, min: 5, max: 600 },
  raid_min_age_days: { type: 'int', default: 0, min: 0, max: 365 },
  raid_action: { type: 'enum', default: 'kick', values: ['kick', 'ban', 'timeout', 'alert'] },
  raid_whitelist: { type: 'list', default: [], maxItems: 200 },
  raid_lockdown: { type: 'bool', default: false },
  // verification
  verify_enabled: { type: 'bool', default: false },
  verify_role: S({ default: null }),
  verify_channel: S({ default: null }),
  verify_method: { type: 'enum', default: 'button', values: ['button', 'math'] },
  verify_min_age_days: { type: 'int', default: 0, min: 0, max: 365 },
  verify_message: S({ default: 'Press the button below to verify and gain access to the server.', max: 1000 }),
  // logging
  log_channels: { type: 'map', default: {}, maxItems: 20 },
  log_disabled_events: { type: 'list', default: [], maxItems: 20 },
  // welcome / farewell
  welcome_enabled: { type: 'bool', default: false },
  welcome_channel: S({ default: null }),
  welcome_message: S({ default: 'Welcome to {server}, {user}! You are member #{count}.', max: 1500 }),
  welcome_dm_enabled: { type: 'bool', default: false },
  welcome_dm: S({ default: 'Welcome to {server}! Please read the rules.', max: 1500 }),
  leave_enabled: { type: 'bool', default: false },
  leave_channel: S({ default: null }),
  leave_message: S({ default: '{username} has left {server}.', max: 1500 }),
  autoroles: { type: 'list', default: [], maxItems: 10 },
  // tickets
  ticket_category: S({ default: null }),
  ticket_support_role: S({ default: null }),
  ticket_limit: { type: 'int', default: 1, min: 1, max: 10 },
  ticket_transcript_channel: S({ default: null }),
  ticket_panel_text: S({ default: 'Press the button to open a support ticket.', max: 1000 }),
  // economy
  eco_enabled: { type: 'bool', default: true },
  eco_symbol: S({ default: '🪙', max: 16 }),
  eco_daily: { type: 'int', default: 200, min: 1, max: 1_000_000 },
  eco_weekly: { type: 'int', default: 1000, min: 1, max: 10_000_000 },
  eco_monthly: { type: 'int', default: 4000, min: 1, max: 100_000_000 },
  eco_work_min: { type: 'int', default: 50, min: 1, max: 1_000_000 },
  eco_work_max: { type: 'int', default: 250, min: 1, max: 1_000_000 },
  eco_tax_pct: { type: 'int', default: 0, min: 0, max: 50 },
  eco_bank_limit: { type: 'int', default: 0, min: 0, max: 1_000_000_000 },
  eco_start_balance: { type: 'int', default: 0, min: 0, max: 1_000_000 },
  eco_cooldown_pct: { type: 'int', default: 100, min: 10, max: 500 },
  eco_gamble_max: { type: 'int', default: 10_000, min: 1, max: 10_000_000 },
  eco_rob_enabled: { type: 'bool', default: true },
  // levels
  lvl_enabled: { type: 'bool', default: true },
  lvl_xp_min: { type: 'int', default: 15, min: 1, max: 1000 },
  lvl_xp_max: { type: 'int', default: 25, min: 1, max: 1000 },
  lvl_cooldown: { type: 'int', default: 60, min: 5, max: 3600 },
  lvl_channel: S({ default: null }),
  lvl_message: S({ default: 'GG {username}, you reached level {level}!', max: 500 }),
  lvl_announce: { type: 'bool', default: true },
  lvl_ignore_channels: { type: 'list', default: [], maxItems: 100 },
  lvl_multipliers: { type: 'map', default: {}, maxItems: 100 },
  lvl_stack_rewards: { type: 'bool', default: true },
  // music
  music_dj_role: S({ default: null }),
  music_max_queue: { type: 'int', default: 100, min: 1, max: 1000 },
  music_default_volume: { type: 'int', default: 50, min: 1, max: 150 },
  music_vote_skip: { type: 'bool', default: false },
  music_channel: S({ default: null }),
  music_247: { type: 'bool', default: false },
  // starboard / suggestions / dashboard / misc
  star_channel: S({ default: null }),
  star_threshold: { type: 'int', default: 3, min: 1, max: 50 },
  star_emoji: S({ default: '⭐', max: 64 }),
  suggest_channel: S({ default: null }),
  dashboard_enabled: { type: 'bool', default: true },
  dashboard_theme: { type: 'enum', default: 'prime', values: ['prime', 'dark', 'light'] },
  backup_interval_h: { type: 'int', default: 0, min: 0, max: 720 },
  report_channel: S({ default: null }),
  custom_commands_policy: { type: 'enum', default: 'manage_guild', values: ['manage_guild', 'disabled'] },
  warn_expiry_days: { type: 'int', default: 0, min: 0, max: 365 },
  mod_dm_on_action: { type: 'bool', default: false },
  slash_only: { type: 'bool', default: false },
  respond_unknown: { type: 'bool', default: false },
};

function validate(key, value) {
  const def = SCHEMA[key];
  if (!def) throw new UserError(`Unknown setting \`${key}\`.`);
  switch (def.type) {
    case 'bool': if (typeof value !== 'boolean') throw new UserError(`\`${key}\` must be on/off.`); return value;
    case 'int':
      if (!Number.isSafeInteger(value)) throw new UserError(`\`${key}\` must be a whole number.`);
      if (value < def.min || value > def.max) throw new UserError(`\`${key}\` must be between ${def.min} and ${def.max}.`);
      return value;
    case 'enum': if (!def.values.includes(value)) throw new UserError(`\`${key}\` must be one of: ${def.values.join(', ')}.`); return value;
    case 'string':
      if (value === null) return null;
      if (typeof value !== 'string') throw new UserError(`\`${key}\` must be text.`);
      if (value.length > def.max) throw new UserError(`\`${key}\` is limited to ${def.max} characters.`);
      if (def.pattern && !def.pattern.test(value)) throw new UserError(def.help || `\`${key}\` has an invalid format.`);
      return value;
    case 'list':
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || x.length > 200)) throw new UserError(`\`${key}\` must be a list of text.`);
      if (value.length > def.maxItems) throw new UserError(`\`${key}\` is limited to ${def.maxItems} entries.`);
      return [...new Set(value)];
    case 'map':
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UserError(`\`${key}\` must be a map.`);
      if (Object.keys(value).length > def.maxItems) throw new UserError(`\`${key}\` is limited to ${def.maxItems} entries.`);
      return value;
    default: throw new Error('bad schema');
  }
}

class Settings {
  constructor(db) {
    this.db = db;
    this.stmtGet = db.prepare('SELECT value FROM guild_config WHERE guild_id = ? AND key = ?');
    this.stmtSet = db.prepare('INSERT INTO guild_config (guild_id, key, value, updated_at) VALUES (?, ?, ?, unixepoch()) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()');
    this.stmtDel = db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?');
    this.stmtAll = db.prepare('SELECT key, value FROM guild_config WHERE guild_id = ?');
    this.cache = new Map();
  }
  keys() { return Object.keys(SCHEMA); }
  def(key) { return SCHEMA[key]; }
  defaultOf(key) { const d = SCHEMA[key]; return d && (typeof d.default === 'object' && d.default !== null ? structuredClone(d.default) : d.default); }
  get(guildId, key) {
    if (!SCHEMA[key]) throw new Error(`unknown setting ${key}`);
    if (!guildId) return this.defaultOf(key);
    const ck = `${guildId}:${key}`;
    if (this.cache.has(ck)) return structuredClone(this.cache.get(ck));
    const row = this.stmtGet.get(guildId, key);
    const v = row ? JSON.parse(row.value) : this.defaultOf(key);
    this.cache.set(ck, v);
    return structuredClone(v);
  }
  set(guildId, key, value) {
    const v = validate(key, value);
    this.stmtSet.run(guildId, key, JSON.stringify(v));
    this.cache.set(`${guildId}:${key}`, v);
    return v;
  }
  reset(guildId, key) {
    if (!SCHEMA[key]) throw new UserError(`Unknown setting \`${key}\`.`);
    this.stmtDel.run(guildId, key); this.cache.delete(`${guildId}:${key}`);
  }
  resetAll(guildId) {
    this.db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(guildId);
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${guildId}:`)) this.cache.delete(k);
  }
  /** Explicitly stored (non-default) settings. */
  stored(guildId) {
    return Object.fromEntries(this.stmtAll.all(guildId).filter((r) => SCHEMA[r.key]).map((r) => [r.key, JSON.parse(r.value)]));
  }
  all(guildId) { return Object.fromEntries(this.keys().map((k) => [k, this.get(guildId, k)])); }
  /** list helpers */
  addTo(guildId, key, item) { const l = this.get(guildId, key); if (!l.includes(item)) l.push(item); return this.set(guildId, key, l); }
  removeFrom(guildId, key, item) { return this.set(guildId, key, this.get(guildId, key).filter((x) => x !== item)); }
  mapSet(guildId, key, k, v) { const m = this.get(guildId, key); m[k] = v; return this.set(guildId, key, m); }
  mapDel(guildId, key, k) { const m = this.get(guildId, key); delete m[k]; return this.set(guildId, key, m); }
  /** Replace the stored settings from a backup (validated key by key). */
  restore(guildId, stored) {
    const tx = this.db.transaction(() => {
      this.resetAll(guildId);
      let n = 0;
      for (const [k, v] of Object.entries(stored || {})) { if (SCHEMA[k]) { this.set(guildId, k, v); n++; } }
      return n;
    });
    return tx();
  }
}

module.exports = { Settings, SCHEMA, validate };

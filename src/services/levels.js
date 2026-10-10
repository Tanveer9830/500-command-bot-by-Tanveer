'use strict';
/** XP, levels, rewards and achievements. */
const { fmtNum } = require('../utils/text');

/** Total XP required to *reach* `level` (MEE6-style curve). */
function xpForLevel(level) {
  let total = 0;
  for (let l = 0; l < level; l++) total += 5 * l * l + 50 * l + 100;
  return total;
}
function levelFromXp(xp) {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

const ACHIEVEMENTS = {
  first_words: { name: 'First Words', description: 'Send your first counted message.' },
  chatterbox: { name: 'Chatterbox', description: 'Send 100 counted messages.' },
  level_5: { name: 'Rising Star', description: 'Reach level 5.' },
  level_10: { name: 'Veteran', description: 'Reach level 10.' },
  level_25: { name: 'Legend', description: 'Reach level 25.' },
  saver: { name: 'Saver', description: 'Hold 10,000 coins in total.' },
  tycoon: { name: 'Tycoon', description: 'Hold 100,000 coins in total.' },
  shopper: { name: 'Shopper', description: 'Buy an item from the shop.' },
  streak_7: { name: 'Dedicated', description: 'Claim your daily reward 7 days in a row.' },
  gambler: { name: 'High Roller', description: 'Win a gamble.' },
  helper: { name: 'Helpful', description: 'Receive a reputation point.' },
};

class Levels {
  constructor({ db, settings, now = () => Math.floor(Date.now() / 1000), random = Math.random }) {
    this.db = db; this.settings = settings; this.now = now; this.random = random;
  }
  get(g, u) {
    this.db.prepare('INSERT OR IGNORE INTO levels (guild_id, user_id) VALUES (?, ?)').run(g, u);
    return this.db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?').get(g, u);
  }
  rank(g, u) {
    const r = this.get(g, u);
    return this.db.prepare('SELECT COUNT(*) + 1 AS pos FROM levels WHERE guild_id = ? AND xp > ?').get(g, r.xp).pos;
  }
  top(g, limit = 10, offset = 0) {
    return this.db.prepare('SELECT user_id, xp, level, messages FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?').all(g, limit, offset);
  }
  /** Add XP (may be negative) in one transaction and recompute the level. */
  addXp(g, u, amount, { countMessage = false } = {}) {
    return this.db.transaction(() => {
      const r = this.get(g, u);
      const xp = Math.max(0, r.xp + amount);
      const level = levelFromXp(xp);
      this.db.prepare('UPDATE levels SET xp = ?, level = ?, messages = messages + ?, last_xp_at = CASE WHEN ? THEN ? ELSE last_xp_at END WHERE guild_id = ? AND user_id = ?')
        .run(xp, level, countMessage ? 1 : 0, countMessage ? 1 : 0, this.now(), g, u);
      return { xp, level, previousLevel: r.level, leveledUp: level > r.level };
    })();
  }
  setXp(g, u, xp) { const r = this.get(g, u); return this.addXp(g, u, xp - r.xp); }
  setLevel(g, u, level) { return this.setXp(g, u, xpForLevel(level)); }
  reset(g, u) { this.db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(g, u); }
  resetAll(g) { return this.db.prepare('DELETE FROM levels WHERE guild_id = ?').run(g).changes; }

  /** Called for every guild message. Returns level-up info or null. */
  onMessage(g, u, channelId) {
    const s = this.settings;
    if (!s.get(g, 'lvl_enabled')) return null;
    if (s.get(g, 'lvl_ignore_channels').includes(channelId)) return null;
    const r = this.get(g, u);
    if (this.now() - r.last_xp_at < s.get(g, 'lvl_cooldown')) return null;
    const lo = s.get(g, 'lvl_xp_min'); const hi = Math.max(lo, s.get(g, 'lvl_xp_max'));
    const mult = Number(s.get(g, 'lvl_multipliers')[channelId] || 1);
    const gain = Math.max(1, Math.round((Math.floor(this.random() * (hi - lo + 1)) + lo) * mult));
    const res = this.addXp(g, u, gain, { countMessage: true });
    return { ...res, gain };
  }

  rewardsFor(g, level) {
    const rows = this.db.prepare('SELECT level, role_id FROM level_rewards WHERE guild_id = ? AND level <= ? ORDER BY level').all(g, level);
    if (!rows.length) return [];
    return this.settings.get(g, 'lvl_stack_rewards') ? rows : [rows[rows.length - 1]];
  }

  progress(g, u) {
    const r = this.get(g, u);
    const base = xpForLevel(r.level); const next = xpForLevel(r.level + 1);
    return { ...r, base, next, into: r.xp - base, needed: next - base, pct: Math.floor(((r.xp - base) / (next - base)) * 100) };
  }

  bar(pct, width = 12) {
    const filled = Math.round((pct / 100) * width);
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${pct}%`;
  }

  // ---- achievements ------------------------------------------------------
  unlock(g, u, key) {
    if (!ACHIEVEMENTS[key]) return false;
    return this.db.prepare('INSERT OR IGNORE INTO achievements (guild_id, user_id, key) VALUES (?, ?, ?)').run(g, u, key).changes === 1;
  }
  list(g, u) { return this.db.prepare('SELECT key, ts FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY ts').all(g, u); }

  /** Evaluate criteria based on stored stats; returns the newly unlocked keys. */
  evaluate(g, u) {
    const out = [];
    const lv = this.get(g, u);
    const w = this.db.prepare('SELECT wallet, bank, streak FROM wallets WHERE guild_id = ? AND user_id = ?').get(g, u) || { wallet: 0, bank: 0, streak: 0 };
    const checks = [
      ['first_words', lv.messages >= 1], ['chatterbox', lv.messages >= 100],
      ['level_5', lv.level >= 5], ['level_10', lv.level >= 10], ['level_25', lv.level >= 25],
      ['saver', w.wallet + w.bank >= 10000], ['tycoon', w.wallet + w.bank >= 100000],
      ['streak_7', w.streak >= 7],
    ];
    for (const [k, ok] of checks) if (ok && this.unlock(g, u, k)) out.push(k);
    return out;
  }
  fmtXp(n) { return fmtNum(n); }
}

module.exports = { Levels, xpForLevel, levelFromXp, ACHIEVEMENTS };

'use strict';
/** Moderation case log (database side). Discord-side actions live in the command handlers. */
const { UserError } = require('../core/errors');

class Moderation {
  constructor({ db, now = () => Math.floor(Date.now() / 1000) }) { this.db = db; this.now = now; }

  /** Create a case with a gap-free per-guild case number. */
  createCase({ guildId, type, targetId, moderatorId, reason = null, durationSecs = null }) {
    return this.db.transaction(() => {
      const n = this.db.prepare('SELECT COALESCE(MAX(case_no), 0) + 1 AS n FROM cases WHERE guild_id = ?').get(guildId).n;
      this.db.prepare('INSERT INTO cases (guild_id, case_no, type, target_id, moderator_id, reason, expires_at, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(guildId, n, type, targetId, moderatorId, reason ? String(reason).slice(0, 500) : null, durationSecs ? this.now() + durationSecs : null, this.now());
      return this.getCase(guildId, n);
    })();
  }
  getCase(guildId, no) {
    const c = this.db.prepare('SELECT * FROM cases WHERE guild_id = ? AND case_no = ?').get(guildId, no);
    if (!c) throw new UserError(`Case #${no} does not exist.`);
    return c;
  }
  recent(guildId, limit = 10) { return this.db.prepare('SELECT * FROM cases WHERE guild_id = ? ORDER BY case_no DESC LIMIT ?').all(guildId, limit); }
  forTarget(guildId, targetId, type = null, limit = 25) {
    return type
      ? this.db.prepare('SELECT * FROM cases WHERE guild_id = ? AND target_id = ? AND type = ? ORDER BY case_no DESC LIMIT ?').all(guildId, targetId, type, limit)
      : this.db.prepare('SELECT * FROM cases WHERE guild_id = ? AND target_id = ? ORDER BY case_no DESC LIMIT ?').all(guildId, targetId, limit);
  }
  activeWarnings(guildId, targetId) {
    const expiryDays = this.db.prepare("SELECT value FROM guild_config WHERE guild_id = ? AND key = 'warn_expiry_days'").get(guildId);
    const days = expiryDays ? JSON.parse(expiryDays.value) : 0;
    const cutoff = days ? this.now() - days * 86400 : 0;
    return this.db.prepare("SELECT * FROM cases WHERE guild_id = ? AND target_id = ? AND type = 'warn' AND active = 1 AND ts >= ? ORDER BY case_no").all(guildId, targetId, cutoff);
  }
  deactivate(guildId, caseNo) {
    const c = this.getCase(guildId, caseNo);
    this.db.prepare('UPDATE cases SET active = 0 WHERE guild_id = ? AND case_no = ?').run(guildId, caseNo);
    return c;
  }
  clearWarnings(guildId, targetId) {
    return this.db.prepare("UPDATE cases SET active = 0 WHERE guild_id = ? AND target_id = ? AND type = 'warn' AND active = 1").run(guildId, targetId).changes;
  }
  updateReason(guildId, caseNo, reason) {
    this.getCase(guildId, caseNo);
    this.db.prepare('UPDATE cases SET reason = ? WHERE guild_id = ? AND case_no = ?').run(String(reason).slice(0, 500), guildId, caseNo);
  }
  /** Temp-bans that have expired and still need un-banning. */
  dueTempBans() {
    return this.db.prepare("SELECT * FROM cases WHERE type = 'tempban' AND active = 1 AND expires_at IS NOT NULL AND expires_at <= ?").all(this.now());
  }
  /** Escalation rule: threshold → action. */
  warnAction(guildId, count) {
    return this.db.prepare('SELECT action, duration FROM warn_actions WHERE guild_id = ? AND threshold = ?').get(guildId, count) || null;
  }
}

module.exports = { Moderation };

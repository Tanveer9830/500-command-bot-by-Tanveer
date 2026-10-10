'use strict';
/** Giveaways, polls and tickets: database logic (Discord messaging happens in handlers). */
const { UserError } = require('../core/errors');

class Giveaways {
  constructor({ db, now = () => Math.floor(Date.now() / 1000), random = Math.random }) { this.db = db; this.now = now; this.random = random; }
  create({ guildId, channelId, prize, winners = 1, durationSecs, hostId }) {
    if (!prize || prize.length > 200) throw new UserError('Prize must be 1-200 characters.');
    if (winners < 1 || winners > 20) throw new UserError('Winners must be between 1 and 20.');
    if (durationSecs < 10 || durationSecs > 90 * 86400) throw new UserError('Duration must be between 10 seconds and 90 days.');
    const r = this.db.prepare('INSERT INTO giveaways (guild_id, channel_id, prize, winners, ends_at, host_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guildId, channelId, prize, winners, this.now() + durationSecs, hostId);
    return this.get(guildId, Number(r.lastInsertRowid));
  }
  get(guildId, id) {
    const g = this.db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND id = ?').get(guildId, id);
    if (!g) throw new UserError(`Giveaway #${id} was not found.`);
    return g;
  }
  setMessage(id, messageId) { this.db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id); }
  entries(id) { return this.db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id).map((r) => r.user_id); }
  active(guildId) { return this.db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_at").all(guildId); }
  due() { return this.db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ?").all(this.now()); }
  enter(guildId, id, userId) {
    return this.db.transaction(() => {
      const g = this.get(guildId, id);
      if (g.status !== 'active' || g.ends_at <= this.now()) throw new UserError('This giveaway has ended.');
      if (g.host_id === userId) throw new UserError('Hosts cannot enter their own giveaway.');
      const r = this.db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, userId);
      if (!r.changes) throw new UserError('You are already entered.');
      return this.entries(id).length;
    })();
  }
  leave(guildId, id, userId) {
    this.get(guildId, id);
    const r = this.db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId);
    if (!r.changes) throw new UserError('You were not entered.');
  }
  draw(id, count, exclude = []) {
    const pool = this.entries(id).filter((u) => !exclude.includes(u));
    const out = [];
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]);
    return out;
  }
  /** Ends exactly once even if called twice (status flip inside a transaction). */
  end(guildId, id) {
    return this.db.transaction(() => {
      const g = this.get(guildId, id);
      if (g.status !== 'active') throw new UserError('This giveaway has already ended.');
      const winners = this.draw(id, g.winners);
      this.db.prepare("UPDATE giveaways SET status = 'ended', winner_ids = ?, ends_at = MIN(ends_at, ?) WHERE id = ?").run(JSON.stringify(winners), this.now(), id);
      return { giveaway: g, winners };
    })();
  }
  reroll(guildId, id, count = 1) {
    const g = this.get(guildId, id);
    if (g.status !== 'ended') throw new UserError('Only ended giveaways can be rerolled.');
    const prev = JSON.parse(g.winner_ids);
    const winners = this.draw(id, count, prev);
    if (!winners.length) throw new UserError('No other eligible entrants.');
    this.db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify([...prev, ...winners]), id);
    return winners;
  }
  cancel(guildId, id) {
    const g = this.get(guildId, id);
    if (g.status !== 'active') throw new UserError('Only active giveaways can be cancelled.');
    this.db.prepare("UPDATE giveaways SET status = 'cancelled' WHERE id = ?").run(id);
    return g;
  }
}

class Polls {
  constructor({ db, now = () => Math.floor(Date.now() / 1000) }) { this.db = db; this.now = now; }
  create({ guildId, channelId, question, options, multi = false, durationSecs = null, authorId }) {
    if (!question || question.length > 300) throw new UserError('Question must be 1-300 characters.');
    if (options.length < 2 || options.length > 10) throw new UserError('Polls need between 2 and 10 options.');
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new UserError('Poll options must be unique.');
    if (options.some((o) => !o || o.length > 80)) throw new UserError('Each option must be 1-80 characters.');
    const r = this.db.prepare('INSERT INTO polls (guild_id, channel_id, question, options, multi, ends_at, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(guildId, channelId, question, JSON.stringify(options), multi ? 1 : 0, durationSecs ? this.now() + durationSecs : null, authorId);
    return this.get(guildId, Number(r.lastInsertRowid));
  }
  get(guildId, id) {
    const p = this.db.prepare('SELECT * FROM polls WHERE guild_id = ? AND id = ?').get(guildId, id);
    if (!p) throw new UserError(`Poll #${id} was not found.`);
    return { ...p, options: JSON.parse(p.options) };
  }
  setMessage(id, messageId) { this.db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(messageId, id); }
  vote(guildId, id, userId, idx) {
    return this.db.transaction(() => {
      const p = this.get(guildId, id);
      if (p.status !== 'open' || (p.ends_at && p.ends_at <= this.now())) throw new UserError('This poll is closed.');
      if (!Number.isInteger(idx) || idx < 0 || idx >= p.options.length) throw new UserError(`Choose an option between 1 and ${p.options.length}.`);
      const has = this.db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_idx = ?').get(id, userId, idx);
      if (p.multi) {
        if (has) { this.db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_idx = ?').run(id, userId, idx); return 'removed'; }
      } else {
        if (has) { this.db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(id, userId); return 'removed'; }
        this.db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(id, userId);
      }
      this.db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_idx) VALUES (?, ?, ?)').run(id, userId, idx);
      return 'added';
    })();
  }
  results(guildId, id) {
    const p = this.get(guildId, id);
    const counts = p.options.map(() => 0);
    for (const r of this.db.prepare('SELECT option_idx, COUNT(*) c FROM poll_votes WHERE poll_id = ? GROUP BY option_idx').all(id)) counts[r.option_idx] = r.c;
    const voters = this.db.prepare('SELECT COUNT(DISTINCT user_id) c FROM poll_votes WHERE poll_id = ?').get(id).c;
    return { poll: p, counts, voters, total: counts.reduce((a, b) => a + b, 0) };
  }
  close(guildId, id) { const p = this.get(guildId, id); if (p.status !== 'open') throw new UserError('Already closed.'); this.db.prepare("UPDATE polls SET status = 'closed' WHERE id = ?").run(id); return p; }
  due() { return this.db.prepare("SELECT * FROM polls WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at <= ?").all(this.now()); }
  list(guildId, status = 'open', limit = 10) { return this.db.prepare('SELECT id, question, status, ends_at FROM polls WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT ?').all(guildId, status, limit); }
  bar(count, total, width = 14) { const f = total ? Math.round((count / total) * width) : 0; return '█'.repeat(f) + '░'.repeat(width - f); }
}

class Tickets {
  constructor({ db, settings, now = () => Math.floor(Date.now() / 1000) }) { this.db = db; this.settings = settings; this.now = now; }
  openCount(guildId, userId) { return this.db.prepare("SELECT COUNT(*) c FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'").get(guildId, userId).c; }
  isBlacklisted(guildId, userId) { return Boolean(this.db.prepare('SELECT 1 FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?').get(guildId, userId)); }
  create({ guildId, userId, subject }) {
    return this.db.transaction(() => {
      if (this.isBlacklisted(guildId, userId)) throw new UserError('You are not allowed to open tickets in this server.');
      const limit = this.settings.get(guildId, 'ticket_limit');
      if (this.openCount(guildId, userId) >= limit) throw new UserError(`You already have ${limit} open ticket(s).`);
      const n = this.db.prepare('SELECT COALESCE(MAX(ticket_no), 0) + 1 AS n FROM tickets WHERE guild_id = ?').get(guildId).n;
      this.db.prepare('INSERT INTO tickets (guild_id, ticket_no, user_id, subject) VALUES (?, ?, ?, ?)').run(guildId, n, userId, (subject || 'Support request').slice(0, 200));
      return this.byNo(guildId, n);
    })();
  }
  byNo(guildId, no) { const t = this.db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND ticket_no = ?').get(guildId, no); if (!t) throw new UserError(`Ticket #${no} was not found.`); return t; }
  byChannel(guildId, channelId) { return this.db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId) || null; }
  setChannel(id, channelId) { this.db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ?').run(channelId, id); }
  close(guildId, no, closedBy) {
    return this.db.transaction(() => {
      const t = this.byNo(guildId, no);
      if (t.status !== 'open') throw new UserError('That ticket is already closed.');
      this.db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?").run(this.now(), closedBy, t.id);
      return t;
    })();
  }
  claim(guildId, no, staffId) {
    const t = this.byNo(guildId, no);
    if (t.status !== 'open') throw new UserError('That ticket is closed.');
    if (t.claimed_by && t.claimed_by !== staffId) throw new UserError('Another staff member already claimed this ticket.');
    this.db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(staffId, t.id);
    return t;
  }
  list(guildId, status = 'open', limit = 15) { return this.db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND status = ? ORDER BY ticket_no DESC LIMIT ?').all(guildId, status, limit); }
  mine(guildId, userId, limit = 10) { return this.db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? ORDER BY ticket_no DESC LIMIT ?').all(guildId, userId, limit); }
  stats(guildId) {
    const r = this.db.prepare("SELECT COUNT(*) total, SUM(status = 'open') open, SUM(status = 'closed') closed, AVG(CASE WHEN closed_at IS NOT NULL THEN closed_at - created_at END) avg_secs FROM tickets WHERE guild_id = ?").get(guildId);
    return { total: r.total, open: r.open || 0, closed: r.closed || 0, avgSecs: Math.round(r.avg_secs || 0) };
  }
}

module.exports = { Giveaways, Polls, Tickets };

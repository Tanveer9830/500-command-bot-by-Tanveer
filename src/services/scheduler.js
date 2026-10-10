'use strict';
/**
 * Background work: reminders, scheduled messages, giveaway/poll endings, temp-ban expiry,
 * automatic backups and housekeeping. One timer; every task is isolated so one failure
 * never stops the others. Rows are claimed (status flipped) BEFORE delivery so a crash can
 * never cause a message to be sent twice.
 */
const fs = require('node:fs');
const path = require('node:path');
const database = require('../database');
const { snapshotGuild } = require('../commands/config');
const { finishGiveaway, pollView } = require('../commands/community');
const { toPayload } = require('../core/reply');
const log = require('../utils/logger').child('scheduler');

const BATCH = 50;
const KEEP_AUTOSAVES = 5;
const KEEP_DB_BACKUPS = 7;

class Scheduler {
  constructor({ svc, intervalMs = 15_000 }) { this.svc = svc; this.db = svc.db; this.intervalMs = intervalMs; this.timer = null; this.running = false; this.lastDbBackup = 0; this.lastAutosave = new Map(); }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch((e) => log.error('tick failed', { err: e })); }, this.intervalMs);
    this.timer.unref();
    log.info('scheduler started', { intervalMs: this.intervalMs });
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (this.running) return; // never overlap
    this.running = true;
    try {
      for (const [name, fn] of [['reminders', () => this.reminders()], ['scheduled', () => this.scheduledMessages()], ['giveaways', () => this.giveaways()], ['polls', () => this.polls()], ['tempbans', () => this.tempBans()], ['autosave', () => this.autoBackups()], ['dbbackup', () => this.dbBackup()], ['housekeeping', () => this.housekeeping()]]) {
        try { await fn(); } catch (e) { log.error(`task ${name} failed`, { err: e }); }
      }
    } finally { this.running = false; }
  }

  async reminders() {
    const { svc, db } = this; const now = svc.now();
    const due = db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?").all(now, BATCH);
    for (const r of due) {
      // claim first
      const next = r.repeat_secs ? r.due_at + r.repeat_secs * Math.max(1, Math.ceil((now - r.due_at + 1) / r.repeat_secs)) : null;
      const claimed = db.prepare(next ? 'UPDATE reminders SET due_at = ? WHERE id = ? AND status = \'pending\' AND due_at = ?' : "UPDATE reminders SET status = 'sent' WHERE id = ? AND status = 'pending' AND due_at = ?")
        .run(...(next ? [next, r.id, r.due_at] : [r.id, r.due_at])).changes;
      if (!claimed) continue;
      const pref = db.prepare("SELECT value FROM user_prefs WHERE user_id = ? AND key = 'dm_reminders'").get(r.user_id);
      const text = `⏰ **Reminder #${r.id}:** ${r.text}${next ? '\n_(repeating)_' : ''}`;
      let sent = false;
      if (pref && pref.value === 'on') sent = await svc.dm(r.user_id, { content: text });
      if (!sent && r.channel_id) {
        const u = svc.client && svc.client.users.cache.get(r.user_id);
        sent = Boolean(await svc.sendToChannel(r.channel_id, { content: `${u ? `${u.username}, ` : ''}${text}` }));
      }
      if (!sent) sent = await svc.dm(r.user_id, { content: text });
      if (!sent && !next) db.prepare("UPDATE reminders SET status = 'failed' WHERE id = ?").run(r.id);
    }
  }

  async scheduledMessages() {
    const { svc, db } = this; const now = svc.now();
    const due = db.prepare("SELECT * FROM scheduled_messages WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?").all(now, BATCH);
    for (const m of due) {
      const next = m.repeat_secs ? m.due_at + m.repeat_secs * Math.max(1, Math.ceil((now - m.due_at + 1) / m.repeat_secs)) : null;
      const claimed = db.prepare(next ? "UPDATE scheduled_messages SET due_at = ? WHERE id = ? AND status = 'pending' AND due_at = ?" : "UPDATE scheduled_messages SET status = 'sent' WHERE id = ? AND status = 'pending' AND due_at = ?")
        .run(...(next ? [next, m.id, m.due_at] : [m.id, m.due_at])).changes;
      if (!claimed) continue;
      const ok = await svc.sendToChannel(m.channel_id, { content: m.content });
      if (!ok && !next) db.prepare("UPDATE scheduled_messages SET status = 'failed' WHERE id = ?").run(m.id);
    }
  }

  async giveaways() {
    for (const g of this.svc.giveaways.due().slice(0, BATCH)) {
      try { await finishGiveaway(this.svc, g.guild_id, g.id); } catch (e) { log.warn('giveaway end failed', { id: g.id, err: e.message }); }
    }
  }

  async polls() {
    const { svc } = this;
    for (const p of svc.polls.due().slice(0, BATCH)) {
      try {
        svc.polls.close(p.guild_id, p.id);
        const res = svc.polls.results(p.guild_id, p.id);
        if (p.channel_id && p.message_id) await svc.editMessage(p.channel_id, p.message_id, toPayload(pollView({ svc }, res, true)));
      } catch (e) { log.warn('poll close failed', { id: p.id, err: e.message }); }
    }
  }

  async tempBans() {
    const { svc, db } = this;
    for (const c of svc.moderation.dueTempBans().slice(0, BATCH)) {
      db.prepare('UPDATE cases SET active = 0 WHERE id = ?').run(c.id);
      const guild = svc.client && svc.client.guilds.cache.get(c.guild_id);
      if (!guild) continue;
      try {
        await guild.members.unban(c.target_id, `Temporary ban expired (case #${c.case_no})`);
        svc.moderation.createCase({ guildId: c.guild_id, type: 'unban', targetId: c.target_id, moderatorId: svc.client.user ? svc.client.user.id : 'system', reason: `Temporary ban from case #${c.case_no} expired` });
      } catch (e) { log.debug('tempban expiry: unban skipped', { err: e.message }); }
    }
  }

  async autoBackups() {
    const { svc, db } = this; if (!svc.client) return; const now = svc.now();
    for (const guild of svc.client.guilds.cache.values()) {
      const hours = svc.settings.get(guild.id, 'backup_interval_h'); if (!hours) continue;
      const last = db.prepare("SELECT MAX(ts) t FROM backups WHERE guild_id = ? AND name LIKE 'autosave-%'").get(guild.id).t || 0;
      if (now - last < hours * 3600) continue;
      const name = `autosave-${new Date(now * 1000).toISOString().slice(0, 13).replace(/[-T]/g, '')}`;
      db.prepare('INSERT OR REPLACE INTO backups (guild_id, name, data, created_by, ts) VALUES (?, ?, ?, ?, ?)').run(guild.id, name, JSON.stringify(snapshotGuild(svc, guild)), 'system', now);
      db.prepare("DELETE FROM backups WHERE guild_id = ? AND name LIKE 'autosave-%' AND id NOT IN (SELECT id FROM backups WHERE guild_id = ? AND name LIKE 'autosave-%' ORDER BY ts DESC, id DESC LIMIT ?)").run(guild.id, guild.id, KEEP_AUTOSAVES);
    }
  }

  /** One consistent SQLite file copy per day, pruned to the newest few. */
  async dbBackup() {
    const { svc } = this; const dir = svc.config.backupDir;
    if (!dir || svc.config.dbPath === ':memory:' || Date.now() - this.lastDbBackup < 86_400_000) return;
    this.lastDbBackup = Date.now();
    fs.mkdirSync(dir, { recursive: true });
    const files = () => fs.readdirSync(dir).filter((f) => f.startsWith('auto-') && f.endsWith('.sqlite')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    if (files()[0] && Date.now() - files()[0].t < 86_400_000) return;
    database.backupTo(this.db, dir, 'auto');
    for (const old of files().slice(KEEP_DB_BACKUPS)) fs.rmSync(path.join(dir, old.f), { force: true });
  }

  async housekeeping() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(this.svc.now());
    this.db.prepare('DELETE FROM cooldowns WHERE until < ?').run(this.svc.now() - 86_400);
    this.svc.rateLimiter.sweep();
  }
}

module.exports = { Scheduler };

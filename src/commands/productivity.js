'use strict';
/** Personal productivity: reminders, to-dos, notes, AFK, quotes, timers, reports. */
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { fmtNum, truncate, safe, ts, formatDuration, parseDuration } = require('../utils/text');

const idOpt = (what) => ({ name: 'id', type: 'integer', description: `${what} ID`, required: true, min: 1, max: 2_000_000_000 });
const MAX_PER_USER = 50;
const stopwatches = new Map(); // userId -> { start, laps[] } — intentionally in-memory

module.exports = function register(registry) {
  // ------------------------------------------------------------- reminders
  const R = registry.group({ name: 'reminder', description: 'Personal reminders', category: 'Productivity', aliases: ['remind', 'rm'] });
  const mine = (ctx, id) => { const r = ctx.db.prepare("SELECT * FROM reminders WHERE id = ? AND user_id = ? AND status = 'pending'").get(id, ctx.user.id); if (!r) throw new UserError('No such reminder of yours.'); return r; };
  const dur = { name: 'in', type: 'duration', description: 'When, e.g. 10m, 2h, 1d', required: true, min: 10, max: 365 * 86400 };
  const txt = { name: 'text', type: 'string', description: 'What to remind you about', required: true, maxLength: 300, rest: true };
  const create = (ctx, secs, text, repeat) => {
    const n = ctx.db.prepare("SELECT COUNT(*) n FROM reminders WHERE user_id = ? AND status = 'pending'").get(ctx.user.id).n;
    if (n >= MAX_PER_USER) throw new UserError(`You can have at most ${MAX_PER_USER} active reminders.`);
    const due = ctx.svc.now() + secs;
    const id = Number(ctx.db.prepare('INSERT INTO reminders (user_id, guild_id, channel_id, text, due_at, repeat_secs) VALUES (?, ?, ?, ?, ?, ?)').run(ctx.user.id, ctx.guildId, ctx.channel && ctx.channel.id, text, due, repeat || null).lastInsertRowid);
    return { id, due };
  };
  R.action('add', { description: 'Remind me after a delay', aliases: ['remindme'], options: [dur, txt] }, (ctx) => { const r = create(ctx, ctx.args.in, ctx.args.text); return H.ok(`I will remind you ${ts(r.due)} (#${r.id}).`); });
  R.action('repeat', { description: 'Repeating reminder', options: [{ ...dur, name: 'every', min: 300, description: 'Interval, min 5m' }, txt] }, (ctx) => { const r = create(ctx, ctx.args.every, ctx.args.text, ctx.args.every); return H.ok(`Repeating every ${formatDuration(ctx.args.every)}; next ${ts(r.due)} (#${r.id}).`); });
  R.action('list', { description: 'Your pending reminders' }, (ctx) => H.embed(ctx, { title: 'Your reminders', description: H.listLines(ctx.db.prepare("SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' ORDER BY due_at LIMIT 50").all(ctx.user.id), (r) => `**#${r.id}** ${ts(r.due_at)}${r.repeat_secs ? ' 🔁' : ''} — ${safe(truncate(r.text, 80))}`, 15), ephemeral: true }));
  R.action('info', { description: 'Details of a reminder', options: [idOpt('Reminder')] }, (ctx) => { const r = mine(ctx, ctx.args.id); return H.embed(ctx, { title: `Reminder #${r.id}`, description: safe(r.text), fields: [{ name: 'Due', value: ts(r.due_at, 'F'), inline: true }, { name: 'Repeats', value: r.repeat_secs ? formatDuration(r.repeat_secs) : 'no', inline: true }] }); });
  R.action('edit', { description: 'Change reminder text', options: [idOpt('Reminder'), txt] }, (ctx) => { mine(ctx, ctx.args.id); ctx.db.prepare('UPDATE reminders SET text = ? WHERE id = ?').run(ctx.args.text, ctx.args.id); return H.ok('Reminder updated.'); });
  R.action('delete', { description: 'Cancel a reminder', aliases: ['unremind'], options: [idOpt('Reminder')] }, (ctx) => { mine(ctx, ctx.args.id); ctx.db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ?").run(ctx.args.id); return H.ok('Reminder cancelled.'); });
  R.action('clear', { description: 'Cancel all your reminders' }, (ctx) => H.ok(`Cancelled ${ctx.db.prepare("UPDATE reminders SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'").run(ctx.user.id).changes} reminder(s).`));

  // ----------------------------------------------------------------- todos
  const T = registry.group({ name: 'todo', description: 'Personal to-do list', category: 'Productivity', aliases: ['todos'] });
  const todo = (ctx, id) => { const r = ctx.db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, ctx.user.id); if (!r) throw new UserError('No such to-do of yours.'); return r; };
  const line = (t) => `${t.done ? '✅' : ['🔵', '🟡', '🔴'][t.priority - 1] || '⬜'} **#${t.id}** ${t.done ? `~~${safe(truncate(t.text, 80))}~~` : safe(truncate(t.text, 80))}`;
  T.action('add', { description: 'Add a to-do', options: [{ name: 'text', type: 'string', description: 'Task', required: true, maxLength: 200, rest: true }] }, (ctx) => {
    if (ctx.db.prepare('SELECT COUNT(*) n FROM todos WHERE user_id = ?').get(ctx.user.id).n >= 100) throw new UserError('You can keep at most 100 to-dos.');
    const id = Number(ctx.db.prepare('INSERT INTO todos (user_id, text) VALUES (?, ?)').run(ctx.user.id, ctx.args.text).lastInsertRowid); return H.ok(`Added to-do **#${id}**.`);
  });
  T.action('list', { description: 'Show your to-dos', options: [{ name: 'filter', type: 'string', description: 'open, done or all', choices: ['open', 'done', 'all'], default: 'open' }] }, (ctx) => {
    const f = ctx.args.filter; const rows = ctx.db.prepare(`SELECT * FROM todos WHERE user_id = ? ${f === 'open' ? 'AND done = 0' : f === 'done' ? 'AND done = 1' : ''} ORDER BY done, priority DESC, id LIMIT 100`).all(ctx.user.id);
    return H.embed(ctx, { title: `To-dos (${f})`, description: H.listLines(rows, line, 25), ephemeral: true });
  });
  T.action('done', { description: 'Mark a to-do as done', aliases: ['tick'], options: [idOpt('To-do')] }, (ctx) => { todo(ctx, ctx.args.id); ctx.db.prepare('UPDATE todos SET done = 1 WHERE id = ?').run(ctx.args.id); return H.ok('Nicely done!'); });
  T.action('undone', { description: 'Re-open a to-do', options: [idOpt('To-do')] }, (ctx) => { todo(ctx, ctx.args.id); ctx.db.prepare('UPDATE todos SET done = 0 WHERE id = ?').run(ctx.args.id); return H.ok('Re-opened.'); });
  T.action('remove', { description: 'Delete a to-do', options: [idOpt('To-do')] }, (ctx) => { todo(ctx, ctx.args.id); ctx.db.prepare('DELETE FROM todos WHERE id = ?').run(ctx.args.id); return H.ok('Deleted.'); });
  T.action('edit', { description: 'Edit a to-do', options: [idOpt('To-do'), { name: 'text', type: 'string', description: 'New text', required: true, maxLength: 200, rest: true }] }, (ctx) => { todo(ctx, ctx.args.id); ctx.db.prepare('UPDATE todos SET text = ? WHERE id = ?').run(ctx.args.text, ctx.args.id); return H.ok('Updated.'); });
  T.action('priority', { description: 'Set priority (1 low, 3 high)', options: [idOpt('To-do'), { name: 'level', type: 'integer', description: '1-3', required: true, min: 1, max: 3 }] }, (ctx) => { todo(ctx, ctx.args.id); ctx.db.prepare('UPDATE todos SET priority = ? WHERE id = ?').run(ctx.args.level, ctx.args.id); return H.ok('Priority set.'); });
  T.action('clear', { description: 'Delete finished (or all) to-dos', options: [{ name: 'which', type: 'string', description: 'done or all', choices: ['done', 'all'], default: 'done' }] }, (ctx) => H.ok(`Deleted ${ctx.db.prepare(`DELETE FROM todos WHERE user_id = ? ${ctx.args.which === 'done' ? 'AND done = 1' : ''}`).run(ctx.user.id).changes} to-do(s).`));
  T.action('stats', { description: 'Your completion rate' }, (ctx) => { const r = ctx.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(done),0) d FROM todos WHERE user_id = ?').get(ctx.user.id); return `📋 ${r.d}/${r.n} done (${H.percent(r.d, r.n)}%).`; });
  T.action('search', { description: 'Search your to-dos', options: [{ name: 'query', type: 'string', description: 'Text to find', required: true, maxLength: 60, rest: true }] }, (ctx) => H.embed(ctx, { title: 'To-do search', description: H.listLines(ctx.db.prepare('SELECT * FROM todos WHERE user_id = ? AND text LIKE ? ESCAPE \'\\\' LIMIT 25').all(ctx.user.id, `%${ctx.args.query.replace(/[\\%_]/g, '\\$&')}%`), line, 25), ephemeral: true }));

  // ----------------------------------------------------------------- notes
  const N = registry.group({ name: 'note', description: 'Private notes', category: 'Productivity', aliases: ['notes'] });
  const note = (ctx, id) => { const r = ctx.db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, ctx.user.id); if (!r) throw new UserError('No such note of yours.'); return r; };
  N.action('add', { description: 'Save a note', options: [{ name: 'title', type: 'string', description: 'Title (use quotes for spaces)', required: true, maxLength: 60 }, { name: 'body', type: 'string', description: 'Note text', required: true, maxLength: 1500, rest: true }] }, (ctx) => {
    if (ctx.db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = ?').get(ctx.user.id).n >= 100) throw new UserError('You can keep at most 100 notes.');
    return { content: H.ok(`Saved note **#${Number(ctx.db.prepare('INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)').run(ctx.user.id, ctx.args.title, ctx.args.body).lastInsertRowid)}**.`), ephemeral: true };
  });
  N.action('list', { description: 'Your notes' }, (ctx) => H.embed(ctx, { title: 'Your notes', description: H.listLines(ctx.db.prepare('SELECT id, title FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(ctx.user.id), (n) => `**#${n.id}** ${safe(n.title)}`, 25), ephemeral: true }));
  N.action('view', { description: 'Read a note', options: [idOpt('Note')] }, (ctx) => { const n = note(ctx, ctx.args.id); return H.embed(ctx, { title: safe(n.title), description: safe(n.body), footer: { text: `Saved ${new Date(n.ts * 1000).toISOString().slice(0, 10)}` }, ephemeral: true }); });
  N.action('edit', { description: 'Replace the text of a note', options: [idOpt('Note'), { name: 'body', type: 'string', description: 'New text', required: true, maxLength: 1500, rest: true }] }, (ctx) => { note(ctx, ctx.args.id); ctx.db.prepare('UPDATE notes SET body = ? WHERE id = ?').run(ctx.args.body, ctx.args.id); return { content: H.ok('Note updated.'), ephemeral: true }; });
  N.action('delete', { description: 'Delete a note', options: [idOpt('Note')] }, (ctx) => { note(ctx, ctx.args.id); ctx.db.prepare('DELETE FROM notes WHERE id = ?').run(ctx.args.id); return { content: H.ok('Note deleted.'), ephemeral: true }; });
  N.action('search', { description: 'Search your notes', options: [{ name: 'query', type: 'string', description: 'Text to find', required: true, maxLength: 60, rest: true }] }, (ctx) => { const q = `%${ctx.args.query.replace(/[\\%_]/g, '\\$&')}%`; return H.embed(ctx, { title: 'Note search', description: H.listLines(ctx.db.prepare("SELECT id, title FROM notes WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') LIMIT 25").all(ctx.user.id, q, q), (n) => `**#${n.id}** ${safe(n.title)}`, 25), ephemeral: true }); });
  N.action('clear', { description: 'Delete all your notes', options: [{ name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] }] }, (ctx) => ({ content: H.ok(`Deleted ${ctx.db.prepare('DELETE FROM notes WHERE user_id = ?').run(ctx.user.id).changes} note(s).`), ephemeral: true }));

  // ------------------------------------------------------------------- AFK
  const A = registry.group({ name: 'afk', description: 'Away status', category: 'Social', defaultSub: 'set' });
  A.action('set', { description: 'Mark yourself as away', guildOnly: true, options: [{ name: 'reason', type: 'string', description: 'Why you are away', maxLength: 100, rest: true }] }, (ctx) => { ctx.db.prepare('INSERT INTO afk (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, since = excluded.since').run(ctx.guildId, ctx.user.id, ctx.args.reason || null, ctx.svc.now()); return `💤 You are now AFK${ctx.args.reason ? `: ${safe(ctx.args.reason)}` : ''}.`; });
  A.action('clear', { description: 'Remove your away status', guildOnly: true }, (ctx) => { const n = ctx.db.prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ?').run(ctx.guildId, ctx.user.id).changes; return n ? '👋 Welcome back! AFK removed.' : 'You were not AFK.'; });
  A.action('status', { description: "Check if someone is away", guildOnly: true, options: [{ name: 'user', type: 'user', description: 'User', required: true }] }, (ctx) => { const r = ctx.db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, ctx.args.user.id); return r ? `💤 **${safe(ctx.args.user.username)}** has been AFK since ${ts(r.since)}${r.reason ? `: ${safe(r.reason)}` : ''}.` : `**${safe(ctx.args.user.username)}** is not AFK.`; });
  A.action('list', { description: 'Everyone currently away', guildOnly: true }, async (ctx) => { const rows = ctx.db.prepare('SELECT * FROM afk WHERE guild_id = ? ORDER BY since DESC LIMIT 25').all(ctx.guildId); const out = []; for (const r of rows) { const m = await ctx.getMember({ id: r.user_id }); out.push(`💤 ${safe(m ? m.displayName : r.user_id)} — ${ts(r.since)}${r.reason ? `: ${safe(r.reason)}` : ''}`); } return H.embed(ctx, { title: 'Away members', description: out.join('\n') || '_nobody_' }); });

  // ---------------------------------------------------------------- quotes
  const Q = registry.group({ name: 'quote', description: 'Server quote book', category: 'Social', aliases: ['quotes'], defaultSub: 'random' });
  const QA = (sub, spec, run) => Q.action(sub, { guildOnly: true, ...spec }, run);
  const qline = (q) => `**#${q.id}** “${safe(truncate(q.text, 200))}” — <@${q.author_id}>`;
  QA('add', { description: 'Save a quote', options: [{ name: 'user', type: 'user', description: 'Who said it', required: true }, { name: 'text', type: 'string', description: 'What they said', required: true, maxLength: 400, rest: true }] }, (ctx) => { const id = Number(ctx.db.prepare('INSERT INTO quotes (guild_id, author_id, text, by) VALUES (?, ?, ?, ?)').run(ctx.guildId, ctx.args.user.id, ctx.args.text, ctx.user.id).lastInsertRowid); return H.ok(`Saved quote **#${id}**.`); });
  QA('random', { description: 'A random quote' }, (ctx) => { const q = ctx.db.prepare('SELECT * FROM quotes WHERE guild_id = ? ORDER BY ABS(RANDOM() % 1000003) LIMIT 1').get(ctx.guildId); return q ? qline(q) : 'No quotes saved yet. Add one with `quote add`.'; });
  QA('show', { description: 'Show a quote by ID', options: [idOpt('Quote')] }, (ctx) => { const q = ctx.db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND id = ?').get(ctx.guildId, ctx.args.id); if (!q) throw new UserError('No such quote.'); return qline(q); });
  QA('list', { description: 'Browse quotes', options: [{ name: 'page', type: 'integer', description: 'Page', min: 1, max: 1000, default: 1 }] }, (ctx) => H.embed(ctx, { title: 'Quotes', description: H.listLines(ctx.db.prepare('SELECT * FROM quotes WHERE guild_id = ? ORDER BY id DESC LIMIT 10 OFFSET ?').all(ctx.guildId, (ctx.args.page - 1) * 10), qline, 10) }));
  QA('user', { description: 'A random quote from one person', options: [{ name: 'user', type: 'user', description: 'Who', required: true }] }, (ctx) => { const q = ctx.db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND author_id = ? ORDER BY RANDOM() LIMIT 1').get(ctx.guildId, ctx.args.user.id); return q ? qline(q) : 'No quotes from that user.'; });
  QA('search', { description: 'Search quotes', options: [{ name: 'query', type: 'string', description: 'Text', required: true, maxLength: 60, rest: true }] }, (ctx) => H.embed(ctx, { title: 'Quote search', description: H.listLines(ctx.db.prepare("SELECT * FROM quotes WHERE guild_id = ? AND text LIKE ? ESCAPE '\\' LIMIT 10").all(ctx.guildId, `%${ctx.args.query.replace(/[\\%_]/g, '\\$&')}%`), qline, 10) }));
  QA('count', { description: 'How many quotes are saved' }, (ctx) => `📚 ${fmtNum(ctx.db.prepare('SELECT COUNT(*) n FROM quotes WHERE guild_id = ?').get(ctx.guildId).n)} quote(s).`);
  QA('delete', { description: 'Delete a quote you saved (staff can delete any)', options: [idOpt('Quote')] }, (ctx) => {
    const q = ctx.db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND id = ?').get(ctx.guildId, ctx.args.id); if (!q) throw new UserError('No such quote.');
    const staff = ctx.member && ctx.member.permissions && ctx.member.permissions.has('ManageMessages');
    if (q.by !== ctx.user.id && !staff) throw new UserError('Only the person who saved a quote, or staff with Manage Messages, can delete it.');
    ctx.db.prepare('DELETE FROM quotes WHERE id = ?').run(q.id); return H.ok('Quote deleted.');
  });

  // ---------------------------------------------------------------- timers
  const TM = registry.group({ name: 'timer', description: 'Timers, stopwatch and countdowns', category: 'Productivity' });
  TM.subgroup('stopwatch', 'A personal stopwatch');
  TM.action('pomodoro', { description: 'Start a 25-minute focus session with a 5-minute break reminder', options: [] }, (ctx) => {
    const a = ctx.svc.now() + 25 * 60; const b = a + 5 * 60; const ins = ctx.db.prepare('INSERT INTO reminders (user_id, guild_id, channel_id, text, due_at) VALUES (?, ?, ?, ?, ?)');
    ctx.db.transaction(() => { ins.run(ctx.user.id, ctx.guildId, ctx.channel && ctx.channel.id, '🍅 Focus session finished — take a 5 minute break!', a); ins.run(ctx.user.id, ctx.guildId, ctx.channel && ctx.channel.id, '🍅 Break is over — ready for another round?', b); })();
    return `🍅 Focus started. I will remind you ${ts(a)} and again ${ts(b)}.`;
  });
  TM.action('countdown', { description: 'Days until a date (YYYY-MM-DD)', options: [{ name: 'date', type: 'string', description: 'YYYY-MM-DD', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/, patternHelp: 'use YYYY-MM-DD', maxLength: 10 }] }, (ctx) => {
    const t = Date.parse(`${ctx.args.date}T00:00:00Z`); if (!Number.isFinite(t)) throw new UserError('That is not a valid date.');
    const d = Math.ceil((t - ctx.svc.now() * 1000) / 86400000); return d >= 0 ? `⏳ **${d}** day(s) until ${ctx.args.date}.` : `📅 ${ctx.args.date} was **${-d}** day(s) ago.`;
  });
  const sw = (sub, description, run) => TM.action(sub, { description, subgroup: 'stopwatch' }, run);
  sw('start', 'Start your stopwatch', (ctx) => { stopwatches.set(ctx.user.id, { start: Date.now(), laps: [] }); return '⏱️ Stopwatch started.'; });
  sw('lap', 'Record a lap', (ctx) => { const s = stopwatches.get(ctx.user.id); if (!s) throw new UserError('Start the stopwatch first.'); s.laps.push(Date.now() - s.start); return `⏱️ Lap ${s.laps.length}: ${formatDuration(Math.round(s.laps[s.laps.length - 1] / 1000))}`; });
  sw('check', 'See the elapsed time', (ctx) => { const s = stopwatches.get(ctx.user.id); if (!s) throw new UserError('No stopwatch running.'); return `⏱️ ${formatDuration(Math.round((Date.now() - s.start) / 1000))} elapsed, ${s.laps.length} lap(s).`; });
  sw('stop', 'Stop and show the result', (ctx) => { const s = stopwatches.get(ctx.user.id); if (!s) throw new UserError('No stopwatch running.'); stopwatches.delete(ctx.user.id); return `⏹️ Stopped at **${formatDuration(Math.round((Date.now() - s.start) / 1000))}** with ${s.laps.length} lap(s).`; });

  // --------------------------------------------------------------- reports
  const RP = registry.group({ name: 'report', description: 'Report problems to the moderators', category: 'Safety' });
  const send = async (ctx, title, body) => {
    const ch = ctx.cfg('report_channel'); if (!ch) throw new UserError('This server has no report channel configured. Ask an admin to run `/settings` → report channel.');
    const m = await ctx.svc.sendToChannel(ch, { embeds: [{ color: 0xffb020, title, description: truncate(body, 3500), footer: { text: `Reported by ${ctx.user.username} (${ctx.user.id})` } }] });
    if (!m) throw new UserError('I could not post to the report channel.');
    return '📨 Thanks — your report was sent to the moderators.';
  };
  RP.action('user', { description: 'Report a member', guildOnly: true, cooldown: 30, options: [{ name: 'user', type: 'user', description: 'Who', required: true }, { name: 'reason', type: 'string', description: 'What happened', required: true, maxLength: 800, rest: true }] }, (ctx) => { if (ctx.args.user.id === ctx.user.id) throw new UserError('You cannot report yourself.'); return send(ctx, '🚩 User report', `Reported: ${safe(ctx.args.user.username)} (${ctx.args.user.id})\nChannel: <#${ctx.channel.id}>\n\n${safe(ctx.args.reason)}`); });
  RP.action('issue', { description: 'Report a problem (not about a member)', guildOnly: true, cooldown: 30, options: [{ name: 'text', type: 'string', description: 'Describe it', required: true, maxLength: 800, rest: true }] }, (ctx) => send(ctx, '🛠️ Issue report', safe(ctx.args.text)));
};
void parseDuration;

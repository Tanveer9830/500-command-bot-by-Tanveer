'use strict';
/** Behavioral tests for polls, giveaways, tickets, suggestions, to-dos, notes, reminders, reputation, profile, AFK, sticky. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/mock');

const ok = (r) => { assert.equal(r.status, 'ok', JSON.stringify(r.message || r)); return r.result; };
const text = (r) => (typeof r === 'string' ? r : r.content || JSON.stringify(r));

test('polls: single-choice vote replaces the previous vote; only author/mod can close; closed polls reject votes', async () => {
  const e = makeEnv();
  ok(await e.run('poll.create', { question: 'Fav?', options: 'a | b | c' }, { as: 'regular' }));
  ok(await e.run('poll.vote', { id: 1, option: 2 }, { as: 'regular' }));
  ok(await e.run('poll.vote', { id: 1, option: 3 }, { as: 'regular' }));
  const res = ok(await e.run('poll.results', { id: 1 }, { as: 'regular' }));
  assert.match(res.embed.description, /██████████████ 1 \(100%\)/); assert.match(res.embed.footer.text, /1 voter/);
  assert.equal((await e.run('poll.close', { id: 1 }, { as: 'victim' })).status, 'usage');
  ok(await e.run('poll.close', { id: 1 }, { as: 'regular' }));
  assert.equal((await e.run('poll.vote', { id: 1, option: 1 }, { as: 'victim' })).status, 'usage');
  assert.equal((await e.run('poll.vote', { id: 99, option: 1 }, { as: 'victim' })).status, 'usage');
});

test('giveaways: admin-only start, one entry per user, ending draws winners', async () => {
  const e = makeEnv();
  assert.equal((await e.run('giveaway.start', { duration: 600, winners: 1, prize: 'Cake' }, { as: 'regular' })).status, 'denied');
  ok(await e.run('giveaway.start', { duration: 600, winners: 1, prize: 'Cake' }, { as: 'admin' }));
  ok(await e.run('giveaway.enter', { id: 1 }, { as: 'regular' }));
  assert.equal((await e.run('giveaway.enter', { id: 1 }, { as: 'regular' })).status, 'usage');
  assert.match(text(ok(await e.run('giveaway.end', { id: 1 }, { as: 'admin' }))), /1 winner/);
  assert.equal((await e.run('giveaway.enter', { id: 1 }, { as: 'victim' })).status, 'usage', 'ended giveaway rejects entries');
});

test('to-dos, notes and reminders are private to their owner', async () => {
  const e = makeEnv();
  ok(await e.run('todo.add', { text: 'buy milk' }, { as: 'regular' }));
  assert.equal((await e.run('todo.done', { id: 1 }, { as: 'victim' })).status, 'usage');
  ok(await e.run('todo.done', { id: 1 }, { as: 'regular' }));
  assert.equal(e.svc.db.prepare('SELECT COUNT(*) n FROM todos').get().n, 1);
  ok(await e.run('note.add', { title: 't', body: 'secret' }, { as: 'regular' }));
  assert.equal((await e.run('note.view', { id: 1 }, { as: 'victim' })).status, 'usage');
  ok(await e.run('reminder.add', { in: 3600, text: 'hi' }, { as: 'regular' }));
  assert.match(JSON.stringify(ok(await e.run('reminder.list', {}, { as: 'regular' }))), /hi/);
  assert.doesNotMatch(JSON.stringify(ok(await e.run('reminder.list', {}, { as: 'victim' }))), /\bhi\b/);
});

test('reputation: no self-rep and a cooldown; profile birthday validates MM-DD', async () => {
  const e = makeEnv();
  assert.equal((await e.run('rep.give', { user: e.regular.user }, { as: 'regular' })).status, 'usage');
  ok(await e.run('rep.give', { user: e.victim.user }, { as: 'regular' }));
  assert.equal((await e.run('rep.give', { user: e.victim.user }, { as: 'regular' })).status, 'usage');
  assert.equal((await e.run('profile.birthday', { date: '13-45' }, { as: 'regular' })).status, 'usage');
  assert.equal((await e.run('profile.birthday', { date: '02-30' }, { as: 'regular' })).status, 'usage');
  ok(await e.run('profile.birthday', { date: '03-14' }, { as: 'regular' }));
  ok(await e.run('profile.view', {}, { as: 'regular' }));
  ok(await e.run('level.rank', {}, { as: 'regular' }));
});

test('tickets and suggestions: opening works; reviewing needs ManageGuild', async () => {
  const e = makeEnv();
  assert.match(text(ok(await e.run('ticket.open', { subject: 'help' }, { as: 'regular' }))), /Ticket #1 opened/);
  ok(await e.run('suggest.submit', { text: 'more cats' }, { as: 'regular' }));
  assert.equal((await e.run('suggest.approve', { id: 1 }, { as: 'regular' })).status, 'denied');
  ok(await e.run('suggest.approve', { id: 1, note: 'ok' }, { as: 'admin' }));
  assert.equal(e.svc.db.prepare('SELECT status FROM suggestions WHERE id = 1').get().status, 'approved');
});

test('AFK status is visible and sticky messages are admin-only', async () => {
  const e = makeEnv();
  ok(await e.run('afk.set', { reason: 'lunch' }, { as: 'regular' }));
  assert.match(text(ok(await e.run('afk.status', { user: e.regular.user }, { as: 'victim' }))), /AFK.*lunch/);
  assert.equal((await e.run('sticky.set', { channel: e.textChannel, content: 'rules' }, { as: 'regular' })).status, 'denied');
  ok(await e.run('sticky.set', { channel: e.textChannel, content: 'rules' }, { as: 'admin' }));
});

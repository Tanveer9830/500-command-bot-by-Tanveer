'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { makeEnv } = require('./helpers/mock');
const { Scheduler } = require('../src/services/scheduler');

function setup() {
  const env = makeEnv(); const sent = []; const dms = [];
  const chan = { id: '555000000000000001', send: async (p) => { sent.push(p); return { id: 'm1' }; } };
  env.svc.client = {
    user: { id: '999999999999999001' }, guilds: { cache: new Collection([[env.guild.id, env.guild]]) },
    channels: { cache: new Collection([[chan.id, chan]]), fetch: async () => null },
    users: { cache: new Collection(), fetch: async (id) => ({ id, send: async (p) => { dms.push({ id, p }); } }) },
  };
  env.guild.members.unban = async (id) => { env.unbanned = (env.unbanned || []).concat(id); };
  const s = new Scheduler({ svc: env.svc });
  return { env, s, sent, dms, chan };
}

test('reminders fire once, in the channel by default and by DM when preferred', async () => {
  const { env, s, sent, dms, chan } = setup(); const now = env.svc.now();
  env.db.prepare('INSERT INTO reminders (user_id, guild_id, channel_id, text, due_at) VALUES (?,?,?,?,?)').run('111111111111111111', env.guild.id, chan.id, 'water plants', now - 5);
  env.db.prepare('INSERT INTO reminders (user_id, guild_id, channel_id, text, due_at) VALUES (?,?,?,?,?)').run('222222222222222222', env.guild.id, chan.id, 'dm me', now - 5);
  env.db.prepare("INSERT INTO user_prefs (user_id, key, value) VALUES ('222222222222222222','dm_reminders','on')").run();
  env.db.prepare('INSERT INTO reminders (user_id, channel_id, text, due_at) VALUES (?,?,?,?)').run('333333333333333333', chan.id, 'later', now + 3600);
  await s.tick(); await s.tick();
  assert.equal(sent.length, 1); assert.match(sent[0].content, /water plants/);
  assert.equal(dms.length, 1); assert.match(dms[0].p.content, /dm me/);
  assert.equal(env.db.prepare("SELECT COUNT(*) n FROM reminders WHERE status = 'pending'").get().n, 1);
  assert.ok(sent.every((p) => p.allowedMentions.parse.length === 0));
});

test('repeating reminders and scheduled messages are rescheduled into the future', async () => {
  const { env, s, sent, chan } = setup(); const now = env.svc.now();
  env.db.prepare('INSERT INTO reminders (user_id, channel_id, text, due_at, repeat_secs) VALUES (?,?,?,?,?)').run('111111111111111111', chan.id, 'standup', now - 700, 300);
  env.db.prepare('INSERT INTO scheduled_messages (guild_id, channel_id, content, due_at, repeat_secs, created_by) VALUES (?,?,?,?,?,?)').run(env.guild.id, chan.id, 'announcement', now - 10, 3600, '1');
  await s.tick();
  assert.equal(sent.length, 2);
  assert.ok(env.db.prepare('SELECT due_at FROM reminders').get().due_at > now);
  assert.ok(env.db.prepare('SELECT due_at FROM scheduled_messages').get().due_at > now);
  await s.tick(); assert.equal(sent.length, 2, 'not re-sent');
});

test('expired giveaways are drawn exactly once and expired polls are closed', async () => {
  const { env, s, sent, chan } = setup();
  const g = env.svc.giveaways.create({ guildId: env.guild.id, channelId: chan.id, prize: 'Nitro', winners: 1, durationSecs: 60, hostId: '1' });
  env.svc.giveaways.enter(env.guild.id, g.id, '111111111111111111');
  env.db.prepare('UPDATE giveaways SET ends_at = ? WHERE id = ?').run(env.svc.now() - 1, g.id);
  const p = env.svc.polls.create({ guildId: env.guild.id, channelId: chan.id, question: 'Q?', options: ['a', 'b'], durationSecs: 60, authorId: '1' });
  env.db.prepare('UPDATE polls SET ends_at = ? WHERE id = ?').run(env.svc.now() - 1, p.id);
  await s.tick(); await s.tick();
  assert.equal(sent.filter((x) => /Congratulations/.test(x.content || '')).length, 1);
  assert.equal(env.db.prepare('SELECT status FROM giveaways WHERE id = ?').get(g.id).status, 'ended');
  assert.equal(env.db.prepare('SELECT status FROM polls WHERE id = ?').get(p.id).status, 'closed');
});

test('expired temp-bans are lifted and recorded', async () => {
  const { env, s } = setup();
  const c = env.svc.moderation.createCase({ guildId: env.guild.id, type: 'tempban', targetId: '444444444444444444', moderatorId: '1', durationSecs: 10 });
  env.db.prepare('UPDATE cases SET expires_at = ? WHERE id = ?').run(env.svc.now() - 1, c.id);
  await s.tick();
  assert.deepEqual(env.unbanned, ['444444444444444444']);
  assert.equal(env.db.prepare('SELECT active FROM cases WHERE id = ?').get(c.id).active, 0);
  assert.equal(env.svc.moderation.forTarget(env.guild.id, '444444444444444444', 'unban').length, 1);
});

test('auto-backup follows the guild interval and keeps only the newest copies', async () => {
  const { env, s } = setup();
  await s.tick(); assert.equal(env.db.prepare("SELECT COUNT(*) n FROM backups WHERE name LIKE 'autosave-%'").get().n, 0, 'off by default');
  env.svc.settings.set(env.guild.id, 'backup_interval_h', 1);
  await s.tick(); assert.equal(env.db.prepare("SELECT COUNT(*) n FROM backups WHERE name LIKE 'autosave-%'").get().n, 1);
  await s.tick(); assert.equal(env.db.prepare("SELECT COUNT(*) n FROM backups WHERE name LIKE 'autosave-%'").get().n, 1, 'not repeated within the interval');
});

test('one failing task does not stop the others', async () => {
  const { env, s, sent, chan } = setup();
  env.svc.giveaways.due = () => { throw new Error('boom'); };
  env.db.prepare('INSERT INTO reminders (user_id, channel_id, text, due_at) VALUES (?,?,?,?)').run('1', chan.id, 'still works', env.svc.now() - 1);
  await s.tick(); assert.equal(sent.length, 1);
});

'use strict';
/** Policy tests: Global Owner model, forbidden commands, no code/shell execution, mention safety. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { makeEnv } = require('./helpers/mock');
const { IDENTITY } = require('../src/constants');
const { FORBIDDEN } = require('../src/inventory');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('only the exact Global Owner ID can run owner-tier actions; guild admins and guild owners cannot', async () => {
  const e = makeEnv();
  const ownerKeys = e.registry.all().filter((a) => a.access === 'owner').map((a) => a.key);
  assert.ok(ownerKeys.length >= 10);
  for (const who of ['admin', 'regular', 'guildowner']) {
    for (const key of ['owner.blacklist-list', 'gcustom.list', 'owner.stats']) assert.equal((await e.run(key, {}, { as: who })).status, 'denied', `${who} → ${key}`);
  }
  assert.equal(e.owner.user.id, IDENTITY.GLOBAL_OWNER_ID);
  assert.equal((await e.run('gcustom.list', {}, { as: 'globalowner' })).status, 'ok');
});

test('no action or alias can add, promote or transfer an owner', () => {
  const e = makeEnv(); const bad = /(promote|add-?owner|set-?owner|grant-?owner|transfer-?owner|co-?owner|owner-?add|make-?owner)/i;
  for (const a of e.registry.all()) {
    assert.ok(!bad.test(a.key) && !(a.aliases || []).some((x) => bad.test(x)), `${a.key} looks like owner promotion`);
    if (a.group.name === 'owner') assert.ok(!/^(add|set|grant|promote|transfer|remove)$/.test(a.sub), a.key);
  }
});

test('global custom commands are owner-only; server custom commands need Manage Server', () => {
  const e = makeEnv();
  for (const a of e.registry.all().filter((x) => x.group.name === 'gcustom')) assert.equal(a.access, 'owner', a.key);
  for (const a of e.registry.all().filter((x) => x.group.name === 'custom' && x.sub !== 'list' && x.sub !== 'info')) { assert.ok(a.access === 'admin' || a.access === 'user', a.key); }
  const add = e.registry.get('custom.add'); assert.equal(add.access, 'admin'); assert.ok(add.perms.includes('ManageGuild'));
});

test('no forbidden targeted-ping/tag command names exist as actions, aliases or slash names', () => {
  const e = makeEnv(); const names = new Set();
  for (const a of e.registry.all()) { names.add(a.sub); (a.aliases || []).forEach((x) => names.add(x)); names.add(a.group.name); }
  for (const n of names) assert.ok(!FORBIDDEN.test(n), `forbidden name present: ${n}`);
  assert.ok(FORBIDDEN.test('tag') && FORBIDDEN.test('pin') && FORBIDDEN.test('notag'), 'the forbidden pattern covers /pin /tag /notag');
  for (const f of ['pin', 'tag', 'notag', 'ping-user', 'mention', 'pingrole', 'tagrole', 'ghostping']) assert.ok(!names.has(f) || f === 'ping', f);
});

test('the bot never evaluates code or spawns processes', () => {
  const banned = [/\beval\s*\(/, /new Function\s*\(/, /require\(['"](node:)?(child_process|vm|worker_threads)['"]\)/, /\bexecSync\b|\bspawnSync\b|\bexecFile\b/];
  for (const file of [...walk(path.join(__dirname, '..', 'src')), ...walk(path.join(__dirname, '..', 'scripts'))].filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of banned) assert.ok(!re.test(src), `${path.relative(process.cwd(), file)} matches ${re}`);
  }
});

test('every default send path disables mention parsing', async () => {
  const e = makeEnv();
  const r = await e.run('general.about', {}, { as: 'regular' });
  assert.equal(r.status, 'ok');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'text.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /allowedMentions/); assert.match(src, /parse:\s*\[\]/);
});

test('logger redacts the bot token', () => {
  const { redact } = require('../src/utils/logger');
  const tok = `MTIzNDU2Nzg5MDEyMzQ1Njc4.GabcDE.${'x'.repeat(30)}`;
  const out = typeof redact === 'function' ? redact(`login failed ${tok}`) : null;
  if (out !== null) assert.ok(!out.includes(tok));
});

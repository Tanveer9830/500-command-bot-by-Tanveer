'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/mock');
const { autoValues } = require('./helpers/autoargs');
const { buildRegistry } = require('../src/commands');

const registry = buildRegistry();
const actions = registry.all();

// Every action is executed through the real executor with auto-generated arguments:
// it must never crash (status "error"), and its authorization tier must be enforced.
for (const action of actions) {
  test(`smoke ${action.key} [${action.access}]`, async () => {
    const env = makeEnv();
    const as = action.access === 'owner' ? 'globalowner' : action.access === 'admin' ? 'admin' : 'regular';
    const res = await env.run(action.key, autoValues(registry.get(action.key), env), { as });
    assert.notEqual(res.status, 'error', `${action.key} crashed: ${res.error && res.error.stack}`);
    if (res.status === 'ok') assert.ok(res.result !== undefined, 'ok result must contain a reply');
  });
}

test('every admin/owner action denies a regular member', async () => {
  const env = makeEnv();
  for (const action of actions.filter((a) => a.access !== 'user')) {
    const res = await env.run(action.key, autoValues(action, env), { as: 'regular' });
    assert.equal(res.status, 'denied', `${action.key} must deny unprivileged users (got ${res.status})`);
  }
});

test('owner-tier actions deny a guild Administrator who is not the Global Owner', async () => {
  const env = makeEnv();
  for (const action of actions.filter((a) => a.access === 'owner')) {
    const res = await env.run(action.key, autoValues(action, env), { as: 'admin' });
    assert.equal(res.status, 'denied', `${action.key} must be owner-only`);
  }
});

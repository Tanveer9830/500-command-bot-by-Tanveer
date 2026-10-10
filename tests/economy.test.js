'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/mock');
const { tokenize } = require('../src/utils/text');

const ok = (r) => { assert.equal(r.status, 'ok', JSON.stringify(r.message || r)); return r.result; };

test('daily pays once, then enforces the cooldown, streak grows', async () => {
  const e = makeEnv();
  ok(await e.run('economy.daily', {}, { as: 'regular' }));
  const again = await e.run('economy.daily', {}, { as: 'regular' });
  assert.equal(again.status, 'usage');
  e.state.now += 86400 + 5;
  ok(await e.run('economy.daily', {}, { as: 'regular' }));
  assert.equal(e.svc.economy.wallet(e.guild.id, e.regular.user.id).streak, 2);
});

test('deposit/withdraw/transfer keep balances consistent and never go negative', async () => {
  const e = makeEnv();
  await e.run('ecoadmin.give', { user: e.regular.user, amount: 1000 }, { as: 'admin' });
  ok(await e.run('economy.deposit', { amount: 'half' }, { as: 'regular' }));
  let w = e.svc.economy.wallet(e.guild.id, e.regular.user.id);
  assert.deepEqual([w.wallet, w.bank], [500, 500]);
  const over = await e.run('economy.transfer', { user: e.victim.user, amount: '9999' }, { as: 'regular' });
  assert.equal(over.status, 'usage');
  ok(await e.run('economy.transfer', { user: e.victim.user, amount: '200' }, { as: 'regular' }));
  assert.equal(e.svc.economy.wallet(e.guild.id, e.victim.user.id).wallet, 200);
  assert.equal((await e.run('economy.transfer', { user: e.regular.user, amount: '1' }, { as: 'regular' })).status, 'usage');
});

test('gambling cannot exceed wallet or max bet', async () => {
  const e = makeEnv();
  await e.run('ecoadmin.give', { user: e.regular.user, amount: 100 }, { as: 'admin' });
  assert.equal((await e.run('economy.gamble.slots', { bet: '500' }, { as: 'regular' })).status, 'usage');
  ok(await e.run('economy.gamble.coinflip', { bet: '50', side: 'heads' }, { as: 'regular' }));
  assert.ok(e.svc.economy.wallet(e.guild.id, e.regular.user.id).wallet >= 0);
});

test('shop: buy, stock, inventory, sell, role item', async () => {
  const e = makeEnv();
  ok(await e.run('ecoadmin.shop.shopadd', { name: 'Apple', price: 10, stock: 2 }, { as: 'admin' }));
  await e.run('ecoadmin.give', { user: e.regular.user, amount: 100 }, { as: 'admin' });
  ok(await e.run('shop.buy', { item: 'Apple', quantity: 2 }, { as: 'regular' }));
  assert.equal((await e.run('shop.buy', { item: 'Apple', quantity: 1 }, { as: 'regular' })).status, 'usage');
  assert.equal(e.svc.economy.qty(e.guild.id, e.regular.user.id, e.svc.economy.item(e.guild.id, 'Apple').id), 2);
  ok(await e.run('shop.sell', { item: 'Apple', quantity: 1 }, { as: 'regular' }));
  assert.equal(e.svc.economy.wallet(e.guild.id, e.regular.user.id).wallet, 85);
});

test('economy admin actions cannot be used by members', async () => {
  const e = makeEnv();
  const r = await e.run('ecoadmin.give', { user: e.regular.user, amount: 5 }, { as: 'regular' });
  assert.equal(r.status, 'denied');
});

test('prefix invocation: !bal and !daily resolve through the shared registry', async () => {
  const e = makeEnv();
  for (const word of ['bal', 'balance', 'daily', 'work', 'slots']) {
    const hit = e.registry.resolve(tokenize(word));
    assert.ok(hit && hit.action, `!${word} must resolve`);
  }
});

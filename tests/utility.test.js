'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/mock');

const env = makeEnv();
const run = async (key, values) => { const r = await env.run(key, values, { as: 'regular' }); return r.status === 'ok' ? (typeof r.result === 'string' ? r.result : r.result.content || JSON.stringify(r.result)) : `${r.status}: ${r.message}`; };

test('calc: expressions, percentages and statistics', async () => {
  assert.match(await run('calc.expr', { expression: '(3+4)*sqrt(16)/2' }), /= \*\*14\*\*/);
  assert.match(await run('calc.percent', { percent: 15, of: 200 }), /\*\*30\*\*/);
  assert.match(await run('calc.change', { from: 50, to: 75 }), /\+50%/);
  assert.match(await run('calc.median', { numbers: '5 1 3 2' }), /\*\*2.5\*\*/);
  assert.match(await run('calc.stddev', { numbers: '2 4 4 4 5 5 7 9' }), /σ = \*\*2\*\*/);
  assert.match(await run('calc.ratio', { a: 10, b: 25 }), /2:5/);
  assert.match(await run('calc.expr', { expression: 'process.exit()' }), /^usage|error|Invalid|Unknown|Unexpected/i, 'must not evaluate code');
});

test('math: number theory and geometry', async () => {
  assert.match(await run('math.gcd', { a: 48, b: 18 }), /\*\*6\*\*/);
  assert.match(await run('math.factorial', { n: 20 }), /2432902008176640000/);
  assert.match(await run('math.isprime', { n: 97 }), /is prime/);
  assert.match(await run('math.factors', { n: 360 }), /2\^3 × 3\^2 × 5/);
  assert.match(await run('math.fibonacci', { n: 50 }), /12586269025/);
  assert.match(await run('math.ncr', { n: 10, r: 3 }), /\*\*120\*\*/);
  assert.match(await run('math.roman', { value: '1994' }), /MCMXCIV/);
  assert.match(await run('math.roman', { value: 'MCMXCIV' }), /1994/);
  assert.match(await run('math.quadratic', { a: 1, b: -3, c: 2 }), /x₁ = \*\*2\*\*, x₂ = \*\*1\*\*/);
  assert.match(await run('math.geometry.triangle', { a: 3, b: 4, c: 5 }), /area \*\*6\*\*/);
  assert.match(await run('math.geometry.triangle', { a: 1, b: 1, c: 5 }), /cannot form/);
});

test('finance and conversion', async () => {
  assert.match(await run('finance.emi', { principal: 100000, rate: 12, months: 12 }), /EMI \*\*8,884.88\*\*/);
  assert.match(await run('finance.tip', { bill: 80, percent: 10 }), /total \*\*88.00\*\*/);
  assert.match(await run('convert.length', { value: 1, from: 'mi', to: 'km' }), /1.609344/);
  assert.match(await run('convert.temperature', { value: 100, from: 'c', to: 'f' }), /212°F/);
  assert.match(await run('convert.temperature', { value: -300, from: 'c', to: 'f' }), /absolute zero/);
  assert.match(await run('convert.data', { value: 1, from: 'gib', to: 'mb' }), /1,073.741824|1073.741824/);
  assert.match(await run('convert.base', { number: 'ff', from: 16, to: 2 }), /11111111/);
  assert.match(await run('convert.fuel', { value: 10, from: 'l100', to: 'kml' }), /10 kml/);
  assert.match(await run('convert.length', { value: 1, from: 'parsec', to: 'km' }), /Unknown length unit/);
});

test('text and encode tools', async () => {
  assert.equal(await run('text.reverse', { text: 'abc' }), 'cba');
  assert.equal(await run('text.case.snake', { text: 'Hello World Foo' }), 'hello_world_foo');
  assert.equal(await run('text.case.camel', { text: 'hello big world' }), 'helloBigWorld');
  assert.equal(await run('text.case.slug', { text: 'Crème Brûlée!' }), 'creme-brulee');
  assert.match(await run('text.analyze.palindrome', { text: 'A man, a plan, a canal: Panama' }), /Yes/);
  assert.equal(await run('encode.base64', { text: 'hello' }), 'aGVsbG8=');
  assert.equal(await run('encode.unbase64', { text: 'aGVsbG8=' }), 'hello');
  assert.equal(await run('encode.morse', { text: 'sos' }), '... --- ...');
  assert.equal(await run('encode.unmorse', { text: '... --- ...' }), 'sos');
  assert.equal(await run('encode.rot13', { text: 'Hello' }), 'Uryyb');
  assert.match(await run('encode.hash', { algorithm: 'sha256', text: 'abc' }), /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/);
  assert.match(await run('encode.unhex', { text: 'zz' }), /not valid hex/);
});

test('output never pings @everyone', async () => {
  const r = await run('text.case.upper', { text: '@everyone hi' });
  assert.ok(!/@everyone/i.test(r) && /@\u200beveryone/i.test(r), r);
});

test('time, dev, colour and science references', async () => {
  assert.match(await run('time.weekday', { date: '2000-01-01' }), /Saturday/);
  assert.match(await run('time.leapyear', { year: 1900 }), /not a leap/);
  assert.match(await run('time.daysin', { year: 2024, month: 2 }), /\*\*29\*\*/);
  assert.match(await run('time.diff', { from: '2024-01-01', to: '2024-01-31' }), /30 days/);
  assert.match(await run('time.week', { date: '2021-01-03' }), /week \*\*53\*\* of 2020/);
  assert.match(await run('time.now', { zone: 'Asia/Kolkata' }), /UTC\+05:30/);
  assert.match(await run('time.now', { zone: 'Mars/Base' }), /Unknown timezone/);
  assert.match(await run('time.convert', { time: '12:00', zone: 'UTC', to: 'Asia/Kolkata' }), /17:30/);
  assert.match(await run('dev.snowflake', { id: '175928847299117063' }), /<t:1462015105:F>/);
  assert.match(await run('dev.chmod', { mode: '755' }), /rwxr-xr-x/);
  assert.match(await run('dev.cidr', { cidr: '192.168.1.0/24' }), /usable hosts \*\*254\*\*/);
  assert.match(await run('dev.semver', { a: '1.10.0', b: '1.9.9' }), /newer/);
  assert.match(await run('dev.jsonformat', { json: '{"a":1}' }), /"a": 1/);
  assert.match(await run('dev.jsonformat', { json: '{bad' }), /Invalid JSON/);
  assert.match(await run('dev.permissions', { value: '8' }), /Administrator/);
  assert.match(await run('color.info', { hex: '#ffffff' }), /rgb\(255, 255, 255\)/);
  assert.match(await run('color.contrast', { first: '#000', second: '#fff' }), /21\.00:1/);
  assert.match(await run('science.element', { query: 'Fe' }), /55.845/);
  assert.match(await run('science.molarmass', { formula: 'H2O' }), /18\.015 g\/mol/);
  assert.match(await run('science.molarmass', { formula: 'Ca(OH)2' }), /74\.09/);
  assert.match(await run('science.molarmass', { formula: 'Xx2' }), /Unknown element/);
  assert.match(await run('science.zodiac', { month: 7, day: 21 }), /Cancer/);
  assert.match(await run('science.chinesezodiac', { year: 2024 }), /Dragon/);
  assert.match(await run('science.moonphase', { date: '2000-01-06' }), /New moon/);
  assert.match(await run('science.ohm', { volts: 12, ohms: 4 }), /I = \*\*3 A\*\*/);
  assert.equal(require('../src/commands/reference').EL.length, 118);
});

test('games: a numguess session can be played to completion', async () => {
  const e = makeEnv();
  const r = (k, v) => e.run(k, v, { as: 'regular' });
  assert.equal((await r('game.numguess.guess', { number: 5 })).status, 'usage', 'no game yet');
  e.state.rnd = 0; // secret = 1
  assert.equal((await r('game.numguess.start', { max: 10 })).status, 'ok');
  const wrong = await r('game.numguess.guess', { number: 7 });
  assert.match(wrong.result, /Lower/);
  const right = await r('game.numguess.guess', { number: 1 });
  assert.match(right.result, /Correct/);
  assert.equal((await r('game.numguess.guess', { number: 1 })).status, 'usage', 'session ended');
  const stats = await r('game.stats', {});
  assert.match(JSON.stringify(stats.result), /numguess.*1W/);
});

test('games: tictactoe bot blocks and a finished game is recorded', async () => {
  const e = makeEnv();
  const r = (k, v) => e.run(k, v, { as: 'regular' });
  await r('game.tictactoe.start', {});
  assert.equal((await r('game.tictactoe.move', { cell: 1 })).status, 'ok');
  assert.equal((await r('game.tictactoe.move', { cell: 1 })).status, 'usage', 'occupied cell');
});

test('trivia answers are scored', async () => {
  const e = makeEnv();
  await e.run('trivia.ask', {}, { as: 'regular' });
  const a = await e.run('trivia.answer', { choice: 'A' }, { as: 'regular' });
  assert.equal(a.status, 'ok');
  const s = await e.run('trivia.score', {}, { as: 'regular' });
  assert.match(s.result, /1 (correct|wrong)|0 correct, 1 wrong|1 correct/);
});

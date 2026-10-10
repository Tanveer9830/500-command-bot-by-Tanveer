'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers/mock');
const { Music } = require('../src/services/music');
const { Collection } = require('discord.js');

const fakeFetch = (routes, seen = []) => async (url) => {
  seen.push(url);
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) return { ok: false, status: 404, url, text: async () => '{}' };
  return { ok: true, status: 200, url, text: async () => JSON.stringify(hit[1]) };
};

test('weather uses geocoding then forecast and renders a result', async () => {
  const seen = [];
  const env = makeEnv({ fetchImpl: fakeFetch({
    'geocoding-api.open-meteo.com': { results: [{ name: 'Kolkata', admin1: 'West Bengal', country: 'India', latitude: 22.57, longitude: 88.36 }] },
    'api.open-meteo.com/v1/forecast': { current: { temperature_2m: 31, apparent_temperature: 36, relative_humidity_2m: 80, precipitation: 0, weather_code: 2, wind_speed_10m: 10, wind_direction_10m: 90 } },
  }, seen) });
  const r = await env.run('weather.now', { city: 'Kolkata' }, { as: 'regular' });
  assert.equal(r.status, 'ok');
  assert.match(JSON.stringify(r.result), /Kolkata, West Bengal, India/);
  assert.match(JSON.stringify(r.result), /Partly cloudy/);
  assert.ok(seen.every((u) => u.startsWith('https://')));
});

test('lookups report not-found and network failure as friendly usage errors', async () => {
  const env = makeEnv({ fetchImpl: fakeFetch({}) });
  const r = await env.run('lookup.define', { word: 'zzzzqq' }, { as: 'regular' });
  assert.equal(r.status, 'usage');
  const env2 = makeEnv();
  const r2 = await env2.run('lookup.wiki', { topic: 'Moon' }, { as: 'regular' });
  assert.equal(r2.status, 'usage');
});

test('the HTTP client refuses hosts outside the allow-list', async () => {
  const env = makeEnv({ fetchImpl: fakeFetch({}) });
  await assert.rejects(() => env.svc.lookup.json('https://evil.example.com/x'), /blocked host/);
  await assert.rejects(() => env.svc.lookup.json('http://api.github.com/x'), /blocked host/);
});

test('crypto lookup includes a not-financial-advice note', async () => {
  const env = makeEnv({ fetchImpl: fakeFetch({ 'coingecko.com': { bitcoin: { usd: 65000.5, usd_24h_change: -1.234 } } }) });
  const r = await env.run('lookup.crypto', { coin: 'bitcoin' }, { as: 'regular' });
  assert.match(r.result, /65,000.5 USD/);
  assert.match(r.result, /not financial advice/);
});

// ---- music with a fake Lavalink backend -----------------------------------------
function fakeBackend() {
  const events = new Map(); const log = [];
  const player = { on: (e, f) => events.set(e, f), setGlobalVolume: async (v) => log.push(['vol', v]), playTrack: async (t) => log.push(['play', t.track.encoded]), stopTrack: async () => log.push(['stop']), setPaused: async (p) => log.push(['pause', p]), seekTo: async (ms) => log.push(['seek', ms]) };
  const mk = (n, len = 180000) => ({ encoded: `enc-${n}`, info: { title: `Song ${n}`, author: 'Artist', uri: `https://example.com/${n}`, length: len, isStream: false, isSeekable: true } });
  return { log, events, player, status: () => ({ connected: true, nodes: [{}] }), join: async () => player, leave: async () => log.push(['leave']), resolve: async (id) => (id.includes('empty') ? { loadType: 'empty', tracks: [] } : id.includes('list') ? { loadType: 'playlist', playlistName: 'Mix', tracks: [mk(1), mk(2), mk(3)] } : { loadType: 'search', tracks: [mk(Math.abs(id.length))] }) };
}
function musicEnv() {
  const env = makeEnv();
  env.svc.music.backend = fakeBackend();
  const vc = env.voiceChannel; vc.members = new Collection(); vc.members.set(env.regular.member.id, env.regular.member);
  return env;
}
const as = (env, who, key, values) => env.run(key, values, { as: who, voice: true });

test('music: play queues, starts playback and skip advances', async () => {
  const env = musicEnv();
  const r = await as(env, 'regular', 'music.play', { query: 'list of songs' });
  assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.match(r.result, /Queued \*\*3\*\* tracks/);
  const st = env.svc.music.state(env.guild.id);
  assert.equal(st.current.track.encoded, 'enc-1');
  assert.equal(st.queue.length, 2);
  const s = await as(env, 'regular', 'music.skip', {});
  assert.equal(s.status, 'ok'); assert.equal(st.current.track.encoded, 'enc-2');
  const q = await as(env, 'regular', 'music.queue', {});
  assert.match(JSON.stringify(q.result), /Song 3/);
});

test('music: requires a voice channel and the same channel for controls', async () => {
  const env = musicEnv();
  const noVoice = await env.run('music.play', { query: 'hello' }, { as: 'regular', voice: false });
  assert.equal(noVoice.status, 'usage');
  await as(env, 'regular', 'music.play', { query: 'hello world' });
  const outsider = await env.run('music.pause', {}, { as: 'victim', voice: false });
  assert.equal(outsider.status, 'usage');
});

test('music: DJ role restricts controls to DJs and the requester; admins always pass', async () => {
  const env = musicEnv();
  const dj = env.mkRole('DJ', 3); await env.run('musicset.djrole', { role: dj }, { as: 'admin' });
  await as(env, 'regular', 'music.play', { query: 'one two' });
  const other = env.person('listener', { perms: [], position: 2 }); env.voiceChannel.members.set(other.member.id, other.member);
  const denied = await as(env, 'listener', 'music.shuffle', {});
  assert.equal(denied.status, 'usage');
  const admin = await as(env, 'admin', 'music.volume', { level: 80 });
  assert.equal(admin.status, 'ok');
});

test('music: unconfigured Lavalink gives a clear message, never a crash', async () => {
  const env = makeEnv();
  const r = await env.run('music.play', { query: 'x' }, { as: 'regular', voice: true });
  assert.equal(r.status, 'usage'); assert.match(r.message, /not configured/);
});

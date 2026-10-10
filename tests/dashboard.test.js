'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
const { Collection } = require('discord.js');
const { makeEnv } = require('./helpers/mock');
const { createDashboard } = require('../src/dashboard/server');
const { IDENTITY } = require('../src/constants');

const CID = '123456789012345678';
async function boot({ discordUser = { id: '777000000000000001', username: 'mod' }, perms = '32' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-dash-'));
  const env = makeEnv({ configEnv: { DASHBOARD_ENABLED: 'true', DISCORD_CLIENT_SECRET: 's3cret-value', DASHBOARD_PORT: '0', DATA_DIR: tmp, DASHBOARD_BASE_URL: 'http://localhost:3999' } });
  const client = { ws: { ping: 5 }, guilds: { cache: new Collection([[env.guild.id, env.guild]]) } };
  env.guild.memberCount = 3;
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(String(url));
    const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b });
    if (String(url).endsWith('/oauth2/token')) return json({ access_token: 'tok' });
    if (String(url).endsWith('/oauth2/token/revoke')) return json({});
    if (String(url).endsWith('/users/@me')) return json(discordUser);
    if (String(url).endsWith('/users/@me/guilds')) return json([{ id: env.guild.id, name: 'Test Guild', owner: false, permissions: perms }, { id: '888000000000000009', name: 'Other', owner: false, permissions: '2147483647' }]);
    return json({}, false);
  };
  const dash = createDashboard({ svc: env.svc, client, config: env.config, fetchImpl });
  const server = await dash.start(); const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const req = async (p, { method = 'GET', body, headers = {}, csrf = true, follow = false } = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + p, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(csrf && jar.csrf ? { 'x-csrf-token': jar.csrf } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v.join('='); }
    return res;
  };
  const login = async () => {
    const r1 = await req('/auth/login'); const loc = new URL(r1.headers.get('location')); const state = loc.searchParams.get('state');
    const r2 = await req(`/auth/callback?code=abc&state=${state}`); assert.equal(r2.status, 302);
    const me = await (await req('/api/me')).json(); jar.csrf = me.csrf; return { r1, loc, me };
  };
  return { env, dash, req, jar, login, calls, close: () => dash.stop().then(() => fs.rmSync(tmp, { recursive: true, force: true })) };
}

test('login uses OAuth state, redirects to Discord with the right scopes, and creates a session', async (t) => {
  const d = await boot(); t.after(d.close);
  const { loc, me } = await d.login();
  assert.equal(loc.origin + loc.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(loc.searchParams.get('scope'), 'identify guilds'); assert.equal(loc.searchParams.get('client_id'), CID);
  assert.equal(me.user.username, 'mod');
  assert.ok(!JSON.stringify(me).includes('tok'), 'access token never exposed');
  assert.equal(d.env.db.prepare("SELECT COUNT(*) n FROM sessions WHERE data LIKE '%access_token%'").get().n, 0, 'token never stored');
});

test('callback rejects a wrong state and a missing session', async (t) => {
  const d = await boot(); t.after(d.close);
  await d.req('/auth/login');
  assert.equal((await d.req('/auth/callback?code=abc&state=wrong')).status, 400);
  const fresh = await fetch(`http://127.0.0.1:${d.dash.server.address().port}/auth/callback?code=a&state=b`, { redirect: 'manual' });
  assert.equal(fresh.status, 400);
});

test('API needs a session; a tampered cookie is not a session', async (t) => {
  const d = await boot(); t.after(d.close);
  assert.equal((await d.req('/api/guilds')).status, 401);
  d.jar.tp_sid = 'deadbeef.cafebabe'; assert.equal((await d.req('/api/guilds')).status, 401);
});

test('members with Manage Server can read and change settings; values are validated and audited', async (t) => {
  const d = await boot(); t.after(d.close); await d.login(); const g = d.env.guild.id;
  const list = await (await d.req('/api/guilds')).json();
  assert.deepEqual(list.guilds.map((x) => [x.id, x.botPresent]), [[g, true], ['888000000000000009', false]], 'a server without the bot is listed only so it can be invited');
  assert.equal((await d.req('/api/guilds/888000000000000009/settings')).status, 404);
  const ok = await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'PUT', body: { value: '?' } }); assert.equal(ok.status, 200);
  assert.equal(d.env.svc.settings.get(g, 'prefix'), '?');
  const bad = await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'PUT', body: { value: 'toolongvalue' } }); assert.equal(bad.status, 400);
  const unk = await d.req(`/api/guilds/${g}/settings/nope`, { method: 'PUT', body: { value: 1 } }); assert.equal(unk.status, 404);
  const settings = await (await d.req(`/api/guilds/${g}/settings`)).json(); assert.ok(settings.find((s) => s.key === 'prefix').custom);
  assert.equal((await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'DELETE' })).status, 200);
  assert.equal(d.env.svc.settings.get(g, 'prefix'), '!');
  assert.ok(d.env.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE source = 'dashboard' AND action = 'dashboard:setting'").get().n >= 1);
});

test('users without Manage Server cannot see or change a server — including the Global Owner', async (t) => {
  const d = await boot({ discordUser: { id: IDENTITY.GLOBAL_OWNER_ID, username: 'owner' }, perms: '2048' }); t.after(d.close); await d.login(); const g = d.env.guild.id;
  assert.equal((await d.req(`/api/guilds/${g}/settings`)).status, 403);
  assert.equal((await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'PUT', body: { value: '?' } })).status, 403);
  assert.ok(!(await (await d.req('/api/guilds')).json()).guilds.some((x) => x.id === g), 'no Manage Server permission → server not listed');
});

test('state-changing requests need the CSRF token and a same-origin Origin', async (t) => {
  const d = await boot(); t.after(d.close); await d.login(); const g = d.env.guild.id;
  assert.equal((await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'PUT', body: { value: '?' }, csrf: false })).status, 403);
  assert.equal((await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'PUT', body: { value: '?' }, headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await d.req(`/api/guilds/${g}/settings/prefix`, { method: 'PUT', body: { value: '?' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal(d.env.svc.settings.get(g, 'prefix'), '!');
});

test('logout destroys the session', async (t) => {
  const d = await boot(); t.after(d.close); await d.login();
  assert.equal((await d.req('/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await d.req('/api/guilds')).status, 401);
});

test('public pages carry the permanent attribution and security headers; there is no owner/eval surface', async (t) => {
  const d = await boot(); t.after(d.close);
  const idRes = await d.req('/api/identity'); const id = await idRes.json();
  assert.equal(id.attributionUpper, 'MADE BY TANVEER | DISCORD: TANVEER5637');
  assert.match(idRes.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(idRes.headers.get('x-frame-options'), 'DENY');
  const page = await (await d.req('/')).text(); assert.match(page, /MADE BY TANVEER \| DISCORD: TANVEER5637/);
  const cmds = await (await d.req('/api/commands')).json(); assert.ok(cmds.length > 500);
  await d.login(); for (const p of ['/api/owner', '/api/eval', '/api/exec', '/api/global-commands']) assert.equal((await d.req(p)).status, 404);
  assert.equal((await d.req('/healthz')).status, 200);
});

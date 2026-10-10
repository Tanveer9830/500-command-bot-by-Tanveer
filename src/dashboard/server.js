'use strict';
/**
 * OAuth2 dashboard (Discord login). Design rules:
 *  - Only guild owners / members with Manage Server or Administrator can manage a server, re-checked on every request.
 *  - The Global Owner has NO special dashboard rights, and nothing here can create owners or custom global commands.
 *  - Sessions live in SQLite, cookies are HttpOnly + SameSite=Lax (+ Secure on https), OAuth `state` is verified,
 *    and every state-changing request needs a CSRF token and a same-origin Origin header.
 *  - OAuth access tokens are used once and never stored.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { SCHEMA } = require('../services/settings');
const { UserError } = require('../core/errors');
const { dashboardIdentity } = require('../utils/branding');
const { INVITE_PERMISSIONS } = require('../constants');
const { ensureSessionSecret } = require('../config');
const log = require('../utils/logger').child('dashboard');

const API = 'https://discord.com/api/v10';
const PERM_ADMIN = 0x8n; const PERM_MANAGE_GUILD = 0x20n;
const COOKIE = 'tp_sid';
const SESSION_TTL = 7 * 86400;

class SessionStore {
  constructor(db, now) { this.db = db; this.now = now; }
  create(data) { const id = crypto.randomBytes(32).toString('hex'); this.save(id, data); return id; }
  get(id) { const r = this.db.prepare('SELECT data, expires_at FROM sessions WHERE id = ?').get(id); if (!r) return null; if (r.expires_at < this.now()) { this.destroy(id); return null; } return JSON.parse(r.data); }
  save(id, data) { this.db.prepare('INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at').run(id, JSON.stringify(data), this.now() + SESSION_TTL); }
  destroy(id) { this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id); }
}

function createDashboard({ svc, client, config, fetchImpl = globalThis.fetch }) {
  const cfg = config.dashboard; const secret = ensureSessionSecret(config);
  const now = svc.now; const store = new SessionStore(svc.db, now);
  const baseUrl = cfg.baseUrl; const origin = new URL(baseUrl).origin; const redirectUri = `${baseUrl}/auth/callback`;
  const sign = (id) => crypto.createHmac('sha256', secret).update(id).digest('hex');
  const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  // ---- security headers
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cache-Control': 'no-store',
    });
    if (cfg.secureCookies) res.set('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // ---- tiny in-memory rate limiter
  const hits = new Map();
  const limiter = (name, max, windowSecs = 60) => (req, res, next) => {
    const k = `${name}:${req.ip}`; const t = Date.now(); const arr = (hits.get(k) || []).filter((x) => t - x < windowSecs * 1000);
    if (arr.length >= max) { res.set('Retry-After', String(windowSecs)); return res.status(429).json({ error: 'Too many requests. Slow down.' }); }
    arr.push(t); hits.set(k, arr); next();
  };
  const sweep = setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 60_000)) hits.delete(k); }, 60_000); sweep.unref();

  // ---- cookies & sessions
  const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join('=')]));
  const setCookie = (res, id) => res.append('Set-Cookie', `${COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${cfg.secureCookies ? '; Secure' : ''}`);
  const clearCookie = (res) => res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cfg.secureCookies ? '; Secure' : ''}`);
  app.use((req, res, next) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE]; req.sid = null; req.session = null;
    if (raw) { const [id, mac] = raw.split('.'); if (id && mac && eq(mac, sign(id))) { const s = store.get(id); if (s) { req.sid = id; req.session = s; } } }
    next();
  });
  const persist = (req) => { if (req.sid && req.session) store.save(req.sid, req.session); };

  // ---- same-origin + CSRF for every state-changing request
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const o = req.headers.origin; if (o && o !== origin) return res.status(403).json({ error: 'Cross-origin request blocked.' });
    if (req.path.startsWith('/auth/callback')) return next();
    if (!req.session || !eq(req.headers['x-csrf-token'] || '', req.session.csrf)) return res.status(403).json({ error: 'Invalid CSRF token. Reload the page.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  const needLogin = (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ error: 'Not signed in.' }));
  const manageable = (sess, guildId) => {
    const g = (sess.guilds || []).find((x) => x.id === guildId); if (!g) return false;
    let p = 0n; try { p = BigInt(g.permissions || '0'); } catch { /* ignore */ }
    return Boolean(g.owner || (p & PERM_ADMIN) || (p & PERM_MANAGE_GUILD));
  };
  const needGuild = (req, res, next) => {
    const id = req.params.id;
    if (!/^\d{15,25}$/.test(id) || !manageable(req.session, id)) return res.status(403).json({ error: 'You cannot manage that server.' });
    const guild = client.guilds.cache.get(id); if (!guild) return res.status(404).json({ error: 'The bot is not in that server.' });
    req.guild = guild; next();
  };

  // ---- public endpoints
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/api/identity', (req, res) => res.json({ ...dashboardIdentity(), botName: svc.bot.name, version: svc.bot.version }));
  app.get('/api/status', limiter('status', 60), (req, res) => res.json({ botName: svc.bot.name, version: svc.bot.version, uptimeSecs: Math.floor((Date.now() - svc.bot.startedAt) / 1000), guilds: client.guilds.cache.size, pingMs: Math.round(client.ws ? client.ws.ping : -1), commands: svc.registry.all().length }));
  app.get('/api/commands', limiter('commands', 30), (req, res) => res.json(svc.registry.all().map((a) => ({ name: [a.group.name, a.subgroup, a.sub].filter(Boolean).join(' '), description: a.description, category: a.category, access: a.access }))));

  // ---- OAuth2
  app.get('/auth/login', limiter('auth', 20), (req, res) => {
    if (!cfg.enabled || !config.clientSecret) return res.status(503).send('Dashboard login is not configured.');
    const state = crypto.randomBytes(24).toString('hex');
    const id = req.sid || store.create({}); const sess = req.session || {}; sess.oauthState = state; store.save(id, sess); setCookie(res, id);
    const u = new URL('https://discord.com/oauth2/authorize');
    u.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'identify guilds', state, prompt: 'none' }).toString();
    res.redirect(u.toString());
  });

  async function discord(pathname, token) {
    const r = await fetchImpl(`${API}${pathname}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Discord API ${r.status}`); return r.json();
  }
  app.get('/auth/callback', limiter('auth', 20), async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!req.session || !req.session.oauthState || typeof state !== 'string' || !eq(state, req.session.oauthState) || typeof code !== 'string') return res.status(400).send('Invalid login state. Please try again.');
      const tr = await fetchImpl(`${API}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }) });
      if (!tr.ok) return res.status(400).send('Discord rejected the login. Please try again.');
      const tok = await tr.json();
      const [me, guilds] = await Promise.all([discord('/users/@me', tok.access_token), discord('/users/@me/guilds', tok.access_token)]);
      fetchImpl(`${API}/oauth2/token/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, token: tok.access_token }) }).catch(() => {});
      if (req.sid) store.destroy(req.sid); // fresh session id after login (prevents fixation)
      const id = store.create({ user: { id: me.id, username: me.username, avatar: me.avatar }, guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner, permissions: g.permissions })), csrf: crypto.randomBytes(24).toString('hex') });
      setCookie(res, id); svc.audit({ actorId: me.id, action: 'dashboard:login', source: 'dashboard' });
      res.redirect('/');
    } catch (e) { log.warn('oauth callback failed', { err: e.message }); res.status(502).send('Login failed. Please try again.'); }
  });
  app.post('/auth/logout', (req, res) => { if (req.sid) store.destroy(req.sid); clearCookie(res); res.json({ ok: true }); });

  // ---- authenticated API
  app.get('/api/me', (req, res) => {
    if (!req.session || !req.session.user) return res.json({ user: null, loginEnabled: Boolean(cfg.enabled && config.clientSecret) });
    res.json({ user: req.session.user, csrf: req.session.csrf, loginEnabled: true });
  });
  const api = express.Router(); api.use(needLogin, limiter('api', 120));
  api.get('/guilds', (req, res) => {
    const out = req.session.guilds.filter((g) => manageable(req.session, g.id)).map((g) => ({ id: g.id, name: g.name, icon: g.icon, botPresent: client.guilds.cache.has(g.id) }));
    res.json({ guilds: out, inviteUrl: `https://discord.com/oauth2/authorize?client_id=${config.clientId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}` });
  });
  api.get('/guilds/:id/overview', needGuild, (req, res) => {
    const g = req.guild; const d = svc.db; const c = (sql) => d.prepare(sql).get(g.id).n;
    res.json({ id: g.id, name: g.name, members: g.memberCount, channels: g.channels.cache.size, roles: g.roles.cache.size,
      cases: c('SELECT COUNT(*) n FROM cases WHERE guild_id = ?'), openTickets: c("SELECT COUNT(*) n FROM tickets WHERE guild_id = ? AND status = 'open'"), customCommands: c('SELECT COUNT(*) n FROM custom_commands WHERE scope = ? AND deleted = 0') });
  });
  api.get('/guilds/:id/settings', needGuild, (req, res) => {
    const all = svc.settings.all(req.guild.id); const stored = svc.settings.stored(req.guild.id);
    res.json(svc.settings.keys().map((k) => { const d = SCHEMA[k]; return { key: k, type: d.type, value: all[k], default: svc.settings.defaultOf(k), custom: k in stored, min: d.min, max: d.max, values: d.values, maxItems: d.maxItems, help: d.help }; }));
  });
  api.put('/guilds/:id/settings/:key', needGuild, (req, res) => {
    const key = req.params.key; if (!SCHEMA[key]) return res.status(404).json({ error: 'Unknown setting.' });
    try {
      const v = svc.settings.set(req.guild.id, key, req.body ? req.body.value : undefined);
      svc.audit({ guildId: req.guild.id, actorId: req.session.user.id, action: 'dashboard:setting', target: key, details: JSON.stringify(v).slice(0, 300), source: 'dashboard' });
      res.json({ ok: true, value: v });
    } catch (e) { if (e instanceof UserError) return res.status(400).json({ error: e.message.replace(/`/g, '') }); throw e; }
  });
  api.delete('/guilds/:id/settings/:key', needGuild, (req, res) => {
    const key = req.params.key; if (!SCHEMA[key]) return res.status(404).json({ error: 'Unknown setting.' });
    svc.settings.reset(req.guild.id, key);
    svc.audit({ guildId: req.guild.id, actorId: req.session.user.id, action: 'dashboard:setting-reset', target: key, source: 'dashboard' });
    res.json({ ok: true, value: svc.settings.get(req.guild.id, key) });
  });
  api.get('/guilds/:id/cases', needGuild, (req, res) => res.json(svc.moderation.recent(req.guild.id, Math.min(100, Number(req.query.limit) || 50))));
  api.get('/guilds/:id/audit', needGuild, (req, res) => res.json(svc.db.prepare('SELECT actor_id, action, target, details, source, ts FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT 100').all(req.guild.id)));
  app.use('/api', api);

  app.use(express.static(path.join(config.root, 'dashboard', 'public'), { maxAge: 0, index: 'index.html', dotfiles: 'ignore' }));
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => { log.error('dashboard error', { err }); res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status && err.status < 500 ? 'Bad request.' : 'Internal error.' }); });

  let server = null;
  return {
    app, store,
    start: () => new Promise((resolve, reject) => {
      server = http.createServer(app); server.once('error', reject);
      server.listen(cfg.port, cfg.host, () => { log.info('dashboard listening', { host: cfg.host, port: cfg.port, baseUrl }); resolve(server); });
    }),
    stop: () => new Promise((resolve) => { clearInterval(sweep); if (!server) return resolve(); server.close(() => resolve()); server.closeAllConnections?.(); }),
    get server() { return server; },
  };
}

module.exports = { createDashboard, SessionStore };

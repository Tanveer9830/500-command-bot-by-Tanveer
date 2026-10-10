'use strict';
// No innerHTML anywhere: every dynamic value goes through textContent, so server data can never inject markup.
const $ = (sel) => document.querySelector(sel);
const state = { csrf: null, user: null, loginEnabled: false };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(method !== 'GET' ? { 'x-csrf-token': state.csrf || '' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function mount(...nodes) { const app = $('#app'); app.replaceChildren(...nodes.flat()); }
function note(el, text, ok) { el.textContent = text; el.className = ok ? 'ok' : 'err'; }

// ------------------------------------------------------------------ views
async function viewHome() {
  if (!state.user) {
    return mount(h('h1', {}, 'Dashboard'), h('div', { class: 'card' }, h('p', {}, 'Sign in with Discord to manage servers where you have the Manage Server permission.'),
      state.loginEnabled ? h('a', { class: 'btn', href: '/auth/login' }, 'Sign in with Discord') : h('p', { class: 'muted' }, 'Login is not configured on this instance (see docs/DASHBOARD.md).')));
  }
  const { guilds, inviteUrl } = await api('/api/guilds');
  mount(h('h1', {}, 'Your servers'), guilds.length ? h('div', { class: 'grid' }, guilds.map((g) => h('div', { class: 'card' }, h('h2', {}, g.name),
    g.botPresent ? h('a', { class: 'btn', href: `#/guild/${g.id}` }, 'Manage') : h('a', { class: 'btn secondary', href: inviteUrl, rel: 'noopener' }, 'Invite the bot')))) : h('p', { class: 'muted' }, 'No servers found where you can manage the bot.'));
}

function settingEditor(gid, s, refresh) {
  const status = h('span', { class: 'muted' }); let read;
  let input;
  if (s.type === 'bool') { input = h('input', { type: 'checkbox' }); input.checked = Boolean(s.value); read = () => input.checked; }
  else if (s.type === 'int') { input = h('input', { type: 'number', min: s.min, max: s.max, value: s.value }); read = () => Number(input.value); }
  else if (s.type === 'enum') { input = h('select', {}, s.values.map((v) => h('option', { value: v }, v))); input.value = s.value; read = () => input.value; }
  else if (s.type === 'string') { input = h('input', { type: 'text', value: s.value ?? '' }); read = () => (input.value === '' ? null : input.value); }
  else { input = h('textarea', { rows: 3, spellcheck: 'false' }); input.value = JSON.stringify(s.value, null, 2); read = () => JSON.parse(input.value); }
  const save = h('button', { onclick: async () => { try { await api(`/api/guilds/${gid}/settings/${s.key}`, { method: 'PUT', body: { value: read() } }); note(status, 'Saved', true); } catch (e) { note(status, e.message, false); } } }, 'Save');
  const reset = h('button', { class: 'secondary', onclick: async () => { try { await api(`/api/guilds/${gid}/settings/${s.key}`, { method: 'DELETE' }); refresh(); } catch (e) { note(status, e.message, false); } } }, 'Reset');
  return h('div', { class: 'setting', 'data-key': s.key }, h('div', { class: 'row' }, h('span', { class: 'key' }, s.key), s.custom ? h('span', { class: 'tag' }, 'customised') : null, h('span', { class: 'muted' }, s.type)),
    s.help ? h('div', { class: 'muted' }, s.help) : null, h('div', { class: 'row' }, input, save, reset, status));
}

async function viewGuild(gid) {
  const [ov, settings] = await Promise.all([api(`/api/guilds/${gid}/overview`), api(`/api/guilds/${gid}/settings`)]);
  const body = h('div'); const search = h('input', { type: 'text', placeholder: 'Filter settings…' });
  const render = () => { const q = search.value.toLowerCase(); body.replaceChildren(h('div', { class: 'card' }, settings.filter((s) => s.key.includes(q)).map((s) => settingEditor(gid, s, () => viewGuild(gid))))); };
  search.addEventListener('input', render); render();
  const tabs = h('div', { class: 'tabs' }, h('a', { class: 'btn', href: `#/guild/${gid}` }, 'Settings'), h('a', { class: 'btn secondary', href: `#/guild/${gid}/cases` }, 'Cases'), h('a', { class: 'btn secondary', href: `#/guild/${gid}/audit` }, 'Audit log'));
  mount(h('h1', {}, ov.name), h('p', { class: 'muted' }, `${ov.members} members • ${ov.channels} channels • ${ov.roles} roles • ${ov.cases} cases • ${ov.openTickets} open tickets • ${ov.customCommands} custom commands`), tabs, search, body);
}

async function viewTable(gid, kind) {
  const rows = await api(`/api/guilds/${gid}/${kind}`);
  const cols = kind === 'cases' ? ['case_no', 'type', 'target_id', 'moderator_id', 'reason', 'ts'] : ['ts', 'actor_id', 'action', 'target', 'details', 'source'];
  const fmt = (c, v) => (c === 'ts' ? new Date(v * 1000).toISOString().replace('T', ' ').slice(0, 16) : v ?? '');
  mount(h('h1', {}, kind === 'cases' ? 'Moderation cases' : 'Audit log'), h('p', {}, h('a', { href: `#/guild/${gid}` }, '← Back to settings')),
    h('div', { class: 'card', style: 'overflow-x:auto' }, h('table', {}, h('tr', {}, cols.map((c) => h('th', {}, c))), rows.map((r) => h('tr', {}, cols.map((c) => h('td', {}, fmt(c, r[c]))))))));
}

async function viewCommands() {
  const list = await api('/api/commands'); const q = h('input', { type: 'text', placeholder: `Search ${list.length} commands…` }); const out = h('div');
  const render = () => { const s = q.value.toLowerCase(); out.replaceChildren(h('table', {}, list.filter((c) => !s || c.name.includes(s) || c.description.toLowerCase().includes(s) || c.category.toLowerCase().includes(s)).slice(0, 300).map((c) => h('tr', {}, h('td', {}, h('code', {}, c.name)), h('td', {}, c.description), h('td', {}, c.access === 'user' ? '' : h('span', { class: 'tag' }, c.access)))))); };
  q.addEventListener('input', render); render();
  mount(h('h1', {}, 'Commands'), h('p', { class: 'muted' }, 'Every command works as a slash command and with the prefix (default “!”).'), q, h('div', { class: 'card' }, out));
}

async function viewStatus() {
  const s = await api('/api/status');
  mount(h('h1', {}, 'Status'), h('div', { class: 'card' }, h('p', {}, `${s.botName} v${s.version}`), h('p', {}, `Servers: ${s.guilds}`), h('p', {}, `Gateway ping: ${s.pingMs} ms`), h('p', {}, `Registered actions: ${s.commands}`), h('p', {}, `Uptime: ${Math.floor(s.uptimeSecs / 3600)}h ${Math.floor((s.uptimeSecs % 3600) / 60)}m`)));
}

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/'; const parts = hash.split('/').filter(Boolean);
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.getAttribute('href') === `#/${parts[0] === 'guild' ? '' : parts[0] || ''}`);
  try {
    if (parts[0] === 'guild' && parts[1] && /^\d+$/.test(parts[1])) { if (!state.user) return viewHome(); return parts[2] === 'cases' || parts[2] === 'audit' ? await viewTable(parts[1], parts[2]) : await viewGuild(parts[1]); }
    if (parts[0] === 'commands') return await viewCommands();
    if (parts[0] === 'status') return await viewStatus();
    return await viewHome();
  } catch (e) { mount(h('div', { class: 'card err' }, e.message)); }
}

async function init() {
  const [id, me] = await Promise.all([api('/api/identity'), api('/api/me')]);
  $('#logo').textContent = id.logo; $('#signature').textContent = id.attributionUpper; $('#ver').textContent = `${id.botName} v${id.version}`;
  state.user = me.user; state.csrf = me.csrf; state.loginEnabled = me.loginEnabled;
  const who = $('#who');
  if (me.user) who.replaceChildren(`${me.user.username} `, h('button', { class: 'secondary', onclick: async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; } }, 'Sign out'));
  window.addEventListener('hashchange', route); route();
}
init().catch((e) => mount(h('div', { class: 'card err' }, e.message)));

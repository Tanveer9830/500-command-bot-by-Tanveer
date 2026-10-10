'use strict';
/**
 * TANVEER PRIME branding: terminal logo, panels, banners, Discord embeds and
 * dashboard identity. Everything is pure (returns strings/objects) except the
 * `print*` helpers, which write to a stream.
 *
 * Terminal behaviour:
 *  - colour is disabled for NO_COLOR, TERM=dumb, non-TTY streams (unless FORCE_COLOR)
 *  - narrow terminals (< LOGO_WIDTH columns) get a compact wordmark instead of wrapping
 *  - non-UTF-8 terminals or BRAND_ASCII=1 get an ASCII-only rendering of the same artwork
 *  - every coloured segment is terminated with a reset sequence
 */
const { IDENTITY, COLORS } = require('../constants');

// ---------------------------------------------------------------------------
// Supplied artwork — kept verbatim (lettering and line order preserved).
// ---------------------------------------------------------------------------
const LOGO_LINES = Object.freeze([
  '██╗   ██╗ █████╗ ███╗   ██╗██╗   ██╗███████╗███████╗██████╗ ',
  '╚██╗ ██╔╝██╔══██╗████╗  ██║██║   ██║██╔════╝██╔════╝██╔══██╗',
  ' ╚████╔╝ ███████║██╔██╗ ██║██║   ██║█████╗  █████╗  ██████╔╝',
  '  ╚██╔╝  ██╔══██║██║╚██╗██║╚██╗ ██╔╝██╔══╝  ██╔══╝  ██╔══██╗',
  '   ██║   ██║  ██║██║ ╚████║ ╚████╔╝ ███████╗███████╗██║  ██║',
  '   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚══════╝╚══════╝╚═╝  ╚═╝',
]);

// Panel content (text taken from the supplied panel). The box is rebuilt
// programmatically so that every row has exactly the same width.
const PANEL_INNER_WIDTH = 62;
const PANEL_ROWS = Object.freeze([
  { t: 'blank' },
  { t: 'title', text: '◈  T A N V E E R   //   P R I M E  ◈' },
  { t: 'blank' },
  { t: 'rule' },
  { t: 'blank' },
  { t: 'kv', k: 'CREATOR', v: 'MADE BY TANVEER' },
  { t: 'kv', k: 'DISCORD', v: 'tanveer5637' },
  { t: 'kv', k: 'IDENTITY', v: 'ORIGINAL • AUTHENTIC • PERMANENT' },
  { t: 'blank' },
]);

const LOGO_WIDTH = Math.max(...LOGO_LINES.map((l) => [...l].length));
const PANEL_WIDTH = PANEL_INNER_WIDTH + 2;

// ---------------------------------------------------------------------------
// Terminal capability detection
// ---------------------------------------------------------------------------
const ESC = '\u001b[';
const RESET = `${ESC}0m`;

function detectCaps(stream = process.stdout, env = process.env) {
  const isTTY = Boolean(stream && stream.isTTY);
  let color;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') color = false;
  else if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') color = true;
  else if (env.FORCE_COLOR === '0') color = false;
  else if (env.TERM === 'dumb') color = false;
  else color = isTTY;

  const locale = `${env.LC_ALL || ''}${env.LC_CTYPE || ''}${env.LANG || ''}`.toLowerCase();
  let unicode = true;
  if (env.BRAND_ASCII === '1' || env.BRAND_ASCII === 'true') unicode = false;
  else if (env.TERM === 'linux' || env.TERM === 'dumb') unicode = Boolean(/utf-?8/.test(locale));
  else if (locale && !/utf-?8/.test(locale) && env.BRAND_ASCII !== '0') unicode = false;

  const truecolor = /truecolor|24bit/i.test(env.COLORTERM || '');
  const columns = Number(stream && stream.columns) || Number(env.COLUMNS) || 80;
  return { color, unicode, truecolor, columns };
}

// ---------------------------------------------------------------------------
// Colour helpers (cyan, electric blue, violet, white + restrained green)
// ---------------------------------------------------------------------------
const PALETTE = {
  cyan: { rgb: [0, 229, 255], c256: 45 },
  blue: { rgb: [31, 107, 255], c256: 33 },
  violet: { rgb: [138, 77, 255], c256: 99 },
  white: { rgb: [255, 255, 255], c256: 15 },
  green: { rgb: [46, 204, 113], c256: 41 },
  dim: { rgb: [140, 150, 170], c256: 245 },
};

function paint(text, name, caps, { bold = false } = {}) {
  if (!caps.color) return text;
  const p = PALETTE[name] || PALETTE.white;
  const code = caps.truecolor ? `38;2;${p.rgb.join(';')}` : `38;5;${p.c256}`;
  return `${ESC}${bold ? '1;' : ''}${code}m${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Width helpers
// ---------------------------------------------------------------------------
/** Display width: every glyph used by the branding is single-width. */
function width(str) {
  return [...String(str).replace(/\u001b\[[0-9;]*m/g, '')].length;
}
function padRight(str, w) {
  return str + ' '.repeat(Math.max(0, w - width(str)));
}
function center(str, w) {
  const total = Math.max(0, w - width(str));
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + str + ' '.repeat(total - left);
}

const ASCII_MAP = {
  '█': '#', '╗': '\\', '╔': '/', '╝': '/', '╚': '\\', '║': '|', '═': '=',
  '◈': '*', '━': '-', '•': '*', '╠': '+', '╣': '+', '╦': '+', '╩': '+',
};
function toAscii(str) {
  return [...str].map((ch) => (ASCII_MAP[ch] !== undefined ? ASCII_MAP[ch] : ch)).join('');
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------
const GRADIENT = ['cyan', 'cyan', 'blue', 'blue', 'violet', 'violet'];

/** Main logo. Narrow terminals receive the compact wordmark (no wrapping). */
function renderLogo(opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  if (caps.columns < LOGO_WIDTH) return renderWordmark(caps);
  return LOGO_LINES.map((line, i) => {
    const text = caps.unicode ? line : toAscii(line);
    return paint(text, GRADIENT[i % GRADIENT.length], caps, { bold: true });
  }).join('\n');
}

function renderWordmark(caps) {
  const diamond = caps.unicode ? '◈' : '*';
  const text = `${diamond} TANVEER PRIME ${diamond}`;
  return paint(text, 'cyan', caps, { bold: true });
}

/** The PRIME signature panel with a corrected, uniform width. */
function renderPanel(opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  if (caps.columns < PANEL_WIDTH) return renderCompactPanel(caps);
  const u = caps.unicode;
  const ch = u
    ? { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', rule: '━' }
    : { tl: '+', tr: '+', bl: '+', br: '+', h: '=', v: '|', rule: '-' };
  const inner = PANEL_INNER_WIDTH;
  const border = (s) => paint(s, 'blue', caps);
  const row = (content) => `${border(ch.v)}${content}${border(ch.v)}`;
  const out = [border(ch.tl + ch.h.repeat(inner) + ch.tr)];
  for (const r of PANEL_ROWS) {
    if (r.t === 'blank') out.push(row(' '.repeat(inner)));
    else if (r.t === 'rule') {
      out.push(row('  ' + paint(ch.rule.repeat(inner - 4), 'violet', caps) + '  '));
    } else if (r.t === 'title') {
      const text = u ? r.text : toAscii(r.text);
      out.push(row(center(paint(text, 'cyan', caps, { bold: true }), inner)));
    } else if (r.t === 'kv') {
      const value = u ? r.v : toAscii(r.v);
      const k = paint(`[ ${r.k} ]`, 'blue', caps);
      const gap = ' '.repeat(Math.max(1, 16 - width(`[ ${r.k} ]`)));
      const v = paint(value, r.k === 'CREATOR' ? 'white' : 'cyan', caps, { bold: r.k === 'CREATOR' });
      out.push(row('   ' + padRight(k + gap + v, inner - 3)));
    }
  }
  out.push(border(ch.bl + ch.h.repeat(inner) + ch.br));
  return out.join('\n');
}

function renderCompactPanel(caps) {
  return [
    renderWordmark(caps),
    paint(`[ CREATOR ] ${IDENTITY.SIGNATURE}`, 'white', caps),
    paint(`[ DISCORD ] ${IDENTITY.DISCORD_USERNAME}`, 'cyan', caps),
  ].join('\n');
}

/** One-line creator signature. */
function signature(opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  const line = IDENTITY.ATTRIBUTION_UPPER;
  const text = caps.columns < width(line) + 2 ? IDENTITY.SIGNATURE : line;
  return paint(caps.unicode ? text : toAscii(text), 'violet', caps, { bold: true });
}

/** Full startup + installation banner. */
function fullBanner(opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  return ['', renderLogo(caps), '', renderPanel(caps), ''].join('\n');
}

/** Compact logo used for restarts and updates. */
function compactBanner(title = 'TANVEER PRIME', opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  const d = caps.unicode ? '◈' : '*';
  const bar = (caps.unicode ? '━' : '-').repeat(Math.max(10, Math.min(caps.columns - 2, 48)));
  return [
    paint(`${d} T A N V E E R   P R I M E ${d}`, 'cyan', caps, { bold: true }),
    paint(bar, 'violet', caps),
    paint(title, 'white', caps, { bold: true }),
    signature(caps),
  ].join('\n');
}

function boxedBanner(kind, title, lines, caps) {
  const u = caps.unicode;
  const mark = kind === 'success' ? (u ? '✔' : 'OK') : kind === 'error' ? (u ? '✖' : 'ERR') : (u ? '◈' : '*');
  const markColor = kind === 'success' ? 'green' : kind === 'error' ? 'violet' : 'cyan';
  const head = `${paint(mark, markColor, caps, { bold: true })} ${paint(title, 'white', caps, { bold: true })}`;
  const bar = paint((u ? '━' : '-').repeat(Math.max(10, Math.min(caps.columns - 2, 60))), 'blue', caps);
  const body = (lines || []).map((l) => `  ${l}`);
  return ['', renderWordmarkLine(caps), bar, head, ...body, bar, signature(caps), ''].join('\n');
}
function renderWordmarkLine(caps) {
  return renderWordmark(caps);
}

/** Installer success banner (green is used only for confirmed success). */
function successBanner(title, lines = [], opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  return [fullBanner(caps), boxedBanner('success', title, lines, caps)].join('\n');
}
function diagnosticsBanner(title = 'DIAGNOSTICS', lines = [], opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  return boxedBanner('info', title, lines, caps);
}
function updateBanner(title = 'UPDATE', lines = [], opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  return [compactBanner(title, caps), ...lines.map((l) => `  ${l}`), ''].join('\n');
}
function errorBanner(title, lines = [], opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  return boxedBanner('error', title, lines, caps);
}

/** Single status line: success is green and only meant for confirmed results. */
function status(kind, message, opts = {}) {
  const caps = { ...detectCaps(), ...opts };
  const u = caps.unicode;
  const map = {
    ok: [u ? '✔' : 'OK', 'green'],
    info: [u ? '◈' : '*', 'cyan'],
    warn: [u ? '▲' : '!', 'violet'],
    fail: [u ? '✖' : 'X', 'violet'],
  };
  const [mark, col] = map[kind] || map.info;
  return `${paint(mark, col, caps, { bold: true })} ${message}`;
}

// ---------------------------------------------------------------------------
// Discord embed branding
// ---------------------------------------------------------------------------
function embedFooter(botName) {
  return { text: `${IDENTITY.ATTRIBUTION_UPPER}${botName ? ` • ${botName}` : ''}` };
}

/** Base embed for /about, /help and other branded responses. */
function discordEmbed(kind = 'default', { botName = 'TANVEER PRIME', title, description } = {}) {
  const colors = { default: COLORS.CYAN, about: COLORS.VIOLET, help: COLORS.BLUE, success: COLORS.GREEN, error: COLORS.RED };
  return {
    color: colors[kind] ?? COLORS.CYAN,
    title: title || undefined,
    description: description || undefined,
    footer: embedFooter(botName),
  };
}

function aboutEmbed({ botName = 'TANVEER PRIME', version = '1.0.0', stats = {} } = {}) {
  const e = discordEmbed('about', { botName, title: `◈ ${IDENTITY.PRODUCT} ◈` });
  e.description = [
    '```',
    `[ CREATOR ]  ${IDENTITY.SIGNATURE}`,
    `[ DISCORD ]  ${IDENTITY.DISCORD_USERNAME}`,
    '[ IDENTITY ] ORIGINAL • AUTHENTIC • PERMANENT',
    '```',
  ].join('\n');
  e.fields = [
    { name: 'Bot name', value: String(botName), inline: true },
    { name: 'Version', value: String(version), inline: true },
    ...Object.entries(stats).map(([name, value]) => ({ name, value: String(value), inline: true })),
    { name: 'Creator', value: IDENTITY.ATTRIBUTION, inline: false },
  ];
  return e;
}

function helpEmbed({ botName = 'TANVEER PRIME', prefix = '!', description = '' } = {}) {
  const e = discordEmbed('help', { botName, title: `◈ ${IDENTITY.PRODUCT} — HELP` });
  e.description = description || `Use slash commands (\`/\`) or the prefix \`${prefix}\`. ${IDENTITY.SIGNATURE}.`;
  return e;
}

// ---------------------------------------------------------------------------
// Dashboard identity (kept next to the terminal identity so they match)
// ---------------------------------------------------------------------------
function dashboardIdentity() {
  return {
    product: IDENTITY.PRODUCT,
    signature: IDENTITY.SIGNATURE,
    attribution: IDENTITY.ATTRIBUTION,
    attributionUpper: IDENTITY.ATTRIBUTION_UPPER,
    discordUsername: IDENTITY.DISCORD_USERNAME,
    logo: LOGO_LINES.join('\n'),
    panel: renderPanel({ color: false, unicode: true, columns: 200 }),
    colors: { cyan: '#00e5ff', blue: '#1f6bff', violet: '#8a4dff', white: '#ffffff', green: '#2ecc71' },
  };
}

// ---------------------------------------------------------------------------
// Printing helpers
// ---------------------------------------------------------------------------
function print(text, stream = process.stdout) {
  stream.write(`${text}\n`);
  // Always leave the terminal in its default colour state.
  if (detectCaps(stream).color) stream.write(RESET);
}

module.exports = {
  LOGO_LINES, LOGO_WIDTH, PANEL_WIDTH, PANEL_INNER_WIDTH, RESET,
  detectCaps, paint, width, toAscii,
  renderLogo, renderPanel, signature, fullBanner, compactBanner,
  successBanner, diagnosticsBanner, updateBanner, errorBanner, status,
  discordEmbed, aboutEmbed, helpEmbed, embedFooter, dashboardIdentity, print,
};

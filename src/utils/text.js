'use strict';
/** Text helpers: tokenizer for prefix commands, durations, formatting. No Discord dependency. */

/** Split on whitespace, honouring "double", 'single' and “smart” quotes. Keeps source offsets. */
function tokenize(input) {
  const tokens = [];
  const s = String(input);
  let i = 0;
  const pairs = { '"': '"', '“': '”', '„': '“', "'": "'" };
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    const start = i;
    const close = pairs[s[i]];
    // A quote only opens a token at a word boundary (so don't → one token).
    if (close) {
      let j = i + 1; let value = '';
      let closed = false;
      while (j < s.length) {
        if (s[j] === '\\' && j + 1 < s.length) { value += s[j + 1]; j += 2; continue; }
        if (s[j] === close && (j + 1 >= s.length || /\s/.test(s[j + 1]))) { closed = true; break; }
        value += s[j]; j++;
      }
      if (closed) { tokens.push({ value, start, end: j + 1, quoted: true }); i = j + 1; continue; }
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    tokens.push({ value: s.slice(i, j), start, end: j, quoted: false });
    i = j;
  }
  return tokens;
}

const UNIT_SECONDS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400,
  w: 604800, wk: 604800, week: 604800, weeks: 604800, mo: 2592000, month: 2592000, months: 2592000, y: 31536000, yr: 31536000, year: 31536000, years: 31536000 };

/** "1h30m", "90s", "2 days", "45" (seconds) → seconds, or null when invalid. */
function parseDuration(input) {
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0; let consumed = 0; let m;
  while ((m = re.exec(s)) !== null) {
    const unit = UNIT_SECONDS[m[2]];
    if (!unit) return null;
    total += Number(m[1]) * unit; consumed += m[0].length;
  }
  const stripped = s.replace(/\s+/g, '');
  const matched = [...s.matchAll(re)].map((x) => x[0].replace(/\s+/g, '')).join('');
  if (!consumed || matched.length !== stripped.length) return null;
  return Math.round(total);
}

function formatDuration(totalSeconds) {
  let s = Math.max(0, Math.round(totalSeconds));
  if (s === 0) return '0s';
  const parts = [];
  for (const [label, size] of [['y', 31536000], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    if (s >= size) { parts.push(`${Math.floor(s / size)}${label}`); s %= size; }
  }
  return parts.slice(0, 3).join(' ');
}

function truncate(str, max, ellipsis = '…') {
  const s = String(str ?? '');
  return s.length <= max ? s : s.slice(0, Math.max(0, max - ellipsis.length)) + ellipsis;
}

/** Neutralise mass mentions in text that will be echoed. */
function safe(str) {
  return String(str ?? '').replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@([!&]?\d+)>/g, '<@\u200b$1>');
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
function codeBlock(text, lang = '') { return `\`\`\`${lang}\n${String(text).replace(/```/g, "'''")}\n\`\`\``; }
function bullet(lines) { return lines.map((l) => `• ${l}`).join('\n'); }
function ts(unixSeconds, style = 'R') { return `<t:${Math.floor(unixSeconds)}:${style}>`; }
function titleCase(s) { return String(s).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function sum(a) { return a.reduce((x, y) => x + y, 0); }

/** Replace {name} placeholders from `vars`; unknown placeholders are left untouched. Output is mention-safe. */
function fillTemplate(template, vars) {
  return safe(String(template).replace(/\{(\w+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : all)));
}

module.exports = { fillTemplate, tokenize, parseDuration, formatDuration, truncate, safe, pad, fmtNum, codeBlock, bullet, ts, titleCase, clamp, sum };

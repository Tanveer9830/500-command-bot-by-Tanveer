'use strict';
/** Pure text and encoding utilities. Deterministic, no network, no state. */
const crypto = require('node:crypto');
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { truncate, safe, fmtNum } = require('../utils/text');

const t = { name: 'text', type: 'string', description: 'The text', required: true, maxLength: 1500, rest: true };
const out = (s) => truncate(safe(String(s)), 1900);
const words = (s) => s.split(/\s+/).filter(Boolean);
const splitWords = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '-': '-....-', ':': '---...', '@': '.--.-.' };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', b: '8', g: '9' };
const FLIP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z', '?': '¿', '!': '¡', '.': '˙', ',': '\'', '(': ')', ')': '(' };
const HTML_ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

function caesar(s, shift) {
  const k = ((shift % 26) + 26) % 26;
  return s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + k) % 26) + b); });
}

module.exports = function register(registry) {
  const T = registry.group({ name: 'text', description: 'Text transformation tools', category: 'Text Tools' });
  const SG = { case: ['upper', 'lower', 'title', 'sentence', 'snake', 'camel', 'kebab', 'slug', 'mock'], fancy: ['clap', 'wide', 'leet', 'flip', 'emojify', 'spoiler'], analyze: ['count', 'vowels', 'wordfreq', 'longest', 'palindrome', 'anagram'] };
  T.subgroup('case', 'Change letter case and style').subgroup('fancy', 'Decorative text').subgroup('analyze', 'Analyse text');
  const sg = (sub) => Object.keys(SG).find((k) => SG[k].includes(sub));
  const A = (sub, description, fn, extra = {}) => T.action(sub, { description, options: [t], subgroup: sg(sub), ...extra }, (ctx) => out(fn(ctx.args.text, ctx)));
  A('reverse', 'Reverse the text', (s) => [...s].reverse().join(''));
  A('upper', 'UPPERCASE', (s) => s.toUpperCase());
  A('lower', 'lowercase', (s) => s.toLowerCase());
  A('title', 'Title Case', (s) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()));
  A('sentence', 'Sentence case', (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()));
  A('snake', 'snake_case', (s) => splitWords(s).map((w) => w.toLowerCase()).join('_'));
  A('camel', 'camelCase', (s) => splitWords(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(''));
  A('kebab', 'kebab-case', (s) => splitWords(s).map((w) => w.toLowerCase()).join('-'));
  A('slug', 'URL slug (accents removed)', (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  A('mock', 'sPoNgEbOb cAsE', (s) => { let i = 0; return [...s].map((c) => (/\p{L}/u.test(c) ? (i++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c)).join(''); });
  A('clap', 'Put 👏 between 👏 words', (s) => words(s).join(' 👏 '));
  A('wide', 'ｆｕｌｌｗｉｄｔｈ text', (s) => [...s].map((c) => { const n = c.charCodeAt(0); return n >= 33 && n <= 126 ? String.fromCharCode(n + 0xfee0) : c === ' ' ? '\u3000' : c; }).join(''));
  A('leet', '1337 5p34k', (s) => [...s.toLowerCase()].map((c) => LEET[c] || c).join(''));
  A('flip', 'Upside-down text', (s) => [...s.toLowerCase()].reverse().map((c) => FLIP[c] || c).join(''));
  A('emojify', 'Turn letters into emoji letters', (s) => [...s.toLowerCase()].map((c) => (/[a-z]/.test(c) ? String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 97) : c === ' ' ? '   ' : /\d/.test(c) ? `${c}\ufe0f\u20e3` : c)).join(' '));
  A('spoiler', 'Hide each word behind a spoiler', (s) => words(s).map((w) => `||${w.replace(/\|/g, '')}||`).join(' '));
  A('trim', 'Collapse extra whitespace', (s) => words(s).join(' '));
  A('sortwords', 'Sort words alphabetically', (s) => words(s).sort((a, b) => a.localeCompare(b)).join(' '));
  A('dedupe', 'Remove repeated words', (s) => [...new Set(words(s))].join(' '));
  A('shuffle', 'Shuffle the words', (s, ctx) => { const w = words(s); for (let i = w.length - 1; i > 0; i--) { const j = Math.floor(ctx.svc.random() * (i + 1)); [w[i], w[j]] = [w[j], w[i]]; } return w.join(' '); });
  A('acronym', 'First letters of each word', (s) => words(s).map((w) => w[0]).join('').toUpperCase());
  A('palindrome', 'Is it a palindrome?', (s) => { const c = [...s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')]; return c.length && c.join('') === [...c].reverse().join('') ? '✅ Yes, it is a palindrome.' : '❌ No, it is not a palindrome.'; });
  A('vowels', 'Count vowels and consonants', (s) => { const l = [...s.toLowerCase()].filter((c) => /[a-z]/.test(c)); const v = l.filter((c) => 'aeiou'.includes(c)).length; return `Vowels: ${v} • Consonants: ${l.length - v}`; });
  A('count', 'Characters, words, lines and bytes', (s) => `Characters: ${fmtNum([...s].length)} • Words: ${fmtNum(words(s).length)} • Lines: ${s.split('\n').length} • UTF-8 bytes: ${fmtNum(Buffer.byteLength(s))}`);
  A('wordfreq', 'Most frequent words', (s) => { const m = new Map(); for (const w of words(s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ''))) m.set(w, (m.get(w) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([w, n]) => `${w}: ${n}`).join('\n') || 'No words.'; });
  A('longest', 'The longest word', (s) => { const w = words(s).sort((a, b) => b.length - a.length)[0]; return w ? `${w} (${w.length} characters)` : 'No words.'; });
  A('anagram', 'Check whether two words are anagrams (separate with a space)', (s) => { const w = words(s); if (w.length !== 2) throw new UserError('Give exactly two words.'); const n = (x) => [...x.toLowerCase()].sort().join(''); return n(w[0]) === n(w[1]) ? `✅ **${w[0]}** and **${w[1]}** are anagrams.` : `❌ **${w[0]}** and **${w[1]}** are not anagrams.`; });
  T.action('repeat', { description: 'Repeat text N times', options: [{ name: 'times', type: 'integer', description: '1-20', required: true, min: 1, max: 20 }, { ...t, maxLength: 200 }] }, (ctx) => out(Array(ctx.args.times).fill(ctx.args.text).join(' ')));
  T.action('pad', { description: 'Pad text to a width with a fill character', options: [{ name: 'width', type: 'integer', description: '1-100', required: true, min: 1, max: 100 }, { name: 'fill', type: 'string', description: 'Fill character', required: true, maxLength: 1 }, { ...t, maxLength: 100 }] }, (ctx) => `\`${ctx.args.text.padStart(ctx.args.width, ctx.args.fill).replace(/`/g, "'")}\``);

  // ------------------------------------------------------------------ encode
  const E = registry.group({ name: 'encode', description: 'Encoders, decoders and hashes', category: 'Text Tools', aliases: ['enc'] });
  const B = (sub, description, fn, extra = {}) => E.action(sub, { description, options: [t], ...extra }, (ctx) => { try { return out(fn(ctx.args.text, ctx)); } catch (e) { if (e instanceof UserError) throw e; throw new UserError(`Could not process that input: ${e.message}`); } });
  B('base64', 'Encode as Base64', (s) => Buffer.from(s).toString('base64'));
  B('unbase64', 'Decode Base64', (s) => { if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s.replace(/\s/g, ''))) throw new UserError('That is not valid Base64.'); return Buffer.from(s.replace(/\s/g, ''), 'base64').toString('utf8'); });
  B('hex', 'Encode as hexadecimal', (s) => Buffer.from(s).toString('hex'));
  B('unhex', 'Decode hexadecimal', (s) => { const h = s.replace(/\s|0x/g, ''); if (!/^([0-9a-f]{2})+$/i.test(h)) throw new UserError('That is not valid hex (need an even number of hex digits).'); return Buffer.from(h, 'hex').toString('utf8'); });
  B('binary', 'Encode as binary', (s) => [...Buffer.from(s)].map((b) => b.toString(2).padStart(8, '0')).join(' '));
  B('unbinary', 'Decode binary', (s) => { const p = s.split(/\s+/); if (!p.every((x) => /^[01]{8}$/.test(x))) throw new UserError('Use groups of 8 bits separated by spaces.'); return Buffer.from(p.map((x) => parseInt(x, 2))).toString('utf8'); });
  B('url', 'Percent-encode for URLs', (s) => encodeURIComponent(s));
  B('unurl', 'Decode percent-encoding', (s) => decodeURIComponent(s));
  B('morse', 'Encode as Morse code', (s) => [...s.toLowerCase()].map((c) => (c === ' ' ? '/' : MORSE[c] || '?')).join(' '));
  B('unmorse', 'Decode Morse code (letters space-separated, words with /)', (s) => s.trim().split(/\s*\/\s*/).map((w) => w.split(/\s+/).map((c) => UNMORSE[c] || '?').join('')).join(' '));
  B('rot13', 'ROT13 cipher', (s) => caesar(s, 13));
  B('atbash', 'Atbash cipher', (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(b + 25 - (c.charCodeAt(0) - b)); }));
  E.action('caesar', { description: 'Caesar cipher with a custom shift', options: [{ name: 'shift', type: 'integer', description: '-25 to 25', required: true, min: -25, max: 25 }, t] }, (ctx) => out(caesar(ctx.args.text, ctx.args.shift)));
  B('html', 'Escape HTML entities', (s) => s.replace(/[&<>"']/g, (c) => HTML_ENT[c]));
  B('unhtml', 'Unescape basic HTML entities', (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => Object.keys(HTML_ENT).find((k) => HTML_ENT[k] === m)));
  B('codepoints', 'Unicode code points of each character', (s) => [...s].slice(0, 60).map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' '));
  B('bytes', 'UTF-8 byte length and bytes', (s) => `${Buffer.byteLength(s)} bytes: ${[...Buffer.from(s)].slice(0, 40).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  E.action('hash', { description: 'Hash text (md5, sha1, sha256, sha512)', options: [{ name: 'algorithm', type: 'string', description: 'Algorithm', required: true, choices: ['md5', 'sha1', 'sha256', 'sha512'] }, t] }, (ctx) => `\`${ctx.args.algorithm}\`: \`${crypto.createHash(ctx.args.algorithm).update(ctx.args.text).digest('hex')}\``);
  E.action('uuid', { description: 'Generate a random UUID v4', options: [] }, () => `\`${crypto.randomUUID()}\``);
  B('jwt', 'Decode (not verify!) a JWT header and payload', (s) => {
    const p = s.trim().split('.'); if (p.length < 2) throw new UserError('That does not look like a JWT.');
    const dec = (x) => JSON.parse(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return `⚠️ Decoded only — the signature is NOT verified.\nHeader: ${JSON.stringify(dec(p[0]))}\nPayload: ${JSON.stringify(dec(p[1]))}`;
  });
};
void H;

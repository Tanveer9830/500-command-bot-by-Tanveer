'use strict';
/** Single-player mini-games with short-lived in-memory sessions and persisted win/loss stats. */
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { safe, fmtNum } = require('../utils/text');

const TTL = 15 * 60;
const sessions = new Map();
const keyOf = (ctx, game) => `${ctx.guildId || 'dm'}:${ctx.user.id}:${game}`;
function getSession(ctx, game) {
  const k = keyOf(ctx, game); const s = sessions.get(k);
  if (!s) return null;
  if (ctx.svc.now() > s.exp) { sessions.delete(k); return null; }
  return s;
}
function putSession(ctx, game, data) {
  if (sessions.size > 5000) { const now = ctx.svc.now(); for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k); }
  const s = { data, exp: ctx.svc.now() + TTL }; sessions.set(keyOf(ctx, game), s); return s;
}
const endSession = (ctx, game) => sessions.delete(keyOf(ctx, game));
const needSession = (ctx, game, hint) => { const s = getSession(ctx, game); if (!s) throw new UserError(`You have no active game. ${hint}`); s.exp = ctx.svc.now() + TTL; return s.data; };
function record(ctx, game, won) {
  if (!ctx.guildId) return;
  ctx.db.prepare(`INSERT INTO game_stats (guild_id, user_id, game, wins, losses) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id, game) DO UPDATE SET wins = wins + excluded.wins, losses = losses + excluded.losses`).run(ctx.guildId, ctx.user.id, game, won ? 1 : 0, won ? 0 : 1);
}

const WORDS = ['planet', 'rocket', 'galaxy', 'python', 'server', 'keyboard', 'dolphin', 'volcano', 'compass', 'lantern', 'harvest', 'blanket', 'journey', 'mystery', 'network', 'pyramid', 'diamond', 'whisper', 'thunder', 'library', 'penguin', 'rainbow', 'balance', 'capture', 'digital', 'eclipse', 'fortune', 'glacier', 'horizon', 'inspire'];
const TRIVIA = [
  { c: 'science', q: 'What is the chemical symbol for gold?', a: 'Au', w: ['Ag', 'Gd', 'Go'] },
  { c: 'science', q: 'Which planet is known as the Red Planet?', a: 'Mars', w: ['Venus', 'Jupiter', 'Mercury'] },
  { c: 'science', q: 'How many bones are in the adult human body?', a: '206', w: ['196', '212', '300'] },
  { c: 'science', q: 'What gas do plants absorb from the atmosphere for photosynthesis?', a: 'Carbon dioxide', w: ['Oxygen', 'Nitrogen', 'Hydrogen'] },
  { c: 'science', q: 'What is the hardest natural substance on Earth?', a: 'Diamond', w: ['Quartz', 'Granite', 'Iron'] },
  { c: 'science', q: 'What is the speed of light in a vacuum (approximately)?', a: '299,792 km/s', w: ['150,000 km/s', '30,000 km/s', '1,000,000 km/s'] },
  { c: 'geography', q: 'What is the capital of Australia?', a: 'Canberra', w: ['Sydney', 'Melbourne', 'Perth'] },
  { c: 'geography', q: 'Which is the longest river in South America?', a: 'Amazon', w: ['Orinoco', 'Paraná', 'Magdalena'] },
  { c: 'geography', q: 'Which country has the most time zones (including territories)?', a: 'France', w: ['Russia', 'USA', 'China'] },
  { c: 'geography', q: 'What is the smallest country in the world by area?', a: 'Vatican City', w: ['Monaco', 'San Marino', 'Liechtenstein'] },
  { c: 'geography', q: 'Mount Kilimanjaro is located in which country?', a: 'Tanzania', w: ['Kenya', 'Uganda', 'Ethiopia'] },
  { c: 'geography', q: 'What is the capital of Canada?', a: 'Ottawa', w: ['Toronto', 'Vancouver', 'Montreal'] },
  { c: 'history', q: 'In which year did World War II end?', a: '1945', w: ['1943', '1944', '1946'] },
  { c: 'history', q: 'Who was the first person to walk on the Moon?', a: 'Neil Armstrong', w: ['Buzz Aldrin', 'Yuri Gagarin', 'Michael Collins'] },
  { c: 'history', q: 'The ancient city of Machu Picchu was built by which civilisation?', a: 'Inca', w: ['Aztec', 'Maya', 'Olmec'] },
  { c: 'history', q: 'Which empire built the Colosseum?', a: 'Roman', w: ['Greek', 'Ottoman', 'Byzantine'] },
  { c: 'tech', q: 'What does "HTTP" stand for?', a: 'HyperText Transfer Protocol', w: ['HyperText Transmission Process', 'High Transfer Text Protocol', 'Host Transfer Type Protocol'] },
  { c: 'tech', q: 'Which language is primarily used to style web pages?', a: 'CSS', w: ['HTML', 'SQL', 'PHP'] },
  { c: 'tech', q: 'How many bits are in a byte?', a: '8', w: ['4', '16', '10'] },
  { c: 'tech', q: 'Who created the Linux kernel?', a: 'Linus Torvalds', w: ['Richard Stallman', 'Dennis Ritchie', 'Bill Gates'] },
  { c: 'general', q: 'How many continents are there?', a: '7', w: ['5', '6', '8'] },
  { c: 'general', q: 'What is the largest mammal on Earth?', a: 'Blue whale', w: ['African elephant', 'Giraffe', 'Hippopotamus'] },
  { c: 'general', q: 'How many strings does a standard violin have?', a: '4', w: ['5', '6', '3'] },
  { c: 'general', q: 'Which colour is made by mixing blue and yellow?', a: 'Green', w: ['Orange', 'Purple', 'Brown'] },
];
const CATS = ['science', 'geography', 'history', 'tech', 'general'];

function lines(b) { return [0, 3, 6].map((r) => b.slice(r, r + 3).map((c, i) => c || ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][r + i]).join('')).join('\n'); }
const WINS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winner = (b) => { for (const [x, y, z] of WINS) if (b[x] && b[x] === b[y] && b[y] === b[z]) return b[x]; return b.every(Boolean) ? 'draw' : null; };
function botMove(b, rnd) {
  const empty = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  for (const mark of ['⭕', '❌']) for (const i of empty) { const t = [...b]; t[i] = mark; if (winner(t) === mark) return i; }
  if (!b[4]) return 4;
  return empty[Math.floor(rnd() * empty.length)];
}

module.exports = function register(registry) {
  const G = registry.group({ name: 'game', description: 'Mini-games', category: 'Games' });
  G.subgroup('numguess', 'Guess the number').subgroup('hangman', 'Hangman').subgroup('scramble', 'Unscramble the word').subgroup('mathquiz', 'Quick maths').subgroup('tictactoe', 'Tic-tac-toe vs the bot').subgroup('highlow', 'Higher or lower');
  const GA = (subgroup, sub, spec, run) => G.action(sub, { subgroup, cooldown: 1, ...spec }, run);

  GA('numguess', 'start', { description: 'Start a number-guessing game', options: [{ name: 'max', type: 'integer', description: '10-10000 (default 100)', min: 10, max: 10000, default: 100 }] }, (ctx) => {
    const max = ctx.args.max; const tries = Math.ceil(Math.log2(max)) + 2;
    putSession(ctx, 'numguess', { n: 1 + Math.floor(ctx.svc.random() * max), max, tries, used: 0 });
    return `🔢 I'm thinking of a number from **1 to ${max}**. You have **${tries}** guesses — use \`game numguess guess <n>\`.`;
  });
  GA('numguess', 'guess', { description: 'Make a guess', options: [{ name: 'number', type: 'integer', description: 'Your guess', required: true, min: 1, max: 10000 }] }, (ctx) => {
    const g = needSession(ctx, 'numguess', 'Start one with `game numguess start`.'); g.used++;
    if (ctx.args.number === g.n) { endSession(ctx, 'numguess'); record(ctx, 'numguess', true); return `🎉 Correct! It was **${g.n}** — found in ${g.used} guess(es).`; }
    if (g.used >= g.tries) { endSession(ctx, 'numguess'); record(ctx, 'numguess', false); return `💀 Out of guesses! The number was **${g.n}**.`; }
    return `${ctx.args.number < g.n ? '⬆️ Higher' : '⬇️ Lower'}! ${g.tries - g.used} guess(es) left.`;
  });
  GA('numguess', 'quit', { description: 'Give up the current game' }, (ctx) => { const g = needSession(ctx, 'numguess', ''); endSession(ctx, 'numguess'); record(ctx, 'numguess', false); return `🏳️ The number was **${g.n}**.`; });

  const mask = (h) => [...h.word].map((c) => (h.guessed.has(c) ? c : '＿')).join(' ');
  GA('hangman', 'start', { description: 'Start hangman' }, (ctx) => { const word = H.pick(WORDS, ctx.svc.random); putSession(ctx, 'hangman', { word, guessed: new Set(), misses: 0 }); return `🪢 Hangman: ${mask({ word, guessed: new Set() })}\n${word.length} letters, 6 mistakes allowed. Use \`game hangman guess <letter or word>\`.`; });
  GA('hangman', 'guess', { description: 'Guess a letter or the whole word', options: [{ name: 'guess', type: 'string', description: 'A letter or the word', required: true, minLength: 1, maxLength: 20, pattern: /^[a-z]+$/i, patternHelp: 'letters only' }] }, (ctx) => {
    const h = needSession(ctx, 'hangman', 'Start one with `game hangman start`.'); const g = ctx.args.guess.toLowerCase();
    if (g.length > 1) { if (g === h.word) { endSession(ctx, 'hangman'); record(ctx, 'hangman', true); return `🎉 Yes! The word was **${h.word}**.`; } h.misses++; }
    else if (h.guessed.has(g)) throw new UserError('You already guessed that letter.');
    else { h.guessed.add(g); if (!h.word.includes(g)) h.misses++; }
    if ([...h.word].every((c) => h.guessed.has(c))) { endSession(ctx, 'hangman'); record(ctx, 'hangman', true); return `🎉 You got it: **${h.word}**!`; }
    if (h.misses >= 6) { endSession(ctx, 'hangman'); record(ctx, 'hangman', false); return `💀 Hanged! The word was **${h.word}**.`; }
    return `${mask(h)}\nMistakes: ${h.misses}/6 • Guessed: ${[...h.guessed].sort().join(' ') || '—'}`;
  });
  GA('hangman', 'quit', { description: 'Give up hangman' }, (ctx) => { const h = needSession(ctx, 'hangman', ''); endSession(ctx, 'hangman'); record(ctx, 'hangman', false); return `🏳️ The word was **${h.word}**.`; });

  GA('scramble', 'start', { description: 'Unscramble a word' }, (ctx) => {
    const word = H.pick(WORDS, ctx.svc.random); let s = word;
    for (let tries = 0; tries < 10 && s === word; tries++) { const a = [...word]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(ctx.svc.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } s = a.join(''); }
    if (s === word) s = [...word].reverse().join('');
    putSession(ctx, 'scramble', { word, tries: 0 }); return `🔀 Unscramble: **${s}** — answer with \`game scramble answer <word>\`.`;
  });
  GA('scramble', 'answer', { description: 'Submit your answer', options: [{ name: 'word', type: 'string', description: 'Your answer', required: true, maxLength: 30 }] }, (ctx) => {
    const s = needSession(ctx, 'scramble', 'Start one with `game scramble start`.'); s.tries++;
    if (ctx.args.word.toLowerCase() === s.word) { endSession(ctx, 'scramble'); record(ctx, 'scramble', true); return `🎉 Correct — **${s.word}**!`; }
    if (s.tries >= 3) { endSession(ctx, 'scramble'); record(ctx, 'scramble', false); return `💀 The word was **${s.word}**.`; }
    return `❌ Not quite. ${3 - s.tries} attempt(s) left.`;
  });

  GA('mathquiz', 'start', { description: 'Get a quick maths question', options: [{ name: 'level', type: 'string', description: 'easy, medium or hard', choices: ['easy', 'medium', 'hard'], default: 'easy' }] }, (ctx) => {
    const r = (n) => 1 + Math.floor(ctx.svc.random() * n); const lv = ctx.args.level; let a; let b; let op; let ans;
    if (lv === 'easy') { a = r(20); b = r(20); op = ctx.svc.random() < 0.5 ? '+' : '-'; ans = op === '+' ? a + b : a - b; }
    else if (lv === 'medium') { a = r(12) + 2; b = r(12) + 2; op = '×'; ans = a * b; }
    else { a = r(50) + 10; b = r(50) + 10; const c = r(9) + 1; op = '*'; ans = a * b - c; putSession(ctx, 'mathquiz', { ans }); return `➗ **${a} × ${b} − ${c}** = ? — \`game mathquiz answer <number>\``; }
    putSession(ctx, 'mathquiz', { ans }); return `➗ **${a} ${op} ${b}** = ? — \`game mathquiz answer <number>\``;
  });
  GA('mathquiz', 'answer', { description: 'Submit your answer', options: [{ name: 'number', type: 'integer', description: 'Your answer', required: true, min: -1e9, max: 1e9 }] }, (ctx) => { const s = needSession(ctx, 'mathquiz', 'Start one with `game mathquiz start`.'); endSession(ctx, 'mathquiz'); const ok = ctx.args.number === s.ans; record(ctx, 'mathquiz', ok); return ok ? '🎉 Correct!' : `❌ Nope — the answer was **${s.ans}**.`; });

  GA('tictactoe', 'start', { description: 'Start a game (you are ❌)' }, (ctx) => { const b = Array(9).fill(null); putSession(ctx, 'tictactoe', { b }); return `❌ You go first. Use \`game tictactoe move <1-9>\`.\n${lines(b)}`; });
  GA('tictactoe', 'move', { description: 'Place your mark', options: [{ name: 'cell', type: 'integer', description: '1-9', required: true, min: 1, max: 9 }] }, (ctx) => {
    const s = needSession(ctx, 'tictactoe', 'Start one with `game tictactoe start`.'); const i = ctx.args.cell - 1;
    if (s.b[i]) throw new UserError('That cell is taken.');
    s.b[i] = '❌'; let w = winner(s.b);
    if (!w) { s.b[botMove(s.b, ctx.svc.random)] = '⭕'; w = winner(s.b); }
    const board = lines(s.b);
    if (w) { endSession(ctx, 'tictactoe'); record(ctx, 'tictactoe', w === '❌'); return `${w === '❌' ? '🎉 You win!' : w === 'draw' ? '🤝 Draw!' : '😎 I win!'}\n${board}`; }
    return board;
  });
  GA('tictactoe', 'quit', { description: 'Abandon the game' }, (ctx) => { needSession(ctx, 'tictactoe', ''); endSession(ctx, 'tictactoe'); record(ctx, 'tictactoe', false); return '🏳️ Game abandoned.'; });

  const card = (ctx) => 1 + Math.floor(ctx.svc.random() * 13); const cname = (n) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] || String(n));
  GA('highlow', 'start', { description: 'Draw a card; guess if the next is higher or lower' }, (ctx) => { const c = card(ctx); putSession(ctx, 'highlow', { c, streak: 0 }); return `🃏 Card: **${cname(c)}**. Next one — \`game highlow guess higher|lower\`.`; });
  GA('highlow', 'guess', { description: 'Higher or lower?', options: [{ name: 'direction', type: 'string', description: 'higher or lower', required: true, choices: ['higher', 'lower'] }] }, (ctx) => {
    const s = needSession(ctx, 'highlow', 'Start one with `game highlow start`.'); const n = card(ctx);
    const ok = n === s.c || (ctx.args.direction === 'higher' ? n > s.c : n < s.c);
    if (!ok) { endSession(ctx, 'highlow'); record(ctx, 'highlow', s.streak >= 3); return `💀 It was **${cname(n)}** (was ${cname(s.c)}). Final streak: **${s.streak}**.`; }
    s.streak++; s.c = n; return `✅ **${cname(n)}**! Streak: ${s.streak}. Keep going!`;
  });

  G.action('stats', { description: 'Your game record', guildOnly: true, options: [{ name: 'user', type: 'user', description: 'User (default: you)' }] }, (ctx) => {
    const u = ctx.args.user || ctx.user; const rows = ctx.db.prepare('SELECT game, wins, losses FROM game_stats WHERE guild_id = ? AND user_id = ? ORDER BY game').all(ctx.guildId, u.id);
    return H.embed(ctx, { title: `${safe(u.username)}'s game record`, description: H.listLines(rows, (r) => `**${r.game}** — ${r.wins}W / ${r.losses}L`, 20) });
  });

  // ---------------------------------------------------------------- trivia
  const T = registry.group({ name: 'trivia', description: 'Multiple-choice quiz (built-in questions)', category: 'Games', defaultSub: 'ask' });
  const L = ['A', 'B', 'C', 'D'];
  T.action('ask', { description: 'Get a question', cooldown: 2, options: [{ name: 'category', type: 'string', description: 'Category', choices: CATS }] }, (ctx) => {
    const pool = TRIVIA.filter((q) => !ctx.args.category || q.c === ctx.args.category); const q = H.pick(pool, ctx.svc.random);
    const opts = [q.a, ...q.w]; for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(ctx.svc.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    putSession(ctx, 'trivia', { correct: L[opts.indexOf(q.a)], answer: q.a });
    return H.embed(ctx, { title: `🧠 Trivia — ${q.c}`, description: `**${q.q}**\n\n${opts.map((o, i) => `**${L[i]}.** ${o}`).join('\n')}\n\nAnswer with \`trivia answer <A-D>\`.` });
  });
  T.action('answer', { description: 'Answer the current question', guildOnly: true, options: [{ name: 'choice', type: 'string', description: 'A, B, C or D', required: true, choices: L }] }, (ctx) => {
    const s = needSession(ctx, 'trivia', 'Use `trivia ask`.'); endSession(ctx, 'trivia'); const ok = ctx.args.choice.toUpperCase() === s.correct;
    ctx.db.prepare('INSERT INTO trivia_scores (guild_id, user_id, correct, wrong) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET correct = correct + excluded.correct, wrong = wrong + excluded.wrong').run(ctx.guildId, ctx.user.id, ok ? 1 : 0, ok ? 0 : 1);
    return ok ? '🎉 Correct!' : `❌ Wrong — the answer was **${s.correct}. ${s.answer}**.`;
  });
  T.action('skip', { description: 'Skip the current question' }, (ctx) => { const s = needSession(ctx, 'trivia', 'Use `trivia ask`.'); endSession(ctx, 'trivia'); return `⏭️ Skipped. It was **${s.correct}. ${s.answer}**.`; });
  T.action('score', { description: 'Your trivia score', guildOnly: true, options: [{ name: 'user', type: 'user', description: 'User (default: you)' }] }, (ctx) => { const u = ctx.args.user || ctx.user; const r = ctx.db.prepare('SELECT correct, wrong FROM trivia_scores WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, u.id) || { correct: 0, wrong: 0 }; return `🧠 **${safe(u.username)}**: ${r.correct} correct, ${r.wrong} wrong (${H.percent(r.correct, r.correct + r.wrong)}%).`; });
  T.action('top', { description: 'Trivia leaderboard', guildOnly: true }, async (ctx) => { const rows = ctx.db.prepare('SELECT user_id, correct, wrong FROM trivia_scores WHERE guild_id = ? ORDER BY correct DESC LIMIT 10').all(ctx.guildId); const out = []; let i = 0; for (const r of rows) { const m = await ctx.getMember({ id: r.user_id }); out.push(`**${++i}.** ${safe(m ? m.displayName : r.user_id)} — ${fmtNum(r.correct)} correct`); } return H.embed(ctx, { title: 'Trivia leaderboard', description: out.join('\n') || '_nobody yet_' }); });
  T.action('categories', { description: 'List trivia categories' }, () => `📚 ${CATS.map((c) => `**${c}** (${TRIVIA.filter((q) => q.c === c).length})`).join(' • ')}`);
};
module.exports.TRIVIA = TRIVIA;

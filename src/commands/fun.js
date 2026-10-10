'use strict';
/** Light-hearted commands and random generators. Content lists are intentionally small, original and family-friendly. */
const crypto = require('node:crypto');
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { safe, truncate } = require('../utils/text');

const rest = (name, description, required = true, max = 200) => ({ name, type: 'string', description, required, maxLength: max, rest: true });
const hash = (s) => parseInt(crypto.createHash('sha256').update(String(s).toLowerCase()).digest('hex').slice(0, 8), 16);

const BALL = ['It is certain.', 'Without a doubt.', 'Yes — definitely.', 'You may rely on it.', 'Most likely.', 'Outlook good.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', 'Cannot predict now.', 'Don\'t count on it.', 'My reply is no.', 'My sources say no.', 'Outlook not so good.', 'Very doubtful.'];
const JOKES = ['I told my computer I needed a break, and now it won\'t stop sending me vacation ads.', 'Why do programmers prefer dark mode? Because light attracts bugs.', 'There are 10 kinds of people: those who understand binary and those who don\'t.', 'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"', 'Why did the developer go broke? Because he used up all his cache.', 'I would tell you a UDP joke, but you might not get it.', 'How many programmers does it take to change a light bulb? None — that\'s a hardware problem.', 'Why was the JavaScript developer sad? Because he didn\'t Node how to Express himself.'];
const FACTS = ['Honey never spoils: edible honey has been found in ancient Egyptian tombs.', 'Octopuses have three hearts and blue blood.', 'A day on Venus is longer than its year.', 'Bananas are berries, but strawberries are not.', 'The Eiffel Tower grows about 15 cm taller in summer because metal expands in heat.', 'Sound cannot travel through a vacuum.', 'Sharks are older than trees.', 'There are more possible chess games than atoms in the observable universe.', 'A group of flamingos is called a flamboyance.', 'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.'];
const FORTUNES = ['A pleasant surprise is waiting for you.', 'Your hard work is about to pay off.', 'A small step today avoids a big problem tomorrow.', 'Someone is thinking of you kindly.', 'Adventure awaits where you least expect it.', 'Patience will bring you what force cannot.', 'A new idea will open an old door.', 'Good news arrives by the end of the week.'];
const COMPLIMENTS = ['You make hard things look easy.', 'Your curiosity is contagious.', 'You have a great sense of humour.', 'You bring out the best in people.', 'Your effort really shows.', 'You\'re a great problem-solver.', 'People are lucky to have you around.', 'You light up the chat.'];
const WYR = ['Would you rather always be 10 minutes late or 20 minutes early?', 'Would you rather have the ability to fly or to be invisible?', 'Would you rather never use social media again or never watch another movie?', 'Would you rather explore the deep ocean or outer space?', 'Would you rather speak every language or play every instrument?', 'Would you rather have unlimited time or unlimited money?'];
const TRUTHS = ['What is a small thing that always makes your day better?', 'What is the most useless talent you have?', 'What was your favourite cartoon as a kid?', 'What is a skill you wish you could learn instantly?', 'What is the best meal you have ever had?', 'What is something you changed your mind about recently?'];
const DARES = ['Change your nickname to something silly for an hour.', 'Send a message using only emoji for the next 5 minutes.', 'Talk like a pirate in the chat for 10 minutes.', 'Share the last photo of food you took (if you are comfortable).', 'Write a haiku about this server.', 'Compliment the next three people who speak.'];
const PICKUP = ['Are you a keyboard? Because you\'re just my type.', 'Are you Wi-Fi? Because I\'m feeling a connection.', 'Is your name Google? Because you have everything I\'m searching for.', 'Are you a compiler? Because you make my heart run without errors.'];
const MOTIVATE = ['Progress, not perfection.', 'Small steps still move you forward.', 'You don\'t have to be great to start, but you have to start to be great.', 'Mistakes are proof that you are trying.', 'Today is a good day to learn something new.', 'Consistency beats intensity.'];
const TOPICS = ['What is the best thing you have learned this month?', 'If you could master any skill overnight, what would it be?', 'What is your favourite childhood game?', 'What song has been stuck in your head lately?', 'What would your dream workspace look like?', 'What small thing are you looking forward to?'];
const PUNS = ['I used to be a banker, but I lost interest.', 'I\'m reading a book about anti-gravity. It\'s impossible to put down.', 'Time flies like an arrow; fruit flies like a banana.', 'I would tell a construction joke, but I\'m still working on it.', 'The shovel was a ground-breaking invention.'];
const ANIMALS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐧', '🐦', '🦉', '🦋', '🐢', '🐙', '🐬', '🦈', '🦄'];

module.exports = function register(registry) {
  const pickOne = (ctx, arr) => H.pick(arr, ctx.svc.random);
  const F = registry.group({ name: 'fun', description: 'Fun and games of chance', category: 'Fun' });
  const FA = (sub, spec, run) => F.action(sub, { cooldown: 2, ...spec }, run);
  FA('8ball', { description: 'Ask the magic 8-ball', aliases: ['eightball'], options: [rest('question', 'Your question')] }, (ctx) => `🎱 **${safe(truncate(ctx.args.question, 150))}**\n${pickOne(ctx, BALL)}`);
  FA('joke', { description: 'A programmer joke' }, (ctx) => `😄 ${pickOne(ctx, JOKES)}`);
  FA('fact', { description: 'A random fun fact' }, (ctx) => `💡 ${pickOne(ctx, FACTS)}`);
  FA('fortune', { description: 'Your fortune cookie' }, (ctx) => `🥠 ${pickOne(ctx, FORTUNES)}`);
  FA('compliment', { description: 'Receive a kind word' }, (ctx) => `💐 ${pickOne(ctx, COMPLIMENTS)}`);
  FA('wyr', { description: 'Would you rather…?' }, (ctx) => `🤔 ${pickOne(ctx, WYR)}`);
  FA('truth', { description: 'A truth question' }, (ctx) => `🗣️ ${pickOne(ctx, TRUTHS)}`);
  FA('dare', { description: 'A harmless dare' }, (ctx) => `🎯 ${pickOne(ctx, DARES)}`);
  FA('pickup', { description: 'A nerdy pick-up line' }, (ctx) => `💘 ${pickOne(ctx, PICKUP)}`);
  FA('motivate', { description: 'A motivational line' }, (ctx) => `💪 ${pickOne(ctx, MOTIVATE)}`);
  FA('topic', { description: 'A conversation starter' }, (ctx) => `💬 ${pickOne(ctx, TOPICS)}`);
  FA('pun', { description: 'A groan-worthy pun' }, (ctx) => `🤭 ${pickOne(ctx, PUNS)}`);
  FA('ship', { description: 'Compatibility of two names (just for fun)', options: [{ name: 'first', type: 'string', description: 'First name', required: true, maxLength: 40 }, { name: 'second', type: 'string', description: 'Second name', required: true, maxLength: 40 }] }, (ctx) => { const names = [ctx.args.first, ctx.args.second].map((x) => x.toLowerCase()).sort(); const pct = hash(names.join('+')) % 101; return `💞 **${safe(ctx.args.first)}** + **${safe(ctx.args.second)}** = **${pct}%** ${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}`; });
  FA('rate', { description: 'Rate anything out of 10', options: [rest('thing', 'What to rate')] }, (ctx) => `⭐ I rate **${safe(truncate(ctx.args.thing, 80))}** a **${hash(ctx.args.thing) % 11}/10**.`);
  FA('choose', { description: 'Pick one option (separate with | or commas)', aliases: ['pick'], options: [rest('options', 'a | b | c', true, 500)] }, (ctx) => { const o = ctx.args.options.split(/\s*[|,]\s*/).map((x) => x.trim()).filter(Boolean); if (o.length < 2) throw new UserError('Give at least two options separated by `|` or commas.'); return `🎯 I choose: **${safe(pickOne(ctx, o))}**`; });
  FA('roll', { description: 'Roll dice like 2d6+3', aliases: ['dice'], options: [{ name: 'dice', type: 'string', description: 'NdM[+K], e.g. 2d6+3 (default d20)', default: 'd20', maxLength: 20, pattern: /^\d{0,3}d\d{1,4}([+-]\d{1,5})?$/i, patternHelp: 'use NdM, e.g. 2d6+3' }] }, (ctx) => {
    const m = /^(\d{0,3})d(\d{1,4})(?:([+-]\d{1,5}))?$/i.exec(ctx.args.dice); const n = Number(m[1] || 1); const sides = Number(m[2]); const mod = Number(m[3] || 0);
    if (n < 1 || n > 100 || sides < 2) throw new UserError('Roll between 1 and 100 dice with at least 2 sides.');
    const rolls = Array.from({ length: n }, () => Math.floor(ctx.svc.random() * sides) + 1); const total = rolls.reduce((a, b) => a + b, 0) + mod;
    return `🎲 ${ctx.args.dice.toLowerCase()}: [${rolls.slice(0, 30).join(', ')}${n > 30 ? ', …' : ''}]${mod ? ` ${mod > 0 ? '+' : ''}${mod}` : ''} = **${total}**`;
  });
  FA('coinflip', { description: 'Flip a coin', aliases: ['flip'] }, (ctx) => `🪙 **${ctx.svc.random() < 0.5 ? 'Heads' : 'Tails'}!**`);
  FA('rps', { description: 'Rock paper scissors against the bot', options: [{ name: 'choice', type: 'string', description: 'rock, paper or scissors', required: true, choices: ['rock', 'paper', 'scissors'] }] }, (ctx) => {
    const opts = ['rock', 'paper', 'scissors']; const bot = pickOne(ctx, opts); const me = ctx.args.choice;
    const win = (me === 'rock' && bot === 'scissors') || (me === 'paper' && bot === 'rock') || (me === 'scissors' && bot === 'paper');
    return `You: **${me}** vs Me: **${bot}** — ${me === bot ? "it's a tie!" : win ? 'you win! 🎉' : 'I win! 😎'}`;
  });

  // ------------------------------------------------------------------ random
  const R = registry.group({ name: 'random', description: 'Random generators', category: 'Random' });
  R.action('password', { description: 'Generate a strong random password (shown only to you)', options: [{ name: 'length', type: 'integer', description: '8-64 (default 20)', min: 8, max: 64, default: 20 }, { name: 'symbols', type: 'boolean', description: 'Include symbols', default: true }] }, (ctx) => {
    const pool = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' + (ctx.args.symbols ? '!@#$%^&*-_=+?' : '');
    const pw = Array.from({ length: ctx.args.length }, () => pool[crypto.randomInt(pool.length)]).join('');
    return { content: `🔐 \`${pw}\`\nGenerated locally with a cryptographic RNG; it is never stored or logged.`, ephemeral: true };
  });
  R.action('number', { description: 'Random whole number', options: [{ name: 'min', type: 'integer', description: 'Minimum', required: true, min: -1e9, max: 1e9 }, { name: 'max', type: 'integer', description: 'Maximum', required: true, min: -1e9, max: 1e9 }] }, (ctx) => { const { min, max } = ctx.args; if (min > max) throw new UserError('Minimum must not exceed maximum.'); return `🔢 **${min + Math.floor(ctx.svc.random() * (max - min + 1))}**`; });
  R.action('pick', { description: 'Pick N items from a list', options: [{ name: 'count', type: 'integer', description: 'How many', required: true, min: 1, max: 20 }, rest('items', 'Items separated by | or commas', true, 800)] }, (ctx) => { const items = ctx.args.items.split(/\s*[|,]\s*/).filter(Boolean); if (ctx.args.count > items.length) throw new UserError(`Only ${items.length} item(s) given.`); const pool = [...items]; const out = []; while (out.length < ctx.args.count) out.push(pool.splice(Math.floor(ctx.svc.random() * pool.length), 1)[0]); return `🎯 ${out.map((x) => `**${safe(x)}**`).join(', ')}`; });
  const shuffle = (ctx, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(ctx.svc.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  R.action('order', { description: 'Put names in a random order', options: [rest('names', 'Names separated by | or commas', true, 800)] }, (ctx) => { const n = ctx.args.names.split(/\s*[|,]\s*/).filter(Boolean); if (n.length < 2) throw new UserError('Give at least two names.'); return `📋 ${shuffle(ctx, n).map((x, i) => `${i + 1}. ${safe(x)}`).join('\n')}`; });
  R.action('teams', { description: 'Split names into teams', options: [{ name: 'teams', type: 'integer', description: 'Number of teams', required: true, min: 2, max: 10 }, rest('names', 'Names separated by | or commas', true, 800)] }, (ctx) => { const n = shuffle(ctx, ctx.args.names.split(/\s*[|,]\s*/).filter(Boolean)); if (n.length < ctx.args.teams) throw new UserError('Need at least one name per team.'); const t = Array.from({ length: ctx.args.teams }, () => []); n.forEach((x, i) => t[i % ctx.args.teams].push(safe(x))); return t.map((m, i) => `**Team ${i + 1}:** ${m.join(', ')}`).join('\n'); });
  R.action('lottery', { description: 'Quick-pick lottery numbers (6 of 49)' }, (ctx) => { const pool = Array.from({ length: 49 }, (_, i) => i + 1); const out = []; while (out.length < 6) out.push(pool.splice(Math.floor(ctx.svc.random() * pool.length), 1)[0]); return `🎟️ ${out.sort((a, b) => a - b).join(' • ')} (for fun only)`; });
  R.action('color', { description: 'A random colour' }, (ctx) => { const n = Math.floor(ctx.svc.random() * 0x1000000); const hex = `#${n.toString(16).padStart(6, '0')}`; return H.embed(ctx, { title: hex, description: `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`, color: n }); });
  R.action('hexstring', { description: 'Random hexadecimal token', options: [{ name: 'bytes', type: 'integer', description: '1-64 bytes (default 16)', min: 1, max: 64, default: 16 }] }, (ctx) => ({ content: `\`${crypto.randomBytes(ctx.args.bytes).toString('hex')}\``, ephemeral: true }));
  R.action('date', { description: 'Random date between two years', options: [{ name: 'from', type: 'integer', description: 'From year', required: true, min: 1900, max: 2100 }, { name: 'to', type: 'integer', description: 'To year', required: true, min: 1900, max: 2100 }] }, (ctx) => { if (ctx.args.from > ctx.args.to) throw new UserError('"from" must not be after "to".'); const a = Date.UTC(ctx.args.from, 0, 1); const b = Date.UTC(ctx.args.to, 11, 31); return `📅 ${new Date(a + Math.floor(ctx.svc.random() * (b - a))).toISOString().slice(0, 10)}`; });
  R.action('animal', { description: 'A random animal emoji' }, (ctx) => `${pickOne(ctx, ANIMALS)}`);
  R.action('yesno', { description: 'A yes/no answer' }, (ctx) => (ctx.svc.random() < 0.5 ? '✅ Yes' : '❌ No'));
  R.action('winner', { description: 'Pick a winner from the people in this channel who spoke recently', guildOnly: true }, async (ctx) => {
    const msgs = ctx.channel && ctx.channel.messages && ctx.channel.messages.fetch ? await ctx.channel.messages.fetch({ limit: 50 }) : null;
    const authors = msgs ? [...new Set([...msgs.values()].filter((m) => !m.author.bot).map((m) => m.author.id))] : [];
    if (!authors.length) throw new UserError('No recent human messages to pick from.');
    const id = pickOne(ctx, authors); const m = await ctx.getMember({ id });
    return `🏆 The winner is **${safe(m ? m.displayName : `user ${id}`)}**!`;
  });
};

'use strict';
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { formatDuration, fmtNum, truncate, safe, ts } = require('../utils/text');

const amountOpt = (description = 'Amount (number, all, half, 25%)') => ({ name: 'amount', type: 'string', description, required: true, maxLength: 20 });
const betOpt = { name: 'bet', type: 'string', description: 'Bet (number, all, half, 25%)', required: true, maxLength: 20 };
const targetOpt = { name: 'user', type: 'user', description: 'The user', required: true };

function notBot(user) { if (user.bot) throw new UserError('Bots do not have wallets.'); }
const eco = (ctx) => ctx.svc.economy;
const cost = (ctx, n) => eco(ctx).fmt(ctx.guildId, n);

/** Weighted loot table → { name, value } */
function rollLoot(ctx, table) {
  const total = table.reduce((a, b) => a + b.w, 0); let r = ctx.svc.random() * total;
  for (const e of table) { r -= e.w; if (r < 0) return e; }
  return table[table.length - 1];
}

async function gamble(ctx, bet, play) {
  const e = eco(ctx); const g = ctx.guildId;
  const w = e.wallet(g, ctx.user.id);
  const amount = e.parseAmount(bet, w.wallet);
  const max = ctx.cfg('eco_gamble_max');
  if (amount > max) throw new UserError(`The maximum bet is ${cost(ctx, max)}.`);
  if (amount > w.wallet) throw new UserError(`You only have ${cost(ctx, w.wallet)} in your wallet.`);
  const { net, text } = play(amount);
  e.adjust(g, ctx.user.id, net, 'gamble', null);
  if (net > 0) ctx.svc.levels.unlock(g, ctx.user.id, 'gambler');
  const after = e.wallet(g, ctx.user.id).wallet;
  return `${text}\n${net >= 0 ? (net === 0 ? '🤝 Bet returned.' : `🎉 You won **${cost(ctx, net)}**!`) : `💸 You lost **${cost(ctx, -net)}**.`} Balance: ${cost(ctx, after)}`;
}

module.exports = function register(registry) {
  const g = registry.group({ name: 'economy', description: 'Virtual coins: earn, save, play', category: 'Economy', aliases: ['eco', 'money'] });
  g.subgroup('earn', 'Ways to earn virtual coins').subgroup('gamble', 'Games of chance with virtual coins');
  const U = (sub, spec, run) => g.action(sub, { guildOnly: true, ...spec }, run);

  U('balance', { description: 'Show a wallet balance', aliases: ['bal', 'wallet'], options: [{ name: 'user', type: 'user', description: 'User (default: you)' }] }, (ctx) => {
    const u = ctx.args.user || ctx.user; notBot(u);
    const w = eco(ctx).wallet(ctx.guildId, u.id);
    return H.embed(ctx, { title: `${u.username}'s balance`, fields: [{ name: 'Wallet', value: cost(ctx, w.wallet), inline: true }, { name: 'Bank', value: cost(ctx, w.bank), inline: true }, { name: 'Total', value: cost(ctx, w.wallet + w.bank), inline: true }], footer: { text: 'Virtual currency with no real-world value' } });
  });

  const periodic = (sub, desc, key, secs, label, aliases) => U(sub, { description: desc, cooldown: 3, aliases }, (ctx) => {
    const e = eco(ctx); const gid = ctx.guildId; const uid = ctx.user.id;
    const r = e.claim(gid, uid, key, secs, () => {
      let amount = ctx.cfg(`eco_${key}`); let streakText = '';
      if (key === 'daily') {
        const cd = e.q.cdGet.get(gid, uid, 'daily');
        const w = e.wallet(gid, uid);
        const cont = cd && ctx.svc.now() - (cd.until - Math.round(86400 * ctx.cfg('eco_cooldown_pct') / 100)) <= 2 * 86400;
        const streak = cont ? w.streak + 1 : 1;
        e.db.prepare('UPDATE wallets SET streak = ? WHERE guild_id = ? AND user_id = ?').run(streak, gid, uid);
        const bonus = Math.min(streak - 1, 10) * Math.floor(amount * 0.05);
        amount += bonus; streakText = ` (streak: **${streak}** day${streak === 1 ? '' : 's'}${bonus ? `, +${fmtNum(bonus)} bonus` : ''})`;
      }
      return { amount, streakText };
    }, key);
    ctx.svc.levels.evaluate(gid, uid);
    return `${label} You received **${cost(ctx, r.amount)}**${r.streakText}. Balance: ${cost(ctx, r.wallet)}`;
  });
  periodic('daily', 'Claim your daily reward', 'daily', 86400, '📅', ['dailyreward']);
  periodic('weekly', 'Claim your weekly reward', 'weekly', 7 * 86400, '🗓️');
  periodic('monthly', 'Claim your monthly reward', 'monthly', 30 * 86400, '📆');
  U('hourly', { description: 'Claim a small hourly reward' }, (ctx) => {
    const amount = Math.max(10, Math.floor(ctx.cfg('eco_daily') / 10));
    const r = eco(ctx).claim(ctx.guildId, ctx.user.id, 'hourly', 3600, () => ({ amount }), 'hourly');
    return `⏰ You received **${cost(ctx, r.amount)}**. Balance: ${cost(ctx, r.wallet)}`;
  });

  const earn = (sub, desc, key, secs, run) => g.action(sub, { description: desc, guildOnly: true, subgroup: 'earn' }, (ctx) => {
    const e = eco(ctx);
    const r = e.claim(ctx.guildId, ctx.user.id, key, secs, () => run(ctx), key);
    return `${r.text}\nBalance: ${cost(ctx, r.wallet)}`;
  });
  earn('work', 'Work a shift for coins', 'work', 3600, (ctx) => {
    const jobs = ['delivered parcels', 'fixed a bug', 'walked dogs', 'baked bread', 'tutored a student', 'painted a fence'];
    const amount = eco(ctx).randInt(ctx.cfg('eco_work_min'), Math.max(ctx.cfg('eco_work_min'), ctx.cfg('eco_work_max')));
    return { amount, text: `💼 You ${jobs[Math.floor(ctx.svc.random() * jobs.length)]} and earned **${cost(ctx, amount)}**.` };
  });
  earn('crime', 'Risk it for a bigger payout (or a fine)', 'crime', 7200, (ctx) => {
    const e = eco(ctx); const w = e.wallet(ctx.guildId, ctx.user.id);
    if (ctx.svc.random() < 0.55) { const a = e.randInt(100, 400); return { amount: a, text: `🕵️ The heist worked! You got **${cost(ctx, a)}**.` }; }
    const fine = Math.min(w.wallet, e.randInt(50, 200)); return { amount: -fine, text: `🚔 Caught! You were fined **${cost(ctx, fine)}**.` };
  });
  earn('beg', 'Beg for spare change', 'beg', 300, (ctx) => {
    if (ctx.svc.random() < 0.7) { const a = eco(ctx).randInt(5, 50); return { amount: a, text: `🙏 A kind stranger gave you **${cost(ctx, a)}**.` }; }
    return { amount: 0, text: '😔 Nobody gave you anything this time.' };
  });
  const lootCmd = (sub, desc, key, secs, emoji, table) => earn(sub, desc, key, secs, (ctx) => { const l = rollLoot(ctx, table); return { amount: l.value, text: `${emoji} You found **${l.name}** worth **${cost(ctx, l.value)}**.` }; });
  lootCmd('fish', 'Go fishing', 'fish', 1800, '🎣', [{ name: 'an old boot', value: 5, w: 15 }, { name: 'a sardine', value: 40, w: 40 }, { name: 'a trout', value: 90, w: 30 }, { name: 'a golden carp', value: 300, w: 10 }, { name: 'a treasure chest', value: 800, w: 2 }]);
  lootCmd('hunt', 'Go hunting', 'hunt', 1800, '🏹', [{ name: 'a rabbit', value: 45, w: 40 }, { name: 'a deer', value: 140, w: 30 }, { name: 'a boar', value: 220, w: 15 }, { name: 'a rare stag', value: 520, w: 3 }, { name: 'nothing but mud', value: 0, w: 12 }]);
  lootCmd('mine', 'Go mining', 'mine', 2400, '⛏️', [{ name: 'coal', value: 30, w: 40 }, { name: 'iron ore', value: 80, w: 30 }, { name: 'gold ore', value: 210, w: 15 }, { name: 'a diamond', value: 600, w: 4 }, { name: 'worthless rock', value: 0, w: 11 }]);

  U('deposit', { description: 'Move coins from wallet to bank', aliases: ['dep'], options: [amountOpt()] }, (ctx) => {
    const e = eco(ctx); const w = e.wallet(ctx.guildId, ctx.user.id); const n = e.parseAmount(ctx.args.amount, w.wallet);
    const r = e.deposit(ctx.guildId, ctx.user.id, n); return `🏦 Deposited **${cost(ctx, n)}**. Wallet ${cost(ctx, r.wallet)} • Bank ${cost(ctx, r.bank)}`;
  });
  U('withdraw', { description: 'Move coins from bank to wallet', aliases: ['with'], options: [amountOpt()] }, (ctx) => {
    const e = eco(ctx); const w = e.wallet(ctx.guildId, ctx.user.id); const n = e.parseAmount(ctx.args.amount, w.bank);
    const r = e.withdraw(ctx.guildId, ctx.user.id, n); return `🏧 Withdrew **${cost(ctx, n)}**. Wallet ${cost(ctx, r.wallet)} • Bank ${cost(ctx, r.bank)}`;
  });
  U('transfer', { description: 'Send coins to another member', aliases: ['pay', 'give'], options: [targetOpt, amountOpt()] }, (ctx) => {
    notBot(ctx.args.user); const e = eco(ctx); const w = e.wallet(ctx.guildId, ctx.user.id);
    const n = e.parseAmount(ctx.args.amount, w.wallet); const r = e.transfer(ctx.guildId, ctx.user.id, ctx.args.user.id, n);
    return `💸 Sent **${cost(ctx, r.sent)}** to **${safe(ctx.args.user.username)}**${r.tax ? ` (tax ${cost(ctx, r.tax)})` : ''}.`;
  });
  U('rob', { description: 'Try to steal coins from a member (risky)', cooldown: 5, options: [targetOpt] }, (ctx) => {
    const e = eco(ctx); const gid = ctx.guildId; const v = ctx.args.user; notBot(v);
    if (!ctx.cfg('eco_rob_enabled')) throw new UserError('Robbing is disabled in this server.');
    if (v.id === ctx.user.id) throw new UserError('You cannot rob yourself.');
    const r = e.claim(gid, ctx.user.id, 'rob', 10800, () => {
      const me = e.wallet(gid, ctx.user.id); const them = e.wallet(gid, v.id);
      if (me.wallet < 100) throw new UserError('You need at least 100 coins in your wallet to attempt a robbery.');
      if (them.wallet < 100) throw new UserError('That member does not have enough coins in their wallet to be worth robbing.');
      if (ctx.svc.random() < 0.4) {
        const steal = Math.max(1, Math.floor(them.wallet * (0.1 + ctx.svc.random() * 0.2)));
        e.adjust(gid, v.id, -steal, 'rob:victim', ctx.user.id);
        return { amount: steal, text: `🦹 You stole **${cost(ctx, steal)}** from ${safe(v.username)}!` };
      }
      const fine = Math.min(me.wallet, 100); e.adjust(gid, v.id, fine, 'rob:fine', ctx.user.id);
      return { amount: -fine, text: `🚨 You were caught and paid **${cost(ctx, fine)}** to ${safe(v.username)}.` };
    }, 'rob');
    return r.text;
  });
  U('history', { description: 'Show your recent transactions', options: [{ name: 'limit', type: 'integer', description: '1-20', min: 1, max: 20, default: 10 }] }, (ctx) => H.embed(ctx, { title: 'Transaction history', description: H.listLines(eco(ctx).history(ctx.guildId, ctx.user.id, ctx.args.limit), (t) => `• ${ts(t.ts)} \`${t.kind}\` **${t.delta >= 0 ? '+' : ''}${fmtNum(t.delta)}** → ${fmtNum(t.balance_after)}`, 20) }));
  U('leaderboard', { description: 'Richest members', aliases: ['rich', 'baltop'], options: [{ name: 'page', type: 'integer', description: 'Page', min: 1, max: 100, default: 1 }] }, async (ctx) => {
    const rows = eco(ctx).leaderboard(ctx.guildId, 10, (ctx.args.page - 1) * 10);
    const lines = []; let i = (ctx.args.page - 1) * 10;
    for (const r of rows) { const m = await ctx.getMember({ id: r.user_id }); lines.push(`**${++i}.** ${safe(m ? m.displayName : r.user_id)} — ${cost(ctx, r.total)}`); }
    return H.embed(ctx, { title: `Richest members — page ${ctx.args.page}`, description: lines.join('\n') || '_nobody yet_' });
  });
  U('networth', { description: 'Wallet + bank + item value', options: [{ name: 'user', type: 'user', description: 'User (default: you)' }] }, (ctx) => { const u = ctx.args.user || ctx.user; const n = eco(ctx).netWorth(ctx.guildId, u.id); return `💎 **${safe(u.username)}** net worth: ${cost(ctx, n.total)} (wallet ${fmtNum(n.wallet)} • bank ${fmtNum(n.bank)} • items ${fmtNum(n.items)})`; });
  U('rank', { description: 'Your wealth ranking', aliases: ['wealthrank'] }, (ctx) => `🏅 You are #${eco(ctx).rank(ctx.guildId, ctx.user.id)} by total wealth.`);
  U('streak', { description: 'Your daily-reward streak' }, (ctx) => `🔥 Daily streak: **${eco(ctx).wallet(ctx.guildId, ctx.user.id).streak}** day(s).`);
  U('cooldowns', { description: 'See which rewards are ready', aliases: ['cds'] }, (ctx) => {
    const keys = ['daily', 'weekly', 'monthly', 'hourly', 'work', 'crime', 'beg', 'fish', 'hunt', 'mine', 'rob'];
    return H.embed(ctx, { title: 'Reward cooldowns', description: keys.map((k) => { const l = eco(ctx).cooldownLeft(ctx.guildId, ctx.user.id, k); return `${l ? '⏳' : '✅'} **${k}** ${l ? formatDuration(l) : 'ready'}`; }).join('\n') });
  });

  // ------------------------------------------------------------------ gambling
  const G = (sub, spec, run) => g.action(sub, { guildOnly: true, subgroup: 'gamble', cooldown: 4, ...spec }, run);
  const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎'];
  G('slots', { description: 'Spin the slot machine', options: [betOpt] }, (ctx) => gamble(ctx, ctx.args.bet, (bet) => {
    const reels = [0, 1, 2].map(() => SYMBOLS[Math.floor(ctx.svc.random() * SYMBOLS.length)]);
    const uniq = new Set(reels).size; const mult = uniq === 1 ? (reels[0] === '💎' ? 10 : 5) : uniq === 2 ? 1.5 : 0;
    const net = mult === 0 ? -bet : Math.floor(bet * mult) - bet;
    return { net, text: `🎰 | ${reels.join(' | ')} |` };
  }));
  G('coinflip', { description: 'Bet on heads or tails', aliases: ['cf', 'flipbet'], options: [betOpt, { name: 'side', type: 'string', description: 'heads or tails', required: true, choices: ['heads', 'tails'] }] }, (ctx) => gamble(ctx, ctx.args.bet, (bet) => {
    const res = ctx.svc.random() < 0.5 ? 'heads' : 'tails';
    return { net: res === ctx.args.side ? bet : -bet, text: `🪙 The coin landed on **${res}**.` };
  }));
  G('dice', { description: 'Guess a die roll (pays 5x)', options: [betOpt, { name: 'guess', type: 'integer', description: '1-6', required: true, min: 1, max: 6 }] }, (ctx) => gamble(ctx, ctx.args.bet, (bet) => {
    const roll = Math.floor(ctx.svc.random() * 6) + 1; return { net: roll === ctx.args.guess ? bet * 4 : -bet, text: `🎲 You rolled a **${roll}**.` };
  }));
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  G('roulette', { description: 'Bet on red, black or green', options: [betOpt, { name: 'color', type: 'string', description: 'red, black or green', required: true, choices: ['red', 'black', 'green'] }] }, (ctx) => gamble(ctx, ctx.args.bet, (bet) => {
    const n = Math.floor(ctx.svc.random() * 37); const color = n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black';
    const mult = color === 'green' ? 14 : 1; return { net: color === ctx.args.color ? bet * mult : -bet, text: `🎡 The ball landed on **${n} ${color}**.` };
  }));

  // ------------------------------------------------------------------- shop
  const sh = registry.group({ name: 'shop', description: 'Server shop and inventory', category: 'Economy', aliases: ['store'] });
  const itemOpt = { name: 'item', type: 'string', description: 'Item name or ID', required: true, maxLength: 60 };
  const qtyOpt = { name: 'quantity', type: 'integer', description: 'How many (default 1)', min: 1, max: 1000, default: 1 };
  const S = (sub, spec, run) => sh.action(sub, { guildOnly: true, ...spec }, run);
  S('list', { description: 'Browse the shop' }, (ctx) => H.embed(ctx, { title: '🛒 Shop', description: H.listLines(eco(ctx).items(ctx.guildId), (i) => `**${safe(i.name)}** (#${i.id}) — ${cost(ctx, i.price)}${i.stock === -1 ? '' : ` • ${i.stock} left`}${i.description ? `\n_${safe(truncate(i.description, 80))}_` : ''}`, 15) }));
  S('info', { description: 'Details about an item', options: [itemOpt] }, (ctx) => { const i = eco(ctx).item(ctx.guildId, ctx.args.item); return H.embed(ctx, { title: safe(i.name), description: safe(i.description) || '_no description_', fields: [{ name: 'Price', value: cost(ctx, i.price), inline: true }, { name: 'Stock', value: i.stock === -1 ? '∞' : String(i.stock), inline: true }, { name: 'Sellable', value: i.sellable ? 'yes' : 'no', inline: true }, ...(i.role_id ? [{ name: 'Grants role', value: `<@&${i.role_id}>`, inline: true }] : [])] }); });
  S('buy', { description: 'Buy an item', options: [itemOpt, qtyOpt] }, (ctx) => { const r = eco(ctx).buy(ctx.guildId, ctx.user.id, ctx.args.item, ctx.args.quantity); ctx.svc.levels.unlock(ctx.guildId, ctx.user.id, 'shopper'); return `🛍️ Bought **${r.qty}× ${safe(r.item.name)}** for ${cost(ctx, r.cost)}.`; });
  S('sell', { description: 'Sell an item back for 50% of its price', options: [itemOpt, qtyOpt] }, (ctx) => { const r = eco(ctx).sell(ctx.guildId, ctx.user.id, ctx.args.item, ctx.args.quantity); return `💰 Sold **${r.qty}× ${safe(r.item.name)}** for ${cost(ctx, r.refund)}.`; });
  S('inventory', { description: 'Show your items', aliases: ['inv', 'bag'], options: [{ name: 'user', type: 'user', description: 'User (default: you)' }] }, (ctx) => { const u = ctx.args.user || ctx.user; return H.embed(ctx, { title: `${u.username}'s inventory`, description: H.listLines(eco(ctx).inventory(ctx.guildId, u.id), (i) => `• **${i.qty}× ${safe(i.name)}** (#${i.id})`, 25) }); });
  S('use', { description: 'Use an item from your inventory', options: [itemOpt] }, async (ctx) => {
    const e = eco(ctx); const it = e.item(ctx.guildId, ctx.args.item);
    if (e.qty(ctx.guildId, ctx.user.id, it.id) < 1) throw new UserError('You do not own that item.');
    if (it.role_id) {
      const role = ctx.guild.roles.cache.get(it.role_id); if (!role) throw new UserError('The role for this item no longer exists.');
      H.assertRoleManageable({ ...ctx, member: null }, role);
      await ctx.member.roles.add(role, `Used shop item ${it.name}`);
    }
    e.takeItem(ctx.guildId, ctx.user.id, it.id, 1);
    return `✨ You used **${safe(it.name)}**${it.role_id ? ' and received a role' : ''}.`;
  });
  S('gift', { description: 'Gift an item to another member', options: [targetOpt, itemOpt, qtyOpt] }, (ctx) => {
    notBot(ctx.args.user); if (ctx.args.user.id === ctx.user.id) throw new UserError('You cannot gift to yourself.');
    const e = eco(ctx); const it = e.item(ctx.guildId, ctx.args.item);
    e.db.transaction(() => { e.takeItem(ctx.guildId, ctx.user.id, it.id, ctx.args.quantity); e.giveItem(ctx.guildId, ctx.args.user.id, it.id, ctx.args.quantity); })();
    return `🎁 Gifted **${ctx.args.quantity}× ${safe(it.name)}** to **${safe(ctx.args.user.username)}**.`;
  });
  S('search', { description: 'Search shop items by name', options: [{ name: 'query', type: 'string', description: 'Search text', required: true, maxLength: 40 }] }, (ctx) => H.embed(ctx, { title: `Shop search: ${safe(ctx.args.query)}`, description: H.listLines(eco(ctx).items(ctx.guildId).filter((i) => i.name.toLowerCase().includes(ctx.args.query.toLowerCase())), (i) => `• **${safe(i.name)}** — ${cost(ctx, i.price)}`, 15) }));
  S('value', { description: 'Total shop value of your inventory' }, (ctx) => `📦 Your items are worth ${cost(ctx, eco(ctx).netWorth(ctx.guildId, ctx.user.id).items)}.`);

  // ------------------------------------------------------- economy administration
  const ea = registry.group({ name: 'ecoadmin', description: 'Economy administration', category: 'Economy Admin', aliases: ['economyadmin'] });
  ea.subgroup('shop', 'Manage shop items').subgroup('config', 'Economy settings');
  const EA = (sub, spec, run) => ea.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...(sub.startsWith('shop') || sub.endsWith('item') ? { subgroup: 'shop' } : ['symbol', 'robtoggle'].includes(sub) ? { subgroup: 'config' } : {}), ...spec }, run);
  const bigAmount = (d) => ({ name: 'amount', type: 'integer', description: d, required: true, min: 1, max: 1_000_000_000 });
  EA('give', { description: 'Add coins to a member', options: [targetOpt, bigAmount('Amount to add')] }, (ctx) => { notBot(ctx.args.user); const r = eco(ctx).adjust(ctx.guildId, ctx.args.user.id, ctx.args.amount, 'admin:give', ctx.user.id); return H.ok(`Gave ${cost(ctx, ctx.args.amount)} to **${safe(ctx.args.user.username)}** (now ${cost(ctx, r.wallet)}).`); });
  EA('take', { description: 'Remove coins from a member wallet', options: [targetOpt, bigAmount('Amount to remove')] }, (ctx) => { notBot(ctx.args.user); const r = eco(ctx).adjust(ctx.guildId, ctx.args.user.id, -ctx.args.amount, 'admin:take', ctx.user.id); return H.ok(`Took ${cost(ctx, ctx.args.amount)} from **${safe(ctx.args.user.username)}** (now ${cost(ctx, r.wallet)}).`); });
  EA('set', { description: 'Set a member wallet to an exact amount', options: [targetOpt, { name: 'amount', type: 'integer', description: 'New wallet balance', required: true, min: 0, max: 1_000_000_000 }] }, (ctx) => { notBot(ctx.args.user); eco(ctx).setBalance(ctx.guildId, ctx.args.user.id, ctx.args.amount); return H.ok(`Wallet of **${safe(ctx.args.user.username)}** set to ${cost(ctx, ctx.args.amount)}.`); });
  EA('reset', { description: "Reset one member's economy data", options: [targetOpt] }, (ctx) => {
    const db = ctx.db; const g2 = ctx.guildId; const u = ctx.args.user.id;
    db.transaction(() => { db.prepare('DELETE FROM wallets WHERE guild_id = ? AND user_id = ?').run(g2, u); db.prepare('DELETE FROM inventory WHERE guild_id = ? AND user_id = ?').run(g2, u); db.prepare("DELETE FROM cooldowns WHERE guild_id = ? AND user_id = ? AND key IN ('daily','weekly','monthly','hourly','work','crime','beg','fish','hunt','mine','rob')").run(g2, u); })();
    return H.ok(`Economy data of **${safe(ctx.args.user.username)}** reset.`);
  });
  EA('resetall', { description: 'Delete ALL economy data of this server', perms: ['Administrator'], options: [{ name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] }] }, (ctx) => {
    ctx.db.transaction(() => { for (const t of ['wallets', 'transactions', 'inventory']) ctx.db.prepare(`DELETE FROM ${t} WHERE guild_id = ?`).run(ctx.guildId); ctx.db.prepare("DELETE FROM cooldowns WHERE guild_id = ? AND key IN ('daily','weekly','monthly','hourly','work','crime','beg','fish','hunt','mine','rob')").run(ctx.guildId); })();
    return H.ok('All economy data reset.');
  });
  EA('view', { description: 'Show economy configuration' }, (ctx) => H.embed(ctx, { title: 'Economy configuration', description: ['eco_enabled', 'eco_symbol', 'eco_daily', 'eco_weekly', 'eco_monthly', 'eco_work_min', 'eco_work_max', 'eco_tax_pct', 'eco_bank_limit', 'eco_start_balance', 'eco_cooldown_pct', 'eco_gamble_max', 'eco_rob_enabled'].map((k) => `\`${k}\` = ${H.show(ctx.cfg(k))}`).join('\n') }));
  const CF = (sub, spec) => H.configAction(ea, sub, { subgroup: 'config', ...spec });
  CF('toggle', { description: 'Enable or disable the economy', key: 'eco_enabled', kind: 'bool', label: 'Economy' });
  EA('symbol', { description: 'Set the currency symbol (text/emoji)', options: [{ name: 'symbol', type: 'string', description: 'Up to 16 characters', required: true, maxLength: 16 }] }, (ctx) => { ctx.svc.settings.set(ctx.guildId, 'eco_symbol', ctx.args.symbol); return H.ok(`Currency symbol is now ${ctx.args.symbol}`); });
  CF('daily', { description: 'Daily reward amount', key: 'eco_daily', kind: 'int', label: 'Daily reward' });
  CF('weekly', { description: 'Weekly reward amount', key: 'eco_weekly', kind: 'int', label: 'Weekly reward' });
  CF('monthly', { description: 'Monthly reward amount', key: 'eco_monthly', kind: 'int', label: 'Monthly reward' });
  CF('workmin', { description: 'Minimum work payout', key: 'eco_work_min', kind: 'int', label: 'Work minimum' });
  CF('workmax', { description: 'Maximum work payout', key: 'eco_work_max', kind: 'int', label: 'Work maximum' });
  CF('tax', { description: 'Transfer tax percentage (0-50)', key: 'eco_tax_pct', kind: 'int', label: 'Transfer tax %' });
  CF('banklimit', { description: 'Bank capacity per member (0 = unlimited)', key: 'eco_bank_limit', kind: 'int', label: 'Bank limit' });
  CF('startbalance', { description: 'Starting wallet for new members', key: 'eco_start_balance', kind: 'int', label: 'Starting balance' });
  CF('cooldownpct', { description: 'Scale reward cooldowns (100 = normal)', key: 'eco_cooldown_pct', kind: 'int', label: 'Cooldown scale %' });
  CF('gamblemax', { description: 'Maximum gambling bet', key: 'eco_gamble_max', kind: 'int', label: 'Maximum bet' });
  CF('robtoggle', { description: 'Allow or forbid robbing', key: 'eco_rob_enabled', kind: 'bool', label: 'Robbing' });
  EA('shopadd', { description: 'Add a shop item', options: [{ name: 'name', type: 'string', description: 'Item name', required: true, minLength: 1, maxLength: 40 }, { name: 'price', type: 'integer', description: 'Price', required: true, min: 1, max: 1_000_000_000 }, { name: 'stock', type: 'integer', description: 'Stock (-1 = unlimited)', min: -1, max: 1_000_000, default: -1 }, { name: 'description', type: 'string', description: 'Description', maxLength: 200, rest: true }] }, (ctx) => { const id = eco(ctx).addItem(ctx.guildId, { name: ctx.args.name, price: ctx.args.price, stock: ctx.args.stock, description: ctx.args.description || '' }); return H.ok(`Added **${safe(ctx.args.name)}** (#${id}) for ${cost(ctx, ctx.args.price)}.`); });
  EA('shopremove', { description: 'Remove a shop item', options: [itemOpt] }, (ctx) => { const it = eco(ctx).removeItem(ctx.guildId, ctx.args.item); return H.ok(`Removed **${safe(it.name)}**.`); });
  EA('shopprice', { description: 'Change an item price', options: [itemOpt, { name: 'price', type: 'integer', description: 'New price', required: true, min: 1, max: 1_000_000_000 }] }, (ctx) => { const it = eco(ctx).updateItem(ctx.guildId, ctx.args.item, { price: ctx.args.price }); return H.ok(`**${safe(it.name)}** now costs ${cost(ctx, it.price)}.`); });
  EA('shopstock', { description: 'Change an item stock (-1 = unlimited)', options: [itemOpt, { name: 'stock', type: 'integer', description: 'New stock', required: true, min: -1, max: 1_000_000 }] }, (ctx) => { const it = eco(ctx).updateItem(ctx.guildId, ctx.args.item, { stock: ctx.args.stock }); return H.ok(`**${safe(it.name)}** stock: ${it.stock === -1 ? 'unlimited' : it.stock}.`); });
  EA('shoprole', { description: 'Make an item grant a role when used', perms: ['ManageGuild', 'ManageRoles'], options: [itemOpt, { name: 'role', type: 'role', description: 'Role (omit to clear)' }] }, (ctx) => {
    if (ctx.args.role) H.assertRoleManageable(ctx, ctx.args.role);
    const it = eco(ctx).updateItem(ctx.guildId, ctx.args.item, { role_id: ctx.args.role ? ctx.args.role.id : null }); return H.ok(`**${safe(it.name)}** ${it.role_id ? `grants <@&${it.role_id}>` : 'grants no role'}.`);
  });
  EA('shopdesc', { description: 'Change an item description', options: [itemOpt, { name: 'description', type: 'string', description: 'New description', required: true, maxLength: 200, rest: true }] }, (ctx) => { const it = eco(ctx).updateItem(ctx.guildId, ctx.args.item, { description: ctx.args.description }); return H.ok(`Description of **${safe(it.name)}** updated.`); });
  EA('giveitem', { description: 'Give an item to a member', options: [targetOpt, itemOpt, qtyOpt] }, (ctx) => { notBot(ctx.args.user); const it = eco(ctx).item(ctx.guildId, ctx.args.item); eco(ctx).giveItem(ctx.guildId, ctx.args.user.id, it.id, ctx.args.quantity); return H.ok(`Gave ${ctx.args.quantity}× **${safe(it.name)}** to **${safe(ctx.args.user.username)}**.`); });
  EA('takeitem', { description: 'Remove an item from a member', options: [targetOpt, itemOpt, qtyOpt] }, (ctx) => { const it = eco(ctx).item(ctx.guildId, ctx.args.item); eco(ctx).takeItem(ctx.guildId, ctx.args.user.id, it.id, ctx.args.quantity); return H.ok(`Removed ${ctx.args.quantity}× **${safe(it.name)}** from **${safe(ctx.args.user.username)}**.`); });
  EA('transactions', { description: "Show a member's recent transactions", options: [targetOpt, { name: 'limit', type: 'integer', description: '1-25', min: 1, max: 25, default: 15 }] }, (ctx) => H.embed(ctx, { title: `Transactions of ${safe(ctx.args.user.username)}`, description: H.listLines(eco(ctx).history(ctx.guildId, ctx.args.user.id, ctx.args.limit), (t) => `• ${ts(t.ts)} \`${t.kind}\` ${t.delta >= 0 ? '+' : ''}${fmtNum(t.delta)}`, 25) }));
  EA('supply', { description: 'Total coins in circulation' }, (ctx) => { const r = ctx.db.prepare('SELECT COALESCE(SUM(wallet),0) w, COALESCE(SUM(bank),0) b, COUNT(*) n FROM wallets WHERE guild_id = ?').get(ctx.guildId); return `🏦 ${r.n} wallet(s) • ${cost(ctx, r.w + r.b)} in circulation (wallets ${fmtNum(r.w)} • banks ${fmtNum(r.b)}).`; });
  EA('clearcooldown', { description: "Clear a member's reward cooldown", options: [targetOpt, { name: 'reward', type: 'string', description: 'Reward name', required: true, choices: ['daily', 'weekly', 'monthly', 'hourly', 'work', 'crime', 'beg', 'fish', 'hunt', 'mine', 'rob'] }] }, (ctx) => { ctx.db.prepare('DELETE FROM cooldowns WHERE guild_id = ? AND user_id = ? AND key = ?').run(ctx.guildId, ctx.args.user.id, ctx.args.reward); return H.ok(`Cleared **${ctx.args.reward}** cooldown.`); });

  registry.standalone('balance', 'economy.balance');
  registry.standalone('daily', 'economy.daily');
};

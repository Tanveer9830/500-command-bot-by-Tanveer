'use strict';
/**
 * Virtual economy. All balance changes happen inside SQLite transactions
 * (better-sqlite3 is synchronous, so a transaction can never interleave with
 * another one in this process) and the schema enforces wallet/bank >= 0.
 * Virtual coins have no real-world monetary value.
 */
const { UserError } = require('../core/errors');
const { fmtNum, formatDuration } = require('../utils/text');

class Economy {
  constructor({ db, settings, now = () => Math.floor(Date.now() / 1000), random = Math.random }) {
    this.db = db; this.settings = settings; this.now = now; this.random = random;
    this.q = {
      ensure: db.prepare('INSERT OR IGNORE INTO wallets (guild_id, user_id, wallet) VALUES (?, ?, ?)'),
      get: db.prepare('SELECT * FROM wallets WHERE guild_id = ? AND user_id = ?'),
      setWallet: db.prepare('UPDATE wallets SET wallet = ?, earned = earned + ? WHERE guild_id = ? AND user_id = ?'),
      setBank: db.prepare('UPDATE wallets SET wallet = ?, bank = ? WHERE guild_id = ? AND user_id = ?'),
      tx: db.prepare('INSERT INTO transactions (guild_id, user_id, delta, balance_after, kind, ref, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      cdGet: db.prepare('SELECT until FROM cooldowns WHERE guild_id = ? AND user_id = ? AND key = ?'),
      cdSet: db.prepare('INSERT INTO cooldowns (guild_id, user_id, key, until) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id, key) DO UPDATE SET until = excluded.until'),
    };
  }

  symbol(g) { return this.settings.get(g, 'eco_symbol'); }
  fmt(g, n) { return `${this.symbol(g)} ${fmtNum(n)}`; }

  wallet(g, u) {
    this.q.ensure.run(g, u, this.settings.get(g, 'eco_start_balance'));
    return this.q.get.get(g, u);
  }

  _assertEnabled(g) {
    if (!this.settings.get(g, 'eco_enabled')) throw new UserError('The economy is disabled in this server.');
  }

  /** Atomically add (or subtract) coins from the wallet. Never allows a negative balance. */
  adjust(g, u, delta, kind, ref = null) {
    if (!Number.isSafeInteger(delta)) throw new UserError('Amount must be a whole number.');
    return this.db.transaction(() => {
      const w = this.wallet(g, u);
      const next = w.wallet + delta;
      if (next < 0) throw new UserError(`Insufficient funds: you have ${this.fmt(g, w.wallet)}.`);
      this.q.setWallet.run(next, delta > 0 ? delta : 0, g, u);
      this.q.tx.run(g, u, delta, next, kind, ref, this.now());
      return { ...w, wallet: next };
    })();
  }

  /** Set an exact wallet balance (admin). */
  setBalance(g, u, amount, kind = 'admin:set') {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new UserError('Balance must be a non-negative whole number.');
    return this.db.transaction(() => {
      const w = this.wallet(g, u);
      this.q.setWallet.run(amount, Math.max(0, amount - w.wallet), g, u);
      this.q.tx.run(g, u, amount - w.wallet, amount, kind, null, this.now());
      return { ...w, wallet: amount };
    })();
  }

  transfer(g, from, to, amount) {
    this._assertEnabled(g);
    if (from === to) throw new UserError('You cannot pay yourself.');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError('Amount must be positive.');
    const tax = Math.floor((amount * this.settings.get(g, 'eco_tax_pct')) / 100);
    return this.db.transaction(() => {
      this.adjust(g, from, -amount, 'transfer:out', to);
      this.adjust(g, to, amount - tax, 'transfer:in', from);
      return { sent: amount, received: amount - tax, tax };
    })();
  }

  deposit(g, u, amount) {
    this._assertEnabled(g);
    return this.db.transaction(() => {
      const w = this.wallet(g, u);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError('Amount must be positive.');
      if (amount > w.wallet) throw new UserError(`You only have ${this.fmt(g, w.wallet)} in your wallet.`);
      const limit = this.settings.get(g, 'eco_bank_limit');
      if (limit && w.bank + amount > limit) throw new UserError(`The bank limit is ${this.fmt(g, limit)}.`);
      this.q.setBank.run(w.wallet - amount, w.bank + amount, g, u);
      this.q.tx.run(g, u, 0, w.wallet - amount, 'deposit', String(amount), this.now());
      return { wallet: w.wallet - amount, bank: w.bank + amount };
    })();
  }

  withdraw(g, u, amount) {
    this._assertEnabled(g);
    return this.db.transaction(() => {
      const w = this.wallet(g, u);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError('Amount must be positive.');
      if (amount > w.bank) throw new UserError(`You only have ${this.fmt(g, w.bank)} in the bank.`);
      this.q.setBank.run(w.wallet + amount, w.bank - amount, g, u);
      this.q.tx.run(g, u, 0, w.wallet + amount, 'withdraw', String(amount), this.now());
      return { wallet: w.wallet + amount, bank: w.bank - amount };
    })();
  }

  /** Parse "all", "half", "25%", or an integer relative to `available`. */
  parseAmount(text, available) {
    const s = String(text).trim().toLowerCase().replace(/,/g, '');
    let n;
    if (s === 'all' || s === 'max') n = available;
    else if (s === 'half') n = Math.floor(available / 2);
    else if (/^\d{1,3}%$/.test(s)) n = Math.floor((available * Number(s.slice(0, -1))) / 100);
    else if (/^\d+(\.\d+)?k$/.test(s)) n = Math.round(parseFloat(s) * 1000);
    else if (/^\d+$/.test(s)) n = Number(s);
    else throw new UserError('Amount must be a number, `all`, `half` or a percentage like `25%`.');
    if (!Number.isSafeInteger(n) || n <= 0) throw new UserError('Amount must be positive.');
    return n;
  }

  cooldownLeft(g, u, key) {
    const row = this.q.cdGet.get(g, u, key);
    return row && row.until > this.now() ? row.until - this.now() : 0;
  }

  /**
   * Atomically check a persistent cooldown and pay a reward. Two concurrent
   * claims can't both succeed because the check+write is one transaction.
   */
  claim(g, u, key, baseCooldownSecs, rewardFn, kind = key) {
    this._assertEnabled(g);
    const cd = Math.max(1, Math.round((baseCooldownSecs * this.settings.get(g, 'eco_cooldown_pct')) / 100));
    return this.db.transaction(() => {
      const left = this.cooldownLeft(g, u, key);
      if (left) throw new UserError(`You can do that again in **${formatDuration(left)}**.`);
      const reward = rewardFn();
      this.q.cdSet.run(g, u, key, this.now() + cd);
      const w = reward.amount !== 0 ? this.adjust(g, u, reward.amount, kind, reward.ref || null) : this.wallet(g, u);
      return { ...reward, wallet: w.wallet };
    })();
  }

  randInt(min, max) { return Math.floor(this.random() * (max - min + 1)) + min; }

  history(g, u, limit = 10) {
    return this.db.prepare('SELECT * FROM transactions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?').all(g, u, limit);
  }

  leaderboard(g, limit = 10, offset = 0) {
    return this.db.prepare('SELECT user_id, wallet, bank, wallet + bank AS total FROM wallets WHERE guild_id = ? ORDER BY total DESC LIMIT ? OFFSET ?').all(g, limit, offset);
  }

  rank(g, u) {
    const w = this.wallet(g, u);
    return this.db.prepare('SELECT COUNT(*) + 1 AS pos FROM wallets WHERE guild_id = ? AND wallet + bank > ?').get(g, w.wallet + w.bank).pos;
  }

  // ---- shop ---------------------------------------------------------------
  addItem(g, { name, description = '', price, stock = -1, roleId = null, sellable = true }) {
    if (!Number.isSafeInteger(price) || price <= 0) throw new UserError('Price must be a positive whole number.');
    try {
      const r = this.db.prepare('INSERT INTO shop_items (guild_id, name, description, price, stock, role_id, sellable) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(g, name, description, price, stock, roleId, sellable ? 1 : 0);
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) throw new UserError(`An item named **${name}** already exists.`);
      throw e;
    }
  }
  item(g, nameOrId) {
    const byId = /^\d+$/.test(String(nameOrId)) ? this.db.prepare('SELECT * FROM shop_items WHERE guild_id = ? AND id = ?').get(g, Number(nameOrId)) : null;
    const item = byId || this.db.prepare('SELECT * FROM shop_items WHERE guild_id = ? AND name = ?').get(g, String(nameOrId));
    if (!item) throw new UserError(`No shop item called **${nameOrId}**.`);
    return item;
  }
  items(g) { return this.db.prepare('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY price ASC, id ASC').all(g); }
  removeItem(g, nameOrId) { const it = this.item(g, nameOrId); this.db.prepare('DELETE FROM shop_items WHERE id = ?').run(it.id); return it; }
  updateItem(g, nameOrId, fields) {
    const it = this.item(g, nameOrId);
    const allowed = ['price', 'stock', 'description', 'role_id', 'sellable', 'name'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) throw new UserError('Nothing to update.');
    this.db.prepare(`UPDATE shop_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), it.id);
    return this.item(g, it.id);
  }
  qty(g, u, itemId) {
    const r = this.db.prepare('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?').get(g, u, itemId);
    return r ? r.qty : 0;
  }
  giveItem(g, u, itemId, qty) {
    this.db.prepare('INSERT INTO inventory (guild_id, user_id, item_id, qty) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id, item_id) DO UPDATE SET qty = qty + excluded.qty').run(g, u, itemId, qty);
  }
  takeItem(g, u, itemId, qty) {
    if (this.qty(g, u, itemId) < qty) throw new UserError('You do not have enough of that item.');
    this.db.prepare('UPDATE inventory SET qty = qty - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?').run(qty, g, u, itemId);
    this.db.prepare('DELETE FROM inventory WHERE qty = 0').run();
  }
  buy(g, u, nameOrId, qty = 1) {
    this._assertEnabled(g);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000) throw new UserError('Quantity must be between 1 and 1000.');
    return this.db.transaction(() => {
      const it = this.item(g, nameOrId);
      if (it.stock !== -1 && it.stock < qty) throw new UserError(`Only ${it.stock} of **${it.name}** left in stock.`);
      const cost = it.price * qty;
      this.adjust(g, u, -cost, 'shop:buy', `${it.id}x${qty}`);
      if (it.stock !== -1) this.db.prepare('UPDATE shop_items SET stock = stock - ? WHERE id = ?').run(qty, it.id);
      this.giveItem(g, u, it.id, qty);
      return { item: it, qty, cost };
    })();
  }
  sell(g, u, nameOrId, qty = 1) {
    this._assertEnabled(g);
    return this.db.transaction(() => {
      const it = this.item(g, nameOrId);
      if (!it.sellable) throw new UserError('That item cannot be sold.');
      this.takeItem(g, u, it.id, qty);
      const refund = Math.floor(it.price * qty * 0.5);
      this.adjust(g, u, refund, 'shop:sell', `${it.id}x${qty}`);
      if (it.stock !== -1) this.db.prepare('UPDATE shop_items SET stock = stock + ? WHERE id = ?').run(qty, it.id);
      return { item: it, qty, refund };
    })();
  }
  inventory(g, u) {
    return this.db.prepare('SELECT i.qty, s.id, s.name, s.price, s.role_id FROM inventory i JOIN shop_items s ON s.id = i.item_id WHERE i.guild_id = ? AND i.user_id = ? ORDER BY s.name').all(g, u);
  }
  netWorth(g, u) {
    const w = this.wallet(g, u);
    const items = this.db.prepare('SELECT COALESCE(SUM(i.qty * s.price), 0) AS v FROM inventory i JOIN shop_items s ON s.id = i.item_id WHERE i.guild_id = ? AND i.user_id = ?').get(g, u).v;
    return { wallet: w.wallet, bank: w.bank, items, total: w.wallet + w.bank + items };
  }
}

module.exports = { Economy };

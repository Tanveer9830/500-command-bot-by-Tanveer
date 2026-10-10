'use strict';
/** In-memory cooldowns and sliding-window rate limiter (single process). Clock is injectable for tests. */
class RateLimiter {
  constructor({ now = () => Date.now(), windowMs = 10_000, max = 12 } = {}) {
    this.now = now; this.windowMs = windowMs; this.max = max;
    this.cooldowns = new Map(); this.hits = new Map();
  }
  /** Returns remaining cooldown seconds (0 when free) and arms the cooldown when free. */
  cooldown(userId, key, seconds) {
    if (!seconds) return 0;
    const id = `${userId}:${key}`;
    const t = this.now();
    const until = this.cooldowns.get(id) || 0;
    if (until > t) return Math.ceil((until - t) / 1000);
    this.cooldowns.set(id, t + seconds * 1000);
    return 0;
  }
  /** Returns seconds to wait when the user exceeds `max` commands per window, else 0. */
  limit(userId) {
    const t = this.now();
    const arr = (this.hits.get(userId) || []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(userId, arr); return Math.ceil((this.windowMs - (t - arr[0])) / 1000); }
    arr.push(t); this.hits.set(userId, arr);
    return 0;
  }
  sweep() {
    const t = this.now();
    for (const [k, v] of this.cooldowns) if (v <= t) this.cooldowns.delete(k);
    for (const [k, v] of this.hits) { const f = v.filter((x) => t - x < this.windowMs); if (f.length) this.hits.set(k, f); else this.hits.delete(k); }
  }
}
module.exports = { RateLimiter };

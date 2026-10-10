'use strict';
/**
 * Outbound HTTP for information-lookup commands. Only HTTPS requests to an
 * allow-list of public API hosts are made (no user-controlled hosts → no SSRF),
 * with a timeout, a response-size cap and a small cache.
 */
const { UserError } = require('../core/errors');

const ALLOWED_HOSTS = new Set([
  'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'air-quality-api.open-meteo.com', 'en.wikipedia.org', 'api.dictionaryapi.dev', 'restcountries.com',
  'api.coingecko.com', 'api.frankfurter.dev', 'api.frankfurter.app', 'api.github.com', 'registry.npmjs.org', 'pypi.org',
  'opentdb.com', 'api.datamuse.com', 'catfact.ninja', 'icanhazdadjoke.com', 'official-joke-api.appspot.com',
  'api.agify.io', 'api.genderize.io', 'api.nationalize.io', 'api.sunrise-sunset.org', 'api.adviceslip.com', 'uselessfacts.jsph.pl',
]);
const MAX_BYTES = 1_000_000;

class Lookup {
  constructor({ fetchImpl = globalThis.fetch, ttlMs = 5 * 60_000, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl; this.ttl = ttlMs; this.now = now; this.cache = new Map();
  }
  async json(url, { headers = {}, timeoutMs = 8000, cache = true } = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`blocked host ${u.hostname}`);
    const hit = this.cache.get(url);
    if (cache && hit && this.now() - hit.t < this.ttl) return hit.v;
    let res;
    try {
      res = await this.fetch(url, { headers: { 'user-agent': 'TanveerPrime/1.0 (+Discord: tanveer5637)', accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    } catch (e) { throw new UserError('The lookup service did not respond in time. Try again later.'); }
    if (res.url && !ALLOWED_HOSTS.has(new URL(res.url).hostname)) throw new UserError('Blocked redirect.');
    if (res.status === 404) throw new UserError('Nothing found for that query.');
    if (!res.ok) throw new UserError(`The lookup service returned an error (${res.status}).`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new UserError('The response was too large.');
    let v;
    try { v = JSON.parse(text); } catch { throw new UserError('The lookup service returned an unexpected response.'); }
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(url, { t: this.now(), v });
    return v;
  }
}

module.exports = { Lookup, ALLOWED_HOSTS };

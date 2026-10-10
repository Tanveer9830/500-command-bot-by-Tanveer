'use strict';
/** Information lookups using free, key-less public APIs through the allow-listed HTTP client. */
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { safe, truncate, fmtNum } = require('../utils/text');

const q = (name, description, max = 80) => ({ name, type: 'string', description, required: true, maxLength: max, rest: true });
const enc = encodeURIComponent;
const WMO = { 0: 'Clear sky ☀️', 1: 'Mainly clear 🌤️', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️', 45: 'Fog 🌫️', 48: 'Rime fog 🌫️', 51: 'Light drizzle 🌦️', 53: 'Drizzle 🌦️', 55: 'Dense drizzle 🌧️', 56: 'Freezing drizzle 🌧️', 57: 'Freezing drizzle 🌧️', 61: 'Light rain 🌦️', 63: 'Rain 🌧️', 65: 'Heavy rain 🌧️', 66: 'Freezing rain 🌧️', 67: 'Freezing rain 🌧️', 71: 'Light snow 🌨️', 73: 'Snow ❄️', 75: 'Heavy snow ❄️', 77: 'Snow grains ❄️', 80: 'Rain showers 🌦️', 81: 'Rain showers 🌧️', 82: 'Violent showers ⛈️', 85: 'Snow showers 🌨️', 86: 'Heavy snow showers 🌨️', 95: 'Thunderstorm ⛈️', 96: 'Thunderstorm with hail ⛈️', 99: 'Thunderstorm with heavy hail ⛈️' };
const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
const money = (n) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Number(n.toPrecision(4))));

module.exports = function register(registry) {
  const wrap = (g, sub, spec, run) => g.action(sub, { cooldown: 3, ...spec }, async (ctx) => { try { return await run(ctx, ctx.svc.lookup); } catch (e) { if (e instanceof UserError) throw e; throw new UserError('That lookup failed. Please try again later.'); } });

  // ---------------------------------------------------------------- weather
  const W = registry.group({ name: 'weather', description: 'Weather and air quality (Open-Meteo)', category: 'Lookup', defaultSub: 'now' });
  async function place(lk, name) {
    const r = await lk.json(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(name)}&count=1&language=en&format=json`);
    const p = r.results && r.results[0]; if (!p) throw new UserError(`I couldn't find a place called **${safe(name)}**.`);
    return { lat: p.latitude, lon: p.longitude, label: [p.name, p.admin1, p.country].filter(Boolean).join(', ') };
  }
  const base = (p, extra) => `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&timezone=auto&${extra}`;
  wrap(W, 'now', { description: 'Current weather', options: [q('city', 'City name, e.g. Kolkata')] }, async (ctx, lk) => {
    const p = await place(lk, ctx.args.city);
    const r = await lk.json(base(p, 'current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day'));
    const c = r.current; if (!c) throw new UserError('No weather data for that place.');
    return H.embed(ctx, { title: `Weather in ${safe(p.label)}`, description: `**${WMO[c.weather_code] || 'Unknown'}**`, fields: [{ name: 'Temperature', value: `${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)`, inline: true }, { name: 'Humidity', value: `${c.relative_humidity_2m}%`, inline: true }, { name: 'Wind', value: `${c.wind_speed_10m} km/h ${compass(c.wind_direction_10m)}`, inline: true }, { name: 'Precipitation', value: `${c.precipitation} mm`, inline: true }], footer: { text: 'Data: open-meteo.com' } });
  });
  wrap(W, 'forecast', { description: 'Daily forecast (1-7 days)', options: [{ name: 'days', type: 'integer', description: '1-7', required: true, min: 1, max: 7 }, q('city', 'City name')] }, async (ctx, lk) => {
    const p = await place(lk, ctx.args.city); const r = await lk.json(base(p, `daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=${ctx.args.days}`)); const d = r.daily;
    if (!d) throw new UserError('No forecast data.');
    return H.embed(ctx, { title: `Forecast for ${safe(p.label)}`, description: d.time.map((t, i) => `**${t}** ${WMO[d.weather_code[i]] || ''} ${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]}°C • ${d.precipitation_sum[i]} mm`).join('\n'), footer: { text: 'Data: open-meteo.com' } });
  });
  wrap(W, 'hourly', { description: 'Next 12 hours', options: [q('city', 'City name')] }, async (ctx, lk) => {
    const p = await place(lk, ctx.args.city); const r = await lk.json(base(p, 'hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=12')); const h = r.hourly; if (!h) throw new UserError('No hourly data.');
    return H.embed(ctx, { title: `Next hours in ${safe(p.label)}`, description: h.time.map((t, i) => `**${t.slice(11)}** ${h.temperature_2m[i]}°C • ${h.precipitation_probability[i] ?? '?'}% rain • ${WMO[h.weather_code[i]] || ''}`).join('\n') });
  });
  wrap(W, 'sun', { description: 'Sunrise and sunset today', options: [q('city', 'City name')] }, async (ctx, lk) => { const p = await place(lk, ctx.args.city); const r = await lk.json(base(p, 'daily=sunrise,sunset&forecast_days=1')); if (!r.daily) throw new UserError('No data.'); return `🌅 **${safe(p.label)}** — sunrise ${r.daily.sunrise[0].slice(11)} • sunset ${r.daily.sunset[0].slice(11)} (local time)`; });
  wrap(W, 'air', { description: 'Air quality index', options: [q('city', 'City name')] }, async (ctx, lk) => {
    const p = await place(lk, ctx.args.city); const r = await lk.json(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=us_aqi,pm10,pm2_5`); const c = r.current; if (!c) throw new UserError('No air-quality data.');
    const aqi = c.us_aqi; const label = aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for sensitive groups' : aqi <= 200 ? 'Unhealthy' : aqi <= 300 ? 'Very unhealthy' : 'Hazardous';
    return `🌫️ **${safe(p.label)}** — US AQI **${aqi}** (${label}) • PM2.5 ${c.pm2_5} µg/m³ • PM10 ${c.pm10} µg/m³`;
  });
  wrap(W, 'geocode', { description: 'Coordinates of a place', options: [q('place', 'Place name')] }, async (ctx, lk) => { const p = await place(lk, ctx.args.place); return `📍 **${safe(p.label)}** — ${p.lat}, ${p.lon}`; });

  // ----------------------------------------------------------------- lookup
  const L = registry.group({ name: 'lookup', description: 'Look things up on the internet', category: 'Lookup', aliases: ['search'] });
  wrap(L, 'define', { description: 'Dictionary definition', aliases: ['dictionary'], options: [{ name: 'word', type: 'string', description: 'English word', required: true, maxLength: 40, pattern: /^[\p{L}'-]+$/u, patternHelp: 'a single word' }] }, async (ctx, lk) => {
    const r = await lk.json(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(ctx.args.word.toLowerCase())}`); const e = Array.isArray(r) ? r[0] : null; if (!e) throw new UserError('No definition found.');
    return H.embed(ctx, { title: safe(e.word), description: truncate((e.meanings || []).slice(0, 3).map((m) => `**${safe(m.partOfSpeech)}** — ${safe(m.definitions[0].definition)}${m.definitions[0].example ? `\n_“${safe(m.definitions[0].example)}”_` : ''}`).join('\n\n'), 3500), footer: { text: e.phonetic ? `Pronunciation: ${e.phonetic}` : 'dictionaryapi.dev' } });
  });
  const datamuse = (sub, rel, description, label) => wrap(L, sub, { description, options: [{ name: 'word', type: 'string', description: 'Word', required: true, maxLength: 40, pattern: /^[\p{L}'-]+$/u, patternHelp: 'a single word' }] }, async (ctx, lk) => { const r = await lk.json(`https://api.datamuse.com/words?${rel}=${enc(ctx.args.word.toLowerCase())}&max=20`); return r.length ? `📚 ${label} **${safe(ctx.args.word)}**: ${r.map((x) => safe(x.word)).join(', ')}` : 'No results.'; });
  datamuse('synonyms', 'rel_syn', 'Synonyms of a word', 'Synonyms for');
  datamuse('rhymes', 'rel_rhy', 'Words that rhyme', 'Rhymes with');
  wrap(L, 'wiki', { description: 'Wikipedia summary', aliases: ['wikipedia'], options: [q('topic', 'Article title')] }, async (ctx, lk) => {
    const r = await lk.json(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(ctx.args.topic.trim().replace(/ /g, '_'))}?redirect=true`); if (!r.extract) throw new UserError('No article found.');
    const url = r.content_urls && r.content_urls.desktop && /^https:\/\/en\.wikipedia\.org\//.test(r.content_urls.desktop.page) ? r.content_urls.desktop.page : undefined;
    return H.embed(ctx, { title: safe(r.title), url, description: truncate(safe(r.extract), 900) + (r.type === 'disambiguation' ? '\n\n_This is a disambiguation page._' : ''), thumbnail: r.thumbnail && /^https:\/\/upload\.wikimedia\.org\//.test(r.thumbnail.source) ? r.thumbnail.source : undefined, footer: { text: 'Wikipedia, CC BY-SA' } });
  });
  wrap(L, 'country', { description: 'Facts about a country', options: [q('name', 'Country name')] }, async (ctx, lk) => {
    const r = await lk.json(`https://restcountries.com/v3.1/name/${enc(ctx.args.name)}?fields=name,capital,region,subregion,population,area,languages,currencies,flag,tld`); const c = Array.isArray(r) ? r[0] : null; if (!c) throw new UserError('Country not found.');
    return H.embed(ctx, { title: `${c.flag || ''} ${safe(c.name.common)}`, description: safe(c.name.official), fields: [{ name: 'Capital', value: safe((c.capital || ['—']).join(', ')), inline: true }, { name: 'Region', value: safe(`${c.region}${c.subregion ? ` / ${c.subregion}` : ''}`), inline: true }, { name: 'Population', value: fmtNum(c.population), inline: true }, { name: 'Area', value: `${fmtNum(c.area)} km²`, inline: true }, { name: 'Languages', value: safe(Object.values(c.languages || {}).join(', ') || '—'), inline: true }, { name: 'Currencies', value: safe(Object.values(c.currencies || {}).map((x) => `${x.name} (${x.symbol || ''})`).join(', ') || '—'), inline: true }] });
  });
  wrap(L, 'crypto', { description: 'Cryptocurrency price (CoinGecko id, e.g. bitcoin)', options: [{ name: 'coin', type: 'string', description: 'CoinGecko id', required: true, maxLength: 40, pattern: /^[a-z0-9-]+$/, patternHelp: 'a CoinGecko id such as bitcoin' }, { name: 'currency', type: 'string', description: 'Fiat code (default usd)', maxLength: 5, pattern: /^[a-z]{3,5}$/i, patternHelp: 'e.g. usd, inr' }] }, async (ctx, lk) => {
    const cur = (ctx.args.currency || 'usd').toLowerCase(); const r = await lk.json(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(ctx.args.coin)}&vs_currencies=${cur}&include_24hr_change=true`); const d = r[ctx.args.coin]; if (!d || d[cur] === undefined) throw new UserError('Unknown coin or currency.');
    const ch = d[`${cur}_24h_change`]; return `🪙 **${safe(ctx.args.coin)}** = **${money(d[cur])} ${cur.toUpperCase()}**${typeof ch === 'number' ? ` (${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}% 24h)` : ''}\n_Market data for information only — not financial advice._`;
  });
  wrap(L, 'exchange', { description: 'Currency exchange rate (ECB reference rates)', options: [{ name: 'amount', type: 'number', description: 'Amount', required: true, min: 0, max: 1e12 }, { name: 'from', type: 'string', description: 'e.g. USD', required: true, pattern: /^[a-z]{3}$/i, patternHelp: '3-letter code', maxLength: 3 }, { name: 'to', type: 'string', description: 'e.g. INR', required: true, pattern: /^[a-z]{3}$/i, patternHelp: '3-letter code', maxLength: 3 }] }, async (ctx, lk) => {
    const from = ctx.args.from.toUpperCase(); const to = ctx.args.to.toUpperCase(); const r = await lk.json(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`); const rate = r.rates && r.rates[to]; if (!rate) throw new UserError('Unknown currency code.');
    return `💱 ${money(ctx.args.amount)} ${from} = **${money(ctx.args.amount * rate)} ${to}** (1 ${from} = ${rate} ${to}, ${r.date})`;
  });
  wrap(L, 'ghuser', { description: 'GitHub user profile', options: [{ name: 'user', type: 'string', description: 'GitHub username', required: true, maxLength: 39, pattern: /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i, patternHelp: 'a valid GitHub username' }] }, async (ctx, lk) => { const u = await lk.json(`https://api.github.com/users/${enc(ctx.args.user)}`); return H.embed(ctx, { title: safe(u.name || u.login), url: u.html_url, description: safe(u.bio) || '_no bio_', thumbnail: u.avatar_url, fields: [{ name: 'Repos', value: String(u.public_repos), inline: true }, { name: 'Followers', value: fmtNum(u.followers), inline: true }, { name: 'Joined', value: String(u.created_at).slice(0, 10), inline: true }] }); });
  wrap(L, 'ghrepo', { description: 'GitHub repository info', options: [{ name: 'repo', type: 'string', description: 'owner/name', required: true, maxLength: 100, pattern: /^[\w.-]+\/[\w.-]+$/, patternHelp: 'owner/name' }] }, async (ctx, lk) => { const r = await lk.json(`https://api.github.com/repos/${ctx.args.repo}`); return H.embed(ctx, { title: safe(r.full_name), url: r.html_url, description: safe(r.description) || '_no description_', fields: [{ name: 'Stars', value: fmtNum(r.stargazers_count), inline: true }, { name: 'Forks', value: fmtNum(r.forks_count), inline: true }, { name: 'Language', value: safe(r.language || '—'), inline: true }, { name: 'License', value: safe((r.license && r.license.spdx_id) || '—'), inline: true }, { name: 'Updated', value: String(r.pushed_at).slice(0, 10), inline: true }] }); });
  wrap(L, 'npm', { description: 'npm package info', options: [{ name: 'package', type: 'string', description: 'Package name', required: true, maxLength: 100, pattern: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, patternHelp: 'a valid npm package name' }] }, async (ctx, lk) => { const p = await lk.json(`https://registry.npmjs.org/${ctx.args.package.replace('/', '%2f')}/latest`); return H.embed(ctx, { title: `${safe(p.name)}@${safe(p.version)}`, url: `https://www.npmjs.com/package/${p.name}`, description: safe(p.description) || '_no description_', fields: [{ name: 'License', value: safe(typeof p.license === 'string' ? p.license : '—'), inline: true }, { name: 'Dependencies', value: String(Object.keys(p.dependencies || {}).length), inline: true }] }); });
  wrap(L, 'pypi', { description: 'PyPI package info', options: [{ name: 'package', type: 'string', description: 'Package name', required: true, maxLength: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/, patternHelp: 'a valid PyPI package name' }] }, async (ctx, lk) => { const r = await lk.json(`https://pypi.org/pypi/${enc(ctx.args.package)}/json`); const i = r.info; return H.embed(ctx, { title: `${safe(i.name)} ${safe(i.version)}`, url: `https://pypi.org/project/${i.name}/`, description: safe(i.summary) || '_no summary_', fields: [{ name: 'License', value: safe(truncate(i.license || '—', 60)), inline: true }, { name: 'Requires Python', value: safe(i.requires_python || '—'), inline: true }] }); });
  wrap(L, 'dadjoke', { description: 'A dad joke from icanhazdadjoke', options: [] }, async (ctx, lk) => { const r = await lk.json('https://icanhazdadjoke.com/', { cache: false }); return `😄 ${safe(r.joke)}`; });
  wrap(L, 'joke', { description: 'A random joke', options: [] }, async (ctx, lk) => { const r = await lk.json('https://official-joke-api.appspot.com/random_joke', { cache: false }); return `😄 ${safe(r.setup)}\n||${safe(r.punchline)}||`; });
  wrap(L, 'catfact', { description: 'A random cat fact', options: [] }, async (ctx, lk) => { const r = await lk.json('https://catfact.ninja/fact', { cache: false }); return `🐱 ${safe(r.fact)}`; });
  wrap(L, 'advice', { description: 'A piece of advice', options: [] }, async (ctx, lk) => { const r = await lk.json('https://api.adviceslip.com/advice', { cache: false }); return `💭 ${safe(r.slip && r.slip.advice)}`; });
  wrap(L, 'randomfact', { description: 'A random useless fact', options: [] }, async (ctx, lk) => { const r = await lk.json('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { cache: false }); return `💡 ${safe(r.text)}`; });

  registry.standalone('define', 'lookup.define');
  registry.standalone('wiki', 'lookup.wiki');
};

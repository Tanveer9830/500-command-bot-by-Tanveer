'use strict';
/** Calculators: expressions & statistics, number theory & geometry, personal finance, unit conversion. */
const { UserError } = require('../core/errors');
const { evaluate } = require('../services/safeMath');
const { truncate, safe } = require('../utils/text');

const num = (name, description, extra = {}) => ({ name, type: 'number', description, required: true, ...extra });
const int = (name, description, extra = {}) => ({ name, type: 'integer', description, required: true, ...extra });
const list = { name: 'numbers', type: 'string', description: 'Numbers separated by spaces or commas', required: true, maxLength: 1000, rest: true };

function fmt(n, digits = 10) {
  if (typeof n === 'bigint') return n.toString();
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('en-US');
  const v = Number(n.toPrecision(digits));
  return Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : String(v);
}
const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function parseNums(s, { min = 1, max = 500 } = {}) {
  const parts = String(s).split(/[\s,;]+/).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.length < min) throw new UserError(`Give at least ${min} number${min > 1 ? 's' : ''}.`);
  if (nums.length > max) throw new UserError(`Give at most ${max} numbers.`);
  if (nums.some((n) => !Number.isFinite(n))) throw new UserError('Every value must be a plain number.');
  return nums;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => sum(a) / a.length;
const variance = (a, sample) => { const m = mean(a); return sum(a.map((x) => (x - m) ** 2)) / (a.length - (sample ? 1 : 0)); };
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const bigFact = (n) => { let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; return r; };
const bigBinom = (n, k) => { k = Math.min(k, n - k); let r = 1n; for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i); return r; };
function isPrime(n) { if (n < 2) return false; if (n < 4) return true; if (n % 2 === 0 || n % 3 === 0) return false; for (let i = 5; i * i <= n; i += 6) if (n % i === 0 || n % (i + 2) === 0) return false; return true; }
function primeFactors(n) { const f = []; for (let p = 2; p * p <= n; p += p === 2 ? 1 : 2) while (n % p === 0) { f.push(p); n /= p; } if (n > 1) f.push(n); return f; }
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function toRoman(n) { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; }
function fromRoman(s) { if (!/^[MDCLXVI]+$/i.test(s)) throw new UserError('Not a Roman numeral.'); let i = 0; let n = 0; const u = s.toUpperCase(); for (const [v, r] of ROMAN) while (u.startsWith(r, i)) { n += v; i += r.length; } if (i !== u.length || toRoman(n) !== u) throw new UserError('Not a valid Roman numeral.'); return n; }

// -------------------------------------------------------- unit conversion tables
const PI = Math.PI;
const UNITS = {
  length: { base: 'm', u: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 } },
  mass: { base: 'kg', u: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 } },
  volume: { base: 'l', u: { ml: 0.001, l: 1, m3: 1000, tsp: 0.00492892159375, tbsp: 0.01478676478125, floz: 0.0295735295625, cup: 0.2365882365, pt: 0.473176473, qt: 0.946352946, gal: 3.785411784, galuk: 4.54609 } },
  speed: { base: 'm/s', u: { mps: 1, kph: 1 / 3.6, mph: 0.44704, kn: 1852 / 3600, fps: 0.3048, mach: 340.29 } },
  area: { base: 'm²', u: { mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 1e4, in2: 0.00064516, ft2: 0.09290304, yd2: 0.83612736, acre: 4046.8564224, mi2: 2589988.110336 } },
  data: { base: 'byte', u: { bit: 0.125, byte: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 } },
  energy: { base: 'J', u: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6, btu: 1055.05585262, ev: 1.602176634e-19 } },
  pressure: { base: 'Pa', u: { pa: 1, kpa: 1000, bar: 1e5, mbar: 100, atm: 101325, psi: 6894.757293168, mmhg: 133.322387415, torr: 101325 / 760 } },
  angle: { base: 'rad', u: { rad: 1, deg: PI / 180, grad: PI / 200, turn: 2 * PI, arcmin: PI / 10800, arcsec: PI / 648000 } },
  time: { base: 's', u: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, mo: 2629746, yr: 31556952 } },
  power: { base: 'W', u: { w: 1, kw: 1000, mw: 1e6, hp: 745.69987158, ps: 735.49875 } },
};
function convertUnits(kind, value, from, to) {
  const tbl = UNITS[kind].u; const f = String(from).toLowerCase(); const t = String(to).toLowerCase();
  if (!(f in tbl)) throw new UserError(`Unknown ${kind} unit \`${safe(from)}\`. Options: ${Object.keys(tbl).join(', ')}`);
  if (!(t in tbl)) throw new UserError(`Unknown ${kind} unit \`${safe(to)}\`. Options: ${Object.keys(tbl).join(', ')}`);
  return (value * tbl[f]) / tbl[t];
}
const TEMP = { c: [(x) => x, (x) => x], f: [(x) => ((x - 32) * 5) / 9, (x) => (x * 9) / 5 + 32], k: [(x) => x - 273.15, (x) => x + 273.15], r: [(x) => ((x - 491.67) * 5) / 9, (x) => ((x + 273.15) * 9) / 5] };
const FUEL_TO_KML = { mpg: 0.425143707, mpguk: 0.354006189, kml: 1 };

module.exports = function register(registry) {
  const E = (g, sub, spec, run) => g.action(sub, spec, async (ctx) => { try { return await run(ctx); } catch (e) { if (e instanceof UserError) throw e; throw new UserError(`Could not calculate that: ${e.message}`); } });
  const ans = (label, value) => `🧮 ${label} **${value}**`;

  // ------------------------------------------------------------------- calc
  const C = registry.group({ name: 'calc', description: 'Calculator and statistics', category: 'Calculators', aliases: ['calculate'], defaultSub: 'expr' });
  E(C, 'expr', { description: 'Evaluate a math expression', options: [{ name: 'expression', type: 'string', description: 'e.g. (3+4)*sqrt(16)/2', required: true, maxLength: 200, rest: true }] }, (ctx) => `🧮 \`${safe(ctx.args.expression)}\` = **${fmt(evaluate(ctx.args.expression))}**`);
  E(C, 'percent', { description: 'X% of Y', options: [num('percent', 'Percentage'), num('of', 'Base value')] }, (ctx) => ans(`${fmt(ctx.args.percent)}% of ${fmt(ctx.args.of)} =`, fmt((ctx.args.percent * ctx.args.of) / 100)));
  E(C, 'percentof', { description: 'What percent is A of B?', options: [num('a', 'Part'), num('b', 'Whole')] }, (ctx) => { if (ctx.args.b === 0) throw new UserError('The whole cannot be zero.'); return ans(`${fmt(ctx.args.a)} is`, `${fmt((ctx.args.a / ctx.args.b) * 100)}% of ${fmt(ctx.args.b)}`); });
  E(C, 'change', { description: 'Percent change from A to B', options: [num('from', 'Old value'), num('to', 'New value')] }, (ctx) => { if (ctx.args.from === 0) throw new UserError('The old value cannot be zero.'); const c = ((ctx.args.to - ctx.args.from) / Math.abs(ctx.args.from)) * 100; return ans(`${fmt(ctx.args.from)} → ${fmt(ctx.args.to)}:`, `${c >= 0 ? '+' : ''}${fmt(c)}%`); });
  E(C, 'increase', { description: 'Increase a number by a percentage', options: [num('value', 'Value'), num('percent', 'Percent')] }, (ctx) => ans('Result:', fmt(ctx.args.value * (1 + ctx.args.percent / 100))));
  E(C, 'decrease', { description: 'Decrease a number by a percentage', options: [num('value', 'Value'), num('percent', 'Percent')] }, (ctx) => ans('Result:', fmt(ctx.args.value * (1 - ctx.args.percent / 100))));
  E(C, 'average', { description: 'Arithmetic mean', aliases: ['avg', 'mean'], options: [list] }, (ctx) => ans('Mean:', fmt(mean(parseNums(ctx.args.numbers)))));
  E(C, 'median', { description: 'Median', options: [list] }, (ctx) => { const a = parseNums(ctx.args.numbers).sort((x, y) => x - y); const m = a.length >> 1; return ans('Median:', fmt(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2)); });
  E(C, 'mode', { description: 'Most frequent value(s)', options: [list] }, (ctx) => { const c = new Map(); for (const n of parseNums(ctx.args.numbers)) c.set(n, (c.get(n) || 0) + 1); const top = Math.max(...c.values()); return ans('Mode:', `${[...c].filter(([, k]) => k === top).map(([n]) => fmt(n)).join(', ')} (×${top})`); });
  E(C, 'sum', { description: 'Sum of numbers', options: [list] }, (ctx) => ans('Sum:', fmt(sum(parseNums(ctx.args.numbers)))));
  E(C, 'product', { description: 'Product of numbers', options: [list] }, (ctx) => ans('Product:', fmt(parseNums(ctx.args.numbers).reduce((x, y) => x * y, 1))));
  E(C, 'range', { description: 'Minimum, maximum and range', options: [list] }, (ctx) => { const a = parseNums(ctx.args.numbers); const lo = Math.min(...a); const hi = Math.max(...a); return `🧮 min **${fmt(lo)}** • max **${fmt(hi)}** • range **${fmt(hi - lo)}**`; });
  E(C, 'stddev', { description: 'Standard deviation (sample and population)', options: [list] }, (ctx) => { const a = parseNums(ctx.args.numbers, { min: 2 }); return `🧮 population σ = **${fmt(Math.sqrt(variance(a, false)))}** • sample s = **${fmt(Math.sqrt(variance(a, true)))}**`; });
  E(C, 'variance', { description: 'Variance (sample and population)', options: [list] }, (ctx) => { const a = parseNums(ctx.args.numbers, { min: 2 }); return `🧮 population σ² = **${fmt(variance(a, false))}** • sample s² = **${fmt(variance(a, true))}**`; });
  E(C, 'zscore', { description: 'Z-score of a value in a dataset', options: [num('value', 'Value'), list] }, (ctx) => { const a = parseNums(ctx.args.numbers, { min: 2 }); const sd = Math.sqrt(variance(a, false)); if (sd === 0) throw new UserError('All values are identical.'); return ans('z =', fmt((ctx.args.value - mean(a)) / sd)); });
  E(C, 'round', { description: 'Round to N decimal places', options: [num('value', 'Value'), int('decimals', 'Decimals 0-12', { min: 0, max: 12 })] }, (ctx) => ans('Rounded:', ctx.args.value.toFixed(ctx.args.decimals)));
  E(C, 'scientific', { description: 'Scientific notation', options: [num('value', 'Value')] }, (ctx) => ans('Scientific:', ctx.args.value.toExponential(6)));
  E(C, 'sqrt', { description: 'Square root', options: [num('value', 'Value', { min: 0 })] }, (ctx) => ans(`√${fmt(ctx.args.value)} =`, fmt(Math.sqrt(ctx.args.value))));
  E(C, 'power', { description: 'Raise to a power', options: [num('base', 'Base'), num('exponent', 'Exponent')] }, (ctx) => { const r = ctx.args.base ** ctx.args.exponent; if (!Number.isFinite(r)) throw new UserError('The result is not a finite number.'); return ans(`${fmt(ctx.args.base)}^${fmt(ctx.args.exponent)} =`, fmt(r)); });
  E(C, 'root', { description: 'The Nth root', options: [num('value', 'Value'), int('n', 'Root degree 2-100', { min: 2, max: 100 })] }, (ctx) => { if (ctx.args.value < 0 && ctx.args.n % 2 === 0) throw new UserError('Even roots of negative numbers are not real.'); const r = Math.sign(ctx.args.value) * Math.abs(ctx.args.value) ** (1 / ctx.args.n); return ans(`${ctx.args.n}√${fmt(ctx.args.value)} =`, fmt(r)); });
  E(C, 'log', { description: 'Logarithm in any base', options: [num('value', 'Value', { min: 0 }), num('base', 'Base (default 10)', { required: false, min: 0 })] }, (ctx) => { const b = ctx.args.base ?? 10; if (ctx.args.value <= 0 || b <= 0 || b === 1) throw new UserError('Value must be > 0 and base must be > 0 and ≠ 1.'); return ans(`log base ${fmt(b)} of ${fmt(ctx.args.value)} =`, fmt(Math.log(ctx.args.value) / Math.log(b))); });
  E(C, 'ratio', { description: 'Simplify a ratio A:B', options: [int('a', 'First', { min: 1, max: 1e9 }), int('b', 'Second', { min: 1, max: 1e9 })] }, (ctx) => { const g = gcd(ctx.args.a, ctx.args.b); return ans(`${ctx.args.a}:${ctx.args.b} simplifies to`, `${ctx.args.a / g}:${ctx.args.b / g}`); });

  // ------------------------------------------------------------------- math
  const M = registry.group({ name: 'math', description: 'Number theory and geometry', category: 'Calculators' });
  M.subgroup('geometry', 'Areas, volumes and triangles');
  const GM = (sub, spec, run) => E(M, sub, { subgroup: 'geometry', ...spec }, run);
  const pos = (n, d) => num(n, d, { min: 0.000001 });
  E(M, 'gcd', { description: 'Greatest common divisor', options: [int('a', 'First', { min: 1, max: 1e15 }), int('b', 'Second', { min: 1, max: 1e15 })] }, (ctx) => ans('GCD:', fmt(gcd(ctx.args.a, ctx.args.b))));
  E(M, 'lcm', { description: 'Least common multiple', options: [int('a', 'First', { min: 1, max: 1e7 }), int('b', 'Second', { min: 1, max: 1e7 })] }, (ctx) => ans('LCM:', fmt((ctx.args.a / gcd(ctx.args.a, ctx.args.b)) * ctx.args.b)));
  E(M, 'factorial', { description: 'n! (up to 500)', options: [int('n', '0-500', { min: 0, max: 500 })] }, (ctx) => { const s = bigFact(ctx.args.n).toString(); return `🧮 ${ctx.args.n}! = **${s.length > 1500 ? `${s.slice(0, 40)}… (${s.length} digits)` : s}**`; });
  E(M, 'isprime', { description: 'Is the number prime?', options: [int('n', 'Up to 1e14', { min: 0, max: 1e14 })] }, (ctx) => ctx.args.n >= 2 && isPrime(ctx.args.n) ? `✅ **${fmt(ctx.args.n)}** is prime.` : `❌ **${fmt(ctx.args.n)}** is not prime.`);
  E(M, 'factors', { description: 'Prime factorisation', options: [int('n', '2 to 1e14', { min: 2, max: 1e14 })] }, (ctx) => { const f = primeFactors(ctx.args.n); const c = new Map(); for (const p of f) c.set(p, (c.get(p) || 0) + 1); return ans(`${fmt(ctx.args.n)} =`, [...c].map(([p, k]) => (k > 1 ? `${p}^${k}` : p)).join(' × ')); });
  E(M, 'divisors', { description: 'All divisors of a number', options: [int('n', '1 to 1e12', { min: 1, max: 1e12 })] }, (ctx) => { const d = []; for (let i = 1; i * i <= ctx.args.n; i++) if (ctx.args.n % i === 0) { d.push(i); if (i * i !== ctx.args.n) d.push(ctx.args.n / i); } d.sort((a, b) => a - b); return `🧮 ${d.length} divisor(s): ${truncate(d.map(fmt).join(', '), 1500)}`; });
  E(M, 'fibonacci', { description: 'The Nth Fibonacci number', options: [int('n', '0-1000', { min: 0, max: 1000 })] }, (ctx) => { let a = 0n; let b = 1n; for (let i = 0; i < ctx.args.n; i++) [a, b] = [b, a + b]; const s = a.toString(); return `🧮 F(${ctx.args.n}) = **${s.length > 1500 ? `${s.slice(0, 40)}… (${s.length} digits)` : s}**`; });
  E(M, 'collatz', { description: 'Steps for the Collatz sequence to reach 1', options: [int('n', '1 to 1e9', { min: 1, max: 1e9 })] }, (ctx) => { let n = ctx.args.n; let steps = 0; let peak = n; while (n !== 1) { n = n % 2 ? 3 * n + 1 : n / 2; peak = Math.max(peak, n); steps++; } return `🧮 ${fmt(ctx.args.n)} reaches 1 in **${steps}** steps (peak ${fmt(peak)}).`; });
  E(M, 'digitsum', { description: 'Sum of digits', options: [int('n', 'Number', { min: 0, max: Number.MAX_SAFE_INTEGER })] }, (ctx) => ans('Digit sum:', [...String(ctx.args.n)].reduce((a, d) => a + Number(d), 0)));
  E(M, 'primes', { description: 'List primes up to N', options: [int('limit', '2 to 10000', { min: 2, max: 10000 })] }, (ctx) => { const p = []; for (let i = 2; i <= ctx.args.limit; i++) if (isPrime(i)) p.push(i); return `🧮 ${p.length} prime(s): ${truncate(p.join(', '), 1700)}`; });
  E(M, 'ncr', { description: 'Combinations nCr', options: [int('n', 'n (0-1000)', { min: 0, max: 1000 }), int('r', 'r', { min: 0, max: 1000 })] }, (ctx) => { if (ctx.args.r > ctx.args.n) throw new UserError('r cannot exceed n.'); return ans(`C(${ctx.args.n}, ${ctx.args.r}) =`, truncate(bigBinom(ctx.args.n, ctx.args.r).toString(), 1500)); });
  E(M, 'npr', { description: 'Permutations nPr', options: [int('n', 'n (0-1000)', { min: 0, max: 1000 }), int('r', 'r', { min: 0, max: 1000 })] }, (ctx) => { if (ctx.args.r > ctx.args.n) throw new UserError('r cannot exceed n.'); let r = 1n; for (let i = 0; i < ctx.args.r; i++) r *= BigInt(ctx.args.n - i); return ans(`P(${ctx.args.n}, ${ctx.args.r}) =`, truncate(r.toString(), 1500)); });
  E(M, 'quadratic', { description: 'Solve ax² + bx + c = 0', options: [num('a', 'a (not 0)'), num('b', 'b'), num('c', 'c')] }, (ctx) => {
    const { a, b, c } = ctx.args; if (a === 0) throw new UserError('`a` must not be 0 (that is a linear equation).');
    const d = b * b - 4 * a * c;
    if (d > 0) return `🧮 Two real roots: x₁ = **${fmt((-b + Math.sqrt(d)) / (2 * a))}**, x₂ = **${fmt((-b - Math.sqrt(d)) / (2 * a))}** (Δ = ${fmt(d)})`;
    if (d === 0) return `🧮 One real root: x = **${fmt(-b / (2 * a))}** (Δ = 0)`;
    return `🧮 Complex roots: x = **${fmt(-b / (2 * a))} ± ${fmt(Math.sqrt(-d) / (2 * a))}i** (Δ = ${fmt(d)})`;
  });
  E(M, 'arithmetic', { description: 'Arithmetic sequence: nth term and sum', options: [num('first', 'First term'), num('difference', 'Common difference'), int('n', 'Term count (1-1e6)', { min: 1, max: 1e6 })] }, (ctx) => { const { first, difference: d, n } = ctx.args; return `🧮 a₍${n}₎ = **${fmt(first + (n - 1) * d)}** • sum = **${fmt((n / 2) * (2 * first + (n - 1) * d))}**`; });
  E(M, 'geometric', { description: 'Geometric sequence: nth term and sum', options: [num('first', 'First term'), num('ratio', 'Common ratio'), int('n', 'Term count (1-1000)', { min: 1, max: 1000 })] }, (ctx) => { const { first, ratio: r, n } = ctx.args; const s = r === 1 ? first * n : (first * (1 - r ** n)) / (1 - r); return `🧮 a₍${n}₎ = **${fmt(first * r ** (n - 1))}** • sum = **${fmt(s)}**`; });
  E(M, 'roman', { description: 'Convert between Roman numerals and numbers', options: [{ name: 'value', type: 'string', description: 'A number (1-3999) or a Roman numeral', required: true, maxLength: 20 }] }, (ctx) => { const v = ctx.args.value.trim(); if (/^\d+$/.test(v)) { const n = Number(v); if (n < 1 || n > 3999) throw new UserError('Roman numerals cover 1 to 3999.'); return ans(`${n} =`, toRoman(n)); } return ans(`${v.toUpperCase()} =`, fromRoman(v)); });
  GM('hypotenuse', { description: 'Hypotenuse of a right triangle', options: [pos('a', 'Leg a'), pos('b', 'Leg b')] }, (ctx) => ans('Hypotenuse:', fmt(Math.hypot(ctx.args.a, ctx.args.b))));
  GM('circle', { description: 'Circle area and circumference from the radius', options: [pos('radius', 'Radius')] }, (ctx) => `⭕ area **${fmt(PI * ctx.args.radius ** 2)}** • circumference **${fmt(2 * PI * ctx.args.radius)}** • diameter **${fmt(2 * ctx.args.radius)}**`);
  GM('rectangle', { description: 'Rectangle area, perimeter and diagonal', options: [pos('width', 'Width'), pos('height', 'Height')] }, (ctx) => `▭ area **${fmt(ctx.args.width * ctx.args.height)}** • perimeter **${fmt(2 * (ctx.args.width + ctx.args.height))}** • diagonal **${fmt(Math.hypot(ctx.args.width, ctx.args.height))}**`);
  GM('triangle', { description: 'Triangle area and perimeter from three sides', options: [pos('a', 'Side a'), pos('b', 'Side b'), pos('c', 'Side c')] }, (ctx) => { const { a, b, c } = ctx.args; if (a + b <= c || a + c <= b || b + c <= a) throw new UserError('Those sides cannot form a triangle.'); const s = (a + b + c) / 2; return `△ area **${fmt(Math.sqrt(s * (s - a) * (s - b) * (s - c)))}** • perimeter **${fmt(a + b + c)}**`; });
  GM('sphere', { description: 'Sphere surface area and volume', options: [pos('radius', 'Radius')] }, (ctx) => `🔵 surface **${fmt(4 * PI * ctx.args.radius ** 2)}** • volume **${fmt((4 / 3) * PI * ctx.args.radius ** 3)}**`);
  GM('cylinder', { description: 'Cylinder surface area and volume', options: [pos('radius', 'Radius'), pos('height', 'Height')] }, (ctx) => { const { radius: r, height: h } = ctx.args; return `🥫 surface **${fmt(2 * PI * r * (r + h))}** • volume **${fmt(PI * r * r * h)}**`; });
  GM('cone', { description: 'Cone surface area and volume', options: [pos('radius', 'Radius'), pos('height', 'Height')] }, (ctx) => { const { radius: r, height: h } = ctx.args; return `🔺 surface **${fmt(PI * r * (r + Math.hypot(r, h)))}** • volume **${fmt((PI * r * r * h) / 3)}**`; });

  // ---------------------------------------------------------------- finance
  const F = registry.group({ name: 'finance', description: 'Everyday money maths (no financial advice)', category: 'Calculators' });
  const amount = (n, d) => num(n, d, { min: 0, max: 1e12 });
  E(F, 'tip', { description: 'Tip and total', options: [amount('bill', 'Bill amount'), num('percent', 'Tip % (default 15)', { required: false, min: 0, max: 100 })] }, (ctx) => { const p = ctx.args.percent ?? 15; const tip = (ctx.args.bill * p) / 100; return `💵 tip **${money(tip)}** (${p}%) • total **${money(ctx.args.bill + tip)}**`; });
  E(F, 'split', { description: 'Split a bill between people', options: [amount('total', 'Total'), int('people', 'People', { min: 1, max: 1000 }), num('tip', 'Tip % (default 0)', { required: false, min: 0, max: 100 })] }, (ctx) => { const t = ctx.args.total * (1 + (ctx.args.tip ?? 0) / 100); return `💵 each pays **${money(t / ctx.args.people)}** (total ${money(t)})`; });
  E(F, 'discount', { description: 'Price after a discount', options: [amount('price', 'Original price'), num('percent', 'Discount %', { min: 0, max: 100 })] }, (ctx) => { const save = (ctx.args.price * ctx.args.percent) / 100; return `🏷️ you save **${money(save)}** • pay **${money(ctx.args.price - save)}**`; });
  E(F, 'tax', { description: 'Add a sales tax / GST / VAT', options: [amount('price', 'Net price'), num('rate', 'Tax rate %', { min: 0, max: 100 })] }, (ctx) => { const t = (ctx.args.price * ctx.args.rate) / 100; return `🧾 tax **${money(t)}** • gross **${money(ctx.args.price + t)}**`; });
  E(F, 'untax', { description: 'Remove tax from a gross price', options: [amount('gross', 'Gross price'), num('rate', 'Tax rate %', { min: 0, max: 100 })] }, (ctx) => { const net = ctx.args.gross / (1 + ctx.args.rate / 100); return `🧾 net **${money(net)}** • tax **${money(ctx.args.gross - net)}**`; });
  E(F, 'simpleinterest', { description: 'Simple interest', options: [amount('principal', 'Principal'), num('rate', 'Annual rate %', { min: 0, max: 1000 }), num('years', 'Years', { min: 0, max: 1000 })] }, (ctx) => { const i = (ctx.args.principal * ctx.args.rate * ctx.args.years) / 100; return `💰 interest **${money(i)}** • total **${money(ctx.args.principal + i)}**`; });
  E(F, 'compound', { description: 'Compound interest', options: [amount('principal', 'Principal'), num('rate', 'Annual rate %', { min: 0, max: 1000 }), num('years', 'Years', { min: 0, max: 200 }), int('times', 'Times compounded per year (default 12)', { required: false, min: 1, max: 365 })] }, (ctx) => { const n = ctx.args.times ?? 12; const a = ctx.args.principal * (1 + ctx.args.rate / 100 / n) ** (n * ctx.args.years); if (!Number.isFinite(a)) throw new UserError('The result is too large.'); return `💰 final **${money(a)}** • growth **${money(a - ctx.args.principal)}**`; });
  E(F, 'emi', { description: 'Monthly loan instalment (EMI)', options: [amount('principal', 'Loan amount'), num('rate', 'Annual rate %', { min: 0, max: 100 }), int('months', 'Months (1-600)', { min: 1, max: 600 })] }, (ctx) => { const r = ctx.args.rate / 1200; const n = ctx.args.months; const emi = r === 0 ? ctx.args.principal / n : (ctx.args.principal * r * (1 + r) ** n) / ((1 + r) ** n - 1); return `🏦 EMI **${money(emi)}** • total paid **${money(emi * n)}** • interest **${money(emi * n - ctx.args.principal)}**`; });
  E(F, 'savings', { description: 'Future value of monthly deposits', options: [amount('monthly', 'Monthly deposit'), num('rate', 'Annual rate %', { min: 0, max: 100 }), num('years', 'Years', { min: 0, max: 100 })] }, (ctx) => { const i = ctx.args.rate / 1200; const m = Math.round(ctx.args.years * 12); const fv = i === 0 ? ctx.args.monthly * m : ctx.args.monthly * (((1 + i) ** m - 1) / i); return `🐖 you deposit **${money(ctx.args.monthly * m)}** → worth **${money(fv)}**`; });
  E(F, 'profit', { description: 'Profit and margin from cost and selling price', options: [amount('cost', 'Cost'), amount('sell', 'Selling price')] }, (ctx) => { const p = ctx.args.sell - ctx.args.cost; return `📈 profit **${money(p)}** • margin **${ctx.args.sell ? fmt((p / ctx.args.sell) * 100) : 0}%** • markup **${ctx.args.cost ? fmt((p / ctx.args.cost) * 100) : 0}%**`; });
  E(F, 'roi', { description: 'Return on investment', options: [amount('invested', 'Invested'), amount('returned', 'Final value')] }, (ctx) => { if (!ctx.args.invested) throw new UserError('Invested amount must be above zero.'); return `📈 ROI **${fmt(((ctx.args.returned - ctx.args.invested) / ctx.args.invested) * 100)}%**`; });
  E(F, 'cagr', { description: 'Compound annual growth rate', options: [num('start', 'Start value', { min: 0.000001 }), num('end', 'End value', { min: 0 }), num('years', 'Years', { min: 0.01, max: 200 })] }, (ctx) => ans('CAGR:', `${fmt(((ctx.args.end / ctx.args.start) ** (1 / ctx.args.years) - 1) * 100)}%`));
  E(F, 'inflation', { description: 'Value after inflation', options: [amount('amount', 'Amount today'), num('rate', 'Annual inflation %', { min: 0, max: 100 }), num('years', 'Years', { min: 0, max: 100 })] }, (ctx) => `📉 In ${ctx.args.years} year(s) you need **${money(ctx.args.amount * (1 + ctx.args.rate / 100) ** ctx.args.years)}** to buy what ${money(ctx.args.amount)} buys today.`);

  // ---------------------------------------------------------------- convert
  const V = registry.group({ name: 'convert', description: 'Unit conversion', category: 'Converters', aliases: ['conv'] });
  const valueOpt = num('value', 'Amount');
  for (const kind of Object.keys(UNITS)) {
    E(V, kind, { description: `Convert ${kind} (${Object.keys(UNITS[kind].u).join(', ')})`, options: [valueOpt, { name: 'from', type: 'string', description: 'From unit', required: true, maxLength: 10 }, { name: 'to', type: 'string', description: 'To unit', required: true, maxLength: 10 }] }, (ctx) => ans(`${fmt(ctx.args.value)} ${ctx.args.from.toLowerCase()} =`, `${fmt(convertUnits(kind, ctx.args.value, ctx.args.from, ctx.args.to))} ${ctx.args.to.toLowerCase()}`));
  }
  E(V, 'temperature', { description: 'Convert temperature (c, f, k, r)', aliases: ['temp'], options: [valueOpt, { name: 'from', type: 'string', description: 'c, f, k or r', required: true, choices: ['c', 'f', 'k', 'r'] }, { name: 'to', type: 'string', description: 'c, f, k or r', required: true, choices: ['c', 'f', 'k', 'r'] }] }, (ctx) => { const c = TEMP[ctx.args.from][0](ctx.args.value); if (c < -273.15 - 1e-9) throw new UserError('That is below absolute zero.'); return ans(`${fmt(ctx.args.value)}°${ctx.args.from.toUpperCase()} =`, `${fmt(TEMP[ctx.args.to][1](c))}°${ctx.args.to.toUpperCase()}`); });
  E(V, 'fuel', { description: 'Fuel economy (mpg, mpguk, kml, l100)', options: [num('value', 'Amount', { min: 0.000001 }), { name: 'from', type: 'string', description: 'Unit', required: true, choices: ['mpg', 'mpguk', 'kml', 'l100'] }, { name: 'to', type: 'string', description: 'Unit', required: true, choices: ['mpg', 'mpguk', 'kml', 'l100'] }] }, (ctx) => { const toKml = (u, v) => (u === 'l100' ? 100 / v : v * FUEL_TO_KML[u]); const fromKml = (u, k) => (u === 'l100' ? 100 / k : k / FUEL_TO_KML[u]); return ans(`${fmt(ctx.args.value)} ${ctx.args.from} =`, `${fmt(fromKml(ctx.args.to, toKml(ctx.args.from, ctx.args.value)))} ${ctx.args.to}`); });
  E(V, 'base', { description: 'Convert a number between bases 2-36', options: [{ name: 'number', type: 'string', description: 'The number', required: true, maxLength: 60 }, int('from', 'From base', { min: 2, max: 36 }), int('to', 'To base', { min: 2, max: 36 })] }, (ctx) => { const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, ctx.args.from); const s = ctx.args.number.toLowerCase().replace(/^0[xbo]/, ''); if (!s || ![...s].every((c) => digits.includes(c))) throw new UserError(`\`${safe(ctx.args.number)}\` is not a valid base-${ctx.args.from} number.`); let n = 0n; for (const c of s) n = n * BigInt(ctx.args.from) + BigInt(digits.indexOf(c)); return ans(`${s} (base ${ctx.args.from}) =`, `${n.toString(ctx.args.to)} (base ${ctx.args.to})`); });
  E(V, 'units', { description: 'List all supported unit names', options: [{ name: 'kind', type: 'string', description: 'Category', choices: Object.keys(UNITS) }] }, (ctx) => ctx.args.kind ? `**${ctx.args.kind}**: ${Object.keys(UNITS[ctx.args.kind].u).join(', ')}` : Object.entries(UNITS).map(([k, v]) => `**${k}**: ${Object.keys(v.u).join(', ')}`).join('\n'));
  E(V, 'duration', { description: 'Break seconds into days/hours/minutes', options: [int('seconds', 'Seconds', { min: 0, max: 1e10 })] }, (ctx) => { let s = ctx.args.seconds; const parts = []; for (const [n, u] of [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']]) { const q = Math.floor(s / n); s -= q * n; if (q) parts.push(`${q}${u}`); } return ans(`${fmt(ctx.args.seconds)} s =`, parts.join(' ') || '0s'); });
};
module.exports.convertUnits = convertUnits;
module.exports.UNITS = UNITS;

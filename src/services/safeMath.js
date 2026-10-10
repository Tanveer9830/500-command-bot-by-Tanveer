'use strict';
/** Safe arithmetic expression evaluator (recursive descent). No eval, no Function. */
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, ln: Math.log, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp, cbrt: Math.cbrt,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function evaluate(input) {
  const src = String(input).toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!src) throw new Error('Empty expression.');
  if (src.length > 200) throw new Error('Expression too long (max 200 characters).');
  let i = 0; let depth = 0;
  const peek = () => src[i];
  function number() {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length; return Number(m[0]);
  }
  function primary() {
    if (peek() === '(') {
      if (++depth > 50) throw new Error('Too deeply nested.');
      i++; const v = expr(); if (peek() !== ')') throw new Error('Missing closing parenthesis.'); i++; depth--; return v;
    }
    const n = number();
    if (n !== null) return n;
    const id = /^[a-z][a-z0-9]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      if (peek() === '(') {
        const fn = FUNCS[id[0]]; if (!fn) throw new Error(`Unknown function "${id[0]}".`);
        i++; const args = [];
        if (peek() !== ')') { do { args.push(expr()); } while (peek() === ',' && ++i); }
        if (peek() !== ')') throw new Error('Missing closing parenthesis.'); i++;
        return fn(...args);
      }
      if (id[0] in CONSTS) return CONSTS[id[0]];
      throw new Error(`Unknown name "${id[0]}".`);
    }
    throw new Error(`Unexpected "${peek() ?? 'end of input'}".`);
  }
  function unary() {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek() === '^') { i++; const exp = unary(); if (Math.abs(exp) > 1000) throw new Error('Exponent too large.'); return base ** exp; }
    if (peek() === '%' && !/^%[\d.(a-z]/.test(src.slice(i))) { i++; return base / 100; }
    return base;
  }
  function term() {
    let v = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[i++]; const r = unary();
      if (op === '*') v *= r; else if (op === '/') { if (r === 0) throw new Error('Division by zero.'); v /= r; } else v %= r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  const result = expr();
  if (i < src.length) throw new Error(`Unexpected "${src[i]}".`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number.');
  return result;
}

module.exports = { evaluate };

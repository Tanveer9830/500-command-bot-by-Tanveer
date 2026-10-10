'use strict';
/** Argument resolution shared by slash, prefix and internal invocations. */
const { UserError } = require('./errors');
const { parseDuration, formatDuration } = require('../utils/text');

const BOOL_TRUE = new Set(['true', 'yes', 'y', 'on', '1', 'enable', 'enabled']);
const BOOL_FALSE = new Set(['false', 'no', 'n', 'off', '0', 'disable', 'disabled']);

function usageOf(action, prefix = '!') {
  return `${prefix}${action.usage}`;
}

async function coerce(opt, raw, ctx, action) {
  const bad = (msg) => new UserError(`Invalid \`${opt.name}\`: ${msg}`, { hint: `Usage: ${usageOf(action, ctx.prefix || '!')}` });
  switch (opt.type) {
    case 'string': {
      let s = String(raw).trim();
      if (opt.choices) {
        const hit = opt.choices.map((c) => (typeof c === 'object' ? c : { name: String(c), value: c }))
          .find((c) => String(c.value).toLowerCase() === s.toLowerCase() || c.name.toLowerCase() === s.toLowerCase());
        if (!hit) throw bad(`choose one of ${opt.choices.map((c) => (typeof c === 'object' ? c.value : c)).join(', ')}`);
        return hit.value;
      }
      if (!opt.keepSpace) s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
      if (opt.minLength !== undefined && s.length < opt.minLength) throw bad(`at least ${opt.minLength} characters`);
      if (opt.maxLength !== undefined && s.length > opt.maxLength) throw bad(`at most ${opt.maxLength} characters`);
      if (opt.pattern && !opt.pattern.test(s)) throw bad(opt.patternHelp || 'invalid format');
      return s;
    }
    case 'integer':
    case 'number': {
      const s = typeof raw === 'number' ? raw : String(raw).trim().replace(/,/g, '');
      const n = typeof s === 'number' ? s : Number(s);
      if (typeof s === 'string' && (s === '' || !Number.isFinite(n))) throw bad('expected a number');
      if (opt.type === 'integer' && !Number.isSafeInteger(n)) throw bad('expected a whole number');
      if (!Number.isFinite(n)) throw bad('expected a number');
      if (opt.min !== undefined && n < opt.min) throw bad(`minimum is ${opt.min}`);
      if (opt.max !== undefined && n > opt.max) throw bad(`maximum is ${opt.max}`);
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).toLowerCase();
      if (BOOL_TRUE.has(s)) return true;
      if (BOOL_FALSE.has(s)) return false;
      throw bad('expected on/off, true/false or yes/no');
    }
    case 'duration': {
      const secs = typeof raw === 'number' ? raw : parseDuration(raw);
      if (secs === null || !Number.isFinite(secs)) throw bad('expected a duration such as 30m, 2h or 1d');
      if (opt.min !== undefined && secs < opt.min) throw bad(`minimum is ${formatDuration(opt.min)}`);
      if (opt.max !== undefined && secs > opt.max) throw bad(`maximum is ${formatDuration(opt.max)}`);
      return secs;
    }
    case 'user': case 'channel': case 'role': {
      if (raw && typeof raw === 'object' && raw.id) return raw;
      const found = ctx.lookup && ctx.lookup[opt.type] ? await ctx.lookup[opt.type](String(raw)) : null;
      if (!found) throw bad(`could not find that ${opt.type}`);
      return found;
    }
    default: throw new Error(`unsupported option type ${opt.type}`);
  }
}

/** Gather raw option values from the invocation source. */
function gather(action, ctx) {
  const input = ctx.input || { kind: 'values', values: {} };
  if (input.kind === 'values') return { raw: { ...input.values }, extra: [] };
  if (input.kind === 'slash') {
    const raw = {};
    for (const o of action.options) {
      const opt = input.options.get(o.name, false);
      if (!opt) continue;
      raw[o.name] = o.type === 'user' ? opt.user : o.type === 'channel' ? opt.channel : o.type === 'role' ? opt.role : opt.value;
    }
    return { raw, extra: [] };
  }
  // prefix
  const tokens = input.tokens;
  const raw = {};
  let i = 0;
  for (const o of action.options) {
    if (i >= tokens.length) break;
    if (o.rest) {
      let text = input.raw.slice(tokens[i].start).trim();
      if (tokens.length - i === 1 && tokens[i].quoted) text = tokens[i].value;
      raw[o.name] = text; i = tokens.length;
    } else { raw[o.name] = tokens[i].value; i++; }
  }
  return { raw, extra: tokens.slice(i) };
}

async function resolveArgs(action, ctx) {
  const { raw, extra } = gather(action, ctx);
  const usage = `Usage: ${usageOf(action, ctx.prefix || '!')}`;
  if (extra.length) throw new UserError(`Too many arguments (unexpected \`${extra[0].value}\`).`, { hint: usage });
  const args = {};
  for (const opt of action.options) {
    const v = raw[opt.name];
    if (v === undefined || v === null || v === '') {
      if (opt.required) throw new UserError(`Missing required argument \`${opt.name}\`.`, { hint: usage });
      if (opt.default !== undefined) args[opt.name] = opt.default;
      continue;
    }
    args[opt.name] = await coerce(opt, v, ctx, action);
  }
  return args;
}

module.exports = { resolveArgs, coerce, usageOf };

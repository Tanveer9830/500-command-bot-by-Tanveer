'use strict';
/** Generates valid-looking values for an action's required options (used by the smoke test and inventory). */
function clamp(n, min, max) { if (min !== undefined && n < min) n = min; if (max !== undefined && n > max) n = max; return n; }

function sampleFor(opt, env) {
  switch (opt.type) {
    case 'user': return env.victim.user;
    case 'channel': return env.textChannel;
    case 'role': return env.roles.find((r) => r.name === 'bot-role' ? false : r.position === 1) || env.mkRole('sample-role', 1);
    case 'boolean': return true;
    case 'integer': case 'number': return clamp(opt.default !== undefined ? opt.default : 5, opt.min, opt.max);
    case 'duration': return clamp(600, opt.min, opt.max);
    default: {
      if (opt.choices && opt.choices.length) { const c = opt.choices[0]; return typeof c === 'object' ? c.value : c; }
      if (opt.sample !== undefined) return opt.sample;
      let s = 'sample';
      if (opt.minLength) s = s.padEnd(opt.minLength, 'x');
      if (opt.maxLength) s = s.slice(0, opt.maxLength);
      return s;
    }
  }
}

function autoValues(action, env, { all = false } = {}) {
  const values = {};
  for (const opt of action.options) if (all || opt.required) values[opt.name] = sampleFor(opt, env);
  return values;
}

module.exports = { autoValues, sampleFor };

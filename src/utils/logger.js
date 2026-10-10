'use strict';
/** Small structured logger: JSON lines under journald/non-TTY, readable lines on a TTY. Secrets are redacted. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;
let secrets = [];

const TOKEN_RE = /[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/g;

function setLevel(name) { threshold = LEVELS[name] ?? LEVELS.info; }
function setSecrets(list) { secrets = (list || []).filter(Boolean); }

function redact(input) {
  let s = typeof input === 'string' ? input : safeStringify(input);
  for (const secret of secrets) s = s.split(secret).join('[REDACTED]');
  return s.replace(TOKEN_RE, '[REDACTED_TOKEN]');
}

function safeStringify(v) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(v, (k, val) => {
      if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack };
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) { if (seen.has(val)) return '[Circular]'; seen.add(val); }
      return val;
    });
  } catch { return String(v); }
}

function write(level, scope, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  const ts = new Date().toISOString();
  if (process.stdout.isTTY && !process.env.LOG_JSON) {
    const extra = fields && Object.keys(fields).length ? ` ${redact(fields)}` : '';
    stream.write(`${redact(`${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`)}${extra}\n`);
  } else {
    stream.write(`${redact({ ts, level, scope, msg, ...fields })}\n`);
  }
}

function child(scope) {
  return {
    debug: (m, f) => write('debug', scope, m, f),
    info: (m, f) => write('info', scope, m, f),
    warn: (m, f) => write('warn', scope, m, f),
    error: (m, f) => write('error', scope, m, f),
    child: (s) => child(`${scope}:${s}`),
  };
}

module.exports = { ...child('app'), child, setLevel, setSecrets, redact };

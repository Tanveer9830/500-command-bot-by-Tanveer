'use strict';
/**
 * Installer tests. The real install.sh / update.sh / tanveer-prime-ctl run end-to-end, but every command that would
 * touch the host (apt-get, useradd, systemctl, journalctl, chown, npm, firewall tools) is a logging stub on PATH,
 * paths are redirected into a temp dir, and a local HTTP server plays the Discord API. This proves the script's own
 * logic; it does NOT prove an install on a real Ubuntu VPS (see README "Verification status").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const { spawnSync, execFileSync } = require('node:child_process');
const b = require('../src/utils/branding');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = `MTIzNDU2Nzg5MDEyMzQ1Njc4.GabcDE.${'x'.repeat(40)}_SECRETTAIL`;
const shA = (args, opts = {}) => new Promise((resolve) => {
  const { timeout, ...rest } = opts; const p = require('node:child_process').spawn('bash', args, { cwd: ROOT, ...rest });
  let stdout = ''; let stderr = ''; p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  const timer = timeout ? setTimeout(() => p.kill('SIGKILL'), timeout) : null;
  p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
});
const sh = (args, opts = {}) => spawnSync('bash', args, { encoding: 'utf8', cwd: ROOT, ...opts });

test('every shell script passes bash -n and the installer is in sync with branding.js', () => {
  for (const f of ['install.sh', 'update.sh', 'uninstall.sh', 'deploy/lib.sh', 'deploy/tanveer-prime-ctl', 'deploy/install.body.sh']) {
    const r = sh(['-n', f]); assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const r = spawnSync('node', ['scripts/sync-installer.js', '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
});

test('installer logo and panel are byte-identical to branding.js (unicode and ASCII), with NO_COLOR and narrow fallbacks', () => {
  const run = (env, fn) => sh(['-c', `source deploy/lib.sh; tp_ui_init; ${fn}`], { env: { PATH: process.env.PATH, ...env } }).stdout;
  const uni = run({ LANG: 'en_US.UTF-8', COLUMNS: '120', NO_COLOR: '1' }, 'tp_logo; tp_panel');
  assert.equal(uni.trimEnd(), `${b.renderLogo({ color: false, unicode: true, columns: 200 })}\n${b.renderPanel({ color: false, unicode: true, columns: 200 })}`);
  const asc = run({ LANG: 'C', COLUMNS: '120' }, 'tp_logo; tp_panel');
  assert.equal(asc.trimEnd(), `${b.renderLogo({ color: false, unicode: false, columns: 200 })}\n${b.renderPanel({ color: false, unicode: false, columns: 200 })}`);
  assert.ok(!/\u001b/.test(uni) && !/\u001b/.test(asc), 'no escape codes when not a TTY / NO_COLOR');
  const narrow = run({ LANG: 'en_US.UTF-8', COLUMNS: '40', NO_COLOR: '1' }, 'tp_logo; tp_panel; tp_signature');
  assert.ok(narrow.split('\n').every((l) => [...l].length <= 40), 'nothing wider than 40 columns');
  assert.match(narrow, /TANVEER PRIME/); assert.match(narrow, /MADE BY TANVEER/);
  const colored = run({ LANG: 'en_US.UTF-8', COLUMNS: '120', FORCE_COLOR: '1', TERM: 'xterm' }, 'tp_logo');
  assert.ok(/\u001b\[1;38;5;45m/.test(colored) && /\u001b\[1;38;5;33m/.test(colored) && /\u001b\[1;38;5;99m/.test(colored), 'cyan, blue and violet gradient');
  assert.ok(!/38;5;41m/.test(colored), 'green is not used in the logo');
});

test('invite permission integer is identical in the bot, dashboard, installer and is not Administrator', () => {
  const { PermissionsBitField } = require('discord.js');
  const { INVITE_PERMS } = require('../src/commands/general'); const { INVITE_PERMISSIONS } = require('../src/constants');
  const bits = new PermissionsBitField(INVITE_PERMS);
  assert.equal(bits.bitfield.toString(), INVITE_PERMISSIONS); assert.ok(!bits.has('Administrator'));
  assert.match(fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8'), new RegExp(`TP_INVITE_PERMS:-${INVITE_PERMISSIONS}`));
  assert.ok(!/permissions=8\b/.test(fs.readFileSync(path.join(ROOT, 'src/dashboard/server.js'), 'utf8')));
});

test('dry run checks the system and changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-dry-'));
  const r = sh(['install.sh'], { env: { ...process.env, TP_DRY_RUN: '1', TP_APP_DIR: path.join(dir, 'app'), TP_CONF_DIR: path.join(dir, 'etc'), NO_COLOR: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DRY RUN COMPLETE/); assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------------------------- full simulated install/update
function makeSourceRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of ['src', 'scripts', 'deploy', 'dashboard', 'docs', 'package.json', 'package-lock.json', 'install.sh', 'update.sh', 'uninstall.sh']) execFileSync('cp', ['-r', path.join(ROOT, entry), dir]);
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'initial'); return git;
}

function makeStubs(dir, logFile) {
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 }); };
  const rec = `echo "${'$'}(basename "${'$'}0") ${'$'}*" >> "${logFile}"`;
  for (const n of ['apt-get', 'useradd', 'chown', 'ufw', 'iptables', 'nft', 'firewall-cmd', 'gpg']) stub(n, rec);
  stub('systemctl', `${rec}\ncase "$1" in is-active) exit 0;; esac\nexit 0`);
  stub('journalctl', `${rec}\necho '{"level":"info","msg":"connected to Discord"}'`);
  stub('install', 'args=(); skip=0; for a in "$@"; do if [ $skip = 1 ]; then skip=0; continue; fi; case "$a" in -o|-g) skip=1;; *) args+=("$a");; esac; done; exec /usr/bin/install "${args[@]}"');
  stub('npm', `${rec}\nmkdir -p node_modules && cp -as "${path.join(ROOT, 'node_modules')}/." node_modules/ 2>/dev/null; exit 0`);
  return bin;
}

function fakeDiscord() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.url === '/users/@me' && req.headers.authorization === `Bot ${TOKEN}`) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: '123456789012345678', username: 'PrimeBot' })); }
    else { res.statusCode = 401; res.end('{}'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('simulated install → update → management CLI', { timeout: 240_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-inst-'));
  const log = path.join(dir, 'calls.log'); fs.writeFileSync(log, '');
  const src = path.join(dir, 'source'); const git = makeSourceRepo(src);
  const bin = makeStubs(dir, log); const api = await fakeDiscord();
  t.after(() => { api.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NO_COLOR: '1', LANG: 'en_US.UTF-8', COLUMNS: '100',
    TP_ALLOW_NON_ROOT: '1', TP_REPO_URL: `file://${src}`, TP_APP_DIR: path.join(dir, 'opt'), TP_DATA_DIR: path.join(dir, 'var'), TP_CONF_DIR: path.join(dir, 'etc'),
    TP_ENV_FILE: path.join(dir, 'etc', 'tanveer-prime.env'), TP_UNIT_FILE: path.join(dir, 'tanveer-prime.service'), TP_BIN: path.join(dir, 'tanveer-prime'),
    TP_CONF_FILE: path.join(dir, 'etc', 'install.conf'), TP_DISCORD_API: api.url, DISCORD_TOKEN: TOKEN, TP_MIN_DISK_MB: '10', DISCORD_CLIENT_ID: '' };
  delete env.TP_ENV_FILE_UNUSED;

  // ---- first install
  let r = await shA(['install.sh'], { env, timeout: 200_000 });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.ok(!out.includes(TOKEN) && !out.includes('SECRETTAIL'), 'token never printed');
  assert.match(out, /Discord accepted the token \(bot user: PrimeBot\)/);
  assert.match(out, /connected to Discord/);
  assert.match(out, /client_id=123456789012345678&scope=bot%20applications.commands&permissions=1100454685783/);
  assert.match(out, /MADE BY TANVEER \| DISCORD: TANVEER5637/);
  assert.match(out, /did not open|I have not rebooted/);

  const envFile = env.TP_ENV_FILE; assert.equal((fs.statSync(envFile).mode & 0o777).toString(8), '600');
  const envText = fs.readFileSync(envFile, 'utf8');
  assert.ok(envText.includes(`DISCORD_TOKEN="${TOKEN}"`)); assert.match(envText, /DISCORD_CLIENT_ID="123456789012345678"/); assert.match(envText, /SESSION_SECRET="[0-9a-f]{64}"/);
  assert.match(envText, /DASHBOARD_HOST="127.0.0.1"/);
  const unit = fs.readFileSync(env.TP_UNIT_FILE, 'utf8');
  assert.ok(!/@[A-Z_]+@/.test(unit), 'all placeholders rendered'); assert.match(unit, /EnvironmentFile=.*tanveer-prime.env/); assert.match(unit, /RestartPreventExitStatus=78/);
  assert.ok(fs.existsSync(path.join(env.TP_DATA_DIR, 'tanveer-prime.sqlite')), 'migrations ran');
  assert.ok(fs.existsSync(env.TP_BIN) && (fs.statSync(env.TP_BIN).mode & 0o111));
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /useradd --system .*--shell \/usr\/sbin\/nologin tanveer-prime/);
  assert.match(calls, /systemctl enable tanveer-prime/); assert.match(calls, /systemctl restart tanveer-prime/); assert.match(calls, /npm ci --omit=dev/);
  assert.ok(!/ufw|iptables|nft|firewall-cmd/.test(calls), 'never touches the firewall');
  assert.ok(!/root/.test(unit.match(/^User=.*/m)[0]), 'service does not run as root');
  const db = require('better-sqlite3')(path.join(env.TP_DATA_DIR, 'tanveer-prime.sqlite'), { readonly: true });
  assert.ok(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n >= 3); db.close();

  // ---- a bad token is rejected, retried never silently accepted
  const bad = await shA(['install.sh'], { env: { ...env, TP_RECONFIGURE: '1', DISCORD_TOKEN: `${TOKEN}zz` }, timeout: 60_000 });
  assert.notEqual(bad.status, 0); assert.match(bad.stdout + bad.stderr, /rejected/);
  assert.equal(fs.readFileSync(envFile, 'utf8'), envText, 'a failed reconfigure never clobbers the working config');

  // ---- re-running detects the install and routes to the updater (nothing new yet)
  r = await shA(['install.sh'], { env, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /Existing installation found/); assert.match(r.stdout, /Already up to date/);

  // ---- a new commit is applied by update.sh, with a database backup first and the DB preserved
  const dbBefore = fs.readFileSync(path.join(env.TP_DATA_DIR, 'tanveer-prime.sqlite'));
  fs.appendFileSync(path.join(src, 'docs', 'CHANGELOG-test.md'), 'update test\n'); git('add', '-A'); git('commit', '-q', '-m', 'second');
  r = await shA(['update.sh'], { env, cwd: env.TP_APP_DIR, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /Updated to [0-9a-f]+ and connected to Discord/); assert.match(r.stdout, /second/);
  assert.ok(fs.existsSync(path.join(env.TP_APP_DIR, 'docs', 'CHANGELOG-test.md')));
  assert.ok(fs.readdirSync(path.join(env.TP_DATA_DIR, 'backups')).some((f) => f.startsWith('manual-')), 'pre-update backup exists');
  assert.ok(fs.statSync(path.join(env.TP_DATA_DIR, 'tanveer-prime.sqlite')).size >= dbBefore.length - 4096, 'database kept');

  // ---- an update whose dependency install fails rolls back
  fs.appendFileSync(path.join(src, 'docs', 'CHANGELOG-test.md'), 'third\n'); git('add', '-A'); git('commit', '-q', '-m', 'third');
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/bash\necho "npm $*" >> "' + log + '"\nexit 1\n', { mode: 0o755 });
  const head = execFileSync('git', ['-C', env.TP_APP_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  r = await shA(['update.sh'], { env, cwd: env.TP_APP_DIR, timeout: 120_000 });
  assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /Rolling back/);
  assert.equal(execFileSync('git', ['-C', env.TP_APP_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), head, 'code rolled back to the previous commit');

  // ---- management CLI
  const ctl = (...a) => sh([env.TP_BIN, ...a], { env: { ...env, TP_CONF_FILE: env.TP_CONF_FILE } });
  assert.match(ctl('invite').stdout, /client_id=123456789012345678/);
  assert.match(ctl('version').stdout, /TANVEER PRIME v1\.0\.0/);
  assert.match(ctl('help').stdout, /tanveer-prime update/);
  assert.equal(ctl('bogus').status, 2);
});

test('uninstall keeps the database and configuration', { timeout: 60_000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-un-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls.log'); fs.writeFileSync(log, ''); const bin = makeStubs(dir, log);
  const app = path.join(dir, 'opt'); fs.mkdirSync(app); fs.cpSync(path.join(ROOT, 'deploy'), path.join(app, 'deploy'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'uninstall.sh'), path.join(app, 'uninstall.sh'));
  const data = path.join(dir, 'var'); fs.mkdirSync(data); fs.writeFileSync(path.join(data, 'tanveer-prime.sqlite'), 'db');
  fs.mkdirSync(path.join(dir, 'etc')); fs.writeFileSync(path.join(dir, 'etc', 'tanveer-prime.env'), 'DISCORD_TOKEN="x"\n'); fs.writeFileSync(path.join(dir, 'unit.service'), 'x'); fs.writeFileSync(path.join(dir, 'ctl'), 'x');
  const r = sh([path.join(app, 'uninstall.sh'), '--yes'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NO_COLOR: '1', TP_ALLOW_NON_ROOT: '1', TP_CONF_FILE: '/nonexistent', TP_APP_DIR: app, TP_DATA_DIR: data, TP_ENV_FILE: path.join(dir, 'etc', 'tanveer-prime.env'), TP_UNIT_FILE: path.join(dir, 'unit.service'), TP_BIN: path.join(dir, 'ctl') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(data, 'tanveer-prime.sqlite')), 'database kept'); assert.ok(fs.existsSync(path.join(dir, 'etc', 'tanveer-prime.env')), 'config kept');
  assert.ok(!fs.existsSync(app) && !fs.existsSync(path.join(dir, 'unit.service')) && !fs.existsSync(path.join(dir, 'ctl')));
});

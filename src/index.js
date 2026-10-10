'use strict';
/** TANVEER PRIME — process entry point. MADE BY TANVEER | DISCORD: TANVEER5637 */
const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');
const branding = require('./utils/branding');
const database = require('./database');
const { buildRegistry } = require('./commands');
const { createServices } = require('./services');
const { createExecutor } = require('./core/executor');
const { Scheduler } = require('./services/scheduler');
const { registerCommands } = require('./services/registerCommands');
const { registerEvents } = require('./events');

const log = logger.child('main');
const EX_CONFIG = 78; // systemd unit uses RestartPreventExitStatus=78: a bad config must not crash-loop

function makeClient(cfg, { messageContent = cfg.intents.messageContent, guildMembers = cfg.intents.guildMembers } = {}) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildModeration, GatewayIntentBits.DirectMessages];
  if (messageContent) intents.push(GatewayIntentBits.MessageContent);
  if (guildMembers) intents.push(GatewayIntentBits.GuildMembers);
  return new Client({
    intents,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
    allowedMentions: { parse: [], repliedUser: false },
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 100, ReactionManager: 0 }),
    sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 1800 } },
  });
}

/** Assemble everything except the network connection. Used by the bot, scripts and tests. */
function buildApp(cfg, { client = null } = {}) {
  const db = database.open(cfg.dbPath);
  const migration = database.migrate(db, { dbPath: cfg.dbPath, backupDir: cfg.backupDir });
  const registry = buildRegistry();
  const svc = createServices({ db, config: cfg, registry, client });
  registry.bindExecutor(createExecutor({ services: svc, rateLimiter: svc.rateLimiter }));
  const name = db.prepare("SELECT value FROM global_state WHERE key = 'bot_name'").get();
  if (name) svc.bot.name = name.value;
  svc.registerCommands = () => registerCommands({ registry, config: cfg, db, force: true });
  return { db, registry, svc, migration };
}

async function main() {
  const { config: cfg, errors, warnings } = config.load();
  logger.setLevel(cfg.logLevel);
  if (errors.length) {
    branding.print(branding.errorBanner('CONFIGURATION ERROR', errors.map((e) => `• ${e}`).concat(['', 'Edit the env file (see README) and run: sudo systemctl restart tanveer-prime'])));
    process.exit(EX_CONFIG);
  }
  logger.setSecrets(config.secretValues(cfg));
  branding.print(branding.compactBanner(cfg.botName));
  for (const w of warnings) log.warn(w);

  let intents = { messageContent: cfg.intents.messageContent, guildMembers: cfg.intents.guildMembers };
  let client = makeClient(cfg, intents);
  const app = buildApp(cfg, { client });
  if (app.migration.applied.length) log.info('migrations applied', { applied: app.migration.applied });
  const { svc, registry, db } = app;
  svc.music.attach(client);

  const scheduler = new Scheduler({ svc }); svc.scheduler = scheduler;
  let dashboard = null;
  const onReady = async () => {
    scheduler.start();
    try {
      const r = await registerCommands({ registry, config: cfg, db, force: false });
      log.info(r.skipped ? 'slash commands already up to date' : 'slash commands registered', { count: r.count, scope: r.scope });
    } catch (e) { log.error('slash registration failed (the bot keeps running; run `npm run register` to retry)', { err: e }); }
    if (cfg.dashboard.enabled && !dashboard) {
      try { const { createDashboard } = require('./dashboard/server'); dashboard = createDashboard({ svc, client, config: cfg }); await dashboard.start(); } catch (e) { log.error('dashboard failed to start', { err: e }); }
    }
  };
  registerEvents({ client, svc, registry, onReady });

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return; stopping = true; log.info('shutting down', { signal });
    try { scheduler.stop(); if (dashboard) await dashboard.stop(); await client.destroy(); db.close(); } catch (e) { log.error('shutdown error', { err: e }); }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e }));
  process.on('uncaughtException', (e) => { log.fatal ? log.fatal('uncaught exception', { err: e }) : log.error('uncaught exception', { err: e }); process.exit(1); });

  try { await client.login(cfg.token); } catch (err) {
    const msg = String(err && err.message);
    if (/disallowed intents|used disallowed/i.test(msg) || err.code === 'DisallowedIntents') {
      log.warn('Discord rejected the privileged intents. Retrying without Message Content and Server Members. Prefix commands, XP, automod, autoresponders and welcome messages need them: enable them in the Developer Portal (Bot → Privileged Gateway Intents).');
      await client.destroy().catch(() => {});
      intents = { messageContent: false, guildMembers: false };
      client = makeClient(cfg, intents); svc.client = client; svc.music.attach(client);
      registerEvents({ client, svc, registry, onReady });
      try { await client.login(cfg.token); } catch (e2) { log.error('login failed', { err: e2 }); process.exit(1); }
    } else {
      log.error('login failed — check DISCORD_TOKEN', { reason: /token/i.test(msg) ? 'invalid token' : msg });
      process.exit(1);
    }
  }
}

module.exports = { buildApp, makeClient, EX_CONFIG };
if (require.main === module) main().catch((e) => { log.error('fatal startup error', { err: e }); process.exit(1); });

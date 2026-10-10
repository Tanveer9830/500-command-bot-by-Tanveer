'use strict';
/**
 * Builds the invocation context handed to the executor, and delivers outcomes back to Discord.
 * The same executor serves slash commands, prefix commands and buttons.
 */
const { toPayload, toInteractionPayload, NO_MENTIONS } = require('./reply');
const { MessageFlags } = require('discord.js');
const log = require('../utils/logger').child('ctx');

const idFrom = (s, re) => { const m = re.exec(s); if (m) return m[1]; return /^\d{15,25}$/.test(s) ? s : null; };
const norm = (s) => String(s).replace(/^[@#]/, '').toLowerCase();

/** Resolvers used to turn text such as "<@123>", "123" or a plain name into users/channels/roles. */
function makeLookups(client, guild) {
  return {
    user: async (s) => {
      const id = idFrom(s, /^<@!?(\d+)>$/);
      if (id) return client.users.fetch(id).catch(() => null);
      if (guild) { const q = norm(s); const m = guild.members.cache.find((x) => x.user.username.toLowerCase() === q || (x.displayName || '').toLowerCase() === q); if (m) return m.user; }
      return null;
    },
    channel: async (s) => {
      if (!guild) return null;
      const id = idFrom(s, /^<#(\d+)>$/);
      if (id) return guild.channels.cache.get(id) || guild.channels.fetch(id).catch(() => null);
      const q = norm(s); return guild.channels.cache.find((c) => c.name && c.name.toLowerCase() === q) || null;
    },
    role: async (s) => {
      if (!guild) return null;
      const id = idFrom(s, /^<@&(\d+)>$/);
      if (id) return guild.roles.cache.get(id) || null;
      const q = norm(s); return guild.roles.cache.find((r) => r.name.toLowerCase() === q && r.id !== guild.id) || null;
    },
  };
}

async function memberOf(guild, user) {
  if (!guild) return null;
  return guild.members.cache.get(user.id) || guild.members.fetch(user.id).catch(() => null);
}

async function baseContext({ client, guild, channel, user, member, source, input, prefix }) {
  const m = member || await memberOf(guild, user);
  return {
    source, client, guild: guild || null, guildId: guild ? guild.id : null, channel, user, member: m, input, prefix,
    lookup: makeLookups(client, guild),
    getMember: (u) => memberOf(guild, u),
    voiceChannelId: m && m.voice ? m.voice.channelId : null,
  };
}

/** Text shown when an action did not run. */
function failureText(outcome) {
  const icon = { usage: '⚠️', denied: '⛔', cooldown: '⏳', ratelimited: '⏳', error: '❌' }[outcome.status] || '⚠️';
  return `${icon} ${outcome.message}${outcome.hint ? `\n${outcome.hint}` : ''}`;
}

/** Convert an outcome into { payload, ephemeral }. */
function render(outcome, { forceEphemeral = false } = {}) {
  if (outcome.status !== 'ok') return { payload: toPayload({ content: failureText(outcome) }), ephemeral: true };
  const payload = toPayload(outcome.result);
  return { payload, ephemeral: forceEphemeral || Boolean(payload.ephemeral) };
}

/**
 * Respond to an interaction. If the action is slow we defer after 2s (Discord requires an ack within 3s).
 * Returns the outcome promise's result.
 */
async function respondInteraction(interaction, run, { forceEphemeral = false } = {}) {
  let deferred = false; let settled = false;
  const timer = setTimeout(async () => {
    if (settled || interaction.replied || interaction.deferred) return;
    deferred = true;
    try { await interaction.deferReply(); } catch (e) { deferred = false; log.debug('defer failed', { err: e.message }); }
  }, 2000);
  let outcome;
  try { outcome = await run(); } finally { settled = true; clearTimeout(timer); }
  const { payload, ephemeral } = render(outcome, { forceEphemeral });
  const body = { ...payload }; delete body.ephemeral; delete body.flags;
  try {
    if (deferred) {
      if (ephemeral) { await interaction.deleteReply().catch(() => {}); await interaction.followUp({ ...body, flags: MessageFlags.Ephemeral }); } else await interaction.editReply(body);
    } else {
      await interaction.reply(ephemeral ? { ...body, flags: MessageFlags.Ephemeral } : body);
    }
  } catch (e) { log.warn('interaction reply failed', { err: e.message }); }
  return outcome;
}

/** Reply to a prefix command message. Ephemeral results go to the user's DMs because messages cannot be hidden. */
async function respondMessage(message, outcome, svc) {
  const { payload, ephemeral } = render(outcome);
  const body = { ...payload }; delete body.ephemeral; delete body.flags;
  try {
    if (ephemeral && outcome.status === 'ok') {
      const ok = await svc.dm(message.author.id, body);
      if (ok) { await message.react('📬').catch(() => {}); return; }
      await message.reply({ content: '📪 That result is private and I could not DM you. Enable DMs from this server, or use the slash command.', allowedMentions: NO_MENTIONS });
      return;
    }
    await message.reply({ ...body, allowedMentions: NO_MENTIONS });
  } catch (e) {
    log.debug('message reply failed', { err: e.message });
    try { if (message.channel && message.channel.send) await message.channel.send({ ...body, allowedMentions: NO_MENTIONS }); } catch { /* cannot send here */ }
  }
}

module.exports = { makeLookups, memberOf, baseContext, failureText, render, respondInteraction, respondMessage, toInteractionPayload };

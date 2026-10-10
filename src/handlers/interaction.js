'use strict';
/** Slash-command and button handling. Everything is routed to the shared registry/executor. */
const { baseContext, respondInteraction } = require('../core/context');
const log = require('../utils/logger').child('interaction');

/** Map a slash interaction to a registered action. */
function actionForSlash(registry, i) {
  const sub = i.options.getSubcommand(false);
  if (!sub) return registry.standaloneActions.get(i.commandName) || null;
  const grp = i.options.getSubcommandGroup(false);
  return registry.get([i.commandName, grp, sub].filter(Boolean).join('.')) || null;
}

/** Button custom IDs are `tp:<kind>:<args>`; each maps to an ordinary action so the same authorization applies. */
function actionForButton(customId) {
  const p = String(customId).split(':');
  if (p[0] !== 'tp') return null;
  switch (p[1]) {
    case 'poll': { const id = Number(p[2]); const idx = Number(p[3]); return Number.isInteger(id) && Number.isInteger(idx) ? { key: 'poll.vote', values: { id, option: idx + 1 } } : null; }
    case 'gw': { const id = Number(p[2]); return Number.isInteger(id) ? { key: 'giveaway.enter', values: { id } } : null; }
    case 'ticket': return p[2] === 'open' ? { key: 'ticket.open', values: {} } : p[2] === 'close' ? { key: 'ticket.close', values: {} } : null;
    case 'verify': return { key: 'verify.me', values: {} };
    default: return null;
  }
}

function createInteractionHandler({ client, svc, registry }) {
  return async function onInteraction(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const action = actionForSlash(registry, interaction);
        if (!action) return interaction.reply({ content: '⚠️ That command is not available any more. It may take a moment for Discord to refresh its list.', flags: 64 }).catch(() => {});
        const channel = interaction.channel || (interaction.channelId ? await client.channels.fetch(interaction.channelId).catch(() => null) : null);
        const guild = interaction.guild || null;
        const ctx = await baseContext({ client, guild, channel, user: interaction.user, member: interaction.inCachedGuild() ? interaction.member : null, source: 'slash', input: { kind: 'slash', options: interaction.options }, prefix: '/' });
        return void await respondInteraction(interaction, () => action.execute(ctx));
      }
      if (interaction.isButton() && interaction.customId.startsWith('tp:')) {
        const target = actionForButton(interaction.customId);
        const action = target && registry.get(target.key);
        if (!action) return interaction.reply({ content: '⚠️ This button is no longer valid.', flags: 64 }).catch(() => {});
        const channel = interaction.channel || null;
        const ctx = await baseContext({ client, guild: interaction.guild || null, channel, user: interaction.user, member: interaction.inCachedGuild() ? interaction.member : null, source: 'button', input: { kind: 'values', values: target.values }, prefix: '/' });
        return void await respondInteraction(interaction, () => action.execute(ctx), { forceEphemeral: true });
      }
    } catch (err) {
      log.error('interaction handler failed', { err });
      try {
        const body = { content: '❌ Something went wrong. Please try again.', flags: 64 };
        if (interaction.deferred || interaction.replied) await interaction.followUp(body); else await interaction.reply(body);
      } catch { /* interaction expired */ }
    }
  };
}

module.exports = { createInteractionHandler, actionForSlash, actionForButton };

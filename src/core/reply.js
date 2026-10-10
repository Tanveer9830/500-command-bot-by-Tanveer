'use strict';
/**
 * Normalises handler results into Discord message payloads.
 * Handlers return: string | { content, embed|embeds, buttons, ephemeral, files } | undefined.
 * Every outgoing payload gets allowedMentions = none, so nothing can ping anyone.
 */
const { ButtonStyle, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const { truncate, safe } = require('../utils/text');
const { COLORS } = require('../constants');

const NO_MENTIONS = Object.freeze({ parse: [], repliedUser: false });

function normalizeEmbed(e) {
  if (!e) return null;
  const out = { color: e.color ?? COLORS.CYAN };
  if (e.title) out.title = truncate(safe(e.title), 256);
  if (e.description) out.description = truncate(safe(e.description), 4096);
  if (e.url) out.url = e.url;
  if (e.thumbnail) out.thumbnail = { url: e.thumbnail };
  if (e.image) out.image = { url: e.image };
  if (e.author) out.author = { name: truncate(safe(e.author.name || e.author), 256), icon_url: e.author.icon_url };
  if (e.footer) out.footer = { text: truncate(safe(e.footer.text || e.footer), 2048) };
  if (e.timestamp) out.timestamp = e.timestamp === true ? new Date().toISOString() : e.timestamp;
  if (e.fields && e.fields.length) {
    out.fields = e.fields.slice(0, 25).map((f) => ({ name: truncate(safe(f.name) || '\u200b', 256), value: truncate(safe(f.value) || '\u200b', 1024), inline: Boolean(f.inline) }));
  }
  return out;
}

const STYLE = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link };

function buildRows(buttons) {
  if (!buttons || !buttons.length) return undefined;
  const rows = Array.isArray(buttons[0]) ? buttons : [buttons];
  return rows.slice(0, 5).map((row) => new ActionRowBuilder().addComponents(row.slice(0, 5).map((b) => {
    const btn = new ButtonBuilder().setLabel(truncate(b.label, 80)).setStyle(STYLE[b.style || 'secondary']);
    if (b.style === 'link') btn.setURL(b.url); else btn.setCustomId(b.id);
    if (b.disabled) btn.setDisabled(true);
    if (b.emoji) btn.setEmoji(b.emoji);
    return btn;
  })));
}

/** Plain, serialisable normalisation (used by tests); `toPayload` adds Discord builders. */
function normalize(result) {
  if (result === undefined || result === null) return { content: '✅ Done.' };
  if (typeof result === 'string') return { content: result };
  const out = { ...result };
  if (out.embed) { out.embeds = [out.embed]; delete out.embed; }
  return out;
}

function toPayload(result, { ephemeral = false } = {}) {
  const r = normalize(result);
  const payload = { allowedMentions: NO_MENTIONS };
  if (r.content) payload.content = truncate(safe(r.content), 2000);
  if (r.embeds) payload.embeds = r.embeds.slice(0, 10).map(normalizeEmbed).filter(Boolean);
  const rows = buildRows(r.buttons);
  if (rows) payload.components = rows;
  if (r.files) payload.files = r.files.map((f) => ({ name: f.name, attachment: Buffer.from(f.data) }));
  if (!payload.content && !payload.embeds && !payload.files) payload.content = '✅ Done.';
  if (r.ephemeral || ephemeral) payload.ephemeral = true;
  return payload;
}

/** Slash-interaction payloads use MessageFlags.Ephemeral rather than the legacy field. */
function toInteractionPayload(result, opts) {
  const p = toPayload(result, opts);
  if (p.ephemeral) { p.flags = 64; delete p.ephemeral; }
  return p;
}

module.exports = { NO_MENTIONS, normalize, normalizeEmbed, toPayload, toInteractionPayload };

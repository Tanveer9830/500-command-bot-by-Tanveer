'use strict';
/** Reaction roles and the starboard. */
const { emojiKey } = require('../commands/communityadmin');
const { safe, truncate } = require('../utils/text');
const { NO_MENTIONS } = require('../core/reply');
const log = require('../utils/logger').child('reactions');

const keyOf = (emoji) => (emoji.id ? emoji.id : emoji.name);

function createReactionHandlers({ client, svc }) {
  const { db, settings } = svc;

  async function full(reaction) {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    return reaction;
  }

  async function roleChange(reaction, user, add) {
    const g = reaction.message.guildId; if (!g) return;
    const row = db.prepare('SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?').get(g, reaction.message.id, keyOf(reaction.emoji));
    if (!row) return;
    const guild = reaction.message.guild; const role = guild.roles.cache.get(row.role_id); const me = guild.members.me;
    if (!role || role.managed || (me && role.position >= me.roles.highest.position)) return;
    const member = await guild.members.fetch(user.id).catch(() => null); if (!member) return;
    if (add) await member.roles.add(role, 'Reaction role'); else await member.roles.remove(role, 'Reaction role removed');
  }

  async function star(reaction) {
    const m = reaction.message; const g = m.guildId; if (!g) return;
    const channelId = settings.get(g, 'star_channel'); if (!channelId || m.channelId === channelId) return;
    let wanted; try { wanted = emojiKey(settings.get(g, 'star_emoji')); } catch { return; }
    if (keyOf(reaction.emoji) !== wanted) return;
    if (m.author && m.author.bot && m.author.id === (client.user && client.user.id)) return;
    const users = await reaction.users.fetch();
    const stars = [...users.values()].filter((u) => !m.author || u.id !== m.author.id).length; // no self-stars
    const threshold = settings.get(g, 'star_threshold');
    const row = db.prepare('SELECT * FROM starboard WHERE guild_id = ? AND message_id = ?').get(g, m.id);
    const body = { content: `${settings.get(g, 'star_emoji')} **${stars}** • <#${m.channelId}>`, embeds: [{ color: 0xf1c40f, author: { name: safe(m.member ? m.member.displayName : m.author ? m.author.username : 'unknown') }, description: truncate(safe(m.content || '_no text_'), 1800), fields: [{ name: 'Source', value: `[Jump to message](${m.url})` }], timestamp: new Date(m.createdTimestamp).toISOString() }], allowedMentions: NO_MENTIONS };
    const att = m.attachments && m.attachments.first && m.attachments.first();
    if (att && /^image\//.test(att.contentType || '')) body.embeds[0].image = { url: att.url };
    if (row && row.star_message_id) {
      db.prepare('UPDATE starboard SET stars = ? WHERE guild_id = ? AND message_id = ?').run(stars, g, m.id);
      await svc.editMessage(channelId, row.star_message_id, body);
    } else if (stars >= threshold) {
      const sent = await svc.sendToChannel(channelId, body);
      db.prepare('INSERT INTO starboard (guild_id, message_id, star_message_id, stars) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, message_id) DO UPDATE SET star_message_id = excluded.star_message_id, stars = excluded.stars').run(g, m.id, sent ? sent.id : null, stars);
    }
  }

  const wrap = (fn) => async (reaction, user) => {
    try { if (user.bot) return; await full(reaction); await fn(reaction, user); } catch (e) { log.warn('reaction handler failed', { err: e.message }); }
  };
  return {
    onAdd: wrap(async (r, u) => { await roleChange(r, u, true); await star(r); }),
    onRemove: wrap(async (r, u) => { await roleChange(r, u, false); await star(r); }),
  };
}

module.exports = { createReactionHandlers };

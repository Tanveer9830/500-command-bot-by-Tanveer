'use strict';
/** Optional audit-style event logging to the channels configured with the `log` commands. */
const { safe, truncate } = require('../utils/text');
const log = require('../utils/logger').child('eventlog');

function createLoggingHandlers({ svc }) {
  const send = (g, type, embed) => svc.logEvent(g, type, { timestamp: true, color: 0x1f6bff, ...embed }).catch((e) => log.debug('log failed', { err: e.message }));
  return {
    messageDelete: (m) => { if (!m.guildId || (m.author && m.author.bot)) return; return send(m.guildId, 'message', { title: '🗑️ Message deleted', description: `**Author:** ${m.author ? safe(m.author.username) : 'unknown'}\n**Channel:** <#${m.channelId}>\n${m.content ? truncate(safe(m.content), 1500) : '_content not cached_'}` }); },
    messageUpdate: (a, b) => { if (!b.guildId || (b.author && b.author.bot) || !a.content || a.content === b.content) return; return send(b.guildId, 'message', { title: '✏️ Message edited', description: `**Author:** ${safe(b.author.username)} in <#${b.channelId}>\n**Before:** ${truncate(safe(a.content), 700)}\n**After:** ${truncate(safe(b.content || ''), 700)}` }); },
    banAdd: (ban) => send(ban.guild.id, 'mod', { color: 0x7b4dff, title: '🔨 Member banned', description: `${safe(ban.user.username)} (${ban.user.id})${ban.reason ? `\nReason: ${safe(ban.reason)}` : ''}` }),
    banRemove: (ban) => send(ban.guild.id, 'mod', { title: '♻️ Member unbanned', description: `${safe(ban.user.username)} (${ban.user.id})` }),
    voice: (a, b) => {
      const g = (b.guild || a.guild).id; const name = safe((b.member || a.member).displayName);
      if (!a.channelId && b.channelId) return send(g, 'voice', { title: '🔊 Joined voice', description: `${name} → <#${b.channelId}>` });
      if (a.channelId && !b.channelId) return send(g, 'voice', { title: '🔇 Left voice', description: `${name} ← <#${a.channelId}>` });
      if (a.channelId !== b.channelId) return send(g, 'voice', { title: '🔀 Moved voice', description: `${name}: <#${a.channelId}> → <#${b.channelId}>` });
    },
    channelCreate: (c) => c.guild && send(c.guild.id, 'server', { title: '➕ Channel created', description: `#${safe(c.name)} (${c.id})` }),
    channelDelete: (c) => c.guild && send(c.guild.id, 'server', { color: 0x7b4dff, title: '➖ Channel deleted', description: `#${safe(c.name)} (${c.id})` }),
    roleCreate: (r) => send(r.guild.id, 'server', { title: '➕ Role created', description: `${safe(r.name)} (${r.id})` }),
    roleDelete: (r) => send(r.guild.id, 'server', { color: 0x7b4dff, title: '➖ Role deleted', description: `${safe(r.name)} (${r.id})` }),
    nickname: (a, b) => { if (a.nickname === b.nickname) return; return send(b.guild.id, 'member', { title: '🏷️ Nickname changed', description: `${safe(b.user.username)}: ${safe(a.nickname || '(none)')} → ${safe(b.nickname || '(none)')}` }); },
  };
}

module.exports = { createLoggingHandlers };

'use strict';
/** Music and personal playlists (Lavalink via Shoukaku). Admin controls live in communityadmin.js. */
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { truncate, safe, formatDuration, parseDuration } = require('../utils/text');

const q = { name: 'query', type: 'string', description: 'Song name or URL', required: true, maxLength: 300, rest: true };
const posOpt = (d = 'Queue position') => ({ name: 'position', type: 'integer', description: d, required: true, min: 1, max: 1000 });
const trackLine = (m, t, i) => `${i !== undefined ? `**${i}.** ` : ''}[${safe(truncate(t.info.title, 60))}](${t.info.uri}) \`${t.info.isStream ? 'LIVE' : m.fmt(t.info.length)}\``;

function isDJ(ctx) {
  const role = ctx.cfg('music_dj_role');
  const perms = ctx.member && ctx.member.permissions;
  if (perms && perms.has('ManageGuild')) return true;
  return Boolean(role && ctx.member && ctx.member.roles.cache.has(role));
}
/** Control actions need the same voice channel; with a DJ role configured they also need that role. */
function assertControl(ctx) {
  const m = ctx.svc.music; const st = m.assertSameChannel(ctx.guildId, ctx.voiceChannelId);
  const role = ctx.cfg('music_dj_role');
  if (role && !isDJ(ctx)) {
    const cur = st.current;
    if (!(cur && cur.requestedBy === ctx.user.id)) throw new UserError(`Only members with the <@&${role}> role (or the person who queued the track) can do that.`);
  }
  return st;
}
function humansIn(ctx, st) {
  const ch = ctx.guild.channels.cache.get(st.voiceChannelId);
  return ch && ch.members ? [...ch.members.values()].filter((m) => !m.user.bot).length : 1;
}
async function voteSkip(ctx) {
  const m = ctx.svc.music; const st = m.assertSameChannel(ctx.guildId, ctx.voiceChannelId);
  if (!st.current) throw new UserError('Nothing is playing.');
  st.skipVotes.add(ctx.user.id);
  const need = Math.max(1, Math.ceil(humansIn(ctx, st) / 2));
  if (st.skipVotes.size >= need) { await m.skip(ctx.guildId); return '⏭️ Vote passed — skipped.'; }
  return `🗳️ Skip vote ${st.skipVotes.size}/${need}.`;
}
const enqueueReply = (ctx, r) => {
  const first = r.added[0].track;
  if (r.added.length > 1) return `🎶 Queued **${r.added.length}** tracks${r.playlistName ? ` from **${safe(r.playlistName)}**` : ''}.`;
  return r.startedNow ? `▶️ Now playing ${trackLine(ctx.svc.music, first)}` : `➕ Queued #${r.position}: ${trackLine(ctx.svc.music, first)}`;
};

module.exports = function register(registry) {
  const M = registry.group({ name: 'music', description: 'Play music in voice channels', category: 'Music' });
  const MA = (sub, spec, run) => M.action(sub, { guildOnly: true, cooldown: 2, ...spec }, run);
  const music = (ctx) => ctx.svc.music;

  MA('join', { description: 'Join your voice channel', botPerms: ['Connect', 'Speak'] }, async (ctx) => { await music(ctx).join({ guildId: ctx.guildId, voiceChannelId: ctx.voiceChannelId, textChannelId: ctx.channel.id, shardId: ctx.guild.shardId }); return '🔊 Joined your voice channel.'; });
  MA('play', { description: 'Play a song or add it to the queue', aliases: ['p'], botPerms: ['Connect', 'Speak'], options: [q] }, async (ctx) => enqueueReply(ctx, await music(ctx).enqueue(ctx, ctx.args.query)));
  MA('playnext', { description: 'Queue a song to play next', aliases: ['pn'], botPerms: ['Connect', 'Speak'], options: [q] }, async (ctx) => { if (music(ctx).state(ctx.guildId)) assertControl(ctx); return enqueueReply(ctx, await music(ctx).enqueue(ctx, ctx.args.query, { next: true })); });
  MA('search', { description: 'Search and pick from 5 results', options: [q] }, async (ctx) => { const list = await music(ctx).search(ctx.user.id, ctx.args.query); return H.embed(ctx, { title: 'Search results', description: `${list.map((t, i) => trackLine(music(ctx), t, i + 1)).join('\n')}\n\nPick one with \`music pick <number>\`.` }); });
  MA('pick', { description: 'Play a result from your last search', botPerms: ['Connect', 'Speak'], options: [{ name: 'number', type: 'integer', description: '1-5', required: true, min: 1, max: 5 }] }, async (ctx) => { const t = music(ctx).pickResult(ctx.user.id, ctx.args.number); const st = await music(ctx).enqueueTrack(ctx, t); return `➕ ${st.current && st.current.track === t ? 'Now playing' : 'Queued'} ${trackLine(music(ctx), t)}`; });
  MA('pause', { description: 'Pause playback' }, async (ctx) => { assertControl(ctx); await music(ctx).pause(ctx.guildId); return '⏸️ Paused.'; });
  MA('resume', { description: 'Resume playback', aliases: ['unpause'] }, async (ctx) => { assertControl(ctx); await music(ctx).resume(ctx.guildId); return '▶️ Resumed.'; });
  MA('skip', { description: 'Skip the current track (vote if not DJ)', aliases: ['next'], options: [{ name: 'count', type: 'integer', description: 'How many tracks (DJ only)', min: 1, max: 50, default: 1 }] }, async (ctx) => {
    const st = music(ctx).assertSameChannel(ctx.guildId, ctx.voiceChannelId);
    const requester = st.current && st.current.requestedBy === ctx.user.id;
    if (isDJ(ctx) || requester || (!ctx.cfg('music_vote_skip') && !ctx.cfg('music_dj_role')) || humansIn(ctx, st) <= 1) { const s = await music(ctx).skip(ctx.guildId, ctx.args.count); return `⏭️ Skipped **${safe(s.track.info.title)}**.`; }
    if (ctx.args.count > 1) throw new UserError('Only DJs can skip multiple tracks.');
    return voteSkip(ctx);
  });
  MA('voteskip', { description: 'Vote to skip the current track', aliases: ['vs'] }, (ctx) => voteSkip(ctx));
  MA('skipto', { description: 'Jump to a queue position', options: [posOpt()] }, async (ctx) => { assertControl(ctx); const it = await music(ctx).skipTo(ctx.guildId, ctx.args.position); return `⏭️ Now playing ${trackLine(music(ctx), it.track)}`; });
  MA('stop', { description: 'Stop playback, clear the queue and leave' }, async (ctx) => { assertControl(ctx); await music(ctx).stop(ctx.guildId); return '⏹️ Stopped and left the channel.'; });
  MA('leave', { description: 'Leave the voice channel', aliases: ['disconnect', 'dc'] }, async (ctx) => { assertControl(ctx); await music(ctx).leave(ctx.guildId); return '👋 Left the voice channel.'; });
  MA('queue', { description: 'Show the queue', aliases: ['q'], options: [{ name: 'page', type: 'integer', description: 'Page', min: 1, max: 100, default: 1 }] }, (ctx) => {
    const info = music(ctx).queueInfo(ctx.guildId); const off = (ctx.args.page - 1) * 10;
    const lines = info.queue.slice(off, off + 10).map((it, i) => trackLine(music(ctx), it.track, off + i + 1));
    return H.embed(ctx, { title: '🎶 Queue', description: `${info.current ? `**Now:** ${trackLine(music(ctx), info.current.track)}\n\n` : ''}${lines.join('\n') || '_queue is empty_'}`, footer: { text: `${info.queue.length} queued • ${formatDuration(Math.round(info.totalMs / 1000))} • loop ${info.loop} • volume ${info.volume}` } });
  });
  MA('nowplaying', { description: 'Show the current track', aliases: ['np'] }, (ctx) => {
    const n = music(ctx).nowPlaying(ctx.guildId); const bar = n.stream ? 'LIVE' : lvbar(n.elapsed, n.length);
    return H.embed(ctx, { title: '🎵 Now playing', description: `[${safe(n.title)}](${n.uri})\nby **${safe(n.author)}**\n${bar} ${n.stream ? '' : `${music(ctx).fmt(n.elapsed)} / ${music(ctx).fmt(n.length)}`}`, thumbnail: n.artwork || undefined, footer: { text: `requested by ${n.requestedBy} • loop ${n.loop} • volume ${n.volume}${n.paused ? ' • paused' : ''}` } });
  });
  MA('volume', { description: 'Set the volume (1-150)', aliases: ['vol'], options: [{ name: 'level', type: 'integer', description: '1-150', required: true, min: 1, max: 150 }] }, async (ctx) => { assertControl(ctx); await music(ctx).setVolume(ctx.guildId, ctx.args.level); return `🔉 Volume set to **${ctx.args.level}**.`; });
  MA('loop', { description: 'Loop the track, the queue, or nothing', options: [{ name: 'mode', type: 'string', description: 'off, track or queue', required: true, choices: ['off', 'track', 'queue'] }] }, (ctx) => { assertControl(ctx); music(ctx).setLoop(ctx.guildId, ctx.args.mode); return `🔁 Loop: **${ctx.args.mode}**.`; });
  MA('shuffle', { description: 'Shuffle the queue' }, (ctx) => { assertControl(ctx); music(ctx).shuffle(ctx.guildId, ctx.svc.random); return '🔀 Queue shuffled.'; });
  MA('clear', { description: 'Clear the queue (keeps the current track)' }, (ctx) => { assertControl(ctx); return H.ok(`Removed ${music(ctx).clear(ctx.guildId)} queued track(s).`); });
  MA('remove', { description: 'Remove a track from the queue', options: [posOpt()] }, (ctx) => { assertControl(ctx); const it = music(ctx).remove(ctx.guildId, ctx.args.position); return H.ok(`Removed **${safe(it.track.info.title)}**.`); });
  MA('move', { description: 'Move a track within the queue', options: [{ ...posOpt('From position'), name: 'from' }, { ...posOpt('To position'), name: 'to' }] }, (ctx) => { assertControl(ctx); const it = music(ctx).move(ctx.guildId, ctx.args.from, ctx.args.to); return H.ok(`Moved **${safe(it.track.info.title)}** to #${ctx.args.to}.`); });
  MA('seek', { description: 'Seek to a time in the track (e.g. 1m30s)', options: [{ name: 'time', type: 'duration', description: 'e.g. 90s, 1m30s', required: true, min: 0, max: 86400 }] }, async (ctx) => { assertControl(ctx); await music(ctx).seek(ctx.guildId, ctx.args.time * 1000); return `⏩ Seeked to ${formatDuration(ctx.args.time)}.`; });
  MA('replay', { description: 'Restart the current track' }, async (ctx) => { assertControl(ctx); await music(ctx).replay(ctx.guildId); return '⏮️ Restarted.'; });
  MA('status', { description: 'Is music available on this bot?' }, (ctx) => { const s = music(ctx).status(); return s.configured ? (s.connected ? `🟢 Lavalink connected (${s.nodes.length} node).` : `🟠 Lavalink configured but not connected${s.lastError ? `: ${safe(s.lastError)}` : ''}.`) : `⚪ ${s.message}`; });

  // -------------------------------------------------------------- playlists
  const PL = registry.group({ name: 'playlist', description: 'Your saved playlists', category: 'Music', aliases: ['pl'] });
  const name = { name: 'name', type: 'string', description: 'Playlist name', required: true, minLength: 1, maxLength: 40, pattern: /^[\w .-]+$/u, patternHelp: 'letters, numbers, spaces, . _ -' };
  const mine = (ctx, n) => { const p = ctx.db.prepare('SELECT * FROM playlists WHERE user_id = ? AND name = ?').get(ctx.user.id, n); if (!p) throw new UserError(`You have no playlist named **${safe(n)}**.`); return p; };
  PL.action('create', { description: 'Create a playlist', options: [name] }, (ctx) => {
    if (ctx.db.prepare('SELECT COUNT(*) n FROM playlists WHERE user_id = ?').get(ctx.user.id).n >= 25) throw new UserError('You can have at most 25 playlists.');
    try { ctx.db.prepare('INSERT INTO playlists (user_id, name) VALUES (?, ?)').run(ctx.user.id, ctx.args.name); } catch (e) { if (/UNIQUE/.test(e.message)) throw new UserError('You already have a playlist with that name.'); throw e; }
    return H.ok(`Created playlist **${safe(ctx.args.name)}**.`);
  });
  PL.action('delete', { description: 'Delete a playlist', options: [name] }, (ctx) => { const p = mine(ctx, ctx.args.name); ctx.db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id); return H.ok('Playlist deleted.'); });
  PL.action('add', { description: 'Add a song (name or URL) to a playlist', options: [name, q] }, (ctx) => {
    const p = mine(ctx, ctx.args.name); if (ctx.db.prepare('SELECT COUNT(*) n FROM playlist_tracks WHERE playlist_id = ?').get(p.id).n >= 100) throw new UserError('A playlist holds at most 100 tracks.');
    ctx.db.prepare('INSERT INTO playlist_tracks (playlist_id, query, title) VALUES (?, ?, ?)').run(p.id, ctx.args.query, null); return H.ok(`Added to **${safe(p.name)}**.`);
  });
  PL.action('remove', { description: 'Remove a track by position', options: [name, posOpt('Track position')] }, (ctx) => {
    const p = mine(ctx, ctx.args.name); const rows = ctx.db.prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY id').all(p.id); const r = rows[ctx.args.position - 1];
    if (!r) throw new UserError('No track at that position.'); ctx.db.prepare('DELETE FROM playlist_tracks WHERE id = ?').run(r.id); return H.ok('Track removed.');
  });
  PL.action('list', { description: 'Your playlists' }, (ctx) => H.embed(ctx, { title: 'Your playlists', description: H.listLines(ctx.db.prepare('SELECT p.name, COUNT(t.id) n FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.name').all(ctx.user.id), (p) => `**${safe(p.name)}** — ${p.n} track(s)`, 25), ephemeral: true }));
  PL.action('view', { description: 'Show the tracks of a playlist', options: [name] }, (ctx) => { const p = mine(ctx, ctx.args.name); return H.embed(ctx, { title: `Playlist: ${safe(p.name)}`, description: H.listLines(ctx.db.prepare('SELECT query FROM playlist_tracks WHERE playlist_id = ? ORDER BY id').all(p.id), (t, i) => `**${i + 1}.** ${safe(truncate(t.query, 80))}`, 25), ephemeral: true }); });
  PL.action('rename', { description: 'Rename a playlist', options: [name, { ...name, name: 'newname', description: 'New name' }] }, (ctx) => { const p = mine(ctx, ctx.args.name); try { ctx.db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(ctx.args.newname, p.id); } catch (e) { if (/UNIQUE/.test(e.message)) throw new UserError('You already have a playlist with that name.'); throw e; } return H.ok('Renamed.'); });
  PL.action('clear', { description: 'Remove every track from a playlist', options: [name] }, (ctx) => { const p = mine(ctx, ctx.args.name); return H.ok(`Removed ${ctx.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(p.id).changes} track(s).`); });
  PL.action('play', { description: 'Queue a whole playlist', guildOnly: true, botPerms: ['Connect', 'Speak'], cooldown: 5, options: [name] }, async (ctx) => {
    const p = mine(ctx, ctx.args.name); const rows = ctx.db.prepare('SELECT query FROM playlist_tracks WHERE playlist_id = ? ORDER BY id LIMIT 25').all(p.id);
    if (!rows.length) throw new UserError('That playlist is empty.'); let ok = 0; let lastErr = null;
    for (const r of rows) { try { await ctx.svc.music.enqueue(ctx, r.query); ok++; } catch (e) { if (!(e instanceof UserError)) throw e; lastErr = e.message; if (/not configured|not connected|Join a voice|limited to/.test(e.message)) throw e; } }
    return ok ? `🎶 Queued **${ok}** of ${rows.length} track(s) from **${safe(p.name)}**.` : `Nothing could be queued${lastErr ? `: ${lastErr}` : '.'}`;
  });

  registry.standalone('play', 'music.play');
  registry.standalone('queue', 'music.queue');
  registry.standalone('skip', 'music.skip');
};

function lvbar(el, len) { const w = 14; const f = len ? Math.min(w, Math.round((el / len) * w)) : 0; return `${'▬'.repeat(f)}🔘${'▬'.repeat(w - f)}`; }
void parseDuration;

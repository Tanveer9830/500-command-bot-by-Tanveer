'use strict';
/**
 * Music service: queue management on top of Lavalink (via Shoukaku).
 * The bot runs fine without Lavalink; every music action then replies with a
 * clear "not configured / not connected" message. The backend is injectable so
 * the queue logic can be unit-tested without a Lavalink server.
 */
const { UserError } = require('../core/errors');
const log = require('../utils/logger').child('music');

const URL_RE = /^https?:\/\/\S+$/i;

class ShoukakuBackend {
  constructor(client, cfg) {
    const { Shoukaku, Connectors } = require('shoukaku');
    this.cfg = cfg;
    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [{
      name: cfg.name, url: `${cfg.host}:${cfg.port}`, auth: cfg.password, secure: cfg.secure,
    }], { resume: true, resumeTimeout: 30, reconnectTries: 10, reconnectInterval: 10, restTimeout: 15_000, moveOnDisconnect: false });
    this.ready = false; this.lastError = null;
    this.shoukaku.on('ready', (name) => { this.ready = true; this.lastError = null; log.info('Lavalink node ready', { node: name }); });
    this.shoukaku.on('error', (name, err) => { this.lastError = err.message; log.warn('Lavalink node error', { node: name, err: err.message }); });
    this.shoukaku.on('close', (name, code, reason) => { this.ready = false; log.warn('Lavalink node closed', { node: name, code, reason }); });
    this.shoukaku.on('disconnect', (name) => { this.ready = false; log.warn('Lavalink node disconnected', { node: name }); });
  }
  status() {
    const nodes = [...this.shoukaku.nodes.values()].map((n) => ({
      name: n.name, state: ['CONNECTING', 'NEARLY', 'CONNECTED', 'RECONNECTING', 'DISCONNECTING', 'DISCONNECTED'][n.state] || String(n.state),
      players: n.stats ? n.stats.players : 0, playingPlayers: n.stats ? n.stats.playingPlayers : 0,
      ping: n.stats ? undefined : undefined, uptime: n.stats ? n.stats.uptime : 0,
    }));
    return { connected: nodes.some((n) => n.state === 'CONNECTED'), nodes, lastError: this.lastError };
  }
  async resolve(identifier) {
    const node = this.shoukaku.getIdealNode();
    if (!node) throw new UserError('Music is temporarily unavailable: the Lavalink node is not connected.');
    const res = await node.rest.resolve(identifier);
    if (!res) throw new UserError('Lavalink returned no response.');
    switch (res.loadType) {
      case 'track': return { loadType: 'track', tracks: [res.data] };
      case 'search': return { loadType: 'search', tracks: res.data };
      case 'playlist': return { loadType: 'playlist', tracks: res.data.tracks, playlistName: res.data.info.name };
      case 'empty': return { loadType: 'empty', tracks: [] };
      default: return { loadType: 'error', tracks: [], message: res.data && res.data.message };
    }
  }
  async join({ guildId, channelId, shardId }) {
    const existing = this.shoukaku.players.get(guildId);
    if (existing) return existing;
    return this.shoukaku.joinVoiceChannel({ guildId, channelId, shardId: shardId || 0, deaf: true });
  }
  async leave(guildId) { await this.shoukaku.leaveVoiceChannel(guildId); }
}

function fmtMs(ms) {
  const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

class Music {
  constructor({ config, settings, backend = null }) {
    this.config = config; this.settings = settings; this.backend = backend;
    this.states = new Map(); this.searches = new Map();
  }
  get enabled() { return Boolean(this.backend); }

  attach(client) {
    if (!this.config.lavalink.enabled) { log.info('Lavalink not configured: music commands will report that they are unavailable.'); return; }
    try { this.backend = new ShoukakuBackend(client, this.config.lavalink); log.info('Lavalink backend created; connecting in the background.'); } catch (err) { log.error('Could not initialise Lavalink', { err }); }
  }

  status() {
    if (!this.backend) return { configured: false, connected: false, nodes: [], message: 'Lavalink is not configured (set LAVALINK_HOST in the environment).' };
    return { configured: true, ...this.backend.status() };
  }
  _need() {
    if (!this.backend) throw new UserError('Music is not configured on this bot (no Lavalink server). See docs/LAVALINK.md.');
    if (!this.backend.status().connected) throw new UserError('Music is temporarily unavailable: the Lavalink node is not connected.');
  }
  state(guildId) { return this.states.get(guildId) || null; }
  _need2(guildId) { const s = this.state(guildId); if (!s) throw new UserError('Nothing is playing in this server.'); return s; }

  async join({ guildId, voiceChannelId, textChannelId, shardId }) {
    this._need();
    if (!voiceChannelId) throw new UserError('Join a voice channel first.');
    let st = this.state(guildId);
    if (st && st.voiceChannelId !== voiceChannelId) throw new UserError('I am already playing in another voice channel.');
    if (!st) {
      const player = await this.backend.join({ guildId, channelId: voiceChannelId, shardId });
      st = { guildId, player, voiceChannelId, textChannelId, queue: [], current: null, loop: 'off', volume: this.settings.get(guildId, 'music_default_volume'), paused: false, skipVotes: new Set(), startedAt: 0 };
      this.states.set(guildId, st);
      player.on('end', (ev) => this._onEnd(st, ev));
      player.on('exception', (ev) => { st.lastError = ev && ev.exception ? ev.exception.message : 'playback error'; log.warn('track exception', { guildId, msg: st.lastError }); });
      player.on('stuck', () => { log.warn('track stuck; skipping', { guildId }); this.skip(guildId).catch(() => {}); });
      player.on('closed', () => { if (this.states.get(guildId) === st) this.states.delete(guildId); });
      await player.setGlobalVolume(st.volume);
    }
    if (textChannelId) st.textChannelId = textChannelId;
    return st;
  }

  async resolve(query) {
    this._need();
    const id = URL_RE.test(query) ? query : `ytsearch:${query}`;
    const res = await this.backend.resolve(id);
    if (res.loadType === 'error') {
      const hint = /spotify\.com/i.test(query) ? ' Spotify links are only playable if your Lavalink has a Spotify-capable plugin (e.g. LavaSrc).' : '';
      throw new UserError(`Could not load that track: ${res.message || 'unknown Lavalink error'}.${hint}`);
    }
    if (res.loadType === 'empty' || !res.tracks.length) {
      const hint = /spotify\.com/i.test(query) ? ' Spotify links need a Spotify-capable Lavalink plugin (e.g. LavaSrc); direct Spotify playback is not available by default.' : '';
      throw new UserError(`No results found for **${query}**.${hint}`);
    }
    return res;
  }

  async enqueue(ctx, query, { next = false } = {}) {
    const g = ctx.guildId;
    const st = await this.join({ guildId: g, voiceChannelId: ctx.voiceChannelId, textChannelId: ctx.channel && ctx.channel.id, shardId: ctx.guild && ctx.guild.shardId });
    const res = await this.resolve(query);
    const max = this.settings.get(g, 'music_max_queue');
    const wanted = res.loadType === 'playlist' ? res.tracks : [res.tracks[0]];
    if (st.queue.length + wanted.length > max) throw new UserError(`The queue is limited to ${max} tracks.`);
    const items = wanted.map((t) => ({ track: t, requestedBy: ctx.user.id }));
    if (next) st.queue.unshift(...items); else st.queue.push(...items);
    if (!st.current) await this._playNext(st);
    return { added: items, playlistName: res.playlistName, position: st.queue.length, startedNow: st.current === items[0] };
  }

  async search(userId, query) {
    const res = await this.resolve(query);
    const list = res.tracks.slice(0, 5);
    this.searches.set(userId, { list, at: Date.now() });
    return list;
  }
  pickResult(userId, n) {
    const s = this.searches.get(userId);
    if (!s || Date.now() - s.at > 10 * 60_000) throw new UserError('No recent search. Use the `search` command first.');
    const t = s.list[n - 1];
    if (!t) throw new UserError(`Pick a number between 1 and ${s.list.length}.`);
    return t;
  }
  async enqueueTrack(ctx, track) {
    const st = await this.join({ guildId: ctx.guildId, voiceChannelId: ctx.voiceChannelId, textChannelId: ctx.channel && ctx.channel.id, shardId: ctx.guild && ctx.guild.shardId });
    st.queue.push({ track, requestedBy: ctx.user.id });
    if (!st.current) await this._playNext(st);
    return st;
  }

  async _playNext(st) {
    const item = st.queue.shift();
    if (!item) { st.current = null; return null; }
    st.current = item; st.startedAt = Date.now(); st.skipVotes.clear();
    try {
      await st.player.playTrack({ track: { encoded: item.track.encoded } });
      if (st.paused) { await st.player.setPaused(false); st.paused = false; }
    } catch (err) {
      log.warn('playTrack failed', { err: err.message });
      st.lastError = err.message; st.current = null;
      return this._playNext(st);
    }
    return item;
  }

  async _onEnd(st, ev) {
    const reason = ev && ev.reason;
    if (reason === 'replaced' || reason === 'stopped' || reason === 'cleanup') return;
    const finished = st.current;
    if (finished && st.loop === 'track' && reason === 'finished') { st.queue.unshift({ ...finished }); }
    else if (finished && st.loop === 'queue') st.queue.push({ ...finished });
    await this._playNext(st);
  }

  async pause(g) { const s = this._need2(g); if (s.paused) throw new UserError('Already paused.'); await s.player.setPaused(true); s.paused = true; }
  async resume(g) { const s = this._need2(g); if (!s.paused) throw new UserError('Playback is not paused.'); await s.player.setPaused(false); s.paused = false; }
  async skip(g, n = 1) {
    const s = this._need2(g);
    if (!s.current) throw new UserError('Nothing is playing.');
    const skipped = s.current;
    if (n > 1) s.queue.splice(0, Math.min(n - 1, s.queue.length));
    if (s.loop === 'track') s.loop = 'off';
    if (s.queue.length) await this._playNext(s); else { s.current = null; await s.player.stopTrack(); }
    return skipped;
  }
  async stop(g) {
    const s = this._need2(g);
    s.queue.length = 0; s.current = null; s.loop = 'off';
    await s.player.stopTrack();
    await this.backend.leave(g); this.states.delete(g);
  }
  async leave(g) { this._need2(g); await this.backend.leave(g); this.states.delete(g); }
  async setVolume(g, v) {
    const s = this._need2(g);
    if (!Number.isInteger(v) || v < 1 || v > 150) throw new UserError('Volume must be between 1 and 150.');
    await s.player.setGlobalVolume(v); s.volume = v;
  }
  setLoop(g, mode) {
    const s = this._need2(g);
    if (!['off', 'track', 'queue'].includes(mode)) throw new UserError('Loop mode must be off, track or queue.');
    s.loop = mode;
  }
  shuffle(g, rng = Math.random) {
    const s = this._need2(g);
    if (s.queue.length < 2) throw new UserError('Need at least 2 queued tracks to shuffle.');
    for (let i = s.queue.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]]; }
  }
  clear(g) { const s = this._need2(g); const n = s.queue.length; s.queue.length = 0; return n; }
  remove(g, pos) {
    const s = this._need2(g);
    if (!Number.isInteger(pos) || pos < 1 || pos > s.queue.length) throw new UserError(`Pick a position between 1 and ${s.queue.length}.`);
    return s.queue.splice(pos - 1, 1)[0];
  }
  move(g, from, to) {
    const s = this._need2(g);
    const n = s.queue.length;
    if (from < 1 || from > n || to < 1 || to > n) throw new UserError(`Positions must be between 1 and ${n}.`);
    const [it] = s.queue.splice(from - 1, 1); s.queue.splice(to - 1, 0, it); return it;
  }
  async skipTo(g, pos) {
    const s = this._need2(g);
    if (pos < 1 || pos > s.queue.length) throw new UserError(`Pick a position between 1 and ${s.queue.length}.`);
    s.queue.splice(0, pos - 1); if (s.loop === 'track') s.loop = 'off';
    return this._playNext(s);
  }
  async seek(g, ms) {
    const s = this._need2(g);
    if (!s.current) throw new UserError('Nothing is playing.');
    if (!s.current.track.info.isSeekable) throw new UserError('This track cannot be seeked.');
    if (ms < 0 || ms > s.current.track.info.length) throw new UserError('That position is outside the track.');
    await s.player.seekTo(ms);
  }
  async replay(g) { const s = this._need2(g); if (!s.current) throw new UserError('Nothing is playing.'); await s.player.seekTo(0); }
  nowPlaying(g) {
    const s = this._need2(g);
    if (!s.current) throw new UserError('Nothing is playing.');
    const i = s.current.track.info;
    const elapsed = s.paused ? 0 : Math.min(Date.now() - s.startedAt, i.length);
    return { title: i.title, author: i.author, uri: i.uri, length: i.length, stream: i.isStream, requestedBy: s.current.requestedBy, elapsed, loop: s.loop, volume: s.volume, paused: s.paused, artwork: i.artworkUrl };
  }
  queueInfo(g) {
    const s = this._need2(g);
    return { current: s.current, queue: s.queue, loop: s.loop, volume: s.volume, totalMs: s.queue.reduce((a, q) => a + q.track.info.length, 0) };
  }
  /** Voice-channel membership check used by commands: the user must be in the bot's channel. */
  assertSameChannel(g, voiceChannelId) {
    const s = this._need2(g);
    if (!voiceChannelId || voiceChannelId !== s.voiceChannelId) throw new UserError('You must be in my voice channel to do that.');
    return s;
  }
  fmt(ms) { return fmtMs(ms); }
}

module.exports = { Music, ShoukakuBackend, fmtMs };

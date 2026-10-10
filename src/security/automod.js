'use strict';
/** Automoderation rules (pure detection; enforcement is done by the message event). */
const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|discord\.io)\/[a-z0-9-]+/i;
const URL_RE = /\bhttps?:\/\/([^\s/$.?#]+(?:\.[^\s/$.?#]+)+)[^\s]*/gi;
const EMOJI_RE = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;

class AutoMod {
  constructor({ settings, now = () => Date.now() }) {
    this.settings = settings; this.now = now; this.hits = new Map();
  }

  /** @returns {{rule: string, detail: string}|null} first violated rule. */
  inspect({ guildId, userId, content, mentionCount = 0, memberRoleIds = [], channelId }) {
    const s = this.settings;
    if (!s.get(guildId, 'automod_enabled')) return null;
    if (s.get(guildId, 'automod_exempt_channels').includes(channelId)) return null;
    const exemptRoles = s.get(guildId, 'automod_exempt_roles');
    if (memberRoleIds.some((r) => exemptRoles.includes(r))) return null;
    const text = String(content || '');

    if (s.get(guildId, 'automod_spam')) {
      const win = s.get(guildId, 'automod_spam_window') * 1000; const max = s.get(guildId, 'automod_spam_threshold');
      const k = `${guildId}:${userId}`; const t = this.now();
      const arr = (this.hits.get(k) || []).filter((x) => t - x < win); arr.push(t); this.hits.set(k, arr);
      if (arr.length >= max) { this.hits.delete(k); return { rule: 'spam', detail: `${arr.length} messages in ${win / 1000}s` }; }
    }
    if (s.get(guildId, 'automod_invites') && INVITE_RE.test(text)) return { rule: 'invite', detail: 'Discord invite link' };
    if (s.get(guildId, 'automod_links')) {
      const allowed = s.get(guildId, 'automod_domains').map((d) => d.toLowerCase());
      for (const m of text.matchAll(URL_RE)) {
        const host = m[1].toLowerCase();
        if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return { rule: 'link', detail: host };
      }
    }
    const caps = s.get(guildId, 'automod_caps_pct');
    if (caps) {
      const letters = text.replace(/[^a-z]/gi, '');
      if (letters.length >= 10 && (letters.replace(/[^A-Z]/g, '').length / letters.length) * 100 >= caps) return { rule: 'caps', detail: `>= ${caps}% capitals` };
    }
    const mm = s.get(guildId, 'automod_mentions');
    if (mm && mentionCount >= mm) return { rule: 'mentions', detail: `${mentionCount} mentions` };
    const em = s.get(guildId, 'automod_emojis');
    if (em && (text.match(EMOJI_RE) || []).length >= em) return { rule: 'emojis', detail: 'too many emojis' };
    const bad = s.get(guildId, 'automod_badwords');
    if (bad.length) {
      const lower = text.toLowerCase();
      for (const w of bad) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
        if (re.test(lower)) return { rule: 'badword', detail: 'blocked word' };
      }
    }
    return null;
  }
}

module.exports = { AutoMod, INVITE_RE };

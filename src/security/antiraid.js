'use strict';
/** Join-flood detection + account-age gate. Decisions only; the event handler enforces them. */
class AntiRaid {
  constructor({ settings, now = () => Date.now() }) { this.settings = settings; this.now = now; this.joins = new Map(); }

  /** @returns {{raid: boolean, reason?: string, action?: string, young?: boolean}} */
  onJoin({ guildId, userId, accountCreatedMs }) {
    const s = this.settings;
    if (!s.get(guildId, 'raid_enabled')) return { raid: false };
    if (s.get(guildId, 'raid_whitelist').includes(userId)) return { raid: false };
    const action = s.get(guildId, 'raid_action');
    const minAge = s.get(guildId, 'raid_min_age_days');
    if (minAge && accountCreatedMs && this.now() - accountCreatedMs < minAge * 86_400_000) {
      return { raid: true, young: true, reason: `account younger than ${minAge} day(s)`, action };
    }
    const win = s.get(guildId, 'raid_window') * 1000; const t = this.now();
    const arr = (this.joins.get(guildId) || []).filter((x) => t - x < win); arr.push(t); this.joins.set(guildId, arr);
    if (s.get(guildId, 'raid_lockdown')) return { raid: true, reason: 'server is in lockdown', action };
    if (arr.length >= s.get(guildId, 'raid_threshold')) return { raid: true, reason: `${arr.length} joins in ${win / 1000}s`, action, flood: true };
    return { raid: false };
  }
  recentJoins(guildId) {
    const win = this.settings.get(guildId, 'raid_window') * 1000; const t = this.now();
    return (this.joins.get(guildId) || []).filter((x) => t - x < win).length;
  }
  reset(guildId) { this.joins.delete(guildId); }
}
module.exports = { AntiRaid };

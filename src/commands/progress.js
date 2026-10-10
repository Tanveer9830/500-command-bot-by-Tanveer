'use strict';
/** Levels, achievements, reputation, profiles, personal preferences & data rights. */
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { ACHIEVEMENTS, xpForLevel } = require('../services/levels');
const { fmtNum, truncate, safe, ts, formatDuration } = require('../utils/text');

const userArg = { name: 'user', type: 'user', description: 'User (default: you)' };
const reqUser = { name: 'user', type: 'user', description: 'The user', required: true };
const lv = (ctx) => ctx.svc.levels;

async function nameOf(ctx, id) { const m = await ctx.getMember({ id }); return safe(m ? m.displayName : `user ${id}`); }

/** Grant the reward role(s) a member has earned at `level`. Returns names of roles added. */
async function applyRewards(guild, member, svc, level) {
  const added = [];
  for (const r of svc.levels.rewardsFor(guild.id, level)) {
    const role = guild.roles.cache.get(r.role_id);
    const me = guild.members.me;
    if (!role || role.managed || (me && role.position >= me.roles.highest.position)) continue;
    if (!member.roles.cache.has(role.id)) { await member.roles.add(role, `Level reward (level ${r.level})`); added.push(role.name); }
  }
  return added;
}

module.exports = function register(registry) {
  // ---------------------------------------------------------------- level
  const L = registry.group({ name: 'level', description: 'XP and levels', category: 'Levels', aliases: ['lvl', 'xp'], defaultSub: 'rank' });
  const LA = (sub, spec, run) => L.action(sub, { guildOnly: true, ...spec }, run);
  LA('rank', { description: 'Show your level card', options: [userArg] }, (ctx) => {
    const u = ctx.args.user || ctx.user; if (u.bot) throw new UserError('Bots do not earn XP.');
    const p = lv(ctx).progress(ctx.guildId, u.id);
    return H.embed(ctx, { title: `${safe(u.username)} — level ${p.level}`, description: `${lv(ctx).bar(p.pct)}\n**${fmtNum(p.into)} / ${fmtNum(p.needed)}** XP to level ${p.level + 1}`, fields: [{ name: 'Rank', value: `#${lv(ctx).rank(ctx.guildId, u.id)}`, inline: true }, { name: 'Total XP', value: fmtNum(p.xp), inline: true }, { name: 'Messages', value: fmtNum(p.messages), inline: true }] });
  });
  LA('top', { description: 'XP leaderboard', options: [{ name: 'page', type: 'integer', description: 'Page', min: 1, max: 100, default: 1 }] }, async (ctx) => {
    const off = (ctx.args.page - 1) * 10; const rows = lv(ctx).top(ctx.guildId, 10, off); const lines = []; let i = off;
    for (const r of rows) lines.push(`**${++i}.** ${await nameOf(ctx, r.user_id)} — level ${r.level} • ${fmtNum(r.xp)} XP`);
    return H.embed(ctx, { title: `XP leaderboard — page ${ctx.args.page}`, description: lines.join('\n') || '_nobody yet_' });
  });
  LA('progress', { description: 'Progress bar to the next level', options: [userArg] }, (ctx) => { const u = ctx.args.user || ctx.user; const p = lv(ctx).progress(ctx.guildId, u.id); return `📈 ${safe(u.username)}: level ${p.level} ${lv(ctx).bar(p.pct)}`; });
  LA('rewards', { description: 'Role rewards for reaching levels' }, (ctx) => H.embed(ctx, { title: 'Level rewards', description: H.listLines(ctx.db.prepare('SELECT level, role_id FROM level_rewards WHERE guild_id = ? ORDER BY level').all(ctx.guildId), (r) => `Level **${r.level}** → <@&${r.role_id}>`, 25) }));
  LA('compare', { description: 'Compare your level with someone', options: [reqUser] }, (ctx) => { const a = lv(ctx).get(ctx.guildId, ctx.user.id); const b = lv(ctx).get(ctx.guildId, ctx.args.user.id); const d = a.xp - b.xp; return `⚖️ You: level ${a.level} (${fmtNum(a.xp)} XP) • ${safe(ctx.args.user.username)}: level ${b.level} (${fmtNum(b.xp)} XP) — ${d === 0 ? 'tied' : d > 0 ? `you lead by ${fmtNum(d)} XP` : `they lead by ${fmtNum(-d)} XP`}.`; });
  LA('nextreward', { description: 'The next role reward you can earn' }, (ctx) => {
    const me = lv(ctx).get(ctx.guildId, ctx.user.id);
    const r = ctx.db.prepare('SELECT level, role_id FROM level_rewards WHERE guild_id = ? AND level > ? ORDER BY level LIMIT 1').get(ctx.guildId, me.level);
    return r ? `🎯 Next reward: <@&${r.role_id}> at level **${r.level}** — ${fmtNum(xpForLevel(r.level) - me.xp)} XP to go.` : 'There is no further level reward configured.';
  });
  LA('howto', { description: 'How XP works in this server' }, (ctx) => H.embed(ctx, { title: 'How XP works', description: lv(ctx).settings.get(ctx.guildId, 'lvl_enabled') ? `Chatting earns **${ctx.cfg('lvl_xp_min')}–${ctx.cfg('lvl_xp_max')} XP** at most once every **${formatDuration(ctx.cfg('lvl_cooldown'))}**. Level 1 needs ${fmtNum(xpForLevel(1))} XP, level 10 needs ${fmtNum(xpForLevel(10))} XP.` : 'Levelling is disabled in this server.' }));

  // `!leaderboard` : one entry for both boards
  L.action('leaderboard', { description: 'Leaderboards (XP or coins)', guildOnly: true, aliases: ['lb', 'top10'], options: [{ name: 'board', type: 'string', description: 'xp or coins', choices: ['xp', 'coins'], default: 'xp' }] }, async (ctx) => {
    const board = ctx.args.board; const rows = board === 'xp' ? lv(ctx).top(ctx.guildId, 10) : ctx.svc.economy.leaderboard(ctx.guildId, 10); const lines = []; let i = 0;
    for (const r of rows) lines.push(`**${++i}.** ${await nameOf(ctx, r.user_id)} — ${board === 'xp' ? `level ${r.level} • ${fmtNum(r.xp)} XP` : ctx.svc.economy.fmt(ctx.guildId, r.total)}`);
    return H.embed(ctx, { title: board === 'xp' ? '🏆 XP leaderboard' : '🏆 Richest members', description: lines.join('\n') || '_nobody yet_' });
  });

  // ----------------------------------------------------- level administration
  const la = registry.group({ name: 'lvladmin', description: 'Level system administration', category: 'Levels Admin', aliases: ['leveladmin'] });
  const A = (sub, spec, run) => la.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  const xpOpt = (d) => ({ name: 'amount', type: 'integer', description: d, required: true, min: 0, max: 100_000_000 });
  A('setlevel', { description: "Set a member's level", options: [reqUser, { name: 'level', type: 'integer', description: 'Level 0-200', required: true, min: 0, max: 200 }] }, (ctx) => { const r = lv(ctx).setLevel(ctx.guildId, ctx.args.user.id, ctx.args.level); return H.ok(`**${safe(ctx.args.user.username)}** is now level ${r.level} (${fmtNum(r.xp)} XP).`); });
  A('setxp', { description: "Set a member's XP", options: [reqUser, xpOpt('Total XP')] }, (ctx) => { const r = lv(ctx).setXp(ctx.guildId, ctx.args.user.id, ctx.args.amount); return H.ok(`**${safe(ctx.args.user.username)}**: ${fmtNum(r.xp)} XP, level ${r.level}.`); });
  A('addxp', { description: 'Give XP to a member', options: [reqUser, xpOpt('XP to add')] }, (ctx) => { const r = lv(ctx).addXp(ctx.guildId, ctx.args.user.id, ctx.args.amount); return H.ok(`Added ${fmtNum(ctx.args.amount)} XP to **${safe(ctx.args.user.username)}** (level ${r.level}).`); });
  A('removexp', { description: 'Remove XP from a member', options: [reqUser, xpOpt('XP to remove')] }, (ctx) => { const r = lv(ctx).addXp(ctx.guildId, ctx.args.user.id, -ctx.args.amount); return H.ok(`Removed XP: **${safe(ctx.args.user.username)}** now has ${fmtNum(r.xp)} XP (level ${r.level}).`); });
  A('reset', { description: "Reset one member's XP", options: [reqUser] }, (ctx) => { lv(ctx).reset(ctx.guildId, ctx.args.user.id); return H.ok(`XP of **${safe(ctx.args.user.username)}** reset.`); });
  A('resetall', { description: 'Reset XP for EVERYONE in the server', perms: ['Administrator'], options: [{ name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] }] }, (ctx) => H.ok(`Reset XP of ${lv(ctx).resetAll(ctx.guildId)} member(s).`));
  const CF = (sub, spec) => H.configAction(la, sub, spec);
  CF('enable', { description: 'Turn levelling on or off', key: 'lvl_enabled', kind: 'bool', label: 'Levelling' });
  CF('xpmin', { description: 'Minimum XP per message', key: 'lvl_xp_min', kind: 'int', label: 'Minimum XP' });
  CF('xpmax', { description: 'Maximum XP per message', key: 'lvl_xp_max', kind: 'int', label: 'Maximum XP' });
  CF('cooldown', { description: 'Seconds between XP awards', key: 'lvl_cooldown', kind: 'int', label: 'XP cooldown (s)' });
  CF('channel', { description: 'Channel for level-up messages (omit = same channel)', key: 'lvl_channel', kind: 'channel', label: 'Level-up channel' });
  CF('message', { description: 'Level-up message ({username} {level} {server})', key: 'lvl_message', kind: 'text', label: 'Level-up message' });
  CF('announce', { description: 'Announce level-ups', key: 'lvl_announce', kind: 'bool', label: 'Level-up announcements' });
  CF('stack', { description: 'Keep earlier reward roles when levelling up', key: 'lvl_stack_rewards', kind: 'bool', label: 'Stacking rewards' });
  A('ignore', { description: 'Stop XP in a channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }] }, (ctx) => { ctx.svc.settings.addTo(ctx.guildId, 'lvl_ignore_channels', ctx.args.channel.id); return H.ok(`No XP in <#${ctx.args.channel.id}>.`); });
  A('unignore', { description: 'Allow XP in a channel again', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }] }, (ctx) => { ctx.svc.settings.removeFrom(ctx.guildId, 'lvl_ignore_channels', ctx.args.channel.id); return H.ok(`XP re-enabled in <#${ctx.args.channel.id}>.`); });
  A('ignores', { description: 'List channels without XP' }, (ctx) => H.embed(ctx, { title: 'XP-ignored channels', description: H.listLines(ctx.cfg('lvl_ignore_channels'), (c) => `<#${c}>`, 30) }));
  A('multiplier', { description: 'Set an XP multiplier for a channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }, { name: 'factor', type: 'number', description: '0.1 to 10', required: true, min: 0.1, max: 10 }] }, (ctx) => { ctx.svc.settings.mapSet(ctx.guildId, 'lvl_multipliers', ctx.args.channel.id, ctx.args.factor); return H.ok(`<#${ctx.args.channel.id}> now gives **${ctx.args.factor}×** XP.`); });
  A('unmultiplier', { description: 'Remove a channel XP multiplier', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }] }, (ctx) => { ctx.svc.settings.mapDel(ctx.guildId, 'lvl_multipliers', ctx.args.channel.id); return H.ok('Multiplier removed.'); });
  A('multipliers', { description: 'List channel XP multipliers' }, (ctx) => H.embed(ctx, { title: 'XP multipliers', description: H.listLines(Object.entries(ctx.cfg('lvl_multipliers')), ([c, f]) => `<#${c}> → **${f}×**`, 30) }));
  A('rewardadd', { description: 'Give a role at a level', perms: ['ManageGuild', 'ManageRoles'], options: [{ name: 'level', type: 'integer', description: 'Level 1-200', required: true, min: 1, max: 200 }, { name: 'role', type: 'role', description: 'Role', required: true }] }, (ctx) => {
    H.assertRoleManageable(ctx, ctx.args.role);
    ctx.db.prepare('INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id').run(ctx.guildId, ctx.args.level, ctx.args.role.id);
    return H.ok(`Level **${ctx.args.level}** now grants <@&${ctx.args.role.id}>.`);
  });
  A('rewardremove', { description: 'Remove a level reward', options: [{ name: 'level', type: 'integer', description: 'Level', required: true, min: 1, max: 200 }] }, (ctx) => { const n = ctx.db.prepare('DELETE FROM level_rewards WHERE guild_id = ? AND level = ?').run(ctx.guildId, ctx.args.level).changes; if (!n) throw new UserError('No reward at that level.'); return H.ok('Reward removed.'); });
  A('sync', { description: "Grant a member the reward roles they've earned", perms: ['ManageGuild', 'ManageRoles'], options: [reqUser] }, async (ctx) => {
    const m = await H.requireMember(ctx, ctx.args.user); const added = await applyRewards(ctx.guild, m, ctx.svc, lv(ctx).get(ctx.guildId, m.id).level);
    return added.length ? H.ok(`Granted: ${added.map(safe).join(', ')}`) : 'Nothing to grant.';
  });
  A('leaderboardreset', { description: 'Reset the leaderboard (keeps nothing)', perms: ['Administrator'], aliases: ['lbreset'], options: [{ name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] }] }, (ctx) => H.ok(`Leaderboard cleared (${lv(ctx).resetAll(ctx.guildId)} entries).`));
  A('stats', { description: 'Level system statistics' }, (ctx) => { const r = ctx.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(xp),0) xp, COALESCE(MAX(level),0) top, COALESCE(SUM(messages),0) msgs FROM levels WHERE guild_id = ?').get(ctx.guildId); return H.embed(ctx, { title: 'Level statistics', description: `Members tracked: **${fmtNum(r.n)}**\nTotal XP: **${fmtNum(r.xp)}**\nHighest level: **${r.top}**\nCounted messages: **${fmtNum(r.msgs)}**` }); });

  // ------------------------------------------------------------ achievements
  const AC = registry.group({ name: 'achievements', description: 'Achievements and badges', category: 'Levels', aliases: ['ach', 'badges'], defaultSub: 'mine' });
  const ACA = (sub, spec, run) => AC.action(sub, { guildOnly: true, ...spec }, run);
  ACA('list', { description: 'All achievements you can earn' }, (ctx) => H.embed(ctx, { title: 'Achievements', description: Object.entries(ACHIEVEMENTS).map(([k, a]) => `**${a.name}** (\`${k}\`) — ${a.description}`).join('\n') }));
  ACA('mine', { description: 'Your unlocked achievements', options: [userArg] }, (ctx) => { const u = ctx.args.user || ctx.user; lv(ctx).evaluate(ctx.guildId, u.id); return H.embed(ctx, { title: `${safe(u.username)}'s achievements`, description: H.listLines(lv(ctx).list(ctx.guildId, u.id), (a) => `🏅 **${ACHIEVEMENTS[a.key].name}** — ${ts(a.ts)}`, 25) }); });
  ACA('progress', { description: 'How many achievements you have', options: [userArg] }, (ctx) => { const u = ctx.args.user || ctx.user; const n = lv(ctx).list(ctx.guildId, u.id).length; const t = Object.keys(ACHIEVEMENTS).length; return `🏅 ${safe(u.username)}: **${n}/${t}** (${H.percent(n, t)}%)`; });
  ACA('info', { description: 'Details about one achievement', options: [{ name: 'key', type: 'string', description: 'Achievement key or name', required: true, maxLength: 40, rest: true }] }, (ctx) => {
    const q = ctx.args.key.toLowerCase(); const hit = Object.entries(ACHIEVEMENTS).find(([k, a]) => k === q || a.name.toLowerCase() === q);
    if (!hit) throw new UserError('Unknown achievement. Use `achievements list`.');
    const holders = ctx.db.prepare('SELECT COUNT(*) n FROM achievements WHERE guild_id = ? AND key = ?').get(ctx.guildId, hit[0]).n;
    return H.embed(ctx, { title: hit[1].name, description: `${hit[1].description}\nEarned by **${holders}** member(s) here.` });
  });
  ACA('recent', { description: 'Recently unlocked achievements in this server' }, async (ctx) => { const rows = ctx.db.prepare('SELECT user_id, key, ts FROM achievements WHERE guild_id = ? ORDER BY ts DESC LIMIT 10').all(ctx.guildId); const lines = []; for (const r of rows) lines.push(`🏅 ${await nameOf(ctx, r.user_id)} — **${ACHIEVEMENTS[r.key].name}** (${ts(r.ts)})`); return H.embed(ctx, { title: 'Recent achievements', description: lines.join('\n') || '_none yet_' }); });

  // -------------------------------------------------------------- reputation
  const R = registry.group({ name: 'rep', description: 'Reputation points', category: 'Social' });
  const RA = (sub, spec, run) => R.action(sub, { guildOnly: true, ...spec }, run);
  RA('give', { description: 'Give someone a reputation point (once every 12h)', options: [reqUser, { name: 'reason', type: 'string', description: 'Why?', maxLength: 200, rest: true }] }, (ctx) => {
    const t = ctx.args.user; if (t.bot) throw new UserError('Bots cannot receive reputation.'); if (t.id === ctx.user.id) throw new UserError('You cannot give reputation to yourself.');
    const e = ctx.svc.economy; const left = e.cooldownLeft(ctx.guildId, ctx.user.id, 'rep'); if (left) throw new UserError(`You can give reputation again in **${formatDuration(left)}**.`);
    ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO rep (guild_id, user_id, points) VALUES (?, ?, 1) ON CONFLICT(guild_id, user_id) DO UPDATE SET points = points + 1').run(ctx.guildId, t.id);
      ctx.db.prepare('INSERT INTO rep_log (guild_id, from_id, to_id, reason) VALUES (?, ?, ?, ?)').run(ctx.guildId, ctx.user.id, t.id, ctx.args.reason || null);
      e.q.cdSet.run(ctx.guildId, ctx.user.id, 'rep', ctx.svc.now() + 12 * 3600);
    })();
    lv(ctx).unlock(ctx.guildId, t.id, 'helper');
    return `⭐ You gave **${safe(t.username)}** a reputation point.`;
  });
  RA('check', { description: 'Show reputation of a user', options: [userArg] }, (ctx) => { const u = ctx.args.user || ctx.user; const r = ctx.db.prepare('SELECT points FROM rep WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, u.id); return `⭐ **${safe(u.username)}** has **${r ? r.points : 0}** reputation.`; });
  RA('top', { description: 'Most respected members' }, async (ctx) => { const rows = ctx.db.prepare('SELECT user_id, points FROM rep WHERE guild_id = ? ORDER BY points DESC LIMIT 10').all(ctx.guildId); const lines = []; let i = 0; for (const r of rows) lines.push(`**${++i}.** ${await nameOf(ctx, r.user_id)} — ${r.points}`); return H.embed(ctx, { title: 'Reputation leaderboard', description: lines.join('\n') || '_nobody yet_' }); });
  RA('history', { description: 'Recent reputation you received', options: [userArg] }, async (ctx) => { const u = ctx.args.user || ctx.user; const rows = ctx.db.prepare('SELECT from_id, reason, ts FROM rep_log WHERE guild_id = ? AND to_id = ? ORDER BY id DESC LIMIT 10').all(ctx.guildId, u.id); const lines = []; for (const r of rows) lines.push(`• ${await nameOf(ctx, r.from_id)} — ${ts(r.ts)}${r.reason ? `: ${safe(truncate(r.reason, 80))}` : ''}`); return H.embed(ctx, { title: `Reputation for ${safe(u.username)}`, description: lines.join('\n') || '_none_' }); });
  RA('given', { description: 'Reputation you have given recently' }, async (ctx) => { const rows = ctx.db.prepare('SELECT to_id, ts FROM rep_log WHERE guild_id = ? AND from_id = ? ORDER BY id DESC LIMIT 10').all(ctx.guildId, ctx.user.id); const lines = []; for (const r of rows) lines.push(`• ${await nameOf(ctx, r.to_id)} — ${ts(r.ts)}`); return H.embed(ctx, { title: 'Reputation you gave', description: lines.join('\n') || '_none_' }); });

  // ----------------------------------------------------------------- profile
  const P = registry.group({ name: 'profile', description: 'Your personal profile', category: 'Social', aliases: ['me'], defaultSub: 'view' });
  const getP = (ctx, id) => ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(id) || {};
  const setP = (ctx, field, value) => { ctx.db.prepare(`INSERT INTO profiles (user_id, ${field}) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ${field} = excluded.${field}`).run(ctx.user.id, value); };
  const PA = (sub, spec, run) => P.action(sub, { ...spec }, run);
  PA('view', { description: 'Show a profile', options: [userArg] }, (ctx) => {
    const u = ctx.args.user || ctx.user; const p = getP(ctx, u.id); const fields = [];
    if (p.pronouns) fields.push({ name: 'Pronouns', value: safe(p.pronouns), inline: true });
    if (p.timezone) fields.push({ name: 'Timezone', value: safe(p.timezone), inline: true });
    if (p.birthday) fields.push({ name: 'Birthday', value: p.birthday, inline: true });
    if (ctx.guildId) { const l = lv(ctx).get(ctx.guildId, u.id); const w = ctx.svc.economy.wallet(ctx.guildId, u.id); fields.push({ name: 'Level', value: String(l.level), inline: true }, { name: 'Net coins', value: fmtNum(w.wallet + w.bank), inline: true }); }
    return H.embed(ctx, { title: `${safe(p.title ? `${p.title} ` : '')}${safe(u.username)}`, description: safe(p.bio) || '_No bio set._', fields, color: p.color ? parseInt(p.color, 16) : undefined });
  });
  PA('bio', { description: 'Set your bio', options: [{ name: 'text', type: 'string', description: 'Up to 300 characters', required: true, maxLength: 300, rest: true }] }, (ctx) => { setP(ctx, 'bio', ctx.args.text); return H.ok('Bio updated.'); });
  PA('color', { description: 'Set your profile colour', options: [{ name: 'hex', type: 'string', description: '#rrggbb', required: true, maxLength: 7 }] }, (ctx) => { const c = H.parseColor(ctx.args.hex); setP(ctx, 'color', c.toString(16).padStart(6, '0')); return H.ok('Colour updated.'); });
  PA('title', { description: 'Set a short title shown before your name', options: [{ name: 'text', type: 'string', description: 'Up to 32 characters', required: true, maxLength: 32, rest: true }] }, (ctx) => { setP(ctx, 'title', ctx.args.text); return H.ok('Title updated.'); });
  PA('pronouns', { description: 'Set your pronouns', options: [{ name: 'text', type: 'string', description: 'e.g. they/them', required: true, maxLength: 24, rest: true }] }, (ctx) => { setP(ctx, 'pronouns', ctx.args.text); return H.ok('Pronouns updated.'); });
  PA('timezone', { description: 'Set your IANA timezone (e.g. Asia/Kolkata)', options: [{ name: 'zone', type: 'string', description: 'IANA timezone', required: true, maxLength: 64 }] }, (ctx) => {
    try { new Intl.DateTimeFormat('en', { timeZone: ctx.args.zone }); } catch { throw new UserError('Unknown timezone. Use an IANA name like `Europe/London` or `Asia/Kolkata`.'); }
    setP(ctx, 'timezone', ctx.args.zone); return H.ok(`Timezone set to **${safe(ctx.args.zone)}**.`);
  });
  PA('birthday', { description: 'Set your birthday (MM-DD)', options: [{ name: 'date', type: 'string', description: 'MM-DD, e.g. 07-21', required: true, maxLength: 5, pattern: /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, patternHelp: 'use MM-DD' }] }, (ctx) => {
    const [m, d] = ctx.args.date.split('-').map(Number); const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (d > dim[m - 1]) throw new UserError('That date does not exist.');
    setP(ctx, 'birthday', ctx.args.date); return H.ok('Birthday saved.');
  });
  PA('clearbirthday', { description: 'Remove your birthday' }, (ctx) => { setP(ctx, 'birthday', null); return H.ok('Birthday removed.'); });
  PA('birthdays', { description: 'Upcoming birthdays in this server', guildOnly: true }, async (ctx) => {
    const now = new Date(ctx.svc.now() * 1000); const rows = ctx.db.prepare('SELECT user_id, birthday FROM profiles WHERE birthday IS NOT NULL').all(); const out = [];
    for (const r of rows) { const m = await ctx.getMember({ id: r.user_id }); if (!m) continue; const [mo, da] = r.birthday.split('-').map(Number); let next = Date.UTC(now.getUTCFullYear(), mo - 1, da); if (next < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) next = Date.UTC(now.getUTCFullYear() + 1, mo - 1, da); out.push({ name: m.displayName, date: r.birthday, next }); }
    out.sort((a, b) => a.next - b.next);
    return H.embed(ctx, { title: '🎂 Upcoming birthdays', description: H.listLines(out, (b) => `**${safe(b.name)}** — ${b.date}`, 10) });
  });
  PA('today', { description: 'Birthdays happening today', guildOnly: true }, async (ctx) => {
    const d = new Date(ctx.svc.now() * 1000); const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; const names = [];
    for (const r of ctx.db.prepare('SELECT user_id FROM profiles WHERE birthday = ?').all(key)) { const m = await ctx.getMember({ id: r.user_id }); if (m) names.push(safe(m.displayName)); }
    return names.length ? `🎉 Happy birthday to ${names.join(', ')}!` : 'No birthdays today.';
  });
  PA('reset', { description: 'Clear your whole profile' }, (ctx) => { ctx.db.prepare('DELETE FROM profiles WHERE user_id = ?').run(ctx.user.id); return H.ok('Profile cleared.'); });

  // ------------------------------------------------- preferences & data rights
  const PR = registry.group({ name: 'prefs', description: 'Personal preferences and your data', category: 'Privacy', aliases: ['settingsme'], defaultSub: 'view' });
  const PREFS = { dm_reminders: { values: ['on', 'off'], default: 'off', help: 'Deliver reminders by DM instead of in the channel' }, levelup_notify: { values: ['channel', 'dm', 'off'], default: 'channel', help: 'Where to hear about your level-ups' }, compact: { values: ['on', 'off'], default: 'off', help: 'Shorter replies where supported' } };
  const prefGet = (ctx, key) => { const r = ctx.db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(ctx.user.id, key); return r ? r.value : PREFS[key].default; };
  PR.action('view', { description: 'Show your preferences' }, (ctx) => H.embed(ctx, { title: 'Your preferences', description: Object.entries(PREFS).map(([k, d]) => `**${k}** = \`${prefGet(ctx, k)}\` — ${d.help} (${d.values.join(' | ')})`).join('\n') }));
  PR.action('set', { description: 'Change a preference', options: [{ name: 'key', type: 'string', description: 'Preference', required: true, choices: Object.keys(PREFS) }, { name: 'value', type: 'string', description: 'New value', required: true, maxLength: 20 }] }, (ctx) => {
    const d = PREFS[ctx.args.key]; const v = ctx.args.value.toLowerCase(); if (!d.values.includes(v)) throw new UserError(`\`${ctx.args.key}\` accepts: ${d.values.join(', ')}.`);
    ctx.db.prepare('INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()').run(ctx.user.id, ctx.args.key, v);
    return H.ok(`**${ctx.args.key}** = \`${v}\``);
  });
  PR.action('reset', { description: 'Restore default preferences' }, (ctx) => { ctx.db.prepare('DELETE FROM user_prefs WHERE user_id = ?').run(ctx.user.id); return H.ok('Preferences reset.'); });
  const USER_TABLES = [['user_prefs', 'user_id'], ['profiles', 'user_id'], ['wallets', 'user_id'], ['transactions', 'user_id'], ['inventory', 'user_id'], ['cooldowns', 'user_id'], ['levels', 'user_id'], ['achievements', 'user_id'], ['rep', 'user_id'], ['reminders', 'user_id'], ['todos', 'user_id'], ['notes', 'user_id'], ['playlists', 'user_id'], ['afk', 'user_id'], ['trivia_scores', 'user_id'], ['game_stats', 'user_id']];
  PR.action('export', { description: 'Download a copy of the data stored about you (JSON)', cooldown: 30 }, (ctx) => {
    const data = { exportedAt: new Date(ctx.svc.now() * 1000).toISOString(), userId: ctx.user.id };
    for (const [t, c] of USER_TABLES) data[t] = ctx.db.prepare(`SELECT * FROM ${t} WHERE ${c} = ?`).all(ctx.user.id);
    data.rep_log = ctx.db.prepare('SELECT * FROM rep_log WHERE from_id = ? OR to_id = ?').all(ctx.user.id, ctx.user.id);
    data.cases_about_you = ctx.db.prepare('SELECT case_no, guild_id, type, reason, ts FROM cases WHERE target_id = ?').all(ctx.user.id);
    return { content: '📦 Here is the data this bot stores about you.', files: [{ name: 'my-data.json', data: JSON.stringify(data, null, 2) }], ephemeral: true };
  });
  PR.action('delete', { description: 'Permanently delete the data stored about you', options: [{ name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] }] }, (ctx) => {
    let n = 0; ctx.db.transaction(() => { for (const [t, c] of USER_TABLES) n += ctx.db.prepare(`DELETE FROM ${t} WHERE ${c} = ?`).run(ctx.user.id).changes; n += ctx.db.prepare('DELETE FROM rep_log WHERE from_id = ? OR to_id = ?').run(ctx.user.id, ctx.user.id).changes; })();
    return { content: `🗑️ Deleted ${n} record(s). Moderation cases and the security audit log are retained for server safety, as described in \`/privacy\`.`, ephemeral: true };
  });
  PR.action('policy', { description: 'What this bot stores about you' }, (ctx) => H.embed(ctx, { title: 'Your data', description: 'Stored only when you use features: profile, preferences, economy, XP, reminders, notes, to-dos, playlists and AFK status. Message text is never stored (only counts). Moderation cases and the audit log are retained for server safety. Use `prefs export` to download your data and `prefs delete confirm` to erase it.' }));

  registry.standalone('rank', 'level.rank');
  registry.standalone('leaderboard', 'level.leaderboard');
};
module.exports.applyRewards = applyRewards;

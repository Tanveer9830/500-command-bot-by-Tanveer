'use strict';
const { PermissionsBitField, ChannelType } = require('discord.js');
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { formatDuration, ts, safe } = require('../utils/text');

const why = (ctx, text) => `${ctx.user.username} (${ctx.user.id}): ${text}`.slice(0, 512);
const CONFIRM = { name: 'confirm', type: 'string', description: 'Type "confirm" to proceed', required: true, choices: ['confirm'] };
const DANGEROUS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ManageWebhooks', 'MentionEveryone', 'ManageMessages', 'ModerateMembers'];

module.exports = function register(registry) {
  // ----------------------------------------------------------------- automod
  const am = registry.group({ name: 'automod', description: 'Automatic moderation rules', category: 'Security', aliases: ['am'] });
  const cfg = (sub, spec) => H.configAction(am, sub, spec);
  am.action('status', { description: 'Show the automod configuration', access: 'admin', guildOnly: true, perms: ['ManageGuild'] }, (ctx) => {
    const g = (k) => ctx.cfg(k);
    return H.embed(ctx, { title: 'Automod', fields: [
      { name: 'Enabled', value: H.show(g('automod_enabled')), inline: true }, { name: 'Action', value: g('automod_action'), inline: true },
      { name: 'Spam', value: `${H.show(g('automod_spam'))} (${g('automod_spam_threshold')} msgs / ${g('automod_spam_window')}s)`, inline: true },
      { name: 'Links', value: H.show(g('automod_links')), inline: true }, { name: 'Invites', value: H.show(g('automod_invites')), inline: true },
      { name: 'Caps %', value: String(g('automod_caps_pct') || 'off'), inline: true }, { name: 'Mention limit', value: String(g('automod_mentions') || 'off'), inline: true },
      { name: 'Emoji limit', value: String(g('automod_emojis') || 'off'), inline: true }, { name: 'Blocked words', value: String(g('automod_badwords').length), inline: true },
      { name: 'Allowed domains', value: String(g('automod_domains').length), inline: true } ] });
  });
  cfg('toggle', { description: 'Turn automod on or off', key: 'automod_enabled', kind: 'bool', label: 'Automod' });
  cfg('spam', { description: 'Toggle spam detection', key: 'automod_spam', kind: 'bool', label: 'Spam detection' });
  cfg('spam-threshold', { description: 'Messages that count as spam', key: 'automod_spam_threshold', kind: 'int', label: 'Spam threshold' });
  cfg('spam-window', { description: 'Spam detection window in seconds', key: 'automod_spam_window', kind: 'int', label: 'Spam window (s)' });
  cfg('links', { description: 'Block links (except allowed domains)', key: 'automod_links', kind: 'bool', label: 'Link filter' });
  cfg('invites', { description: 'Block Discord invite links', key: 'automod_invites', kind: 'bool', label: 'Invite filter' });
  cfg('caps', { description: 'Capitals percentage limit (0 = off)', key: 'automod_caps_pct', kind: 'int', label: 'Caps limit %' });
  cfg('mentions', { description: 'Max mentions per message (0 = off)', key: 'automod_mentions', kind: 'int', label: 'Mention limit' });
  cfg('emojis', { description: 'Max emojis per message (0 = off)', key: 'automod_emojis', kind: 'int', label: 'Emoji limit' });
  cfg('action', { description: 'What to do on a violation', key: 'automod_action', kind: 'enum', label: 'Automod action' });
  cfg('timeout-length', { description: 'Timeout length used by the timeout action', key: 'automod_timeout', kind: 'duration', label: 'Automod timeout (s)', formatValue: (v) => formatDuration(v) });
  H.listActions(am, { key: 'automod_badwords', noun: 'blocked words', addSub: 'badword-add', removeSub: 'badword-remove', listSub: 'badword-list', normalize: (x) => x.toLowerCase().trim(), describeItem: () => 'word' });
  H.listActions(am, { key: 'automod_domains', noun: 'allowed link domains', addSub: 'domain-allow', removeSub: 'domain-deny', listSub: 'domain-list', normalize: (x) => x.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim(), describeItem: (x) => x });
  H.listActions(am, { key: 'automod_exempt_channels', noun: 'automod-exempt channels', addSub: 'exempt-channel-add', removeSub: 'exempt-channel-remove', type: 'channel', optName: 'channel', describeItem: (c) => c.name });
  H.listActions(am, { key: 'automod_exempt_roles', noun: 'automod-exempt roles', addSub: 'exempt-role-add', removeSub: 'exempt-role-remove', type: 'role', optName: 'role', describeItem: (r) => r.name });
  am.action('test', { description: 'Test which rule a message would trigger', access: 'admin', guildOnly: true, perms: ['ManageGuild'], options: [{ name: 'text', type: 'string', description: 'Sample message', required: true, maxLength: 500, rest: true }] }, (ctx) => {
    const { AutoMod } = require('../security/automod');
    const probe = new AutoMod({ settings: ctx.svc.settings, now: () => 0 });
    const hit = probe.inspect({ guildId: ctx.guildId, userId: 'probe', content: ctx.args.text, mentionCount: (ctx.args.text.match(/<@[!&]?\d+>/g) || []).length, channelId: 'probe' });
    return hit ? `🛑 Would trigger **${hit.rule}** (${hit.detail}).` : ctx.cfg('automod_enabled') ? '✅ Would pass all rules.' : '✅ No rule triggered (automod is currently disabled).';
  });
  am.action('reset', { description: 'Reset all automod settings to defaults', access: 'admin', guildOnly: true, perms: ['ManageGuild'], options: [CONFIRM] }, (ctx) => {
    for (const k of ctx.svc.settings.keys().filter((x) => x.startsWith('automod_'))) ctx.svc.settings.reset(ctx.guildId, k);
    return H.ok('Automod settings reset to defaults.');
  });

  // -------------------------------------------------------------- anti-raid
  const rd = registry.group({ name: 'raid', description: 'Anti-raid protection', category: 'Security', aliases: ['antiraid'] });
  const RA = (sub, spec, run) => rd.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  RA('status', { description: 'Show anti-raid settings and recent joins' }, (ctx) => H.embed(ctx, { title: 'Anti-raid', fields: [
    { name: 'Enabled', value: H.show(ctx.cfg('raid_enabled')), inline: true }, { name: 'Lockdown', value: H.show(ctx.cfg('raid_lockdown')), inline: true },
    { name: 'Trigger', value: `${ctx.cfg('raid_threshold')} joins / ${ctx.cfg('raid_window')}s`, inline: true }, { name: 'Min account age', value: `${ctx.cfg('raid_min_age_days')} day(s)`, inline: true },
    { name: 'Action', value: ctx.cfg('raid_action'), inline: true }, { name: 'Joins in window', value: String(ctx.svc.antiraid.recentJoins(ctx.guildId)), inline: true } ] }));
  H.configAction(rd, 'toggle', { description: 'Turn anti-raid on or off', key: 'raid_enabled', kind: 'bool', label: 'Anti-raid' });
  H.configAction(rd, 'threshold', { description: 'Joins within the window that trigger a raid', key: 'raid_threshold', kind: 'int', label: 'Raid threshold' });
  H.configAction(rd, 'window', { description: 'Join-counting window in seconds', key: 'raid_window', kind: 'int', label: 'Raid window (s)' });
  H.configAction(rd, 'minage', { description: 'Minimum account age in days (0 = off)', key: 'raid_min_age_days', kind: 'int', label: 'Minimum account age (days)' });
  H.configAction(rd, 'action', { description: 'Action taken against raiders', key: 'raid_action', kind: 'enum', label: 'Raid action' });
  H.listActions(rd, { key: 'raid_whitelist', noun: 'anti-raid whitelisted users', addSub: 'whitelist-add', removeSub: 'whitelist-remove', listSub: 'whitelist-list', type: 'user', optName: 'user', describeItem: (u) => u.username || u.id });
  const lock = (on) => async (ctx) => {
    const text = [...ctx.guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText);
    let n = 0;
    for (const c of text) { try { await c.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: on ? false : null }, { reason: why(ctx, on ? 'lockdown' : 'unlockdown') }); n++; } catch { /* skip */ } }
    ctx.svc.settings.set(ctx.guildId, 'raid_lockdown', on);
    return H.ok(`${on ? '🔒 Lockdown enabled' : '🔓 Lockdown lifted'}: ${n}/${text.length} text channels updated.`);
  };
  RA('lockdown', { description: 'Lock every text channel and gate new joins', perms: ['ManageChannels'], botPerms: ['ManageChannels'], cooldown: 30, options: [CONFIRM] }, lock(true));
  RA('unlockdown', { description: 'Lift the server lockdown', perms: ['ManageChannels'], botPerms: ['ManageChannels'], cooldown: 30 }, lock(false));
  RA('recent', { description: 'Count joins in the current window' }, (ctx) => `📈 ${ctx.svc.antiraid.recentJoins(ctx.guildId)} join(s) in the last ${ctx.cfg('raid_window')}s.`);
  RA('kickyoung', { description: 'Kick members that joined in the last N minutes', perms: ['KickMembers'], botPerms: ['KickMembers'], cooldown: 30, options: [{ name: 'minutes', type: 'integer', description: '1-1440', required: true, min: 1, max: 1440 }, CONFIRM] }, async (ctx) => {
    const cutoff = Date.now() - ctx.args.minutes * 60_000;
    const all = await ctx.guild.members.fetch();
    const targets = [...all.values()].filter((m) => !m.user.bot && m.joinedTimestamp > cutoff && m.id !== ctx.user.id && m.id !== ctx.guild.ownerId && !m.permissions.has('ManageGuild'));
    if (targets.length > 50) throw new UserError(`${targets.length} members match; the limit is 50 per run.`);
    let n = 0;
    for (const m of targets) { try { H.assertCanModerate(ctx, m); await m.kick(why(ctx, 'raid cleanup')); await H.recordCase(ctx, { type: 'kick', user: m.user, reason: 'raid cleanup' }); n++; } catch { /* skip */ } }
    return H.ok(`Kicked ${n} recent member(s).`);
  });
  RA('reset', { description: 'Clear the join counter' }, (ctx) => { ctx.svc.antiraid.reset(ctx.guildId); return H.ok('Join counter reset.'); });

  // ------------------------------------------------------------ verification
  const vf = registry.group({ name: 'verify', description: 'Member verification', category: 'Security', aliases: ['verification'] });
  const VA = (sub, spec, run) => vf.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  VA('status', { description: 'Show verification settings' }, (ctx) => H.embed(ctx, { title: 'Verification', fields: [
    { name: 'Enabled', value: H.show(ctx.cfg('verify_enabled')), inline: true }, { name: 'Method', value: ctx.cfg('verify_method'), inline: true },
    { name: 'Role', value: ctx.cfg('verify_role') ? `<@&${ctx.cfg('verify_role')}>` : '_not set_', inline: true },
    { name: 'Channel', value: ctx.cfg('verify_channel') ? `<#${ctx.cfg('verify_channel')}>` : '_not set_', inline: true },
    { name: 'Min account age', value: `${ctx.cfg('verify_min_age_days')} day(s)`, inline: true } ] }));
  H.configAction(vf, 'toggle', { description: 'Turn verification on or off', key: 'verify_enabled', kind: 'bool', label: 'Verification' });
  H.configAction(vf, 'role', { description: 'Role granted after verification', key: 'verify_role', kind: 'role', label: 'Verified role', perms: ['ManageGuild', 'ManageRoles'] });
  H.configAction(vf, 'channel', { description: 'Channel with the verification panel', key: 'verify_channel', kind: 'channel', label: 'Verification channel' });
  H.configAction(vf, 'method', { description: 'Verification method (button or math)', key: 'verify_method', kind: 'enum', label: 'Verification method' });
  H.configAction(vf, 'minage', { description: 'Minimum account age to verify (days)', key: 'verify_min_age_days', kind: 'int', label: 'Verification minimum age (days)' });
  H.configAction(vf, 'message', { description: 'Text shown on the verification panel', key: 'verify_message', kind: 'text', label: 'Verification message' });
  VA('panel', { description: 'Post the verification panel with a button', botPerms: ['SendMessages'] }, async (ctx) => {
    const chId = ctx.cfg('verify_channel'); const role = ctx.cfg('verify_role');
    if (!chId || !role) throw new UserError('Set the verification channel and role first.');
    const ch = ctx.guild.channels.cache.get(chId); if (!ch) throw new UserError('The verification channel no longer exists.');
    await ch.send({ embeds: [{ color: 0x1f6bff, title: '✅ Verification', description: ctx.cfg('verify_message') }], components: require('../core/reply').toPayload({ buttons: [{ id: 'tp:verify', label: 'Verify', style: 'success' }] }).components, allowedMentions: { parse: [] } });
    return H.ok(`Panel posted in **#${ch.name}**.`);
  });
  VA('pending', { description: 'List members without the verified role', perms: ['ManageGuild', 'ManageRoles'] }, async (ctx) => {
    const role = ctx.cfg('verify_role'); if (!role) throw new UserError('No verified role is configured.');
    const all = await ctx.guild.members.fetch();
    const list = [...all.values()].filter((m) => !m.user.bot && !m.roles.cache.has(role));
    return H.embed(ctx, { title: `Unverified members (${list.length})`, description: H.listLines(list, (m) => `• ${safe(m.displayName)} (${m.id})`, 30) });
  });
  VA('force', { description: 'Manually verify a member', perms: ['ManageRoles'], botPerms: ['ManageRoles'], options: [H.userOpt('Member')] }, async (ctx) => {
    const roleId = ctx.cfg('verify_role'); if (!roleId) throw new UserError('No verified role is configured.');
    const role = ctx.guild.roles.cache.get(roleId); if (!role) throw new UserError('The verified role no longer exists.');
    H.assertRoleManageable(ctx, role);
    const m = await H.requireMember(ctx, ctx.args.user); await m.roles.add(role, why(ctx, 'manual verification')); return H.ok(`Verified **${m.displayName}**.`);
  });
  // normal-user verification actions (same code path used by the button)
  vf.action('me', { description: 'Verify yourself and gain access', guildOnly: true, cooldown: 3 }, async (ctx) => verifyStart(ctx));
  vf.action('answer', { description: 'Answer the verification question', guildOnly: true, options: [{ name: 'answer', type: 'integer', description: 'Your answer', required: true }] }, async (ctx) => {
    const st = ctx.svc.games.get(`verify:${ctx.guildId}:${ctx.user.id}`);
    if (!st) throw new UserError('Start with `verify me` first.');
    if (st.answer !== ctx.args.answer) { ctx.svc.games.delete(`verify:${ctx.guildId}:${ctx.user.id}`); throw new UserError('Wrong answer. Run `verify me` for a new question.'); }
    ctx.svc.games.delete(`verify:${ctx.guildId}:${ctx.user.id}`);
    return grantVerified(ctx);
  });
  async function grantVerified(ctx) {
    const roleId = ctx.cfg('verify_role'); const role = roleId && ctx.guild.roles.cache.get(roleId);
    if (!role) throw new UserError('Verification is not fully configured on this server.');
    if (ctx.member.roles.cache.has(role.id)) return 'You are already verified.';
    await ctx.member.roles.add(role, 'self verification');
    return H.ok('You are verified. Welcome!');
  }
  async function verifyStart(ctx) {
    if (!ctx.cfg('verify_enabled')) throw new UserError('Verification is not enabled on this server.');
    const age = ctx.cfg('verify_min_age_days');
    if (age) {
      const created = Number((BigInt(ctx.user.id) >> 22n) + 1420070400000n);
      if (Date.now() - created < age * 86_400_000) throw new UserError(`Your account must be at least ${age} day(s) old to verify.`);
    }
    if (ctx.cfg('verify_method') === 'math') {
      const a = Math.floor(ctx.svc.random() * 9) + 1; const b = Math.floor(ctx.svc.random() * 9) + 1;
      ctx.svc.games.set(`verify:${ctx.guildId}:${ctx.user.id}`, { answer: a + b });
      return { ephemeral: true, content: `🧮 What is **${a} + ${b}**? Reply with \`verify answer <number>\`.` };
    }
    return grantVerified(ctx);
  }

  // ------------------------------------------------------ security diagnostics
  const sc = registry.group({ name: 'security', description: 'Security diagnostics for this server', category: 'Security', aliases: ['sec'] });
  const SA = (sub, spec, run) => sc.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ephemeral: true, ...spec }, run);
  SA('audit', { description: 'Run a configuration security audit' }, (ctx) => {
    const findings = [];
    const bad = (m) => findings.push(`⚠️ ${m}`); const good = (m) => findings.push(`✅ ${m}`);
    ctx.cfg('automod_enabled') ? good('Automod enabled') : bad('Automod is disabled');
    ctx.cfg('raid_enabled') ? good('Anti-raid enabled') : bad('Anti-raid is disabled');
    ctx.cfg('verify_enabled') ? good('Verification enabled') : bad('Verification is disabled');
    Object.keys(ctx.cfg('log_channels')).length ? good('Logging configured') : bad('No log channels configured');
    if (ctx.guild.mfaLevel === 0) bad('2FA is not required for moderators');
    const ev = ctx.guild.roles.everyone.permissions;
    const risky = DANGEROUS.filter((p) => ev.has(p));
    risky.length ? bad(`@everyone has dangerous permissions: ${risky.join(', ')}`) : good('@everyone has no dangerous permissions');
    return H.embed(ctx, { title: 'Security audit', description: findings.join('\n') });
  });
  SA('botperms', { description: 'Check the bot has the permissions it needs' }, (ctx) => {
    const need = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageMessages', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'Connect', 'Speak'];
    const me = ctx.guild.members.me.permissions;
    const missing = need.filter((p) => !me.has(p));
    return missing.length ? `⚠️ Missing: ${missing.join(', ')}` : '✅ I have every permission I need.';
  });
  SA('admins', { description: 'List members with Administrator' }, async (ctx) => {
    const all = await ctx.guild.members.fetch(); const list = [...all.values()].filter((m) => m.permissions.has('Administrator') && !m.user.bot);
    return H.embed(ctx, { title: `Administrators (${list.length})`, description: H.listLines(list, (m) => `• ${safe(m.displayName)} (${m.id})`, 30) });
  });
  SA('dangerousroles', { description: 'List roles with dangerous permissions' }, (ctx) => {
    const rows = [...ctx.guild.roles.cache.values()].filter((r) => r.id !== ctx.guild.id).map((r) => ({ r, p: DANGEROUS.filter((x) => r.permissions.has(x)) })).filter((x) => x.p.length);
    return H.embed(ctx, { title: 'Roles with powerful permissions', description: H.listLines(rows, (x) => `• **${x.r.name}**: ${x.p.join(', ')}`, 25) });
  });
  SA('mfa', { description: 'Show the 2FA requirement for moderation' }, (ctx) => `🔐 2FA requirement for moderators: **${ctx.guild.mfaLevel ? 'enabled' : 'disabled'}**.`);
  SA('bots', { description: 'List bots in the server' }, async (ctx) => {
    const all = await ctx.guild.members.fetch(); const list = [...all.values()].filter((m) => m.user.bot);
    return H.embed(ctx, { title: `Bots (${list.length})`, description: H.listLines(list, (m) => `• ${safe(m.displayName)} (${m.id})`, 30) });
  });
  SA('newaccounts', { description: 'List members with very new accounts', options: [{ name: 'days', type: 'integer', description: 'Account age limit in days', min: 1, max: 90, default: 7 }] }, async (ctx) => {
    const all = await ctx.guild.members.fetch(); const cutoff = Date.now() - ctx.args.days * 86_400_000;
    const list = [...all.values()].filter((m) => Number((BigInt(m.id) >> 22n) + 1420070400000n) > cutoff && !m.user.bot);
    return H.embed(ctx, { title: `Accounts younger than ${ctx.args.days}d (${list.length})`, description: H.listLines(list, (m) => `• ${safe(m.displayName)} (${m.id})`, 30) });
  });
  SA('everyoneperms', { description: 'Show what @everyone can do' }, (ctx) => {
    const names = Object.keys(PermissionsBitField.Flags).filter((p) => ctx.guild.roles.everyone.permissions.has(p));
    return H.embed(ctx, { title: '@everyone permissions', description: names.join(', ') || '_none_' });
  });
  SA('status', { description: 'One-line security health summary' }, (ctx) => {
    const flags = [ctx.cfg('automod_enabled'), ctx.cfg('raid_enabled'), ctx.cfg('verify_enabled'), Object.keys(ctx.cfg('log_channels')).length > 0];
    const score = flags.filter(Boolean).length;
    return `🛡️ Protection score: **${score}/4** (automod, anti-raid, verification, logging). Lockdown: ${H.show(ctx.cfg('raid_lockdown'))}.`;
  });
  void formatDuration; void ts; void UserError;
};

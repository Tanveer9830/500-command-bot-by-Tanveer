'use strict';
const H = require('./_helpers');
const { UserError } = require('../core/errors');
const { formatDuration, truncate, safe, ts, fmtNum } = require('../utils/text');
const { toPayload } = require('../core/reply');

const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// ------------------------------------------------------------- poll rendering
function pollView(ctx, res, closed = false) {
  const { poll, counts, total, voters } = res;
  const desc = poll.options.map((o, i) => `${NUM_EMOJI[i]} **${safe(o)}**\n${ctx.svc.polls.bar(counts[i], total)} ${counts[i]} (${total ? Math.round((counts[i] / total) * 100) : 0}%)`).join('\n\n');
  const isClosed = closed || poll.status !== 'open';
  const rows = [];
  for (let i = 0; i < poll.options.length; i += 5) rows.push(poll.options.slice(i, i + 5).map((o, j) => ({ id: `tp:poll:${poll.id}:${i + j}`, label: truncate(o, 40), style: 'secondary', disabled: isClosed, emoji: NUM_EMOJI[i + j] })));
  return {
    embed: { color: isClosed ? 0x95a5a6 : 0x1f6bff, title: `📊 ${safe(poll.question)}`, description: desc, footer: { text: `Poll #${poll.id} • ${voters} voter(s)${poll.multi ? ' • multiple choice' : ''}${isClosed ? ' • closed' : poll.ends_at ? ` • ends ${new Date(poll.ends_at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}` } },
    buttons: rows,
  };
}

async function postPoll(ctx, poll) {
  const view = pollView(ctx, ctx.svc.polls.results(ctx.guildId, poll.id));
  const target = ctx.channel;
  if (!target || !target.send) return view;
  const msg = await target.send(toPayload(view));
  ctx.svc.polls.setMessage(poll.id, msg.id);
  ctx.db.prepare('UPDATE polls SET channel_id = ? WHERE id = ?').run(target.id, poll.id);
  return `📊 Poll **#${poll.id}** created.`;
}
async function refreshPoll(ctx, id, closed = false) {
  const res = ctx.svc.polls.results(ctx.guildId, id);
  if (res.poll.channel_id && res.poll.message_id) await ctx.svc.editMessage(res.poll.channel_id, res.poll.message_id, toPayload(pollView(ctx, res, closed)));
  return res;
}

// --------------------------------------------------------- giveaway rendering
function giveawayView(g, entries, ended = false, winners = []) {
  return {
    embed: { color: ended ? 0x95a5a6 : 0xf1c40f, title: `🎉 ${safe(g.prize)}`, description: ended
      ? `Winner(s): ${winners.length ? winners.map((w) => `\`${w}\``).join(', ') : 'nobody entered'}`
      : `Press **Enter** to join!\nEnds ${ts(g.ends_at, 'R')} (${ts(g.ends_at, 'f')})\nWinners: **${g.winners}**\nHosted by \`${g.host_id}\``, footer: { text: `Giveaway #${g.id} • ${entries} entr${entries === 1 ? 'y' : 'ies'}` } },
    buttons: [[{ id: `tp:gw:${g.id}`, label: ended ? 'Ended' : 'Enter', style: 'success', disabled: ended, emoji: '🎉' }]],
  };
}
async function finishGiveaway(svc, guildId, id) {
  const { giveaway, winners } = svc.giveaways.end(guildId, id);
  const view = giveawayView(giveaway, svc.giveaways.entries(id).length, true, winners);
  if (giveaway.message_id) await svc.editMessage(giveaway.channel_id, giveaway.message_id, toPayload(view));
  await svc.sendToChannel(giveaway.channel_id, { content: winners.length ? `🎉 Congratulations ${winners.map((w) => `\`${w}\``).join(', ')} — you won **${giveaway.prize}**!` : `😢 Nobody entered the **${giveaway.prize}** giveaway.` });
  return { giveaway, winners };
}

// ----------------------------------------------------------------- tickets
async function openTicket(svc, { guild, member, subject }) {
  const t = svc.tickets.create({ guildId: guild.id, userId: member.id, subject });
  const category = svc.settings.get(guild.id, 'ticket_category');
  const support = svc.settings.get(guild.id, 'ticket_support_role');
  const me = guild.members.me;
  const allow = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'];
  const overwrites = [
    { id: guild.id, deny: ['ViewChannel'] },
    { id: member.id, allow },
    { id: me.id, allow: [...allow, 'ManageChannels', 'ManageMessages'] },
  ];
  if (support && guild.roles.cache.has(support)) overwrites.push({ id: support, allow: [...allow, 'ManageMessages'] });
  let ch;
  try {
    ch = await guild.channels.create({ name: `ticket-${String(t.ticket_no).padStart(4, '0')}`, type: 0, parent: category && guild.channels.cache.has(category) ? category : undefined, permissionOverwrites: overwrites, topic: `Ticket #${t.ticket_no} • opened by ${member.user.username} (${member.id})`, reason: `Ticket #${t.ticket_no}` });
  } catch (e) {
    svc.db.prepare("UPDATE tickets SET status = 'failed' WHERE id = ?").run(t.id);
    throw new UserError('I could not create the ticket channel. Ask an admin to check my Manage Channels permission.');
  }
  svc.tickets.setChannel(t.id, ch.id);
  await ch.send(toPayload({ embed: { color: 0x1f6bff, title: `🎫 Ticket #${t.ticket_no}`, description: `**Subject:** ${safe(t.subject)}\nA staff member will be with you shortly.`, footer: { text: 'Use the button or the ticket close command to close this ticket.' } }, buttons: [[{ id: 'tp:ticket:close', label: 'Close ticket', style: 'danger', emoji: '🔒' }]] }));
  return { ticket: t, channel: ch };
}

async function buildTranscript(channel) {
  const msgs = [...(await channel.messages.fetch({ limit: 100 })).values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return msgs.map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author ? m.author.username : '?'}: ${m.content || ''}${m.attachments && m.attachments.size ? ` [${m.attachments.size} attachment(s)]` : ''}`).join('\n') || '(no messages)';
}

async function closeTicket(ctx, ticket, reason) {
  const ch = ticket.channel_id ? ctx.guild.channels.cache.get(ticket.channel_id) : null;
  ctx.svc.tickets.close(ctx.guildId, ticket.ticket_no, ctx.user.id);
  const tc = ctx.cfg('ticket_transcript_channel');
  if (ch && tc) {
    const text = await buildTranscript(ch);
    await ctx.svc.sendToChannel(tc, { content: `📄 Transcript for ticket #${ticket.ticket_no} (closed by ${ctx.user.username}${reason ? `: ${safe(reason)}` : ''})`, files: [{ name: `ticket-${ticket.ticket_no}.txt`, attachment: Buffer.from(text) }] });
  }
  if (ch) {
    try { await ch.permissionOverwrites.edit(ticket.user_id, { ViewChannel: false }); await ch.setName(`closed-${String(ticket.ticket_no).padStart(4, '0')}`); } catch { /* best effort */ }
  }
  return ch;
}

module.exports = function register(registry) {
  // -------------------------------------------------------------------- poll
  const pg = registry.group({ name: 'poll', description: 'Create and vote on polls', category: 'Polls & Giveaways', aliases: ['polls'], defaultSub: 'create' });
  const parseOptions = (s) => s.split('|').map((x) => x.trim()).filter(Boolean);
  const createOpts = [
    { name: 'question', type: 'string', description: 'The question', required: true, maxLength: 300 },
    { name: 'options', type: 'string', description: 'Options separated by |  (2-10)', required: true, maxLength: 800 },
    { name: 'duration', type: 'duration', description: 'Auto-close after e.g. 1h (optional)', min: 30, max: 30 * 86400 },
  ];
  const make = (ctx, { question, options, multi = false, duration = null }) => {
    const poll = ctx.svc.polls.create({ guildId: ctx.guildId, channelId: ctx.channel && ctx.channel.id, question, options, multi, durationSecs: duration, authorId: ctx.user.id });
    return postPoll(ctx, poll);
  };
  pg.action('create', { description: 'Create a single-choice poll', guildOnly: true, cooldown: 10, options: createOpts }, (ctx) => make(ctx, { question: ctx.args.question, options: parseOptions(ctx.args.options), duration: ctx.args.duration }));
  pg.action('multi', { description: 'Create a multiple-choice poll', guildOnly: true, cooldown: 10, options: createOpts }, (ctx) => make(ctx, { question: ctx.args.question, options: parseOptions(ctx.args.options), multi: true, duration: ctx.args.duration }));
  pg.action('quick', { description: 'Create a Yes/No poll', guildOnly: true, cooldown: 10, options: [{ name: 'question', type: 'string', description: 'The question', required: true, maxLength: 300, rest: true }] }, (ctx) => make(ctx, { question: ctx.args.question, options: ['Yes', 'No'] }));
  pg.action('vote', { description: 'Vote in a poll by option number', guildOnly: true, options: [{ name: 'id', type: 'integer', description: 'Poll ID', required: true, min: 1 }, { name: 'option', type: 'integer', description: 'Option number', required: true, min: 1, max: 10 }] }, async (ctx) => {
    const r = ctx.svc.polls.vote(ctx.guildId, ctx.args.id, ctx.user.id, ctx.args.option - 1);
    await refreshPoll(ctx, ctx.args.id);
    return { ephemeral: true, content: r === 'added' ? `🗳️ Vote recorded for option ${ctx.args.option}.` : `↩️ Vote for option ${ctx.args.option} removed.` };
  });
  pg.action('results', { description: 'Show poll results', guildOnly: true, options: [{ name: 'id', type: 'integer', description: 'Poll ID', required: true, min: 1 }] }, (ctx) => pollView(ctx, ctx.svc.polls.results(ctx.guildId, ctx.args.id)));
  const canManagePoll = (ctx, poll) => { if (poll.author_id !== ctx.user.id && !(ctx.member && ctx.member.permissions.has('ManageMessages'))) throw new UserError('Only the poll author or a moderator can do that.'); };
  pg.action('close', { description: 'Close a poll (author or moderator)', guildOnly: true, options: [{ name: 'id', type: 'integer', description: 'Poll ID', required: true, min: 1 }] }, async (ctx) => {
    const p = ctx.svc.polls.get(ctx.guildId, ctx.args.id); canManagePoll(ctx, p);
    ctx.svc.polls.close(ctx.guildId, p.id); const res = await refreshPoll(ctx, p.id, true);
    return pollView(ctx, { ...res, poll: { ...res.poll, status: 'closed' } }, true);
  });
  pg.action('list', { description: 'List open polls', guildOnly: true }, (ctx) => H.embed(ctx, { title: 'Open polls', description: H.listLines(ctx.svc.polls.list(ctx.guildId), (p) => `• **#${p.id}** ${safe(truncate(p.question, 80))}`, 15) }));
  pg.action('delete', { description: 'Delete a poll (author or moderator)', guildOnly: true, options: [{ name: 'id', type: 'integer', description: 'Poll ID', required: true, min: 1 }] }, (ctx) => {
    const p = ctx.svc.polls.get(ctx.guildId, ctx.args.id); canManagePoll(ctx, p);
    ctx.db.prepare('DELETE FROM polls WHERE id = ?').run(p.id); return H.ok(`Poll #${p.id} deleted.`);
  });
  pg.action('extend', { description: 'Extend an open poll by a duration', guildOnly: true, options: [{ name: 'id', type: 'integer', description: 'Poll ID', required: true, min: 1 }, { name: 'duration', type: 'duration', description: 'e.g. 30m', required: true, min: 30, max: 30 * 86400 }] }, (ctx) => {
    const p = ctx.svc.polls.get(ctx.guildId, ctx.args.id); canManagePoll(ctx, p);
    if (p.status !== 'open') throw new UserError('That poll is closed.');
    const base = Math.max(p.ends_at || ctx.svc.now(), ctx.svc.now());
    ctx.db.prepare('UPDATE polls SET ends_at = ? WHERE id = ?').run(base + ctx.args.duration, p.id);
    return H.ok(`Poll #${p.id} now ends in ${formatDuration(base + ctx.args.duration - ctx.svc.now())}.`);
  });

  // ---------------------------------------------------------------- giveaway
  const gw = registry.group({ name: 'giveaway', description: 'Run and join giveaways', category: 'Polls & Giveaways', aliases: ['gw'] });
  const GA = (sub, spec, run) => gw.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  const idOpt = { name: 'id', type: 'integer', description: 'Giveaway ID', required: true, min: 1 };
  GA('start', { description: 'Start a giveaway in this channel', cooldown: 10, options: [{ name: 'duration', type: 'duration', description: 'e.g. 1h, 2d', required: true, min: 10, max: 90 * 86400 }, { name: 'winners', type: 'integer', description: 'Number of winners', required: true, min: 1, max: 20 }, { name: 'prize', type: 'string', description: 'The prize', required: true, maxLength: 200, rest: true }] }, async (ctx) => {
    const g = ctx.svc.giveaways.create({ guildId: ctx.guildId, channelId: ctx.channel.id, prize: ctx.args.prize, winners: ctx.args.winners, durationSecs: ctx.args.duration, hostId: ctx.user.id });
    const msg = await ctx.channel.send(toPayload(giveawayView(g, 0)));
    ctx.svc.giveaways.setMessage(g.id, msg.id);
    return H.ok(`Giveaway **#${g.id}** started for **${g.prize}**, ending in ${formatDuration(ctx.args.duration)}.`);
  });
  GA('end', { description: 'End a giveaway now and pick winners', options: [idOpt] }, async (ctx) => { const { winners } = await finishGiveaway(ctx.svc, ctx.guildId, ctx.args.id); return H.ok(`Giveaway ended. ${winners.length} winner(s) drawn.`); });
  GA('reroll', { description: 'Draw new winner(s) for an ended giveaway', options: [idOpt, { name: 'count', type: 'integer', description: 'How many (default 1)', min: 1, max: 20, default: 1 }] }, async (ctx) => {
    const w = ctx.svc.giveaways.reroll(ctx.guildId, ctx.args.id, ctx.args.count); const g = ctx.svc.giveaways.get(ctx.guildId, ctx.args.id);
    await ctx.svc.sendToChannel(g.channel_id, { content: `🎉 New winner(s) for **${g.prize}**: ${w.map((x) => `\`${x}\``).join(', ')}` });
    return H.ok(`Rerolled: ${w.map((x) => `\`${x}\``).join(', ')}`);
  });
  GA('cancel', { description: 'Cancel an active giveaway', options: [idOpt] }, async (ctx) => {
    const g = ctx.svc.giveaways.cancel(ctx.guildId, ctx.args.id);
    if (g.message_id) await ctx.svc.editMessage(g.channel_id, g.message_id, toPayload({ embed: { color: 0x95a5a6, title: `🚫 ${safe(g.prize)}`, description: 'This giveaway was cancelled.' } }));
    return H.ok(`Giveaway #${g.id} cancelled.`);
  });
  GA('edit', { description: 'Change the prize of an active giveaway', options: [idOpt, { name: 'prize', type: 'string', description: 'New prize', required: true, maxLength: 200, rest: true }] }, async (ctx) => {
    const g = ctx.svc.giveaways.get(ctx.guildId, ctx.args.id); if (g.status !== 'active') throw new UserError('Only active giveaways can be edited.');
    ctx.db.prepare('UPDATE giveaways SET prize = ? WHERE id = ?').run(ctx.args.prize, g.id);
    if (g.message_id) await ctx.svc.editMessage(g.channel_id, g.message_id, toPayload(giveawayView({ ...g, prize: ctx.args.prize }, ctx.svc.giveaways.entries(g.id).length)));
    return H.ok('Prize updated.');
  });
  GA('delete', { description: 'Delete a giveaway record', options: [idOpt, { name: 'confirm', type: 'string', description: 'Type "confirm"', required: true, choices: ['confirm'] }] }, (ctx) => { ctx.svc.giveaways.get(ctx.guildId, ctx.args.id); ctx.db.prepare('DELETE FROM giveaways WHERE id = ?').run(ctx.args.id); return H.ok('Giveaway deleted.'); });
  GA('entrants', { description: 'Show the number of entrants', options: [idOpt] }, (ctx) => { ctx.svc.giveaways.get(ctx.guildId, ctx.args.id); return `🎟️ ${fmtNum(ctx.svc.giveaways.entries(ctx.args.id).length)} entrant(s).`; });
  gw.action('enter', { description: 'Enter a giveaway', guildOnly: true, options: [idOpt] }, async (ctx) => {
    const n = ctx.svc.giveaways.enter(ctx.guildId, ctx.args.id, ctx.user.id); const g = ctx.svc.giveaways.get(ctx.guildId, ctx.args.id);
    if (g.message_id) await ctx.svc.editMessage(g.channel_id, g.message_id, toPayload(giveawayView(g, n)));
    return { ephemeral: true, content: `🎉 You entered giveaway #${g.id}! (${n} entr${n === 1 ? 'y' : 'ies'})` };
  });
  gw.action('leave', { description: 'Leave a giveaway', guildOnly: true, options: [idOpt] }, (ctx) => { ctx.svc.giveaways.leave(ctx.guildId, ctx.args.id, ctx.user.id); return { ephemeral: true, content: 'You left the giveaway.' }; });
  gw.action('list', { description: 'List active giveaways', guildOnly: true }, (ctx) => H.embed(ctx, { title: 'Active giveaways', description: H.listLines(ctx.svc.giveaways.active(ctx.guildId), (g) => `• **#${g.id}** ${safe(g.prize)} — ends ${ts(g.ends_at)}`, 15) }));
  gw.action('info', { description: 'Show giveaway details', guildOnly: true, options: [idOpt] }, (ctx) => { const g = ctx.svc.giveaways.get(ctx.guildId, ctx.args.id); return giveawayView(g, ctx.svc.giveaways.entries(g.id).length, g.status !== 'active', JSON.parse(g.winner_ids)); });
  gw.action('winners', { description: 'Show winners of an ended giveaway', guildOnly: true, options: [idOpt] }, (ctx) => {
    const g = ctx.svc.giveaways.get(ctx.guildId, ctx.args.id); if (g.status !== 'ended') throw new UserError('That giveaway has not ended.');
    const w = JSON.parse(g.winner_ids); return `🏆 **${safe(g.prize)}**: ${w.length ? w.map((x) => `\`${x}\``).join(', ') : 'no winners'}`;
  });

  // ------------------------------------------------------------------ ticket
  const tk = registry.group({ name: 'ticket', description: 'Support tickets', category: 'Tickets', aliases: ['tickets'], defaultSub: 'open' });
  const TA = (sub, spec, run) => tk.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageMessages'], ...spec }, run);
  const ticketHere = (ctx) => { const t = ctx.svc.tickets.byChannel(ctx.guildId, ctx.channel.id); if (!t) throw new UserError('This is not a ticket channel.'); return t; };
  tk.action('open', { description: 'Open a support ticket', guildOnly: true, cooldown: 15, options: [{ name: 'subject', type: 'string', description: 'What do you need help with?', maxLength: 200, rest: true }] }, async (ctx) => {
    const { ticket, channel } = await openTicket(ctx.svc, { guild: ctx.guild, member: ctx.member, subject: ctx.args.subject });
    return { ephemeral: true, content: `🎫 Ticket #${ticket.ticket_no} opened: <#${channel.id}>` };
  });
  tk.action('close', { description: 'Close this ticket (opener or staff)', guildOnly: true, options: [{ name: 'reason', type: 'string', description: 'Reason', maxLength: 200, rest: true }] }, async (ctx) => {
    const t = ticketHere(ctx);
    if (t.user_id !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) throw new UserError('Only the ticket opener or staff can close it.');
    await closeTicket(ctx, t, ctx.args.reason); return H.ok(`Ticket #${t.ticket_no} closed.`);
  });
  tk.action('add', { description: 'Add a member to this ticket', guildOnly: true, options: [H.userOpt('Member to add')] }, async (ctx) => {
    const t = ticketHere(ctx);
    if (t.user_id !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) throw new UserError('Only the opener or staff can add people.');
    await ctx.channel.permissionOverwrites.edit(ctx.args.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }); return H.ok(`Added **${ctx.args.user.username}** to the ticket.`);
  });
  tk.action('remove', { description: 'Remove a member from this ticket', guildOnly: true, options: [H.userOpt('Member to remove')] }, async (ctx) => {
    const t = ticketHere(ctx);
    if (t.user_id !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) throw new UserError('Only the opener or staff can remove people.');
    if (ctx.args.user.id === t.user_id) throw new UserError('You cannot remove the ticket opener.');
    await ctx.channel.permissionOverwrites.edit(ctx.args.user.id, { ViewChannel: false }); return H.ok(`Removed **${ctx.args.user.username}** from the ticket.`);
  });
  tk.action('info', { description: 'Show information about this ticket', guildOnly: true }, (ctx) => { const t = ticketHere(ctx); return H.embed(ctx, { title: `Ticket #${t.ticket_no}`, description: `Subject: ${safe(t.subject)}\nOpener: \`${t.user_id}\`\nStatus: ${t.status}\nPriority: ${t.priority}\nClaimed by: ${t.claimed_by ? `\`${t.claimed_by}\`` : 'nobody'}\nOpened ${ts(t.created_at)}` }); });
  tk.action('mine', { description: 'List your recent tickets', guildOnly: true }, (ctx) => H.embed(ctx, { title: 'Your tickets', description: H.listLines(ctx.svc.tickets.mine(ctx.guildId, ctx.user.id), (t) => `• **#${t.ticket_no}** ${t.status} — ${safe(truncate(t.subject, 60))}`, 10) }));
  tk.action('rename', { description: 'Rename this ticket channel (opener or staff)', guildOnly: true, options: [{ name: 'name', type: 'string', description: 'New name', required: true, minLength: 1, maxLength: 60, rest: true }] }, async (ctx) => {
    const t = ticketHere(ctx);
    if (t.user_id !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) throw new UserError('Only the opener or staff can rename it.');
    await ctx.channel.setName(`ticket-${ctx.args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 90)); return H.ok('Renamed.');
  });
  tk.action('priority', { description: 'Set the priority of this ticket (opener or staff)', guildOnly: true, options: [{ name: 'level', type: 'string', description: 'low, normal, high', required: true, choices: ['low', 'normal', 'high'] }] }, (ctx) => {
    const t = ticketHere(ctx);
    if (t.user_id !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) throw new UserError('Only the opener or staff can change priority.');
    ctx.db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(ctx.args.level, t.id); return H.ok(`Priority set to **${ctx.args.level}**.`);
  });
  tk.action('transcript', { description: 'Get a transcript of this ticket (opener or staff)', guildOnly: true, ephemeral: true }, async (ctx) => {
    const t = ticketHere(ctx);
    if (t.user_id !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) throw new UserError('Only the opener or staff can get the transcript.');
    return { ephemeral: true, content: `Transcript of ticket #${t.ticket_no}`, files: [{ name: `ticket-${t.ticket_no}.txt`, data: await buildTranscript(ctx.channel) }] };
  });
  TA('claim', { description: 'Claim this ticket as staff' }, (ctx) => { const t = ticketHere(ctx); ctx.svc.tickets.claim(ctx.guildId, t.ticket_no, ctx.user.id); return H.ok(`Ticket #${t.ticket_no} claimed.`); });
  TA('unclaim', { description: 'Release your claim on this ticket' }, (ctx) => {
    const t = ticketHere(ctx); if (t.claimed_by !== ctx.user.id) throw new UserError('You have not claimed this ticket.');
    ctx.db.prepare('UPDATE tickets SET claimed_by = NULL WHERE id = ?').run(t.id); return H.ok('Claim released.');
  });
  TA('list', { description: 'List open tickets', options: [{ name: 'status', type: 'string', description: 'open or closed', choices: ['open', 'closed'], default: 'open' }] }, (ctx) => H.embed(ctx, { title: `${ctx.args.status} tickets`, description: H.listLines(ctx.svc.tickets.list(ctx.guildId, ctx.args.status), (t) => `• **#${t.ticket_no}** \`${t.user_id}\` — ${safe(truncate(t.subject, 50))}${t.channel_id ? ` <#${t.channel_id}>` : ''}`, 15) }));
  TA('forceclose', { description: 'Close any ticket by number', options: [{ name: 'number', type: 'integer', description: 'Ticket number', required: true, min: 1 }, { name: 'reason', type: 'string', description: 'Reason', maxLength: 200, rest: true }] }, async (ctx) => {
    const t = ctx.svc.tickets.byNo(ctx.guildId, ctx.args.number); await closeTicket(ctx, t, ctx.args.reason); return H.ok(`Ticket #${t.ticket_no} closed.`);
  });
  TA('delete', { description: 'Delete the channel of a closed ticket', perms: ['ManageChannels'], botPerms: ['ManageChannels'], options: [{ name: 'number', type: 'integer', description: 'Ticket number', required: true, min: 1 }] }, async (ctx) => {
    const t = ctx.svc.tickets.byNo(ctx.guildId, ctx.args.number); if (t.status !== 'closed') throw new UserError('Close the ticket first.');
    const ch = t.channel_id && ctx.guild.channels.cache.get(t.channel_id); if (!ch) throw new UserError('The ticket channel no longer exists.');
    await ch.delete('ticket delete'); return H.ok(`Channel of ticket #${t.ticket_no} deleted.`);
  });
  TA('stats', { description: 'Ticket statistics' }, (ctx) => { const s = ctx.svc.tickets.stats(ctx.guildId); return H.embed(ctx, { title: 'Ticket statistics', description: `Total: ${s.total}\nOpen: ${s.open}\nClosed: ${s.closed}\nAverage resolution: ${formatDuration(s.avgSecs)}` }); });
  TA('blacklist', { description: 'Stop a user from opening tickets', perms: ['ManageGuild'], options: [H.userOpt(), H.reasonOpt] }, (ctx) => { ctx.db.prepare('INSERT OR REPLACE INTO ticket_blacklist (guild_id, user_id, reason) VALUES (?, ?, ?)').run(ctx.guildId, ctx.args.user.id, ctx.args.reason || null); return H.ok(`**${ctx.args.user.username || ctx.args.user.id}** can no longer open tickets.`); });
  TA('unblacklist', { description: 'Allow a user to open tickets again', perms: ['ManageGuild'], options: [H.userOpt()] }, (ctx) => { if (!ctx.db.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?').run(ctx.guildId, ctx.args.user.id).changes) throw new UserError('That user is not blacklisted.'); return H.ok('Ticket access restored.'); });
  TA('panel', { description: 'Post a ticket panel with an "Open ticket" button', perms: ['ManageGuild'], botPerms: ['SendMessages'], options: [{ name: 'channel', type: 'channel', description: 'Where to post (default: current)' }] }, async (ctx) => {
    const ch = ctx.args.channel || ctx.channel;
    await ch.send(toPayload({ embed: { color: 0x1f6bff, title: '🎫 Support', description: ctx.cfg('ticket_panel_text') }, buttons: [[{ id: 'tp:ticket:open', label: 'Open a ticket', style: 'primary', emoji: '🎫' }]] }));
    return H.ok(`Ticket panel posted in **#${ch.name}**.`);
  });
  H.configAction(tk, 'category', { description: 'Category where tickets are created', key: 'ticket_category', kind: 'channel', textChannelsOnly: false, label: 'Ticket category' });
  H.configAction(tk, 'supportrole', { description: 'Role that can see all tickets', key: 'ticket_support_role', kind: 'role', label: 'Support role' });
  H.configAction(tk, 'limit', { description: 'Max open tickets per user', key: 'ticket_limit', kind: 'int', label: 'Ticket limit' });
  H.configAction(tk, 'transcripts', { description: 'Channel that receives transcripts', key: 'ticket_transcript_channel', kind: 'channel', label: 'Transcript channel' });
  H.configAction(tk, 'paneltext', { description: 'Text shown on the ticket panel', key: 'ticket_panel_text', kind: 'text', label: 'Panel text' });

  // ----------------------------------------------------------------- suggest
  const sg = registry.group({ name: 'suggest', description: 'Community suggestions', category: 'Community', aliases: ['suggestion', 'suggestions'] });
  const SGA = (sub, spec, run) => sg.action(sub, { access: 'admin', guildOnly: true, perms: ['ManageGuild'], ...spec }, run);
  sg.action('submit', { description: 'Submit a suggestion', guildOnly: true, cooldown: 30, options: [{ name: 'text', type: 'string', description: 'Your suggestion', required: true, minLength: 5, maxLength: 1000, rest: true }] }, async (ctx) => {
    const r = ctx.db.prepare('INSERT INTO suggestions (guild_id, user_id, text, ts) VALUES (?, ?, ?, ?)').run(ctx.guildId, ctx.user.id, ctx.args.text, ctx.svc.now());
    const id = Number(r.lastInsertRowid);
    const ch = ctx.cfg('suggest_channel');
    if (ch) { const m = await ctx.svc.sendToChannel(ch, { embeds: [{ color: 0x1f6bff, title: `💡 Suggestion #${id}`, description: safe(ctx.args.text), footer: { text: `By ${ctx.user.username} • pending` } }] }); if (m) { ctx.db.prepare('UPDATE suggestions SET message_id = ? WHERE id = ?').run(m.id, id); try { await m.react('👍'); await m.react('👎'); } catch { /* optional */ } } }
    return H.ok(`Suggestion **#${id}** submitted.`);
  });
  sg.action('view', { description: 'View a suggestion', guildOnly: true, options: [{ name: 'id', type: 'integer', description: 'Suggestion ID', required: true, min: 1 }] }, (ctx) => {
    const s = ctx.db.prepare('SELECT * FROM suggestions WHERE guild_id = ? AND id = ?').get(ctx.guildId, ctx.args.id); if (!s) throw new UserError('No such suggestion.');
    return H.embed(ctx, { title: `Suggestion #${s.id} — ${s.status}`, description: `${safe(s.text)}${s.note ? `\n\n**Staff note:** ${safe(s.note)}` : ''}`, footer: { text: `By ${s.user_id}` } });
  });
  sg.action('list', { description: 'List recent suggestions', guildOnly: true, options: [{ name: 'status', type: 'string', description: 'pending, approved, denied, considering', choices: ['pending', 'approved', 'denied', 'considering'], default: 'pending' }] }, (ctx) => H.embed(ctx, { title: `${ctx.args.status} suggestions`, description: H.listLines(ctx.db.prepare('SELECT * FROM suggestions WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT 15').all(ctx.guildId, ctx.args.status), (s) => `• **#${s.id}** ${safe(truncate(s.text, 80))}`, 15) }));
  const decide = (status) => async (ctx) => {
    const s = ctx.db.prepare('SELECT * FROM suggestions WHERE guild_id = ? AND id = ?').get(ctx.guildId, ctx.args.id); if (!s) throw new UserError('No such suggestion.');
    ctx.db.prepare('UPDATE suggestions SET status = ?, note = ? WHERE id = ?').run(status, ctx.args.note || null, s.id);
    const ch = ctx.cfg('suggest_channel');
    if (ch && s.message_id) await ctx.svc.editMessage(ch, s.message_id, { embeds: [{ color: { approved: 0x2ecc71, denied: 0xe74c3c, considering: 0xf1c40f }[status], title: `💡 Suggestion #${s.id} — ${status}`, description: `${safe(s.text)}${ctx.args.note ? `\n\n**Staff note:** ${safe(ctx.args.note)}` : ''}` }] });
    return H.ok(`Suggestion #${s.id} marked **${status}**.`);
  };
  const decideOpts = [{ name: 'id', type: 'integer', description: 'Suggestion ID', required: true, min: 1 }, { name: 'note', type: 'string', description: 'Staff note', maxLength: 500, rest: true }];
  SGA('approve', { description: 'Approve a suggestion', options: decideOpts }, decide('approved'));
  SGA('deny', { description: 'Deny a suggestion', options: decideOpts }, decide('denied'));
  SGA('consider', { description: 'Mark a suggestion as under consideration', options: decideOpts }, decide('considering'));
  SGA('delete', { description: 'Delete a suggestion', options: [{ name: 'id', type: 'integer', description: 'Suggestion ID', required: true, min: 1 }] }, (ctx) => { if (!ctx.db.prepare('DELETE FROM suggestions WHERE guild_id = ? AND id = ?').run(ctx.guildId, ctx.args.id).changes) throw new UserError('No such suggestion.'); return H.ok('Deleted.'); });
  H.configAction(sg, 'channel', { description: 'Channel where suggestions are posted', key: 'suggest_channel', kind: 'channel', label: 'Suggestion channel' });
};
module.exports.finishGiveaway = finishGiveaway;
module.exports.openTicket = openTicket;
module.exports.pollView = pollView;
module.exports.giveawayView = giveawayView;

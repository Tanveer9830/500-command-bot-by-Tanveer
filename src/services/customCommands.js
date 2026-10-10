'use strict';
/**
 * Custom commands: validated templates rendered with a fixed set of safe
 * placeholders. No eval, no shell, no arbitrary code. Output is plain text and
 * is always sent with allowedMentions disabled, so templates cannot ping.
 *
 * Scope: 'global' (Global Owner only) or a guild ID (requires ManageGuild unless
 * the guild policy is "disabled").
 */
const { UserError } = require('../core/errors');
const { NAME_RE } = require('../core/registry');
const { evaluate } = require('./safeMath');
const { isGlobalOwner } = require('../security/authz');

const MAX_LEN = 1500;
const TOKEN_RE = /\{([a-z0-9_]+)(?::([^{}]*))?\}/gi;
const SIMPLE = new Set(['user', 'username', 'userid', 'server', 'channel', 'args', 'count', 'date', 'time', 'membercount', 'uses', 'newline']);

function validateTemplate(text) {
  if (typeof text !== 'string' || !text.trim()) throw new UserError('The response cannot be empty.');
  if (text.length > MAX_LEN) throw new UserError(`The response is limited to ${MAX_LEN} characters.`);
  if (/<@[!&]?\d+>|@everyone|@here/i.test(text)) throw new UserError('Custom responses may not contain user, role or mass mentions.');
  const bad = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const name = m[1].toLowerCase();
    if (SIMPLE.has(name) || /^arg[1-9]$/.test(name)) continue;
    if (name === 'random' || name === 'choose') { if (!m[2] || m[2].split('|').length < 2) bad.push(`{${name}} needs options: {${name}:a|b|c}`); continue; }
    if (name === 'math') { try { evaluate(m[2] || ''); } catch (e) { bad.push(`{math:${m[2]}} → ${e.message}`); } continue; }
    if (name === 'upper' || name === 'lower') continue;
    bad.push(`unknown placeholder {${name}}`);
  }
  if (bad.length) throw new UserError(`Invalid template: ${bad.join('; ')}`);
  return text;
}

class CustomCommands {
  constructor({ db, registry, settings, now = () => Math.floor(Date.now() / 1000), random = Math.random }) {
    this.db = db; this.registry = registry; this.settings = settings; this.now = now; this.random = random;
  }

  validateName(name) {
    const n = String(name).toLowerCase();
    if (!NAME_RE.test(n)) throw new UserError('Names must be 1-32 characters: letters, digits, `_` or `-`.');
    if (this.registry.reservedNames && this.registry.reservedNames.has(n)) throw new UserError(`\`${n}\` is a built-in command or alias.`);
    return n;
  }

  /** May `actor` manage commands in `scope`? (Permission is verified again here, never trusted from the caller.) */
  assertCanManage(scope, { userId, member, guildId }) {
    if (scope === 'global') {
      if (!isGlobalOwner(userId)) throw new UserError('Only the Global Owner can manage global custom commands.');
      return;
    }
    if (scope !== guildId) throw new UserError('Invalid scope.');
    if (this.settings.get(scope, 'custom_commands_policy') === 'disabled') throw new UserError('Server custom commands are disabled by this server\'s policy.');
    if (!member || !member.permissions || !member.permissions.has('ManageGuild')) throw new UserError('You need the Manage Server permission to manage custom commands here.');
  }

  find(scope, name) {
    return this.db.prepare('SELECT * FROM custom_commands WHERE scope = ? AND name = ?').get(scope, String(name).toLowerCase());
  }
  list(scope, includeDeleted = false) {
    return this.db.prepare(`SELECT * FROM custom_commands WHERE scope = ? ${includeDeleted ? '' : 'AND deleted = 0'} ORDER BY name`).all(scope);
  }

  _hist(cmd, action, actorId) {
    this.db.prepare('INSERT INTO custom_command_history (command_id, scope, name, action, response, actor_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(cmd.id, cmd.scope, cmd.name, action, cmd.response, actorId, this.now());
  }

  add(scope, name, response, actor) {
    this.assertCanManage(scope, actor);
    const n = this.validateName(name); validateTemplate(response);
    return this.db.transaction(() => {
      if (scope !== 'global' && this.find('global', n)) throw new UserError(`A global custom command named \`${n}\` already exists.`);
      if (scope === 'global') {
        const clash = this.db.prepare("SELECT COUNT(*) c FROM custom_commands WHERE scope != 'global' AND name = ? AND deleted = 0").get(n).c;
        if (clash) throw new UserError(`${clash} server(s) already use \`${n}\`; choose another name.`);
      }
      const existing = this.find(scope, n);
      if (existing && !existing.deleted) throw new UserError(`\`${n}\` already exists. Use edit instead.`);
      let id;
      if (existing) { this.db.prepare('UPDATE custom_commands SET response = ?, deleted = 0, enabled = 1, version = version + 1, created_by = ?, updated_at = ? WHERE id = ?').run(response, actor.userId, this.now(), existing.id); id = existing.id; }
      else id = Number(this.db.prepare('INSERT INTO custom_commands (scope, name, response, created_by, updated_at) VALUES (?, ?, ?, ?, ?)').run(scope, n, response, actor.userId, this.now()).lastInsertRowid);
      const cmd = this.db.prepare('SELECT * FROM custom_commands WHERE id = ?').get(id);
      this._hist(cmd, 'create', actor.userId);
      return cmd;
    })();
  }
  edit(scope, name, response, actor) {
    this.assertCanManage(scope, actor); validateTemplate(response);
    return this.db.transaction(() => {
      const cmd = this.find(scope, name);
      if (!cmd || cmd.deleted) throw new UserError(`No custom command named \`${name}\`.`);
      this.db.prepare('UPDATE custom_commands SET response = ?, version = version + 1, updated_at = ? WHERE id = ?').run(response, this.now(), cmd.id);
      const next = this.db.prepare('SELECT * FROM custom_commands WHERE id = ?').get(cmd.id);
      this._hist(next, 'edit', actor.userId);
      return next;
    })();
  }
  remove(scope, name, actor) {
    this.assertCanManage(scope, actor);
    return this.db.transaction(() => {
      const cmd = this.find(scope, name);
      if (!cmd || cmd.deleted) throw new UserError(`No custom command named \`${name}\`.`);
      this.db.prepare('UPDATE custom_commands SET deleted = 1, updated_at = ? WHERE id = ?').run(this.now(), cmd.id);
      this._hist(cmd, 'delete', actor.userId);
      return cmd;
    })();
  }
  restore(scope, name, actor) {
    this.assertCanManage(scope, actor);
    return this.db.transaction(() => {
      const cmd = this.find(scope, name);
      if (!cmd || !cmd.deleted) throw new UserError(`\`${name}\` is not deleted.`);
      this.db.prepare('UPDATE custom_commands SET deleted = 0, updated_at = ? WHERE id = ?').run(this.now(), cmd.id);
      this._hist(cmd, 'restore', actor.userId);
      return this.find(scope, name);
    })();
  }
  setEnabled(scope, name, enabled, actor) {
    this.assertCanManage(scope, actor);
    const cmd = this.find(scope, name);
    if (!cmd || cmd.deleted) throw new UserError(`No custom command named \`${name}\`.`);
    this.db.prepare('UPDATE custom_commands SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, this.now(), cmd.id);
    this._hist(cmd, enabled ? 'enable' : 'disable', actor.userId);
    return this.find(scope, name);
  }
  history(scope, name, limit = 10) {
    return this.db.prepare('SELECT * FROM custom_command_history WHERE scope = ? AND name = ? COLLATE NOCASE ORDER BY id DESC LIMIT ?').all(scope, String(name), limit);
  }
  /** Restore the response text from an earlier history entry (a new version, so history is never rewritten). */
  rollback(scope, name, historyId, actor) {
    this.assertCanManage(scope, actor);
    const h = this.db.prepare('SELECT * FROM custom_command_history WHERE id = ? AND scope = ? AND name = ? COLLATE NOCASE').get(historyId, scope, name);
    if (!h || !h.response) throw new UserError('History entry not found.');
    return this.edit(scope, name, h.response, actor);
  }

  /** Look up an executable command: global first, then the guild's own. */
  resolve(guildId, name) {
    const n = String(name).toLowerCase();
    const g = this.find('global', n);
    if (g && !g.deleted && g.enabled) return g;
    if (guildId && this.settings.get(guildId, 'custom_commands_policy') !== 'disabled') {
      const s = this.find(guildId, n);
      if (s && !s.deleted && s.enabled) return s;
    }
    return null;
  }

  render(cmd, { user, guild, channel, args = [] }) {
    this.db.prepare('UPDATE custom_commands SET uses = uses + 1 WHERE id = ?').run(cmd.id);
    const uses = cmd.uses + 1;
    const now = new Date();
    const out = cmd.response.replace(TOKEN_RE, (all, rawName, param) => {
      const name = rawName.toLowerCase();
      switch (name) {
        case 'user': case 'username': return user.username || user.id;
        case 'userid': return user.id;
        case 'server': return guild ? guild.name : 'DM';
        case 'channel': return channel && channel.name ? `#${channel.name}` : 'this channel';
        case 'args': return args.join(' ');
        case 'count': case 'uses': return String(uses);
        case 'membercount': return String(guild ? guild.memberCount : 0);
        case 'date': return now.toISOString().slice(0, 10);
        case 'time': return now.toISOString().slice(11, 16) + ' UTC';
        case 'newline': return '\n';
        case 'random': case 'choose': { const o = param.split('|'); return o[Math.floor(this.random() * o.length)]; }
        case 'math': try { return String(evaluate(param)); } catch { return '[math error]'; }
        case 'upper': return (param || '').toUpperCase();
        case 'lower': return (param || '').toLowerCase();
        default: if (/^arg[1-9]$/.test(name)) return args[Number(name.slice(3)) - 1] || ''; return all;
      }
    });
    return out.slice(0, 2000);
  }
}

module.exports = { CustomCommands, validateTemplate };

'use strict';
/**
 * Command registry: the single source of truth for slash definitions, prefix
 * routing, the inventory and tests. Handlers are kept in private class fields
 * so they can only be reached through `Action#execute` (see executor.js) –
 * there is no public `run` that could bypass authorization.
 */
const { PermissionsBitField } = require('discord.js');
const { VALID_PERMS } = require('../security/authz');

const OPT_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'user', 'channel', 'role', 'duration']);
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ACCESS = new Set(['user', 'admin', 'owner']);
const SLASH_TYPE = { string: 3, integer: 4, boolean: 5, user: 6, channel: 7, role: 8, number: 10, duration: 3 };

class Action {
  #run;
  #execute;
  constructor(spec, group, run) {
    Object.assign(this, spec);
    this.group = group;
    this.#run = run;
    Object.defineProperty(this, 'key', { value: [group.name, spec.subgroup, spec.sub].filter(Boolean).join('.'), enumerable: true });
  }
  /** Bound by executor.js. Always performs the full authorization pipeline. */
  bindExecutor(fn) { this.#execute = fn; }
  execute(ctx) {
    if (!this.#execute) throw new Error('executor not bound');
    return this.#execute(this, ctx);
  }
  /** Used only by the executor after all checks passed. */
  _invoke(ctx) { return this.#run(ctx); }
  get category() { return this.group.category; }
  get classification() { return this.access === 'user' ? 'normal' : 'admin'; }
  get usage() {
    const opts = this.options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    return `${[this.group.name, this.subgroup, this.sub].filter(Boolean).join(' ')} ${opts}`.trim();
  }
}

class Registry {
  constructor() {
    this.groups = new Map();
    this.actions = new Map();
    this.executor = null;
  }

  group(def) {
    if (!NAME_RE.test(def.name)) throw new Error(`invalid group name: ${def.name}`);
    if (this.groups.has(def.name)) throw new Error(`duplicate group: ${def.name}`);
    if (!def.description || def.description.length > 100) throw new Error(`group ${def.name}: description required (<=100 chars)`);
    const group = { name: def.name, description: def.description, category: def.category || def.name, aliases: def.aliases || [], defaultSub: def.defaultSub || null, actions: [], subgroups: new Map(), standalone: false };
    this.groups.set(def.name, group);
    const self = this;
    const defaults = def.defaults || {};
    const api = {
      group,
      subgroup(name, description) { group.subgroups.set(name, description); return api; },
      action(sub, spec, run) {
        if (typeof spec === 'function') { run = spec; spec = {}; }
        return self._addAction(group, { ...defaults, ...spec, sub }, run);
      },
    };
    return api;
  }

  /**
   * A top-level slash command with no subcommands that wraps one action.
   * `def.action` is the action key in some other group; the entry point is only
   * a second route to the SAME action (not an additional action).
   */
  standalone(name, actionKey) {
    this.standalones = this.standalones || new Map();
    if (this.standalones.has(name)) throw new Error(`duplicate standalone ${name}`);
    this.standalones.set(name, actionKey);
  }

  _addAction(group, spec, run) {
    if (typeof run !== 'function') throw new Error(`${group.name}.${spec.sub}: handler must be a function`);
    if (!NAME_RE.test(spec.sub)) throw new Error(`invalid action name ${group.name}.${spec.sub}`);
    if (spec.subgroup && !NAME_RE.test(spec.subgroup)) throw new Error(`invalid subgroup ${spec.subgroup}`);
    const description = spec.description || spec.desc;
    if (!description || description.length > 100) throw new Error(`${group.name}.${spec.sub}: description required (<=100 chars)`);
    const access = spec.access || 'user';
    if (!ACCESS.has(access)) throw new Error(`${group.name}.${spec.sub}: bad access ${access}`);
    const perms = spec.perms || [];
    for (const p of [...perms, ...(spec.botPerms || [])]) if (!VALID_PERMS.has(p)) throw new Error(`${group.name}.${spec.sub}: unknown permission ${p}`);
    if (access === 'admin' && !perms.length) throw new Error(`${group.name}.${spec.sub}: admin actions must declare perms`);
    const options = (spec.options || []).map((o) => ({ required: false, ...o }));
    let seenOptional = false;
    options.forEach((o, i) => {
      if (!OPT_TYPES.has(o.type)) throw new Error(`${group.name}.${spec.sub}: bad option type ${o.type}`);
      if (!NAME_RE.test(o.name)) throw new Error(`${group.name}.${spec.sub}: bad option name ${o.name}`);
      if (!o.description || o.description.length > 100) throw new Error(`${group.name}.${spec.sub}.${o.name}: description required`);
      if (o.required && seenOptional) throw new Error(`${group.name}.${spec.sub}: required option ${o.name} after optional`);
      if (!o.required) seenOptional = true;
      if (o.rest && i !== options.length - 1) throw new Error(`${group.name}.${spec.sub}: rest option must be last`);
      if (o.choices && o.choices.length > 25) throw new Error(`${group.name}.${spec.sub}.${o.name}: >25 choices`);
    });
    if (options.length > 25) throw new Error(`${group.name}.${spec.sub}: >25 options`);
    const action = new Action({
      sub: spec.sub, subgroup: spec.subgroup || null, description, access, perms,
      botPerms: spec.botPerms || [], options, cooldown: spec.cooldown ?? 2,
      guildOnly: spec.guildOnly ?? (access !== 'user' && access !== 'owner'),
      aliases: spec.aliases || [], audit: spec.audit ?? access !== 'user',
      ephemeral: Boolean(spec.ephemeral), nsfw: false, dmOk: !(spec.guildOnly ?? access === 'admin'),
    }, group, run);
    if (spec.subgroup && !group.subgroups.has(spec.subgroup)) group.subgroups.set(spec.subgroup, `${spec.subgroup} commands`);
    if (this.actions.has(action.key)) throw new Error(`duplicate action ${action.key}`);
    this.actions.set(action.key, action);
    group.actions.push(action);
    if (this.executor) action.bindExecutor(this.executor);
    return action;
  }

  bindExecutor(fn) {
    this.executor = fn;
    for (const a of this.actions.values()) a.bindExecutor(fn);
  }

  all() { return [...this.actions.values()]; }
  get(key) { return this.actions.get(key); }

  /** Build prefix lookup tables and validate collisions. Call once after loading. */
  finalize() {
    const bySub = new Map();
    for (const a of this.actions.values()) {
      if (!bySub.has(a.sub)) bySub.set(a.sub, []);
      bySub.get(a.sub).push(a);
    }
    this.flat = new Map();
    const reserved = new Set([...this.groups.keys()]);
    for (const g of this.groups.values()) for (const al of g.aliases) {
      if (reserved.has(al)) throw new Error(`group alias collides: ${al}`);
      reserved.add(al);
    }
    // explicit aliases first (must be globally unique)
    for (const a of this.actions.values()) for (const al of a.aliases) {
      if (reserved.has(al) || this.flat.has(al)) throw new Error(`alias collision: ${al} (${a.key})`);
      this.flat.set(al, a);
    }
    // implicit flat names for unambiguous subcommand names
    for (const [sub, list] of bySub) {
      if (list.length === 1 && !reserved.has(sub) && !this.flat.has(sub)) this.flat.set(sub, list[0]);
    }
    // standalone entry points
    this.standaloneActions = new Map();
    for (const [name, key] of this.standalones || []) {
      const a = this.actions.get(key);
      if (!a) throw new Error(`standalone ${name} references missing action ${key}`);
      if (this.groups.has(name)) throw new Error(`standalone ${name} collides with a group`);
      this.standaloneActions.set(name, a);
      if (!this.flat.has(name) && !reserved.has(name)) this.flat.set(name, a);
    }
    this.reservedNames = new Set([...reserved, ...this.flat.keys(), ...this.standaloneActions.keys()]);
    return this;
  }

  /**
   * Resolve prefix tokens → { action, rest } where rest are remaining token objects.
   * `!group [subgroup] sub args`, `!alias args`, `!group-alias sub args`.
   */
  resolve(tokens) {
    if (!tokens.length) return null;
    const first = tokens[0].value.toLowerCase();
    let group = this.groups.get(first) || [...this.groups.values()].find((g) => g.aliases.includes(first));
    if (group) {
      const second = tokens[1] && tokens[1].value.toLowerCase();
      if (second) {
        const direct = group.actions.find((a) => !a.subgroup && a.sub === second);
        if (direct) return { action: direct, rest: tokens.slice(2), group };
        if (group.subgroups.has(second)) {
          const third = tokens[2] && tokens[2].value.toLowerCase();
          const nested = third && group.actions.find((a) => a.subgroup === second && a.sub === third);
          if (nested) return { action: nested, rest: tokens.slice(3), group };
          return { group, subgroup: second, rest: tokens.slice(2), action: null };
        }
      }
      if (group.defaultSub) {
        const d = group.actions.find((a) => !a.subgroup && a.sub === group.defaultSub);
        if (d) return { action: d, rest: tokens.slice(1), group };
      }
      return { group, action: null, rest: tokens.slice(1) };
    }
    const flat = this.flat.get(first);
    if (flat) return { action: flat, rest: tokens.slice(1), group: flat.group };
    return null;
  }

  /** Discord application-command JSON for every top-level entry point. */
  toSlashJSON() {
    const out = [];
    for (const g of this.groups.values()) out.push(this._groupJSON(g));
    for (const [name, action] of this.standaloneActions || []) {
      out.push({ name, description: action.description, type: 1, options: action.options.map(optionJSON), ...(slashPerms(action) ? { default_member_permissions: slashPerms(action) } : {}), dm_permission: action.access === 'user' });
    }
    return out;
  }

  _groupJSON(g) {
    const direct = g.actions.filter((a) => !a.subgroup);
    const options = direct.map((a) => ({ type: 1, name: a.sub, description: a.description, options: a.options.map(optionJSON) }));
    for (const [sg, description] of g.subgroups) {
      const subs = g.actions.filter((a) => a.subgroup === sg);
      if (!subs.length) continue;
      options.push({ type: 2, name: sg, description: description.slice(0, 100), options: subs.map((a) => ({ type: 1, name: a.sub, description: a.description, options: a.options.map(optionJSON) })) });
    }
    const allAdmin = g.actions.every((a) => a.access !== 'user');
    const allUser = g.actions.every((a) => a.access === 'user');
    let perms = null;
    if (allAdmin) {
      // Hint only (UI visibility); real enforcement happens server-side in the executor.
      const sets = g.actions.map((a) => (a.access === 'owner' ? ['Administrator'] : a.perms));
      const common = sets.reduce((acc, s) => acc.filter((p) => s.includes(p)), sets[0] || []);
      perms = new PermissionsBitField(common.length ? common : ['ManageGuild']).bitfield.toString();
      if (g.actions.every((a) => a.access === 'owner')) perms = '0';
    }
    return { name: g.name, description: g.description, type: 1, options, ...(perms ? { default_member_permissions: perms } : {}), dm_permission: allUser };
  }
}

function slashPerms(action) {
  if (action.access === 'user') return null;
  return new PermissionsBitField(action.access === 'owner' ? ['Administrator'] : action.perms).bitfield.toString();
}

function optionJSON(o) {
  const j = { type: SLASH_TYPE[o.type], name: o.name, description: o.description, required: Boolean(o.required) };
  if (o.choices) j.choices = o.choices.map((c) => (typeof c === 'object' ? c : { name: String(c), value: c }));
  if (o.type === 'integer' || o.type === 'number') {
    if (o.min !== undefined) j.min_value = o.min;
    if (o.max !== undefined) j.max_value = o.max;
  }
  if (o.type === 'string' || o.type === 'duration') {
    if (o.minLength !== undefined) j.min_length = o.minLength;
    if (o.maxLength !== undefined) j.max_length = Math.min(o.maxLength, 6000);
  }
  return j;
}

/** Structural validation of the generated slash JSON against Discord's documented limits. */
function validateSlashJSON(defs) {
  const errors = [];
  if (defs.length > 100) errors.push(`too many top-level commands: ${defs.length} > 100`);
  const names = new Set();
  for (const d of defs) {
    if (names.has(d.name)) errors.push(`duplicate top-level name ${d.name}`);
    names.add(d.name);
    if (!/^[\w-]{1,32}$/.test(d.name) || d.name !== d.name.toLowerCase()) errors.push(`bad name ${d.name}`);
    if (!d.description || d.description.length > 100) errors.push(`${d.name}: bad description`);
    if ((d.options || []).length > 25) errors.push(`${d.name}: more than 25 options/subcommands`);
    const size = JSON.stringify(d).length;
    if (size > 8000) errors.push(`${d.name}: payload ~${size} chars exceeds the 8000 limit`);
    const walk = (opts, path) => {
      const seen = new Set();
      let seenOpt = false;
      for (const o of opts || []) {
        if (seen.has(o.name)) errors.push(`${path}: duplicate option ${o.name}`);
        seen.add(o.name);
        if (!/^[\w-]{1,32}$/.test(o.name)) errors.push(`${path}/${o.name}: bad name`);
        if (!o.description || o.description.length > 100) errors.push(`${path}/${o.name}: bad description`);
        if (o.type === 1 || o.type === 2) { if ((o.options || []).length > 25) errors.push(`${path}/${o.name}: >25 children`); walk(o.options, `${path}/${o.name}`); }
        else { if (o.required && seenOpt) errors.push(`${path}/${o.name}: required after optional`); if (!o.required) seenOpt = true; }
      }
    };
    walk(d.options, d.name);
  }
  return errors;
}

module.exports = { Registry, Action, validateSlashJSON, NAME_RE };

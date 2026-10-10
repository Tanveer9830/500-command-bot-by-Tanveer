#!/usr/bin/env node
'use strict';
/** Validate the registry against Discord's limits and the project's hard requirements. */
const { say } = require('./_lib');
const { buildRegistry } = require('../src/commands');
const { counts, validate } = require('../src/inventory');

const registry = buildRegistry();
const problems = validate(registry); const c = counts(registry);
say('info', `${c.totalActions} actions (${c.normalUser} normal, ${c.adminTier} admin-tier incl. ${c.ownerOnly} owner) • ${c.slashTopLevel} slash entries • ${c.explicitAliases} aliases`);
if (problems.length) { for (const p of problems) say('error', p); process.exit(1); }
say('success', 'Command registry is valid.');

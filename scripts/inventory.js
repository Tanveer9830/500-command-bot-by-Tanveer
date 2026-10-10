#!/usr/bin/env node
'use strict';
/** Generate docs/COMMANDS.md and docs/commands.json from the live registry. */
const fs = require('node:fs');
const path = require('node:path');
const { root, say } = require('./_lib');
const { buildRegistry } = require('../src/commands');
const { buildInventory, toMarkdown, counts } = require('../src/inventory');

const registry = buildRegistry();
const rows = buildInventory(registry); const c = counts(registry);
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'COMMANDS.md'), toMarkdown(rows, c));
fs.writeFileSync(path.join(root, 'docs', 'commands.json'), `${JSON.stringify({ counts: c, commands: rows }, null, 1)}\n`);
say('success', `Wrote docs/COMMANDS.md and docs/commands.json (${rows.length} actions).`);

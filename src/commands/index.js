'use strict';
const { Registry, validateSlashJSON } = require('../core/registry');

/** Command modules, in display order. Each exports `register(registry)`. */
const MODULES = [
  'general', 'info', 'moderation', 'serveradmin', 'security', 'config', 'custom', 'community', 'economy', 'progress', 'productivity', 'music', 'communityadmin', 'textTools', 'calc', 'fun', 'games', 'reference', 'lookup', 'shortcuts',
];

function buildRegistry(modules = MODULES) {
  const registry = new Registry();
  for (const name of modules) require(`./${name}`)(registry);
  registry.finalize();
  const errors = validateSlashJSON(registry.toSlashJSON());
  if (errors.length) throw new Error(`Invalid slash definitions:\n${errors.join('\n')}`);
  return registry;
}

module.exports = { buildRegistry, MODULES };

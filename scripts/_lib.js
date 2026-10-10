'use strict';
/** Shared helpers for the maintenance scripts. */
const path = require('node:path');
const branding = require('../src/utils/branding');
const configLib = require('../src/config');
const logger = require('../src/utils/logger');

const root = path.resolve(__dirname, '..');
function loadConfig({ requireToken = false } = {}) {
  const { config, errors, warnings } = configLib.load({ requireToken });
  logger.setSecrets(configLib.secretValues(config));
  return { config, errors, warnings };
}
const say = (kind, msg) => branding.print(branding.status(kind, msg));
module.exports = { root, loadConfig, say, branding };

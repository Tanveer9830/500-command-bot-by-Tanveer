'use strict';
/**
 * Top-level slash entry points that route to an existing action.
 * Discord allows at most 100 top-level slash commands; these are extra, easier-to-reach routes
 * to actions that already exist inside a group. They are NOT counted as separate actions.
 */
const SHORTCUTS = [
  ['ban', 'mod.ban'], ['kick', 'mod.kick'],
  ['roll', 'fun.roll'], ['flip', 'fun.coinflip'], ['8ball', 'fun.8ball'], ['choose', 'fun.choose'], ['joke', 'fun.joke'],
  ['password', 'random.password'], ['uuid', 'encode.uuid'], ['hash', 'encode.hash'],
  ['element', 'science.element'], ['moon', 'science.moonphase'], ['zodiac', 'science.zodiac'],
  ['remindme', 'reminder.add'], ['nowplaying', 'music.nowplaying'], ['snowflake', 'dev.snowflake'],
  ['timestamp', 'time.stamp'], ['hangman', 'game.hangman.start'],
];
module.exports = function register(registry) {
  for (const [name, key] of SHORTCUTS) registry.standalone(name, key);
};
module.exports.SHORTCUTS = SHORTCUTS;

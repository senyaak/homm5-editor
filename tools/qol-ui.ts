// Build the health-bar archive into an install, by hand.
//
//   node tools/qol-ui.ts [--game <dir>]
//
// The build itself lives in src/mods/qol-ui.ts, because applying the game
// settings does this too: the archive follows the `stack-health-bar` flag, and
// the panel could not call a tool. This wrapper is for working on the bar
// without opening the editor — same output, same path.

import { join, resolve } from 'node:path';

import { writeQolArchive } from '#src/mods/qol-ui.ts';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const game = resolve(flag('game') ?? process.env.HOMM5_GAME ?? join(here, '..'));
console.log(`wrote ${writeQolArchive(game)}`);

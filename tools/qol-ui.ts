// Build the health-bar archive into an install, by hand.
//
//   node tools/qol-ui.ts [--game <dir>]
//
// The build itself lives in src/mods/qol-ui.ts, because applying the game
// settings does this too: the archive follows the `stack-health-bar` flag, and
// the panel could not call a tool. This wrapper is for working on the bar
// without opening the editor — same output, same path.

import { writeQolArchive } from '#src/mods/qol-ui.ts';
import { gameDir } from './game-dir.ts';

console.log(`wrote ${writeQolArchive(gameDir())}`);

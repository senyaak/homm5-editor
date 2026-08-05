// Where the game is — said out loud, never guessed.
//
// Every tool used to fall back to the checkout's parent, on the theory that
// the repo sits inside the install. A WORKTREE breaks that by definition: its
// parent is wherever worktrees are kept, and the guess turns into paths like
// `C:\Projects\data\GEmaps.pak` that fail three calls away from the reason —
// or worse, quietly read the wrong install. So the answer is a constant filled
// by somebody SAYING it — `--game <dir>` on the command line beats HOMM5_GAME
// in the environment — and an empty answer is an answer too:
//
// TWO NAMES for the same folder, because two halves of this repo grew their
// own: the app and the e2e say HOMM5_ROOT, the tools say HOMM5_GAME, and
// `e2e/mods.ts` and c1m1's error messages already promise that either works.
// Reading only one of them made that promise false for every tool below.
//
//   gameDir()       for tools that are nothing without the game: stop, saying
//                   the two ways to point at it.
//   gameDirIfAny()  for unit suites whose game half is optional: null, so the
//                   suite can SKIP that half in so many words. Skipping is not
//                   proceeding; proceeding into a made-up path was the bug.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** The game folder, or null when nobody said. Never a guess. */
export function gameDirIfAny(): string | null {
  const i = process.argv.indexOf('--game');
  const said = (i >= 0 ? process.argv[i + 1] : undefined)
    || process.env.HOMM5_GAME || process.env.HOMM5_ROOT;
  return said ? resolve(said) : null;
}

/**
 * The editor's own cache of unpacked game data.
 *
 * OURS, which is the difference from the game folder above: the cache is made
 * by this repo and lives in it, so its standing answer is defined by where the
 * REPO is — the one thing `import.meta.dirname` legitimately knows. `--data`
 * and HOMM5_DATA override it; nothing about the game's position is guessed.
 */
export function dataDir(): string {
  const i = process.argv.indexOf('--data');
  const said = (i >= 0 ? process.argv[i + 1] : undefined) || process.env.HOMM5_DATA;
  return said ? resolve(said) : resolve(import.meta.dirname, '..', 'data-unpacked');
}

/** The game folder, from somebody who said so — or a refusal that names both ways to say it. */
export function gameDir(): string {
  const dir = gameDirIfAny();
  if (!dir) {
    console.error('where is the game? pass --game <dir> or set HOMM5_GAME — the checkout\'s position says nothing');
    process.exit(2);
  }
  if (!existsSync(dir)) {
    console.error(`the game folder does not exist: ${dir}`);
    process.exit(2);
  }
  return dir;
}

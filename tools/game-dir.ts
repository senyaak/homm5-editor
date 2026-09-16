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
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { singleRoot } from '../src/game/assets.ts';
import type { Assets } from '../src/game/assets.ts';
import { mountArchives } from '../src/game/mounted.ts';
import type { DataRoot } from '../src/rmg/data.ts';
import type { RmgInstall } from '../src/rmg/install.ts';

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

/** The game's unwrapped executable — what the generator's tables are read from. */
export function gameExe(): string {
  const exe = join(gameDir(), 'bin', 'H5_Game_H5E.exe');
  if (!existsSync(exe)) {
    console.error(`${exe} is not there — \`npm run unwrap-exe\` makes it`);
    process.exit(2);
  }
  return exe;
}

/**
 * The data as the GAME reads it: the archives mounted from `<game>/H5E/` over
 * the unpacked cache, by the executable's own rule (`src/game/mounted.ts`).
 * Without a game folder it is the cache alone — a chain of one, the shipped
 * data — and a tool that must match a real install says `--game`.
 */
export function dataAssets(): Assets {
  const base = dataDir();
  const game = gameDirIfAny();
  if (!game) return singleRoot(base);
  return mountArchives(game, join(tmpdir(), 'homm5-editor', 'mounted'), base);
}

/** The game's unwrapped executable, or null when nobody said where the game is. */
export function gameExeIfAny(): string | null {
  const game = gameDirIfAny();
  if (!game) return null;
  const exe = join(game, 'bin', 'H5_Game_H5E.exe');
  return existsSync(exe) ? exe : null;
}

/**
 * The install the generator runs against — the data as the game mounts it
 * and the game's executable, both from the folder somebody said. A suite
 * that reads the unpacked cache alone passes `dataDir()` as the data.
 */
export function gameInstall(data: DataRoot = dataAssets()): RmgInstall {
  return { data, exe: gameExe() };
}

// The first run, done to an install that has never had one.
//
// WHY THIS EXISTS. Four things have to be true before the editor is any use —
// the archives unpacked, a readable copy of the executable, our extension loaded
// by it, that copy pointed at our own folder — and until now every one of them
// was an npm command somebody typed once. Nothing exercised them again: the mod
// specs build their sandbox by COPYING the executable those commands had already
// made, so the making of it was the only part of the install with no test at
// all, on the machine where it had already succeeded.
//
// SO THIS DOES IT FOR REAL, from the shipped, DRM-wrapped executable and a real
// archive, into a folder that did not exist a second ago. What it does NOT do is
// find the game: `firstRun` is handed its three folders, exactly the way the
// setup window's picker hands them over. That is the whole contract — the picker
// decides, the steps obey.
//
// ONE ARCHIVE, NOT ALL OF THEM. `data.pak` is 1.4 GB and says nothing this does
// not: `a2p1-data.pak` is 13 MB, carries both markers a data root is recognised
// by (`MapObjects/`, `bin/Geometries`), and unpacks in seconds. What is under
// test is the step, not the throughput.
//
// AND IT CLEANS UP. The sandbox goes at the end, like every other throwaway
// install the suite makes — unless `HOMM5_NO_REMOVE` is set (`npm run e2e-live`),
// which is the switch that says "leave me something to look at".

import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { classify } from '../src/exe/exe-unwrap.ts';
import { extensionState } from '../src/mods/extension.ts';
import { firstRun, installState, isReady } from '../src/game/first-run.ts';
import type { Install } from '../src/game/first-run.ts';
import { MOD_DIR, readModPaths } from '../src/game/mod-paths.ts';
import { REPO_ROOT } from './launch.ts';
import { LIVE, REAL_GAME } from './mods.ts';

/** The install this makes, wipes and makes again. Never anything else. */
const HOME = join(REPO_ROOT, '_tmp', 'e2e-first-run');

/** The one archive the unpack step is given, and where the game keeps it. */
const PAK = 'a2p1-data.pak';
/** The shipped executable, as Steam ships it: wrapped, unreadable, the input. */
const SHIPPED = join('bin', 'H5_Game.exe');
const PATCHED = join('bin', 'H5_Game_H5E.exe');

const install: Install = {
  gameRoot: HOME,
  dataRoot: join(HOME, 'data-unpacked'),
  editorRoot: REPO_ROOT,
};

/**
 * A Heroes 5 install with nothing done to it.
 *
 * It wipes what it is given, so it may only ever be given a throwaway — the same
 * one-word mistake `prepareGameRoot` guards against, and the same guard.
 */
function freshInstall(): void {
  if (!HOME.startsWith(join(REPO_ROOT, '_tmp'))) {
    throw new Error(`this wipes what it prepares — ${HOME} is not under _tmp`);
  }
  rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(join(HOME, 'bin'), { recursive: true });
  mkdirSync(join(HOME, 'data'), { recursive: true });
  copyFileSync(join(REAL_GAME, SHIPPED), join(HOME, SHIPPED));
  copyFileSync(join(REAL_GAME, 'data', PAK), join(HOME, 'data', PAK));
}

test.beforeAll(() => {
  for (const f of [join(REAL_GAME, SHIPPED), join(REAL_GAME, 'data', PAK)]) {
    if (!existsSync(f)) throw new Error(`the first run needs a real install to start from — no ${f}`);
  }
});

test.afterAll(() => {
  if (LIVE) {
    console.warn(`\n[e2e] left the first-run install at ${HOME}\n`);
    return;
  }
  rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('a first run turns a bare install into one the editor can work in', async () => {
  // Unwrapping downloads Steamless the first time and runs it over a 14 MB
  // executable; unpacking is thousands of files. Minutes, not seconds.
  test.setTimeout(10 * 60_000);

  freshInstall();

  // Nothing is true yet — and asking is safe, which is the property the picker
  // depends on while a path is still being typed.
  expect(installState(install).map((s) => s.done), 'a bare install has none of the four')
    .toEqual([false, false, false, false]);
  expect(isReady(install)).toBe(false);

  const lines: string[] = [];
  const r = await firstRun(install, { onStep: (s) => lines.push(s.what) });

  expect(r.skipped, 'nothing was already done').toEqual([]);
  expect(r.ran.map((x) => x.id), 'all four, in order').toEqual(['data', 'exe', 'extension', 'paths']);
  expect(lines.length, 'and each one announced itself before it started').toBe(4);

  // 1 — the archives are a tree the editor can read.
  expect(existsSync(join(install.dataRoot, 'MapObjects')), 'the unpacked tree is there').toBe(true);
  expect(readdirSync(install.dataRoot).length, 'and it holds more than one folder').toBeGreaterThan(1);

  // 2 — the copy of the executable holds readable code. The shipped one is
  // untouched: that is the off switch, and a first run must not spend it.
  const patched = join(HOME, PATCHED);
  expect(existsSync(patched), 'our copy exists').toBe(true);
  expect(classify(readFileSync(patched)), 'and its code is readable').toBe('clean');
  expect(classify(readFileSync(join(HOME, SHIPPED))), "the game's own is left wrapped").toBe('wrapped');

  // 3 — the extension is beside it AND named by it. Either alone does nothing.
  const ext = extensionState(HOME);
  expect(ext.present, 'the DLL is beside the executable').toBe(true);
  expect(ext.imported, 'and the executable names it').toBe(true);

  // 4 — and that copy reads our folder, which now exists to be read.
  expect(readModPaths(readFileSync(patched)).state, 'all six literals are ours').toBe('ours');
  expect(existsSync(join(HOME, MOD_DIR)), 'and the folder was made, not assumed').toBe(true);

  expect(isReady(install), 'the editor can be opened on this install').toBe(true);
});

test('a second run finds everything already true and does nothing', async () => {
  test.setTimeout(2 * 60_000);

  // Runs against what the first test left: the chain is the point — an install
  // with three of the four wants the fourth, not a fresh start.
  expect(isReady(install), 'the first run left a finished install').toBe(true);

  const before = readFileSync(join(HOME, PATCHED));
  const r = await firstRun(install);

  expect(r.ran, 'nothing ran').toEqual([]);
  expect(r.skipped, 'all four were skipped by name').toEqual(['data', 'exe', 'extension', 'paths']);
  // The executable is the one thing three of the four steps write to, so its
  // bytes are the honest test of "wrote nothing" — a second import would add a
  // section, a second patch would rewrite the strings.
  expect(readFileSync(join(HOME, PATCHED)).equals(before), 'and the executable is byte for byte what it was').toBe(true);
});

test('a folder that is not an install is refused before anything long starts', async () => {
  const nowhere = join(REPO_ROOT, '_tmp', 'e2e-first-run-nowhere');
  rmSync(nowhere, { recursive: true, force: true });
  mkdirSync(nowhere, { recursive: true });
  try {
    await expect(firstRun({ ...install, gameRoot: nowhere, dataRoot: join(nowhere, 'data-unpacked') }))
      .rejects.toThrow(/not a Heroes 5 install/);
    expect(existsSync(join(nowhere, MOD_DIR)), 'and nothing was made in it').toBe(false);
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
  }
});

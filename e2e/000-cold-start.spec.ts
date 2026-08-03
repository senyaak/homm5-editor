// STEP 000 — a cold start, done entirely by hand through the setup window.
//
// Every other spec opens the editor on an install something else prepared: the
// data unpacked by a tool, the executable patched by a script, the env pointing
// at all of it. Nothing walked the path a person walks on a machine where none
// of that has happened — which is exactly where this repo stumbled: a fresh
// worktree, the env var in place, the data not unpacked, and the first symptom
// was a button missing from a toolbar three layers away from the cause.
//
// So this one takes everything away first. The sandbox holds what Steam leaves
// and nothing else: the wrapped executable and one archive. No unpacked data,
// no patched copy, no extension, no H5E, no settings — and the app is pointed
// at a userData of its own, because the setup window's "Open the editor" SAVES
// what was picked, and the settings it must save are the sandbox's, not those
// of the editor somebody actually uses (HOMM5_USERDATA, electron/paths.ts).
//
// Then it does what a person does. Open the editor; setup appears instead,
// with both folders already in the fields (the env fills them in — the picker
// buttons open native dialogs no test can drive). Press Prepare; watch the
// four steps run for real — the unpack, Steamless over the wrapped executable,
// the extension, the paths. Press "Open the editor". When the editor's own
// window is up with its toolbar, the cold start worked, end to end.
//
// ONE ARCHIVE, NOT ALL OF THEM — the same bargain first-run.spec.ts strikes:
// `a2p1-data.pak` is 13 MB, carries both markers a data root is recognised by,
// and unpacks in seconds. What is under test is the path, not the throughput.
//
// LIVE (`npm run e2e-live`, HOMM5_NO_REMOVE) does it to the REAL install, the
// way every live spec works in the real install: what OUR engine writes is
// taken out first — the patched executable, the extension, the qol config and
// its archive, the whole unpacked data tree — and the setup window rebuilds it
// all from the real archives, every pak this time. What is deliberately NOT
// touched: the game's own files, `H5E/` itself (maps and saves live there) and
// `H5E/homm5-editor.h5u` (authored content; a first run does not author). The
// qol config and archive are not rebuilt either — reapplying the game settings
// from the panel is the way back. Settings still go to a userData of the
// spec's own: what a live run promises to leave standing is the INSTALL, not
// an edit to the editor's own remembered configuration.
//
// The file is named 000 so it runs before everything: the suite is serial, and
// the one test that starts from nothing belongs in front of the tests that
// start from something.

import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DATA, REPO_ROOT, launchEditor } from './launch.ts';
import { LIVE, REAL_GAME, liveHome } from './mods.ts';

/** The install this wipes and remakes: a sandbox, or — live — the real one. */
const HOME = liveHome('e2e-cold-start');
/** Where the app keeps what it remembers — settings.json lands HERE. */
const USERDATA = join(REPO_ROOT, '_tmp', 'e2e-cold-start-userdata');
const DATA_ROOT = LIVE ? DATA : join(HOME, 'data-unpacked');

const PAK = 'a2p1-data.pak';
const SHIPPED = join('bin', 'H5_Game.exe');
const PATCHED = join('bin', 'H5_Game_H5E.exe');

/** What our engine writes into an install, by name — what a cold start owes. */
const OURS = [
  PATCHED,
  join('bin', 'homm5-editor.dll'),
  join('bin', 'homm5-editor-qol.txt'),
  join('H5E', 'homm5-editor-qol.h5u'),
];

/**
 * A Heroes 5 install with nothing of ours done to it — and no memory of one.
 *
 * The sandbox is wiped whole and given what Steam gives: the wrapped
 * executable and one archive. The real install — live only — loses exactly
 * `OURS` and the unpacked tree, nothing else: it is somebody's, and the guard
 * that a wholesale wipe stays under `_tmp` is the same one-word-mistake guard
 * `prepareGameRoot` uses.
 */
function bareWorld(): void {
  rmSync(USERDATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(USERDATA, { recursive: true });
  if (LIVE) {
    for (const f of OURS) rmSync(join(HOME, f), { force: true });
    rmSync(DATA_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return;
  }
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
    if (!existsSync(f)) throw new Error(`the cold start needs a real install to copy from — no ${f}`);
  }
});

test.afterAll(() => {
  rmSync(USERDATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (LIVE) {
    console.warn(`\n[e2e] cold start rebuilt the live install at ${HOME} — the qol config and`
      + ' archive were taken out and are NOT rebuilt here: reapply the game settings from the panel.\n');
    return;
  }
  rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('from nothing to an open editor, through the setup window', async () => {
  // Steamless over a 14 MB executable plus an unpack: minutes, not seconds —
  // and live the unpack is every pak the game ships, not the 13 MB stand-in.
  test.setTimeout((LIVE ? 30 : 10) * 60_000);

  bareWorld();

  const ed = await launchEditor({
    HOMM5_ROOT: HOME,
    HOMM5_DATA: DATA_ROOT,
    HOMM5_UNPACK_TO: DATA_ROOT,
    HOMM5_USERDATA: USERDATA,
  });
  try {
    // With nothing to read, the first window is setup — not the editor.
    const setup = ed.page;
    await expect(setup.locator('#prepare'), 'the setup window came up').toBeVisible();

    // The env filled both folders in, which is what makes this drivable at
    // all: the Choose… buttons open native dialogs no test can reach.
    await expect(setup.locator('#game'), 'the game folder is in the field').toHaveText(HOME);
    await expect(setup.locator('#data'), 'and the data folder beside it').toHaveText(DATA_ROOT);
    await expect(setup.locator('#game-note'), 'the archives were found').toHaveClass('ok');

    // Four steps, none of them done — this is a cold start or it is nothing.
    await expect(setup.locator('#steps .four')).toHaveCount(4);
    await expect(setup.locator('#steps .four.done')).toHaveCount(0);
    await expect(setup.locator('#start'), 'the editor cannot open yet').toBeDisabled();

    // The long press. The window reports each step as it runs; what this waits
    // for is the outcome the person waits for — the start button coming alive.
    await setup.locator('#prepare').click();
    await expect(setup.locator('#start'), 'everything was prepared')
      .toBeEnabled({ timeout: (LIVE ? 28 : 9) * 60_000 });
    await expect(setup.locator('#steps .four.done'), 'all four steps say done').toHaveCount(4);

    // What the steps left on disk, by name — the same four things the editor
    // and the game will go looking for.
    expect(existsSync(join(DATA_ROOT, 'MapObjects')), 'the data is a readable tree').toBe(true);
    expect(existsSync(join(HOME, PATCHED)), 'our copy of the executable exists').toBe(true);
    expect(existsSync(join(HOME, 'bin', 'homm5-editor.dll')), 'the extension is beside it').toBe(true);
    expect(existsSync(join(HOME, 'H5E')), 'and our folder was made').toBe(true);

    // "Open the editor" hands over to the real window. Listen for it before
    // pressing the button that makes it.
    const opened = ed.app.waitForEvent('window', { timeout: 60_000 });
    await setup.locator('#start').click();
    const editor = await opened;
    await editor.waitForLoadState('domcontentloaded');
    await expect(editor.locator('#qolbtn'), 'the editor is up, toolbar and all')
      .toBeVisible({ timeout: 30_000 });

    // And what it remembered, it remembered in the sandbox's own userData —
    // the file exists here, so it was not written over anybody's real one.
    expect(existsSync(join(USERDATA, 'settings.json')), 'settings were saved where told').toBe(true);
  } finally {
    await ed.app.close();
  }
});

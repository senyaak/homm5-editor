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
// The file is named 000 so it runs before everything: the suite is serial, and
// the one test that starts from nothing belongs in front of the tests that
// start from something.

import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, launchEditor } from './launch.ts';
import { LIVE, REAL_GAME } from './mods.ts';

/** The install this makes, wipes and makes again. Never anything else. */
const HOME = join(REPO_ROOT, '_tmp', 'e2e-cold-start');
/** Where the app keeps what it remembers — settings.json lands HERE. */
const USERDATA = join(REPO_ROOT, '_tmp', 'e2e-cold-start-userdata');
const DATA_ROOT = join(HOME, 'data-unpacked');

const PAK = 'a2p1-data.pak';
const SHIPPED = join('bin', 'H5_Game.exe');
const PATCHED = join('bin', 'H5_Game_H5E.exe');

/**
 * A Heroes 5 install with nothing done to it — and no memory of one either.
 *
 * It wipes what it is given, so it may only ever be given a throwaway — the
 * same one-word mistake `prepareGameRoot` guards against, and the same guard.
 */
function bareWorld(): void {
  for (const dir of [HOME, USERDATA]) {
    if (!dir.startsWith(join(REPO_ROOT, '_tmp'))) {
      throw new Error(`this wipes what it prepares — ${dir} is not under _tmp`);
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  mkdirSync(join(HOME, 'bin'), { recursive: true });
  mkdirSync(join(HOME, 'data'), { recursive: true });
  mkdirSync(USERDATA, { recursive: true });
  copyFileSync(join(REAL_GAME, SHIPPED), join(HOME, SHIPPED));
  copyFileSync(join(REAL_GAME, 'data', PAK), join(HOME, 'data', PAK));
}

test.beforeAll(() => {
  for (const f of [join(REAL_GAME, SHIPPED), join(REAL_GAME, 'data', PAK)]) {
    if (!existsSync(f)) throw new Error(`the cold start needs a real install to copy from — no ${f}`);
  }
});

test.afterAll(() => {
  if (LIVE) {
    console.warn(`\n[e2e] left the cold-start install at ${HOME}\n`);
    return;
  }
  rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(USERDATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('from nothing to an open editor, through the setup window', async () => {
  // Steamless over a 14 MB executable plus an unpack: minutes, not seconds.
  test.setTimeout(10 * 60_000);

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
      .toBeEnabled({ timeout: 9 * 60_000 });
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

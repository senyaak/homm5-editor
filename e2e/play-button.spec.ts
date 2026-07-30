// The Play button: what it offers, and what it says when it cannot.
//
// It starts the game, so the happy path is not a thing a test may take: a spec
// that leaves a 2007 executable running on the machine it ran on is a spec
// nobody can run twice in a row. What IS testable is everything up to the spawn
// — that the button is there, that it names our copy rather than the game's, and
// that pressing it on an install with no such copy reports that instead of
// failing silently or starting the wrong executable.
//
// The last one is the whole risk of the feature. `bin/H5_Game.exe` sits right
// beside `bin/H5_Game_H5E.exe`, reads none of what the editor makes, and would
// look exactly like a working Play button to anyone who did not know which one
// they were looking at.

import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, launchEditor } from './launch.ts';

/** An install with no patched executable in it. Made here, gone at the end. */
const BARE = join(REPO_ROOT, '_tmp', 'e2e-play-bare');

test.beforeAll(() => {
  rmSync(BARE, { recursive: true, force: true });
  mkdirSync(join(BARE, 'bin'), { recursive: true });
});
test.afterAll(() => { rmSync(BARE, { recursive: true, force: true }); });

test('the bar offers to start our copy of the game @nodata', async () => {
  const ed = await launchEditor();
  try {
    const btn = ed.page.locator('#playbtn');
    await expect(btn, 'the button is in the bar').toBeVisible();
    // Enabled with no map open: what the game shows comes out of the mod folder,
    // which has nothing to do with what this window has loaded.
    await expect(btn, 'and offered whether or not a map is open').toBeEnabled();
    const title = await btn.getAttribute('title');
    expect(title, 'it names the copy it starts').toContain('H5_Game_H5E.exe');
  } finally {
    await ed.app.close();
  }
});

test('pressing it on an unprepared install says so, and starts nothing @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE });
  try {
    await ed.page.locator('#playbtn').click();
    // The status line is where the app reports a failed call. The message has to
    // name the missing file, because "could not start" would leave a person
    // guessing between a missing install and a broken button.
    await expect(ed.page.locator('#hud')).toContainText('H5_Game_H5E.exe', { timeout: 30_000 });
    await expect(ed.page.locator('#hud')).toContainText('not been prepared');
  } finally {
    await ed.app.close();
  }
});

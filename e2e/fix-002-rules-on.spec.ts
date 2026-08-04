// Stage 002 of the rules chain: the same map, every fix ON.
//
// It builds nothing and it touches no map. The whole point is that between the
// two runs ONE thing changes — the flags — so anything that plays differently
// afterwards is the fix and not the map. Run 001, play, run this, play again;
// docs/FIX_TEST_MAP.md is what to look at each time.
//
// The map is not rebuilt here on purpose. Rebuilding it would make the two runs
// two experiments, and a hero who came out slightly different the second time
// would read as a fix that worked.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeEditor, launchEditor } from './launch.ts';
import { ARCHIVE, FIXES_UNDER_TEST, GAME } from './fixes.ts';

test('every rule fix is turned on, and the map from 001 is still there', async () => {
  test.setTimeout(3 * 60_000);
  // The map is the constant of the experiment; without it this run has nothing
  // to be the second half of.
  expect(existsSync(ARCHIVE), `run fix-001 first — no map at ${ARCHIVE}`).toBeTruthy();

  const ed = await launchEditor({ HOMM5_ROOT: GAME });
  try {
    await ed.page.locator('#qolbtn').click();
    await expect(ed.page.locator('#qolcfg')).toBeVisible();
    await ed.page.locator('#qol-tab-fixes').click();

    // The master rather than nine clicks: it is the switch a person would use,
    // and a fix added tomorrow is included by it without this file changing.
    await ed.page.locator('#qol-all-fixes').check();
    for (const flag of FIXES_UNDER_TEST) {
      await expect(ed.page.locator(`#qol-${flag}`), `${flag} is on`).toBeChecked();
    }
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText(/settings written|installed/i, { timeout: 60_000 });

    // The file the extension actually reads — the panel saying so is the panel,
    // not the install.
    const written = readFileSync(join(GAME, 'bin', 'homm5-editor-qol.txt'), 'utf8');
    for (const flag of FIXES_UNDER_TEST) {
      expect(written, `${flag} is on in the file`).toMatch(new RegExp(`^${flag} 1$`, 'm'));
    }
    console.log(`\n  every fix on — play ${ARCHIVE} again.`);
  } finally {
    await closeEditor(ed);
  }
});

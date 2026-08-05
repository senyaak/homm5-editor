// Closing a map that actually has something in it.
//
// close-map.spec.ts covers the door between the two faces of the window, on a
// map it makes itself: no textures, no instanced batches, no lightmap bake, no
// shadow pass. Everything a teardown can double-free is therefore absent from
// it, which is how "closed the map and got the failure screen" reached Senya
// through a green suite. Here a shipped map is loaded, lit and left to settle
// first, and the close goes through the same button a person presses.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('closing a fully loaded map does not throw', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;

  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 180_000 });
  await page.evaluate(() => {
    const light = document.getElementById('lightbtn');
    if (light?.textContent?.includes('flat')) (light as HTMLButtonElement).click();
  });
  // Let the textures, the instanced batches, the lightmap bake and the shadow
  // pass all actually exist before tearing them down.
  await page.waitForTimeout(9000);
  expect(errors, `errors before closing: ${errors.join('\n')}`).toEqual([]);

  await bar(page, '#closemapbtn');
  await expect(page.locator('#empty')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);

  // The failure trap would have put this on screen.
  await expect(page.locator('#fatal')).toHaveCount(0);
  expect(errors, `errors after closing: ${errors.join('\n')}`).toEqual([]);

  // And the viewport still draws: a torn-down scene that lost its GL context
  // would fail here rather than at the close itself.
  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  expect(errors, `errors after reopening: ${errors.join('\n')}`).toEqual([]);
});

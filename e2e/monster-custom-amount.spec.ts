// A monster's Amount is editable only with Custom on.
//
// Without Custom the stack size is chosen by the map's difficulty, so the
// original greys the Amount box out; ours does the same, driven by the schema's
// x-enabledBy. Place a monster, and check Amount follows the Custom checkbox.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { DATA } from './c1m1/shared.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;
const NAME = 'e2e monster amount';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('a monster\'s Amount is disabled until Custom is on', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  await newMap(page, NAME, '72');
  await openObjectPalette(page);

  const shared = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapMonster')?.shared ?? '';
  });
  expect(shared, 'a monster entry exists').not.toBe('');
  await pickObject(page, shared);
  await placeAtTile(page, 10, 10);
  await page.evaluate(() => { const o = window.view.objects()[0]; if (o) window.view.select(o.id); });

  const custom = page.locator('#p-props .pf', { has: page.locator('label[data-field="Custom"]') }).locator('input[type=checkbox]');
  const amount = page.locator('#p-props .pf', { has: page.locator('label[data-field="Amount"]') }).locator('input');
  await expect(custom).toBeVisible();
  await expect(amount).toBeVisible();

  // Default: Custom off → Amount disabled.
  await expect(custom).not.toBeChecked();
  await expect(amount).toBeDisabled();

  // Turn Custom on → Amount becomes editable.
  await custom.check();
  await expect(amount).toBeEnabled();

  // And off again → disabled.
  await custom.uncheck();
  await expect(amount).toBeDisabled();
});

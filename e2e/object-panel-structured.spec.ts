// Structured fields show in the object panel, not only in the tree.
//
// A garrison's army, a town's buildings, a monster's extra stacks are lists and
// sub-objects the flat panel cannot hold, so they used to appear only behind the
// "Tree…" button — which is why a garrison's army looked missing. Now the panel
// lists each structured field under a "structures" heading with a count and an
// Edit button that opens the (expandable) tree. This checks a garrison shows its
// Army row, empty, and that Edit opens the tree.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { DATA } from './c1m1/shared.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;
const NAME = 'e2e panel structured';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('the panel shows an object\'s structured fields with Edit → tree', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  await newMap(page, NAME, '72');
  await openObjectPalette(page);

  const shared = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapGarrison')?.shared ?? '';
  });
  expect(shared, 'a garrison entry exists').not.toBe('');
  await pickObject(page, shared);
  await placeAtTile(page, 10, 10);
  await page.evaluate(() => { const o = window.view.objects()[0]; if (o) window.view.select(o.id); });

  // The Army row is in the panel now, under "structures", empty and editable.
  const army = page.locator('#p-props .pf', { has: page.locator('label', { hasText: /^Army$/ }) });
  await expect(army, 'the panel lists Army as a structured field').toBeVisible();
  await expect(army.locator('.rov')).toHaveText('empty');
  const edit = army.locator('button.struct-edit');
  await expect(edit).toBeVisible();

  // Edit opens the tree, expanded into the dialog, on the object's Army.
  await edit.click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  await expect(page.locator('#mt-dialog #maptree-body .mt-grp').filter({ hasText: 'Army' }).first()).toBeVisible();
});

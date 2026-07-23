// The object tree's "expand to a window" button.
//
// The tree docks left at 360px; expand moves the whole #maptree element into a
// modal <dialog> for room, and collapse (or Esc) docks it back. The point of
// moving the SAME element — rather than a second copy — is that every selector
// the other specs use keeps working; this checks the move happens and reverses,
// and that the tree stays usable inside the dialog.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { DATA } from './c1m1/shared.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;
const NAME = 'e2e tree expand';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('the object tree expands into a dialog and docks back', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  await newMap(page, NAME, '72');

  // Place any object through the palette (which builds its mesh), then select it.
  await openObjectPalette(page);
  const shared = await page.evaluate(async () => (await window.editor.listObjects()).objects[0]?.shared ?? '');
  expect(shared, 'the catalogue has something to place').not.toBe('');
  await pickObject(page, shared);
  await placeAtTile(page, 10, 10);
  await page.evaluate(() => {
    const o = window.view.objects()[0];
    if (o) window.view.select(o.id);
  });
  await page.locator('#p-tree').click();
  await expect(page.locator('#maptree')).toBeVisible();
  console.log('placed', shared);

  // Docked: #maptree is not inside the dialog, and the dialog is closed.
  expect(await page.locator('#mt-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  expect(await page.locator('#mt-dialog #maptree').count()).toBe(0);

  // Expand: the dialog opens and now hosts #maptree, still with its groups.
  await page.locator('#mt-expand').click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  expect(await page.locator('#mt-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
  await expect(page.locator('#mt-dialog #maptree')).toBeVisible();
  await expect(page.locator('#mt-dialog #maptree-body .mt-grp').first()).toBeVisible();

  // Collapse via the same button: docked again, dialog closed, tree still open.
  await page.locator('#mt-expand').click();
  expect(await page.locator('#mt-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  expect(await page.locator('#mt-dialog #maptree').count()).toBe(0);
  await expect(page.locator('#maptree')).toBeVisible();
});

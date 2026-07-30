// Closing a map: the way back from the map to the list of maps.
//
// The window has two faces and this is the door between them, so the test is as
// much about the bar as about the map going away — a close that tore the scene
// down but left the map tools on screen, or one that came back to the picker
// with the old map still held open in the main process, would both look fine in
// a screenshot. What is checked is the whole turn-over: the scene, the bar, the
// panels, and the map being genuinely let go of afterwards.
//
// Needs no game assets: it makes its own map, the way new-map.spec.ts does, and
// takes it away again.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar, openBarMenu } from './bar.ts';
import { newMap } from './tiles.ts';

let ed: Launched;

const NAME = 'e2e Close Map';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

/** Dirty the map through the UI, the way pack-roundtrip does: its visible name. */
async function editTheName(page: Launched['page'], to: string): Promise<void> {
  await bar(page, '#mapbtn');
  await expect(page.locator('#mapprops')).toBeVisible();
  await page.locator('#mapprops .mp-name-edit').fill(to);
  await page.locator('#mapprops .mp-name-edit').press('Enter');
  await expect(page.locator('#save')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#mp-close').click();
}

test('a clean map closes straight back to the list', { tag: '@nodata' }, async () => {
  const { page } = ed;
  await newMap(page, NAME, '72');
  // A map fresh out of New Map is NOT clean: opening it names the ground tiles
  // its terrain paints with but its tile set never listed, and that counts as an
  // edit. Save first, or this test would take the asked-about path and prove the
  // wrong thing.
  await bar(page, '#save');
  await expect(page.locator('#save')).toBeDisabled({ timeout: 60_000 });

  // Something on screen that has to go: the terrain panel is one of the two the
  // user's choice is persisted for, so it also proves the way out does not go
  // through the setters that would forget that choice. Opened only if it is not
  // already — that choice persists across runs, so a bare click is as likely to
  // close it as to open it.
  if (!(await page.locator('#palette').isVisible())) await page.locator('#palbtn').click();
  await expect(page.locator('#palette')).toBeVisible();

  await bar(page, '#closemapbtn');

  // The list is back, and it is the launcher's bar above it.
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#title')).toHaveText('homm5-editor');
  await expect(page.locator('#heroesbtn')).toBeVisible();
  await expect(page.locator('#viewmenubtn')).toBeHidden();
  await expect(page.locator('#undobtn')).toBeHidden();
  await expect(page.locator('#palette')).toBeHidden();
  // Save and Pack stay in the Map menu and go dead, rather than disappearing.
  await expect(page.locator('#pack')).toBeDisabled();
  await expect(page.locator('#closemapbtn')).toBeDisabled();
  // Nothing is held open: the scene is down and the main process has no session,
  // which is what every other handler tests for before it will do anything.
  expect(await page.evaluate(() => window.view.opened())).toBeNull();
  await expect(page.evaluate(() => window.editor.mapProps())).rejects.toThrow(/no map loaded/);
});

test('reopening restores the panel that was left open', { tag: '@nodata' }, async () => {
  const { page } = ed;
  await page.evaluate((p) => window.view.open(p), join(MAP_DIR, 'map.xdb'));
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 60_000 });
  // Closing hid it without putting it down: the choice was the user's and it
  // survives the map it was made on.
  await expect(page.locator('#palette')).toBeVisible();
});

test('unsaved work is asked about, and Cancel keeps the map', { tag: '@nodata' }, async () => {
  const { page } = ed;
  await editTheName(page, `${NAME} edited`);

  await bar(page, '#closemapbtn');
  await expect(page.locator('#ask')).toBeVisible();
  await expect(page.locator('#ask-text')).toContainText('never saved');
  await page.locator('#ask-no').click();

  // Still the same map, still dirty, still on the map bar.
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#title')).toContainText(NAME);
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#viewmenubtn')).toBeVisible();
});

test('and answering yes closes it, edit and all', { tag: '@nodata' }, async () => {
  const { page } = ed;
  await bar(page, '#closemapbtn');
  await expect(page.locator('#ask')).toBeVisible();
  await page.locator('#ask-yes').click();

  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#save')).toBeDisabled();
  expect(await page.evaluate(() => window.view.opened())).toBeNull();
});

test('and New Map still works from the screen it came back to', { tag: '@nodata' }, async () => {
  const { page } = ed;
  // The point of the door being two-way: the Map menu is the one thing offered
  // on both screens, so the way out is not a dead end.
  await openBarMenu(page, '#newmapbtn');
  await expect(page.locator('#newmapbtn')).toBeVisible();
  await expect(page.locator('#open')).toBeVisible();
  await page.locator('#mapmenu').press('Escape');
});

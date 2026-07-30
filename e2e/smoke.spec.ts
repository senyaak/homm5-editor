// Smoke test: the app launches to a usable empty state.
//
// This is the plumbing check — it needs no game assets and no map. If this is
// green, Playwright can drive the real Electron build, which every richer test
// (New Map, the plan-view camera, reconstruction) builds on.

import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { openBarMenu } from './bar.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('launches to the empty state with its toolbar', { tag: '@nodata' }, async () => {
  const { page } = ed;
  await expect(page.locator('#title')).toHaveText('homm5-editor');
  // The launcher's face: the four editors it exists for stand in the bar, and
  // the Map menu is the one that is offered on both screens.
  await expect(page.locator('#heroesbtn')).toBeVisible();
  await expect(page.locator('#mapmenubtn')).toBeVisible();
  await openBarMenu(page, '#open');
  await expect(page.locator('#open')).toBeVisible();
  // Nothing that works ON a map is offered while there is none — asserted on the
  // menu buttons themselves, because asking whether a control inside a CLOSED
  // menu is hidden answers yes whether or not a map is open, and would pass on
  // an app that never switched bars at all.
  await expect(page.locator('#viewmenubtn')).toBeHidden();
  await expect(page.locator('#propmenubtn')).toBeHidden();
  await expect(page.locator('#undobtn')).toBeHidden();
  await expect(page.locator('#palbtn')).toBeHidden();
  // And the two that stay in the Map menu are there but dead.
  await expect(page.locator('#pack')).toBeDisabled();
  await expect(page.locator('#closemapbtn')).toBeDisabled();
});

test('a menu opens under the button that opened it', { tag: '@nodata' }, async () => {
  const { page } = ed;
  // Where a popover lands is CSS — `top: anchor(bottom)` against its invoker —
  // and CSS that does not apply fails quietly: an unanchored popover is centred
  // in the window, which is still visible, still clickable, and would pass every
  // other assertion in this file while looking obviously broken on screen.
  await openBarMenu(page, '#open');
  const btn = await page.locator('#mapmenubtn').boundingBox();
  const menu = await page.locator('#mapmenu').boundingBox();
  expect(btn && menu).toBeTruthy();
  expect(menu!.y, 'the menu hangs below its button').toBeGreaterThanOrEqual(btn!.y + btn!.height);
  expect(Math.abs(menu!.x - btn!.x), 'and lines up with its left edge').toBeLessThan(2);
  await page.locator('#mapmenu').press('Escape');
  await expect(page.locator('#mapmenu')).toBeHidden();
});

test('the renderer bundle ran, not just the markup', { tag: '@nodata' }, async () => {
  const { page, errors } = ed;
  // Every assertion above is also true of an app whose renderer died on its
  // first line: the title, the buttons, the hidden view toggle and the disabled
  // Pack are all written into index.html. A missing WebGL context once shipped
  // exactly that — a window that looked open and answered no clicks — and this
  // suite was green for it. These three say the bundle reached its end.
  await expect(page.locator('#fatal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__booted === true)).toBe(true);
  expect(errors).toEqual([]);
});

test('the picker fills itself in', { tag: '@nodata' }, async () => {
  const { page } = ed;
  // The map list is the first thing boot does with the main process, so it
  // covers the renderer, preload, IPC and main in one look. Its footer is
  // written only by a resolved maps:list — the count can be 0 here, because CI
  // runs this against an empty stub data root.
  await expect(page.locator('#picker-foot')).toContainText('maps ·');
  await expect(page.locator('#maplist')).not.toContainText('loading');
});

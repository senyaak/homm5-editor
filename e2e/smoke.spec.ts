// Smoke test: the app launches to a usable empty state.
//
// This is the plumbing check — it needs no game assets and no map. If this is
// green, Playwright can drive the real Electron build, which every richer test
// (New Map, the plan-view camera, reconstruction) builds on.

import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('launches to the empty state with its toolbar', { tag: '@nodata' }, async () => {
  const { page } = ed;
  await expect(page.locator('#title')).toHaveText('homm5-editor');
  await expect(page.locator('#open')).toBeVisible();
  // View toggle and the map-only buttons stay hidden until a map is loaded.
  await expect(page.locator('#viewbtn')).toBeHidden();
  await expect(page.locator('#pack')).toBeDisabled();
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

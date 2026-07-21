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

test('launches to the empty state with its toolbar', async () => {
  const { page } = ed;
  await expect(page.locator('#title')).toHaveText('homm5-editor');
  await expect(page.locator('#open')).toBeVisible();
  // View toggle and the map-only buttons stay hidden until a map is loaded.
  await expect(page.locator('#viewbtn')).toBeHidden();
  await expect(page.locator('#pack')).toBeDisabled();
});

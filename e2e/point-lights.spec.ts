// Designer point lights (map.xdb <pointLights>) in the real app.
//
// The lights are parsed in the main process (MapObject.pointLights -> Instance
// .lights) and baked into a per-floor lightmap in the renderer (bakeLightMap);
// what a unit test cannot see is the handoff — that the objects of a shipped
// map actually put light on the ground. A wrong offset or radius reading would
// still light SOMETHING, so this asserts on the lit area too: the texel count
// scales with radius², and misread units would change it by 4x either way.
//
// Needs the game data, so it skips itself without one.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
// A2C1M2: 68 point lights, all on the underground floor (the crystal caves).
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M2', 'map.xdb');

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('the underground crystals pool light on the cave floor', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;

  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0);

  // The surface floor of this map carries none.
  const surface = await page.evaluate(() => window.view.pointLights());
  expect(surface.count).toBe(0);
  expect(surface.litTexels).toBe(0);

  // The underground carries all 68; the crystal at (38,24) alone is a
  // radius-20 violet pool (~1250 texels at 4 texels/tile), so the floor total
  // sits in the tens of thousands — far from 0 and far from the whole map
  // (1.05M texels), which is what a broken radius would produce.
  await page.evaluate(() => document.getElementById('floor')!.click());
  await page.waitForFunction(() => window.view.pointLights().count > 0);
  const under = await page.evaluate(() => window.view.pointLights());
  expect(under.count).toBe(68);
  expect(under.litTexels).toBeGreaterThan(20_000);
  expect(under.litTexels).toBeLessThan(300_000);

  expect(errors).toEqual([]);
});

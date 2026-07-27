// Particle effects in the real app.
//
// tools/test-effects.ts proves the parser against the whole library without a
// window; what only exists in Electron is the delivery — that a map's placed
// objects actually grow playing systems: scene meta over map:load, baked keys
// over map:fx as typed arrays, atlas + instanced quads in the renderer.
//
// Needs the game data (effects come from it), so it skips itself without one.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('placed objects grow playing particle systems', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;

  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0);
  // The systems are built asynchronously after the scene (map:fx + atlases).
  await page.waitForFunction(() => window.view.idle().fx > 0, null, { timeout: 60_000 });

  // A2C1M1 places campfires, mana crystals and portals by the dozen — if the
  // chain works at all, systems number in the tens. The exact count belongs
  // to the map, not the test.
  const fx = await page.evaluate(() => window.view.idle().fx);
  expect(fx).toBeGreaterThan(10);

  // Creature effects ride the idle CLIP, not the shared (whose <Effect/> is
  // empty on every monster) — a separate resolver path. The map's ghost
  // dragon carries cloud mist and bone-glued eye glow; after a moment on the
  // clock its systems must have live particles, and the eyes specifically
  // prove the bone-rest composition (unresolvable glue drops them instead).
  await page.waitForTimeout(1500);
  const dragon = await page.evaluate(() =>
    window.view.fxSystems().filter((s) => s.shared.includes('Horror_Dragon')));
  expect(dragon.length).toBeGreaterThanOrEqual(3); // mist + two eye instances
  expect(dragon.some((s) => s.alive > 0)).toBe(true);

  expect(errors).toEqual([]);
});

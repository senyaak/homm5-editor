// The map's own lighting in the real app.
//
// The AmbientLight preset is read in the main process (src/scene.ts) and
// applied in the renderer (applyAmbient); the only piece a unit test cannot
// see is the handoff — that opening a map actually recolours the lights and
// the terrain uniforms. Lighting has no other observable surface: a preset
// that silently fails to load leaves the fallback look, and a screenshot
// cannot tell that apart from a dim preset.
//
// Needs the game data (the presets live in it), so it skips itself without one.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP = join(DATA, 'Maps', 'Scenario', 'A1C1M1', 'map.xdb');

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('opening a map applies its AmbientLight preset', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;

  // Before any map: the fallback look, terrain lit by its old constants.
  const before = await page.evaluate(() => window.view.ambientState());
  expect(before.preset).toBe(false);
  expect(before.terrain.sun).toEqual([0.25, 0.25, 0.25]);

  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0);

  const after = await page.evaluate(() => window.view.ambientState());
  // A1C1M1 names /Lights/_(AmbientLight)/AdvMap/C1M1.xdb: LightColor
  // (0.545, 0.459, 0.38), Pitch 35, Yaw 40. The terrain uniforms carry the
  // raw preset colours; the three.js sun carries them converted to linear.
  expect(after.preset).toBe(true);
  expect(after.terrain.sun).toEqual([0.545, 0.459, 0.38]);
  expect(after.terrain.amb).toEqual([0.188, 0.2, 0.255]);
  // Sun direction: pitch from the zenith, yaw 40° around +Z, unit length.
  const [x, y, z] = after.sunPos as [number, number, number];
  expect(z).toBeCloseTo(Math.cos(35 * Math.PI / 180), 2);
  expect(Math.atan2(y, x) * 180 / Math.PI).toBeCloseTo(40, 1);
  expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);

  expect(errors).toEqual([]);
});

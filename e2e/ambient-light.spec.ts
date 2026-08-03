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
// A2C1M1, not A1C1M1: the first campaign's maps are not in the unpacked data
// at all, so this skipped itself on every run instead of checking anything.
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');

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

  // The Light toggle persists in uiPrefs; a profile left on "flat" would show
  // the fallback here and fail the preset asserts for the wrong reason.
  await page.evaluate(() => {
    const b = document.getElementById('lightbtn');
    if (b?.textContent?.includes('flat')) (b as HTMLButtonElement).click();
  });

  const after = await page.evaluate(() => window.view.ambientState());
  // A2C1M1 names /Lights/_(AmbientLight)/AdvMap/Addon2/A2C1M1.xdb: LightColor
  // (0.392, 0.322, 0.275), AmbientColor (0.188, 0.2, 0.255), Whitening on,
  // Pitch 35, Yaw 40. The uniforms carry the preset's own numbers, raw — the
  // sum they feed runs in the game's gamma space, so nothing is converted.
  expect(after.preset).toBe(true);
  expect(after.terrain.sun).toEqual([0.392, 0.322, 0.275]);
  expect(after.terrain.amb).toEqual([0.188, 0.2, 0.255]);
  expect(after.terrain.whiten).toBe(2);
  // Sun direction: pitch from the zenith, yaw 40° around +Z, unit length.
  const [x, y, z] = after.sunPos as [number, number, number];
  expect(z).toBeCloseTo(Math.cos(35 * Math.PI / 180), 2);
  expect(Math.atan2(y, x) * 180 / Math.PI).toBeCloseTo(40, 1);
  expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);

  expect(errors).toEqual([]);
});

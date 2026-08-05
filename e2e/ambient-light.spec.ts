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

  // Before any map: the fallback look. Its three colours are the ends of the
  // same mix a preset drives — sun and shade equal to ambient would be flat
  // light, so the sun end sits above it.
  const before = await page.evaluate(() => window.view.ambientState());
  expect(before.preset).toBe(false);
  expect(before.terrain.sun).toEqual([0.55, 0.55, 0.55]);
  expect(before.terrain.amb).toEqual([0.31, 0.31, 0.31]);

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
  // The multiplier is the pipeline's ×4 and does not come from the preset —
  // its <Whitening> flag reaches nothing in this path.
  expect(after.terrain.whiten).toBe(4);
  // A2C1M1's ShadeColor, the end of the mix the editor had missing entirely.
  expect(after.terrain.shade).toEqual([0.149, 0.157, 0.216]);
  // Sun direction: pitch from the zenith, yaw clockwise from +X, unit length —
  // so Yaw 40 points at −40°, the light standing in the SOUTH-EAST of the map
  // as the game shows it (docs/LIGHTING.md §3). The azimuth is asserted, not
  // just the magnitudes: this axis has been round three ways now, and only a
  // signed check tells them apart.
  const [x, y, z] = after.sunPos as [number, number, number];
  expect(z).toBeCloseTo(Math.cos(35 * Math.PI / 180), 2);
  expect(Math.atan2(y, x) * 180 / Math.PI).toBeCloseTo(-40, 1);
  expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);

  expect(errors).toEqual([]);
});

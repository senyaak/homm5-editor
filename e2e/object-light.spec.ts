// One light model, checked by arithmetic.
//
// The game shades every surface the same way — `albedo · (Ambient + Light·N·L)
// · Whitening`, clamped, multiplied in GAMMA space on the raw texel (see
// docs/LIGHTING.md §2 for where that is read from, and §2a for the probe in the
// running game that says Direct3D's own lighting is switched off). The terrain
// has always run that sum; objects used to go through three.js's linear
// lighting instead, which is not a brightness difference but a colour one.
//
// So this is not a screenshot test. `shadeProbe` draws ONE known albedo under
// ONE known normal and reads the pixel back, and the expected value is computed
// here from the preset the map actually loaded. Every term is separable: the
// normal facing away from the sun isolates Ambient, a white albedo proves the
// clamp, and the whole thing moves if the space, the factor or the clamp is
// touched.
//
// Needs the game data (the presets live in it), so it skips itself without one.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
// A2C1M1 rather than the campaign's first mission: A1C1* is not in the
// unpacked data at all, and a path that is never there is a test that never
// runs. Which preset it names does not matter — every expectation below is
// computed from the one the map actually loaded.
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('an object is lit by the game\'s own sum, not by three.js', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;

  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0);
  // The Light toggle persists in uiPrefs; a profile left on "flat" would probe
  // the fallback look and fail for the wrong reason.
  await page.evaluate(() => {
    const b = document.getElementById('lightbtn');
    if (b?.textContent?.includes('flat')) (b as HTMLButtonElement).click();
  });

  const seen = await page.evaluate(() => ({
    amb: window.view.ambientState(),
    up: window.view.shadeProbe([0.5, 0.5, 0.5], [0, 0, 1]),
    away: window.view.shadeProbe([0.5, 0.5, 0.5], [0, 0, -1]),
    white: window.view.shadeProbe([1, 1, 1], [0, 0, 1]),
    dark: window.view.shadeProbe([0.1, 0.1, 0.1], [0, 0, 1]),
  }));

  const { amb, sun, shade: shadeCol } = seen.amb.terrain;
  const w = seen.amb.terrain.whiten;
  const dir = seen.amb.sunPos as [number, number, number];
  // The whole chain is a constant ×2: the CPU writes the mixed colour into the
  // vertex as a plain byte, the vertex shader halves it (c29), the pixel
  // shader's mul_x4_sat puts four back.
  expect(w).toBe(2);

  /**
   * The game's vertex colour for one channel, as a byte.
   *
   * A MIX between three preset colours, not a sum — `LightColor` is what a
   * surface facing the sun becomes, `ShadeColor` what one facing away becomes,
   * and `AmbientColor` the middle. Read out of the running game's vertex
   * buffer and fitted over 390,000 vertices (docs/LIGHTING.md §2).
   */
  const shade = (albedo: number, i: number, ndl: number) => {
    const mix = amb[i]! + Math.max(ndl, 0) * (sun[i]! - amb[i]!)
                        + Math.max(-ndl, 0) * (shadeCol[i]! - amb[i]!);
    return Math.round(Math.min(1, albedo * mix * w) * 255);
  };

  // Flat ground's normal: N·L is the sun's height, which is cos(Pitch) because
  // Pitch counts from the zenith — the probe inside the game confirmed that
  // vector to three decimals (docs/LIGHTING.md §3).
  const ndl = dir[2];
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(seen.up[i]! - shade(0.5, i, ndl))).toBeLessThanOrEqual(1);
    expect(Math.abs(seen.dark[i]! - shade(0.1, i, ndl))).toBeLessThanOrEqual(1);
    // A normal pointing straight DOWN is the ShadeColor end of the mix, and it
    // is asserted separately because that is the term the editor had missing
    // altogether: with it dropped this probe reads AmbientColor, and on the
    // shipped menu preset the two differ by 43 in green.
    expect(Math.abs(seen.away[i]! - shade(0.5, i, -ndl))).toBeLessThanOrEqual(1);
  }

  // Halving the albedo halves the pixel: the multiply is in gamma space. Under
  // three.js's linear lighting it would not — that is the whole bug this fixes,
  // and 0.1 against 0.5 is far enough apart that a 1/2.2 power cannot hide.
  for (let i = 0; i < 3; i++) {
    expect(seen.dark[i]! / Math.max(1, seen.up[i]!)).toBeCloseTo(0.2, 1);
  }

  // A white albedo is the top of the range, and it is asserted against the same
  // formula rather than against 255. It USED to be 255 here, and that was the
  // old model showing: `min(4·sum, 2)` drove every day preset into the clamp,
  // so the brightest thing on screen and a merely bright thing came out the
  // same white. Under the measured mix this preset's lit ground reaches ×0.71,
  // and nothing clamps — which is why the game's maps have shading in them at
  // all. The clamp itself is still there for a preset that does overflow.
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(seen.white[i]! - shade(1, i, ndl))).toBeLessThanOrEqual(1);
  }

  expect(errors).toEqual([]);
});

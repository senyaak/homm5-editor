// C1M1 stage 3 — the river plane.
//
// Painted on its own half-tile grid at its own strength: of the 2317 wet cells,
// 1815 sit between vertices and they carry 134 distinct values, so neither the
// vertex grid nor a single opacity would reach them.
//
// Carving is off. It is right when drawing a river by hand and wrong here — the
// ground is already at its final height — and this map barely digs its bed
// anyway: 49.8% of its wet vertices sit below their four neighbours, by 0.058.

import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, setRiverStrength } from './tiles.ts';
import {
  NEED_FIXTURE, cellPixels, clickAt, fixture, hasFixture, mismatches, openMap, saveTerrain,
} from './c1m1.ts';
import { readHeights, readWaterPlane } from '../src/terrain.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('C1M1 rivers, on the half-tile grid', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const target = readWaterPlane(fixture())!;

  const V = await openMap(page);
  // The ground before this stage: carving is off, so it must not move.
  const heightsBefore = await page.evaluate(() => window.view.heights());
  const pixels = await cellPixels(page, target.W);

  const byStrength = new Map<number, number[]>();
  for (let i = 0; i < target.data.length; i++) {
    const v = target.data[i]!;
    if (!v) continue;
    if (!byStrength.has(v)) byStrength.set(v, []);
    byStrength.get(v)!.push(i);
  }
  const wet = [...byStrength.values()].reduce((n, a) => n + a.length, 0);
  console.log(`rivers: ${wet} cells, ${byStrength.size} distinct strengths`);

  await armBrush(page, 'river', '1');
  for (const [value, cells] of byStrength) {
    await setRiverStrength(page, value, false);
    for (const c of cells) await clickAt(page, pixels[c]!);
  }

  const built = await saveTerrain(page);
  expect(mismatches(readWaterPlane(built)!.data, target.data, target.W, 'cell'), 'river cells that differ').toEqual([]);
  expect(mismatches(readHeights(built), heightsBefore, V, 'height'), 'heights the river pass moved').toEqual([]);
});

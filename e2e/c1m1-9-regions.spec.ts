// C1M1 stage 9 — the mission's regions.
//
// Seventeen named rectangles the mission's Lua addresses: `stop1`..`stop8` along
// the road out of the starting valley, `attack04` where the ambush fires, `cam1`
// where the camera turns, `faerie`, `windmill`, `t7`..`t10`. Nothing draws them
// in game; they exist so a script can say "when the hero gets here".
//
// Drawn the way the original's editor draws them — dragged out on the map, one
// rectangle at a time — and then named and coloured in the panel. Their two
// triggers stay empty here: they name Lua functions, and the Lua is the next
// stage.
//
// Idempotent like every other stage: a region the map already has, with the
// rectangle it should have, is left alone; one that drifted is deleted and drawn
// again. Order matters — `npm run diff-map` compares `regions[3]` with
// `regions[3]` — so a rebuild starts from the first region that is wrong.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { MAP_DIR, NEED_FIXTURE, FIXTURE, hasFixture, openMap } from './c1m1.ts';
import {
  currentRegions, drawRegion, openRegions, removeRegion, setRegionColour, setRegionName,
} from './regions.ts';
import type { RegionSpec } from './regions.ts';
import { loadMap } from '../src/map.ts';
import { readTree } from '../src/tree.ts';
import type { TreeData } from '../src/tree.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

const num = (v: TreeData | undefined): number => Number(typeof v === 'string' ? v : NaN);

/** The regions the original carries, in its own order. */
function wanted(): RegionSpec[] {
  const original = loadMap(readFileSync(join(FIXTURE, '..', 'C1M1.xdb'), 'utf8'));
  const tree = readTree(original.desc) as Record<string, TreeData>;
  const items = Array.isArray(tree.regions) ? tree.regions : [];
  return items.map((it): RegionSpec => {
    const o = it as Record<string, TreeData>;
    const rect = o.Rect as Record<string, TreeData>, col = o.Color as Record<string, TreeData>;
    return {
      name: String(o.Name ?? ''),
      x1: num(rect.x1), y1: num(rect.y1), x2: num(rect.x2), y2: num(rect.y2),
      color: [num(col.x), num(col.y), num(col.z)],
    };
  });
}

test('C1M1 regions, dragged out on the map', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const want = wanted();
  expect(want.length, 'the original carries regions').toBeGreaterThan(0);

  await openMap(page);
  await openRegions(page);

  // Anything past the first region that does not match is thrown away and drawn
  // again: a region is appended, so a wrong one in the middle cannot be fixed by
  // adding — and the index is what the diff compares by.
  let have = await currentRegions(page);
  let from = have.findIndex((r, i) => {
    const w = want[i];
    return !w || r.name !== w.name || r.x1 !== w.x1 || r.y1 !== w.y1 || r.x2 !== w.x2 || r.y2 !== w.y2;
  });
  if (from === -1) from = Math.min(have.length, want.length);
  for (let i = have.length - 1; i >= from; i--) await removeRegion(page, i);
  console.log(`regions: ${from} kept, ${want.length - from} to draw`);

  for (let i = from; i < want.length; i++) {
    const w = want[i]!;
    await drawRegion(page, w);
    await expect.poll(async () => (await currentRegions(page)).length, { timeout: 20_000 }).toBe(i + 1);
    const made = (await currentRegions(page))[i]!;
    expect([made.x1, made.y1, made.x2, made.y2],
      `${w.name}: the rectangle the drag produced`).toEqual([w.x1, w.y1, w.x2, w.y2]);
    await setRegionName(page, i, w.name);
    await setRegionColour(page, i, w.color);
  }

  // The outlines are the only thing on screen that says where a region is, and
  // the file would look identical with them drawing nothing. One segment per
  // tile of each border, so the count follows from the rectangles themselves.
  const segments = want.reduce((n, w) => n + 2 * (w.x2 - w.x1 + 1) + 2 * (w.y2 - w.y1 + 1), 0);
  expect(await page.evaluate(() => window.view.regionOutline()),
    'line segments the region outlines are drawn with').toBe(segments);

  await settle(page);
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  // --- what landed in the file ---
  const built = readTree(loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8')).desc) as Record<string, TreeData>;
  const got = Array.isArray(built.regions) ? built.regions : [];
  expect(got.length, 'regions in the file').toBe(want.length);
  const wrong: string[] = [];
  got.forEach((it, i) => {
    const o = it as Record<string, TreeData>, w = want[i]!;
    const rect = o.Rect as Record<string, TreeData>, col = o.Color as Record<string, TreeData>;
    const same = String(o.Name) === w.name
      && num(rect.x1) === w.x1 && num(rect.y1) === w.y1
      && num(rect.x2) === w.x2 && num(rect.y2) === w.y2
      && [col.x, col.y, col.z].every((c, k) => Math.abs(num(c) - w.color[k]!) < 1e-5);
    if (!same) {
      wrong.push(`regions[${i}] ${String(o.Name)} ${num(rect.x1)},${num(rect.y1)}—${num(rect.x2)},${num(rect.y2)}`
        + ` rgb(${num(col.x)}, ${num(col.y)}, ${num(col.z)})`
        + ` instead of ${w.name} ${w.x1},${w.y1}—${w.x2},${w.y2} rgb(${w.color.join(', ')})`);
    }
  });
  expect(wrong, `regions that differ (${wrong.length})`).toEqual([]);
});

// C1M1 stage 2 — the ground kinds: tiers and ramps.
//
// After the heights, and the order matters: every sculpting tool rewrites the
// flag of the ground it moves, while the ground-kind brush leaves the height
// alone. Kinds first would undo themselves.
//
// One rectangle lays down the kind most of the map shares — 8195 of 9409
// vertices here — and the rest goes on vertex by vertex, which is how a person
// would do it too.

import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, dragTiles, setGroundKind } from './tiles.ts';
import {
  NEED_FIXTURE, clickAt, fixture, hasFixture, mismatches, openMap, saveTerrain, vertexPixels,
} from './c1m1.ts';
import { readGroundFlags, readHeights, tierOf, RAMP_BIT } from '../src/terrain.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('C1M1 tiers and ramps, painted without moving the ground', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const target = readGroundFlags(fixture())!;

  const V = await openMap(page);
  // The ground as it stands before this stage — what it must still be after.
  // Taken from the map rather than from the original, so the check holds even
  // when this stage is run on its own, before the heights are finished.
  const heightsBefore = await page.evaluate(() => window.view.heights());
  const pixels = await vertexPixels(page, V);

  const byKind = new Map<number, number[]>();
  for (let i = 0; i < target.length; i++) {
    const k = target[i]!;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(i);
  }
  const kinds = [...byKind].sort((a, b) => b[1].length - a[1].length);
  console.log(`kinds: ${kinds.map(([k, v]) => `${k}×${v.length}`).join(' ')}`);

  const paint = (kind: number): Promise<void> => setGroundKind(page, tierOf(kind), (kind & RAMP_BIT) !== 0);

  const [bulkKind, bulkVerts] = kinds[0]!;
  await armBrush(page, 'kind', 'rect');
  await paint(bulkKind);
  await dragTiles(page, [0, 0], [V - 2, V - 2], 12);
  console.log(`  one rect stroke: kind ${bulkKind} over ${bulkVerts.length} vertices`);

  await armBrush(page, 'kind', 'vertex');
  let painted = 0;
  for (const [kind, verts] of kinds.slice(1)) {
    await paint(kind);
    for (const v of verts) { await clickAt(page, pixels[v]!); painted++; }
  }
  console.log(`  ${painted} vertices painted one at a time`);

  const built = await saveTerrain(page);
  expect(mismatches(readGroundFlags(built)!, target, V, 'kind'), 'ground kinds that differ').toEqual([]);
  // Painting a kind must not move the ground.
  expect(mismatches(readHeights(built), heightsBefore, V, 'height'), 'heights the kind pass moved').toEqual([]);
});

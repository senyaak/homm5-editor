// C1M1 stage 5 — passability: which tiles a hero simply cannot enter.
//
// Last, because it is the one plane that says nothing about how the ground
// looks: it is a decision the designer records by hand, and it has to be taken
// on the finished surface. C1M1 blocks 4939 of its 9409 tiles — a campaign map
// is a corridor, and the mountains around it are masked, not merely steep.
//
// The plane does not exist in a map made by New Map: the format reserves the
// slot and leaves it empty, so the first stroke of this stage is also the one
// structural edit of it (src/terrain-plane.ts). Everything it starts as is
// walkable, so only the blocked tiles are painted.
//
// Painted as horizontal runs with the Rect brush — 4939 tiles in 424 strokes,
// which is both faster and what a person actually does with a mask.

import { test, expect } from '@playwright/test';
import { launchEditor } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { armBrush } from '../tiles.ts';
import {
  currentTerrain, dragAt, fixture, mismatches, openMap, requireFixture, saveTerrain,
  tilePixels,
} from './shared.ts';
import {
  readGroundFlags, readHeights, readMask, readPassability, readTextureLayers, readWaterPlane,
  BLOCKED,
} from '../../src/terrain.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('C1M1 passability, masked run by run', async () => {
  requireFixture();
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const ref = fixture();
  const target = readPassability(ref);
  expect(target, 'the original carries a passability plane').toBeTruthy();

  const V = await openMap(page);
  const T = V - 1;
  // Every other plane as it stands before this stage — a mask stroke must move
  // none of them. Taken from the map rather than from the original, so the check
  // holds even when this stage is run on its own.
  const before = currentTerrain();
  const heightsBefore = readHeights(before);
  const flagsBefore = readGroundFlags(before);
  const riverBefore = readWaterPlane(before);
  const masksBefore = readTextureLayers(before).map((l) => ({ path: l.path, data: Uint8Array.from(readMask(before, l)) }));

  const pixels = await tilePixels(page, T);

  // The mask is stored vertex-sized but addressed per tile: entry y*V + x is
  // tile (x, y), and the last row and column are filler — zero blocked across
  // every shipped map, and zero here too.
  const runs: [number, number, number][] = []; // y, x0, x1
  let blocked = 0;
  for (let y = 0; y < T; y++) {
    let start = -1;
    for (let x = 0; x <= T; x++) {
      const on = x < T && target![y * V + x] === BLOCKED;
      if (on) { blocked++; if (start < 0) start = x; continue; }
      if (start >= 0) { runs.push([y, start, x - 1]); start = -1; }
    }
  }
  let filler = 0;
  for (let i = 0; i < V; i++) {
    if (target![(V - 1) * V + i] === BLOCKED) filler++;
    if (target![i * V + V - 1] === BLOCKED) filler++;
  }
  console.log(`passability: ${blocked} blocked tiles in ${runs.length} runs (filler row/col blocked: ${filler})`);

  await armBrush(page, 'mask', 'rect');
  const started = Date.now();
  let done = 0;
  for (const [y, x0, x1] of runs) {
    await dragAt(page, pixels[y * T + x0]!, pixels[y * T + x1]!);
    if (++done % 100 === 0) {
      console.log(`  ${done}/${runs.length} runs (${(done / ((Date.now() - started) / 1000)).toFixed(0)}/s)`);
    }
  }
  console.log(`  ${runs.length} strokes in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  const built = await saveTerrain(page);
  const got = readPassability(built);
  expect(got, 'the rebuilt map has a passability plane').toBeTruthy();
  expect(mismatches(got!, target!, V, 'tile'), 'passability entries that differ').toEqual([]);

  // Filling in the plane rewrites the container, so the rest of it is the real
  // risk here — a missed ancestor length truncates a later plane silently.
  expect(mismatches(readHeights(built), heightsBefore, V, 'height'), 'heights the mask pass moved').toEqual([]);
  expect(mismatches(readGroundFlags(built)!, flagsBefore!, V, 'kind'), 'ground kinds the mask pass moved').toEqual([]);
  expect(mismatches(readWaterPlane(built)!.data, riverBefore!.data, riverBefore!.W, 'cell'),
    'river cells the mask pass moved').toEqual([]);
  const masksAfter = readTextureLayers(built);
  expect(masksAfter.map((l) => l.path), 'the layer set the mask pass left').toEqual(masksBefore.map((l) => l.path));
  for (let i = 0; i < masksBefore.length; i++) {
    expect(mismatches(readMask(built, masksAfter[i]!), masksBefore[i]!.data, V, `weight ${masksBefore[i]!.path}`),
      'tile weights the mask pass moved').toEqual([]);
  }
});

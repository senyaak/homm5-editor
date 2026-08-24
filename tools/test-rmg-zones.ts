// GenerateGameZones — the zone placement phase.
//
//   node tools/test-rmg-zones.ts
//
// The phase's reading was reconciled against reference run 1 (176x176, one
// floor, one pass: 1234 draws predicted, 1234 counted), so what this suite
// holds the PORT to is that reading: the draw budget 2n + P*(n-1)*(1+F), the
// hand-computed radius for the reference template, and the hash-order model.
// The run-3 numbers (366 draws, R = 15, k = 0.90) are predictions until the
// counter hook is moved to the editor — marked as such in docs/RMG.md.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { floorIterationOrder, generateGameZones, zoneRadius } from '../src/rmg/zones.ts';
import type { ZoneSeed } from '../src/rmg/zones.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('iteration order');

// Indices 1..12 land in their own buckets: plain ascending.
const seeds = (indices: number[]): ZoneSeed[] => indices.map((index) => ({ index, size: 10, floor: 0 }));
check('indices 1..12 iterate ascending',
  floorIterationOrder(seeds([4, 1, 3, 2])).map((z) => z.index).join(',') === '1,2,3,4');
// A colliding bucket yields newest first — head insertion, the hash_map's own habit.
check('a bucket collision iterates newest first',
  floorIterationOrder(seeds([1, 14])).map((z) => z.index).join(',') === '14,1');
// Thirteen zones still fit 13 buckets (the rehash triggers on the FOURTEENTH
// insert), and index 13 wraps to bucket 0 — it iterates first.
check('thirteen zones: index 13 wraps to the front',
  floorIterationOrder(seeds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])).map((z) => z.index).join(',')
    === '13,1,2,3,4,5,6,7,8,9,10,11,12');
// Fifteen zones live in a rehashed 29-bucket table where indices <= 28 no
// longer collide: plain ascending again.
check('fifteen zones: the 29-bucket table iterates ascending',
  floorIterationOrder(seeds([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).map((z) => z.index).join(',')
    === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15');
// The one unread path refuses instead of guessing: post-rehash within-bucket
// order depends on how the rehash re-inserted, which nobody has read yet.
check('a collision after a rehash refuses instead of guessing', (() => {
  try { floorIterationOrder(seeds([30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])); return false; }
  catch { return true; }
})());

console.log('\nthe shipped templates stay inside the modelled order');

const dir = join(dataDir(), 'RMG', 'Templates');
if (existsSync(dir)) {
  // The one refused path is a collision in a rehashed table. A whole template
  // on one floor is the worst case however LoadTemplate actually splits
  // floors — if that survives, any split does (fewer zones, same indices).
  // And the model is load-bearing, not decoration: shipped indices reach 15,
  // so in a small table zone 14 would iterate before zone 2.
  let worstCount = 0;
  let worstIndex = 0;
  let refused = '';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.xdb'))) {
    const t = readTemplate(join(dir, file));
    worstCount = Math.max(worstCount, t.zones.length);
    for (const z of t.zones) worstIndex = Math.max(worstIndex, z.index);
    try { floorIterationOrder(t.zones.map((z) => ({ index: z.index, size: z.size, floor: 0 }))); }
    catch { refused = file; }
  }
  check('every shipped template orders, even all on one floor', refused === '',
    refused || `max ${worstCount} zones, max index ${worstIndex}`);
  check('and indices do pass 12 — the bucket model is real', worstIndex > 12, `max index ${worstIndex}`);
} else {
  console.log('  no unpacked RMG templates — skipping');
}

console.log('\nthe reference layout (predictions until the editor counter hook exists)');

// Run 3's setup: S1P2Z2M1 — four zones of Size 10 on one floor, map 96x96.
const zones: ZoneSeed[] = [1, 2, 3, 4].map((index) => ({ index, size: 10, floor: 0 }));
const rng = new RmgRandom(1785351845);
const g = generateGameZones(96, 96, zones, 1, false, rng);

check('all four zones placed', g.zones.length === 4);
// Hand-derived from the disassembly's formula, not read back from the port:
// fl(9216*0.9) = 8294.4004; fl(10*that)/40 = 2073.6001; sqrt/3 = 15.17 -> 15.
check('every radius is 15', g.zones.every((z) => z.r === 15), g.zones.map((z) => z.r).join(','));
check('k is the undropped 0.90 when one pass suffices',
  g.passes !== 1 || g.k === Math.fround(0.9), `${g.passes} passes, k=${g.k}`);
// 96x96 -> n=92 points: 184 to draw them, then (n-1)*(1+F) = 182 per pass.
check('the draw budget is 184 + 182 per pass', rng.draws === 184 + g.passes * 182,
  `${rng.draws} draws, ${g.passes} passes`);
check('start points are whole tiles inside the border ring', g.zones.every((z) =>
  Number.isInteger(z.x) && Number.isInteger(z.y)
  && z.x >= z.r && z.x <= 96 - z.r && z.y >= z.r && z.y <= 96 - z.r));
// Same floor may not overlap; the engine compares centre distance to r1+r2.
check('no two placed zones overlap', g.zones.every((a, i) => g.zones.slice(i + 1).every((b) =>
  Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r)));

const again = generateGameZones(96, 96, zones, 1, false, new RmgRandom(1785351845));
check('the same seed lays the same zones', JSON.stringify(again) === JSON.stringify(g));

const other = generateGameZones(96, 96, zones, 1, false, new RmgRandom(1000));
check('a different seed does not', JSON.stringify(other.zones) !== JSON.stringify(g.zones));

console.log('\nthe budget holds off the reference path too');

// An empty second floor still costs its shuffle — the draw comes before any
// zone is looked at.
const rng2 = new RmgRandom(7);
const twoFloor = generateGameZones(96, 96, zones, 2, false, rng2);
check('an empty floor costs a full shuffle', rng2.draws === 184 + twoFloor.passes * 91 * 3,
  `${rng2.draws} draws, ${twoFloor.passes} passes`);

// twoFloors stretches radii by sqrt(2). The formula itself, held to numbers
// derived by hand: base trunc(sqrt(2073.6001)/3) = 15, stretched
// trunc(15 * 1.41421354) = 21.
check('the radius formula gives 15, stretched 21',
  zoneRadius(9216, 10, 40, Math.fround(0.9), false) === 15
  && zoneRadius(9216, 10, 40, Math.fround(0.9), true) === 21);
// End to end the stretched zones DON'T land at 21: four r=21 circles refuse
// to fit a 96x96 map, so the engine decays k until they shrink enough — the
// retry loop earning its keep. Whatever pass count it took, the final radii
// must be the formula at the final k.
const stretched = generateGameZones(96, 96, zones, 1, true, new RmgRandom(1785351845));
check('stretched radii match the formula at the k the last pass used',
  stretched.passes > 1
  && stretched.zones.every((z) => z.r === zoneRadius(9216, 10, 40, stretched.k, true)),
  `${stretched.passes} passes, r=${stretched.zones.map((z) => z.r).join(',')}`);

// Run 1's shape: 176x176 -> n=309, one floor, and the oracle counted 1234 for
// one pass. If this seed happens to need more passes the formula still holds.
const rng3 = new RmgRandom(1785351845);
const big = generateGameZones(176, 176, [1, 2, 3, 4, 5, 6, 7].map((index) => ({ index, size: 10, floor: 0 })),
  1, false, rng3);
check('run 1 geometry spends 618 + 616 per pass', rng3.draws === 618 + big.passes * 616,
  `${rng3.draws} draws, ${big.passes} passes`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

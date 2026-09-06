// FillZones — the tile assignment phase.
//
//   node tools/test-rmg-fill-zones.ts
//
// The phase's structural budget reconciled against reference run 1 (305
// sweeps on 176x176, two coins each); the jitter's exact draw count is data,
// so what this suite holds the port to is the reading's shape: the sweep
// count, the draw arithmetic, the drawless first sweep, and determinism. The
// chain here is SYNTHETIC — zones straight from the seed, skipping the
// phases before them — which is fine for properties; the true engine chain,
// boundary by boundary, lives in test-rmg-load-template.ts.

import { existsSync } from 'node:fs';

import { RmgRandom } from '../src/rmg/random.ts';
import { dataDir } from './game-dir.ts';
import { runChain } from './rmg-chain.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import type { ZoneSeed } from '../src/rmg/zones.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('both phases end to end, on a synthetic chain');

// Run 3's shape: seed 1785351845, S1P2Z2M1 — four zones of Size 10, 96x96.
const zones: ZoneSeed[] = [1, 2, 3, 4].map((index) => ({ index, size: 10, floor: 0 }));
const rng = new RmgRandom(1785351845);
const placed = generateGameZones(96, 96, zones, false, rng);
const afterZones = rng.draws;

const filled = fillZones(96, 96, placed.zones, false, rng);

// while fl(fl(96) * 1.7320508f) > counter -> 166.27... admits 0..166.
check('a 96 map runs 167 sweeps', filled.sweepsPerFloor === 167, `${filled.sweepsPerFloor}`);
check('the phase spends two coins a sweep plus the jitter',
  rng.draws - afterZones === 2 * 167 + filled.jitterDraws,
  `${rng.draws - afterZones} draws, ${filled.jitterDraws} jitter`);
// Zero by construction: the areas the ratio test reads are last sweep's, and
// before the first sweep every zone's is zero — NaN refuses without drawing.
check('the first sweep draws no jitter at all', filled.firstSweepJitterDraws === 0,
  `${filled.firstSweepJitterDraws}`);
// The number itself is data, on a synthetic chain — printed so a drift is
// visible in the log, asserted nowhere.
console.log(`  (this chain's FillZones total: ${rng.draws - afterZones} draws)`);

const grid = filled.floors[0]!;
let unassigned = 0;
const area = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0]]);
for (let a = 0; a < 96; a++) {
  for (let b = 0; b < 96; b++) {
    const z = grid[a]![b]!;
    if (z === -1) unassigned++;
    else area.set(z, (area.get(z) ?? 0) + 1);
  }
}
check('every tile ended up in one of the four zones or unassigned',
  unassigned + [...area.values()].reduce((s, n) => s + n, 0) === 96 * 96);
check('every zone owns tiles', [...area.values()].every((n) => n > 0),
  [...area.entries()].map(([k, v]) => `${k}:${v}`).join(' '));
check('the map is mostly claimed', unassigned < 96 * 96 * 0.25, `${unassigned} unassigned`);

console.log('\ndeterminism and refusals');

const rng2 = new RmgRandom(1785351845);
const placed2 = generateGameZones(96, 96, zones, false, rng2);
const filled2 = fillZones(96, 96, placed2.zones, false, rng2);
check('the same seed fills the same tiles', filled2.floors[0]!.every((row, a) =>
  row.every((v, b) => v === grid[a]![b])));

check('a rectangle refuses — the engine only ever runs square', (() => {
  try { fillZones(96, 72, placed.zones, false, new RmgRandom(1)); return false; }
  catch { return true; }
})());

console.log('\nfifteen zones on one floor, where the hash buckets collide');

// THE ONLY CASE THAT CAN SEE THE NEIGHBOUR SCAN'S ORDER. Under thirteen zones
// every index has a bucket to itself, so head insertion never has to break a
// tie and the eight offsets could be visited in any order without a single
// tile moving. `S7-22P2-8Z15K2.4c` puts zones 2 and 15 in bucket 2 of 13, and
// then the order decides which of two equal neighbour counts wins.
//
// The three numbers below are the ENGINE'S, off the oracle's own trace of the
// editor generating this map (seed 1785351845): its `gz` pairs give the
// candidate, its `tf` runs between the `zc` groups give the draws. The port
// matched all 443 sweeps of pairs and all 444 area snapshots when they were
// last measured; these three are the cheap end of that.
if (!existsSync(dataDir())) {
  console.log('  no unpacked RMG data - run `npm run unpack-data`; skipping');
} else {
  let jitterTotal = 0;
  const perSweep = new Map<number, number>();
  let seen = 0;
  let candidate961 = '';
  runChain(dataDir(), {
    template: 'S7-22P2-8Z15K2.4c', size: 256, players: 2, seed: 1785351845,
    monsterStrength: 1, water: 0,
    jitter: (sweep) => { jitterTotal++; perSweep.set(sweep, (perSweep.get(sweep) ?? 0) + 1); },
    candidate: (sweep, _a, _b, own, best) => {
      if (sweep === 27 && seen++ === 961) candidate961 = `${own}->${best}`;
    },
  });
  check('the tile the tie decides goes to zone 2, as the engine sends it',
    candidate961 === '13->2', candidate961 || 'no such candidate');
  check("sweep 34 spends the engine's 394 jitter draws",
    perSweep.get(34) === 394, `${perSweep.get(34)}`);
  check("the phase spends the engine's 383555 jitter draws in all",
    jitterTotal === 383555, `${jitterTotal}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

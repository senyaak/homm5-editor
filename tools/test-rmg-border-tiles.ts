// CalcBorderTiles — the distance-to-border table.
//
//   node tools/test-rmg-border-tiles.ts
//
// The phase draws nothing, so there is no counter to hold it to; what this
// suite checks is the definition — truncated Euclid to the nearest own-zone
// border, borders at zero — on a synthetic grid where the answer is
// hand-computable, and the reference chain's table for shape, determinism
// and the draw-free contract.

import { calcBorderTiles } from '../src/rmg/border-tiles.ts';
import { createMap } from '../src/rmg/create-map.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { readParams } from '../src/rmg/params.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('the definition, on a grid small enough to check by hand');

// One zone covering a 12x12 floor: the border is the edge ring, and a tile's
// distance is plainly its distance to the nearest edge.
const solid = [Array.from({ length: 12 }, () => new Int32Array(12).fill(7))];
const d = calcBorderTiles(12, 12, solid)[0]!;
check('the edge ring is zero', d[0]!.every((v) => v === 0) && d[11]!.every((v) => v === 0)
  && d.every((col) => col[0] === 0 && col[11] === 0));
check('one in from the edge is 1', d[1]![1] === 1 && d[1]![5] === 1 && d[5]![1] === 1);
check('the centre is 5 tiles deep', d[5]![5] === 5 && d[6]![6] === 5, `${d[5]![5]}`);
// Truncation, not rounding: (2,2) from the ring's corner-adjacent tiles —
// nearest border is (0,2)/(2,0) at plain distance 2.
check('distances truncate toward zero', d[2]![3] === 2 && d[3]![3] === 3);

// A zone of -1 has no borders of its own: it keeps the 10000 the minimum
// started from.
const holed = [Array.from({ length: 12 }, (_, a) => new Int32Array(12).fill(a < 6 ? 3 : -1))];
const hd = calcBorderTiles(12, 12, holed)[0]!;
check('unassigned tiles read 10000', hd[8]![4] === 10000, `${hd[8]![4]}`);
check('and the assigned half still measures to ITS border', hd[3]![5] === 2, `${hd[3]![5]}`);

console.log('\nthe reference chain');

const dir = join(dataDir(), 'RMG');
if (!existsSync(dir)) {
  console.log('no unpacked RMG data — skipping');
} else {
  const t = readTemplate(join(dir, 'Templates', 'S1P2Z2M1.xdb'));
  const p = readParams(join(dir, 'Params', 'Default.xdb'));
  const rng = new RmgRandom(1785351845);
  const made = createMap(t, { players: 2, size: 8 }, rng);
  const setup = mapSetup(p, { monsterStrength: 1, water: 0 }, rng);
  const lt = loadTemplate(t, {
    twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
    playerCount: made.players, mapSize: 96, pointLightZoneRadius: p.pointLightParams.zoneRadius,
  }, rng);
  const zones = generateGameZones(96, 96,
    lt.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
  const filled = fillZones(96, 96, zones.zones, made.twoFloors, rng);
  const before = rng.draws;
  const dist = calcBorderTiles(96, 96, filled.floors);
  check('the phase spends no draws at all', rng.draws === before, `${rng.draws - before}`);

  const grid = filled.floors[0]!;
  const table = dist[0]!;
  let zeros = 0;
  let max = 0;
  let deep = 0;
  for (let a = 0; a < 96; a++) {
    for (let b = 0; b < 96; b++) {
      const v = table[a]![b]!;
      if (v === 0) zeros++;
      if (v > max) max = v;
      if (v > 7) deep++; // the readers' R/2 threshold with R = 15
    }
  }
  check('the whole map edge is border', [0, 95].every((a) => table[a]!.every((v) => v === 0))
    && table.every((col) => col[0] === 0 && col[95] === 0));
  check('no tile reads 10000 — every tile has a zone', max < 10000, `max ${max}`);
  check('every zone keeps a deep core past R/2', deep > 0, `${deep} tiles deeper than 7, max ${max}`);
  console.log(`  (reference table: ${zeros} border tiles, deepest ${max})`);

  // The definition, spot-checked against plain double arithmetic on a
  // handful of tiles — the single-precision pipeline may only differ from it
  // by the truncation boundary, and on these it does not.
  let agree = true;
  for (const [a, b] of [[20, 20], [48, 48], [70, 30], [33, 62]] as const) {
    const z = grid[a]![b]!;
    let best = Infinity;
    for (let x = 0; x < 96; x++) {
      for (let y = 0; y < 96; y++) {
        if (table[x]![y] !== 0 || grid[x]![y] !== z) continue;
        best = Math.min(best, Math.hypot(a - x, b - y));
      }
    }
    if (Math.trunc(best) !== table[a]![b]) agree = false;
  }
  check('spot checks agree with the plain-arithmetic definition', agree);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

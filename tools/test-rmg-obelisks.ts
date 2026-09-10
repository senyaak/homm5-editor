// The grail order's two additions — the obelisks and the Graal.
//
//   node tools/test-rmg-obelisks.ts
//
// The arithmetic first, because it is what a wrong reading would get wrong
// silently: the count is `trunc(zoneTiles * N / area) + 2`, and BOTH
// increments are in the engine (`inc eax` in the caller at `0xEA468C`, then
// `lea ebp,[eax+1]` in the callee at `0xEBFFD2`). Off by one either way and a
// seven-zone medium comes out with 31 or 45 obelisks instead of 38.
//
// Then the Graal's own stamp, which no footprint explains: its shared document
// has empty blocked, active, hole and passable lists, and `0xEC03F5`/`0xEC0425`
// still push its tile into the zone's points and write occupancy 4 for it. That
// is what makes the NEXT obelisk's candidate list a different one, and the
// measured run parts at exactly that list when the stamp is missing.

import { obeliskCount, obeliskNumerator, placeZoneGraal } from '../src/rmg/obelisks.ts';
import type { Footprint, Tile } from '../src/rmg/placement.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ------------------------------------------------ the count, against a real map
// `S1-2P2Z7V2` at MEDIUM, seed 1789069784: the zone tile counts the port
// computes, and the 38 obelisks the engine's archive holds.
{
  const zones = [2338, 2332, 2311, 2375, 2402, 2366, 4372];
  const counts = zones.map((t) => obeliskCount(t, 2, 136));
  check('the per-size numerator is 10 / 18 / 26',
    obeliskNumerator(0) === 10 && obeliskNumerator(1) === 18 && obeliskNumerator(2) === 26
    && obeliskNumerator(6) === 26);
  check('zone 1 of the measured map gets five', counts[0] === 5, `${counts[0]}`);
  check('the widest zone gets eight', counts[6] === 8, `${counts[6]}`);
  check('and the seven come to the archive\'s 38',
    counts.reduce((a, b) => a + b, 0) === 38, `${counts.reduce((a, b) => a + b, 0)}`);
  // The two increments, named apart: without either the sum is not 38.
  const withoutOne = zones.map((t) => Math.trunc((t * 26) / (136 * 136)) + 1).reduce((a, b) => a + b, 0);
  const withoutBoth = zones.map((t) => Math.trunc((t * 26) / (136 * 136))).reduce((a, b) => a + b, 0);
  check('one increment short gives 31, none gives 24 — so both are needed',
    withoutOne === 31 && withoutBoth === 24, `${withoutOne} and ${withoutBoth}`);
}

// ------------------------------------------------------- the Graal's own stamp
// A floor with one free zone, a Graal whose lists are all empty, and the two
// writes the engine makes by hand.
{
  const size = 20;
  const grid = Array.from({ length: size }, () => new Int32Array(size).fill(1));
  const border = Array.from({ length: size }, () => new Int32Array(size).fill(9));
  const room = Array.from({ length: size }, () => new Int32Array(size).fill(0));
  const occupancy = new Int32Array(size * size);
  const points: Tile[] = [[3, 3]];
  const empty: Footprint = { path: '/MapObjects/Artifacts/Graal.xdb', blocked: [], active: [], marker: [0, 0] };
  const stub = { below: (n: number) => n - 1, betweenFloat: () => 0 };
  const placed = placeZoneGraal({
    size, sizeIndex: 2, grid, border, occupancy, room, points,
    zoneIndex: 1, floor: 0, tiles: [[8, 8], [9, 9], [10, 10]],
    obelisk: empty, graal: empty,
  }, stub);
  check('the Graal lands', placed !== null, placed ? `${placed.x},${placed.y}` : 'nothing');
  if (placed) {
    check('its own tile is occupancy 4', occupancy[placed.y * size + placed.x] === 4,
      `${occupancy[placed.y * size + placed.x]}`);
    check('and it joined the zone\'s points',
      points.some(([x, y]) => x === placed.x && y === placed.y), `${points.length} points`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

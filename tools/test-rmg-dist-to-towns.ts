// FillDistToTownsTable — the wave from each zone's centre, and the tiles it
// cannot reach.
//
//   node tools/test-rmg-dist-to-towns.ts
//
// The phase draws nothing and writes a table no map file records, so there
// is no direct oracle for it. What CAN be held: the definition (a 2-and-3
// wave that never leaves its own zone), and its side effect — the tiles it
// disowns, which every later phase sees. The real check arrives with
// ZoneConnections, whose sixteen draws depend on which tiles still belong to
// a zone by then.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { calcBorderTiles } from '../src/rmg/border-tiles.ts';
import { createMap } from '../src/rmg/create-map.ts';
import { DISOWNED, fillDistToTowns, UNREACHED } from '../src/rmg/dist-to-towns.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { readParams } from '../src/rmg/params.ts';
import { readPresets } from '../src/rmg/preset-table.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { readTownShared, readTownSpecializations } from '../src/rmg/town-data.ts';
import type { TownShared } from '../src/rmg/town-data.ts';
import { placeTowns } from '../src/rmg/towns.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('the wave, on a grid small enough to check by hand');

// One zone filling a 9x9 floor, centre in the middle: a step costs 2, a
// diagonal 3, so the corner is three diagonals away — 9, not 6.
{
  const grid = [Array.from({ length: 9 }, () => new Int32Array(9).fill(5))];
  const dist = fillDistToTowns(9, grid, [{ index: 5, floor: 0 }], new Map([[5, { a: 4, b: 4 }]]))[0]!;
  check('the centre reads zero', dist[4]![4] === 0);
  check('a step costs 2', dist[4]![5] === 2 && dist[3]![4] === 2);
  check('a diagonal costs 3', dist[3]![3] === 3 && dist[5]![5] === 3);
  check('three diagonals reach the corner at 9', dist[7]![7] === 9, `${dist[7]![7]}`);
  // Four steps along one axis, or two diagonals and a step: both 8.
  check('a mixed path costs what its cheapest mix costs', dist[4]![8] === 8 && dist[2]![7] === 8,
    `${dist[4]![8]} ${dist[2]![7]}`);
}

// A zone split in two by another zone: the far half cannot be reached and is
// disowned, the near half keeps its distances.
{
  const grid = [Array.from({ length: 9 }, (_, a) => new Int32Array(9).fill(a === 4 ? 6 : 5))];
  const dist = fillDistToTowns(9, grid, [{ index: 5, floor: 0 }], new Map([[5, { a: 1, b: 4 }]]))[0]!;
  check('the reachable half keeps its wave', dist[0]![4] === 2 && dist[3]![4] === 4,
    `${dist[0]![4]} ${dist[3]![4]}`);
  check('the walled-off half stays unreached', dist[6]![4] === UNREACHED, `${dist[6]![4]}`);
  check('and is disowned in the zone grid', grid[0]![6]![4] === DISOWNED, `${grid[0]![6]![4]}`);
  check('while the reachable half still belongs', grid[0]![3]![4] === 5);
  check('the wall itself is untouched', grid[0]![4]![4] === 6);
}

console.log('\nthe reference chain');

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.log('  no unpacked RMG data — skipping');
} else {
  const template = readTemplate(join(dir, 'RMG', 'Templates', 'S1P2Z2M1.xdb'));
  const params = readParams(join(dir, 'RMG', 'Params', 'Default.xdb'));
  const presets = readPresets(dir);
  const towns = new Map<string, TownShared>();
  for (const preset of presets.values()) {
    if (preset.townProto) {
      const shared = readTownShared(dir, preset.townProto);
      towns.set(shared.path, shared);
    }
  }

  const rng = new RmgRandom(1785351845);
  const made = createMap(template, { players: 2, size: 8 }, rng);
  const setup = mapSetup(params, { monsterStrength: 1, water: false }, rng);
  const loaded = loadTemplate(template, {
    twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
    playerCount: made.players, mapSize: 96, pointLightZoneRadius: params.pointLightParams.zoneRadius,
  }, rng);
  const placed = generateGameZones(96, 96,
    loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
  const filled = fillZones(96, 96, placed.zones, made.twoFloors, rng);
  const distances = calcBorderTiles(96, 96, filled.floors);
  const result = placeTowns({
    size: 96, template, zones: loaded.zones, floors: filled.floors, distances,
    radii: new Map(placed.zones.map((z) => [z.index, z.r])),
    presets, towns, specializations: readTownSpecializations(dir),
  }, rng);

  const before = rng.draws;
  const grid = filled.floors[0]!;
  const owned = new Map<number, number>();
  for (let a = 0; a < 96; a++) for (let b = 0; b < 96; b++) {
    const z = grid[a]![b]!;
    owned.set(z, (owned.get(z) ?? 0) + 1);
  }
  const toTowns = fillDistToTowns(96, filled.floors, loaded.zones, result.centres)[0]!;
  check('the phase spends no draws', rng.draws === before, `${rng.draws - before}`);

  let disowned = 0;
  let reached = 0;
  let deepest = 0;
  for (let a = 0; a < 96; a++) {
    for (let b = 0; b < 96; b++) {
      if (grid[a]![b] === DISOWNED) disowned++;
      else if (toTowns[a]![b] !== UNREACHED) {
        reached++;
        deepest = Math.max(deepest, toTowns[a]![b]!);
      }
    }
  }
  check('every tile is either reached or disowned', reached + disowned === 96 * 96,
    `${reached} reached, ${disowned} disowned`);
  console.log(`  (reference: ${disowned} tiles disowned, farthest ${deepest})`);

  // Each zone's own centre must read zero — the seed of its wave.
  let centresOk = true;
  for (const [index, centre] of result.centres) {
    const a = Math.trunc(centre.a);
    const b = Math.trunc(centre.b);
    if (grid[a]![b] === index && toTowns[a]![b] !== 0) centresOk = false;
  }
  check('every zone centre seeds its own wave at zero', centresOk);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

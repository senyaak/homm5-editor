// The statics phase — the second zone loop, live on the reference seed.
//
//   node tools/test-rmg-statics.ts
//
// The whole run up to here replays first — the first loop of MainObjects
// (test-rmg-road's boundaries), then the roads phase — with the zone
// roads and mine actives kept, because the statics' room recomputes ride
// on mask 0x3C: the zone's `+0x68` points plus all three road lists.
// Then the driver `0xEA5450`: zones in TEMPLATE ENTRY order, big statics
// before one-tile statics in each, no prologue draw — the phase begins
// exactly on the roads boundary, and every traced step boundary is
// asserted.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createVertexHeights } from '../src/rmg/massif-carve.ts';
import type { Footprint, Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { placeZoneBigStatics } from '../src/rmg/statics-big.ts';
import type { PlacedStatic } from '../src/rmg/statics-big.ts';
import { placeZoneOneTileStatics } from '../src/rmg/statics-one-tile.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { runChain, SIZE, ZoneFill } from './rmg-chain.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.log('no unpacked RMG data — skipping');
  process.exit(0);
}

const c = runChain(dir);
c.rng.next(); // the MainObjects prologue draw

console.log('the first loop and the roads phase, replayed');

const fills = new Map<number, ZoneFill>();
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
for (const zone of [1, 2, 3, 4]) {
  const fill = new ZoneFill(c, zone);
  fills.set(zone, fill);
  mineActives.set(zone, fill.mines().flatMap((m) => m.actives));
  fill.dwellings();
  fill.upgradeBuildings();
  fill.shrines();
  fill.resourceBuildings();
  fill.treasuryBuildings();
  fill.luckMorale();
  fill.shops();
  fill.observatories();
  fill.treasures();
  fill.chests();
  roads.set(zone, fill.road());
}
check('the first loop ends on the traced 20039', c.rng.draws === 20039, `${c.rng.draws}`);

for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === 0))) {
  const zone = c.zone(z.index);
  const centre = c.townResult.centres.get(z.index);
  const phase = buildZoneRoadsPhase({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, zoneIndex: z.index,
    townEntry: zone.town && centre ? [centre.b, centre.a] : null,
    connectionPoints: (c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
    mineActives: mineActives.get(z.index) ?? [],
  }, c.rng);
  roads.set(z.index, [...roads.get(z.index)!, ...phase.road08, ...phase.road10]);
}
check('the roads phase ends on the traced 20420', c.rng.draws === 20420, `${c.rng.draws}`);

console.log('\nthe statics, zone by zone in template order');

// The traced step boundaries: big statics, then one-tile, per zone.
const BOUNDARIES: Record<number, [number, number]> = {
  1: [40826, 44537], 2: [54730, 58742], 3: [69801, 73858], 4: [85446, 89798],
};

const allStatics: PlacedStatic[] = [];
for (const tz of c.template.zones) {
  const loadedZone = c.loaded.zones.find((z) => z.index === tz.index)!;
  const race = c.zoneRace(tz.index);
  const preset = c.presets.get(race)!;
  const fill = fills.get(tz.index)!;
  const zoneRoads = roads.get(tz.index)!;
  const bigPositions: Tile[] = [];

  const big = placeZoneBigStatics({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, floor: loadedZone.floor,
    settingRace: loadedZone.race,
    roads: zoneRoads, bigPositions, blockedList: fill.blocked,
    bigStatics: preset.bigStatics.map((h) => c.footprint(h)),
    mountains: preset.mountains.map((h) => c.footprint(h)),
    overLakeCenterObjects: preset.overLakeCenterObjects.map((h) => c.footprint(h)),
    overLakeOneTileRandomObjects: preset.overLakeOneTileRandomObjects.map((h) => h ? c.footprint(h) : null),
    mapAngle: c.setup.angle,
  }, c.rng);
  allStatics.push(...big.placed);
  const [bigBoundary, oneBoundary] = BOUNDARIES[tz.index]!;
  check(`zone ${tz.index} big statics land on ${bigBoundary}`, c.rng.draws === bigBoundary,
    `${c.rng.draws} (${big.placed.length} placed, ${big.lakeSeeds.length} lake seeds)`);

  const one = placeZoneOneTileStatics({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, roads: zoneRoads,
    tiles: c.zoneTileList(tz.index),
    smallBlockers: preset.oneTileSmallBlockers.map((h) => c.footprint(h)),
    smallNonblockers: preset.oneTileSmallNonblockers.map((h) => c.footprint(h)),
    bigObjects: preset.oneTileBigObjects.map((h) => c.footprint(h)),
    mapAngle: c.setup.angle,
  }, c.rng);
  allStatics.push(...one);
  check(`zone ${tz.index} one-tile statics land on ${oneBoundary}`, c.rng.draws === oneBoundary,
    `${c.rng.draws} (${one.length} placed)`);
}

console.log(`\n${allStatics.length} statics placed; the phase ends on ${c.rng.draws}`);
check('which is the traced 89798', c.rng.draws === 89798, `${c.rng.draws}`);
check('and the reference count, 1325 statics', allStatics.length === 1325, `${allStatics.length}`);

// Every static against the reference map, by minted name.
{
  const refPath = join('_tmp', 'oracle', 'reference', 'map.xdb');
  if (!existsSync(refPath)) {
    console.log('  (no reference map.xdb — the by-name half is skipped)');
  } else {
    const xdb = readFileSync(refPath, 'utf8');
    let bad = 0;
    for (const p of allStatics) {
      const i = xdb.indexOf(`id="${p.name}"`);
      if (i < 0) { bad++; continue; }
      const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 300));
      if (!m || Number(m[1]) !== p.x || Number(m[2]) !== p.y) bad++;
    }
    check('every static stands where its minted name stands in the map', bad === 0, `${bad} astray`);
  }
}

// ---------------------------------------------------------------------------
// A SUBTERRANEAN ZONE REFRESHES THE WHOLE LEVEL'S ROOM GRID, and the reference
// seed cannot say so: it has one zone underground, and with one zone the pass
// writes what the sweep's own recompute writes anyway. So this half is built
// rather than replayed — the smallest floor on which the difference shows.
//
// `vt+0x40` (`0xEC4A50`) is `recomputeRoom(0x3C, all=1)` and then the carve;
// `all=1` skips the zone test, so a FOREIGN zone's cell is left holding a fresh
// distance from OUR points. The sweep's `recomputeRoom(0x3C, 0)` after it
// refreshes our own cells only, and the fit reads room with no zone test — so
// what a footprint spilling over the border sees is that fresh value.
//
// The floor: one tile of zone 2 at 13,15 and everything else zone 3, the room
// grid stale at 1 everywhere, and zone 2's one point at 5,5. A full 5x5 on the
// one candidate spills into zone 3 on all four sides. Stale, its corners read 1
// and the fit fails; refreshed, they read ten and up and the engine places.
{
  const SZ = 30;
  const zoneTile: Tile = [13, 15];
  const grid = Array.from({ length: SZ }, () => new Int32Array(SZ).fill(3));
  grid[zoneTile[1]]![zoneTile[0]] = 2;
  const border = Array.from({ length: SZ }, () => new Int32Array(SZ).fill(10));
  const room = Array.from({ length: SZ }, () => new Int32Array(SZ).fill(1));
  const occupancy = new Int32Array(SZ * SZ);
  // Nine pebbles that keep the CARVE out: every one of its 9x9 windows holds
  // one, so its dirty test fires everywhere and it flattens nothing. Without
  // them an empty floor is carved wall to wall and no footprint fits anywhere.
  for (const px of [8, 17, 26]) for (const py of [8, 17, 26]) occupancy[py * SZ + px] = 2;
  const full5x5: Footprint = {
    path: '/MapObjects/Subterra/Columns/Column_5x5_05.xdb',
    blocked: [], active: [], marker: [0, 0],
  };
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) full5x5.blocked.push([dx, dy]);
  const stub = { below: () => 0, betweenFloat: () => 0 };

  const out = placeZoneBigStatics({
    size: SZ, grid, border, occupancy, room,
    points: [[5, 5]], zoneIndex: 2, floor: 1, settingRace: 0,
    roads: [], bigPositions: [], blockedList: [],
    bigStatics: [full5x5], mountains: [], overLakeCenterObjects: [], overLakeOneTileRandomObjects: [],
    mapAngle: 0, subterranean: true, zoneClass: 'subterra',
    vertexHeights: createVertexHeights(SZ, 1),
    tiles: [zoneTile],
  }, stub);

  check('the 5x5 spilling into the neighbour zone is placed', out.placed.length === 1,
    `${out.placed.length} placed`);
  check('and it stands on the one candidate', out.placed[0]?.x === 13 && out.placed[0]?.y === 15,
    out.placed[0] ? `${out.placed[0].x},${out.placed[0].y}` : 'nothing placed');
  // The refresh itself, named: a zone-3 cell the footprint reaches now carries
  // its distance from 5,5 and not the 1 it was seeded with.
  check('the foreign zone\'s cells carry the fresh distance, not the stale 1',
    room[13]![11] === 10 && room[17]![15] === 15,
    `11,13 -> ${room[13]![11]} (10), 15,17 -> ${room[17]![15]} (15)`);
  // And the guard against reading this as "refresh everything": a cell OUTSIDE
  // this zone's own tiles is refreshed by the all=1 pass, but the all=0 pass
  // after it must leave it alone — a zoneless cell, by contrast, is 1000 in
  // both. Nothing here is zoneless, so the whole grid is distances.
  check('no cell is left at 1000 on a floor with no zoneless tile',
    !room.some((r) => r.some((v) => v === 1000)), 'a 1000 leaked in');
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

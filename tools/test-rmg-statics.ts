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

import type { Tile } from '../src/rmg/placement.ts';
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

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

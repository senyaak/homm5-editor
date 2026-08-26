// The treasure blocks phase — the generator's last, live on the reference
// seed.
//
//   node tools/test-rmg-treasure-blocks.ts
//
// Everything before it replays first: the first loop of MainObjects, the
// roads phase and the statics, so the occupancy carries all 1325 statics and
// the room grid can be recomputed on mask 0x38 — the three road lists and
// nothing else, which is what 0xEBA420 asks for before handing the zone to
// the distributor.
//
// The phase splits into two halves per zone and the trace sees both: the
// growth spends one below(8) per surviving seed, the fill spends the guard,
// the artifact and the piles. Both boundaries are asserted for every zone,
// so a divergence names the half it happened in.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArtifacts, rmgArtifactPool } from '../src/rmg/artifacts.ts';
import { recomputeRoom, zoneTiles } from '../src/rmg/placement.ts';
import type { Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { placeZoneBigStatics } from '../src/rmg/statics-big.ts';
import { placeZoneOneTileStatics } from '../src/rmg/statics-one-tile.ts';
import { buildTreasureBlocks, fillTreasureBlocks } from '../src/rmg/treasure-blocks.ts';
import type { ArtifactEntry, PlacedTreasure } from '../src/rmg/treasure-blocks.ts';
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

console.log('the run up to the statics boundary, replayed');

const fills = new Map<number, ZoneFill>();
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
// `zone+0x98` — the ledger of seated guards. ZoneConnections starts it with
// the passage guards and the tiles adopted from the neighbour; the mines and
// the upgrade buildings add theirs. Nothing read it until this phase, which
// keeps its blocks `DistBetweenTreasureBlocks` away from every entry.
const guardSeats = new Map<number, Tile[]>();
for (const zone of [1, 2, 3, 4]) {
  const fill = new ZoneFill(c, zone);
  fills.set(zone, fill);
  const seats: Tile[] = [...(c.conn.passages.get(zone) ?? []).map(([a, b]) => [b, a] as Tile)];
  const mines = fill.mines();
  mineActives.set(zone, mines.flatMap((m) => m.actives));
  for (const m of mines) if (m.guard) seats.push([m.guard.x, m.guard.y]);
  fill.dwellings();
  for (const u of fill.upgradeBuildings()) if (u.guard) seats.push([u.guard.x, u.guard.y]);
  guardSeats.set(zone, seats);
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

const heights = new Float32Array(SIZE * SIZE);
for (const tz of c.template.zones) {
  const loadedZone = c.loaded.zones.find((z) => z.index === tz.index)!;
  const preset = c.presets.get(c.zoneRace(tz.index))!;
  const fill = fills.get(tz.index)!;
  const zoneRoads = roads.get(tz.index)!;
  placeZoneBigStatics({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, floor: loadedZone.floor,
    settingRace: loadedZone.race,
    roads: zoneRoads, bigPositions: [], blockedList: fill.blocked,
    bigStatics: preset.bigStatics.map((h) => c.footprint(h)),
    mountains: preset.mountains.map((h) => c.footprint(h)),
    overLakeCenterObjects: preset.overLakeCenterObjects.map((h) => c.footprint(h)),
    overLakeOneTileRandomObjects: preset.overLakeOneTileRandomObjects.map((h) => h ? c.footprint(h) : null),
    mapAngle: c.setup.angle, heights,
  }, c.rng);
  placeZoneOneTileStatics({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, roads: zoneRoads,
    smallBlockers: preset.oneTileSmallBlockers.map((h) => c.footprint(h)),
    smallNonblockers: preset.oneTileSmallNonblockers.map((h) => c.footprint(h)),
    bigObjects: preset.oneTileBigObjects.map((h) => c.footprint(h)),
    mapAngle: c.setup.angle,
  }, c.rng);
}
check('the statics end on the traced 89798', c.rng.draws === 89798, `${c.rng.draws}`);

console.log('\nthe treasure blocks, zone by zone in template order');

// The traced boundaries: the growth, then the fill, per zone. The growth's
// length is the count of seeds that passed the occupancy, room and town
// gates; the fill's is the guards, artifacts and piles.
const BOUNDARIES: Record<number, [number, number]> = {
  1: [90384, 90495], 2: [91089, 91198], 3: [91694, 91792], 4: [92290, 92438],
};

// The pool 0xED3B80 builds — every artifact the data lets be generated, in
// ascending id order. The reference map carries no water, so the sextant
// stays out.
const ARTIFACTS: ArtifactEntry[] = rmgArtifactPool(readArtifacts(dir))
  .map((a) => ({ id: a.id, cost: a.cost, href: a.href }));

const placed: PlacedTreasure[] = [];
let guards = 0;
for (const tz of c.template.zones) {
  const zoneIndex = tz.index;
  const centre = c.townResult.centres.get(zoneIndex);
  const hasTown = Boolean(tz.town && centre);
  const town: Tile = hasTown ? [centre!.b, centre!.a] : [0, 0];

  // 0xEBA420's prologue: room with mask 0x38, the road lists alone.
  recomputeRoom(c.room, SIZE, c.grid, zoneIndex, roads.get(zoneIndex)!);

  const blocks = buildTreasureBlocks({
    size: SIZE, occupancy: c.occ, room: c.room,
    tiles: zoneTiles(SIZE, c.grid, zoneIndex),
    town, hasTown,
    repel: guardSeats.get(zoneIndex)!,
    totalValue: tz.treasureBlocksTotalValue,
    distBetween: c.params.distBetweenTreasureBlocks,
  }, c.rng);

  const [grown, filled] = BOUNDARIES[zoneIndex]!;
  check(`zone ${zoneIndex} grows its blocks by ${grown}`, c.rng.draws === grown,
    `${c.rng.draws} (${blocks.length} blocks)`);

  const result = fillTreasureBlocks({
    size: SIZE, occupancy: c.occ, blocks, artifacts: ARTIFACTS,
    monsterStrength: c.setup.monsterStrength, tables: c.tables,
  }, c.rng);
  for (const b of result) {
    if (b.guard) guards++;
    placed.push(...b.items);
  }
  check(`zone ${zoneIndex} fills them by ${filled}`, c.rng.draws === filled,
    `${c.rng.draws} (${result.length} filled, ${result.reduce((n, b) => n + b.items.length, 0)} items)`);
}

console.log(`\n${placed.length} treasures and ${guards} guards; the phase ends on ${c.rng.draws}`);
check('which is the traced 92438 — the whole run', c.rng.draws === 92438, `${c.rng.draws}`);

// Every treasure against the reference map, by minted name.
{
  const refPath = join('_tmp', 'oracle', 'reference', 'map.xdb');
  if (!existsSync(refPath)) {
    console.log('  (no reference map.xdb — the by-name half is skipped)');
  } else {
    const xdb = readFileSync(refPath, 'utf8');
    let bad = 0;
    for (const p of placed) {
      const i = xdb.indexOf(`id="${p.name}"`);
      if (i < 0) { bad++; continue; }
      const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 300));
      if (!m || Number(m[1]) !== p.x || Number(m[2]) !== p.y) bad++;
    }
    check('every treasure stands where its minted name stands in the map', bad === 0, `${bad} astray`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

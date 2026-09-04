// The underground reference run — seed 1785351845 on S0-1P2Z2K3.1T, tiny
// 72×72, two floors, zone 1 below ground.
//
//   node tools/test-rmg-underground.ts
//
// What the surface run never measured, this one does: the floor balancing,
// the underground town's point lights, the teleport pair, the prisons step,
// and MainObjects running against a floor-1 grid with the fit's five-tile
// margin. Every traced step boundary of the first loop is asserted per
// zone, so a divergence names its step.
//
// The statics run on the subterranean overrides (`0xEC4A70`/`0xEC50C0`
// through the shared massif carve `0xED11D0`) for the underground zone
// and on the base pair for the surface ones; the additional-objects
// phase replays the treasures dispatcher late for the underground zone,
// and the treasure blocks close the run on its last draw, 70,799. Every
// traced boundary is asserted and every named object is held to the
// reference map.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createVertexHeights } from '../src/rmg/massif-carve.ts';
import { recomputeRoom } from '../src/rmg/placement.ts';
import type { Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { placeZoneBigStatics } from '../src/rmg/statics-big.ts';
import { placeZoneOneTileStatics, placeSubterraOneTileStatics } from '../src/rmg/statics-one-tile.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { RACE_BY_NAME } from '../src/rmg/load-template.ts';
import { readArtifacts, rmgArtifactPool } from '../src/rmg/artifacts.ts';
import { buildTreasureBlocks, fillTreasureBlocks } from '../src/rmg/treasure-blocks.ts';
import type { ArtifactEntry } from '../src/rmg/treasure-blocks.ts';
import { zoneTiles } from '../src/rmg/placement.ts';
import { runChain, ZoneFill } from './rmg-chain.ts';
import { dataDir } from './game-dir.ts';
import { REFERENCE_UG_DIR, hasUndergroundReference } from './rmg-reference.ts';

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

const c = runChain(dir, { template: 'S0-1P2Z2K3.1T', size: 72, underground: true });

console.log('the chain, on the underground run');
check('the chain ends on the traced 4475', c.rng.draws === 4475, `${c.rng.draws}`);
check('zone 1 lies underground', c.loaded.zones.find((z) => z.index === 1)!.floor === 1);
check('one teleport pair stands', [...c.teleports.values()].flat().length === 2,
  [...c.teleports.values()].flat().map((t) => `${t.href.split('/').pop()}@${t.x}:${t.y}`).join(' '));

// The traced per-zone step boundaries of the first MainObjects loop.
const STEPS: Record<number, Array<[string, number]>> = {
  1: [['mines', 4583], ['dwellings', 4625], ['upgradeBuildings', 4637], ['prisons', 4645],
      ['shrines', 4663], ['resourceBuildings', 4673], ['treasuryBuildings', 4690],
      ['luckMorale', 4782], ['shops', 4806], ['road', 5269]],
  2: [['mines', 5361], ['dwellings', 5371], ['upgradeBuildings', 5380], ['prisons', 5386],
      ['shrines', 5400], ['resourceBuildings', 5407], ['treasuryBuildings', 5424],
      ['luckMorale', 5444], ['shops', 5451], ['tail', 5494], ['road', 5884]],
  3: [['mines', 5892], ['dwellings', 5898], ['upgradeBuildings', 5898], ['prisons', 5898],
      ['shrines', 5913], ['resourceBuildings', 5913], ['treasuryBuildings', 5948],
      ['luckMorale', 5953], ['shops', 5967], ['tail', 5976], ['road', 6129]],
};
// Zone 1 (underground) has no treasures/chests marks and no boundary
// between shops and the road: the observatories spend their draws inside
// that gap, so the road boundary is what proves them.

console.log('\nthe first loop of MainObjects, zone by zone in template order');
c.rng.next(); // the MainObjects prologue draw

const named: Array<{ name: string; x: number; y: number }> = [];
const guardSeats = new Map<number, Tile[]>();
const fills = new Map<number, ZoneFill>();
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
for (const tz of c.template.zones) {
  const zone = tz.index;
  const fill = new ZoneFill(c, zone);
  fills.set(zone, fill);
  const seats: Tile[] = [
    ...(c.conn.passages.get(zone) ?? []).map(([a, b]) => [b, a] as Tile),
    ...c.teleportGuardSeats(zone),
  ];
  guardSeats.set(zone, seats);
  const steps = STEPS[zone]!;
  const run: Record<string, () => void> = {
    mines: () => {
      const mines = fill.mines();
      mineActives.set(zone, [
        ...mines.flatMap((m) => m.actives),
        ...fill.abandoned.flatMap((m) => m.actives),
      ]);
      for (const m of mines) {
        named.push(m);
        for (const p of m.piles) named.push(p);
        if (m.guard) {
          named.push({ name: m.guard.name, x: m.guard.x, y: m.guard.y });
          guardSeats.get(zone)!.push([m.guard.x, m.guard.y]);
        }
      }
      for (const m of fill.abandoned) named.push(m);
    },
    dwellings: () => { for (const d of fill.dwellings()) named.push(d); },
    upgradeBuildings: () => {
      for (const u of fill.upgradeBuildings()) {
        named.push(u);
        if (u.guard) guardSeats.get(zone)!.push([u.guard.x, u.guard.y]);
      }
    },
    prisons: () => { for (const p of fill.prisons()) named.push(p); },
    shrines: () => { for (const s of fill.shrines()) named.push(s); },
    resourceBuildings: () => { for (const p of fill.resourceBuildings()) named.push(p); },
    treasuryBuildings: () => { for (const p of fill.treasuryBuildings()) named.push(p); },
    luckMorale: () => { for (const p of fill.luckMorale()) named.push(p); },
    shops: () => { for (const p of fill.shops()) named.push(p); },
    tail: () => {
      for (const o of fill.observatories()) named.push(o);
      for (const t of fill.treasures()) named.push(t);
      for (const t of fill.chests()) named.push(t);
    },
    road: () => {
      // The underground zone's observatories run without a mark of their
      // own — before the road, which is the next boundary that lands.
      if (!steps.some(([step]) => step === 'tail')) run['tail']!();
      roads.set(zone, fill.road());
    },
  };
  for (const [step, boundary] of steps) {
    run[step]!();
    check(`zone ${zone} ${step} lands on ${boundary}`, c.rng.draws === boundary, `${c.rng.draws}`);
  }
}
check('the first loop ends on the traced 6129', c.rng.draws === 6129, `${c.rng.draws}`);

console.log('\nthe roads phase');
for (let f = 0; f < c.floors.length; f++) {
  for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === f))) {
    const zone = c.zone(z.index);
    const centre = c.townResult.centres.get(z.index);
    const phase = buildZoneRoadsPhase({
      size: c.size, grid: c.floors[f]!.grid, border: c.floors[f]!.border,
      occupancy: c.floors[f]!.occ, zoneIndex: z.index,
      townEntry: zone.town && centre ? [centre.b, centre.a] : null,
      connectionPoints: [
        ...(c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
        ...c.teleportActives(z.index),
      ],
      mineActives: mineActives.get(z.index) ?? [],
    }, c.rng);
    roads.set(z.index, [...roads.get(z.index)!, ...phase.road08, ...phase.road10]);
  }
}
check('the roads phase ends on the traced 6471', c.rng.draws === 6471, `${c.rng.draws}`);

// The statics — the driver `0xEA5450`, zones in template entry order,
// vtable +0x34 then +0x30 per zone: the base pair for the surface zones,
// the subterranean overrides for zone 1, whose big statics are the base
// sweep behind the massif carve and whose one-tile step carries the rock
// filter, the survival rolls and the Crystal point lights.
console.log('\nthe statics, zone by zone in template order');

const STATIC_BOUNDARIES: Record<number, [number, number]> = {
  1: [44208, 49892], 2: [51711, 60511], 3: [65932, 67611],
};

const vertexHeights = c.floors.map((_, f) => createVertexHeights(c.size, f));
let staticsCount = 0;
for (const tz of c.template.zones) {
  const loadedZone = c.loaded.zones.find((z) => z.index === tz.index)!;
  const f = loadedZone.floor;
  const floor = c.floors[f]!;
  const preset = c.presets.get(loadedZone.terrainRace)!;
  const fill = fills.get(tz.index)!;
  const zoneRoads = roads.get(tz.index)!;
  const subterranean = loadedZone.kind !== 'zone' && loadedZone.kind !== 'waterBordered';
  const [bigBoundary, oneBoundary] = STATIC_BOUNDARIES[tz.index]!;

  const big = placeZoneBigStatics({
    size: c.size, grid: floor.grid, border: floor.border, occupancy: floor.occ, room: floor.room,
    points: fill.points, zoneIndex: tz.index, floor: f,
    settingRace: loadedZone.race,
    roads: zoneRoads, bigPositions: [], blockedList: fill.blocked,
    bigStatics: preset.bigStatics.map((h) => c.footprint(h)),
    mountains: preset.mountains.map((h) => c.footprint(h)),
    overLakeCenterObjects: preset.overLakeCenterObjects.map((h) => c.footprint(h)),
    overLakeOneTileRandomObjects: preset.overLakeOneTileRandomObjects.map((h) => h ? c.footprint(h) : null),
    mapAngle: c.setup.angle,
    subterranean, vertexHeights: vertexHeights[f]!,
  }, c.rng);
  for (const p of big.placed) named.push(p);
  staticsCount += big.placed.length;
  check(`zone ${tz.index} big statics land on ${bigBoundary}`, c.rng.draws === bigBoundary,
    `${c.rng.draws} (${big.placed.length} placed)`);

  const oneInput = {
    size: c.size, grid: floor.grid, border: floor.border, occupancy: floor.occ, room: floor.room,
    points: fill.points, zoneIndex: tz.index, roads: zoneRoads,
    tiles: c.zoneTileList(tz.index),
    smallBlockers: preset.oneTileSmallBlockers.map((h) => c.footprint(h)),
    smallNonblockers: preset.oneTileSmallNonblockers.map((h) => c.footprint(h)),
    bigObjects: preset.oneTileBigObjects.map((h) => c.footprint(h)),
    mapAngle: c.setup.angle,
  };
  const one = subterranean
    ? placeSubterraOneTileStatics({
        ...oneInput, vertexHeights: vertexHeights[f]!,
        pointLight: c.params.pointLightParams,
      }, c.rng)
    : placeZoneOneTileStatics(oneInput, c.rng);
  for (const p of one) named.push(p);
  staticsCount += one.length;
  check(`zone ${tz.index} one-tile statics land on ${oneBoundary}`, c.rng.draws === oneBoundary,
    `${c.rng.draws} (${one.length} placed)`);
}
check('the statics phase ends on the traced 67611', c.rng.draws === 67611, `${c.rng.draws}`);
console.log(`  ${staticsCount} statics placed`);

// The additional-objects phase — the same treasures dispatcher, called
// late for the zones the surface gate refused: the underground zone's
// treasures and chests, on its own floor's post-statics grids.
console.log('\nadditional objects — the underground treasures');
for (const tz of c.template.zones) {
  if (c.loaded.zones.find((z) => z.index === tz.index)!.floor === 0) continue;
  const fill = fills.get(tz.index)!;
  for (const t of fill.lateTreasures()) named.push(t);
  check(`zone ${tz.index} late treasures land on 67672`, c.rng.draws === 67672, `${c.rng.draws}`);
  for (const t of fill.lateChests()) named.push(t);
  check(`zone ${tz.index} late chests land on 67696`, c.rng.draws === 67696, `${c.rng.draws}`);
}

// The treasure blocks — the same two halves as the surface run, per
// template zone on its own floor.
console.log('\nthe treasure blocks, zone by zone in template order');
const ARTIFACTS: ArtifactEntry[] = rmgArtifactPool(readArtifacts(dir))
  .map((a) => ({ id: a.id, cost: a.cost, href: a.href }));
let blockGuards = 0;
let blockItems = 0;
for (const tz of c.template.zones) {
  const lz = c.loaded.zones.find((z) => z.index === tz.index)!;
  const fl = c.floors[lz.floor]!;
  const centre = c.townResult.centres.get(tz.index);
  const hasTown = Boolean(tz.town && centre);
  const town: Tile = hasTown ? [centre!.b, centre!.a] : [0, 0];
  recomputeRoom(fl.room, c.size, fl.grid, tz.index, roads.get(tz.index)!);
  const blocks = buildTreasureBlocks({
    size: c.size, occupancy: fl.occ, room: fl.room,
    tiles: zoneTiles(c.size, fl.grid, tz.index),
    town, hasTown,
    repel: guardSeats.get(tz.index)!,
    totalValue: tz.treasureBlocksTotalValue,
    distBetween: c.params.distBetweenTreasureBlocks,
  }, c.rng);
  const result = fillTreasureBlocks({
    size: c.size, occupancy: fl.occ, blocks, artifacts: ARTIFACTS,
    monsterStrength: c.setup.monsterStrength, tables: c.tables,
  }, c.rng);
  for (const b of result) {
    if (b.guard) blockGuards++;
    for (const item of b.items) named.push(item);
    blockItems += b.items.length;
  }
  console.log(`  zone ${tz.index}: ${blocks.length} blocks, ${result.length} filled — at ${c.rng.draws}`);
}
check('the treasure blocks end on the traced 70799 — the whole run', c.rng.draws === 70799,
  `${c.rng.draws} (${blockItems} items, ${blockGuards} guards)`);

// Every named object of the loop against the reference map.
if (!hasUndergroundReference()) {
  console.log(`\n  (no ${REFERENCE_UG_DIR} — the by-name half is skipped)`);
} else {
  const xdb = readFileSync(join(REFERENCE_UG_DIR, 'map.xdb'), 'utf8');
  let bad = 0;
  for (const p of named) {
    const i = xdb.indexOf(`id="${p.name}"`);
    if (i < 0) { bad++; continue; }
    const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 300));
    if (!m || Number(m[1]) !== p.x || Number(m[2]) !== p.y) bad++;
  }
  check(`every loop object stands where its minted name stands (${named.length} checked)`, bad === 0, `${bad} astray`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

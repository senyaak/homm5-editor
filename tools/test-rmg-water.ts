// The water border against the island reference (run 6): the carve and the
// water treasures — the 180 draws the engine hides inside the "dist to
// towns" bracket, 18475 -> 18655.
//
//   node tools/test-rmg-water.ts [--game <dir>]
//
// The chain runs with water = 2 (WATER_ISLAND_MAP — what the dialog's
// checkbox records; see docs/RMG.md). Everything through the towns is the
// no-water stream by construction (the supplied value costs one discarded
// draw either way), so the suite holds the pass's own boundary and every
// water treasure against the reference map by minted name.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArtifacts, rmgArtifactPool } from '../src/rmg/artifacts.ts';
import { recomputeRoom } from '../src/rmg/placement.ts';
import type { Tile } from '../src/rmg/placement.ts';
import { readTileInfo } from '../src/rmg/preset-table.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { placeZoneBigStatics } from '../src/rmg/statics-big.ts';
import { placeWaterOneTileStatics } from '../src/rmg/statics-one-tile.ts';
import { fillTerrain, paintRoads, paintSeaCorners, paintWaterMarks } from '../src/rmg/terrain.ts';
import { buildTreasureBlocks, fillTreasureBlocks } from '../src/rmg/treasure-blocks.ts';
import type { ArtifactEntry } from '../src/rmg/treasure-blocks.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { parseTerrain, readMask, readTextureLayers, readWaterPlane } from '../src/terrain/terrain.ts';
import { runChain, ZoneFill } from './rmg-chain.ts';
import { dataDir } from './game-dir.ts';
import { REFERENCE_WATER_MAP, REFERENCE_WATER_TERRAIN, hasWaterReference } from './rmg-reference.ts';

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

const c = runChain(dir, { water: 2 });
const water = c.water!;
check('the chain carries a water pass', water !== null);

const treasures = [...water.treasures.values()].flat();
check('the water pass ends on 18655 — the engine\'s own bracket',
  water.drawsAfter === 18655, `${water.drawsAfter}`);
check('36 water treasures, five draws each', treasures.length === 36, `${treasures.length}`);

// The island connections — the land digger finds nothing to dig (all three
// template connections are unconnected across the sea), the teleport pass
// pairs the zones with Monolith_Two_Way halves, and every water zone's
// Shipyard bit adds one guarded shipyard. The chain runs all of it, so the
// counter itself is the boundary assert.
check('connections end on 18737 — the engine\'s own bracket', c.rng.draws === 18737, `${c.rng.draws}`);
check('all three connections went to teleports',
  c.conn.unconnected.length === 3 && [...c.teleports.values()].flat().length === 6,
  `${c.conn.unconnected.length} unconnected, ${[...c.teleports.values()].flat().length} halves`);
check('every water zone got its shipyard', c.water!.shipyards.size === 4, `${c.water!.shipyards.size}`);

// Everything against the reference map, by minted name.
if (!hasWaterReference()) {
  console.log('  (no water reference — the by-name half is skipped;');
  console.log('   rebuild it with `npm run rmg-reference -- --water <map.h5m>`)');
} else {
  const xdb = readFileSync(REFERENCE_WATER_MAP, 'utf8');
  const standsInMap = (name: string, x: number, y: number): boolean => {
    const i = xdb.indexOf(`id="${name}"`);
    if (i < 0) return false;
    const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 400));
    return !!m && Number(m[1]) === x && Number(m[2]) === y;
  };

  let astray = 0;
  let wrongType = 0;
  for (const t of treasures) {
    if (!standsInMap(t.name, t.x, t.y)) { astray++; continue; }
    const i = xdb.indexOf(`id="${t.name}"`);
    const expected = c.params.waterTreasures[t.typeIndex]!.split('#')[0];
    const shared = /<Shared href="([^"#]*)/.exec(xdb.slice(i, i + 400))?.[1];
    if (shared !== expected) wrongType++;
  }
  check('every water treasure stands where its minted name stands in the map',
    astray === 0, `${astray} astray`);
  check('and each is the WaterTreasures entry its draw picked',
    wrongType === 0, `${wrongType} of the wrong type`);

  let shipAstray = 0;
  let guardAstray = 0;
  let guards = 0;
  for (const s of c.water!.shipyards.values()) {
    if (!standsInMap(s.name, s.x, s.y)) shipAstray++;
    if (s.guard?.guard) {
      guards++;
      if (!standsInMap(s.guard.guard.name, s.guard.x, s.guard.y)) guardAstray++;
    }
  }
  check('every shipyard stands where its minted name stands in the map',
    shipAstray === 0, `${shipAstray} astray`);
  check('and so does every shipyard guard', guardAstray === 0, `${guards} guards, ${guardAstray} astray`);

  let teleAstray = 0;
  let teleGuards = 0;
  for (const halves of c.teleports.values()) {
    for (const h of halves) {
      if (!standsInMap(h.name, h.x, h.y)) teleAstray++;
      if (h.guard) {
        teleGuards++;
        if (!standsInMap(h.guard.name, h.guard.x, h.guard.y)) teleAstray++;
      }
    }
  }
  check('every monolith half and its guard stand on their reference tiles',
    teleAstray === 0, `6 halves, ${teleGuards} guards, ${teleAstray} astray`);
}

// --- The first loop of MainObjects, zone by zone in template order, every
// traced step boundary asserted. The treasures boundary swallows the
// observatories (no mark of their own), chests spend nothing here.
console.log('\nthe first loop of MainObjects over the carved islands');
c.rng.next(); // the MainObjects prologue draw

const STEPS: Record<number, Array<[string, number]>> = {
  1: [['mines', 18825], ['dwellings', 18829], ['upgradeBuildings', 18829], ['prisons', 18829],
      ['shrines', 18834], ['resourceBuildings', 18848], ['treasuryBuildings', 18864],
      ['luckMorale', 18895], ['shops', 18902], ['treasures', 18915], ['chests', 18915], ['road', 19127]],
  2: [['mines', 19210], ['dwellings', 19218], ['upgradeBuildings', 19218], ['prisons', 19218],
      ['shrines', 19223], ['resourceBuildings', 19235], ['treasuryBuildings', 19240],
      ['luckMorale', 19257], ['shops', 19262], ['treasures', 19273], ['chests', 19273], ['road', 19461]],
  3: [['mines', 19500], ['dwellings', 19500], ['upgradeBuildings', 19511], ['prisons', 19511],
      ['shrines', 19532], ['resourceBuildings', 19532], ['treasuryBuildings', 19558],
      ['luckMorale', 19565], ['shops', 19601], ['treasures', 19612], ['chests', 19612], ['road', 19794]],
  4: [['mines', 19831], ['dwellings', 19831], ['upgradeBuildings', 19840], ['prisons', 19840],
      ['shrines', 19855], ['resourceBuildings', 19855], ['treasuryBuildings', 19882],
      ['luckMorale', 19889], ['shops', 19915], ['treasures', 19924], ['chests', 19924], ['road', 20130]],
};

const named: Array<{ name: string; x: number; y: number }> = [];
const fills = new Map<number, ZoneFill>();
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
const guardSeats = new Map<number, Tile[]>();
for (const tz of c.template.zones) {
  const zone = tz.index;
  const fill = new ZoneFill(c, zone);
  fills.set(zone, fill);
  const seats: Tile[] = [
    ...(c.conn.passages.get(zone) ?? []).map(([a, b]) => [b, a] as Tile),
    ...c.teleportGuardSeats(zone),
  ];
  guardSeats.set(zone, seats);
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
          seats.push([m.guard.x, m.guard.y]);
        }
      }
      for (const m of fill.abandoned) named.push(m);
    },
    dwellings: () => { for (const d of fill.dwellings()) named.push(d); },
    upgradeBuildings: () => {
      for (const u of fill.upgradeBuildings()) {
        named.push(u);
        if (u.guard?.guard) named.push({ name: u.guard.guard.name, x: u.guard.x, y: u.guard.y });
        if (u.guard) seats.push([u.guard.x, u.guard.y]);
      }
    },
    prisons: () => { for (const p of fill.prisons()) named.push(p); },
    shrines: () => { for (const s of fill.shrines()) named.push(s); },
    resourceBuildings: () => { for (const p of fill.resourceBuildings()) named.push(p); },
    treasuryBuildings: () => { for (const p of fill.treasuryBuildings()) named.push(p); },
    luckMorale: () => { for (const p of fill.luckMorale()) named.push(p); },
    shops: () => { for (const p of fill.shops()) named.push(p); },
    treasures: () => {
      for (const o of fill.observatories()) named.push(o);
      for (const t of fill.treasures()) named.push(t);
    },
    chests: () => { for (const t of fill.chests()) named.push(t); },
    road: () => { roads.set(zone, fill.road()); },
  };
  for (const [step, boundary] of STEPS[zone]!) {
    run[step]!();
    check(`zone ${zone} ${step} lands on ${boundary}`, c.rng.draws === boundary, `${c.rng.draws}`);
  }
}
check('the first loop ends on the traced 20130', c.rng.draws === 20130, `${c.rng.draws}`);

console.log('\nthe roads phase — the shipyards wired in through +0xC0');
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
check('the roads phase ends on the traced 20511', c.rng.draws === 20511, `${c.rng.draws}`);

// --- The statics: the base big sweep with the WaterBordered fit override
// (border >= 3, no zone test) over the carve's kept lists, and the water
// one-tile override — the base cascades with no border fence.
console.log('\nthe statics over the islands');

const STATIC_BOUNDARIES: Record<number, [number, number]> = {
  1: [35164, 36001], 2: [43700, 44769], 3: [52561, 53620], 4: [61962, 63227],
};
const heights = new Float32Array(c.size * c.size);
for (const tz of c.template.zones) {
  const loadedZone = c.loaded.zones.find((z) => z.index === tz.index)!;
  const preset = c.presets.get(c.zoneRace(tz.index))!;
  const fill = fills.get(tz.index)!;
  const zoneRoads = roads.get(tz.index)!;
  const [bigBoundary, oneBoundary] = STATIC_BOUNDARIES[tz.index]!;

  const big = placeZoneBigStatics({
    size: c.size, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, floor: loadedZone.floor,
    settingRace: loadedZone.race,
    roads: zoneRoads, bigPositions: [], blockedList: fill.blocked,
    bigStatics: preset.bigStatics.map((h) => c.footprint(h)),
    mountains: preset.mountains.map((h) => c.footprint(h)),
    overLakeCenterObjects: preset.overLakeCenterObjects.map((h) => c.footprint(h)),
    overLakeOneTileRandomObjects: preset.overLakeOneTileRandomObjects.map((h) => h ? c.footprint(h) : null),
    mapAngle: c.setup.angle, heights,
    water: true, tiles: c.water!.kept.get(tz.index),
  }, c.rng);
  for (const p of big.placed) named.push(p);
  check(`zone ${tz.index} big statics land on ${bigBoundary}`, c.rng.draws === bigBoundary,
    `${c.rng.draws} (${big.placed.length} placed)`);

  const one = placeWaterOneTileStatics({
    size: c.size, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, roads: zoneRoads,
    smallBlockers: preset.oneTileSmallBlockers.map((h) => c.footprint(h)),
    smallNonblockers: preset.oneTileSmallNonblockers.map((h) => c.footprint(h)),
    bigObjects: preset.oneTileBigObjects.map((h) => c.footprint(h)),
    mapAngle: c.setup.angle, tiles: c.water!.kept.get(tz.index)!,
  }, c.rng);
  for (const p of one) named.push(p);
  check(`zone ${tz.index} one-tile statics land on ${oneBoundary}`, c.rng.draws === oneBoundary,
    `${c.rng.draws} (${one.length} placed)`);
}

// --- The treasure blocks — the shared machinery over the kept lists (the
// LIST-driven room recompute reaches the rim), the artifact pool WITH the
// sextant (its gate is the water flag), additional objects zero draws.
console.log('\nthe treasure blocks, zone by zone in template order');

const BLOCK_BOUNDARIES: Record<number, [number, number]> = {
  1: [63698, 63770], 2: [64214, 64274], 3: [64714, 64835], 4: [65312, 65421],
};
const ARTIFACTS: ArtifactEntry[] = rmgArtifactPool(readArtifacts(dir), true)
  .map((a) => ({ id: a.id, cost: a.cost, href: a.href }));
let blockGuards = 0;
for (const tz of c.template.zones) {
  const centre = c.townResult.centres.get(tz.index);
  const hasTown = Boolean(tz.town && centre);
  recomputeRoom(c.room, c.size, c.grid, tz.index, roads.get(tz.index)!, c.water!.kept.get(tz.index));
  const blocks = buildTreasureBlocks({
    size: c.size, occupancy: c.occ, room: c.room,
    tiles: c.water!.kept.get(tz.index)!,
    town: hasTown ? [centre!.b, centre!.a] : [0, 0], hasTown,
    repel: guardSeats.get(tz.index)!,
    totalValue: c.zone(tz.index).treasureBlocksTotalValue,
    distBetween: c.params.distBetweenTreasureBlocks,
  }, c.rng);
  const [grown, filled] = BLOCK_BOUNDARIES[tz.index]!;
  check(`zone ${tz.index} grows its blocks by ${grown}`, c.rng.draws === grown,
    `${c.rng.draws} (${blocks.length} blocks)`);
  const result = fillTreasureBlocks({
    size: c.size, occupancy: c.occ, blocks, artifacts: ARTIFACTS,
    monsterStrength: c.setup.monsterStrength, tables: c.tables,
  }, c.rng);
  for (const b of result) {
    if (b.guard) {
      blockGuards++;
      named.push({ name: b.guard.name, x: b.guardAt[0], y: b.guardAt[1] });
    }
    named.push(...b.items);
  }
  check(`zone ${tz.index} fills them by ${filled}`, c.rng.draws === filled, `${c.rng.draws}`);
}
check('the island run closes on the traced 65421 — the WHOLE run', c.rng.draws === 65421, `${c.rng.draws}`);

// --- The terrain: FillTerrain's land over the PRE-CARVE grid (the engine
// paints it before the water border runs), then per zone in carve order the
// carve's 200-marks and the sea layer, then the road painter over the
// carved grid — and the whole of GroundTerrain.bin, river plane included,
// byte for byte.
console.log('\nthe terrain, land then water then roads');

const transitive = c.params.defaultTransitiveTile ? readTileInfo(dir, c.params.defaultTransitiveTile) : null;
const layers = fillTerrain(c.size, c.size, c.loaded.zones, [c.water!.gridBeforeCarve], c.presets, transitive)[0]!;
const deepWaterBottom = c.params.deepWaterBottom ? readTileInfo(dir, c.params.deepWaterBottom) : null;
const deepWaterTile = c.params.deepWaterTile ? readTileInfo(dir, c.params.deepWaterTile) : null;
for (const [zi, zoneMarks] of c.water!.marks) {
  const lz = c.loaded.zones.find((z) => z.index === zi)!;
  paintWaterMarks(layers, zoneMarks, c.presets.get(lz.terrainRace)?.waterCoastTile ?? null,
    deepWaterBottom, c.size);
  paintSeaCorners(layers, c.water!.sea.get(zi)!, deepWaterTile, c.size);
}
paintRoads(layers, c.size, c.grid, c.occ,
  floorIterationOrder(c.loaded.zones.filter((z) => z.floor === 0)).map((z) => {
    const preset = c.presets.get(c.loaded.zones.find((lz) => lz.index === z.index)!.terrainRace);
    return {
      zoneIndex: z.index,
      roadTile: preset?.roadTile ?? null,
      secondaryRoadTile: preset?.secondaryRoadTile ?? null,
    };
  }));
check('nine layers painted', layers.length === 9,
  layers.map((l) => l.path.split('/').pop()).join(' '));

if (hasWaterReference()) {
  const terr = parseTerrain(readFileSync(REFERENCE_WATER_TERRAIN));
  const fileLayers = readTextureLayers(terr);
  check('the file carries the same nine', fileLayers.length === layers.length, `${fileLayers.length}`);
  const V = c.size + 1;
  for (const fl of fileLayers) {
    const ours = layers.find((l) => l.path === fl.path);
    const short = fl.path?.split('/').pop() ?? '?';
    if (!ours) { check(`${short} painted by the port`, false); continue; }
    const fileMask = readMask(terr, fl);
    let bad = -1;
    let painted = 0;
    for (let k = 0; k < fileMask.length; k++) {
      if (fileMask[k]! > 0) painted++;
      if (fileMask[k] !== ours.mask[k] && bad === -1) bad = k;
    }
    check(`${short} byte-identical`, bad === -1,
      bad >= 0
        ? `vertex ${bad} (${Math.trunc(bad / V)}:${bad % V}): file ${fileMask[bad]} ours ${ours.mask[bad]}`
        : `${painted} painted vertices`);
  }

  const filePlane = readWaterPlane(terr);
  if (!filePlane) {
    check('the file carries a river plane', false);
  } else {
    const river = c.water!.river;
    check('river plane dims agree', filePlane.W === river.w, `file ${filePlane.W} ours ${river.w}`);
    let bad = -1;
    let wet = 0;
    for (let k = 0; k < filePlane.data.length; k++) {
      if (filePlane.data[k]! > 0) wet++;
      if (bad === -1 && filePlane.data[k] !== river.data[k]) bad = k;
    }
    check('river plane byte-identical', bad === -1,
      bad >= 0
        ? `cell ${bad} (${Math.trunc(bad / river.w)}:${bad % river.w}): file ${filePlane.data[bad]} ours ${river.data[bad]}`
        : `${wet} wet half-vertices`);
  }
}

// Every named object against the reference map.
if (hasWaterReference()) {
  const xdb = readFileSync(REFERENCE_WATER_MAP, 'utf8');
  let astray = 0;
  for (const p of named) {
    const i = xdb.indexOf(`id="${p.name}"`);
    if (i < 0) { astray++; continue; }
    const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 300));
    if (!m || Number(m[1]) !== p.x || Number(m[2]) !== p.y) astray++;
  }
  check(`every object stands where its minted name stands (${named.length} checked)`,
    astray === 0, `${astray} astray`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

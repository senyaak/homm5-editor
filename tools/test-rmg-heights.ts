// The height plane — the late pass `0xECF760` replayed over the whole
// surface reference run, held to the reference GroundTerrain.bin's float
// plane bit for bit.
//
//   node tools/test-rmg-heights.ts
//
// The run replays exactly as test-rmg-treasure-blocks does — same draws,
// same boundaries — but keeps every placement, because the pass needs the
// map's OBJECT LIST: the craters read the Inferno town, the footprint
// flatten reads every non-static object's shared tiles, and the mountain
// relief cones write the plane during the statics.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArtifacts, rmgArtifactPool } from '../src/rmg/artifacts.ts';
import type { HeightObject } from '../src/rmg/heights.ts';
import {
  CRATER_DWELLING_TYPES, SKIP_FLATTEN_DWELLING_TYPES,
  heightsToFile, latePass, makeHeightPlane,
} from '../src/rmg/heights.ts';
import { readMineShared } from '../src/rmg/mines.ts';
import { recomputeRoom, zoneTiles } from '../src/rmg/placement.ts';
import type { Footprint, Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { placeZoneBigStatics } from '../src/rmg/statics-big.ts';
import { placeZoneOneTileStatics } from '../src/rmg/statics-one-tile.ts';
import { buildTreasureBlocks, fillTreasureBlocks } from '../src/rmg/treasure-blocks.ts';
import type { ArtifactEntry } from '../src/rmg/treasure-blocks.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { parseTerrain, readHeights } from '../src/terrain/terrain.ts';
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

// --- the object collector -------------------------------------------------

const HALF_PI = Math.PI / 2;
const objs: HeightObject[] = [];
/** name -> our rot, for the debug comparison against the reference's Rot. */
const rotCheck: Array<{ name: string; rot: number; kind: string }> = [];

/** A point object — empty blocked list, one (0,0) active tile. */
function point(x: number, y: number, rot = 0): void {
  objs.push({ x, y, z: 0, rot, floor: 0, isStatic: false, blocked: [], firstActive: [0, 0] });
}

function object(x: number, y: number, rot: number, foot: Footprint, extra: Partial<HeightObject> = {}): void {
  objs.push({
    x, y, z: 0, rot, floor: 0, isStatic: false,
    blocked: foot.blocked, firstActive: foot.active[0],
    ...extra,
  });
}

// The towns and their decorations, in placement order. The decorations are
// AdvMapStatic instances — the flatten skips them, so only the towns join.
for (const t of c.townResult.objects) {
  if (t.kind !== 'town') continue;
  const foot = c.footprint(t.shared);
  if (process.env['H5E_DBG_HEIGHTS']) {
    console.log(`  [town] ${t.shared} at ${t.pos.x}:${t.pos.y} rot ${t.rot}`);
  }
  object(t.pos.x, t.pos.y, t.rot, foot, {
    craterTown: t.shared.includes('Inferno'),
    skipFlattenTown: t.shared.includes('Academy'),
  });
}

// The connection guards.
for (const g of c.conn.guards) point(g.x, g.y);

console.log('the first loop, with every placement kept');

const fills = new Map<number, ZoneFill>();
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
const guardSeats = new Map<number, Tile[]>();
for (const zone of [1, 2, 3, 4]) {
  const fill = new ZoneFill(c, zone);
  fills.set(zone, fill);
  const loadedZone = c.loaded.zones.find((z) => z.index === zone)!;
  const pricePreset = c.presets.get(loadedZone.terrainRace)!;
  const seats: Tile[] = [...(c.conn.passages.get(zone) ?? []).map(([a, b]) => [b, a] as Tile)];

  const mines = fill.mines();
  mineActives.set(zone, mines.flatMap((m) => m.actives));
  for (const m of mines) {
    rotCheck.push({ name: m.name, rot: m.q * HALF_PI, kind: 'mine' });
    object(m.x, m.y, m.q * HALF_PI, readMineShared(c.dir, m.type));
    if (m.guard) {
      point(m.guard.x, m.guard.y);
      seats.push([m.guard.x, m.guard.y]);
    }
    for (const p of m.piles) point(p.x, p.y);
  }
  for (const a of fill.abandoned) {
    object(a.x, a.y, a.q * HALF_PI, c.footprint(pricePreset.abandonedMine!));
  }

  for (const d of fill.dwellings()) {
    // PlacedDwelling.type is the footprint's path — resolve back through
    // the preset's hrefs, whose footprints the chain has already cached.
    const href = pricePreset.dwellings.concat(c.presets.get(loadedZone.race)!.dwellings)
      .find((h) => c.footprint(h).path === d.type)!;
    rotCheck.push({ name: d.name, rot: d.q * HALF_PI, kind: 'dwelling' });
    const docType = /<Type>(\w+)<\/Type>/.exec(readFileSync(join(dir, d.type.replace(/^\//, '')), 'utf8'))?.[1] ?? '';
    object(d.x, d.y, d.q * HALF_PI, c.footprint(href), {
      craterDwelling: CRATER_DWELLING_TYPES.has(docType),
      skipFlattenDwelling: SKIP_FLATTEN_DWELLING_TYPES.has(docType),
    });
  }

  for (const u of fill.upgradeBuildings()) {
    rotCheck.push({ name: u.name, rot: u.q * HALF_PI, kind: 'upgrade' });
    object(u.x, u.y, u.q * HALF_PI, c.footprint(u.type));
    if (u.guard?.guard) {
      point(u.guard.x, u.guard.y);
    }
    if (u.guard) seats.push([u.guard.x, u.guard.y]);
  }
  guardSeats.set(zone, seats);

  const priced = (p: { name: string; x: number; y: number; q: number; type: string }, kind: string, href = p.type): void => {
    rotCheck.push({ name: p.name, rot: p.q * HALF_PI, kind });
    object(p.x, p.y, p.q * HALF_PI, c.footprint(href));
  };
  for (const s of fill.shrines()) priced(s, 'shrine', `/MapObjects/${s.type}.(AdvMapShrineShared).xdb`);
  for (const p of fill.resourceBuildings()) priced(p, 'resource');
  for (const p of fill.treasuryBuildings()) priced(p, 'treasury');
  for (const p of fill.luckMorale()) priced(p, 'luckMorale');
  for (const p of fill.shops()) priced(p, 'shop');
  for (const o of fill.observatories()) priced(o, 'observatory');
  for (const t of fill.treasures()) {
    rotCheck.push({ name: t.name, rot: t.q * HALF_PI, kind: 'treasure' });
    point(t.x, t.y, t.q * HALF_PI);
  }
  for (const t of fill.chests()) point(t.x, t.y, t.q * HALF_PI);
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

// The plane starts at the level constructor's 6.0 (`0xEB2B60`, surface
// flag); the statics' relief cones write into it as they land.
const plane = makeHeightPlane(SIZE, 6.0);

for (const tz of c.template.zones) {
  const loadedZone = c.loaded.zones.find((z) => z.index === tz.index)!;
  const preset = c.presets.get(c.zoneRace(tz.index))!;
  const fill = fills.get(tz.index)!;
  const zoneRoads = roads.get(tz.index)!;
  const big = placeZoneBigStatics({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, room: c.room,
    points: fill.points, zoneIndex: tz.index, floor: loadedZone.floor,
    settingRace: loadedZone.race,
    roads: zoneRoads, bigPositions: [], blockedList: fill.blocked,
    bigStatics: preset.bigStatics.map((h) => c.footprint(h)),
    mountains: preset.mountains.map((h) => c.footprint(h)),
    overLakeCenterObjects: preset.overLakeCenterObjects.map((h) => c.footprint(h)),
    overLakeOneTileRandomObjects: preset.overLakeOneTileRandomObjects.map((h) => h ? c.footprint(h) : null),
    mapAngle: c.setup.angle, heightPlane: plane,
  }, c.rng);
  if (process.env['H5E_DBG_HEIGHTS']) {
    for (const p of big.placed) {
      if (!p.type.includes('Mountain')) continue;
      const foot = c.footprint(p.type + '#xpointer(/AdvMapStaticShared)');
      if (foot.blocked.length > 15 && (p.x < 16 || p.y < 16)) {
        console.log(`  [mnt] z${tz.index} ${p.type.split('/').pop()} at ${p.x}:${p.y} q ${(p.angle / HALF_PI).toFixed(0)} n ${foot.blocked.length}`);
      }
    }
  }
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

const ARTIFACTS: ArtifactEntry[] = rmgArtifactPool(readArtifacts(dir))
  .map((a) => ({ id: a.id, cost: a.cost, href: a.href }));

for (const tz of c.template.zones) {
  const zoneIndex = tz.index;
  const centre = c.townResult.centres.get(zoneIndex);
  const hasTown = Boolean(tz.town && centre);
  const town: Tile = hasTown ? [centre!.b, centre!.a] : [0, 0];
  recomputeRoom(c.room, SIZE, c.grid, zoneIndex, roads.get(zoneIndex)!);
  const blocks = buildTreasureBlocks({
    size: SIZE, occupancy: c.occ, room: c.room,
    tiles: zoneTiles(SIZE, c.grid, zoneIndex),
    town, hasTown,
    repel: guardSeats.get(zoneIndex)!,
    totalValue: tz.treasureBlocksTotalValue,
    distBetween: c.params.distBetweenTreasureBlocks,
  }, c.rng);
  const result = fillTreasureBlocks({
    size: SIZE, occupancy: c.occ, blocks, artifacts: ARTIFACTS,
    monsterStrength: c.setup.monsterStrength, tables: c.tables,
  }, c.rng);
  for (const b of result) {
    if (b.guard) point(b.guardAt[0], b.guardAt[1], b.guardRotation);
    for (const item of b.items) point(item.x, item.y, item.rotation);
  }
}
check('the run ends on the traced 92438', c.rng.draws === 92438, `${c.rng.draws}`);

// --- the late pass and the comparison -------------------------------------

latePass(plane, {
  size: SIZE, occupancy: c.occ, border: c.border, grid: c.grid,
  raceOf: (zi) => c.loaded.zones.find((z) => z.index === zi)?.race,
  objects: objs,
});
const ours = heightsToFile(plane);

// The debug rot comparison — our q*pi/2 against the reference's Rot text.
if (process.env['H5E_DBG_HEIGHTS']) {
  const mapPath = join('_tmp', 'oracle', 'reference', 'map.xdb');
  if (existsSync(mapPath)) {
    const xdb = readFileSync(mapPath, 'utf8');
    const off = new Map<string, number>();
    for (const rc of rotCheck) {
      const i = xdb.indexOf(`id="${rc.name}"`);
      if (i < 0) continue;
      const m = /<Rot>(-?[\d.e-]+)<\/Rot>/.exec(xdb.slice(i, i + 500));
      if (!m) continue;
      const refRot = Number(m[1]);
      const dq = Math.round((refRot - rc.rot) / HALF_PI);
      if (Math.abs(refRot - rc.rot) > 1e-3) {
        off.set(`${rc.kind} dq=${dq}`, (off.get(`${rc.kind} dq=${dq}`) ?? 0) + 1);
      } else {
        off.set(`${rc.kind} ok`, (off.get(`${rc.kind} ok`) ?? 0) + 1);
      }
    }
    console.log('  rot audit:', [...off.entries()].sort().map(([k, n]) => `${k} x${n}`).join(', '));
  }
}

const refPath = join('_tmp', 'oracle', 'reference', 'GroundTerrain.bin');
if (!existsSync(refPath)) {
  console.log('  (no reference GroundTerrain.bin — the comparison half is skipped)');
} else {
  const terr = parseTerrain(readFileSync(refPath));
  const ref = readHeights(terr);
  check('plane sizes agree', ref.length === ours.length, `${ref.length} vs ${ours.length}`);

  const a = new Uint32Array(ours.buffer, ours.byteOffset, ours.length);
  const bBytes = Float32Array.from(ref);
  const b = new Uint32Array(bBytes.buffer, bBytes.byteOffset, bBytes.length);
  let diffs = 0;
  let maxAbs = 0;
  const first: string[] = [];
  const V = SIZE + 1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diffs++;
    const d = Math.abs(ours[i]! - ref[i]!);
    if (d > maxAbs) maxAbs = d;
    if (first.length < 12) {
      first.push(`(${i % V}:${Math.trunc(i / V)}) ours ${ours[i]} ref ${ref[i]}`);
    }
  }
  check('the height plane is bit-identical to the reference', diffs === 0,
    diffs ? `${diffs}/${a.length} differ, max |д| ${maxAbs}` : '');
  for (const line of first) console.log(`    ${line}`);
  if (process.env['H5E_DBG_HEIGHTS']) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join('_tmp', 'ours-heights.bin'), Buffer.from(ours.buffer, ours.byteOffset, ours.byteLength));
    console.log('  (ours dumped to _tmp/ours-heights.bin)');
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

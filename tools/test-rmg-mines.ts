// The mines step's candidate machinery, held to the traced run four ways.
//
//   node tools/test-rmg-mines.ts
//
// The whole chain runs to the end of ZoneConnections, and then each zone's
// first mine is replayed: the recorded `below` value indexes the list this
// port builds, and the tile it lands on has to be the tile the reference map
// put that zone's Sawmill on. Four zones, four independent draws — two with
// towns and rings, two without — and the room points come from what the towns
// and connections phases actually stamped, so those phases are on trial here
// too. This is what caught the adoption offsets being applied to the wrong
// axes in connections.ts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArmyTemplates } from '../src/rmg/armies.ts';
import type { GuardTables } from '../src/rmg/armies.ts';
import { calcBorderTiles } from '../src/rmg/border-tiles.ts';
import { zoneConnections } from '../src/rmg/connections.ts';
import { createMap } from '../src/rmg/create-map.ts';
import { readCreatures } from '../src/rmg/creatures.ts';
import { fillDistToTowns } from '../src/rmg/dist-to-towns.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { MINE_TYPES, filterByRoom, mineLists, placeZoneMines, readMineShared, roomGrid } from '../src/rmg/mines.ts';
import type { MineFootprint, Tile } from '../src/rmg/mines.ts';
import { readParams } from '../src/rmg/params.ts';
import { readPresets } from '../src/rmg/preset-table.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { readTownShared, readTownSpecializations } from '../src/rmg/town-data.ts';
import type { TownShared } from '../src/rmg/town-data.ts';
import { placeTowns } from '../src/rmg/towns.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { dataDir } from './game-dir.ts';
import { hasReference, REFERENCE_MAP, REFERENCE_MISSING } from './rmg-reference.ts';

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

const SIZE = 96;
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
const creatures = readCreatures(dir);
const tables: GuardTables = {
  templates: readArmyTemplates(dir),
  creatures,
  powerByName: new Map(creatures.map((c) => [c.name, c.power])),
};

const rng = new RmgRandom(1785351845);
const made = createMap(template, { players: 2, size: 8 }, rng);
const setup = mapSetup(params, { monsterStrength: 1, water: false }, rng);
const loaded = loadTemplate(template, {
  twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
  playerCount: made.players, mapSize: SIZE, pointLightZoneRadius: params.pointLightParams.zoneRadius,
}, rng);
const placed = generateGameZones(SIZE, SIZE,
  loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
const filled = fillZones(SIZE, SIZE, placed.zones, made.twoFloors, rng);
const distances = calcBorderTiles(SIZE, SIZE, filled.floors);
const townResult = placeTowns({
  size: SIZE, template, zones: loaded.zones, floors: filled.floors, distances,
  radii: new Map(placed.zones.map((z) => [z.index, z.r])),
  presets, towns, specializations: readTownSpecializations(dir),
}, rng);
fillDistToTowns(SIZE, filled.floors, loaded.zones, townResult.centres);
const conn = zoneConnections({
  size: SIZE, template, zones: loaded.zones, floors: filled.floors, distances,
  guardPowerUnit: params.basicLeverGuardPower * params.connectionGuardLevel,
  monsterStrength: setup.monsterStrength, tables,
}, rng);

console.log('the chain, up to the door of MainObjects');
check('the counter stands at 18491, where the trace has it', rng.draws === 18491, `${rng.draws}`);

// MainObjects opens with one draw whatever happens — with the favoured-zone
// flag clear (it is, in every editor run) a next() drawn and thrown away.
// The trace records it, value and all.
const prologue = rng.next();
check('the phase prologue draw is the recorded 1893595527', prologue === 1893595527, `${prologue}`);

const grid = filled.floors[0]!;
const border = distances[0]!;
const occ = townResult.occupancy[0]!;

/** The zone's stamped points: the towns' occupancy-4 tiles plus the passages. */
function roomPoints(zoneIndex: number): Tile[] {
  const points: Tile[] = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      if (occ[y * SIZE + x] === 4 && grid[y]![x] === zoneIndex) points.push([x, y]);
    }
  }
  for (const [a, b] of conn.passages.get(zoneIndex) ?? []) points.push([b, a]);
  return points;
}

// Straight out of bin/homm5-editor-rmg.log: each zone's first tile pick.
const FIRST_PICKS: Array<{ zone: number; drew: number }> = [
  { zone: 1, drew: 587 },
  { zone: 2, drew: 458 },
  { zone: 3, drew: 305 },
  { zone: 4, drew: 631 },
];

console.log('\neach zone\'s first mine, from its recorded draw');

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else {
  // The reference Sawmills, zone by zone — the zone is asked of the grid.
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  const sawmills = new Map<number, Tile>();
  for (const m of xml.matchAll(
    /<Item href="#n:inline\(AdvMapMine\)"[^>]*>\s*<AdvMapMine>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>[\s\S]{0,600}?<Shared href="([^"]*)"/g,
  )) {
    if (!m[3]!.includes('Sawmill')) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const zone = grid[y]![x]!;
    if (!sawmills.has(zone)) sawmills.set(zone, [x, y]);
  }
  check('the reference has a Sawmill in every zone', sawmills.size === 4, `${sawmills.size}`);

  for (const { zone, drew } of FIRST_PICKS) {
    const town = template.zones.find((z) => z.index === zone)?.town
      ? (() => {
          const centre = townResult.centres.get(zone)!;
          return { x: centre.b, y: centre.a };
        })()
      : null;
    const lists = mineLists({
      size: SIZE, grid, border, zoneIndex: zone, town,
      nearMin: params.mine1LevelMinRadius, nearMax: params.mine1LevelMaxRadius,
      farMin: params.mine2LevelMinRadius, farMax: params.mine2LevelMaxRadius,
    });
    const room = roomGrid(SIZE, grid, zone, roomPoints(zone));
    const { kept, max, threshold } = filterByRoom(lists.near, room, grid, border, occ, SIZE, zone);
    const got = kept[drew];
    const want = sawmills.get(zone);
    const ok = !!got && !!want && got[0] === want[0] && got[1] === want[1];
    check(`zone ${zone}: below -> ${drew} lands the Sawmill on the engine's tile`, ok,
      `${got ? `${got[0]}:${got[1]}` : 'out of range'} vs ${want ? `${want[0]}:${want[1]}` : '?'}` +
        ` (near ${lists.near.length}, kept ${kept.length}, max ${max}, t ${threshold})`);
  }
}

// ---------------------------------------------------------------------------
// Zone 1's whole mines step, LIVE — the same rng that ran the chain keeps
// drawing, and 74 draws later the counter must stand on the step boundary the
// trace recorded, with every object on the reference map's tile.

console.log('\nzone 1, the whole step, live');

const footprints = new Map<string, MineFootprint>(MINE_TYPES.map((t) => [t.mine, readMineShared(dir, t.mine)]));
const zone1 = template.zones[0]!;
const points1 = roomPoints(1);
const centre1 = townResult.centres.get(1)!;
const mines1 = placeZoneMines({
  size: SIZE, grid, border, occupancy: occ, points: points1,
  zoneIndex: 1, town: { x: centre1.b, y: centre1.a },
  counts: zone1.mines,
  radii: {
    nearMin: params.mine1LevelMinRadius, nearMax: params.mine1LevelMaxRadius,
    farMin: params.mine2LevelMinRadius, farMax: params.mine2LevelMaxRadius,
  },
  guardPower: {
    basic: params.basicLeverGuardPower,
    mine1: params.mine1LevelGuardLevel, mine2: params.mine2LevelGuardLevel, gold: params.mineGoldGuardLevel,
  },
  monsterStrength: setup.monsterStrength,
  tables,
  footprints,
}, rng);

check('the counter lands on 18566, the step boundary the trace recorded', rng.draws === 18566, `${rng.draws}`);
check('six mines placed', mines1.length === 6, `${mines1.length}`);

if (hasReference()) {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  // Every reference mine with its position, in file order — placement order.
  const refMines: Array<{ type: string; x: number; y: number }> = [];
  for (const m of xml.matchAll(
    /<Item href="#n:inline\(AdvMapMine\)"[^>]*>\s*<AdvMapMine>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>[\s\S]{0,600}?<Shared href="[^"]*\/([A-Za-z_0-9]+)\.\(AdvMapMineShared\)/g,
  )) {
    refMines.push({ type: m[3]!, x: Number(m[1]), y: Number(m[2]) });
  }
  const zone1Ref = refMines.filter((r) => grid[r.y]![r.x] === 1);
  for (let i = 0; i < Math.min(mines1.length, zone1Ref.length); i++) {
    const ours = mines1[i]!;
    const ref = zone1Ref[i]!;
    check(`mine ${i + 1} is ${ref.type} on the engine's tile`,
      ours.type === ref.type && ours.x === ref.x && ours.y === ref.y,
      `${ours.type} ${ours.x}:${ours.y} vs ${ref.type} ${ref.x}:${ref.y}`);
  }
  // The guards and piles, by the names the draws minted — position and all.
  const posByName = new Map<string, { x: number; y: number }>();
  for (const m of xml.matchAll(/<Item href="#n:inline\(AdvMap\w+\)" id="(item_-?\d+)">\s*<AdvMap\w+>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/g)) {
    posByName.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  let placedRight = 0;
  let total = 0;
  for (const mine of mines1) {
    for (const o of [mine.guard, ...mine.piles]) {
      if (!o) continue;
      total++;
      const ref = posByName.get(o.name);
      if (ref && ref.x === o.x && ref.y === o.y) placedRight++;
    }
  }
  check('every guard and pile stands where its minted name stands in the map',
    placedRight === total && total > 0, `${placedRight} of ${total}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

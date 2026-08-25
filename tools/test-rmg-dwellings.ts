// The dwellings step, held to the traced run live.
//
//   node tools/test-rmg-dwellings.ts
//
// The whole chain runs to the door of MainObjects, zone 1's mines step runs
// live to its boundary (18566), and then the dwellings step keeps drawing:
// the trace says it costs 8 draws — three attempts at a tile, two of which
// fail the fit — and ends on 18574 with the Inferno tier-1 dwelling on the
// reference map's tile. Zones 3 and 4 request no dwellings and must spend
// nothing. Zone 2 (6 draws, Workshop at 87:89) cannot run live until the
// steps between — zone 1's shrines through road — are ported; the boundary
// table in docs/RMG.md is where it will be picked up.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArmyTemplates } from '../src/rmg/armies.ts';
import type { GuardTables } from '../src/rmg/armies.ts';
import { calcBorderTiles } from '../src/rmg/border-tiles.ts';
import { zoneConnections } from '../src/rmg/connections.ts';
import { createMap } from '../src/rmg/create-map.ts';
import { readCreatures } from '../src/rmg/creatures.ts';
import { fillDistToTowns } from '../src/rmg/dist-to-towns.ts';
import { placeZoneDwellings } from '../src/rmg/dwellings.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { MINE_TYPES, placeZoneMines, readMineShared } from '../src/rmg/mines.ts';
import type { MineFootprint, Tile } from '../src/rmg/mines.ts';
import { readParams } from '../src/rmg/params.ts';
import { readFootprint } from '../src/rmg/placement.ts';
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

console.log('the chain, through zone 1\'s mines step');
check('the counter stands at 18491, where the trace has it', rng.draws === 18491, `${rng.draws}`);
const prologue = rng.next();
check('the phase prologue draw is the recorded 1893595527', prologue === 1893595527, `${prologue}`);

const footprints = new Map<string, MineFootprint>(MINE_TYPES.map((t) => [t.mine, readMineShared(dir, t.mine)]));
const zone1 = template.zones[0]!;
const points1 = roomPoints(1);
const centre1 = townResult.centres.get(1)!;
placeZoneMines({
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
check('mines end on 18566 (hero draws nothing)', rng.draws === 18566, `${rng.draws}`);

// ---------------------------------------------------------------------------
// Zone 1's dwellings, live: the race preset's four descriptors, the template's
// per-tier counts, the same occupancy and points the mines step just left.

console.log('\nzone 1, the dwellings step, live');

const race1 = loaded.zones.find((z) => z.index === 1)!.race;
const descriptors1 = (presets.get(race1)?.dwellings ?? []).map((href) => readFootprint(dir, href));
check('the zone race\'s preset carries four dwellings', descriptors1.length === 4, `${descriptors1.length}`);

const dwellings1 = placeZoneDwellings({
  size: SIZE, grid, border, occupancy: occ, points: points1,
  zoneIndex: 1, counts: zone1.dwellings, descriptors: descriptors1,
}, rng);

check('the counter lands on 18574, the step boundary the trace recorded', rng.draws === 18574, `${rng.draws}`);
check('one dwelling placed', dwellings1.length === 1, `${dwellings1.length}`);
const d = dwellings1[0];
check('it is the tier-1 ImpCrucible', !!d && d.type.includes('ImpCrucible'), d?.type ?? 'none');
check('its quadrant is 1 — the map\'s Rot 1.5708', d?.q === 1, `${d?.q}`);

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else if (d) {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  const posByName = new Map<string, { x: number; y: number }>();
  for (const m of xml.matchAll(/<Item href="#n:inline\(AdvMap\w+\)" id="(item_-?\d+)">\s*<AdvMap\w+>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/g)) {
    posByName.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  const ref = posByName.get(d.name);
  check('the minted name stands in the map, on the same tile',
    !!ref && ref.x === d.x && ref.y === d.y,
    `${d.name} ${d.x}:${d.y} vs ${ref ? `${ref.x}:${ref.y}` : 'absent'}`);
}

// Zones 3 and 4 request no dwellings at all — the step must spend nothing.
console.log('\nzones without dwellings');
for (const zoneIndex of [3, 4]) {
  const zone = template.zones.find((z) => z.index === zoneIndex)!;
  const race = loaded.zones.find((z) => z.index === zoneIndex)!.race;
  const before = rng.draws;
  const out = placeZoneDwellings({
    size: SIZE, grid, border, occupancy: occ, points: roomPoints(zoneIndex),
    zoneIndex, counts: zone.dwellings,
    descriptors: (presets.get(race)?.dwellings ?? []).map((href) => readFootprint(dir, href)),
  }, rng);
  check(`zone ${zoneIndex}: zero dwellings, zero draws`, out.length === 0 && rng.draws === before,
    `${out.length} placed, ${rng.draws - before} drawn`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

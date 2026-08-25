// The upgrade-buildings and shrines steps, held to the traced run.
//
//   node tools/test-rmg-upgrade-shrines.ts
//
// The chain runs live through zone 1's mines and dwellings, then the two
// price-list steps take over: upgrade buildings must spend NOTHING — the
// trace's boundary does not move — because 4 points cannot afford the
// cheapest building at Value 8, and shrines must spend exactly 5 draws to
// land Shrine_Of_Magic_2 on the reference tile at the 18579 boundary.
// (Prisons and the cartographer sit between them in the engine's order and
// cost zero by template — Prisons 0, LandCartographer 0 in every zone.)
//
// The budget arithmetic of the townless zones — the part of the step zone 1
// cannot exercise — is held to the numbers the disassembly derived and the
// trace confirmed: 11 points, an affordable prefix of six, exactly one
// building. Their live run waits for the steps between.

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
import { readFootprint, zoneTiles } from '../src/rmg/placement.ts';
import { readPresets } from '../src/rmg/preset-table.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { SHRINE_TYPES, placeZoneShrines } from '../src/rmg/shrines.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { readTownShared, readTownSpecializations } from '../src/rmg/town-data.ts';
import type { TownShared } from '../src/rmg/town-data.ts';
import { placeTowns } from '../src/rmg/towns.ts';
import { DENSITY_MULTIPLIERS, placeZoneUpgradeBuildings } from '../src/rmg/upgrade-buildings.ts';
import type { PricedEntry } from '../src/rmg/upgrade-buildings.ts';
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

console.log('the chain, through zone 1\'s mines and dwellings');
rng.next(); // the phase prologue draw
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
const race1 = loaded.zones.find((z) => z.index === 1)!.race;
placeZoneDwellings({
  size: SIZE, grid, border, occupancy: occ, points: points1,
  zoneIndex: 1, counts: zone1.dwellings,
  descriptors: (presets.get(race1)?.dwellings ?? []).map((href) => readFootprint(dir, href)),
}, rng);
check('the counter stands on 18574, the dwellings boundary', rng.draws === 18574, `${rng.draws}`);

// ---------------------------------------------------------------------------
// Upgrade buildings, zone 1: 4 points against a cheapest Value of 8 — the
// step must return before its first draw, and the trace agrees (the
// boundary does not move through upgrade buildings, prisons, cartographer).

console.log('\nzone 1, upgrade buildings — the zero-draw exit');

const upgradeList: PricedEntry[] = (presets.get(race1)?.newUpgradeBuildings ?? []).map((p) => ({
  href: p.href, value: p.value, guardStrenght: p.guardStrenght, foot: readFootprint(dir, p.href),
}));
check('the preset carries twelve priced buildings', upgradeList.length === 12, `${upgradeList.length}`);
// The prefix BREAKS at the first unaffordable element, so order is
// load-bearing: the first ten ship ascending (8..40), and the two behind
// the Value-40 wall (SpellMentor 20, SacrificeAltar 10) are unreachable
// until the budget clears 40 — the engine's own quirk, kept as is.
check('the first ten ship ascending by Value — what the prefix draw leans on',
  upgradeList.slice(0, 10).every((e, i, a) => i === 0 || a[i - 1]!.value <= e.value));

const ub1 = placeZoneUpgradeBuildings({
  size: SIZE, grid, border, occupancy: occ, points: points1,
  zoneIndex: 1, density: zone1.upgBuildingsDensity, multIndex: 1,
  list: upgradeList,
  basicLeverGuardPower: params.basicLeverGuardPower,
  monsterStrength: setup.monsterStrength, tables,
}, rng);
check('nothing placed, nothing drawn', ub1.length === 0 && rng.draws === 18574, `${ub1.length} placed, at ${rng.draws}`);

// The budget arithmetic of all four zones, against the disassembly-derived
// numbers the trace confirmed: trunc(tiles · trunc(density · 0.5) / 10000).
const EXPECTED_BUDGETS: Array<{ zone: number; budget: number }> = [
  { zone: 1, budget: 4 }, { zone: 2, budget: 4 }, { zone: 3, budget: 11 }, { zone: 4, budget: 11 },
];
for (const { zone, budget } of EXPECTED_BUDGETS) {
  const density = template.zones.find((z) => z.index === zone)!.upgBuildingsDensity;
  const tiles = zoneTiles(SIZE, grid, zone).length;
  const got = Math.trunc((tiles * Math.trunc(density * DENSITY_MULTIPLIERS[1]!)) / 10000);
  check(`zone ${zone}: budget ${budget} from ${tiles} tiles at density ${density}`, got === budget, `${got}`);
}
{
  // At 11 points the affordable prefix is the first six entries — the draw
  // the trace recorded for zone 3 (below -> 2, Marletto_Tower) needs that.
  let prefix = 0;
  while (prefix < upgradeList.length && upgradeList[prefix]!.value <= 11) prefix++;
  check('at 11 points the affordable prefix is six buildings', prefix === 6, `${prefix}`);
}

// ---------------------------------------------------------------------------
// Shrines, zone 1, live: 5 draws to the 18579 boundary — prisons and the
// cartographer between the steps cost zero by template.

console.log('\nzone 1, the shrines step, live');

const shrineFeet = SHRINE_TYPES.map((s) => readFootprint(dir, `/MapObjects/${s.name}.(AdvMapShrineShared).xdb`));
const shrines1 = placeZoneShrines({
  size: SIZE, grid, border, occupancy: occ, points: points1,
  zoneIndex: 1, shrinePoints: zone1.shrinePoints, footprints: shrineFeet,
}, rng);

check('the counter lands on 18579, the step boundary the trace recorded', rng.draws === 18579, `${rng.draws}`);
check('one shrine placed', shrines1.length === 1, `${shrines1.length}`);
const s = shrines1[0];
check('it is Shrine_Of_Magic_2 — 10 points buy the Value-10 entry', s?.type === 'Shrine_Of_Magic_2', s?.type ?? 'none');
check('its quadrant is 1 — the map\'s Rot 1.5708', s?.q === 1, `${s?.q}`);

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else if (s) {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  const posByName = new Map<string, { x: number; y: number }>();
  for (const m of xml.matchAll(/<Item href="#n:inline\(AdvMap\w+\)" id="(item_-?\d+)">\s*<AdvMap\w+>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/g)) {
    posByName.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  const ref = posByName.get(s.name);
  check('the minted name stands in the map, on the same tile',
    !!ref && ref.x === s.x && ref.y === s.y,
    `${s.name} ${s.x}:${s.y} vs ${ref ? `${ref.x}:${ref.y}` : 'absent'}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

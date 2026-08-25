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

import { zoneTiles } from '../src/rmg/placement.ts';
import { DENSITY_MULTIPLIERS } from '../src/rmg/upgrade-buildings.ts';
import { runChain, SIZE, ZoneFill } from './rmg-chain.ts';
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

const c = runChain(dir);

console.log('the chain, through zone 1\'s mines and dwellings');
c.rng.next(); // the phase prologue draw
const zone1 = new ZoneFill(c, 1);
zone1.mines();
zone1.dwellings();
check('the counter stands on 18574, the dwellings boundary', c.rng.draws === 18574, `${c.rng.draws}`);

// ---------------------------------------------------------------------------
// Upgrade buildings, zone 1: 4 points against a cheapest Value of 8 — the
// step must return before its first draw, and the trace agrees (the
// boundary does not move through upgrade buildings, prisons, cartographer).

console.log('\nzone 1, upgrade buildings — the zero-draw exit');

const upgradeList = c.presets.get(c.zoneRace(1))!.newUpgradeBuildings;
check('the preset carries twelve priced buildings', upgradeList.length === 12, `${upgradeList.length}`);
// The prefix BREAKS at the first unaffordable element, so order is
// load-bearing: the first ten ship ascending (8..40), and the two behind
// the Value-40 wall (SpellMentor 20, SacrificeAltar 10) are unreachable
// until the budget clears 40 — the engine's own quirk, kept as is.
check('the first ten ship ascending by Value — what the prefix draw leans on',
  upgradeList.slice(0, 10).every((e, i, a) => i === 0 || a[i - 1]!.value <= e.value));

const ub1 = zone1.upgradeBuildings();
check('nothing placed, nothing drawn', ub1.length === 0 && c.rng.draws === 18574, `${ub1.length} placed, at ${c.rng.draws}`);

// The budget arithmetic of all four zones, against the disassembly-derived
// numbers the trace confirmed: trunc(tiles · trunc(density · 0.5) / 10000).
const EXPECTED_BUDGETS: Array<{ zone: number; budget: number }> = [
  { zone: 1, budget: 4 }, { zone: 2, budget: 4 }, { zone: 3, budget: 11 }, { zone: 4, budget: 11 },
];
for (const { zone, budget } of EXPECTED_BUDGETS) {
  const density = c.zone(zone).upgBuildingsDensity;
  const tiles = zoneTiles(SIZE, c.grid, zone).length;
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

const shrines1 = zone1.shrines();

check('the counter lands on 18579, the step boundary the trace recorded', c.rng.draws === 18579, `${c.rng.draws}`);
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

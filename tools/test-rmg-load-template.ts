// LoadTemplate and the map-created step — and the first prediction of
// something a reference map RECORDED.
//
//   node tools/test-rmg-load-template.ts
//
// Run 3's map came out Inferno and Academy with nothing but the seed to
// decide it. If the whole chain up to LoadTemplate is read right — three
// CreateMap draws, six map-created draws, then the race picks in ascending
// zone order — the port must derive those two races from seed 1785351845 and
// the template alone. That is a check no amount of self-consistency can
// fake.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createMap } from '../src/rmg/create-map.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { engineSort, loadTemplate, RACE } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { readParams } from '../src/rmg/params.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('the engine sort');

// Correctness on arbitrary data — the strided merge must still BE a sort.
const rnd = new RmgRandom(42);
for (let n = 0; n <= 33; n++) {
  const arr = Array.from({ length: n }, () => rnd.below(10));
  const sorted = engineSort(arr, (a, b) => a < b);
  const plain = [...arr].sort((a, b) => a - b);
  if (JSON.stringify(sorted) !== JSON.stringify(plain)) {
    check(`sorts ${n} elements`, false, arr.join(','));
  }
}
check('it sorts, at every length 0..33', failures === 0);
// The property a stable sort would get wrong: equals emit the RIGHT one first.
const tied = engineSort([{ k: 1, tag: 'left' }, { k: 1, tag: 'right' }], (a, b) => a.k < b.k);
check('ties emit the right element first', tied[0]!.tag === 'right' && tied[1]!.tag === 'left');

const dir = join(dataDir(), 'RMG');
if (!existsSync(dir)) {
  console.log('\nno unpacked RMG data — run `npm run unpack-data`; skipping the rest');
  process.exit(failures ? 1 : 0);
}

console.log('\nthe reference chain, seed 1785351845');

const template = readTemplate(join(dir, 'Templates', 'S1P2Z2M1.xdb'));
const params = readParams(join(dir, 'Params', 'Default.xdb'));

const rng = new RmgRandom(1785351845);
const made = createMap(template, { players: 2, size: 8 }, rng);
check('CreateMap leaves the counter at 3', rng.draws === 3, `${rng.draws}`);

// Whether the operator fixed the strength or the water cannot matter here:
// every RNG entry steps the state exactly once, so a supplied parameter
// changes the VALUE it yields and nothing downstream.
const setup = mapSetup(params, {}, rng);
check('map-created leaves it at 9', rng.draws === 9, `${rng.draws}`);

const loaded = loadTemplate(template, {
  twoFloors: made.twoFloors,
  dwarvenUnderground: setup.dwarvenUnderground,
  water: setup.water,
  playerCount: made.players,
  mapSize: 96,
  pointLightZoneRadius: params.pointLightParams.zoneRadius,
}, rng);
// 1 coin + 4 random-race zones at 2 draws + 4 constructors, no floors, no
// light grid: 13 — the phase boundary lands at 22, run 1's own number for
// the same arithmetic.
check('LoadTemplate leaves it at 22', rng.draws === 22, `${rng.draws}`);

check('four zones, ascending index', loaded.zones.map((z) => z.index).join(',') === '1,2,3,4');
check('zones 1 and 2 seat the two players',
  loaded.zones[0]!.playerNo === 1 && loaded.zones[1]!.playerNo === 2
  && loaded.zones[2]!.playerNo === 0 && loaded.zones[3]!.playerNo === 0);
check('every zone sits on the single floor', loaded.zones.every((z) => z.floor === 0));

// THE prediction: run 3's map recorded Inferno and Academy. Nothing but the
// seed decides this — the races fall out of below(8) against the hardcoded
// surface list, two phases deep into the stream.
const raceName = (r: number): string => Object.entries(RACE).find(([, v]) => v === r)?.[0] ?? `${r}`;
const pair = loaded.players.map(raceName).join('+');
check('the players are Inferno and Academy — run 3, derived from the seed',
  loaded.players.length === 2
  && loaded.players.includes(RACE.INFERNO) && loaded.players.includes(RACE.ACADEMY), pair);
console.log(`  (drawn as ${pair})`);

// And the full counter chain for the editor oracle to judge: the boundaries
// it will log for this seed, phase by phase.
const placed = generateGameZones(96, 96,
  loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
check('GenerateGameZones ends at 388 — one pass, 366 spent', rng.draws === 388, `${rng.draws}`);
// Not merely recorded any more: the editor oracle traced this very chain and
// the port matched it DRAW FOR DRAW — 18459 is the engine's own number.
fillZones(96, 96, placed.zones, made.twoFloors, rng);
check('FillZones ends at 18459 — the engine\'s own count, matched in lockstep',
  rng.draws === 18459, `${rng.draws}`);
console.log(`  (boundary chain for the oracle: 3, 9, 22, 388, ${rng.draws})`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

// The zone-tail treasures block, held to the traced run live.
//
//   node tools/test-rmg-treasures.ts
//
// Zone 1 runs live through its nine earlier steps to the shops boundary at
// 18653, then the treasures block takes over: one Redwood Observatory
// (whose count ignores the template — RedwoodObservatoryDensity is a dead
// field), no Den roll (zone 1 seats player 1), and one drawn treasure —
// below(9) = 6, Ore — for 9 draws to the boundary at 18662. The chests
// step must spend nothing: its density scales to zero objects here, and
// the reference's 31 chests all come from the treasure-blocks phase.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runChain, ZoneFill } from './rmg-chain.ts';
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
c.rng.next(); // the phase prologue draw
const zone1 = new ZoneFill(c, 1);
zone1.mines();
zone1.dwellings();
zone1.upgradeBuildings();
zone1.shrines();
zone1.resourceBuildings();
zone1.treasuryBuildings();
zone1.luckMorale();
zone1.shops();
check('the earlier steps land on 18653, the shops boundary', c.rng.draws === 18653, `${c.rng.draws}`);

console.log('\nzone 1, the treasures block, live');

const obs = zone1.observatories();
check('one observatory, no Den roll (the zone seats player 1)',
  obs.length === 1 && obs[0]!.type.includes('Redwood_Observatory'),
  obs.map((o) => o.type).join(', '));

const treasures = zone1.treasures();
check('the counter lands on 18662, the step boundary the trace recorded', c.rng.draws === 18662, `${c.rng.draws}`);
check('one treasure placed, and below(9) -> 6 makes it Ore',
  treasures.length === 1 && treasures[0]!.type === 'Ore',
  treasures.map((t) => t.type).join(', ') || 'none');

const chests = zone1.chests();
check('chests spend nothing', chests.length === 0 && c.rng.draws === 18662,
  `${chests.length} placed, at ${c.rng.draws}`);

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  const posByName = new Map<string, { x: number; y: number }>();
  for (const m of xml.matchAll(/<Item href="#n:inline\(AdvMap\w+\)" id="(item_-?\d+)">\s*<AdvMap\w+>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/g)) {
    posByName.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  let right = 0;
  let total = 0;
  for (const o of [...obs, ...treasures]) {
    total++;
    const ref = posByName.get(o.name);
    if (ref && ref.x === o.x && ref.y === o.y) right++;
    else check(`${o.name} (${o.type}) misplaced`, false, `${o.x}:${o.y} vs ${ref ? `${ref.x}:${ref.y}` : 'absent'}`);
  }
  check('the observatory and the Ore stand where their minted names stand',
    right === total && total === 2, `${right} of ${total}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

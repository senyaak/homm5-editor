// The four preset-vector price-list steps, held to the traced run live.
//
//   node tools/test-rmg-price-lists.ts
//
// Zone 1 runs from the phase door through EIGHT steps on the one rng:
// mines, dwellings, upgrade buildings (zero-draw), shrines, then resource
// buildings, treasury buildings, luck/morale and shops — each landing on
// the step boundary the trace recorded, ten price-list objects in all,
// every minted name on the reference map's tile. The budget rules are the
// distinguishing fact per step (raw points against tile-scaled density,
// and luck/morale's +40), so the boundaries alone carry most of the
// weight; the tiles pin the candidate machinery.

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
check('the chain stands at 18491', c.rng.draws === 18491, `${c.rng.draws}`);
c.rng.next(); // the phase prologue draw

const zone1 = new ZoneFill(c, 1);
zone1.mines();
zone1.dwellings();
zone1.upgradeBuildings();
zone1.shrines();
check('the earlier steps land on 18579, the shrines boundary', c.rng.draws === 18579, `${c.rng.draws}`);

interface Step { name: string; boundary: number; placed: Array<{ type: string; name: string; x: number; y: number }> }
const steps: Step[] = [];

// Each step is checked against its boundary the moment it finishes — the
// what and the order come from the decoded trace.
const run = (name: string, boundary: number, place: () => Step['placed'], want: string[]): void => {
  console.log(`\nzone 1, ${name}, live`);
  const placed = place();
  steps.push({ name, boundary, placed });
  check(`the counter lands on ${boundary}`, c.rng.draws === boundary, `${c.rng.draws}`);
  check(`${want.length} placed, in the traced order`,
    placed.length === want.length && placed.every((p, i) => p.type.includes(want[i]!)),
    placed.map((p) => p.type.replace(/#.*$/, '').split('/').pop()!.split('.')[0]).join(', '));
};

run('resource buildings', 18598, () => zone1.resourceBuildings(), ['Windmill', 'Windmill', 'Windmill']);
run('treasury buildings', 18622, () => zone1.treasuryBuildings(), ['Crypt', 'Crypt']);
run('luck/morale', 18648, () => zone1.luckMorale(),
  ['Fountain_Of_Fortune', 'Temple', 'Temple', 'RandomSancutuary']);
run('shops', 18653, () => zone1.shops(), ['Trading_Post']);

if (!hasReference()) {
  console.log(`\n  ${REFERENCE_MISSING}`);
} else {
  console.log('\nevery minted name against the reference map');
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  const posByName = new Map<string, { x: number; y: number }>();
  for (const m of xml.matchAll(/<Item href="#n:inline\(AdvMap\w+\)" id="(item_-?\d+)">\s*<AdvMap\w+>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/g)) {
    posByName.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  let right = 0;
  let total = 0;
  for (const step of steps) {
    for (const p of step.placed) {
      total++;
      const ref = posByName.get(p.name);
      if (ref && ref.x === p.x && ref.y === p.y) right++;
      else check(`${p.name} (${p.type}) misplaced`, false, `${p.x}:${p.y} vs ${ref ? `${ref.x}:${ref.y}` : 'absent'}`);
    }
  }
  check('every object stands where its minted name stands in the map', right === total && total === 10, `${right} of ${total}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

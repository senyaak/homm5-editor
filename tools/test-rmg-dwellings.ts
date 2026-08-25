// The dwellings step, held to the traced run live.
//
//   node tools/test-rmg-dwellings.ts
//
// The whole chain runs to the door of MainObjects, zone 1's mines step runs
// live to its boundary (18566), and then the dwellings step keeps drawing:
// the trace says it costs 8 draws — three attempts at a tile, two of which
// fail the fit — and ends on 18574 with the Inferno tier-1 dwelling on the
// reference map's tile. Zones 3 and 4 request no dwellings and must spend
// nothing. Zone 2 (6 draws, Workshop at 87:89) cannot run live until zone
// 1's remaining steps and the roads are ported; the boundary table in
// docs/RMG.md is where it will be picked up.

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

console.log('the chain, through zone 1\'s mines step');
check('the counter stands at 18491, where the trace has it', c.rng.draws === 18491, `${c.rng.draws}`);
const prologue = c.rng.next();
check('the phase prologue draw is the recorded 1893595527', prologue === 1893595527, `${prologue}`);

const zone1 = new ZoneFill(c, 1);
zone1.mines();
check('mines end on 18566 (hero draws nothing)', c.rng.draws === 18566, `${c.rng.draws}`);

// ---------------------------------------------------------------------------
// Zone 1's dwellings, live: the race preset's four descriptors, the template's
// per-tier counts, the same occupancy and points the mines step just left.

console.log('\nzone 1, the dwellings step, live');

check('the zone race\'s preset carries four dwellings',
  (c.presets.get(c.zoneRace(1))?.dwellings.length ?? 0) === 4,
  `${c.presets.get(c.zoneRace(1))?.dwellings.length}`);

const dwellings1 = zone1.dwellings();

check('the counter lands on 18574, the step boundary the trace recorded', c.rng.draws === 18574, `${c.rng.draws}`);
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
  const before = c.rng.draws;
  const out = new ZoneFill(c, zoneIndex).dwellings();
  check(`zone ${zoneIndex}: zero dwellings, zero draws`, out.length === 0 && c.rng.draws === before,
    `${out.length} placed, ${c.rng.draws - before} drawn`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

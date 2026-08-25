// The zone road, and with it the WHOLE first loop of MainObjects live.
//
//   node tools/test-rmg-road.ts
//
// The road's only rng is one below(2) per walked tile, so the step
// boundary is the total road length — 234/265/222/207 across the zones —
// and it is sensitive to everything at once: the points' PUSH order, the
// nearest-later-sibling chain, the wave's cost arithmetic and sweep
// order, and the coin-tied descent. Once zone 1's road lands, zones 2-4
// run their entire fill on the same rng, every step held to its traced
// boundary, down to the phase's last draw at 20039.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runChain, ZoneFill } from './rmg-chain.ts';
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
c.rng.next(); // the phase prologue draw

// Every step boundary the trace recorded, zone by zone. A zero-cost step
// shares its predecessor's boundary and is still called — the engine calls
// every step in every zone.
const ZONES: Array<{ zone: number; boundaries: Array<[string, number]> }> = [
  { zone: 1, boundaries: [
    ['mines', 18566], ['dwellings', 18574], ['upgradeBuildings', 18574],
    ['shrines', 18579], ['resourceBuildings', 18598], ['treasuryBuildings', 18622],
    ['luckMorale', 18648], ['shops', 18653], ['observatories+treasures', 18662],
    ['chests', 18662], ['road', 18896],
  ] },
  { zone: 2, boundaries: [
    ['mines', 18974], ['dwellings', 18980], ['upgradeBuildings', 18980],
    ['shrines', 18989], ['resourceBuildings', 19006], ['treasuryBuildings', 19011],
    ['luckMorale', 19033], ['shops', 19044], ['observatories+treasures', 19059],
    ['chests', 19059], ['road', 19324],
  ] },
  { zone: 3, boundaries: [
    ['mines', 19363], ['dwellings', 19363], ['upgradeBuildings', 19375],
    ['shrines', 19401], ['resourceBuildings', 19401], ['treasuryBuildings', 19445],
    ['luckMorale', 19450], ['shops', 19464], ['observatories+treasures', 19469],
    ['chests', 19469], ['road', 19691],
  ] },
  { zone: 4, boundaries: [
    ['mines', 19730], ['dwellings', 19730], ['upgradeBuildings', 19761],
    ['shrines', 19782], ['resourceBuildings', 19782], ['treasuryBuildings', 19808],
    ['luckMorale', 19815], ['shops', 19827], ['observatories+treasures', 19832],
    ['chests', 19832], ['road', 20039],
  ] },
];

for (const { zone, boundaries } of ZONES) {
  console.log(`\nzone ${zone}, every step on the one rng`);
  const fill = new ZoneFill(c, zone);
  const steps: Record<string, () => unknown> = {
    mines: () => fill.mines(),
    dwellings: () => fill.dwellings(),
    upgradeBuildings: () => fill.upgradeBuildings(),
    shrines: () => fill.shrines(),
    resourceBuildings: () => fill.resourceBuildings(),
    treasuryBuildings: () => fill.treasuryBuildings(),
    luckMorale: () => fill.luckMorale(),
    shops: () => fill.shops(),
    'observatories+treasures': () => { fill.observatories(); fill.treasures(); },
    chests: () => fill.chests(),
    road: () => fill.road(),
  };
  for (const [name, boundary] of boundaries) {
    steps[name]!();
    check(`${name} lands on ${boundary}`, c.rng.draws === boundary, `${c.rng.draws}`);
  }
}

console.log(`\nthe first loop of MainObjects ends on ${c.rng.draws}`);
check('which is the traced 20039', c.rng.draws === 20039, `${c.rng.draws}`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

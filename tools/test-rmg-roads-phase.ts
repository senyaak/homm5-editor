// The roads phase — 0xEBA690, live on the reference seed.
//
//   node tools/test-rmg-roads-phase.ts
//
// The whole first loop of MainObjects runs first (the boundaries are
// test-rmg-road's), the mines' stamp actives are kept — they are the
// zone's `+0x11C` vector the phase wires with 0x10 roads — and then the
// phase itself: all four zones in floor-hash order, town entries and
// passage points to the 0x08 network, mine actives to the 0x10 one. The
// phase's only rng is the router's coin per walked tile, so the traced
// "roads created" boundary at 20420 is the total length of every road it
// laid — sensitive at once to the seeds, both nearest-point scans (one
// full, one sampled), the route directions and the growing lists.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
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

console.log('the first loop of MainObjects, mine actives kept');

const mineActives = new Map<number, Tile[]>();
for (const zone of [1, 2, 3, 4]) {
  const fill = new ZoneFill(c, zone);
  mineActives.set(zone, fill.mines().flatMap((m) => m.actives));
  fill.dwellings();
  fill.upgradeBuildings();
  fill.shrines();
  fill.resourceBuildings();
  fill.treasuryBuildings();
  fill.luckMorale();
  fill.shops();
  fill.observatories();
  fill.treasures();
  fill.chests();
  fill.road();
}
check('the first loop ends on the traced 20039', c.rng.draws === 20039, `${c.rng.draws}`);

console.log('\nthe roads phase, zone by zone');

for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === 0))) {
  const zone = c.zone(z.index);
  const centre = c.townResult.centres.get(z.index);
  const roads = buildZoneRoadsPhase({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, zoneIndex: z.index,
    townEntry: zone.town && centre ? [centre.b, centre.a] : null,
    connectionPoints: (c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
    mineActives: mineActives.get(z.index) ?? [],
  }, c.rng);
  console.log(`  zone ${z.index}: 0x08 ${roads.road08.length} tiles, 0x10 ${roads.road10.length}, rng at ${c.rng.draws}`);
}

check('roads created lands on the traced 20420', c.rng.draws === 20420, `${c.rng.draws}`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

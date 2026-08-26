// The underground reference run — seed 1785351845 on S0-1P2Z2K3.1T, tiny
// 72×72, two floors, zone 1 below ground.
//
//   node tools/test-rmg-underground.ts
//
// What the surface run never measured, this one does: the floor balancing,
// the underground town's point lights, the teleport pair, the prisons step,
// and MainObjects running against a floor-1 grid with the fit's five-tile
// margin. Every traced step boundary of the first loop is asserted per
// zone, so a divergence names its step.
//
// The statics of the underground zone wait on the subterranean vtable
// overrides (unread); this suite ends at the roads-phase boundary.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { runChain, ZoneFill } from './rmg-chain.ts';
import { dataDir } from './game-dir.ts';
import { REFERENCE_UG_DIR, hasUndergroundReference } from './rmg-reference.ts';

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

const c = runChain(dir, { template: 'S0-1P2Z2K3.1T', size: 72, underground: true });

console.log('the chain, on the underground run');
check('the chain ends on the traced 4475', c.rng.draws === 4475, `${c.rng.draws}`);
check('zone 1 lies underground', c.loaded.zones.find((z) => z.index === 1)!.floor === 1);
check('one teleport pair stands', [...c.teleports.values()].flat().length === 2,
  [...c.teleports.values()].flat().map((t) => `${t.href.split('/').pop()}@${t.x}:${t.y}`).join(' '));

// The traced per-zone step boundaries of the first MainObjects loop.
const STEPS: Record<number, Array<[string, number]>> = {
  1: [['mines', 4583], ['dwellings', 4625], ['upgradeBuildings', 4637], ['prisons', 4645],
      ['shrines', 4663], ['resourceBuildings', 4673], ['treasuryBuildings', 4690],
      ['luckMorale', 4782], ['shops', 4806], ['road', 5269]],
  2: [['mines', 5361], ['dwellings', 5371], ['upgradeBuildings', 5380], ['prisons', 5386],
      ['shrines', 5400], ['resourceBuildings', 5407], ['treasuryBuildings', 5424],
      ['luckMorale', 5444], ['shops', 5451], ['tail', 5494], ['road', 5884]],
  3: [['mines', 5892], ['dwellings', 5898], ['upgradeBuildings', 5898], ['prisons', 5898],
      ['shrines', 5913], ['resourceBuildings', 5913], ['treasuryBuildings', 5948],
      ['luckMorale', 5953], ['shops', 5967], ['tail', 5976], ['road', 6129]],
};
// Zone 1 (underground) has no treasures/chests marks and no boundary
// between shops and the road: the observatories spend their draws inside
// that gap, so the road boundary is what proves them.

console.log('\nthe first loop of MainObjects, zone by zone in template order');
c.rng.next(); // the MainObjects prologue draw

const named: Array<{ name: string; x: number; y: number }> = [];
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
for (const tz of c.template.zones) {
  const zone = tz.index;
  const fill = new ZoneFill(c, zone);
  const steps = STEPS[zone]!;
  const run: Record<string, () => void> = {
    mines: () => {
      const mines = fill.mines();
      mineActives.set(zone, [
        ...mines.flatMap((m) => m.actives),
        ...fill.abandoned.flatMap((m) => m.actives),
      ]);
      for (const m of mines) {
        named.push(m);
        for (const p of m.piles) named.push(p);
        if (m.guard) named.push({ name: m.guard.name, x: m.guard.x, y: m.guard.y });
      }
      for (const m of fill.abandoned) named.push(m);
    },
    dwellings: () => { for (const d of fill.dwellings()) named.push(d); },
    upgradeBuildings: () => { for (const u of fill.upgradeBuildings()) named.push(u); },
    prisons: () => { for (const p of fill.prisons()) named.push(p); },
    shrines: () => { for (const s of fill.shrines()) named.push(s); },
    resourceBuildings: () => { for (const p of fill.resourceBuildings()) named.push(p); },
    treasuryBuildings: () => { for (const p of fill.treasuryBuildings()) named.push(p); },
    luckMorale: () => { for (const p of fill.luckMorale()) named.push(p); },
    shops: () => { for (const p of fill.shops()) named.push(p); },
    tail: () => {
      for (const o of fill.observatories()) named.push(o);
      for (const t of fill.treasures()) named.push(t);
      for (const t of fill.chests()) named.push(t);
    },
    road: () => {
      // The underground zone's observatories run without a mark of their
      // own — before the road, which is the next boundary that lands.
      if (!steps.some(([step]) => step === 'tail')) run['tail']!();
      roads.set(zone, fill.road());
    },
  };
  for (const [step, boundary] of steps) {
    run[step]!();
    check(`zone ${zone} ${step} lands on ${boundary}`, c.rng.draws === boundary, `${c.rng.draws}`);
  }
}
check('the first loop ends on the traced 6129', c.rng.draws === 6129, `${c.rng.draws}`);

console.log('\nthe roads phase');
for (let f = 0; f < c.floors.length; f++) {
  for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === f))) {
    const zone = c.zone(z.index);
    const centre = c.townResult.centres.get(z.index);
    buildZoneRoadsPhase({
      size: c.size, grid: c.floors[f]!.grid, border: c.floors[f]!.border,
      occupancy: c.floors[f]!.occ, zoneIndex: z.index,
      townEntry: zone.town && centre ? [centre.b, centre.a] : null,
      connectionPoints: [
        ...(c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
        ...c.teleportActives(z.index),
      ],
      mineActives: mineActives.get(z.index) ?? [],
    }, c.rng);
  }
}
check('the roads phase ends on the traced 6471', c.rng.draws === 6471, `${c.rng.draws}`);

// Every named object of the loop against the reference map.
if (!hasUndergroundReference()) {
  console.log(`\n  (no ${REFERENCE_UG_DIR} — the by-name half is skipped)`);
} else {
  const xdb = readFileSync(join(REFERENCE_UG_DIR, 'map.xdb'), 'utf8');
  let bad = 0;
  for (const p of named) {
    const i = xdb.indexOf(`id="${p.name}"`);
    if (i < 0) { bad++; continue; }
    const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 300));
    if (!m || Number(m[1]) !== p.x || Number(m[2]) !== p.y) bad++;
  }
  check(`every loop object stands where its minted name stands (${named.length} checked)`, bad === 0, `${bad} astray`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

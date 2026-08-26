// The water border against the island reference (run 6): the carve and the
// water treasures — the 180 draws the engine hides inside the "dist to
// towns" bracket, 18475 -> 18655.
//
//   node tools/test-rmg-water.ts [--game <dir>]
//
// The chain runs with water = 2 (WATER_ISLAND_MAP — what the dialog's
// checkbox records; see docs/RMG.md). Everything through the towns is the
// no-water stream by construction (the supplied value costs one discarded
// draw either way), so the suite holds the pass's own boundary and every
// water treasure against the reference map by minted name.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { runChain, ZoneFill } from './rmg-chain.ts';
import { dataDir } from './game-dir.ts';
import { REFERENCE_WATER_MAP, hasWaterReference } from './rmg-reference.ts';

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

const c = runChain(dir, { water: 2 });
const water = c.water!;
check('the chain carries a water pass', water !== null);

const treasures = [...water.treasures.values()].flat();
check('the water pass ends on 18655 — the engine\'s own bracket',
  water.drawsAfter === 18655, `${water.drawsAfter}`);
check('36 water treasures, five draws each', treasures.length === 36, `${treasures.length}`);

// The island connections — the land digger finds nothing to dig (all three
// template connections are unconnected across the sea), the teleport pass
// pairs the zones with Monolith_Two_Way halves, and every water zone's
// Shipyard bit adds one guarded shipyard. The chain runs all of it, so the
// counter itself is the boundary assert.
check('connections end on 18737 — the engine\'s own bracket', c.rng.draws === 18737, `${c.rng.draws}`);
check('all three connections went to teleports',
  c.conn.unconnected.length === 3 && [...c.teleports.values()].flat().length === 6,
  `${c.conn.unconnected.length} unconnected, ${[...c.teleports.values()].flat().length} halves`);
check('every water zone got its shipyard', c.water!.shipyards.size === 4, `${c.water!.shipyards.size}`);

// Everything against the reference map, by minted name.
if (!hasWaterReference()) {
  console.log('  (no water reference — the by-name half is skipped;');
  console.log('   rebuild it with `npm run rmg-reference -- --water <map.h5m>`)');
} else {
  const xdb = readFileSync(REFERENCE_WATER_MAP, 'utf8');
  const standsInMap = (name: string, x: number, y: number): boolean => {
    const i = xdb.indexOf(`id="${name}"`);
    if (i < 0) return false;
    const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 400));
    return !!m && Number(m[1]) === x && Number(m[2]) === y;
  };

  let astray = 0;
  let wrongType = 0;
  for (const t of treasures) {
    if (!standsInMap(t.name, t.x, t.y)) { astray++; continue; }
    const i = xdb.indexOf(`id="${t.name}"`);
    const expected = c.params.waterTreasures[t.typeIndex]!.split('#')[0];
    const shared = /<Shared href="([^"#]*)/.exec(xdb.slice(i, i + 400))?.[1];
    if (shared !== expected) wrongType++;
  }
  check('every water treasure stands where its minted name stands in the map',
    astray === 0, `${astray} astray`);
  check('and each is the WaterTreasures entry its draw picked',
    wrongType === 0, `${wrongType} of the wrong type`);

  let shipAstray = 0;
  let guardAstray = 0;
  let guards = 0;
  for (const s of c.water!.shipyards.values()) {
    if (!standsInMap(s.name, s.x, s.y)) shipAstray++;
    if (s.guard?.guard) {
      guards++;
      if (!standsInMap(s.guard.guard.name, s.guard.x, s.guard.y)) guardAstray++;
    }
  }
  check('every shipyard stands where its minted name stands in the map',
    shipAstray === 0, `${shipAstray} astray`);
  check('and so does every shipyard guard', guardAstray === 0, `${guards} guards, ${guardAstray} astray`);

  let teleAstray = 0;
  let teleGuards = 0;
  for (const halves of c.teleports.values()) {
    for (const h of halves) {
      if (!standsInMap(h.name, h.x, h.y)) teleAstray++;
      if (h.guard) {
        teleGuards++;
        if (!standsInMap(h.guard.name, h.guard.x, h.guard.y)) teleAstray++;
      }
    }
  }
  check('every monolith half and its guard stand on their reference tiles',
    teleAstray === 0, `6 halves, ${teleGuards} guards, ${teleAstray} astray`);
}

// --- The first loop of MainObjects, zone by zone in template order, every
// traced step boundary asserted. The treasures boundary swallows the
// observatories (no mark of their own), chests spend nothing here.
console.log('\nthe first loop of MainObjects over the carved islands');
c.rng.next(); // the MainObjects prologue draw

const STEPS: Record<number, Array<[string, number]>> = {
  1: [['mines', 18825], ['dwellings', 18829], ['upgradeBuildings', 18829], ['prisons', 18829],
      ['shrines', 18834], ['resourceBuildings', 18848], ['treasuryBuildings', 18864],
      ['luckMorale', 18895], ['shops', 18902], ['treasures', 18915], ['chests', 18915], ['road', 19127]],
  2: [['mines', 19210], ['dwellings', 19218], ['upgradeBuildings', 19218], ['prisons', 19218],
      ['shrines', 19223], ['resourceBuildings', 19235], ['treasuryBuildings', 19240],
      ['luckMorale', 19257], ['shops', 19262], ['treasures', 19273], ['chests', 19273], ['road', 19461]],
  3: [['mines', 19500], ['dwellings', 19500], ['upgradeBuildings', 19511], ['prisons', 19511],
      ['shrines', 19532], ['resourceBuildings', 19532], ['treasuryBuildings', 19558],
      ['luckMorale', 19565], ['shops', 19601], ['treasures', 19612], ['chests', 19612], ['road', 19794]],
  4: [['mines', 19831], ['dwellings', 19831], ['upgradeBuildings', 19840], ['prisons', 19840],
      ['shrines', 19855], ['resourceBuildings', 19855], ['treasuryBuildings', 19882],
      ['luckMorale', 19889], ['shops', 19915], ['treasures', 19924], ['chests', 19924], ['road', 20130]],
};

const named: Array<{ name: string; x: number; y: number }> = [];
const fills = new Map<number, ZoneFill>();
const mineActives = new Map<number, Tile[]>();
const roads = new Map<number, Tile[]>();
for (const tz of c.template.zones) {
  const zone = tz.index;
  const fill = new ZoneFill(c, zone);
  fills.set(zone, fill);
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
    upgradeBuildings: () => {
      for (const u of fill.upgradeBuildings()) {
        named.push(u);
        if (u.guard?.guard) named.push({ name: u.guard.guard.name, x: u.guard.x, y: u.guard.y });
      }
    },
    prisons: () => { for (const p of fill.prisons()) named.push(p); },
    shrines: () => { for (const s of fill.shrines()) named.push(s); },
    resourceBuildings: () => { for (const p of fill.resourceBuildings()) named.push(p); },
    treasuryBuildings: () => { for (const p of fill.treasuryBuildings()) named.push(p); },
    luckMorale: () => { for (const p of fill.luckMorale()) named.push(p); },
    shops: () => { for (const p of fill.shops()) named.push(p); },
    treasures: () => {
      for (const o of fill.observatories()) named.push(o);
      for (const t of fill.treasures()) named.push(t);
    },
    chests: () => { for (const t of fill.chests()) named.push(t); },
    road: () => { roads.set(zone, fill.road()); },
  };
  for (const [step, boundary] of STEPS[zone]!) {
    run[step]!();
    check(`zone ${zone} ${step} lands on ${boundary}`, c.rng.draws === boundary, `${c.rng.draws}`);
  }
}
check('the first loop ends on the traced 20130', c.rng.draws === 20130, `${c.rng.draws}`);

console.log('\nthe roads phase — the shipyards wired in through +0xC0');
for (let f = 0; f < c.floors.length; f++) {
  for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === f))) {
    const zone = c.zone(z.index);
    const centre = c.townResult.centres.get(z.index);
    const phase = buildZoneRoadsPhase({
      size: c.size, grid: c.floors[f]!.grid, border: c.floors[f]!.border,
      occupancy: c.floors[f]!.occ, zoneIndex: z.index,
      townEntry: zone.town && centre ? [centre.b, centre.a] : null,
      connectionPoints: [
        ...(c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
        ...c.teleportActives(z.index),
      ],
      mineActives: mineActives.get(z.index) ?? [],
    }, c.rng);
    roads.set(z.index, [...roads.get(z.index)!, ...phase.road08, ...phase.road10]);
  }
}
check('the roads phase ends on the traced 20511', c.rng.draws === 20511, `${c.rng.draws}`);

// Every named object of the loop against the reference map.
if (hasWaterReference()) {
  const xdb = readFileSync(REFERENCE_WATER_MAP, 'utf8');
  let astray = 0;
  for (const p of named) {
    const i = xdb.indexOf(`id="${p.name}"`);
    if (i < 0) { astray++; continue; }
    const m = /<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/.exec(xdb.slice(i, i + 300));
    if (!m || Number(m[1]) !== p.x || Number(m[2]) !== p.y) astray++;
  }
  check(`every loop object stands where its minted name stands (${named.length} checked)`,
    astray === 0, `${astray} astray`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

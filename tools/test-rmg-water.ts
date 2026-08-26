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

import { runChain } from './rmg-chain.ts';
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

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

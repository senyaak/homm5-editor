// The mines step's candidate machinery, held to the traced run four ways.
//
//   node tools/test-rmg-mines.ts
//
// The whole chain runs to the end of ZoneConnections, and then each zone's
// first mine is replayed: the recorded `below` value indexes the list this
// port builds, and the tile it lands on has to be the tile the reference map
// put that zone's Sawmill on. Four zones, four independent draws — two with
// towns and rings, two without — and the room points come from what the towns
// and connections phases actually stamped, so those phases are on trial here
// too. This is what caught the adoption offsets being applied to the wrong
// axes in connections.ts. Then zone 1's whole step runs LIVE to its boundary.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mineLists } from '../src/rmg/mines.ts';
import type { Tile } from '../src/rmg/mines.ts';
import { filterByRoom, roomGrid } from '../src/rmg/placement.ts';
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
const { grid, border, occ, params, template } = c;

console.log('the chain, up to the door of MainObjects');
check('the counter stands at 18491, where the trace has it', c.rng.draws === 18491, `${c.rng.draws}`);

// MainObjects opens with one draw whatever happens — with the favoured-zone
// flag clear (it is, in every editor run) a next() drawn and thrown away.
// The trace records it, value and all.
const prologue = c.rng.next();
check('the phase prologue draw is the recorded 1893595527', prologue === 1893595527, `${prologue}`);

// Straight out of bin/homm5-editor-rmg.log: each zone's first tile pick.
const FIRST_PICKS: Array<{ zone: number; drew: number }> = [
  { zone: 1, drew: 587 },
  { zone: 2, drew: 458 },
  { zone: 3, drew: 305 },
  { zone: 4, drew: 631 },
];

console.log('\neach zone\'s first mine, from its recorded draw');

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else {
  // The reference Sawmills, zone by zone — the zone is asked of the grid.
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  const sawmills = new Map<number, Tile>();
  for (const m of xml.matchAll(
    /<Item href="#n:inline\(AdvMapMine\)"[^>]*>\s*<AdvMapMine>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>[\s\S]{0,600}?<Shared href="([^"]*)"/g,
  )) {
    if (!m[3]!.includes('Sawmill')) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const zone = grid[y]![x]!;
    if (!sawmills.has(zone)) sawmills.set(zone, [x, y]);
  }
  check('the reference has a Sawmill in every zone', sawmills.size === 4, `${sawmills.size}`);

  for (const { zone, drew } of FIRST_PICKS) {
    const town = template.zones.find((z) => z.index === zone)?.town
      ? (() => {
          const centre = c.townResult.centres.get(zone)!;
          return { x: centre.b, y: centre.a };
        })()
      : null;
    const lists = mineLists({
      size: SIZE, grid, border, zoneIndex: zone, town,
      nearMin: params.mine1LevelMinRadius, nearMax: params.mine1LevelMaxRadius,
      farMin: params.mine2LevelMinRadius, farMax: params.mine2LevelMaxRadius,
    });
    const room = roomGrid(SIZE, grid, zone, c.roomPoints(zone));
    const { kept, max, threshold } = filterByRoom(lists.near, room, grid, border, occ, SIZE, zone, 5);
    const got = kept[drew];
    const want = sawmills.get(zone);
    const ok = !!got && !!want && got[0] === want[0] && got[1] === want[1];
    check(`zone ${zone}: below -> ${drew} lands the Sawmill on the engine's tile`, ok,
      `${got ? `${got[0]}:${got[1]}` : 'out of range'} vs ${want ? `${want[0]}:${want[1]}` : '?'}` +
        ` (near ${lists.near.length}, kept ${kept.length}, max ${max}, t ${threshold})`);
  }
}

// ---------------------------------------------------------------------------
// Zone 1's whole mines step, LIVE — the same rng that ran the chain keeps
// drawing, and 74 draws later the counter must stand on the step boundary the
// trace recorded, with every object on the reference map's tile.

console.log('\nzone 1, the whole step, live');

const mines1 = new ZoneFill(c, 1).mines();

check('the counter lands on 18566, the step boundary the trace recorded', c.rng.draws === 18566, `${c.rng.draws}`);
check('six mines placed', mines1.length === 6, `${mines1.length}`);

if (hasReference()) {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  // Every reference mine with its position, in file order — placement order.
  const refMines: Array<{ type: string; x: number; y: number }> = [];
  for (const m of xml.matchAll(
    /<Item href="#n:inline\(AdvMapMine\)"[^>]*>\s*<AdvMapMine>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>[\s\S]{0,600}?<Shared href="[^"]*\/([A-Za-z_0-9]+)\.\(AdvMapMineShared\)/g,
  )) {
    refMines.push({ type: m[3]!, x: Number(m[1]), y: Number(m[2]) });
  }
  const zone1Ref = refMines.filter((r) => grid[r.y]![r.x] === 1);
  for (let i = 0; i < Math.min(mines1.length, zone1Ref.length); i++) {
    const ours = mines1[i]!;
    const ref = zone1Ref[i]!;
    check(`mine ${i + 1} is ${ref.type} on the engine's tile`,
      ours.type === ref.type && ours.x === ref.x && ours.y === ref.y,
      `${ours.type} ${ours.x}:${ours.y} vs ${ref.type} ${ref.x}:${ref.y}`);
  }
  // The guards and piles, by the names the draws minted — position and all.
  const posByName = new Map<string, { x: number; y: number }>();
  for (const m of xml.matchAll(/<Item href="#n:inline\(AdvMap\w+\)" id="(item_-?\d+)">\s*<AdvMap\w+>\s*<Pos>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>/g)) {
    posByName.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  let placedRight = 0;
  let total = 0;
  for (const mine of mines1) {
    for (const o of [mine.guard, ...mine.piles]) {
      if (!o) continue;
      total++;
      const ref = posByName.get(o.name);
      if (ref && ref.x === o.x && ref.y === o.y) placedRight++;
    }
  }
  check('every guard and pile stands where its minted name stands in the map',
    placedRight === total && total > 0, `${placedRight} of ${total}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

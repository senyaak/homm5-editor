// The random-town race rule against the engine's own numbers — see
// src/rmg/world-race.ts. Every value here is a line the game's probe wrote
// (`rt seed`, `rt draw`, `rt race`, `rt table`) on 11.09.2026, so this holds
// the port's arithmetic to what the executable computed, not to a reading.
//
//   node tools/test-rmg-world-race.ts

import { RACE } from '../src/rmg/load-template.ts';
import {
  adler32, drawnDwellingRace, drawnTownRace, dwellingWorldRace, nameHash, seededBetween, townWorldRace,
  WORLD_SEED_FIRST,
} from '../src/rmg/world-race.ts';

let failed = 0;
const check = (what: string, got: unknown, want: unknown): void => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what} — got ${String(got)}, want ${String(want)}`);
};

// The seeded draw: twelve `rt draw seed/lo/hi/result` lines.
for (const [seed, want] of [
  [-1246798439, 3], [-1365091504, 1], [-1425974600, 5], [2017344813, 6], [1635711798, 2], [715140806, 4],
  [-1048440705, 2], [924961476, 4], [-1638959874, 7], [422179072, 7], [42633929, 4], [-641050241, 4],
] as const) check(`between(${seed}, 0, 7)`, seededBetween(seed, 0, 7), want);

// The seed: `rt seed first/x/a/b/seed` — four ints through adler32, plus 16.
const le = (v: number): number[] => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0); return [...b]; };
for (const [x, y, h, want] of [
  [117, 55, -1611402778, -1246798439], [101, 29, 1225702965, -1365091504], [48, 56, 1997615889, -1425974600],
  [111, 93, -1568053307, -1281074009],
] as const) {
  check(`adler seed (${x},${y},${h})`, (adler32(0x12345678, [WORLD_SEED_FIRST, x, y, h].flatMap(le)) + 16) | 0, want);
}

// The name hash: the path the temp world addresses a record by, case-folded.
for (const [name, want] of [
  ['item_-1337514376', -1611402778], ['item_2057967587', 1225702965], ['item_104202003', 1997615889],
  ['item_1506628804', -1568053307],
] as const) check(`hash of ${name}'s town path`, nameHash(`/RMGTemp/CurrentMap/map.xdb#xpointer(id(${name})/AdvMapTown)`), want);

// The whole chain, town: three neutral towns of ГСК-023 and one of ГСК-024,
// each `rt race` line's answer.
for (const [name, x, y, want] of [
  ['item_-1337514376', 117, 55, RACE.DUNGEON], ['item_2057967587', 101, 29, RACE.PRESERVE],
  ['item_104202003', 48, 56, RACE.INFERNO], ['item_1506628804', 111, 93, RACE.PRESERVE],
] as const) check(`neutral town ${name} at ${x},${y}`, drawnTownRace(name, x, y), want);

// Owned towns take the player's race, no draw (`rt race` with owner 1 -> 9, 2 -> 3).
check('player 1 town', townWorldRace({ name: 'item_-549808217', x: 60, y: 103, playerNo: 1 }), RACE.DWARF);
check('player 2 town', townWorldRace({ name: 'item_249313776', x: 104, y: 17, playerNo: 2 }), RACE.HEAVEN);

// Dwellings: bound to a town they take its race; townless they draw on two
// ints — ГСК-024's four townless dwellings, whose world lists the anchor probe
// printed (one Dwarven, three not).
check('bound dwelling', dwellingWorldRace({ name: 'item_x' }, RACE.INFERNO), RACE.INFERNO);
check('townless dwelling item_1014433349 (Dwarven list logged)', drawnDwellingRace('item_1014433349'), RACE.DWARF);
for (const name of ['item_409827485', 'item_-281008947', 'item_-119668731']) {
  const race = drawnDwellingRace(name);
  check(`townless dwelling ${name} not Dwarven`, race !== RACE.DWARF, true);
}

console.log(failed ? `\n${failed} FAILED` : '\nall good');
process.exit(failed ? 1 : 0);

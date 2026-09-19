// The races a generation knows — the install's, not a list of eight.
//
// Two things about races were spelt out in the port, and both stopped being
// true the day a faction of ours was installed:
//
//   the names   `RACE_HEAVEN` … `RACE_STRONGHOLD` ↔ 3 … 10, and the town type
//               of each race, were constants (load-template.ts, build.ts). The
//               enum is `types.xml`'s, read through the chain so a mod's copy
//               wins — and a mod's copy has `RACE_TEST = 11` in it, which a
//               template's `<Setting>` may name and a player may pick;
//   the list    the eight a RANDOM player slot draws from, and their count,
//               are read out of the executable (`slotRaceList`, the compiled
//               table at 0x1090E0C and `RaceCount() { return 8; }`). That is
//               what the game's own generator reads too — UNLESS the extension
//               is in, which detours both onto `bin/homm5-editor-races.txt`
//               (native/faction/race-order.c). Then the file is the truth, for
//               the game and so for the port: a slot draws among nine, and a
//               random town's draw (`drawnTownRace`) runs 0 … RaceCount-1 over
//               nine, which lands on the ninth town.
//
// So the enum comes from the data and the list from the file when the
// executable imports the extension, from the executable otherwise. The
// numbers the port names symbolically (`RACE.*`) stay the compiled ones, and
// `runChain` still checks them against the image: a build that renumbers the
// shipped eight would break more than this.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { imports } from '../exe/exe-import.ts';
import { EXTENSION_DLL } from '../mods/extension.ts';
import { RACES_FILE } from '../mods/race-order.ts';
import { readEnumValues } from './data.ts';
import type { DataRoot } from './data.ts';
import { installTables } from './install.ts';
import type { RmgInstall } from './install.ts';
import { RACE } from './load-template.ts';

/** `RACE_*` name → value, out of the install's `types.xml` (a mod's copy wins). */
export function raceByName(data: DataRoot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [value, name] of readEnumValues(data, 'Race')) out[name] = value;
  return out;
}

/**
 * Race value → `TOWN_*` name. `ERace` is a typedef of `ETownType`, value for
 * value (the dwarves' `RACE_DWARF` is `TOWN_FORTRESS`), so the town of a race
 * is the town type with the same number — the three service values have none.
 */
export function townByRace(data: DataRoot): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [value, name] of readEnumValues(data, 'TownType')) {
    if (value >= RACE.HEAVEN) out[value] = name;
  }
  return out;
}

const listCache = new Map<string, readonly number[]>();

/**
 * The list a RANDOM player slot draws from, in the lobby's order — and by its
 * length, `RaceCount()`. The extension's file beside an executable that
 * imports the extension; the compiled table otherwise.
 */
export function slotRaceList(install: RmgInstall): readonly number[] {
  const cached = listCache.get(install.exe);
  if (cached) return cached;
  let list: readonly number[] | null = null;
  const file = join(dirname(install.exe), basename(RACES_FILE));
  if (existsSync(file) && imports(readFileSync(install.exe)).includes(EXTENSION_DLL.toLowerCase())) {
    const rows: number[] = [];
    for (const line of readFileSync(file, 'latin1').split(/\r?\n/)) {
      const m = /^\s*race\s+(\d+)\s/.exec(line);
      if (m) rows.push(Number.parseInt(m[1]!, 10));
    }
    if (rows.length) list = rows;
  }
  list ??= installTables(install).slotRaceList;
  listCache.set(install.exe, list);
  return list;
}

// The executable's side of a faction: four numbers that have to agree with the
// mod's tables, set as one action.
//
//   1. the town type table's ceiling (TownTypesInfo, 11 shipped) — the generic
//      table machinery, registration push and live accessor both;
//   2. the town specialization table's (TownSpecs, 255 shipped) — the same;
//   3. RMGPresetTable's registration push (12 shipped: a row per race and
//      `__RACE_COUNT`) — the push alone. Deliberately no TableSpec for it: it
//      ships no live accessor, and once the town table sits past 11 a
//      value-anchored accessor search for its count would find the TOWN
//      accessor and write the generator's number into it;
//   4. the index → townType clamp at 0xB4E730 — `lea eax,[ecx+3]; cmp ecx,7;
//      jbe; mov eax,2; ret` — which turns the picker's ninth race back into
//      TOWN_NO_TYPE unless the 7 moves with the count.
//
// Nothing else in the executable grows: the type's name, the picker's order
// and the twelfth slot of every jump table are the extension's
// (native/faction/race-order.c) — docs/engineInternals/FACTIONS.md, "the
// twelfth slot".

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATCHED_EXE } from './creature-limit.ts';
import { TOWN_SPEC_TABLE, TOWN_TYPE_TABLE, findLoadSite, setTableLimit } from './table-limit.ts';
import type { TableExeResult, TableSpec } from './table-limit.ts';
import { refuseIfRunning } from '../game/running.ts';
import { SHIPPED_RMG_PRESETS, SHIPPED_TOWN_TYPES } from '../mods/factions.ts';
import { SHIPPED_TOWN_SPECS } from '../mods/town-files.ts';

const RMG_PRESET: TableSpec = {
  what: 'generator presets',
  path: '/GameMechanics/RefTables/RMGPresetTable.xdb',
  shipped: SHIPPED_RMG_PRESETS,
};

/** The clamp's bytes, with the compared count as a hole: `lea eax,[ecx+3]; cmp ecx,N; jbe +5; mov eax,2; ret`. */
const CLAMP_HEAD = Buffer.from('8d410383f9', 'hex');
const CLAMP_TAIL = Buffer.from('7605b802000000c3', 'hex');
/** What the clamp compares against as shipped: the eighth race is index 7. */
const SHIPPED_CLAMP = 7;

export interface FactionExeResult {
  towns: TableExeResult;
  specs: TableExeResult;
  /** The generator's row count, before and after. */
  presets: { from: number; to: number };
  /** The clamp's compared count, before and after. */
  clamp: { from: number; to: number };
}

/**
 * Where the clamp sits: exactly one place, whatever count it holds now.
 * Returns the offset of the count byte.
 */
export function findClamp(buf: Buffer): number {
  let found = -1;
  for (let at = buf.indexOf(CLAMP_HEAD); at >= 0; at = buf.indexOf(CLAMP_HEAD, at + 1)) {
    if (!buf.subarray(at + CLAMP_HEAD.length + 1, at + CLAMP_HEAD.length + 1 + CLAMP_TAIL.length).equals(CLAMP_TAIL)) continue;
    if (found >= 0) throw new Error('index→townType clamp: the signature appears twice');
    found = at + CLAMP_HEAD.length;
  }
  if (found < 0) throw new Error('index→townType clamp: signature not found');
  return found;
}

/**
 * Set every faction-sized number in the executable for `factions` factions
 * carrying `namedTowns` named towns between them. Zero of both puts the
 * shipped numbers back — but only when there is a patched executable to put
 * them back into; a game no mod has touched is left alone.
 */
export function setFactionLimits(gameRoot: string, factions: number, namedTowns: number): FactionExeResult | null {
  const target = join(gameRoot, PATCHED_EXE);
  if (!factions && !existsSync(target)) return null;
  const towns = setTableLimit(gameRoot, TOWN_TYPE_TABLE, SHIPPED_TOWN_TYPES + factions);
  const specs = setTableLimit(gameRoot, TOWN_SPEC_TABLE, SHIPPED_TOWN_SPECS + namedTowns);
  refuseIfRunning(gameRoot, 'cannot set the generator preset count');
  const buf = readFileSync(target);

  const rmg = findLoadSite(buf, RMG_PRESET);
  if (!rmg) throw new Error('RMGPresetTable: load site not found');
  const presetsFrom = rmg.width === 1 ? buf.readUInt8(rmg.at) : buf.readUInt32LE(rmg.at);
  const presetsTo = SHIPPED_RMG_PRESETS + factions;
  if (presetsFrom < SHIPPED_RMG_PRESETS) throw new Error(`RMGPresetTable registers ${presetsFrom}, below the shipped ${SHIPPED_RMG_PRESETS}`);
  if (rmg.width === 1) buf.writeUInt8(presetsTo, rmg.at); else buf.writeUInt32LE(presetsTo, rmg.at);

  const clampAt = findClamp(buf);
  const clampFrom = buf[clampAt]!;
  const clampTo = SHIPPED_CLAMP + factions;
  if (clampFrom < SHIPPED_CLAMP) throw new Error(`index→townType clamp compares against ${clampFrom}, below the shipped ${SHIPPED_CLAMP}`);
  buf[clampAt] = clampTo;

  if (presetsFrom !== presetsTo || clampFrom !== clampTo) {
    const temp = `${target}.new`;
    writeFileSync(temp, buf);
    try {
      renameSync(temp, target);
    } catch (e) {
      try { unlinkSync(temp); } catch { /* the message below is what matters */ }
      throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { towns, specs, presets: { from: presetsFrom, to: presetsTo }, clamp: { from: clampFrom, to: clampTo } };
}

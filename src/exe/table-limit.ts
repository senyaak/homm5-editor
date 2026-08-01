// The size of a reference table, as the executable holds it.
//
// A reference table declares its own size THREE times: `ref_table_num_objs` and
// the `objects` field's `MinElements`/`MaxElements` in types.xml, and once more
// in the executable, where the routine that registers the table by name and path
// pushes the count. types.xml alone is not enough — the artifact ceiling proved
// that the hard way (docs/ARTIFACTS.md): the game READS a longer table and then
// cannot use anything past the compiled count.
//
// WHY THIS MODULE IS GENERIC and creature-limit.ts is not. The creature ceiling
// was found first, by address, on two builds, and it carries a stub patch for
// the random map generator that belongs to creatures alone. What was learned
// after it is that the registration routine has ONE shape for every table:
//
//   mov edx, <the table's path string>     ; "/GameMechanics/RefTables/X.xdb"
//   …copy the path onto the heap…
//   push <count>                           ; the size, imm8 or imm32
//   push …, push …, push <type name>
//   call <register>
//
// So a table is identified by its own path, which is unique in the image, and
// the count is the first `push` after the reference to it. That holds for the
// creature table, the artifact table, the hero class table and the skill table
// alike — checked on all four in the Steam build.
//
// THE ACCESSOR IS NOT PATCHED HERE, and that is deliberate. Twelve one-line
// `mov eax,N; ret` functions sit together at 0xa9ef30…0xa9f330, one per table,
// and creature-limit and artifact-limit both write theirs. Two things say they
// do not matter:
//
//   NOTHING REFERENCES THEM. Not a call, not a jump, not a pointer anywhere in
//     the image — searched for all twelve. They are out-of-line copies of a size
//     that was inlined at every real use.
//   THE VALUE CANNOT IDENTIFY THE TABLE. `mov eax,9; ret` fits the hero class
//     table and the player colour table equally, and both declare 9. Writing the
//     wrong one would retune something that was never asked about.
//
// Patching the registration alone is therefore both sufficient and safe, and the
// probe that proves the first half is a game that starts with a tenth class.
//
// FOUND BY PATTERN, NEVER BY ADDRESS — the discipline the two older ceilings
// arrived at after a build mismatch cost two rounds.

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATCHED_EXE, SHIPPED_EXE } from './creature-limit.ts';

/** A reference table whose size the executable carries. */
export interface TableSpec {
  /** What it is called when something has to be said to a person. */
  what: string;
  /** Its path in the game's data — the anchor the load site is found by. */
  path: string;
  /** The size the game ships, and so what an unpatched executable holds. */
  shipped: number;
}

/** The hero class table: nine, and the tenth is ours. */
export const HERO_CLASS_TABLE: TableSpec = {
  what: 'hero classes',
  path: '/GameMechanics/RefTables/HeroClass.xdb',
  shipped: 9,
};

/** The skill table: every skill, perk and racial ability the game knows. */
export const HERO_SKILL_TABLE: TableSpec = {
  what: 'hero skills',
  path: '/GameMechanics/RefTables/Skills.xdb',
  shipped: 221,
};

/** Where the count sits in the file, and how wide the instruction holds it. */
export interface LoadSite {
  /** File offset of the immediate itself, not of the opcode. */
  at: number;
  width: 1 | 4;
}

/** What an executable says about one table. */
export interface TableReading {
  site: LoadSite | null;
  limit: number | null;
  /** The code section is encrypted — a Steam build that was never unwrapped. */
  wrapped: boolean;
}

/**
 * `push imm8` holds 127 at most.
 *
 * A table registered with the short form cannot be raised past that without
 * lengthening the instruction, which would move everything after it. Nine to ten
 * is nowhere near it; say so anyway rather than truncating in silence.
 */
export const MAX_IMM8 = 127;

/** Where a file offset lives in memory. */
function addressOf(buf: Buffer, fileOffset: number): number | null {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
  const base = buf.readUInt32LE(pe + 0x34);
  const count = buf.readUInt16LE(pe + 6);
  const optionalSize = buf.readUInt16LE(pe + 20);
  const table = pe + 24 + optionalSize;
  for (let i = 0; i < count; i++) {
    const at = table + 40 * i;
    const virtual = buf.readUInt32LE(at + 12);
    const size = buf.readUInt32LE(at + 16);
    const raw = buf.readUInt32LE(at + 20);
    if (fileOffset >= raw && fileOffset < raw + size) return base + virtual + (fileOffset - raw);
  }
  return null;
}

/**
 * The one place this executable holds `table`'s size.
 *
 * Anchored on the table's own path, so it cannot be confused with another
 * table's count: the string occurs once, the reference to it occurs once, and
 * the count is the first push after it. Forty bytes is the shipped distance
 * (thirty-eight for the hero class table, thirty-seven for artifacts, thirty-three
 * for creatures) with room to spare, and stopping short is better than walking
 * into the next call's arguments.
 */
export function findLoadSite(buf: Buffer, table: TableSpec): LoadSite | null {
  const string = buf.indexOf(Buffer.from(`${table.path}\0`, 'latin1'));
  if (string < 0) return null;
  const address = addressOf(buf, string);
  if (address === null) return null;

  const literal = Buffer.alloc(4);
  literal.writeUInt32LE(address >>> 0);
  for (let ref = buf.indexOf(literal); ref >= 0; ref = buf.indexOf(literal, ref + 1)) {
    // Past the four bytes of the address itself: they are data, and a byte of an
    // address that happens to read 6Ah is not a push.
    const to = Math.min(buf.length - 5, ref + 64);
    for (let i = ref + 4; i < to; i++) {
      if (buf[i] === 0x6a) return { at: i + 1, width: 1 };   // push imm8
      if (buf[i] === 0x68) return { at: i + 1, width: 4 };   // push imm32
    }
  }
  return null;
}

/** What the executable currently allows for this table. */
export function readTableLimit(buf: Buffer, table: TableSpec): TableReading {
  const site = findLoadSite(buf, table);
  const wrapped = site === null && buf.indexOf(Buffer.from('.bind', 'latin1')) >= 0;
  if (!site) return { site: null, limit: null, wrapped };
  return {
    site,
    limit: site.width === 1 ? buf.readUInt8(site.at) : buf.readUInt32LE(site.at),
    wrapped,
  };
}

export interface TablePatch {
  data: Buffer;
  from: number;
  to: number;
  /** False when the executable already said this. */
  written: boolean;
}

/**
 * Write `limit` into the one site.
 *
 * The number has to equal what the mod's table actually holds: every id below it
 * must resolve at load or the game stops at startup, which is the same bargain
 * the creature ceiling makes. Re-patching is the normal case — the count changes
 * whenever a class or a skill is added — so any value at or above the shipped one
 * is a legal starting state.
 */
export function patchTableLimit(buf: Buffer, table: TableSpec, limit: number): TablePatch {
  if (!Number.isInteger(limit) || limit < table.shipped) {
    throw new Error(`a ceiling of ${limit} for ${table.what} is below the ${table.shipped} the game ships with`);
  }
  const reading = readTableLimit(buf, table);
  if (!reading.site || reading.limit === null) {
    throw new Error(reading.wrapped
      ? "the executable is wrapped in Steam's DRM, so its code cannot be read or patched"
      : `the ${table.what} count is not where this build should keep it — unknown build`);
  }
  if (reading.site.width === 1 && limit > MAX_IMM8) {
    throw new Error(`this build pushes the ${table.what} count as one byte, so it cannot hold ${limit} (${MAX_IMM8} at most)`);
  }
  const data = Buffer.from(buf);
  if (reading.limit === limit) return { data, from: reading.limit, to: limit, written: false };
  if (reading.site.width === 1) data.writeUInt8(limit, reading.site.at);
  else data.writeUInt32LE(limit, reading.site.at);
  return { data, from: reading.limit, to: limit, written: true };
}

/** What one call to `setTableLimit` did. */
export interface TableExeResult {
  path: string;
  what: string;
  from: number;
  to: number;
  changed: boolean;
  created: boolean;
}

/**
 * Put a table's ceiling at `limit`, in OUR copy of the executable.
 *
 * The shipped one is never written to — that is what makes a mod something you
 * turn off by launching the other file — so the first call copies it. The same
 * bargain, and the same failure to report plainly, as the two older ceilings:
 * a game that is open holds the file, and "cannot write" then means "close it".
 */
export function setTableLimit(gameRoot: string, table: TableSpec, limit: number): TableExeResult {
  const target = join(gameRoot, PATCHED_EXE);
  const shipped = join(gameRoot, SHIPPED_EXE);
  const created = !existsSync(target);
  const source = created ? shipped : target;
  if (!existsSync(source)) throw new Error(`no executable at ${source}`);

  const patch = patchTableLimit(readFileSync(source), table, limit);
  if (!patch.written && !created) {
    return { path: target, what: table.what, from: patch.from, to: patch.to, changed: false, created: false };
  }
  const temp = `${target}.new`;
  writeFileSync(temp, patch.data);
  try {
    renameSync(temp, target);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* the message below is what matters */ }
    throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path: target, what: table.what, from: patch.from, to: patch.to, changed: true, created };
}

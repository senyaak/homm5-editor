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
// A TABLE MAY ALSO HAVE A LIVE COUNT ACCESSOR, and missing it costs a whole
// evening. Twelve one-line `mov eax,N; ret` functions sit together at
// 0xa9ef30…0xa9f330, one per table, and NOTHING in the image references any of
// them — searched for calls, jumps and pointers. That much was measured, and it
// is why the registration alone was patched at first.
//
// It is also why the conclusion "these one-liners are dead" was drawn too wide.
// The skill table has another one, far from that block, at 0xb1ef80, and fifteen
// call sites reach it:
//
//   0x5d1b1b  test ebx,ebx          ; the skill id
//   0x5d1b1d  js   <refuse>
//   0x5d1b23  call 0xb1ef80         ; mov eax,0DDh ; ret   — 221
//   0x5d1b28  cmp  ebx,eax
//   0x5d1b2a  jge  <refuse>
//
// and the rest are `for (i = 0; i < that; i++) skill(i)` loops in the skill
// manager — which is exactly the walk that decides what a level-up may offer. A
// table registered as 225 long whose accessor still says 221 loads fine, shows
// the racial fine (a racial is handed out by class, not looked up by id) and
// silently offers no perk past the shipped ones. That was the bug.
//
// So the accessor is found rather than assumed, and only when it identifies
// itself: a one-liner returning this table's count WITH callers. `mov eax,9;
// ret` fits the hero class table and the player colour table equally — but
// neither is called by anything, so there is nothing to choose between and
// nothing to write. If two live ones ever return the same number, this refuses
// instead of guessing.
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

/** Every section's file range and where it is mapped, read once. */
function mapSections(buf: Buffer): { raw: number; size: number; virtual: number }[] {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return [];
  const base = buf.readUInt32LE(pe + 0x34);
  const count = buf.readUInt16LE(pe + 6);
  const table = pe + 24 + buf.readUInt16LE(pe + 20);
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = table + 40 * i;
    out.push({
      raw: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 16),
      virtual: base + buf.readUInt32LE(at + 12),
    });
  }
  return out;
}

/** An out-of-line `mov eax,N; ret` the code calls to ask how long the table is. */
export interface CountAccessor {
  /** File offset of the immediate, as with a load site. */
  at: number;
  /** Where it lives in memory — worth reporting, since it is how it was found. */
  address: number;
  /** How many `call` sites reach it. Zero means dead, and dead means leave it. */
  callers: number;
}

/**
 * The accessor this table's count is read through, if it has a live one.
 *
 * Several values are looked for — the count the game ships with, the count we are
 * about to write, and whatever the registration says right now — so an executable
 * already patched, or patched only halfway, still finds its own accessor rather
 * than reporting none. Only accessors something calls are considered; the twelve
 * dead copies would otherwise make every table look ambiguous.
 */
export function findCountAccessor(buf: Buffer, table: TableSpec, ...counts: number[]): CountAccessor | null {
  const wanted = new Set([table.shipped, ...counts]);
  const at = mapSections(buf);
  const address = (off: number): number | null => {
    for (const s of at) if (off >= s.raw && off < s.raw + s.size) return s.virtual + (off - s.raw);
    return null;
  };

  // A section's virtual size can run past what the file holds, and the last
  // instruction of a section is as real as the first — so the end is clamped and
  // the bounds are inclusive.
  const ends = new Map(at.map((s) => [s, Math.min(s.raw + s.size, buf.length)]));

  const candidates = new Map<number, number>();   // address -> file offset of the immediate
  for (const s of at) {
    for (let i = s.raw; i <= ends.get(s)! - 9; i++) {
      if (buf[i] !== 0xb8 || !wanted.has(buf.readUInt32LE(i + 1))) continue;
      // A `ret` close behind, which is what makes it an accessor and not the
      // first instruction of something that happens to load the same number.
      if (!buf.subarray(i + 5, i + 9).includes(0xc3)) continue;
      const va = address(i);
      if (va !== null) candidates.set(va, i + 1);
    }
  }
  if (!candidates.size) return null;

  const callers = new Map<number, number>();
  for (const s of at) {
    for (let i = s.raw; i <= ends.get(s)! - 5; i++) {
      if (buf[i] !== 0xe8) continue;
      const from = address(i);
      if (from === null) continue;
      const target = (from + 5 + buf.readInt32LE(i + 1)) >>> 0;
      if (candidates.has(target)) callers.set(target, (callers.get(target) ?? 0) + 1);
    }
  }

  const live = [...callers.keys()];
  if (!live.length) return null;
  if (live.length > 1) {
    throw new Error(`${live.length} live accessors return the ${table.what} count — cannot tell which is this table's`);
  }
  return { at: candidates.get(live[0]!)!, address: live[0]!, callers: callers.get(live[0]!)! };
}

export interface TablePatch {
  data: Buffer;
  from: number;
  to: number;
  /** False when the executable already said this. */
  written: boolean;
  /** The accessor, when this table has a live one and it was retuned too. */
  accessor: CountAccessor | null;
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
  if (reading.site.width === 1) data.writeUInt8(limit, reading.site.at);
  else data.writeUInt32LE(limit, reading.site.at);

  // The registration and the accessor are two independent numbers, and either can
  // already be right — the executable in the install had 225 pushed and 221
  // returned for a day. So both are written, and "written" means either moved.
  const accessor = findCountAccessor(data, table, limit, reading.limit);
  if (accessor) data.writeUInt32LE(limit, accessor.at);

  const written = reading.limit !== limit || (accessor !== null && buf.readUInt32LE(accessor.at) !== limit);
  return { data, from: reading.limit, to: limit, written, accessor };
}

/** What one call to `setTableLimit` did. */
export interface TableExeResult {
  path: string;
  what: string;
  from: number;
  to: number;
  changed: boolean;
  created: boolean;
  /** Where the second number was, when the table keeps one. */
  accessor: number | null;
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
  const accessor = patch.accessor?.address ?? null;
  if (!patch.written && !created) {
    return { path: target, what: table.what, from: patch.from, to: patch.to, changed: false, created: false, accessor };
  }
  const temp = `${target}.new`;
  writeFileSync(temp, patch.data);
  try {
    renameSync(temp, target);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* the message below is what matters */ }
    throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path: target, what: table.what, from: patch.from, to: patch.to, changed: true, created, accessor };
}

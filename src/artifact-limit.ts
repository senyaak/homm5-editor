// The game's artifact ceiling, which is in the executable.
//
// It should not have been. The artifact table declares its own size in
// types.xml — `MinElements` and `MaxElements` on `Table_DBArtifact_ArtifactEffect`
// — and raising both is enough for the game to READ a hundred artifacts out of a
// modded table. It reads them and then cannot use the ones past 97: a hero given
// one has nothing, and one lying on the map cannot be picked up.
//
// That was established the only way it could be — by changing something SHIPPED.
// A probe renamed the Treeborn Quiver inside our copy of the table; the new name
// showed in game and the new artifacts still did not exist. Table read, ids
// past the shipped count invisible. Which leaves the executable.
//
// The two sites mirror the creature ceiling exactly (src/creature-limit.ts), and
// were found the same way:
//
//   the LOAD. Thirty-seven bytes after the code that names
//     `/GameMechanics/RefTables/Artifacts.xdb`, a `push 97` — the count handed
//     to whatever reads the table. The creature one is a `push 180` thirty-three
//     bytes after its own table's name, in a byte-for-byte identical shape.
//   the ACCESSOR. A lone `mov eax, 97; ret`, the function that answers how many
//     artifacts there are.
//
// FOUND BY PATTERN, NOT BY ADDRESS, and that is the point. The Steam build of the
// game is a different compilation from the retail one and shares no offsets with
// it — a lesson from the creature patch that cost two rounds. A search for the
// table's own name, and for the one `mov eax,N; ret` that agrees with it, holds
// on any build where those two shapes survive.

import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATCHED_EXE, SHIPPED_EXE } from './creature-limit.ts';

/** How many artifacts the game ships with, and so what the sites hold unpatched. */
export const ORIGINAL_ARTIFACTS = 97;

/** The path whose reference marks the load site. */
const TABLE_PATH = '/GameMechanics/RefTables/Artifacts.xdb';

/**
 * `push imm8` is two bytes and holds 127 at most.
 *
 * The load site is a `push imm8`, so a ceiling above this cannot be written
 * without lengthening the instruction — which means moving everything after it.
 * Say so rather than silently truncating: 97 to 127 is thirty new artifacts, and
 * anyone who needs more needs a different patch, not a surprise.
 */
export const MAX_IMM8 = 127;

/** One place in the executable that holds the count. */
export interface Site {
  /** File offset of the byte holding the number. */
  at: number;
  /** How wide the immediate is, in bytes. */
  width: 1 | 4;
  what: 'load' | 'accessor';
}

/** What an executable says about its artifact ceiling. */
export interface ArtifactReading {
  sites: Site[];
  /** The value all the sites agree on, or null when they do not. */
  limit: number | null;
  /** True when the code section looks encrypted — a Steam-wrapped executable. */
  wrapped: boolean;
}

/** Little-endian read of `width` bytes. */
const readAt = (buf: Buffer, at: number, width: 1 | 4): number =>
  (width === 1 ? buf.readUInt8(at) : buf.readUInt32LE(at));

/**
 * Where a string sits in memory, from where it sits in the file.
 *
 * The load site does not mention the string — it mentions its ADDRESS, so the
 * section table has to be walked to turn one into the other.
 */
function addressOf(buf: Buffer, fileOffset: number): number | null {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
  const base = buf.readUInt32LE(pe + 0x34);
  const sectionCount = buf.readUInt16LE(pe + 6);
  const optionalSize = buf.readUInt16LE(pe + 20);
  const table = pe + 24 + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    const at = table + 40 * i;
    const virtual = buf.readUInt32LE(at + 12);
    const size = buf.readUInt32LE(at + 16);
    const raw = buf.readUInt32LE(at + 20);
    if (fileOffset >= raw && fileOffset < raw + size) return base + virtual + (fileOffset - raw);
  }
  return null;
}

/** Every offset at which `needle` occurs. */
function findAll(buf: Buffer, needle: Buffer): number[] {
  const out: number[] = [];
  for (let i = buf.indexOf(needle); i >= 0; i = buf.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * Find both sites, or as many as this executable has.
 *
 * The load site is anchored on the table's own name so it cannot be confused
 * with another count. The accessor is anchored on the load site's VALUE: a lone
 * `mov eax, <that number>; ret` is a distinctive six bytes, and requiring it to
 * agree with the load site is what keeps it from matching some unrelated
 * constant that happens to be 97.
 */
export function findArtifactSites(buf: Buffer): Site[] {
  const sites: Site[] = [];
  const string = buf.indexOf(Buffer.from(`${TABLE_PATH}\0`, 'latin1'));
  if (string < 0) return sites;
  const address = addressOf(buf, string);
  if (address === null) return sites;

  const literal = Buffer.alloc(4);
  literal.writeUInt32LE(address >>> 0);
  let value: number | null = null;
  for (const ref of findAll(buf, literal)) {
    // Forward only, and not far: the count is pushed just before the call that
    // takes it. Sixty-four bytes covers the shipped shape twice over.
    const from = ref;
    const to = Math.min(buf.length, ref + 64);
    for (let i = from; i < to - 1; i++) {
      if (buf[i] === 0x6a) {                       // push imm8
        sites.push({ at: i + 1, width: 1, what: 'load' });
        value = buf[i + 1]!;
        break;
      }
      if (buf[i] === 0x68 && i + 5 < to) {         // push imm32
        sites.push({ at: i + 1, width: 4, what: 'load' });
        value = buf.readUInt32LE(i + 1);
        break;
      }
    }
    if (value !== null) break;
  }
  if (value === null) return sites;

  // `mov eax, value; ret` — and it has to be the ONLY one, or we do not know
  // which of them it is.
  //
  // Which is why the sites are remembered once found (see rememberSites): at the
  // shipped 97 that sequence occurs exactly once, but at a round number like 100
  // it occurs four times, so an executable already patched can no longer say
  // where its own accessor is. Finding it and forgetting would mean a second
  // patch moved the load site and left the accessor behind — the two disagreeing
  // is the one state worse than not patching at all.
  const accessor = Buffer.from([0xb8, 0, 0, 0, 0, 0xc3]);
  accessor.writeUInt32LE(value, 1);
  const found = findAll(buf, accessor);
  if (found.length === 1) sites.push({ at: found[0]! + 1, width: 4, what: 'accessor' });
  return sites;
}

/** Where the found offsets are kept, beside the executable they describe. */
export const SITES_FILE = join('bin', 'H5_Game_NCF.artifact-sites.json');

/** Sites read back from the note, checked against the executable in hand. */
function rememberedSites(gameRoot: string, buf: Buffer): Site[] {
  const path = join(gameRoot, SITES_FILE);
  if (!existsSync(path)) return [];
  let noted: Site[];
  try {
    noted = JSON.parse(readFileSync(path, 'utf8')) as Site[];
  } catch { return []; }
  // A note is a hint, never an authority: every offset is re-checked against the
  // opcode that should be in front of it, so a note left over from a different
  // executable is ignored rather than used to write into the middle of a
  // function.
  const ok = noted.filter((s) => {
    if (!Number.isInteger(s.at) || s.at < 1 || s.at + s.width > buf.length) return false;
    const opcode = buf[s.at - 1]!;
    if (s.what === 'accessor') return opcode === 0xb8 && buf[s.at + 4] === 0xc3;
    return s.width === 1 ? opcode === 0x6a : opcode === 0x68;
  });
  return ok.length === noted.length ? ok : [];
}

/** The searched sites, plus any remembered kind the search could not find. */
function merge(found: readonly Site[], noted: readonly Site[]): Site[] {
  const out = [...found];
  for (const n of noted) if (!out.some((s) => s.what === n.what)) out.push(n);
  return out;
}

/** Write the note, so a later patch can find the same places again. */
function rememberSites(gameRoot: string, sites: readonly Site[]): void {
  try {
    writeFileSync(join(gameRoot, SITES_FILE), `${JSON.stringify(sites, null, 2)}\n`);
  } catch { /* a note that cannot be written costs the NEXT patch, not this one */ }
}

/** What this executable currently allows. */
export function readArtifactLimit(buf: Buffer, known?: readonly Site[]): ArtifactReading {
  const sites = known?.length ? [...known] : findArtifactSites(buf);
  const values = new Set(sites.map((s) => readAt(buf, s.at, s.width)));
  // A Steam-wrapped executable has its code encrypted, so the table's name is
  // not in it at all — which is indistinguishable from "not this build" unless
  // it is said separately.
  const wrapped = sites.length === 0 && buf.indexOf(Buffer.from('.bind', 'latin1')) >= 0;
  return { sites, limit: values.size === 1 ? [...values][0]! : null, wrapped };
}

export interface ArtifactPatch {
  data: Buffer;
  from: number;
  to: number;
  /** How many sites were written. Zero means it already said this. */
  written: number;
}

/** Write `limit` into every site. */
export function patchArtifactLimit(buf: Buffer, limit: number, known?: readonly Site[]): ArtifactPatch {
  if (!Number.isInteger(limit) || limit < ORIGINAL_ARTIFACTS) {
    throw new Error(`an artifact ceiling of ${limit} is below the ${ORIGINAL_ARTIFACTS} the game ships with`);
  }
  const reading = readArtifactLimit(buf, known);
  if (reading.sites.length < 2) {
    throw new Error(reading.wrapped
      ? 'the executable is wrapped in Steam\'s DRM, so its code cannot be read or patched'
      : `found ${reading.sites.length} of the 2 places the artifact ceiling is kept — unknown build`);
  }
  if (reading.limit === null) throw new Error('the two artifact ceilings in this executable disagree');
  if (reading.sites.some((s) => s.width === 1) && limit > MAX_IMM8) {
    throw new Error(`this build pushes the count as one byte, so it cannot hold ${limit} (${MAX_IMM8} at most)`);
  }

  const data = Buffer.from(buf);
  let written = 0;
  for (const s of reading.sites) {
    if (readAt(data, s.at, s.width) === limit) continue;
    if (s.width === 1) data.writeUInt8(limit, s.at);
    else data.writeUInt32LE(limit, s.at);
    written++;
  }
  return { data, from: reading.limit, to: limit, written };
}

export interface ArtifactExeResult {
  path: string;
  from: number;
  to: number;
  changed: boolean;
  created: boolean;
}

/**
 * Put the game's artifact ceiling at `limit`.
 *
 * The same file the creature ceiling lives in, and for the same reason: a mod is
 * a thing you turn off by launching the other executable, so the shipped one is
 * never written to.
 */
export function setArtifactLimit(gameRoot: string, limit: number): ArtifactExeResult {
  const target = join(gameRoot, PATCHED_EXE);
  const shipped = join(gameRoot, SHIPPED_EXE);
  const created = !existsSync(target);
  const source = created ? shipped : target;
  if (!existsSync(source)) throw new Error(`no executable at ${source}`);

  const buf = readFileSync(source);
  // Search first — it is the truth about the file. The note only fills in what
  // an already-patched executable can no longer say about itself.
  const found = findArtifactSites(buf);
  const sites = found.length === 2 ? found : merge(found, rememberedSites(gameRoot, buf));
  const patch = patchArtifactLimit(buf, limit, sites);
  if (sites.length === 2) rememberSites(gameRoot, sites);
  if (!patch.written && !created) {
    return { path: target, from: patch.from, to: patch.to, changed: false, created: false };
  }
  const temp = `${target}.new`;
  writeFileSync(temp, patch.data);
  try {
    renameSync(temp, target);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* the message below is what matters */ }
    throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path: target, from: patch.from, to: patch.to, changed: true, created };
}

/** Copy the shipped executable to the patched name, for a first run. */
export function seedFromShipped(gameRoot: string): string {
  const target = join(gameRoot, PATCHED_EXE);
  copyFileSync(join(gameRoot, SHIPPED_EXE), target);
  return target;
}

// The creature ceiling — the one part of a units mod that is not a file.
//
// 180 creatures is compiled into the executable, so a mod that adds an id past
// that is read and silently ignored no matter how right its files are. Two 32-bit
// constants hold the number; writing over them opens the slots.
//
// WHY THIS LIVES IN THE EDITOR and not in whatever project happens to want it:
// nothing here is about any one mod. It is about the game's own executables, the
// same way pak.ts is about the game's own archives. A project passes a number.
//
// THE EDITOR DOES NOT UNWRAP ANYTHING. Steam ships the game with its `.text`
// encrypted and a loader in an extra `.bind` section, and every offset below then
// reads noise. That file is identified and refused, with the reason said plainly —
// removing the wrapper is the owner's business, done once, outside this editor.
// A retail or already-unwrapped executable is patched directly and needs no such
// step.
//
// RE-PATCHING IS THE NORMAL CASE, and the reason this module exists rather than
// the port's one-shot script. A ceiling has to equal the mod's creature count
// EXACTLY — every id below it must resolve at launch or the game will not start —
// so the number changes every time a creature is added or removed. Reading only
// the shipped 180 would mean each change needed a fresh unwrapped copy of the
// executable; instead any recognised ceiling can go to any other, in place, as
// often as the list changes. Patched-to-N is a first-class starting state.
//
// The patch data is checked, never trusted: the identifying bytes must match, the
// count sites must read a plausible ceiling, and the two jump displacements are
// verified against the stub they claim to reach before anything is written.
// docs/NEW_CREATURES.md in the port has the evidence for each offset.

import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { refuseIfRunning } from '../game/running.ts';

/** What the shipped executables count up to. */
export const ORIGINAL_LIMIT = 180;

const hex = (s: string): number[] => s.trim().split(/\s+/).map((b) => parseInt(b, 16));

/** A byte-for-byte code edit: assert `original` is there, write `patched` over it. */
export interface CodePatch {
  offset: number;
  original: number[];
  patched: number[];
}

export interface Build {
  name: string;
  /** Bytes at some fixed offset that tell this build apart from the others. */
  check: { offset: number; bytes: number[] };
  /** Offsets of the 32-bit creature count. */
  limits: number[];
  /**
   * Empty, or a pair: [0] the jump out of a function, [1] the stub it jumps to.
   *
   * The pair only makes the random map generator skip creatures that have no
   * adventure-map visuals; a creature whose `SubjectOfRandomGeneration` is false
   * is already invisible to the generator, so it is not needed to open slots.
   */
  code: CodePatch[];
}

const JUMP_OUT = { original: hex('8B F1'), patched: hex('EB 3B') };
const STUB = {
  original: hex('CC CC CC CC CC CC CC CC CC'),
  patched: hex('83 FF 0C 74 F4 89 CE EB BC'),
};

export const BUILDS: readonly Build[] = [
  {
    // The build Steam ships, once the DRM wrapper is off. Its code is laid out
    // differently from retail below — not one byte of the published offsets
    // applies — so these two were found rather than taken, and each is backed by
    // evidence rather than resemblance:
    //
    //   0x69E3A1 sits in a run of twelve one-line accessors of the form
    //   `mov eax,<n>; ret`, and all twelve return a size that types.xml declares
    //   for some ref table. 180 is the size of exactly one of them, the creature
    //   table.
    //
    //   0xABECD is a `push 180` thirty-three bytes after
    //   `mov edx, "/GameMechanics/RefTables/Creatures.xdb"`, inside the routine
    //   that registers each ref table by name, path and size — the next table it
    //   goes on to register is HeroAttributeDesc.
    //
    // The identifier comes from that registration routine because this build's
    // .text opens with padding, which identifies nothing.
    name: 'H5_Game.exe 3.1 (Steam, unwrapped)',
    check: { offset: 0xabe71, bytes: hex('BA 5C CC F6 00 8D 48 1D 89 4C 24 20 0F 1F 00 8A') },
    limits: [0x69e3a1, 0xabecd],
    code: [],
  },
  {
    // Retail 3.1, which is what the published patch data was made for. Kept
    // because it is the reference the Steam offsets were cross-checked against.
    name: 'H5_Game.exe 3.1 (retail)',
    check: { offset: 0x400, bytes: hex('8D 41 34 C3 CC CC CC CC') },
    limits: [0x6ca781, 0x6e1a20],
    code: [{ offset: 0xe076, ...JUMP_OUT }, { offset: 0xe0b3, ...STUB }],
  },
  {
    name: 'H5_MapEditor.exe 3.1',
    check: { offset: 0x400, bytes: hex('8B 4C 24 04 83 41 04 FF') },
    limits: [0x4b6db1, 0x4cf860],
    code: [{ offset: 0x31f76, ...JUMP_OUT }, { offset: 0x31fb3, ...STUB }],
  },
  {
    // Quantomas' AI build. Not something we use, but the offsets are known and a
    // wrong-build match is the failure this module exists to prevent.
    name: 'H5_Game.exe Quantomas 3.1j',
    check: { offset: 0x400, bytes: hex('56 57 8B 7C 24 0C 57 8B F1 E8 D2 B7 00 00 83 C4') },
    limits: [0x448d41, 0x461340],
    code: [{ offset: 0x51e6, ...JUMP_OUT }, { offset: 0x5223, ...STUB }],
  },
];

const i8 = (b: number): number => (b << 24) >> 24;

/**
 * The two jump displacements are baked into the patch bytes, so they only work if
 * the padding sits a fixed distance from the function. Checking it here turns a
 * silently corrupted executable into a startup error — and it is the one part of
 * the borrowed patch data that can be verified without running anything.
 */
export function checkJumps(b: Build): void {
  if (b.code.length === 0) return;
  if (b.code.length !== 2) throw new Error(`${b.name}: expected a jump and a stub, got ${b.code.length} code patches`);
  const [out, stub] = b.code as [CodePatch, CodePatch];
  const after = out.offset + out.patched.length;
  const lands = after + i8(out.patched[1]!);
  if (lands !== stub.offset) {
    throw new Error(`${b.name}: jump at 0x${out.offset.toString(16)} lands on `
      + `0x${lands.toString(16)}, the stub is at 0x${stub.offset.toString(16)}`);
  }
  const back = stub.offset + stub.patched.length + i8(stub.patched[stub.patched.length - 1]!);
  if (back !== after) {
    throw new Error(`${b.name}: stub returns to 0x${back.toString(16)}, not 0x${after.toString(16)}`);
  }
}
BUILDS.forEach(checkJumps);

export interface Section {
  name: string;
  rawStart: number;
  rawSize: number;
}

/** The PE section table. */
export function sections(buf: Buffer): Section[] {
  const pe = buf.readUInt32LE(0x3c);
  const count = buf.readUInt16LE(pe + 6);
  const table = pe + 24 + buf.readUInt16LE(pe + 20);
  const out: Section[] = [];
  for (let i = 0; i < count; i++) {
    const o = table + i * 40;
    out.push({
      name: buf.toString('ascii', o, o + 8).replace(/\0+$/, ''),
      rawSize: buf.readUInt32LE(o + 16),
      rawStart: buf.readUInt32LE(o + 20),
    });
  }
  return out;
}

export const showBytes = (bytes: readonly number[] | Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** What an executable is, and what it counts to. */
export interface Reading {
  size: number;
  /** Steam's loader section, when the file still has one. Nothing else can be read. */
  wrapped: Section | null;
  build: Build | null;
  /** The ceiling now in the file, when every count site agrees on one. */
  limit: number | null;
  /** True when the generator stub is in place, or the build needs none. */
  stubbed: boolean;
  /** Why this file cannot be patched. Empty when it can. */
  problems: string[];
}

/**
 * A ceiling we are willing to believe is one.
 *
 * Below the shipped 180 is not a ceiling this game ever had, and the upper bound
 * is only there so a random dword — which is what a wrong offset reads — is
 * rejected rather than treated as a ceiling of two billion.
 */
const plausible = (n: number): boolean => n >= ORIGINAL_LIMIT && n <= 1024;

/** Read an executable: which build, what ceiling, and whether it can be patched. */
export function readExe(buf: Buffer): Reading {
  const wrapped = sections(buf).find((s) => s.name === '.bind') ?? null;
  const r: Reading = { size: buf.length, wrapped, build: null, limit: null, stubbed: false, problems: [] };
  if (wrapped) {
    r.problems.push(`wrapped in Steam's DRM: a .bind section at 0x${wrapped.rawStart.toString(16)}`
      + ` (${wrapped.rawSize} bytes), and .text encrypted on disk`);
    return r;
  }

  const build = BUILDS.find((b) =>
    buf.subarray(b.check.offset, b.check.offset + b.check.bytes.length).equals(Buffer.from(b.check.bytes)));
  if (!build) {
    r.problems.push(`unrecognised build — at 0x400: ${showBytes(buf.subarray(0x400, 0x410))}`);
    return r;
  }
  r.build = build;

  // Every count site has to read the same number, and that number is where the
  // file is now: 180 fresh, or whatever a previous patch left. Sites that
  // disagree mean a half-written file, and are the one thing that must not be
  // patched over — the resulting game reports one ceiling and registers another.
  const seen = build.limits.map((o) => buf.readInt32LE(o));
  const agreed = seen.every((n) => n === seen[0]);
  if (!agreed) {
    r.problems.push(`count sites disagree: ${build.limits.map((o, i) =>
      `0x${o.toString(16)}=${seen[i]}`).join(', ')} — this file is half-patched, start from a clean copy`);
  } else if (!plausible(seen[0]!)) {
    r.problems.push(`0x${build.limits[0]!.toString(16)}: ${seen[0]} is not a creature ceiling`
      + ` (expected ${ORIGINAL_LIMIT} or a previous patch)`);
  } else {
    r.limit = seen[0]!;
  }

  // The code patches carry no number, so each is simply in or out — but they go
  // in together, and half of them is a corrupt file rather than a state to fix.
  const states = build.code.map((p) => {
    const there = buf.subarray(p.offset, p.offset + p.original.length);
    if (there.equals(Buffer.from(p.patched))) return 'patched';
    if (there.equals(Buffer.from(p.original))) return 'clean';
    return `0x${p.offset.toString(16)}: expected ${showBytes(p.original)}, found ${showBytes(there)}`;
  });
  const strange = states.filter((s) => s !== 'patched' && s !== 'clean');
  if (strange.length) r.problems.push(...strange);
  else if (states.length && states.some((s) => s !== states[0])) {
    r.problems.push('the generator stub is half-applied — start from a clean copy');
  } else r.stubbed = states.length > 0 && states[0] === 'patched';

  return r;
}

export interface Patch {
  data: Buffer;
  build: Build;
  /** The ceiling the file held before. */
  from: number;
  to: number;
  /** How many bytes were actually rewritten. Zero when it was already there. */
  sites: number;
}

/**
 * Raise (or lower) the ceiling. Returns the new bytes; throws with the reason if
 * the file is one we must not touch.
 *
 * A file already at `limit` comes back unchanged with `sites: 0` rather than as
 * an error — the caller's question is "is the executable at N", and rebuilding a
 * mod whose count has not changed is the ordinary case.
 */
export function patchExe(buf: Buffer, limit: number): Patch {
  if (!Number.isInteger(limit) || limit < ORIGINAL_LIMIT) {
    throw new Error(`a creature ceiling is a whole number of at least ${ORIGINAL_LIMIT}, not ${limit}`);
  }
  const r = readExe(buf);
  if (r.problems.length || !r.build || r.limit === null) {
    throw new Error(`not going to touch this file:\n  ${r.problems.join('\n  ')}`);
  }
  const build = r.build;
  const data = Buffer.from(buf);
  let sites = 0;
  for (const o of build.limits) {
    if (data.readInt32LE(o) === limit) continue;
    data.writeInt32LE(limit, o);
    sites++;
  }
  if (!r.stubbed) {
    for (const p of build.code) {
      Buffer.from(p.patched).copy(data, p.offset);
      sites++;
    }
  }
  return { data, build, from: r.limit, to: limit, sites };
}

/**
 * The copy we patch. Never the file Steam or the installer put there.
 *
 * `_H5E` for Heroes 5 Editor: the copy is ours end to end — our ceilings, our
 * import, our name — so nothing about it pretends to be anybody else's build.
 */
export const PATCHED_EXE = join('bin', 'H5_Game_H5E.exe');
/** The game's own executable — read for a first copy, never written. */
export const SHIPPED_EXE = join('bin', 'H5_Game.exe');

export interface ExeResult {
  /** The file that now holds the ceiling. */
  path: string;
  from: number;
  to: number;
  /** False when it was already there and nothing was written. */
  changed: boolean;
  /** True when this run created the patched copy. */
  created: boolean;
  build: string;
}

/**
 * Put the game's creature ceiling at `limit`, and say what happened.
 *
 * Patches `bin/H5_Game_H5E.exe`, making it from `bin/H5_Game.exe` if it is not
 * there yet and that one can be read. The shipped executable is never written to:
 * a mod is a thing you turn off by launching the other file.
 *
 * Throws when the ceiling cannot be set, and the message says which of the two
 * reasons it is — a wrapped Steam executable (unwrap it once, outside this
 * editor) or an unknown build. It never leaves a half-written executable behind:
 * the new bytes go to a temporary beside the target and are renamed over it.
 */
export function setCreatureLimit(gameRoot: string, limit: number): ExeResult {
  const target = join(gameRoot, PATCHED_EXE);
  const shipped = join(gameRoot, SHIPPED_EXE);
  const created = !existsSync(target);
  const source = created ? shipped : target;
  if (!existsSync(source)) throw new Error(`no executable at ${source}`);
  // Asked before fourteen megabytes are read and written for nothing. The catch
  // around the rename stays as the backstop — the game can be started in the
  // second between this answer and that write — but the ordinary case now says
  // what is wrong before doing any work.
  refuseIfRunning(gameRoot, 'cannot set the creature ceiling');

  const buf = readFileSync(source);
  let patch: Patch;
  try {
    patch = patchExe(buf, limit);
  } catch (e) {
    const r = readExe(buf);
    if (r.wrapped) {
      throw new Error(`${source} is wrapped in Steam's DRM, so its code cannot be read or patched.\n`
        + '  The wrapper has to come off once, outside this editor; then this finds the result at\n'
        + `  ${target} and keeps it up to date by itself.`);
    }
    throw e instanceof Error ? new Error(`${source}: ${e.message}`) : e;
  }

  if (patch.sites === 0 && !created) {
    return { path: target, from: patch.from, to: patch.to, changed: false, created: false, build: patch.build.name };
  }

  // Rename, so an interrupted write cannot leave a game that will not start.
  const temp = `${target}.new`;
  writeFileSync(temp, patch.data);
  try {
    renameSync(temp, target);
  } catch (e) {
    // Windows refuses to replace a running executable, which is exactly what
    // happens when the game is open — say so instead of reporting a rename.
    try { unlinkSync(temp); } catch { /* the message below is what matters */ }
    throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path: target, from: patch.from, to: patch.to, changed: true, created, build: patch.build.name };
}

/** Copy the shipped executable to the patched name without patching it. */
export function seedPatchedExe(gameRoot: string): string {
  const target = join(gameRoot, PATCHED_EXE);
  copyFileSync(join(gameRoot, SHIPPED_EXE), target);
  return target;
}

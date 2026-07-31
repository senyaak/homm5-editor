// Where our build looks for mods: one folder of our own, and nobody else's.
//
// THE FIVE PATTERNS. At startup the game scans `Maps/*.h5m`,
// `DuelPresets/*.h5p`, `UserCampaigns/*.h5c`, `UserMODs/*.h5u` and
// `UserMODs/*.zip`, and mounts everything it finds into the game file system.
// The five sit together in `.rdata` and go into ONE list, handed to ONE provider
// (0x5bd0f0 builds it, 0x953fb0 takes it) — so the kinds are a convention and
// not a mechanism. That is why a `.h5m` can override any path in the game, which
// this editor has relied on for a while: see docs/ENGINE_INTERNALS.md.
//
// WHY MOVE THEM. Everything anyone ever installed for another mod sits in those
// folders, and the game reads all of it, every launch, whatever it contains. Our
// copy of the executable scans `H5E/` instead — our folder, our files — so a
// `.h5m` somebody dropped into `Maps/` or a `.h5u` in `UserMODs/` is simply not
// looked at. The extensions stay what the game has always called them, so a map
// of ours is `H5E/<name>.h5m`. The shipped executable is untouched and still
// reads all five, so launching it is the way back.
//
// THE GAME WRITES TOO. The random map generator saves what it makes to
// `<install>/Maps/<name>.h5m`, and nothing there is mounted any more, so a
// generated map used to vanish the moment the game was closed. That folder is a
// sixth string, patched with the same switch (WRITES below), because where the
// game writes maps and where it looks for them have to be one place.
//
// WHY THIS CAN BE WRITTEN IN PLACE. Each scan pattern is turned into a string
// with strlen at runtime, so what matters is the terminator, not the original
// length. Every replacement is SHORTER than what it replaces; the tail is zeroed
// so no half of the old name is left in the file. Going back writes the longer
// shipped name into the same space it came from.
//
// FOUND BY PATTERN, NOT BY ADDRESS — the same discipline as the two ceilings.
// The literals are unique in the file, so a search for them holds on any build
// where they survive.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATCHED_EXE, SHIPPED_EXE } from '../exe/creature-limit.ts';

/** The folder our build reads, relative to the game root. */
export const MOD_DIR = 'H5E';

/** One path the executable has compiled in, shipped and ours. */
export interface Literal {
  /** What the shipped game has there. */
  shipped: string;
  /** What our copy has instead. */
  ours: string;
  /** What this one is about, for a message. */
  what: string;
}

/**
 * The five patterns, in the order the executable builds them.
 *
 * The extension is what tells one of our files from another at a glance, and
 * every one of them keeps the name the game has always given it — a map of ours
 * is a `.h5m`, the same file the shipped game would have read out of `Maps/`.
 * The game does not care either way, since all five are mounted the same way.
 */
export const MASKS: readonly Literal[] = [
  { shipped: 'Maps/*.h5m', ours: `${MOD_DIR}/*.h5m`, what: 'maps' },
  { shipped: 'DuelPresets/*.h5p', ours: `${MOD_DIR}/*.h5p`, what: 'duel presets' },
  { shipped: 'UserCampaigns/*.h5c', ours: `${MOD_DIR}/*.h5c`, what: 'campaigns' },
  { shipped: 'UserMODs/*.h5u', ours: `${MOD_DIR}/*.h5u`, what: 'mods' },
  { shipped: 'UserMODs/*.zip', ours: `${MOD_DIR}/*.zip`, what: 'mods, zipped' },
];

/**
 * Folders the game itself writes into.
 *
 * Only one so far: the random map generator builds `<install>/` + this + the
 * name it chose + `.h5m`, and it is the only place the game makes a map file of
 * its own accord.
 *
 * THIS ONE CANNOT BE SHORTENED. A scan pattern is measured with strlen, but this
 * string is appended by (begin, end) pointers and copied into static strings
 * whose allocation size is an immediate — three live sites, and every one of
 * them has the length 5 compiled in. Writing `H5E/` here would append the
 * terminator with it and the path would end at the folder. So the replacement is
 * exactly as long as what it replaces, and the spare character is a second
 * separator, which Windows collapses on its way to the file system.
 */
export const WRITES: readonly Literal[] = [
  { shipped: 'Maps/', ours: `${MOD_DIR}//`, what: 'maps the generator makes' },
];

/** Everything the switch writes: what the game reads, and where it writes. */
export const LITERALS: readonly Literal[] = [...MASKS, ...WRITES];

/** What a file of ours is, which is what its extension says. */
export type ModKind = 'map' | 'duel' | 'campaign' | 'mod';

/** The extension each kind gets in our folder. */
export const MOD_EXT: Readonly<Record<ModKind, string>> = {
  map: 'h5m', duel: 'h5p', campaign: 'h5c', mod: 'h5u',
};

/** Our folder in an install. Asking where it is does not make it. */
export function modDir(gameRoot: string): string {
  return join(gameRoot, MOD_DIR);
}

/** The same folder, made if it is not there — for anything about to write. */
export function ensureModDir(gameRoot: string): string {
  const dir = modDir(gameRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Where a map, campaign or mod of ours goes in an install.
 *
 * One place answers this for the editor, the tools and the tests alike, so
 * nothing writes into a folder our build stopped reading.
 */
export function modFile(gameRoot: string, kind: ModKind, stem: string): string {
  return join(modDir(gameRoot), `${stem}.${MOD_EXT[kind]}`);
}

/** Which set of paths an executable is using. */
export type ModPathState = 'shipped' | 'ours' | 'mixed' | 'unknown';

/** One literal found in a file. */
export interface Site {
  literal: Literal;
  /** File offset of the first character. */
  at: number;
  /** Which of the two is written there now. */
  holds: 'shipped' | 'ours';
}

export interface ModPathsReading {
  sites: Site[];
  state: ModPathState;
  /** Literals neither form of which is in the file. */
  missing: Literal[];
}

/**
 * Offsets at which `text` sits as a whole NUL-terminated string.
 *
 * The character in front has to be a terminator or padding, or `Maps/*.h5m`
 * would also match inside a longer string that happens to end with it.
 */
function findStrings(buf: Buffer, text: string): number[] {
  const needle = Buffer.from(`${text}\0`, 'latin1');
  const out: number[] = [];
  for (let i = buf.indexOf(needle); i >= 0; i = buf.indexOf(needle, i + 1)) {
    const before = i === 0 ? 0 : buf[i - 1]!;
    if (before === 0 || before === 0xcc) out.push(i);
  }
  return out;
}

/**
 * Find every literal, in whichever form it currently has.
 *
 * One that occurs twice is not reported at all: writing into one of two
 * indistinguishable places is how a patch half-lands, and half a patch here
 * means the game scans our folder for maps and someone else's for mods.
 */
export function findSites(buf: Buffer): Site[] {
  const sites: Site[] = [];
  for (const literal of LITERALS) {
    const shipped = findStrings(buf, literal.shipped);
    const ours = findStrings(buf, literal.ours);
    if (shipped.length + ours.length !== 1) continue;
    if (shipped.length === 1) sites.push({ literal, at: shipped[0]!, holds: 'shipped' });
    else sites.push({ literal, at: ours[0]!, holds: 'ours' });
  }
  return sites;
}

/** What this executable reads, and where it writes. */
export function readModPaths(buf: Buffer): ModPathsReading {
  const sites = findSites(buf);
  const missing = LITERALS.filter((m) => !sites.some((s) => s.literal === m));
  let state: ModPathState = 'unknown';
  if (sites.length === LITERALS.length) {
    const holds = new Set(sites.map((s) => s.holds));
    state = holds.size === 1 ? [...holds][0]! : 'mixed';
  }
  return { sites, state, missing };
}

export interface ModPathsPatch {
  data: Buffer;
  /** How many literals were written. Zero means it already said this. */
  written: number;
}

/**
 * Write one set of paths over the other.
 *
 * All six or none: a build that is missing one of them is a build this does not
 * know, and rewriting the five it does recognise would leave the game reading a
 * stranger's folder for the sixth.
 */
export function patchModPaths(buf: Buffer, to: 'ours' | 'shipped'): ModPathsPatch {
  const reading = readModPaths(buf);
  if (reading.missing.length) {
    throw new Error('this executable does not hold the paths the game keeps its mods at'
      + ` (missing ${reading.missing.map((m) => m.shipped).join(', ')}) — unknown build`);
  }

  const data = Buffer.from(buf);
  let written = 0;
  for (const site of reading.sites) {
    if (site.holds === to) continue;
    const text = to === 'ours' ? site.literal.ours : site.literal.shipped;
    // The space is what the shipped name needed, and nothing here may grow past
    // it — the next string starts right after.
    const room = site.literal.shipped.length + 1;
    if (text.length + 1 > room) throw new Error(`"${text}" does not fit where "${site.literal.shipped}" was`);
    data.fill(0, site.at, site.at + room);
    data.write(text, site.at, 'latin1');
    written++;
  }
  return { data, written };
}

export interface ModPathsResult {
  path: string;
  state: ModPathState;
  changed: boolean;
  /** The folder our build reads, once it is the one being read. */
  dir: string;
}

/**
 * Point our copy of the executable at our folder, or back at the shipped ones.
 *
 * The copy has to exist already: this is a change to a build that is ours, not a
 * reason to make one. `npm run unwrap-exe` makes it.
 */
export function setModPaths(gameRoot: string, to: 'ours' | 'shipped'): ModPathsResult {
  const target = join(gameRoot, PATCHED_EXE);
  if (!existsSync(target)) {
    throw new Error(`no ${PATCHED_EXE} — run "npm run unwrap-exe" to make one from ${SHIPPED_EXE}`);
  }
  const patch = patchModPaths(readFileSync(target), to);
  const dir = to === 'ours' ? ensureModDir(gameRoot) : modDir(gameRoot);
  if (!patch.written) return { path: target, state: to, changed: false, dir };

  const temp = `${target}.new`;
  writeFileSync(temp, patch.data);
  try {
    renameSync(temp, target);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* the message below is what matters */ }
    throw new Error(`cannot write ${target} — close the game first (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path: target, state: to, changed: true, dir };
}

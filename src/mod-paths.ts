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
// looked at. Maps of ours are `H5E/*.mod`. The shipped executable is untouched
// and still reads all five, so launching it is the way back.
//
// WHY THIS CAN BE WRITTEN IN PLACE. Each pattern is turned into a string with
// strlen at runtime, so what matters is the terminator, not the original length.
// Every replacement here is SHORTER than what it replaces; the tail is zeroed so
// no half of the old name is left in the file. Going back writes the longer
// shipped name into the same space it came from.
//
// FOUND BY PATTERN, NOT BY ADDRESS — the same discipline as the two ceilings.
// The literals are unique in the file, so a search for them holds on any build
// where they survive.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATCHED_EXE, SHIPPED_EXE } from './creature-limit.ts';

/** The folder our build reads, relative to the game root. */
export const MOD_DIR = 'H5E';

/** One thing the game scans for, shipped and ours. */
export interface Mask {
  /** The pattern the shipped game scans. */
  shipped: string;
  /** The pattern our copy scans instead. */
  ours: string;
  /** What this kind carries, for a message. */
  what: string;
}

/**
 * The five, in the order the executable builds them.
 *
 * The extension is what tells one of our files from another at a glance; the
 * game does not care, since all five are mounted the same way. Maps get `.mod`
 * because that is the one anybody will type.
 */
export const MASKS: readonly Mask[] = [
  { shipped: 'Maps/*.h5m', ours: `${MOD_DIR}/*.mod`, what: 'maps' },
  { shipped: 'DuelPresets/*.h5p', ours: `${MOD_DIR}/*.h5p`, what: 'duel presets' },
  { shipped: 'UserCampaigns/*.h5c', ours: `${MOD_DIR}/*.h5c`, what: 'campaigns' },
  { shipped: 'UserMODs/*.h5u', ours: `${MOD_DIR}/*.h5u`, what: 'mods' },
  { shipped: 'UserMODs/*.zip', ours: `${MOD_DIR}/*.zip`, what: 'mods, zipped' },
];

/** Which set of patterns an executable is scanning. */
export type ModPathState = 'shipped' | 'ours' | 'mixed' | 'unknown';

/** One pattern found in a file. */
export interface MaskSite {
  mask: Mask;
  /** File offset of the first character. */
  at: number;
  /** Which of the two is written there now. */
  holds: 'shipped' | 'ours';
}

export interface ModPathsReading {
  sites: MaskSite[];
  state: ModPathState;
  /** Patterns neither form of which is in the file. */
  missing: Mask[];
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
 * Find every pattern, in whichever form it currently has.
 *
 * A pattern that occurs twice is not reported at all: writing into one of two
 * indistinguishable places is how a patch half-lands, and half a patch here
 * means the game scans our folder for maps and someone else's for mods.
 */
export function findMaskSites(buf: Buffer): MaskSite[] {
  const sites: MaskSite[] = [];
  for (const mask of MASKS) {
    const shipped = findStrings(buf, mask.shipped);
    const ours = findStrings(buf, mask.ours);
    if (shipped.length + ours.length !== 1) continue;
    if (shipped.length === 1) sites.push({ mask, at: shipped[0]!, holds: 'shipped' });
    else sites.push({ mask, at: ours[0]!, holds: 'ours' });
  }
  return sites;
}

/** What this executable scans. */
export function readModPaths(buf: Buffer): ModPathsReading {
  const sites = findMaskSites(buf);
  const missing = MASKS.filter((m) => !sites.some((s) => s.mask === m));
  let state: ModPathState = 'unknown';
  if (sites.length === MASKS.length) {
    const holds = new Set(sites.map((s) => s.holds));
    state = holds.size === 1 ? [...holds][0]! : 'mixed';
  }
  return { sites, state, missing };
}

export interface ModPathsPatch {
  data: Buffer;
  /** How many patterns were written. Zero means it already said this. */
  written: number;
}

/**
 * Write one set of patterns over the other.
 *
 * All five or none: a build that is missing one of them is a build this does not
 * know, and rewriting the four it does recognise would leave the game reading a
 * stranger's folder for the fifth.
 */
export function patchModPaths(buf: Buffer, to: 'ours' | 'shipped'): ModPathsPatch {
  const reading = readModPaths(buf);
  if (reading.missing.length) {
    throw new Error('this executable does not hold the patterns the game scans for mods'
      + ` (missing ${reading.missing.map((m) => m.shipped).join(', ')}) — unknown build`);
  }

  const data = Buffer.from(buf);
  let written = 0;
  for (const site of reading.sites) {
    if (site.holds === to) continue;
    const text = to === 'ours' ? site.mask.ours : site.mask.shipped;
    // The space is what the shipped name needed, and nothing here may grow past
    // it — the next string starts right after.
    const room = site.mask.shipped.length + 1;
    if (text.length + 1 > room) throw new Error(`"${text}" does not fit where "${site.mask.shipped}" was`);
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
  const dir = join(gameRoot, MOD_DIR);
  if (to === 'ours') mkdirSync(dir, { recursive: true });
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

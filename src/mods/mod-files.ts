// What a build reads, and what it produces.
//
// Nothing here touches the filesystem on its own: a DataReader supplies the
// game's data and a build hands back a file set, so the same code serves a
// project folder, an archive and a test. Everything the layers above share —
// the archive's name, its manifest, the two must-read wrappers — lives here so
// that no builder has to import another builder for it.

import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';


/**
 * The mod's file name stem — `homm5-editor.h5u` in UserMODs.
 *
 * Named after the editor, not after any one project, because there can only be
 * ONE of it: creatures and artifacts both extend reference tables declared in
 * `types.xml`, a mod replaces a file whole rather than merging it, and the
 * executable's ceilings count what that one copy holds. So this archive is
 * every global thing the editor adds, whatever the map or campaign it was added
 * for. A project's own content that costs the game nothing global — dwellings
 * and other plain objects — can and should ship in its own archive beside it.
 */
export const MOD_STEM = 'homm5-editor';

/**
 * Our own record of the mod, shipped inside it.
 *
 * The mod is readable without this — ids come out of types.xml's name→number map
 * and stats out of the inline objects — but provenance does not survive that trip.
 * Which shipped model a creature borrowed is the thing you need to re-copy its
 * art or swap it, and nothing in the game's own formats records it.
 */
export const MOD_MANIFEST = 'units.json';

// --- reading the game's data --------------------------------------------------

/** Raw bytes of a data path, or null when there is no such file. */
export type DataReader = (rel: string) => Buffer | null;

/** A reader over an unpacked data root. */
export function dataReader(root: string): DataReader {
  return (rel) => {
    const p = join(root, rel);
    try {
      return statSync(p).isFile() ? readFileSync(p) : null;
    } catch {
      return null;
    }
  };
}

// --- building the mod ---------------------------------------------------------

/** A file in the built mod. */
export interface ModFile {
  path: string;
  data: Buffer;
}

/** What a build produced, and what it had to leave out. */
export interface BuildReport {
  files: ModFile[];
  /** The ceiling the executable must be patched to. */
  limit: number;
  /** Art files copied, per creature. */
  art: Record<string, number>;
  /** References we could not resolve — authoring paths, mostly, and harmless. */
  missing: string[];
}

/** Read a data file that has to be there. */
export function mustRead(read: DataReader, rel: string): string {
  return mustReadBytes(read, rel).toString('latin1');
}

/** The same, for the files that are not text — a geometry's binary. */
export function mustReadBytes(read: DataReader, rel: string): Buffer {
  const data = read(rel);
  if (!data) throw new Error(`the game's data has no ${rel} — is the data root unpacked?`);
  return data;
}

/** The game's text files: UTF-16 LE with a byte-order mark and no trailing newline. */
export function utf16(s: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
}


/** The game's files a mod has to edit, all three of them. */
export const TYPES = 'types.xml';
export const REF_TABLE = 'GameMechanics/RefTables/Creatures.xdb';
export const UI_ROOT = 'UI/UIGameRoot.(UIGameRoot).xdb';

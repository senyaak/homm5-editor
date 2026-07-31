// Unpack the game's .pak archives into one data root — the tree the editor reads.
//
// The editor resolves models, textures, tiles and rosters against a single
// unpacked folder. The game keeps them in half a dozen archives that overlay
// each other, so the folder has to be their union, applied in the order the
// game applies them: the addon's files win over the base game's.
//
// Why unpack rather than read the paks directly: unpacked IS the working form.
// Modding means editing these files and shipping only what you changed, so the
// tree you edit against is the tree you diff against.
//
// This lives in src/ rather than in the CLI because two callers need it: the
// `unpack-data` script, and the packaged editor's first-run setup, which has no
// repo around it and no terminal to run a script in.

import { openSync, closeSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readIndex, readEntryFrom } from '../format/pak.ts';

/** How one archive turned out. */
export interface PakReport {
  /** The archive's file name. */
  pak: string;
  /** Members it holds. */
  members: number;
  /** Files it created. */
  written: number;
  /** Files it overwrote — its version of something an earlier archive had. */
  replaced: number;
  /** Files already byte-identical on disk. */
  unchanged: number;
  /** Members that could not be read or written. */
  failed: number;
}

/** Totals over every archive, plus the per-archive breakdown. */
export interface UnpackReport {
  written: number;
  replaced: number;
  unchanged: number;
  failed: number;
  paks: PakReport[];
}

/** Where the run has got to — yielded once per member, cheap enough to drive a bar. */
export interface UnpackProgress {
  /** Archive being read. */
  pak: string;
  /** 1-based index of this archive in the run. */
  pakIndex: number;
  /** Archives in the run. */
  pakCount: number;
  /** Members done in this archive. */
  done: number;
  /** Members in this archive. */
  total: number;
}

export interface UnpackOptions {
  /** Write nothing; just report what would move. */
  dry?: boolean;
  /** Write every member, even when the bytes on disk already match. */
  force?: boolean;
  /** Called for a member that could not be read or written, before it is counted. */
  onError?: (member: string, err: unknown) => void;
}

/**
 * Archive priority, lowest first — later archives overwrite earlier ones.
 *
 * The ToE addon's paks (a2p1-*) go last: they carry the expansion's own content
 * (the random-map generator's tiles, its UI, its campaigns) and updated versions
 * of what the base game shipped. Anything the list does not name is applied
 * before them, alphabetically, so a mod pak dropped into data/ still lands.
 */
const LAST = /^a2p1-/i;

/** Sort archive names into the order the game applies them. */
export function pakOrder(names: string[]): string[] {
  const base = names.filter((n) => !LAST.test(n)).sort();
  const addon = names.filter((n) => LAST.test(n)).sort();
  return [...base, ...addon];
}

/** The archives in a game's data folder, in application order. */
export function listPaks(dataDir: string): string[] {
  return pakOrder(readdirSync(dataDir).filter((f) => /\.pak$/i.test(f)));
}

/**
 * Merge every archive in `<gameDir>/data` into `outDir`, one member per step.
 *
 * A generator rather than a plain loop because the same work has two callers
 * with opposite needs: a CLI that wants it to run flat out, and the editor's
 * setup window, whose main process must keep pumping window messages or Windows
 * paints the whole app as hung. Yielding lets the second one breathe without
 * forking a second copy of the logic.
 *
 * Members are decompressed one at a time (data.pak alone is 1.4 GB), and a file
 * whose bytes are already on disk is left alone, so re-running is cheap and
 * only reports what actually moved.
 *
 * Throws when the game folder has no data/ or no archives in it — those are the
 * caller's mistake, not a per-file failure to be counted and shrugged off.
 *
 * Abandoning the generator mid-run leaks the open archive handle unless the
 * caller closes it (`for..of` and `.return()` both do; dropping the iterator on
 * the floor does not).
 */
export function* unpackSteps(
  gameDir: string,
  outDir: string,
  opt: UnpackOptions = {},
): Generator<UnpackProgress, UnpackReport, void> {
  const dataDir = join(gameDir, 'data');
  if (!existsSync(dataDir)) throw new Error(`no data folder at ${dataDir}`);
  const paks = listPaks(dataDir);
  if (!paks.length) throw new Error(`no .pak files in ${dataDir}`);

  const report: UnpackReport = { written: 0, replaced: 0, unchanged: 0, failed: 0, paks: [] };

  for (const [i, pak] of paks.entries()) {
    const path = join(dataDir, pak);
    const fd = openSync(path, 'r');
    try {
      const index = readIndex(fd, statSync(path).size);
      const one: PakReport = { pak, members: index.length, written: 0, replaced: 0, unchanged: 0, failed: 0 };
      for (const [n, e] of index.entries()) {
        const dest = join(outDir, e.name);
        try {
          const had = existsSync(dest);
          // Comparing before writing keeps a re-run quiet and, more usefully, makes
          // the report say what an archive actually changed rather than how many
          // files it contains.
          const same = had && !opt.force && statSync(dest).size === e.size
            && readFileSync(dest).equals(readEntryFrom(fd, e));
          if (same) {
            one.unchanged++;
          } else {
            if (!opt.dry) {
              mkdirSync(dirname(dest), { recursive: true });
              writeFileSync(dest, readEntryFrom(fd, e));
            }
            if (had) one.replaced++; else one.written++;
          }
        } catch (err) {
          one.failed++;
          opt.onError?.(e.name, err);
        }
        yield { pak, pakIndex: i + 1, pakCount: paks.length, done: n + 1, total: index.length };
      }
      report.written += one.written;
      report.replaced += one.replaced;
      report.unchanged += one.unchanged;
      report.failed += one.failed;
      report.paks.push(one);
    } finally {
      closeSync(fd);
    }
  }
  return report;
}

/** Run the whole unpack without stopping. What the CLI wants. */
export function unpackData(gameDir: string, outDir: string, opt: UnpackOptions = {}): UnpackReport {
  const steps = unpackSteps(gameDir, outDir, opt);
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
  }
}

/**
 * Does this folder look like an unpacked data root?
 *
 * The two markers are what the scene builder actually needs: object definitions
 * and the geometry they point at. A folder with neither is not going to load a
 * map, whatever else is in it.
 */
export function looksLikeDataRoot(dir: string): boolean {
  return existsSync(join(dir, 'MapObjects')) || existsSync(join(dir, 'bin', 'Geometries'));
}

/**
 * Does this folder look like a Heroes 5 install?
 *
 * data/ holding at least one .pak — the archives are the thing we unpack, and
 * their absence is the one failure worth catching before a long operation.
 */
export function looksLikeGameFolder(dir: string): boolean {
  const data = join(dir, 'data');
  try {
    return existsSync(data) && readdirSync(data).some((f) => /\.pak$/i.test(f));
  } catch {
    return false;
  }
}

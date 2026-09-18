// A file of our own, on disk, read as though it were the game's.
//
// Everything a faction takes from the game is named by a data path and read
// through a DataReader, and the copier walks the document's hrefs from there.
// A model of our own — a folder on disk with a `Model` document, its
// geometry document beside it and the binaries under `bin/…` the way the
// game keys them — is the same thing from a different root. So it is
// MOUNTED: the file's folder becomes a data root of its own, seen under
// `own/<folder>/…`, and a reader that looks there first — for the mounted
// files by their mounted path, and for anything else (`bin/Geometries/<uid>`,
// an absolute `/Textures/…` href) by the same path under the folder — before
// falling back to the game's data. The copier then does for it exactly what
// it does for a donor's: walk, copy under the faction, fresh uids, hrefs
// repointed. Nothing downstream knows the difference.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DataReader } from './mod-files.ts';

/** A path on disk rather than in the data: a drive letter or a UNC root. */
export function isOwnFile(source: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(source) || /^[\\/]{2}/.test(source);
}

/** Where a mounted folder is seen from inside the data. */
export function ownMountPrefix(file: string): string {
  return `own/${basename(dirname(file)).replace(/[^A-Za-z0-9_.-]+/g, '_')}`;
}

/**
 * Mount the file's folder over `read`. Returns the reader that sees it and
 * the data path the file is seen at — what to hand the copier instead of
 * the disk path.
 */
export function mountOwn(read: DataReader, file: string): { read: DataReader; rel: string } {
  if (!isOwnFile(file)) throw new Error(`${file} is not a file on disk`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${file}: no such file`);
  const root = dirname(file);
  const prefix = ownMountPrefix(file);
  const fromDisk = (p: string): Buffer | null => {
    try {
      return statSync(p).isFile() ? readFileSync(p) : null;
    } catch {
      return null;
    }
  };
  const mounted: DataReader = (rel) => {
    const under = rel.startsWith(`${prefix}/`) ? rel.slice(prefix.length + 1) : rel;
    // The folder first, by the mounted path or by the plain one; the game's data after.
    return fromDisk(join(root, under)) ?? (under === rel ? read(rel) : null);
  };
  return { read: mounted, rel: `${prefix}/${basename(file)}` };
}

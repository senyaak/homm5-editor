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

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { copyArt } from './mod-art.ts';
import { modDir } from '../game/mod-paths.ts';
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
export function mountOwn(read: DataReader, file: string): { read: DataReader; rel: string; local: DataReader } {
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
  // The folder alone, by the mounted path or by the plain one.
  const local: DataReader = (rel) => {
    const under = rel.startsWith(`${prefix}/`) ? rel.slice(prefix.length + 1) : rel;
    return fromDisk(join(root, under));
  };
  // The folder first; the game's data after — but never for a mounted path,
  // which is the folder's or nobody's.
  const mounted: DataReader = (rel) => local(rel) ?? (rel.startsWith(`${prefix}/`) ? null : read(rel));
  return { read: mounted, rel: `${prefix}/${basename(file)}`, local };
}

// --- taking a file in -----------------------------------------------------------
//
// A file of the author's own is COPIED INTO THE MOD FIRST, and only the copy
// is ever worked from (Senya, 2026-10-09). The manifest used to keep the path
// the author picked, and every rebuild — any install of anything, since an
// install rebuilds the whole mod — read it from there again: a folder moved
// or deleted a week later, and adding a creature failed on a model nobody
// remembered. So before every build each such path in the manifest is taken
// in: copied under `<mod folder>/sources/`, and the manifest rewritten to name
// the copy. A path already there is left as it is.
//
// A MODEL is a folder, not a file — its geometry document beside it, the
// binaries under `bin/…` — so what is taken in is what the copier reaches
// from it inside that folder, walked exactly as the build walks it, and laid
// out under a folder of the same name, so the mod's own paths (`own/<folder>/…`)
// do not change. Anything else is the one file.

/** The folder under the mod folder the taken-in copies live in. */
export const SOURCES_DIR = 'sources';

/** Where an install keeps them: `<game>/H5E/sources`. */
export const modSourcesDir = (gameRoot: string): string => join(modDir(gameRoot), SOURCES_DIR);

/** What taking files in did: which paths it copied, and what it threw away. */
export interface Intake {
  /** Original path → the copy the manifest names now. */
  copied: Map<string, string>;
  /** Entries of the store nothing in the manifest names any more, removed. */
  pruned: string[];
}

const inside = (path: string, dir: string): boolean => {
  const r = relative(resolve(dir), resolve(path));
  return !!r && !r.startsWith('..') && !/^[A-Za-z]:/.test(r);
};

/**
 * Copy every file of the author's own that `manifest` names into `store`, and
 * point the manifest at the copies — in place. Then drop whatever the store
 * holds that the manifest no longer names, so a removed faction's model does
 * not live on in it.
 *
 * Any string in the manifest that is an absolute path to an existing file is
 * one: the walk is over the whole manifest rather than a list of fields, so a
 * field added tomorrow is taken in without this changing. A path that names
 * nothing is left alone, for the build to refuse with the field's own words.
 */
export function intakeOwnFiles(manifest: object, store: string): Intake {
  const copied = new Map<string, string>();
  const named = new Set<string>();
  const take = (path: string): string => {
    if (inside(path, store)) {
      named.add(relative(store, path).split(sep)[0]!);
      return path;
    }
    if (!existsSync(path) || !statSync(path).isFile()) return path;
    const done = copied.get(path);
    if (done) return done;
    const id = createHash('sha1').update(resolve(path).toLowerCase()).digest('hex').slice(0, 12);
    const home = join(store, id);
    // Taken in afresh: the same original picked again is the author's way of
    // saying it changed.
    rmSync(home, { recursive: true, force: true });
    let to: string;
    if (/\.xdb$/i.test(path)) {
      const folder = basename(dirname(path));
      const m = mountOwn(() => null, path);
      const reached = new Set<string>();
      const prefix = `${ownMountPrefix(path)}/`;
      const local: DataReader = (rel) => {
        const data = m.local(rel);
        if (data) reached.add(rel.startsWith(prefix) ? rel.slice(prefix.length) : rel);
        return data;
      };
      copyArt([m.rel], 'intake', local, 'intake');
      for (const rel of reached) {
        const target = join(home, folder, ...rel.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(dirname(path), ...rel.split('/')), target);
      }
      to = join(home, folder, basename(path));
    } else {
      mkdirSync(home, { recursive: true });
      to = join(home, basename(path));
      copyFileSync(path, to);
    }
    copied.set(path, to);
    named.add(id);
    return to;
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return isOwnFile(node) ? take(node) : node;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = walk(node[i]);
      return node;
    }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
    }
    return node;
  };
  walk(manifest);
  const pruned: string[] = [];
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (named.has(entry)) continue;
      rmSync(join(store, entry), { recursive: true, force: true });
      pruned.push(entry);
    }
  }
  return { copied, pruned };
}

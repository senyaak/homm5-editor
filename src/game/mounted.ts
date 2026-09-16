// The install as the GAME mounts it — every archive in `<game>/H5E/`, over the
// unpacked data.
//
// `mountedAssets` in electron/paths.ts mounts the creature mods and nothing
// else, on the theory that a mod which only replaces a texture changes nothing
// the editor has to resolve. The random map generator is the counter-example:
// it reads the preset table, the templates, the tile documents, every shared
// document it places and the whole creature roster, and a mod that overrides
// any one of them changes the map that comes out. So this mounts what the
// executable mounts — the five masks of `MASKS`, one list — and resolves a path
// the way the executable does (docs/ARCHIVES.md, "Which copy wins"):
//
//   - the NEWEST member wins among archives carrying the same path, whatever
//     the archive is called or how the folder lists it;
//   - a member stamped at the ZIP epoch is read and ignored — an archive can
//     be mounted, correct, and without effect;
//   - the archives sit over `data/*.pak`, which the unpacked root already
//     merged in pak order.
//
// Paths compare without case, as the engine's do. The archives are unpacked
// into a cache, one folder each (`unpackCached`), so a resolved path is still
// a real file and the DDS decoder keeps taking a filename.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readIndex } from '../format/pak.ts';
import { unpackCached } from '../mods/mod-archive.ts';
import { MASKS, MOD_DIR } from './mod-paths.ts';
import type { Assets } from './assets.ts';

/** `H5E/*.h5m` → `.h5m` — the extensions the executable's five masks name. */
const EXTENSIONS = new Set(MASKS.map((m) => m.ours.slice(m.ours.lastIndexOf('.')).toLowerCase()));

/** The DOS stamp of 1980-01-01 00:00 — what a ZIP writer puts on a member it did not date. */
const ZIP_EPOCH = 0x0021_0000;

const key = (rel: string): string => rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

/** The archives the executable would mount from `<gameRoot>/H5E/`, in folder order. */
export function mountableArchives(gameRoot: string): string[] {
  const dir = join(gameRoot, MOD_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => EXTENSIONS.has(name.slice(name.lastIndexOf('.')).toLowerCase()))
    .sort()
    .map((name) => join(dir, name));
}

interface Winner {
  root: string;
  rel: string;
  stamp: number;
}

/**
 * An archive's index, read once per (size, mtime): the editor mounts the
 * chain on every generator call and every palette scan, and re-reading
 * thirty central directories each time was two seconds of a frozen window
 * (the main process reads them, and the window waits on the main process).
 */
const indexCache = new Map<string, { stamp: string; entries: ReturnType<typeof readIndex> }>();

function cachedIndex(archive: string): ReturnType<typeof readIndex> {
  const st = statSync(archive);
  const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
  const have = indexCache.get(archive);
  if (have && have.stamp === stamp) return have.entries;
  const fd = openSync(archive, 'r');
  try {
    const entries = readIndex(fd, st.size);
    indexCache.set(archive, { stamp, entries });
    return entries;
  } finally {
    closeSync(fd);
  }
}

/**
 * The chain the game reads: the mounted archives, newest member first, over
 * `base` (the unpacked data). `cacheDir` holds one unpacked folder per archive.
 */
export function mountArchives(gameRoot: string, cacheDir: string, base: string): Assets {
  const winners = new Map<string, Winner>();
  const roots: string[] = [];
  for (const archive of mountableArchives(gameRoot)) {
    let entries;
    try {
      entries = cachedIndex(archive);
    } catch {
      continue; // not an archive the engine could read either
    }
    const root = unpackCached(archive, cacheDir);
    roots.push(root);
    for (const e of entries) {
      if (e.stamp <= ZIP_EPOCH) continue;
      const k = key(e.name);
      const have = winners.get(k);
      if (!have || e.stamp > have.stamp) winners.set(k, { root, rel: e.name.replace(/\\/g, '/'), stamp: e.stamp });
    }
  }
  const chain = [...roots, base];

  const found = (rel: string): string | null => {
    const w = winners.get(key(rel));
    if (w) return join(w.root, w.rel);
    const p = join(base, rel);
    try {
      if (statSync(p).isFile()) return p;
    } catch { /* not in the data either */ }
    return null;
  };

  return {
    roots: chain,
    path: (rel) => found(rel) ?? join(base, rel),
    exists: (rel) => found(rel) !== null,
    text: (rel, encoding = 'utf8') => {
      const p = found(rel);
      return p ? readFileSync(p, encoding) : null;
    },
    bytes: (rel) => {
      const p = found(rel);
      return p ? readFileSync(p) : null;
    },
    all: (rel) => chain.map((root) => join(root, rel)).filter((p) => existsSync(p)),
    dirs: (rel) => chain.map((root) => join(root, rel)).filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    }),
  };
}

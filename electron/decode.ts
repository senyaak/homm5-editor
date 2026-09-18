// A map's models: from the cache when they are there, from the decode
// processes when they are not (src/scene/geom-cache.ts, geom-jobs.ts).
//
// The main process reads the map, lists the shared hrefs it places, and asks
// here; what comes back is what `buildScene` places without decoding. An
// entry is taken when it exists for this decoder version and every file it
// was made from still resolves and stats the same; the rest is decoded in
// parallel and read back. What fails to decode is reported and left to the
// build, which decodes it in this process or skips the object, as it always
// has.
//
// "Read back" is the entry's HEADER: the geoms handed on carry their arrays
// as file references (blob-table.ts `FileRef`), which the map's blob serves
// off the disk when the window fetches them. This process never holds a
// cached map's bytes; a channel that wants a cached model's numbers here —
// none does today — reads them with `readCachedArrays`.

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { Assets, FileStat } from '#src/game/assets.ts';
import type { GeomData } from '#src/scene/payload.ts';
import { depValid, entryPath, loadGeomEntry, pruneGeomCache, sharedLoader } from '#src/scene/geom-cache.ts';
import type { DecodeParams, Dep } from '#src/scene/geom-cache.ts';
import type { DecodeJob } from '#src/scene/decode-job.ts';
import { decodeAll, jobMs, spawned } from '#electron/geom-jobs.ts';
import { tmpRoot } from '#electron/paths.ts';

/** Where the entries live: the app's own temp, never the data root (that one is a consumable). */
export const geomCacheDir = (): string => join(tmpRoot(), 'geoms');

/** What the cache may grow to; two maps' worth is ~350 MB, so this is many maps. */
const CACHE_BUDGET = 4 * 1024 * 1024 * 1024;

/** Trim the cache to its budget — after an open, off the open's own path. */
export function pruneGeomCacheLater(): void {
  setImmediate(() => {
    const t0 = performance.now();
    const removed = pruneGeomCache(geomCacheDir(), CACHE_BUDGET);
    if (removed) console.log(`[decode] cache trimmed by ${(removed / 1048576) | 0} MB in ${(performance.now() - t0) | 0}ms`);
  });
}

export interface DecodeReport {
  hits: number;
  decoded: number;
  /** Hrefs whose decode failed, with why — the build decodes them itself. */
  failed: { href: string; error: string }[];
  /** Milliseconds: reading the cache — of which its entries' headers, and the stats that validate them — and waiting on the decodes. */
  cacheMs: number;
  headMs: number;
  statMs: number;
  decodeMs: number;
  /** Decoder processes at work, and the milliseconds they spent between them — against decodeMs, the pool's use. */
  workers: number;
  workMs: number;
  /** Stats asked of the file system to validate the cache, after the memo. */
  stats: number;
}

/**
 * Every `rel` resolved through the chain and statted, in parallel: the first
 * root that has it as a file, with its size and date — what `statOf` answers,
 * off the thread pool. A rel no root has maps to null. First root wins is
 * the rule of an `assets()` chain (game/assets.ts `found`), which is what a
 * map open resolves through; a chain with another rule (game/mounted.ts —
 * the generator's, never here) would have to be asked itself.
 */
async function statAll(data: Assets, rels: Iterable<string>): Promise<Map<string, FileStat | null>> {
  const out = new Map<string, FileStat | null>();
  const one = async (rel: string): Promise<void> => {
    for (const root of data.roots) {
      const path = join(root, rel);
      const s = await stat(path).catch(() => null);
      if (s?.isFile()) { out.set(rel, { path, size: s.size, mtime: s.mtimeMs }); return; }
    }
    out.set(rel, null);
  };
  await Promise.all([...rels].map(one));
  return out;
}

/**
 * The geoms for `hrefs`, decoded ahead. Null for an href that is known not to
 * decode; absent for one whose decode failed this time.
 */
export async function decodedGeoms(
  data: Assets, hrefs: Iterable<string>, params: DecodeParams,
): Promise<{ geoms: Map<string, GeomData | null>; report: DecodeReport }> {
  const dir = geomCacheDir();
  const session = randomUUID();
  const geoms = new Map<string, GeomData | null>();
  const report: DecodeReport = { hits: 0, decoded: 0, failed: [], cacheMs: 0, headMs: 0, statMs: 0, decodeMs: 0, workers: 0, workMs: 0, stats: 0 };
  const jobs: DecodeJob[] = [];
  const shared = sharedLoader();
  const t0 = performance.now();
  // The heads first, all of them; then every file they depend on, statted
  // ONCE (a texture's document is a dependency of every model wearing it)
  // and in parallel — a stat is ~0.07 ms of kernel time on Windows and there
  // are ~1800 of them per map, a quarter of the warm open done one after
  // another on this thread; the thread pool does them four at a time while
  // this thread waits for nothing else.
  const heads: { href: string; file: string; have: ReturnType<typeof loadGeomEntry> }[] = [];
  for (const href of new Set(hrefs)) {
    const file = entryPath(dir, href, params);
    heads.push({ href, file, have: loadGeomEntry(file, shared, false) });
  }
  report.headMs = performance.now() - t0;
  const t0s = performance.now();
  const rels = new Set<string>();
  for (const h of heads) for (const d of h.have?.entry.deps ?? []) rels.add(d.rel);
  const stats = await statAll(data, rels);
  report.stats = rels.size;
  report.statMs = performance.now() - t0s;
  const valid = (deps: Dep[]): boolean => deps.every((d) => depValid(d, stats.get(d.rel) ?? null));
  for (const { href, file, have } of heads) {
    if (have && valid(have.entry.deps)) {
      geoms.set(href, have.geom);
      report.hits++;
    } else {
      jobs.push({ session, roots: [...data.roots], href, file, ...params });
    }
  }
  report.cacheMs = performance.now() - t0;
  const t1 = performance.now();
  const work0 = jobMs;
  const results = await decodeAll(jobs);
  report.workMs = jobMs - work0;
  report.workers = spawned();
  for (const job of jobs) {
    const err = results.get(job);
    if (err) { report.failed.push({ href: job.href, error: err.message }); continue; }
    const have = loadGeomEntry(job.file, shared, false);
    if (!have) { report.failed.push({ href: job.href, error: 'the entry was not written' }); continue; }
    geoms.set(job.href, have.geom);
    report.decoded++;
  }
  report.decodeMs = performance.now() - t1;
  return { geoms, report };
}

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
import { statOf } from '#src/game/assets.ts';
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
  // A texture's document is a dependency of every model wearing it: each
  // file is resolved and statted once per open, not once per entry.
  const memo = new Map<string, FileStat | null>();
  const stat = (rel: string): FileStat | null => {
    let m = memo.get(rel);
    if (m === undefined) {
      const t = performance.now();
      report.stats++;
      m = statOf(data, rel);
      memo.set(rel, m);
      report.statMs += performance.now() - t;
    }
    return m;
  };
  const valid = (deps: Dep[]): boolean => deps.every((d) => depValid(d, stat(d.rel)));
  const jobs: DecodeJob[] = [];
  const shared = sharedLoader();
  const t0 = performance.now();
  for (const href of new Set(hrefs)) {
    const file = entryPath(dir, href, params);
    const tr = performance.now();
    const have = loadGeomEntry(file, shared, false);
    report.headMs += performance.now() - tr;
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

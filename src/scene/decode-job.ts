// One decode, start to finish: a shared href into a cache entry on disk.
//
// This is what a decode process runs (electron/geom-worker.ts) and what the
// main process runs itself when it has no pool — the same function, so the
// two cannot drift. Plain node: the asset chain comes as its roots, the
// destination as a path.

import { assets } from '../game/assets.ts';
import type { Assets } from '../game/assets.ts';
import { createGeomResolver } from './scene.ts';
import { recordingAssets, writeGeomEntry } from './geom-cache.ts';
import type { DecodeParams } from './geom-cache.ts';
import { resetBakedEffects } from './fx-bake.ts';
import { setCompressedTextures } from './materials.ts';

/** A decode to run: which href, over which roots, with which parameters, into which file. */
export interface DecodeJob extends DecodeParams {
  /**
   * Names the map open this belongs to. A decode process keeps its asset chain
   * (and the recordings it baked) from one job to the next while the session
   * is the same, and starts afresh when it changes — the chain remembers where
   * every file was, and a mod mounted between two opens is a new answer.
   */
  session: string;
  roots: string[];
  href: string;
  file: string;
}

let chain: { session: string; assets: Assets } | null = null;

/** Decode `job.href` and write its entry; throws when the entry cannot be written. */
export function runDecodeJob(job: DecodeJob): void {
  if (chain?.session !== job.session) {
    chain = { session: job.session, assets: assets(job.roots) };
    resetBakedEffects();
  }
  setCompressedTextures(job.compressed);
  const rec = recordingAssets(chain.assets);
  const resolver = createGeomResolver(rec.assets, job.texSize, { animate: job.animate, animationFps: job.animationFps });
  const idx = resolver.resolve(job.href);
  writeGeomEntry(job.file, job.href, rec.deps(), idx >= 0 ? resolver.geoms[idx]! : null);
}

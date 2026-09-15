// A generation as a JOB: everything it needs as plain paths and numbers, so
// it can be handed to a process that has no window, no `app`, and no idea
// where the game is — the same shape `src/dialog/open-scene.ts` gives a scene.
//
// The install is rebuilt on the far side from the game folder and the cache
// (`mountArchives`, the executable's own mounting rule), the map is generated,
// and the files are WRITTEN THERE rather than posted back: sixteen documents
// of up to a few megabytes cross a MessagePort as copies, and the folder they
// are going to is known before the run starts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mountArchives } from '../game/mounted.ts';
import { generateMap } from './index.ts';
import type { RmgOrder } from './index.ts';

export interface RmgJob {
  /** The game folder — `<game>/H5E/` is mounted from it, `bin/H5_Game_H5E.exe` read. */
  gameRoot: string;
  /** The unpacked data the mounted archives sit over. */
  dataRoot: string;
  /** Where mounted archives are unpacked to (cached by size and date). */
  cacheDir: string;
  /** The game's UNWRAPPED executable. */
  exe: string;
  order: RmgOrder;
  /** The folder to write the map's files into; created if missing. */
  mapDir: string;
}

export interface RmgJobResult {
  guid: string;
  seed: number;
  draws: number;
  objects: number;
  files: string[];
  ms: number;
}

/** Run one job to the end: the files are in `job.mapDir` when this returns. */
export function runRmgJob(job: RmgJob): RmgJobResult {
  const started = performance.now();
  const data = mountArchives(job.gameRoot, job.cacheDir, job.dataRoot);
  const map = generateMap({ data, exe: job.exe }, job.order);
  mkdirSync(job.mapDir, { recursive: true });
  for (const f of map.files) writeFileSync(join(job.mapDir, f.name), f.data);
  return {
    guid: map.guid, seed: job.order.seed, draws: map.draws, objects: map.objects,
    files: map.files.map((f) => f.name), ms: Math.round(performance.now() - started),
  };
}

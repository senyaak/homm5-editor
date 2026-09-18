// A decode process: one shared href at a time into the cache (electron/geom-jobs.ts).
//
// Run through Electron's `utilityProcess` — a Node child with no window and no
// Electron API, so everything it needs arrives in the job (src/scene/decode-job.ts).
// One job at a time by construction: the parent sends the next only when this
// one has answered.

import { runDecodeJob } from '#src/scene/decode-job.ts';
import type { DecodeJob } from '#src/scene/decode-job.ts';

/** What comes back; `id` pairs it with the promise the parent holds. */
export interface GeomWorkerReply {
  id: number;
  ok: boolean;
  error?: string;
  ms: number;
}

process.parentPort.on('message', (e) => {
  const { id, job } = e.data as { id: number; job: DecodeJob };
  const t0 = performance.now();
  try {
    runDecodeJob(job);
    process.parentPort.postMessage({ id, ok: true, ms: performance.now() - t0 } satisfies GeomWorkerReply);
  } catch (err) {
    process.parentPort.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err), ms: performance.now() - t0 } satisfies GeomWorkerReply);
  }
});

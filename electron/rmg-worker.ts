// The child that generates a random map, so the app keeps answering while it does.
//
// Run by `electron/channels/rmg.ts` through Electron's own `utilityProcess`,
// the way `scene-worker.ts` is: a Node child with no window and no Electron
// API, which is why the job arrives as paths (src/rmg/job.ts). A HUGE map with
// an underground is minutes of arithmetic, and minutes in the main process
// are minutes in which no channel answers and the window looks hung.
//
// One job per child: the parent forks for a generation and lets the child
// exit after it, so the memory a big run takes goes with it.

import { runRmgJob } from '#src/rmg/job.ts';
import type { RmgJob, RmgJobResult } from '#src/rmg/job.ts';

/** What comes back. `id` pairs it with the promise the parent is holding. */
export interface RmgWorkerReply {
  id: number;
  ok: boolean;
  result?: RmgJobResult;
  error?: string;
}

process.parentPort.on('message', (e) => {
  const { id, job } = e.data as { id: number; job: RmgJob };
  try {
    const result = runRmgJob(job);
    process.parentPort.postMessage({ id, ok: true, result } satisfies RmgWorkerReply);
  } catch (err) {
    process.parentPort.postMessage(
      { id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies RmgWorkerReply);
  }
});

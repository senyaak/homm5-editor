// The child that holds the random map generator, so the app keeps answering
// while it reads and while it generates.
//
// Run by `electron/channels/rmg.ts` through Electron's own `utilityProcess`,
// the way `scene-worker.ts` is: a Node child with no window and no Electron
// API, which is why every request arrives as paths (src/rmg/service.ts).
// Opening the dialog reads the install — seconds of archives and hero
// documents — and a HUGE map with an underground is minutes of arithmetic;
// seconds or minutes in the main process are ones in which no channel
// answers and the window looks hung.
//
// ONE child for the session, not one per job: what it read for the first
// question answers every question after it (the service keeps the mounted
// install), and the dialog opens from the second time on without reading
// anything. The parent forks it on the first request and stops it when the
// app quits.

import { answer } from '#src/rmg/service.ts';
import type { RmgRequest } from '#src/rmg/service.ts';

/** What comes back. `id` pairs it with the promise the parent is holding. */
export interface RmgWorkerReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

process.parentPort.on('message', (e) => {
  const { id, req } = e.data as { id: number; req: RmgRequest };
  try {
    process.parentPort.postMessage({ id, ok: true, result: answer(req) } satisfies RmgWorkerReply);
  } catch (err) {
    process.parentPort.postMessage(
      { id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies RmgWorkerReply);
  }
});

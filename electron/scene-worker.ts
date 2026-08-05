// The child that assembles a scene, so the app can keep answering while it does.
//
// Run by `electron/scene-jobs.ts` through Electron's own `utilityProcess`: a
// Node child with no window, no Electron API and no access to `app` — which is
// why every path it needs arrives in the message rather than being asked for
// here (src/dialog/open-scene.ts).
//
// One job at a time, by construction: the parent sends the next only when this
// one has answered, so there is no queue in here and no shared state to get
// wrong.

import { openScenePayload } from '#src/dialog/open-scene.ts';
import type { OpenSceneJob } from '#src/dialog/open-scene.ts';

/** What comes back. `id` pairs it with the promise the parent is holding. */
export interface SceneWorkerReply {
  id: number;
  ok: boolean;
  /** The payload, when it worked — shaped for the renderer already. */
  result?: unknown;
  error?: string;
  /** What to print, so the timing line still comes out of one place. */
  note?: string;
}

process.parentPort.on('message', (e) => {
  const { id, job } = e.data as { id: number; job: OpenSceneJob };
  try {
    const out = openScenePayload(job);
    process.parentPort.postMessage({ id, ok: true, note: out.note, result: out.payload } satisfies SceneWorkerReply);
  } catch (err) {
    process.parentPort.postMessage(
      { id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies SceneWorkerReply);
  }
});

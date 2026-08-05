// Running a scene build somewhere other than the main process.
//
// WHY. Assembling C1M1's opening is ~7 seconds of reading archives, meshing
// geometry and baking clips. Done in the main process, those seconds belong to
// nobody else: it is single-threaded, so every other channel — the map watcher,
// the object panel, a second window — waits behind it, and the app looks hung.
// Measured before the change: 6.9s in the handler, and the window's own frame
// loop stalled 1.3s on top of it.
//
// HOW. `utilityProcess` is Electron's own answer to this — a Node child with no
// window and no Electron API, addressed over a MessagePort. The child is forked
// on the first scene and kept for the session (a fork costs ~200ms, and the
// window that opens one scene usually opens another), and it takes ONE job at a
// time: the queue lives here, so the child has no state to get wrong.
//
// A child that cannot start is not a broken editor. Anything that goes wrong
// with it falls back to building in this process, which is what used to happen
// always — slower, and correct.

import { utilityProcess, app } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';
import { openScenePayload } from '#src/dialog/open-scene.ts';
import type { OpenSceneJob, ScenePayload } from '#src/dialog/open-scene.ts';
import type { SceneWorkerReply } from '#electron/scene-worker.ts';
import { APP_ROOT } from '#electron/paths.ts';

/** The child's entry point: TypeScript from the repo, JavaScript from a build. */
const workerFile = (): string =>
  join(APP_ROOT, 'electron', app.isPackaged ? 'scene-worker.js' : 'scene-worker.ts');

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let child: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Give up on the child: everything waiting on it fails, and the next call forks again. */
function drop(why: string): void {
  child = null;
  for (const [, p] of pending) p.reject(new Error(why));
  pending.clear();
}

/**
 * Force the build back into this process.
 *
 * For proving the child is doing anything: with it set, the same measurement
 * has to show the app going deaf for the length of a build. A number that says
 * "responsive" in both worlds is measuring nothing (e2e/scene-thread.spec.ts).
 */
const INLINE_ONLY = (): boolean => process.env.HOMM5_SCENE_INLINE === '1';

export function ensureChild(): UtilityProcess | null {
  if (INLINE_ONLY()) return null;
  if (child) return child;
  try {
    const proc = utilityProcess.fork(workerFile(), [], {
      serviceName: 'homm5-scene-builder',
      // Its own stdio, forwarded — a warning from inside the build (a mod that
      // would not mount, a missing camera library) must not vanish because it
      // was printed in a child.
      stdio: 'pipe',
    });
    proc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[scene-worker] ${b}`));
    proc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[scene-worker] ${b}`));
    proc.on('message', (m: SceneWorkerReply) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.note) console.log(`[perf] scene:open ${m.note}`);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error ?? 'the scene builder failed without saying why'));
    });
    proc.on('exit', (code) => drop(`the scene builder stopped (exit ${code})`));
    child = proc;
    return proc;
  } catch (e) {
    console.warn('[scene] no background builder:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Build a scene, in the child when there is one.
 *
 * The fallback is deliberate and silent-ish: a packaged build with no worker
 * file, a machine that refuses the fork — the scene still opens, this process
 * still stalls, and the console says which happened.
 */
export async function buildSceneOffThread(job: OpenSceneJob): Promise<ScenePayload> {
  const proc = ensureChild();
  if (!proc) return inline(job);
  const id = nextId++;
  try {
    return await new Promise<ScenePayload>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      proc.postMessage({ id, job });
    });
  } catch (e) {
    // A scene that FAILED to build fails the same way here — the fallback is
    // for a child that could not run it, not for a scene that cannot be read,
    // and re-running a genuine error inline would cost the user the same seven
    // seconds to be told the same thing. So it only catches a dead child.
    if (child) throw e;
    console.warn('[scene] building in the main process:', e instanceof Error ? e.message : String(e));
    return inline(job);
  }
}

function inline(job: OpenSceneJob): ScenePayload {
  const out = openScenePayload(job);
  console.log(`[perf] scene:open ${out.note} (in the main process)`);
  return out.payload;
}

/** Stop the child. Called when the app quits, so no orphan outlives the window. */
export function stopSceneBuilder(): void {
  child?.kill();
  drop('the app is closing');
}

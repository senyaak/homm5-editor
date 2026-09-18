// Decoding a map's models in parallel, in processes of their own.
//
// Opening a map used to decode every model it places in this process, one
// after another — the mix stress map's 652 in 3.3–4.3 s, with every other
// channel waiting behind them. The decodes are independent (one shared href
// each, src/scene/decode-job.ts), so a POOL of `utilityProcess` children
// takes them, as many at a time as the machine has cores to spare, and each
// writes its result into the geom cache (src/scene/geom-cache.ts) for this
// process to read back. The children stay while maps are being opened — a
// fork costs ~200 ms — and go when none has been for a while: each holds
// what it decoded with (the asset chain's documents, the frames and
// recordings it baked), ~200 MB apiece after the stress map, 1.3 GB for
// six that sat idle for the session. One that dies has its jobs redone here.
//
// The same fallback the scene builder has (scene-jobs.ts): no worker file, a
// machine that refuses the fork — the decode runs in this process, slower,
// and the console says so.

import { utilityProcess, app } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { APP_ROOT } from '#electron/paths.ts';
import { runDecodeJob } from '#src/scene/decode-job.ts';
import type { DecodeJob } from '#src/scene/decode-job.ts';
import type { GeomWorkerReply } from '#electron/geom-worker.ts';

/** Children to keep: the machine's threads less the app's own and the GPU's, at most six. */
const POOL = Math.max(1, Math.min(6, availableParallelism() - 2));
/** Idle this long after the last decode, the pool is stopped; the next map forks it again. */
const IDLE_MS = 30_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const workerFile = (): string =>
  join(APP_ROOT, 'electron', app.isPackaged ? 'geom-worker.js' : 'geom-worker.ts');

interface Child { proc: UtilityProcess; busy: { id: number; job: DecodeJob; done: (e: Error | null, ms: number) => void } | null }
/** Milliseconds the decoders spent on jobs, summed — against the wall clock, how well the pool is used. */
export let jobMs = 0;
export const spawned = (): number => children.length;
const children: Child[] = [];
let nextId = 1;
/** Everything in this process's hands is inline from here: the fork failed once. */
let inlineOnly = process.env.HOMM5_DECODE_INLINE === '1';

function spawn(): Child | null {
  if (inlineOnly) return null;
  try {
    const proc = utilityProcess.fork(workerFile(), [], { serviceName: 'homm5-geom-decoder', stdio: 'pipe' });
    proc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[geom-worker] ${b}`));
    proc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[geom-worker] ${b}`));
    const child: Child = { proc, busy: null };
    proc.on('message', (m: GeomWorkerReply) => {
      const b = child.busy;
      if (!b || b.id !== m.id) return;
      child.busy = null;
      jobMs += m.ms;
      b.done(m.ok ? null : new Error(m.error ?? 'the decoder failed without saying why'), m.ms);
    });
    proc.on('exit', (code) => {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      // Whatever it held is redone here, once: a child that dies on a model
      // would die on it again.
      const b = child.busy;
      child.busy = null;
      if (b) { console.warn(`[decode] a decoder stopped (exit ${code}); ${b.job.href} decoded in the main process`); b.done(inline(b.job), 0); }
    });
    children.push(child);
    return child;
  } catch (e) {
    console.warn('[decode] no decoder processes:', e instanceof Error ? e.message : String(e));
    inlineOnly = true;
    return null;
  }
}

/** The job here and now; the error, if it failed. */
function inline(job: DecodeJob): Error | null {
  try { runDecodeJob(job); return null; } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
}

/**
 * Run every job, `POOL` at a time, and answer per job: null for done, the
 * error for one that failed (its entry is not written; the caller decodes
 * it as it likes, or skips the object).
 */
export async function decodeAll(jobs: DecodeJob[]): Promise<Map<DecodeJob, Error | null>> {
  const out = new Map<DecodeJob, Error | null>();
  if (!jobs.length) return out;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  while (children.length < Math.min(POOL, jobs.length) && spawn()) { /* up to the pool */ }
  if (!children.length) {
    for (const j of jobs) out.set(j, inline(j));
    return out;
  }
  const queue = [...jobs];
  const runOn = (child: Child): Promise<void> => new Promise((resolve) => {
    const next = (): void => {
      const job = queue.shift();
      if (!job || !children.includes(child)) { resolve(); return; }
      const id = nextId++;
      child.busy = { id, job, done: (e) => { out.set(job, e); next(); } };
      child.proc.postMessage({ id, job });
    };
    next();
  });
  await Promise.all(children.map(runOn));
  // A child that died mid-run leaves its queue behind: finish it here.
  for (const job of queue) out.set(job, inline(job));
  idleTimer = setTimeout(() => { idleTimer = null; stopDecoders(); }, IDLE_MS);
  return out;
}

/** Stop the pool — the app is closing. */
export function stopDecoders(): void {
  for (const c of children.splice(0)) c.proc.kill();
}

// Bakes, off the window's thread.
//
// A recording's table and a skin's idle table are arithmetic over typed
// arrays (fx-table.ts, skinning.ts `bakeBoneTable`), and a map opens with
// dozens of each. Done here they froze the window for the whole batch. Done
// in a worker they land one by one while the window draws: a creature stands
// in its rest pose until its table arrives, an effect plays from the moment
// its does (SLICE_fx_performance.md §7a).
//
// A few workers rather than one, because the bakes are independent and the
// creature stress map's 182 skins are four seconds of them in a row. Without
// a worker at all — a page served from somewhere the script is not — the
// bake runs here, as it always did, so nothing that draws depends on the
// worker existing; only the freeze does.

import type { FxTransfer } from '#src/scene/effects.ts';
import type { SkinnedGeom } from '#src/scene/payload.ts';
import { bakePending, countBake } from '#viewport/bakes.ts';
import { bakeTableData } from '#viewport/fx-table.ts';
import type { FxTableData } from '#viewport/fx-table.ts';
import { bakeBoneTable } from '#viewport/skinning.ts';
import type { BoneTable } from '#viewport/skinning.ts';
import { BufferGeometry } from 'three';

export type BakeRequest =
  | { id: number; kind: 'fx'; baked: FxTransfer }
  | { id: number; kind: 'idle'; skin: SkinnedGeom };
export type BakeReply =
  | { id: number; kind: 'fx'; ms: number; table: FxTableData }
  | { id: number; kind: 'idle'; ms: number; table: BoneTable | null };

/** Workers to keep: the machine's threads less two for the window and the GPU process, at most four. */
const WORKERS = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 2));
const workers: Worker[] = [];
/** Requests out at the workers, by id — kept whole so a worker's death can finish them here. */
const waiting = new Map<number, { req: BakeRequest; done: (r: BakeReply) => void }>();
let nextId = 0;
let nextWorker = 0;
/** Baking on this thread: no worker could be made, or one died. */
let inline = false;

/** The bake, here and now — what the worker runs, and the way without one. */
function bakeHere(req: BakeRequest): BakeReply {
  const t0 = performance.now();
  if (req.kind === 'fx') return { id: req.id, kind: 'fx', ms: performance.now() - t0, table: bakeTableData(req.baked) };
  return { id: req.id, kind: 'idle', ms: performance.now() - t0, table: bakeBoneTable(req.skin, new BufferGeometry(), []) };
}

/** Give up on the workers: whatever they held is baked here, and everything after is too. */
function fallBack(why: string): void {
  if (inline) return;
  console.warn(`[perf] bake worker failed, baking on the main thread: ${why}`);
  inline = true;
  for (const w of workers) w.terminate();
  workers.length = 0;
  const held = [...waiting.values()];
  waiting.clear();
  for (const { req, done } of held) done(bakeHere(req));
}

function worker(): Worker | null {
  if (inline) return null;
  if (!workers.length) {
    try {
      for (let i = 0; i < WORKERS; i++) {
        const w = new Worker(new URL('./bake-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<BakeReply>) => {
          const held = waiting.get(e.data.id);
          waiting.delete(e.data.id);
          held?.done(e.data);
        };
        w.onerror = (e) => fallBack(e.message);
        workers.push(w);
      }
    } catch (e) {
      fallBack(e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  return workers[nextWorker++ % workers.length]!;
}

function ask(req: BakeRequest): Promise<BakeReply> {
  const w = worker();
  if (!w) return Promise.resolve(bakeHere(req));
  bakePending(1);
  return new Promise((resolve) => {
    waiting.set(req.id, { req, done: (r) => { bakePending(-1); resolve(r); } });
    w.postMessage(req);
  });
}

/** A recording's table, when it is baked. */
export async function bakeFx(baked: FxTransfer): Promise<FxTableData> {
  const r = await ask({ id: nextId++, kind: 'fx', baked });
  countBake('fx', r.ms);
  return r.table as FxTableData;
}

/** A skin's idle table, when it is baked; null for a skin with no clip. */
export async function bakeIdle(skin: SkinnedGeom): Promise<BoneTable | null> {
  const r = await ask({ id: nextId++, kind: 'idle', skin });
  countBake('idle', r.ms);
  return r.table as BoneTable | null;
}

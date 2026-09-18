// The bakery's worker: a recording into its table, a skin's idle into its
// bone table — off the window's thread. A map opens with dozens of each
// (A2C1M1: 82 recordings, 51 skins, ~650 ms of arithmetic; the creature
// stress map's 182 skins were four seconds), and the window froze for them
// between the scene appearing and the effects playing.
//
// Bundled on its own (tools/build-renderer.ts) as renderer/bake-worker.js and
// spoken to by viewport/bakery.ts; the arithmetic is the same functions the
// window would call, so a test of the bake is a test of this too.

import { bakeTableData } from '#viewport/fx-table.ts';
import { bakeBoneTable } from '#viewport/skinning.ts';
import { BufferGeometry } from 'three';
import type { BakeRequest, BakeReply } from '#viewport/bakery.ts';

self.onmessage = (e: MessageEvent<BakeRequest>): void => {
  const req = e.data;
  const t0 = performance.now();
  let reply: BakeReply;
  const transfer: Transferable[] = [];
  if (req.kind === 'fx') {
    const t = bakeTableData(req.baked);
    reply = { id: req.id, kind: 'fx', ms: performance.now() - t0, table: t };
    transfer.push(t.data.buffer, t.base.buffer, t.count.buffer);
  } else {
    // The mesh the bake builds is a skeleton's carrier and nothing more: no
    // vertices are read, so an empty geometry does.
    const t = bakeBoneTable(req.skin, new BufferGeometry(), []);
    reply = { id: req.id, kind: 'idle', ms: performance.now() - t0, table: t };
    if (t) transfer.push(t.offsets.buffer, t.bind.buffer);
  }
  (self as unknown as Worker).postMessage(reply, transfer);
};

// Running an edit and recording what it did.
//
// Every mutating channel goes through record(): snapshot the documents it says
// it touches, run it, snapshot again, keep the diff. The edit itself knows
// nothing about undo, which is why one added later is undoable without anyone
// remembering to write its inverse. The other half is persistence — a history
// is only adopted by a later run if the documents still hash to what they
// hashed when it was written.

import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { apply, diff } from '#src/map/history.ts';
import type { DocPatch, Step, StoredHistory } from '#src/map/history.ts';
import { loadMap } from '#src/map/map.ts';
import { tmpRoot } from '#electron/paths.ts';
import { TERRAIN_FILE, terrainDoc } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';

/** Documents an edit may touch: the map, some floors' terrain, or both. */
export interface Touches { map?: boolean; floors?: number[] }

/** The map document's key in a history step; floors use their index. */
const MAP_DOC = '';

/** Current bytes of every document an edit is about to touch. */
function snapshot(s: Session, t: Touches): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  if (t.map) out[MAP_DOC] = Buffer.from(s.map.save(), 'latin1');
  // Opened here rather than inside the edit: a document created midway through
  // would have no "before" to compare against, and its first edit would be
  // silently unundoable.
  for (const f of t.floors ?? []) out[String(f)] = terrainDoc(s, f).buffer();
  return out;
}

/**
 * Run an edit and record what it did to the documents.
 *
 * Snapshot, run, snapshot, diff. The edit itself needs no knowledge of undo,
 * which is the point: an operation added later is undoable without anyone
 * remembering to write its inverse.
 */
export function record<T>(s: Session, label: string, touches: Touches, fn: () => T): T {
  const before = snapshot(s, touches);
  const out = fn();
  const after = snapshot(s, touches);
  const docs: Record<string, DocPatch> = {};
  for (const key of Object.keys(before)) {
    const p = diff(before[key]!, after[key]!);
    if (p) docs[key] = p;
  }
  s.history.push({ label, docs });
  return out;
}

/** Put a step's other side into the live documents. Returns what moved. */
export function applyStep(s: Session, step: Step, dir: 'undo' | 'redo'): Touches {
  const floors: number[] = [];
  let map = false;
  for (const [key, patch] of Object.entries(step.docs)) {
    if (key === MAP_DOC) {
      const now = Buffer.from(s.map.save(), 'latin1');
      s.map = loadMap(Buffer.from(apply(now, patch, dir)).toString('latin1'));
      map = true;
    } else {
      const floor = Number(key);
      const doc = terrainDoc(s, floor);
      doc.restore(Buffer.from(apply(doc.buffer(), patch, dir)));
      floors.push(floor);
    }
  }
  return { map, floors };
}

/**
 * Identity of the documents as they stand, for deciding whether a history saved
 * by a previous run still describes them.
 *
 * Taken over the live in-memory state rather than the files, because that is
 * what the patches were taken from — and on a clean open the two are the same
 * bytes anyway.
 */
function docsHash(s: Session): string {
  const h = createHash('sha1');
  h.update(s.map.save(), 'latin1');
  TERRAIN_FILE.forEach((file, floor) => {
    // The live document when there is one, the file otherwise — unsaved brush
    // work is part of the state the history describes.
    const doc = s.terrain.get(floor);
    if (doc) { h.update(doc.buffer()); return; }
    const p = join(s.mapDir, file);
    if (existsSync(p)) h.update(readFileSync(p));
  });
  return h.digest('hex');
}

/** Where a map's history lives: in the editor's own scratch dir, never in the map. */
export function historyPathFor(mapDir: string): string {
  // NOT inside the map folder: packProject sweeps every file in there into the
  // .h5m, and an editor's undo log has no business shipping inside a map.
  const key = createHash('sha1').update(mapDir).digest('hex').slice(0, 16);
  return join(tmpRoot(), 'history', `${key}.json`);
}

export function saveHistory(s: Session): void {
  try {
    mkdirSync(dirname(s.historyPath), { recursive: true });
    writeFileSync(s.historyPath, JSON.stringify(s.history.save(docsHash(s))));
  } catch { /* a history that cannot be written is not a reason to fail an edit */ }
}

export function loadHistory(s: Session): void {
  try {
    if (!existsSync(s.historyPath)) return;
    const stored = JSON.parse(readFileSync(s.historyPath, 'utf8')) as StoredHistory;
    s.history.restore(stored, docsHash(s));
  } catch { /* an unreadable history is dropped, not repaired */ }
}

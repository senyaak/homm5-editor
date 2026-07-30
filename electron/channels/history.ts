// Undo and redo.
//
// The step is applied to the documents here; what goes back to the renderer is
// the state it cannot derive on its own — objects as the whole instance list
// (the map was re-parsed, so matching ids up one by one would be more work than
// rebuilding the batches) and terrain as its planes plus a rebuilt splat.

// --- IPC: undo / redo ---
//
// The step is applied to the documents here; what goes back to the renderer is
// the state it cannot derive on its own. Objects come back as the whole
// instance list — the map was re-parsed, so every id is new-ish and matching
// them up one by one would be more work than rebuilding the batches. Terrain
// comes back as its planes plus a rebuilt splat, which is what a repainted mask
// or an added layer changes.
import { ipcMain } from 'electron';
import { applyStep } from '#electron/edits.ts';
import type { UndoResult } from '#electron/ipc.ts';
import { need, terrainDoc } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import type { Step } from '#src/history.ts';
import { splatFor } from '#src/scene.ts';
import type { Instance as SceneInstance } from '#src/scene.ts';

function undoResult(s: Session, step: Step | null, dir: 'undo' | 'redo'): UndoResult {
  const moved = step ? applyStep(s, step, dir) : {};
  const terrain: UndoResult['terrain'] = [];
  for (const floor of moved.floors ?? []) {
    const doc = terrainDoc(s, floor);
    terrain.push({
      floor,
      heights: [...doc.heightsCopy()],
      flags: doc.flagsCopy() ? [...doc.flagsCopy()!] : null,
      splat: splatFor(doc.buffer(), s.assets),
    });
  }
  // Deliberately NOT persisted here. The stored history is keyed by a hash of
  // the documents, and it is only worth anything if that hash is one a later
  // run will reproduce — which means the state that is on DISK. Writing it
  // after an in-memory undo would key it to bytes nobody saved, and would
  // overwrite the good copy written at the last save.
  return {
    ok: true,
    applied: !!step,
    label: step?.label ?? null,
    instances: moved.map ? instancesOf(s) : null,
    terrain,
    canUndo: s.history.canUndo, canRedo: s.history.canRedo,
    undoLabel: s.history.undoLabel, redoLabel: s.history.redoLabel,
  };
}

/** Every placed object, per floor, meshed through the session's warm resolver. */
function instancesOf(s: Session): SceneInstance[][] {
  const floors: SceneInstance[][] = [[], []];
  for (const obj of s.map.objects) {
    const shared = obj.shared, pos = obj.pos;
    if (!shared || !pos) continue;
    const g = s.resolver.resolve(shared);
    if (g < 0) continue;
    const floor = obj.floor === 1 ? 1 : 0;
    // z is left to the renderer, which drops an object onto its own terrain --
    // the same thing object:add does.
    floors[floor]!.push({
      id: obj.id, type: obj.type, g, shared: shared.split('#')[0]!,
      x: pos.x, y: pos.y, z: 0, r: obj.rot || 0,
    });
  }
  return floors;
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerHistory(): void {
  ipcMain.handle('history:undo', async (): Promise<UndoResult> => {
    const session = need();
    return undoResult(session, session.history.takeUndo(), 'undo');
  });

  ipcMain.handle('history:redo', async (): Promise<UndoResult> => {
    const session = need();
    return undoResult(session, session.history.takeRedo(), 'redo');
  });
}

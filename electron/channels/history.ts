// Undo and redo.
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
import type { Step } from '#src/map/history.ts';
import { splatFor } from '#src/scene/splat.ts';
import type { Instance as SceneInstance } from '#src/scene/payload.ts';

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
    // Everything buildScene puts on an instance, because the renderer rebuilds
    // the floor from this list and whatever is missing here is missing on
    // screen. The designer point lights are the part that has nowhere else to
    // come from: an undo without them left a lit courtyard dark until reload.
    const lights = obj.pointLights;
    // z is left to the renderer, which drops an object onto its own terrain --
    // the same thing object:add does.
    floors[floor]!.push({
      id: obj.id, type: obj.type, g, shared: shared.split('#')[0]!,
      x: pos.x, y: pos.y, z: 0, r: obj.rot || 0,
      ...(lights.length ? { lights } : {}),
    });
  }
  return floors;
}

/**
 * Take a step and apply it, putting the cursor back if it cannot be applied.
 *
 * The cursor moves when the step is taken, before anything is known about
 * whether it fits — so a step that throws used to leave the stack pointing one
 * place and the documents another. The next Ctrl+Z then reached for a patch
 * belonging to a state the map had never been in: usually another throw, and
 * where the lengths happened to agree, a silently mangled map.
 */
function step(s: Session, dir: 'undo' | 'redo'): UndoResult {
  const taken = dir === 'undo' ? s.history.takeUndo() : s.history.takeRedo();
  try {
    return undoResult(s, taken, dir);
  } catch (e) {
    // applyStep is all-or-nothing, so the documents are untouched and putting
    // the cursor back leaves the stack exactly as it was before the press.
    if (taken) { if (dir === 'undo') s.history.takeRedo(); else s.history.takeUndo(); }
    throw e;
  }
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerHistory(): void {
  ipcMain.handle('history:undo', async (): Promise<UndoResult> => step(need(), 'undo'));
  ipcMain.handle('history:redo', async (): Promise<UndoResult> => step(need(), 'redo'));
}

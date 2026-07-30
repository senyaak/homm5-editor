// Undo / redo.
//
// The main process owns the stack (it re-parses the map on each step), so this
// is the button pair and the rebuild of whatever the step changed.

import { $, $button } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { state } from '#core/state.ts';
import { markDirty } from '#core/dirty.ts';
import { replaceInstances } from '#viewport/instancing.ts';
import { upgradeToSplat } from '#viewport/splat.ts';
import { deselect, renderExplorer } from '#features/selection.ts';
import { remeshFloor } from '#viewport/terrain-mesh.ts';

//
// The step itself is applied in the main process, against the documents it
// owns; this only takes delivery of whatever the renderer cannot recompute.
// Objects arrive as a whole list, terrain as its planes plus a rebuilt splat.
export async function stepHistory(dir: 'undo' | 'redo'): Promise<void> {
  if (!state.world) return;
  let r;
  try {
    r = dir === 'undo' ? await api.undo() : await api.redo();
  } catch (e) {
    $('hud').textContent = `${dir} failed: ` + (e instanceof Error ? e.message : String(e));
    return;
  }
  if (!r.applied) {
    $('hud').textContent = dir === 'undo' ? 'nothing to undo' : 'nothing to redo';
    return;
  }
  // The selection may name an object this step removed, and its handle mesh is
  // about to be discarded either way.
  deselect();
  if (r.instances) {
    state.world.floors.forEach((fl, i) => replaceInstances(fl, r.instances![i] ?? []));
  }
  for (const t of r.terrain) {
    const fl = state.world.floors[t.floor];
    if (!fl) continue;
    fl.heights = t.heights;
    fl.flags = t.flags;
    if (t.splat) fl.splat = t.splat;
    remeshFloor(fl);
    if (t.splat) {
      await upgradeToSplat(fl).catch((e: unknown) => {
        $('hud').textContent = 'ground textures: ' + (e instanceof Error ? e.message : String(e));
      });
    }
  }
  renderExplorer();
  markDirty(true);
  $('hud').textContent = `${dir === 'undo' ? 'undid' : 'redid'} ${r.label ?? 'edit'}`;
  updateHistoryUI(r.canUndo, r.canRedo, r.undoLabel, r.redoLabel);
}

/** Reflect what is undoable in the toolbar buttons. */
export function updateHistoryUI(canUndo: boolean, canRedo: boolean, undoLabel: string | null, redoLabel: string | null): void {
  const u = $button('undobtn'), rd = $button('redobtn');
  u.disabled = !canUndo;
  rd.disabled = !canRedo;
  u.title = canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo';
  rd.title = canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';
}

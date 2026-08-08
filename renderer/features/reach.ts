// "Can my hero get to everything?" — the button, and what it shows.
//
// The walk is done in the main process (electron/channels/reach.ts), which has
// the map, the terrain planes and every object's footprint. This is the part a
// person sees: the ground he cannot get to washed over, and the objects he
// cannot reach visited one click at a time.
//
// It turns the grid on if it is off. The answer IS the passability view — an
// orange wash beside the red one — and a check that reported a number while
// showing nothing would send you looking for the hole by hand.

import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { state } from '#core/state.ts';
import { frameObject, meshById, selectById } from '#features/selection.ts';
import { refreshBlocked, setShowBlocked, showBlocked } from '#viewport/overlays.ts';

/** The last answer, so a second click walks to the next thing rather than the same one. */
let visiting = -1;

/** Redraw the wash on every floor. */
function refreshAll(): void {
  if (!state.world) return;
  for (const fl of state.world.floors) refreshBlocked(fl);
}

/** Forget the wash — after an edit it is an answer about a map that no longer exists. */
export function clearReach(): void {
  if (!state.reach) return;
  state.reach = null;
  visiting = -1;
  refreshAll();
}

export async function runReach(): Promise<void> {
  if (!state.world) return;
  $('hud').textContent = 'walking the map…';
  const r = await api.reach();
  if (!r.ok) {
    state.reach = null;
    refreshAll();
    $('hud').textContent = r.error ?? 'the map cannot be walked';
    return;
  }
  state.reach = { walkable: r.walkable, seen: r.seen };
  if (!showBlocked) setShowBlocked(true); else refreshAll();

  const who = r.from.map((h) => h.label).join(', ');
  if (!r.unreached.length) {
    visiting = -1;
    $('hud').textContent = `${who} can reach all ${r.objects} objects`;
    return;
  }
  // Walk the list one click at a time. Every click re-runs the check, so the
  // list is always about the map as it is now — including the edit just made to
  // open the way to the last one.
  visiting = (visiting + 1) % r.unreached.length;
  const u = r.unreached[visiting]!;
  const here = state.world.active === u.floor;
  if (here) {
    selectById(u.id);
    const mesh = meshById(u.id);
    if (mesh) frameObject(mesh);
  }
  $('hud').textContent = `${r.reached} of ${r.objects} reachable from ${who}`
    + ` — ${r.unreached.length} not: ${u.label} at ${u.x},${u.y}`
    + (here ? ` (${visiting + 1}/${r.unreached.length}, click again for the next)`
      : ` — on the ${u.floor ? 'lower' : 'upper'} floor, switch to it to see it`);
}

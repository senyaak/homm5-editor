// What the script editor completes from: the engine API, the extension's own
// functions, and the names this map defines.
//
// Kept apart from the editor itself because two dialogs complete from it — the
// map's script and an artifact set's — and only one of them belongs to a map.

import { api } from '#core/ipc.ts';
import { setScriptContext } from '#features/text-editor/code-editor.ts';
import type { ScriptContext } from '#features/text-editor/code-editor.ts';

let ctx: ScriptContext | null = null;

/** Whether the sources have been fetched for the open map. */
export const scriptContextReady = (): boolean => ctx !== null;

/** What the editor knows, in a few words — an empty completion list should say so. */
export function scriptContextNote(): string {
  if (!ctx) return 'loading names…';
  const n = ctx.names;
  return `${ctx.api.length} engine fns · ${n.object.length} objects · `
    + `${n.region.length} regions · ${n.objective.length} objectives`;
}

/** Fetch the completion sources for the loaded map. Throws if main cannot. */
export async function loadScriptContext(): Promise<void> {
  ctx = await api.scriptContext();
  setScriptContext(ctx);
}

/** Drop them — the map they describe is being put down. */
export function forgetScriptContext(): void {
  ctx = null;
}

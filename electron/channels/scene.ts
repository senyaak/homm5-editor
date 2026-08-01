// Payloads too big to ship with the scene, fetched once the window is up.
//
// A map opened with idles off carries no bones anywhere — that is what makes
// `off` free — and baked particle keys are tens of megabytes as JSON. Both are
// asked for after the fact, so opening a map pays for neither.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { FxPayload } from '#electron/ipc.ts';
import { gameData, mountedAssets, readSettings, saveSettings } from '#electron/paths.ts';
import { need, state } from '#electron/state.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transferEffect } from '#src/scene/effects.ts';
import type { FxTransfer } from '#src/scene/effects.ts';
import { createGeomResolver } from '#src/scene/scene.ts';
import type { GeomData } from '#src/scene/payload.ts';

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerScene(): void {
  // The idle-animation setting.
  // Read and written here rather than in the renderer, because it decides what
  // map:load builds; the renderer only learns which mode the scene it was handed
  // was built for. A scene built with it off can be topped up in place through
  // map:idle-skins below, so changing the setting never needs a reload.
  ipcMain.handle('app:idle-animation', (): 'off' | 'visible' | 'all' => readSettings().idleAnimation ?? 'off');

  ipcMain.handle('app:set-idle-animation', (_e: IpcMainInvokeEvent, { mode }: { mode: 'off' | 'visible' | 'all' }) => {
    saveSettings({ idleAnimation: mode });
    return {};
  });

  // Animation data for a scene that was built without it.
  // A map opened with idles off carries no bones anywhere in its payload — that
  // is what makes `off` free. Turning the setting on used to mean reopening the
  // map; instead, this replays the open map's models through a fresh resolver
  // with animation on and returns just the skin payloads, keyed by the geom
  // indices the renderer already holds. Resolution is deterministic (same hrefs,
  // same order, same dedup), so the indices line up; anything that does not is
  // dropped here rather than handed over misaligned.
  ipcMain.handle('map:idle-skins', async (): Promise<Record<number, NonNullable<GeomData['skin']>>> => {
    const session = need();
    const t0 = performance.now();
    const fresh = createGeomResolver(session.assets, undefined, { animate: true });
    const skins: Record<number, NonNullable<GeomData['skin']>> = {};
    let misaligned = 0;
    for (const [href, idx] of session.resolver.index) {
      const j = fresh.resolve(href);
      if (j !== idx) { misaligned++; continue; }
      if (idx < 0) continue;
      const skin = fresh.geoms[j]?.skin;
      const have = session.resolver.geoms[idx];
      // Same model, same vertex order — or no skin at all for this geom.
      if (skin?.clip && have && skin.index.length === (have.pos.length / 3) * 4) skins[idx] = skin;
    }
    if (misaligned) console.warn(`[idle-skins] ${misaligned} model(s) resolved to a different index and were skipped`);
    // Placements from here on should carry their skins too.
    session.resolver = fresh;
    console.log(`[perf] map:idle-skins ${(performance.now() - t0) | 0}ms · ${Object.keys(skins).length} animated geom(s)`);
    return skins;
  });

  // Baked particle keys, by bin/effects uid.
  // Separate from the scene payload on purpose: these are tens of MB as JSON and
  // a few MB as typed arrays, and structured clone ships typed arrays binary.
  // The renderer asks once per unique uid after the scene is up.
  ipcMain.handle('map:fx', async (_e: IpcMainInvokeEvent, { uids }: FxPayload): Promise<Record<string, FxTransfer>> => {
    // A baked effect is a GLOBAL asset — `bin/effects/<uid>` — so this does not
    // need a map session, and must not require one: a dialog scene puts a world
    // on the GPU without opening a map, and its campfires and fireflies asked
    // for their keys here and got "no map loaded" back.
    const data = state.session?.assets ?? mountedAssets(gameData());
    const t0 = performance.now();
    const out: Record<string, FxTransfer> = {};
    for (const uid of uids) {
      // The uid names a file; nothing else is accepted (it lands in a path).
      if (!/^[0-9A-F-]{36}$/.test(uid)) continue;
      try {
        const p = data.path(join('bin', 'effects', uid));
        if (!existsSync(p)) continue;
        out[uid] = transferEffect(readFileSync(p));
      } catch { /* an unreadable effect stays a static card */ }
    }
    console.log(`[perf] map:fx ${(performance.now() - t0) | 0}ms · ${Object.keys(out).length}/${uids.length} effect(s)`);
    return out;
  });
}

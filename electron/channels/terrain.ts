// The brushes: ground paint, height, rivers and the passability mask.
//
// The renderer has already painted its own copy for immediate feedback; these
// are the authoritative writes, and each one records a step over the floor's
// terrain document. Only add-layer changes the file's structure rather than its
// bytes, which is why it is a deliberate action and not something a stroke does.

// --- IPC: the ground-tile palette (terrain brushes) ---
// Decoding 80+ tile textures takes ~1s, and the set never changes while the app
// runs, so it's built once and reused. `inMap` marks the tiles this map's
// terrain already has a layer for — those are the ones paintable without
// restructuring the .bin.
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { record } from '#electron/edits.ts';
import type { AddLayerPayload, AddLayerResult, MaskPayload, PaintRiverPayload, PaintTilePayload, PaintTileResult, RiverCellsPayload, SculptPayload, SculptResult, TerrainTilesResult } from '#electron/ipc.ts';
import { gameData, mountedAssets } from '#electron/paths.ts';
import { need, state, syncMapTiles, terrainDoc } from '#electron/state.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listTiles, splatFor } from '#src/scene.ts';
import type { TileInfo } from '#src/scene.ts';

let tileCache: { root: string; tiles: TileInfo[] } | null = null;

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerTerrain(): void {
  // --- IPC: paint a ground tile over a set of vertices ---
  // The renderer has already painted its own copy for immediate feedback; this is
  // the authoritative write. Only tiles the map has a layer for can be painted —
  // adding a layer means restructuring the .bin (see src/terrain.ts).
  ipcMain.handle('terrain:paint', async (_e: IpcMainInvokeEvent, p: PaintTilePayload): Promise<PaintTileResult> => {
    const session = need();
    record(session, 'paint ground', { floors: [p.floor] },
      () => terrainDoc(session, p.floor).paintTile(p.tile, p.verts, p.strength ?? 255, p.exclusive ?? true));
    return { ok: true };
  });

  // --- IPC: raise/lower vertices ---
  // The payload carries final heights and flags, not an operation, so this is a
  // plain assignment. Flags travel with heights because the format ties them: a
  // bed dug to 0 is water, and raising it off 0 makes it ground again.
  ipcMain.handle('terrain:sculpt', async (_e: IpcMainInvokeEvent, p: SculptPayload): Promise<SculptResult> => {
    const session = need();
    record(session, 'sculpt terrain', { floors: [p.floor] },
      () => terrainDoc(session, p.floor).setVertices(p.verts, p.heights, p.flags));
    return { ok: true };
  });

  // --- IPC: paint a river ---
  // Mask, river plane and heights in one message: a river whose plane is unset is
  // only paint as far as the game is concerned, and one whose bed was not sunk
  // sits on top of its own banks. Applying them separately would leave the file
  // briefly — or on a failure, permanently — inconsistent.
  ipcMain.handle('terrain:paint-river', async (_e: IpcMainInvokeEvent, p: PaintRiverPayload): Promise<PaintTileResult> => {
    const session = need();
    record(session, 'paint river', { floors: [p.floor] }, () => {
      const doc = terrainDoc(session, p.floor);
      doc.paintTile(p.tile, p.verts);
      doc.setRiver(p.verts);
      doc.setVertices(p.heightVerts, p.heights, null);
    });
    return { ok: true };
  });

  // --- IPC: the river plane on its own, at a chosen strength ---
  ipcMain.handle('terrain:river-cells', async (_e: IpcMainInvokeEvent, p: RiverCellsPayload): Promise<PaintTileResult> => {
    const session = need();
    record(session, p.value ? 'paint river' : 'erase river', { floors: [p.floor] },
      () => terrainDoc(session, p.floor).setRiverCells(p.cells, p.value));
    return { ok: true };
  });

  // --- IPC: the passability mask (the original editor's Masks tab) ---
  ipcMain.handle('terrain:mask', async (_e: IpcMainInvokeEvent, p: MaskPayload): Promise<PaintTileResult> => {
    const session = need();
    record(session, p.walkable ? 'unblock tiles' : 'block tiles', { floors: [p.floor] },
      () => terrainDoc(session, p.floor).setPassable(p.verts, p.walkable));
    return { ok: true };
  });

  // --- IPC: give this map a layer for a tile it does not carry ---
  // The only terrain edit that changes the file's structure rather than its
  // bytes, so it is a deliberate action rather than something a brush stroke
  // triggers. Returns a rebuilt splat: one more layer means a new shader and new
  // mask groups, which the renderer cannot patch in place.
  ipcMain.handle('terrain:add-layer', async (_e: IpcMainInvokeEvent, p: AddLayerPayload): Promise<AddLayerResult> => {
    const session = need();
    const doc = terrainDoc(session, p.floor);
    // Two documents, one edit: the layer goes into the terrain, and the map's own
    // tile set has to name the tile as well (see syncMapTiles). Recorded together
    // so undo takes both back.
    record(session, 'add ground layer', { map: true, floors: [p.floor] }, () => {
      doc.addLayer(p.tile);
      syncMapTiles(session, doc.layerPaths().filter((x): x is string => !!x));
    });
    const paths = doc.layerPaths().filter((x) => x);
    // Keep the palette's "already in this map" markers in step for every floor.
    session.layerPaths = [...new Set([...session.layerPaths, ...paths])];
    return { ok: true, splat: splatFor(doc.buffer(), session.assets), inMap: paths };
  });

  ipcMain.handle('terrain:tiles', async (): Promise<TerrainTilesResult> => {
    const { session } = state;
    const root = session?.assetRoot
      || (existsSync(join(gameData(), 'MapObjects')) ? gameData() : null);
    if (!root) return { tiles: [], inMap: [] };
    if (!tileCache || tileCache.root !== root) tileCache = { root, tiles: listTiles(session?.assets ?? mountedAssets(root)) };
    const inMap = session?.layerPaths || [];
    return { tiles: tileCache.tiles, inMap };
  });
}

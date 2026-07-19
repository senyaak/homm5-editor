// Electron main process — the editor's backend. Owns the map model and the file
// system; the renderer is a thin 3D/UI client that talks to it over IPC.
//
// Responsibilities:
//   * open a map (locate its asset root, decode terrain + object meshes),
//   * hold the authoritative HommMap model in memory,
//   * apply edits from the renderer (move objects) through the model,
//   * save map.xdb (byte-faithful) and pack the map folder into a .h5m,
//   * report project status (dirty vs last pack, editor-version drift).
//
// Everything file-format lives in ../src (shared with the CLI tools). This file
// is only wiring: window creation + IPC handlers.

import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, relative, sep } from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { buildScene, findAssetRoot, listTiles, splatFor, pngDataUri } from '../src/scene.ts';
import { listPlaceable, findEditorRoot, iconPathFor, readIconFile } from '../src/objects.ts';
import { initProject, packProject, status } from '../src/project.ts';
import { watchMapDir } from '../src/watch.ts';
import { donorFor } from '../src/donors.ts';
import type { MapWatch } from '../src/watch.ts';
import { TerrainDoc } from '../src/terrain-edit.ts';
import type { TileInfo, GeomResolver } from '../src/scene.ts';
import type { HommMap, MapObject } from '../src/map.ts';
import type {
  MapsListResult, MapListEntry, MapLoadResult, MoveObjectPayload, MoveObjectResult,
  RotateObjectPayload, RemoveObjectPayload, ObjectEditResult, ObjectPropsResult, SetPropPayload,
  ObjectCatalogResult, IconPayload, IconResult, AddObjectPayload, AddObjectResult,
  MapSaveResult, MapPackResult, TerrainTilesResult, MapStatusResult, OpenMapDialogResult,
  ExternalChange, PaintTilePayload, PaintTileResult, SculptPayload, SculptResult,
  AddLayerPayload, AddLayerResult, PaintRiverPayload, MaskPayload,
} from './ipc.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// The game-data root: where object models/textures (MapObjects/, bin/Geometries/)
// live. A .h5m map archive does NOT contain these — they ship in the game's
// data.pak — so we always resolve assets against this root, not against the map
// folder. Defaults to the unpacked samples; overridable via HOMM5_DATA.
const GAME_DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'samples', 'paks', 'data');

/** The map currently open for editing, with everything derived at load time. */
interface Session {
  /** Absolute path to the open map.xdb. */
  mapPath: string;
  /** Folder holding map.xdb — the project dir for status()/packProject(). */
  mapDir: string;
  /** Unpacked data root the meshes and textures were resolved against. */
  assetRoot: string;
  /** Authoritative in-memory model; edits go through it and save() re-emits it. */
  map: HommMap;
  /** Tile paths this map's terrain has splat layers for (union over floors). */
  layerPaths: string[];
  /** Watches mapDir for edits made by another editor. */
  watch: MapWatch;
  /** Editable terrain per floor, opened lazily on the first brush stroke. */
  terrain: Map<number, TerrainDoc>;
  /** Kept alive so an object placed later can be meshed without a full rebuild. */
  resolver: GeomResolver;
}

/** Terrain file backing each floor index. */
const TERRAIN_FILE = ['GroundTerrain.bin', 'UndergroundTerrain.bin'];

/** The open terrain document for a floor, opened on first use. */
function terrainDoc(s: Session, floor: number): TerrainDoc {
  const cached = s.terrain.get(floor);
  if (cached) return cached;
  const file = TERRAIN_FILE[floor];
  if (!file) throw new Error(`no terrain file for floor ${floor}`);
  const doc = TerrainDoc.open(join(s.mapDir, file));
  s.terrain.set(floor, doc);
  return doc;
}

// Where the editor's own config lives: MapFilters.xml and IconCache.
//
// This is NOT under the data root. The link files that make up the object
// catalogue are game data and ship inside the paks, while the filter list and
// the icon cache are loose beside the game install — so the two roots are
// genuinely separate and neither implies the other.
//
// HOMM5_ROOT (the game folder) is the direct way to say where it is; the walk
// upwards is the fallback for when nobody said. start-editor.bat sets it, since
// the repo lives inside the game folder and therefore already knows.
const GAME_ROOT = process.env.HOMM5_ROOT || null;
const EDITOR_ROOT = process.env.HOMM5_EDITOR
  || (GAME_ROOT ? findEditorRoot(GAME_ROOT) : null)
  || findEditorRoot(GAME_DATA);

/** The object catalogue, scanned once — 1466 small files is not a per-call cost. */
let catalogCache: ReturnType<typeof listPlaceable> | null = null;
function catalog(): ReturnType<typeof listPlaceable> {
  if (!catalogCache) catalogCache = listPlaceable(GAME_DATA, EDITOR_ROOT || '');
  return catalogCache;
}

// Current editing session (one map at a time for now).
let session: Session | null = null;
let win: BrowserWindow | null = null;
let lastDir = existsSync(join(GAME_DATA, 'Maps')) ? join(GAME_DATA, 'Maps') : GAME_DATA;

function createWindow(): void {
  // Fit the work area rather than insisting on 1400x900. On a smaller or scaled
  // display that size hangs off the right edge, and what hangs off is the
  // right-hand panel — the palettes — so a chunk of the UI is simply not there.
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1400, area.width), height: Math.min(900, area.height),
    center: true,
    backgroundColor: '#0d1014',
    title: 'homm5-editor',
    webPreferences: {
      // Stays .cjs: Electron's preload loader does not strip types (see preload.cjs).
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Hoisted so the rest of the function sees a non-null window without
  // re-narrowing the mutable module-level `win` after every call.
  const w = win;
  w.setMenuBarVisibility(false);
  w.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Dev smoke test: HOMM5_SMOKE=<map.xdb> loads a map through the real pipeline
  // and exits, so CI/headless can verify the backend without clicking.
  if (process.env.HOMM5_SMOKE) runSmoke(process.env.HOMM5_SMOKE);
});

async function runSmoke(mapPath: string): Promise<void> {
  try {
    const assetRoot = findAssetRoot(mapPath);
    if (!assetRoot) throw new Error(`asset root not found above ${mapPath}`);
    const { map, scene, skipped, resolver } = buildScene(assetRoot, mapPath);
    initProject(dirname(mapPath));
    const placed = scene.floors.reduce((a, f) => a + f.instances.length, 0);
    console.log(`SMOKE ok: ${map.tileX}x${map.tileY}, geoms ${scene.geoms.length}, floors ${scene.floors.length}, placed ${placed}, skipped ${skipped}`);
    app.exit(0);
  } catch (e) { console.error('SMOKE fail:', e instanceof Error ? e.message : String(e)); app.exit(1); }
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { session?.watch.stop(); });

// --- IPC: list openable maps under the game-data root ---
// A map is "openable" when its folder has both map.xdb and GroundTerrain.bin.
// This powers the in-window picker so users don't have to hunt for files.
ipcMain.handle('maps:list', async (): Promise<MapsListResult> => {
  const mapsDir = join(GAME_DATA, 'Maps');
  if (!existsSync(mapsDir)) return { root: GAME_DATA, maps: [] };
  const maps: MapListEntry[] = [];
  const walk = (dir: string): void => {
    let ents: string[];
    try { ents = readdirSync(dir); } catch { return; }
    if (ents.includes('map.xdb') && ents.includes('GroundTerrain.bin')) {
      const rel = relative(mapsDir, dir).split(sep).join('/');
      maps.push({ name: basename(dir), rel, path: join(dir, 'map.xdb') });
    }
    for (const e of ents) {
      const full = join(dir, e);
      try { if (statSync(full).isDirectory()) walk(full); } catch { /* skip */ }
    }
  };
  walk(mapsDir);
  maps.sort((a, b) => a.rel.localeCompare(b.rel));
  return { root: GAME_DATA, maps };
});

// --- IPC: open a map file via the OS dialog (starts in the last-used folder) ---
ipcMain.handle('dialog:openMap', async (): Promise<OpenMapDialogResult> => {
  const opts = {
    title: 'Open map.xdb',
    defaultPath: lastDir,
    properties: ['openFile' as const],
    filters: [{ name: 'HoMM5 map', extensions: ['xdb'] }],
  };
  // Electron treats a null parent as "no parent"; pick the overload to match.
  const parent = win;
  const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  return r.canceled ? null : r.filePaths[0];
});

// --- IPC: load a map -> decode into a renderable scene ---
ipcMain.handle('map:load', async (_e: IpcMainInvokeEvent, mapPath: string): Promise<MapLoadResult> => {
  // Assets normally sit above the map; if not (e.g. a map extracted on its own),
  // fall back to the configured game-data root.
  let assetRoot = findAssetRoot(mapPath);
  if (!assetRoot && (existsSync(join(GAME_DATA, 'MapObjects')) || existsSync(join(GAME_DATA, 'bin', 'Geometries'))))
    assetRoot = GAME_DATA;
  if (!assetRoot) throw new Error('asset root not found (need MapObjects/ or bin/Geometries/ above the map, or set HOMM5_DATA)');
  lastDir = dirname(mapPath);
  const mapDir = dirname(mapPath);
  const { map, scene, skipped, resolver } = buildScene(assetRoot, mapPath);
  initProject(mapDir); // ensure a manifest so status/pack work
  // Tile paths this map's terrain actually has layers for (union over floors).
  const layerPaths = [...new Set(scene.floors.flatMap((f) => f.splat?.paths || []))];
  // Reloading the same map replaces the session, so retire the previous watcher
  // before starting one on the new folder.
  session?.watch.stop();
  const watch = watchMapDir(mapDir, (c) => {
    const touched = [...c.changed, ...c.added, ...c.removed];
    const payload: ExternalChange = {
      mapPath,
      changed: c.changed, added: c.added, removed: c.removed,
      map: touched.some((f) => /(^|\/)map\.xdb$/i.test(f)),
      terrain: touched.some((f) => /(^|\/)GroundTerrain\.bin$/i.test(f)),
    };
    win?.webContents.send('map:external-change', payload);
  });
  session = { mapPath, mapDir, assetRoot, map, layerPaths, watch, terrain: new Map(), resolver };
  const placed = scene.floors.reduce((a, f) => a + f.instances.length, 0);
  return {
    scene,
    info: {
      name: basename(mapDir),
      mapPath,
      tileX: map.tileX, tileY: map.tileY,
      counts: map.typeCounts(),
      floors: scene.floors.map((f) => ({ name: f.name, objects: f.instances.length })),
      placed,
      skipped,
    },
    status: status(mapDir),
  };
});

// --- IPC: move an object (x,y tiles); z stays the object's stored value ---
ipcMain.handle('object:move', async (_e: IpcMainInvokeEvent, { id, x, y }: MoveObjectPayload): Promise<MoveObjectResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = session.map.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`object ${id} not found`);
  obj.setPos(x, y);
  return { ok: true };
});

/** The object with this id, or a throw naming the id that was not found. */
function findObject(s: Session, id: string): MapObject {
  const obj = s.map.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`object ${id} not found`);
  return obj;
}

// --- IPC: rotate an object ---
// An absolute angle rather than a delta, for the same reason the height brush
// sends absolute heights: the renderer already worked out the answer, and
// recomputing it here would be a second place for it to come out different.
ipcMain.handle('object:rotate', async (_e: IpcMainInvokeEvent, { id, r }: RotateObjectPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  findObject(session, id).setRot(r);
  return { ok: true };
});

// --- IPC: the placeable-object catalogue (the original's Objects tab) ---
//
// Two different roots, deliberately. The link files are game DATA, so they come
// from the same unpacked root as every other asset; the filter list and icons
// are editor CONFIG and live loose beside the game install, outside the paks.
// A machine with the game installed but no unpacked data has icons and no
// catalogue, and the other way round — so neither is assumed present.
ipcMain.handle('objects:list', async (): Promise<ObjectCatalogResult> => {
  const cat = catalog();
  return {
    objects: cat.objects,
    groups: cat.groups.map((g) => ({ name: g.name, separator: g.separator })),
    hasEditor: !!EDITOR_ROOT,
  };
});

// --- IPC: one palette icon, decoded on demand ---
// 1466 icons at 64x64 RGBA would be ~24 MB pushed across the bridge for a panel
// showing a few dozen at a time, so they are fetched per tile as it scrolls in.
ipcMain.handle('objects:icon', async (_e: IpcMainInvokeEvent, { path }: IconPayload): Promise<IconResult> => {
  if (!EDITOR_ROOT) return null;
  const file = iconPathFor(EDITOR_ROOT, path);
  if (!file) return null;
  try {
    const icon = readIconFile(readFileSync(file));
    // A few entries hold an image declared 0x0 — a placeholder with no picture.
    return icon ? pngDataUri(icon.w, icon.h, icon.rgba) : null;
  } catch { return null; }
});

// --- IPC: place a new object ---
// The model writes the map side; the mesh is resolved here so the renderer can
// show it at once. A model the scene has not seen before is sent along with the
// instance, since the renderer's geometry list is built at load time.
ipcMain.handle('object:add', async (_e: IpcMainInvokeEvent, p: AddObjectPayload): Promise<AddObjectResult> => {
  if (!session) throw new Error('no map loaded');
  const before = session.resolver.geoms.length;
  const gi = session.resolver.resolve(p.shared);
  if (gi < 0) throw new Error('this object has no model we can decode yet');
  // When this map has no object of the type to copy, borrow one from the
  // game's own maps rather than writing a half-empty skeleton.
  const donor = donorFor(GAME_DATA, p.type);
  const { object, complete } = session.map.addObject({
    type: p.type, shared: p.shared, x: p.x, y: p.y, floor: p.floor, r: p.r ?? 0,
    ...(donor ? { donor } : {}),
  });
  const geomData = session.resolver.geoms[gi];
  return {
    instance: {
      id: object.id, type: object.type, g: gi, shared: p.shared.split('#')[0]!,
      x: p.x, y: p.y, z: 0, r: p.r ?? 0,
    },
    geom: gi >= before && geomData ? { index: gi, data: geomData } : null,
    complete,
  };
});

// --- IPC: an object's simple fields, for the property panel ---
ipcMain.handle('object:props', async (_e: IpcMainInvokeEvent, { id }: RemoveObjectPayload): Promise<ObjectPropsResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, id);
  return { type: obj.type, props: obj.props() };
});

// --- IPC: set one simple field ---
ipcMain.handle('object:set-prop', async (_e: IpcMainInvokeEvent, p: SetPropPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  if (!findObject(session, p.id).setProp(p.name, p.value)) {
    throw new Error(`${p.name} is not a simple field of this object`);
  }
  return { ok: true };
});

// --- IPC: delete an object ---
// `remove` takes out the whole <Item> wrapper and the blank line after it, so
// the surrounding XML is left exactly as it was. There is no undo yet, so this
// is only reversible by not saving.
ipcMain.handle('object:remove', async (_e: IpcMainInvokeEvent, { id }: RemoveObjectPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  if (!session.map.remove(findObject(session, id))) throw new Error(`could not remove ${id}`);
  return { ok: true };
});

// --- IPC: paint a ground tile over a set of vertices ---
// The renderer has already painted its own copy for immediate feedback; this is
// the authoritative write. Only tiles the map has a layer for can be painted —
// adding a layer means restructuring the .bin (see src/terrain.ts).
ipcMain.handle('terrain:paint', async (_e: IpcMainInvokeEvent, p: PaintTilePayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  terrainDoc(session, p.floor).paintTile(p.tile, p.verts, p.strength ?? 255);
  return { ok: true };
});

// --- IPC: raise/lower vertices ---
// The payload carries final heights and flags, not an operation, so this is a
// plain assignment. Flags travel with heights because the format ties them: a
// bed dug to 0 is water, and raising it off 0 makes it ground again.
ipcMain.handle('terrain:sculpt', async (_e: IpcMainInvokeEvent, p: SculptPayload): Promise<SculptResult> => {
  if (!session) throw new Error('no map loaded');
  terrainDoc(session, p.floor).setVertices(p.verts, p.heights, p.flags);
  return { ok: true };
});

// --- IPC: paint a river ---
// Mask, river plane and heights in one message: a river whose plane is unset is
// only paint as far as the game is concerned, and one whose bed was not sunk
// sits on top of its own banks. Applying them separately would leave the file
// briefly — or on a failure, permanently — inconsistent.
ipcMain.handle('terrain:paint-river', async (_e: IpcMainInvokeEvent, p: PaintRiverPayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  const doc = terrainDoc(session, p.floor);
  doc.paintTile(p.tile, p.verts);
  doc.setRiver(p.verts);
  doc.setVertices(p.heightVerts, p.heights, null);
  return { ok: true };
});

// --- IPC: the passability mask (the original editor's Masks tab) ---
ipcMain.handle('terrain:mask', async (_e: IpcMainInvokeEvent, p: MaskPayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  terrainDoc(session, p.floor).setPassable(p.verts, p.walkable);
  return { ok: true };
});

// --- IPC: give this map a layer for a tile it does not carry ---
// The only terrain edit that changes the file's structure rather than its
// bytes, so it is a deliberate action rather than something a brush stroke
// triggers. Returns a rebuilt splat: one more layer means a new shader and new
// mask groups, which the renderer cannot patch in place.
ipcMain.handle('terrain:add-layer', async (_e: IpcMainInvokeEvent, p: AddLayerPayload): Promise<AddLayerResult> => {
  if (!session) throw new Error('no map loaded');
  const doc = terrainDoc(session, p.floor);
  doc.addLayer(p.tile);
  const paths = doc.layerPaths().filter((x) => x);
  // Keep the palette's "already in this map" markers in step for every floor.
  session.layerPaths = [...new Set([...session.layerPaths, ...paths])];
  return { ok: true, splat: splatFor(doc.buffer(), session.assetRoot), inMap: paths };
});

/** Flush every terrain document that has unsaved brush work. */
function saveTerrain(s: Session): void {
  for (const doc of s.terrain.values()) if (doc.dirty) doc.save();
}

// --- IPC: save map.xdb (latin1 preserves the original bytes) ---
ipcMain.handle('map:save', async (): Promise<MapSaveResult> => {
  if (!session) throw new Error('no map loaded');
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  saveTerrain(session);
  // Our own write — fold it into the watcher's baseline so it isn't reported
  // back to us as somebody else's edit.
  session.watch.resync();
  return { ok: true, status: status(session.mapDir) };
});

// --- IPC: pack the map folder into a .h5m ---
ipcMain.handle('map:pack', async (): Promise<MapPackResult> => {
  if (!session) throw new Error('no map loaded');
  const opts = {
    title: 'Pack map to .h5m',
    defaultPath: session.mapDir + '.h5m',
    filters: [{ name: 'HoMM5 map', extensions: ['h5m'] }],
  };
  // Electron treats a null parent as "no parent"; pick the overload to match.
  const parent = win;
  const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
  if (r.canceled) return { canceled: true };
  // Save pending edits first so the archive reflects them.
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  saveTerrain(session);
  session.watch.resync();
  const res = packProject(session.mapDir, r.filePath);
  return { ok: true, output: r.filePath, entries: res.entries, bytes: res.bytes, status: status(session.mapDir) };
});

// --- IPC: the ground-tile palette (terrain brushes) ---
// Decoding 80+ tile textures takes ~1s, and the set never changes while the app
// runs, so it's built once and reused. `inMap` marks the tiles this map's
// terrain already has a layer for — those are the ones paintable without
// restructuring the .bin.
let tileCache: { root: string; tiles: TileInfo[] } | null = null;
ipcMain.handle('terrain:tiles', async (): Promise<TerrainTilesResult> => {
  const root = session?.assetRoot
    || (existsSync(join(GAME_DATA, 'MapObjects')) ? GAME_DATA : null);
  if (!root) return { tiles: [], inMap: [] };
  if (!tileCache || tileCache.root !== root) tileCache = { root, tiles: listTiles(root) };
  const inMap = session?.layerPaths || [];
  return { tiles: tileCache.tiles, inMap };
});

// --- IPC: project status (drift vs last pack) ---
ipcMain.handle('map:status', async (): Promise<MapStatusResult> => {
  if (!session) return null;
  return status(session.mapDir);
});

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

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, relative, sep } from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { buildScene, findAssetRoot, listTiles } from '../src/scene.ts';
import { initProject, packProject, status } from '../src/project.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// The game-data root: where object models/textures (MapObjects/, bin/Geometries/)
// live. A .h5m map archive does NOT contain these — they ship in the game's
// data.pak — so we always resolve assets against this root, not against the map
// folder. Defaults to the unpacked samples; overridable via HOMM5_DATA.
const GAME_DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'samples', 'paks', 'data');

// Current editing session (one map at a time for now).
let session = null; // { mapPath, mapDir, assetRoot, map }
let win = null;
let lastDir = existsSync(join(GAME_DATA, 'Maps')) ? join(GAME_DATA, 'Maps') : GAME_DATA;

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900,
    backgroundColor: '#0d1014',
    title: 'homm5-editor',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Dev smoke test: HOMM5_SMOKE=<map.xdb> loads a map through the real pipeline
  // and exits, so CI/headless can verify the backend without clicking.
  if (process.env.HOMM5_SMOKE) runSmoke(process.env.HOMM5_SMOKE);
});

async function runSmoke(mapPath) {
  try {
    const assetRoot = findAssetRoot(mapPath);
    const { map, scene, skipped } = buildScene(assetRoot, mapPath);
    initProject(dirname(mapPath));
    const placed = scene.floors.reduce((a, f) => a + f.instances.length, 0);
    console.log(`SMOKE ok: ${map.tileX}x${map.tileY}, geoms ${scene.geoms.length}, floors ${scene.floors.length}, placed ${placed}, skipped ${skipped}`);
    app.exit(0);
  } catch (e) { console.error('SMOKE fail:', e.message); app.exit(1); }
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- IPC: list openable maps under the game-data root ---
// A map is "openable" when its folder has both map.xdb and GroundTerrain.bin.
// This powers the in-window picker so users don't have to hunt for files.
ipcMain.handle('maps:list', async () => {
  const mapsDir = join(GAME_DATA, 'Maps');
  if (!existsSync(mapsDir)) return { root: GAME_DATA, maps: [] };
  const maps = [];
  const walk = (dir) => {
    let ents;
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
ipcMain.handle('dialog:openMap', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open map.xdb',
    defaultPath: lastDir,
    properties: ['openFile'],
    filters: [{ name: 'HoMM5 map', extensions: ['xdb'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// --- IPC: load a map -> decode into a renderable scene ---
ipcMain.handle('map:load', async (_e, mapPath) => {
  // Assets normally sit above the map; if not (e.g. a map extracted on its own),
  // fall back to the configured game-data root.
  let assetRoot = findAssetRoot(mapPath);
  if (!assetRoot && (existsSync(join(GAME_DATA, 'MapObjects')) || existsSync(join(GAME_DATA, 'bin', 'Geometries'))))
    assetRoot = GAME_DATA;
  if (!assetRoot) throw new Error('asset root not found (need MapObjects/ or bin/Geometries/ above the map, or set HOMM5_DATA)');
  lastDir = dirname(mapPath);
  const mapDir = dirname(mapPath);
  const { map, scene, skipped } = buildScene(assetRoot, mapPath);
  initProject(mapDir); // ensure a manifest so status/pack work
  // Tile paths this map's terrain actually has layers for (union over floors).
  const layerPaths = [...new Set(scene.floors.flatMap((f) => f.splat?.paths || []))];
  session = { mapPath, mapDir, assetRoot, map, layerPaths };
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
ipcMain.handle('object:move', async (_e, { id, x, y }) => {
  if (!session) throw new Error('no map loaded');
  const obj = session.map.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`object ${id} not found`);
  obj.setPos(x, y);
  return { ok: true };
});

// --- IPC: save map.xdb (latin1 preserves the original bytes) ---
ipcMain.handle('map:save', async () => {
  if (!session) throw new Error('no map loaded');
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  return { ok: true, status: status(session.mapDir) };
});

// --- IPC: pack the map folder into a .h5m ---
ipcMain.handle('map:pack', async () => {
  if (!session) throw new Error('no map loaded');
  const r = await dialog.showSaveDialog(win, {
    title: 'Pack map to .h5m',
    defaultPath: session.mapDir + '.h5m',
    filters: [{ name: 'HoMM5 map', extensions: ['h5m'] }],
  });
  if (r.canceled) return { canceled: true };
  // Save pending edits first so the archive reflects them.
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  const res = packProject(session.mapDir, r.filePath);
  return { ok: true, output: r.filePath, entries: res.entries, bytes: res.bytes, status: status(session.mapDir) };
});

// --- IPC: the ground-tile palette (terrain brushes) ---
// Decoding 80+ tile textures takes ~1s, and the set never changes while the app
// runs, so it's built once and reused. `inMap` marks the tiles this map's
// terrain already has a layer for — those are the ones paintable without
// restructuring the .bin.
let tileCache = null;
ipcMain.handle('terrain:tiles', async () => {
  const root = session?.assetRoot
    || (existsSync(join(GAME_DATA, 'MapObjects')) ? GAME_DATA : null);
  if (!root) return { tiles: [], inMap: [] };
  if (!tileCache || tileCache.root !== root) tileCache = { root, tiles: listTiles(root) };
  const inMap = session?.layerPaths || [];
  return { tiles: tileCache.tiles, inMap };
});

// --- IPC: project status (drift vs last pack) ---
ipcMain.handle('map:status', async () => {
  if (!session) return null;
  return status(session.mapDir);
});

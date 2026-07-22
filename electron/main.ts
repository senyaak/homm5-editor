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
import { dirname, join, basename, relative, resolve, sep, isAbsolute } from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildScene, findAssetRoot, listTiles, splatFor, pngDataUri } from '../src/scene.ts';
import { listPlaceable, findEditorRoot, iconPathFor, readIconFile } from '../src/objects.ts';
import { initProject, openProject, packProject, readManifest, writeManifest, status, pickMapRel, MANIFEST_NAME } from '../src/project.ts';
import { listDirFiles } from '../src/pak.ts';
import { watchMapDir } from '../src/watch.ts';
import { donorFor } from '../src/donors.ts';
import type { MapWatch } from '../src/watch.ts';
import { TerrainDoc } from '../src/terrain-edit.ts';
import { History, diff, apply } from '../src/history.ts';
import { loadMap } from '../src/map.ts';
import { createField } from '../src/defaults.ts';
import { buildNewMapProject } from '../src/new-map.ts';
import { MAP_SIZES } from '../src/terrain-blank.ts';
import { Registry } from '../src/registry.ts';
import type { RosterEntry } from '../src/registry.ts';
import type { RegistryName, FieldSchema } from '../src/schema.ts';
import { readTypeSpec, fieldOrder, typesXmlPath, fieldValues } from '../src/typespec.ts';
import type { FieldOrder, SpecType } from '../src/typespec.ts';
import { readTree, setPath, addStringItem, removeItem, appendItem, indentText, nodeAt, setList } from '../src/tree.ts';
import { mapSchema, resolveSchemaAtPath, deref, schemaForClass, objectProps, objectSchema, controlOf } from '../src/schema.ts';
import { buildItem, isBuildable, buildEntity } from '../src/skeleton.ts';
import { children, find, text, serialize, parse } from '../src/xml.ts';
import type { XmlElement, XmlNode } from '../src/xml.ts';
import type { DocPatch, Step, StoredHistory } from '../src/history.ts';
import type { TileInfo, GeomResolver, Instance as SceneInstance } from '../src/scene.ts';
import type { HommMap, MapObject, ObjectProp } from '../src/map.ts';
import type {
  MapsListResult, MapListEntry, MapLoadResult, MoveObjectPayload, MoveObjectResult,
  RotateObjectPayload, RemoveObjectPayload, ObjectEditResult, ObjectPropsResult, SetPropPayload,
  SpecValuesPayload, SpecValuesResult,
  MapPropsResult, SetMapPropPayload, RosterPayload, RosterResult, OfClassPayload, NewEntityPayload, NewEntityResult,
  EntityReadPayload, EntityReadResult, EntitySetPathPayload, PickTextResult, EntityCopyPayload, EntityCopyResult,
  SuggestNamePayload, SuggestNameResult,
  MapTreeResult, SetPathPayload, AddItemPayload, RemoveItemPayload2, SetListPayload, NamesPayload, NamesResult,
  ReadFilePayload, ReadFileResult, WriteFilePayload,
  ObjectCatalogResult, IconPayload, IconResult, AddObjectPayload, AddObjectResult,
  MapSaveResult, MapPackResult, TerrainTilesResult, MapStatusResult, OpenMapDialogResult,
  NewMapPayload, NewMapResult, OpenArchivePayload, OpenArchiveResult,
  ExternalChange, PaintTilePayload, PaintTileResult, SculptPayload, SculptResult,
  AddLayerPayload, AddLayerResult, PaintRiverPayload, RiverCellsPayload, MaskPayload, UndoResult, HistoryState,
} from './ipc.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// [perf] Windows-only Chromium bug: the native occlusion calculator intermittently
// decides a fully visible window is covered and throttles its compositor to a
// crawl for the rest of the session — the "sometimes the whole editor goes
// slow-motion, and alt-tab fixes it" symptom (a focus change resets the state).
// Turning the feature off is the standard workaround and costs nothing here: we
// only ever run one visible window. Must be set before app is ready.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// The game-data root: where object models/textures (MapObjects/, bin/Geometries/)
// live. A .h5m map archive does NOT contain these — they ship in the game's
// data.pak — so we always resolve assets against this root, not against the map
// folder. Defaults to the unpacked data tree; overridable via HOMM5_DATA.
const GAME_DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');

// Scratch space: unpacked archives, undo history — everything the editor keeps
// for itself. In the editor's own folder rather than the OS's app-data corner,
// so it is findable, inspectable, and deletable without hunting for it. Nothing
// in here is precious: it is all rebuildable from the archives it came from.
const TMP_ROOT = join(REPO_ROOT, '_tmp');

/** Unpacked archives, one folder per archive. */
const WORKSPACES = join(TMP_ROOT, 'workspaces');

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
  /** Undo/redo, as byte patches over the documents this session owns. */
  history: History;
  /** Where this map's history is kept between runs. */
  historyPath: string;
  /** Game-data rosters for the typed-editing pickers, resolved against assetRoot. */
  registry: Registry;
}

/** Documents an edit may touch: the map, some floors' terrain, or both. */
interface Touches { map?: boolean; floors?: number[] }

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
function record<T>(s: Session, label: string, touches: Touches, fn: () => T): T {
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
function applyStep(s: Session, step: Step, dir: 'undo' | 'redo'): Touches {
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
function historyPathFor(mapDir: string): string {
  // NOT inside the map folder: packProject sweeps every file in there into the
  // .h5m, and an editor's undo log has no business shipping inside a map.
  const key = createHash('sha1').update(mapDir).digest('hex').slice(0, 16);
  return join(TMP_ROOT, 'history', `${key}.json`);
}

function saveHistory(s: Session): void {
  try {
    mkdirSync(dirname(s.historyPath), { recursive: true });
    writeFileSync(s.historyPath, JSON.stringify(s.history.save(docsHash(s))));
  } catch { /* a history that cannot be written is not a reason to fail an edit */ }
}

function loadHistory(s: Session): void {
  try {
    if (!existsSync(s.historyPath)) return;
    const stored = JSON.parse(readFileSync(s.historyPath, 'utf8')) as StoredHistory;
    s.history.restore(stored, docsHash(s));
  } catch { /* an unreadable history is dropped, not repaired */ }
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
      // The render loop drives the whole editor; never let Chromium throttle its
      // rAF/timers because it thinks the window is backgrounded. Pairs with the
      // occlusion switch above.
      backgroundThrottling: false,
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
      // Packed maps count as openable too — the game reads .h5m, so a map that
      // has been packed and its folder tidied away is often the only copy left.
      // Opening one unpacks it first (map:open-archive).
      if (/\.h5m$/i.test(e)) {
        const rel = relative(mapsDir, dir).split(sep).join('/');
        maps.push({ name: e, rel: rel ? `${rel}/${e}` : e, path: full, archive: true });
        continue;
      }
      try { if (statSync(full).isDirectory()) walk(full); } catch { /* skip */ }
    }
  };
  // [perf] The first screen. This walks the whole Maps tree with a stat() per
  // entry, so on a cold disk cache (first launch after a boot) it can run long
  // and varies run to run — a prime suspect for the intermittent startup lag.
  const tWalk = performance.now();
  walk(mapsDir);
  console.log(`[perf] maps:list ${(performance.now() - tWalk) | 0}ms · ${maps.length} maps`);
  maps.sort((a, b) => a.rel.localeCompare(b.rel));
  return { root: GAME_DATA, maps };
});

// --- IPC: open a map file via the OS dialog (starts in the last-used folder) ---
ipcMain.handle('dialog:openMap', async (): Promise<OpenMapDialogResult> => {
  const opts = {
    title: 'Open a map',
    defaultPath: lastDir,
    properties: ['openFile' as const],
    // Both halves of the round trip: an unpacked folder's map.xdb, or the .h5m
    // Pack produced from one.
    filters: [
      { name: 'HoMM5 map', extensions: ['xdb', 'h5m', 'h5c', 'h5u'] },
      { name: 'Map folder', extensions: ['xdb'] },
      { name: 'Packed map', extensions: ['h5m', 'h5c', 'h5u'] },
    ],
  };
  // Electron treats a null parent as "no parent"; pick the overload to match.
  const parent = win;
  const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  return r.canceled ? null : r.filePaths[0];
});

// --- IPC: create a blank map from scratch (the original's New Map) ---
//
// Writes a complete project folder under <data>/Maps — where both the original
// editor and our own Pack put maps — and hands back its map.xdb so the renderer
// can open it like any other. The bytes are generated, not copied from a
// template: buildNewMapProject reproduces the original editor's own blank
// export exactly (see tools/test-new-map.ts).
ipcMain.handle('map:new', async (_e: IpcMainInvokeEvent, p: NewMapPayload): Promise<NewMapResult> => {
  const name = p.name.trim();
  if (!name) throw new Error('the map needs a name');
  // The name doubles as a folder name, so it must survive being one.
  if (/[\\/:*?"<>|]/.test(name)) throw new Error('the name cannot contain \\ / : * ? " < > |');
  if (!MAP_SIZES.includes(p.tiles)) throw new Error(`unknown map size ${p.tiles}`);

  // Where the original editor puts them, and where the game looks: a map's path
  // under the data root is also its path inside the .h5m, so getting this right
  // is what makes the packed map findable.
  const mapDir = join(GAME_DATA, 'Maps', p.multiplayer ? 'Multiplayer' : 'SingleMissions', name);
  if (existsSync(mapDir)) throw new Error(`${mapDir} already exists`);

  // The enabled-spell and artifact lists are the game's own, so they follow the
  // installed data (and any mod) rather than a list frozen into the source.
  const registry = new Registry(GAME_DATA);
  const files = buildNewMapProject({
    name,
    tiles: p.tiles,
    twoLevel: p.twoLevel,
    spells: registry.spells().map((s) => s.id),
    artifacts: registry.artifacts().map((a) => a.id),
  });
  mkdirSync(mapDir, { recursive: true });
  for (const f of files) writeFileSync(join(mapDir, f.path), f.data);
  initProject(mapDir); // a manifest, so status/pack work on it immediately
  console.log(`[new] ${mapDir} · ${p.tiles}×${p.tiles}${p.twoLevel ? ' two-level' : ''} · ${files.length} files`);
  return { mapPath: join(mapDir, 'map.xdb'), mapDir };
});

/**
 * The working folder for an archive: one per archive, under the editor's _tmp.
 *
 * NOT beside the archive. A map is normally opened from the game's Maps folder,
 * and unpacking into it drops a folder the game then tries to read as a second
 * copy of the map; worse, the obvious name is the folder the archive was packed
 * FROM, so it would overwrite it. Keyed by the archive's path, so reopening the
 * same map returns to the same workspace — with its unsaved edits and its undo
 * history — instead of accumulating "foo (2)", "foo (3)".
 */
function workspaceFor(archivePath: string): string {
  const key = createHash('sha1').update(resolve(archivePath).toLowerCase()).digest('hex').slice(0, 16);
  return join(WORKSPACES, `${basename(archivePath).replace(/[^\w.-]+/g, '_')}-${key}`);
}

/** Is this workspace still the unpacking of THIS archive, as it stands now? */
function sourceMatches(dir: string, archivePath: string): boolean {
  try {
    const src = readManifest(dir).source;
    if (!src) return false;
    return src.hash === createHash('sha1').update(readFileSync(archivePath)).digest('hex');
  } catch { return false; }
}

/** The folder holding the map inside an unpacked workspace, at any depth. */
function findMapDir(root: string): string | null {
  const rel = pickMapRel(listDirFiles(root));
  return rel ? join(root, ...rel.split('/').slice(0, -1)) : null;
}

/** How many workspaces to keep. Old ones are unpacked copies of archives that
 *  still exist, so losing one costs nothing but the time to unpack it again. */
const KEEP_WORKSPACES = 8;

/**
 * Drop the least recently used workspaces, so the folder does not grow forever.
 *
 * A workspace with unsaved work is never touched, however old: the whole point
 * of keeping the folder is that closing the editor is not the same as throwing
 * the work away.
 */
function pruneWorkspaces(keep: string): void {
  if (!existsSync(WORKSPACES)) return;
  const dirs = readdirSync(WORKSPACES)
    .map((n) => join(WORKSPACES, n))
    .filter((d) => d !== keep && statSync(d).isDirectory())
    .map((d) => ({ d, at: statSync(d).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { d } of dirs.slice(KEEP_WORKSPACES)) {
    try { if (status(findMapDir(d) ?? d).dirty) continue; } catch { /* unreadable — let it go */ }
    rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// --- IPC: open a packed .h5m as an editable project ---
//
// The other half of Pack. A .h5m is a zip of the map folder, so opening one is
// unpacking it beside the archive and then loading the map.xdb that comes out.
// Unpacked, never edited in place: the archive stays exactly as the game got it
// until the user packs again.
//
// The folder is never reused. Packing "Foo" writes Foo.h5m beside the Foo it was
// built from, so unpacking into the name the archive suggests would land on the
// working folder it came from and quietly overwrite whatever is in it; a free
// "Foo (2)" instead keeps both, and which one you are editing stays obvious.
ipcMain.handle('map:open-archive', async (_e: IpcMainInvokeEvent, p: OpenArchivePayload): Promise<OpenArchiveResult> => {
  const archive = p.path;
  if (!existsSync(archive)) throw new Error(`${archive} not found`);
  const mapDir = workspaceFor(archive);

  // Reopening the same archive returns to the same workspace rather than
  // unpacking a second copy beside the first: unsaved work and the undo history
  // are keyed to that folder, so a new one every time would silently drop both.
  // Only when the archive itself has moved on is the workspace rebuilt.
  // The manifest lives with map.xdb, which is usually deeper than the workspace
  // root — the archive's own folder structure is kept as it stands.
  const existing = existsSync(mapDir) ? findMapDir(mapDir) : null;
  if (existing && existsSync(join(existing, MANIFEST_NAME)) && sourceMatches(existing, archive)) {
    console.log(`[open] ${archive} → ${existing} (workspace reused)`);
    return { mapPath: join(existing, 'map.xdb'), mapDir: existing, files: listDirFiles(mapDir).length };
  }
  // Rebuilding: the watcher has the old copy of this very folder open, and on
  // Windows an open handle is enough to make the delete fail.
  if (session && session.mapDir.startsWith(mapDir)) { session.watch.stop(); session = null; }
  rmSync(mapDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  pruneWorkspaces(mapDir);

  // The map is usually NOT at the archive root: members are named by their path
  // under the game's data root ('Maps/SingleMissions/foo/map.xdb'), which is how
  // the game finds them. openProject unpacks that tree as it stands and reports
  // the inner folder holding map.xdb as the project.
  const { files, projectDir } = openProject(archive, mapDir, { mapProject: true });
  const mapPath = join(projectDir, 'map.xdb');
  if (!existsSync(mapPath)) throw new Error(`${basename(archive)} holds no map.xdb (${files.length} files)`);
  console.log(`[open] ${archive} → ${projectDir} · ${files.length} files`);
  return { mapPath, mapDir: projectDir, files: files.length };
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
  // [perf] map:load is the heavy startup step (mesh + texture decode). Timed so
  // an intermittent stall can be pinned to a phase rather than guessed at; grep
  // the terminal for "[perf]".
  const tStart = performance.now();
  const { map, scene, skipped, resolver } = buildScene(assetRoot, mapPath);
  const tScene = performance.now();
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
  session = {
    mapPath, mapDir, assetRoot, map, layerPaths, watch, terrain: new Map(), resolver,
    history: new History(), historyPath: historyPathFor(mapDir),
    registry: new Registry(assetRoot),
  };
  // A history from a previous run is adopted only if the documents still hash
  // to what they hashed when it was written.
  loadHistory(session);
  const placed = scene.floors.reduce((a, f) => a + f.instances.length, 0);
  console.log(`[perf] map:load buildScene ${(tScene - tStart) | 0}ms · total ${(performance.now() - tStart) | 0}ms · geoms ${scene.geoms.length}, placed ${placed}, skipped ${skipped}`);
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
    history: historyState(session),
  };
});

// --- IPC: move an object (x,y tiles); z stays the object's stored value ---
ipcMain.handle('object:move', async (_e: IpcMainInvokeEvent, { id, x, y }: MoveObjectPayload): Promise<MoveObjectResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = session.map.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`object ${id} not found`);
  record(session, 'move object', { map: true }, () => obj.setPos(x, y));
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
  const obj = findObject(session, id);
  record(session, 'rotate object', { map: true }, () => obj.setRot(r));
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
  // [perf] First call scans the Editor folder from disk; warmed in the
  // background after a map opens, so a slow scan here can steal main-process
  // time from early edits. Timed to catch that.
  const tCat = performance.now();
  const cat = catalog();
  const dt = performance.now() - tCat;
  if (dt > 5) console.log(`[perf] objects:list ${dt | 0}ms · ${cat.objects.length} entries`);
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

/**
 * The game's own type spec, read once per run.
 *
 * 2.4 MB of XML, so it is parsed on first use rather than at startup, and only
 * when the data folder actually has it — a data root without types.xml simply
 * means no field can be created, which is the old behaviour.
 */
let typeSpec: Map<string, SpecType> | null | undefined;
const orderCache = new Map<string, FieldOrder | null>();
function orderFor(type: string): FieldOrder | undefined {
  if (typeSpec === undefined) {
    const p = typesXmlPath(GAME_DATA);
    const t0 = performance.now();
    typeSpec = p ? readTypeSpec(p) : null;
    if (p) console.log(`[spec] types.xml ${(performance.now() - t0) | 0}ms · ${typeSpec!.size} types`);
  }
  if (!typeSpec) return undefined;
  if (!orderCache.has(type)) orderCache.set(type, fieldOrder(typeSpec, type));
  return orderCache.get(type) ?? undefined;
}

/**
 * Every field of a type whose values the spec closes, with the full legal set.
 *
 * This is what turns a text box into a dropdown honestly. The panel used to
 * show enum fields as free text, with a comment saying the legal set lives in
 * the game's data and a guessed list would refuse values the game accepts —
 * true then, and the spec is that data. `AttackType` is `ATTACK_ANY` on all
 * 6377 monsters ever shipped, and the type also has `ATTACK_RANGE` and
 * `ATTACK_MELEE`.
 *
 * Cached per type: the parse is 2.4 MB and the answer never changes.
 */
const valuesCache = new Map<string, Record<string, string[]>>();
function valuesFor(type: string): Record<string, string[]> {
  const hit = valuesCache.get(type);
  if (hit) return hit;
  orderFor(type); // parses types.xml on first use
  const out: Record<string, string[]> = {};
  if (typeSpec) {
    // Only the fields our own schema knows about: an option list for a field
    // the editor never shows is payload for nothing.
    for (const name of Object.keys(objectProps(type))) {
      const v = fieldValues(typeSpec, type, name);
      if (v && v.length) out[name] = v;
    }
  }
  valuesCache.set(type, out);
  return out;
}

/**
 * The session's rosters, for the defaults that mean "everything the game has"
 * — a new town's guild-spell filter. Read from the installed data, so a mod's
 * spells are in it and a list frozen into the source would not be.
 */
function rosterFor(s: Session): (name: RegistryName) => string[] {
  return (name) => {
    switch (name) {
      case 'spells': return s.registry.spells().map((e) => e.id);
      case 'artifacts': return s.registry.artifacts().map((e) => e.id);
      case 'creatures': return s.registry.creatures().map((e) => e.id);
      case 'skills': return s.registry.skills().map((e) => e.id);
      case 'races': return s.registry.races().map((e) => e.id);
      default: return [];
    }
  };
}

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
  // Through record(), like every other edit: placing an object grows the map
  // document, and if that growth is not captured as a step then the next undo
  // finds the document a different size than its patch was taken from and throws
  // "patch does not fit". This was the one mutating handler that skipped it.
  const { object, complete } = record(session, 'add object', { map: true }, () =>
    session!.map.addObject({
      type: p.type, shared: p.shared, x: p.x, y: p.y, floor: p.floor, r: p.r ?? 0,
      roster: rosterFor(session!),
      order: orderFor(p.type),
      ...(donor ? { donor } : {}),
    }));
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
/** The editor kind for a field we are describing from the schema alone. */
function kindOf(f: FieldSchema): ObjectProp['kind'] {
  switch (controlOf(f)) {
    case 'checkbox': return 'bool';
    case 'number': return 'number';
    case 'ref': return 'href';
    case 'enum':
    case 'dropdown': return 'enum';
    default: return 'text';
  }
}

/**
 * Fields the type HAS but this object does not carry.
 *
 * An object is built by cloning a real one, so it has whatever field set that
 * donor's game version had — a seer hut from a campaign map has no CheckDelay.
 * The panel could only ever edit what was in the DOM, so such a field could not
 * be set at all. Offering it needs two independent yeses: the GAME'S spec says
 * the type has it (so we are not inventing a field), and our schema describes
 * it (so we know what shape to write).
 */
function absentProps(obj: MapObject): ObjectProp[] {
  const order = orderFor(obj.type);
  if (!order) return [];
  const declared = objectProps(obj.type);
  const out: ObjectProp[] = [];
  for (const name of order.names) {
    if (find(obj.el, name)) continue;
    const raw = declared[name];
    if (!raw) continue;
    const f = deref(objectSchema, raw);
    // Structures are not editable as a value here, in the DOM or out of it.
    if (f.type === 'object' || f.type === 'array') continue;
    out.push({ name, value: '', kind: kindOf(f), absent: true });
  }
  return out;
}

ipcMain.handle('object:props', async (_e: IpcMainInvokeEvent, { id }: RemoveObjectPayload): Promise<ObjectPropsResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, id);
  return { type: obj.type, props: [...obj.props(), ...absentProps(obj)] };
});

// --- IPC: the legal values of a type's enum fields, from the game's spec ---
ipcMain.handle('spec:values', async (_e: IpcMainInvokeEvent, { type }: SpecValuesPayload): Promise<SpecValuesResult> => {
  return { values: valuesFor(type) };
});

// --- IPC: set one simple field ---
ipcMain.handle('object:set-prop', async (_e: IpcMainInvokeEvent, p: SetPropPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, p.id);
  const done = record(session, `set ${p.name}`, { map: true }, () => {
    // Filling in a field the object never had: create it where the spec puts
    // it, then set it like any other. Recorded inside the same step, so undo
    // takes the field away again rather than leaving an empty one behind.
    if (!find(obj.el, p.name)) {
      const order = orderFor(obj.type);
      const raw = order ? objectProps(obj.type)[p.name] : undefined;
      if (!order || !raw) return false;
      if (!createField(obj.el, p.name, order.names, deref(objectSchema, raw)['x-ref'] === true)) return false;
    }
    return obj.setProp(p.name, p.value);
  });
  if (!done) throw new Error(`${p.name} is not a simple field of this object`);
  return { ok: true };
});

// --- IPC: names defined in this map, for x-nameRef autocomplete ---
// A field can reference another entity by the name it was given (an objective's
// Name, an object's Name). These are the names on offer, gathered from the map
// itself so the hints are always current.
ipcMain.handle('map:names', async (_e: IpcMainInvokeEvent, { kind }: NamesPayload): Promise<NamesResult> => {
  if (!session) throw new Error('no map loaded');
  const seen = new Set<string>();
  if (kind === 'object') {
    for (const o of session.map.objects) { const n = text(find(o.el, 'Name')); if (n) seen.add(n); }
  } else {
    // Objective names: the <Name> a list <Item> carries directly, under the two
    // objective containers. Target.Name and the like sit deeper, so are skipped.
    const collect = (el: XmlElement): void => {
      for (const c of children(el)) {
        if (c.name === 'Item') { const n = text(find(c, 'Name')); if (n) seen.add(n); }
        collect(c);
      }
    };
    for (const c of ['ScenarioInformation', 'Objectives']) { const el = find(session.map.desc, c); if (el) collect(el); }
  }
  return { names: [...seen].sort() };
});

// --- IPC: a game-data roster for the typed-editing pickers ---
// Discovered from the data tree (see src/registry.ts) and cached per session, so
// the first request for a roster scans and the rest are instant.
ipcMain.handle('registry:roster', async (_e: IpcMainInvokeEvent, { name }: RosterPayload): Promise<RosterResult> => {
  if (!session) throw new Error('no map loaded');
  const r = session.registry;
  const roster =
    name === 'spells' ? r.spells() :
    name === 'artifacts' ? r.artifacts() :
    name === 'creatures' ? r.creatures() :
    name === 'skills' ? r.skills() :
    name === 'heroes' ? r.heroes() :
    name === 'ambientLights' ? r.ambientLights() :
    name === 'races' ? r.races() :
    name === 'birds' ? r.birds() :
    name === 'winds' ? r.winds() :
    name === 'weathers' ? r.weathers() :
    null;
  if (!roster) throw new Error(`unknown roster "${name}"`);
  return { entries: roster };
});

// Every object of an engine class — the type-constrained browse picker. Same
// discovery as the class-based rosters, but for any class the schema names
// (an object's ${type}Shared, or a header ref's entity class).
ipcMain.handle('objects:of-class', async (_e: IpcMainInvokeEvent, { className }: OfClassPayload): Promise<RosterResult> => {
  if (!session) throw new Error('no map loaded');
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(className)) throw new Error(`bad class "${className}"`);
  return { entries: session.registry.objectsOfClass(className) };
});

// Create a new referenced object beside the map (the original's "Create New
// <Class> Object"). The body is built from the class's schema $def with default
// values; it is written UTF-8 as `Name.(Class).xdb` in the map folder, and the
// href the ref should store is returned. Only classes the schema can build a
// template for are supported — others are picked, not authored here.
ipcMain.handle('map:new-entity', async (_e: IpcMainInvokeEvent, { className, name }: NewEntityPayload): Promise<NewEntityResult> => {
  if (!session) throw new Error('no map loaded');
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(className)) throw new Error(`bad class "${className}"`);
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!clean) throw new Error('name is empty');
  const sc = schemaForClass(className);
  const body = sc ? buildEntity(sc.root, className, deref(sc.root, sc.field), '\n') : null;
  if (!body) throw new Error(`no template for <${className}> — pick an existing one instead`);
  // The new document's script handle: its <Name> (objects) or <InternalName>
  // (library entities) = the given name, never left empty (scripts address
  // objects by this handle — see docs/NAMES_AND_SCRIPTING.md).
  const handle = find(body, 'Name') || find(body, 'InternalName');
  if (handle) { handle.selfClose = false; handle.children = [{ type: 'text', text: clean } as XmlNode]; }
  const file = join(session.mapDir, `${clean}.(${className}).xdb`);
  if (existsSync(file)) throw new Error(`${basename(file)} already exists`);
  writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(body)}\n`, 'utf8');
  session.watch.resync();
  return { href: `${clean}.(${className}).xdb#xpointer(/${className})` };
});

// Suggest a free `Class_00N` handle for a new object of a class — the next
// number not already taken by a `*.(Class).xdb` in the map folder, so New starts
// with a non-empty, non-duplicate name (see docs/NAMES_AND_SCRIPTING.md).
ipcMain.handle('map:suggest-name', async (_e: IpcMainInvokeEvent, { className }: SuggestNamePayload): Promise<SuggestNameResult> => {
  if (!session) throw new Error('no map loaded');
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(className)) throw new Error(`bad class "${className}"`);
  const suffix = `.(${className}).xdb`;
  const taken = new Set<string>();
  try { for (const f of readdirSync(session.mapDir)) if (f.endsWith(suffix)) taken.add(f.slice(0, -suffix.length)); } catch { /* no dir yet */ }
  let n = 1;
  let name = `${className}_${String(n).padStart(3, '0')}`;
  while (taken.has(name)) { n++; name = `${className}_${String(n).padStart(3, '0')}`; }
  return { name };
});

/**
 * Resolve a referenced entity's href to a file, and say whether it can be
 * edited. A library ref is absolute (`/MapObjects/…`, `/Lights/…`) and resolves
 * under the asset root — shipped data, read-only. A map-local ref is a bare
 * basename beside map.xdb — the map's own document, editable.
 */
function resolveEntityFile(s: Session, href: string): { file: string; editable: boolean } | null {
  const noPtr = href.split('#')[0];
  if (!noPtr) return null;
  if (noPtr.startsWith('/')) return { file: join(s.assetRoot, noPtr.slice(1)), editable: false };
  return { file: join(s.mapDir, basename(noPtr)), editable: true };
}

// --- IPC: read/edit a referenced entity document (Birds/Wind/AmbientLight…) ---
// The original's "Edit" on a structured ref opens the referenced object's own
// typed fields. These back that: read the document as a tree (like the map
// tree), and — for a map-local document — set one field and write it back. The
// shipped library is read-only; to change one you save a copy in the map folder.
ipcMain.handle('entity:read', async (_e: IpcMainInvokeEvent, { href }: EntityReadPayload): Promise<EntityReadResult> => {
  if (!session) throw new Error('no map loaded');
  const r = resolveEntityFile(session, href);
  if (!r || !existsSync(r.file)) throw new Error(`entity not found: ${href}`);
  const root = children(parse(readFileSync(r.file, 'utf8')))[0];
  if (!root) throw new Error(`empty entity document: ${href}`);
  return { className: root.name, editable: r.editable, tree: readTree(root) };
});
ipcMain.handle('entity:set-path', async (_e: IpcMainInvokeEvent, p: EntitySetPathPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const r = resolveEntityFile(session, p.href);
  if (!r) throw new Error(`bad entity href: ${p.href}`);
  if (!r.editable) throw new Error('this entity is from the shipped library — save a copy in the map to edit it');
  if (!existsSync(r.file)) throw new Error(`entity not found: ${p.href}`);
  const doc = parse(readFileSync(r.file, 'utf8'));
  const root = children(doc)[0];
  if (!root || !setPath(root, p.path, p.value)) throw new Error(`cannot set ${p.path.join('.')}`);
  writeFileSync(r.file, serialize(doc), 'utf8');
  session.watch.resync();
  return { ok: true };
});

// --- IPC: pick an existing text file for a text ref (the "…" on a txt row) ---
// A native OS open-dialog, starting in the map folder. A file chosen from
// elsewhere is copied in beside map.xdb, since a text ref stores a basename.
ipcMain.handle('map:pick-text', async (): Promise<PickTextResult> => {
  if (!session) throw new Error('no map loaded');
  const opts = {
    title: 'Select text file',
    defaultPath: session.mapDir,
    properties: ['openFile' as const],
    filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
  };
  const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
  const src = r.canceled ? undefined : r.filePaths[0];
  if (!src) return { href: '' };
  const dest = join(session.mapDir, basename(src));
  if (src !== dest) { copyFileSync(src, dest); session.watch.resync(); }
  return { href: basename(src) };
});

// --- IPC: copy a shipped-library entity into the map so it can be edited ---
// The library is read-only; this makes an editable map-local twin and hands
// back the href the ref should now point at (keeping the original xpointer).
ipcMain.handle('entity:copy-to-map', async (_e: IpcMainInvokeEvent, { href }: EntityCopyPayload): Promise<EntityCopyResult> => {
  if (!session) throw new Error('no map loaded');
  const r = resolveEntityFile(session, href);
  if (!r || !existsSync(r.file)) throw new Error(`entity not found: ${href}`);
  if (r.editable) return { href }; // already map-local
  const base = basename(r.file);
  const dest = join(session.mapDir, base);
  if (existsSync(dest)) throw new Error(`${base} already exists in the map folder`);
  copyFileSync(r.file, dest);
  session.watch.resync();
  const ptr = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  return { href: base + ptr };
});

// --- IPC: the whole <AdvMapDesc> as a tree, and path-based edits on it ---
// The tree editor reads the map's full shape once, then edits by path. Every
// edit goes through record({map:true}), so the tree shares undo/dirty/save with
// every other edit.
ipcMain.handle('map:tree', async (): Promise<MapTreeResult> => {
  if (!session) throw new Error('no map loaded');
  return { tree: readTree(session.map.desc) };
});
ipcMain.handle('map:set-path', async (_e: IpcMainInvokeEvent, p: SetPathPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const done = record(session, `set ${p.path.join('.')}`, { map: true }, () => setPath(session!.map.desc, p.path, p.value));
  if (!done) throw new Error(`cannot set ${p.path.join('.')}`);
  return { ok: true };
});
ipcMain.handle('map:add-item', async (_e: IpcMainInvokeEvent, p: AddItemPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const desc = session.map.desc;
  // A list of structures (rumours, players, army stacks) gets a full item built
  // from its schema with default values; a list of plain values gets <Item>v</Item>.
  const arrField = resolveSchemaAtPath(mapSchema, p.path);
  const itemSchema = arrField?.items ? deref(mapSchema, arrField.items) : null;
  const done = record(session, `add ${p.path.join('.')}`, { map: true }, () => {
    if (isBuildable(itemSchema)) {
      const container = nodeAt(desc, p.path);
      if (!container) return false;
      return appendItem(desc, p.path, buildItem(mapSchema, itemSchema!, indentText(container)));
    }
    return addStringItem(desc, p.path, p.value ?? '');
  });
  if (!done) throw new Error(`cannot add to ${p.path.join('.')}`);
  return { ok: true };
});
ipcMain.handle('map:remove-item', async (_e: IpcMainInvokeEvent, p: RemoveItemPayload2): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const done = record(session, `remove ${p.path.join('.')}`, { map: true }, () => removeItem(session!.map.desc, p.path));
  if (!done) throw new Error(`cannot remove ${p.path.join('.')}`);
  return { ok: true };
});
ipcMain.handle('map:set-list', async (_e: IpcMainInvokeEvent, p: SetListPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const done = record(session, `set list ${p.path.join('.')}`, { map: true }, () => setList(session!.map.desc, p.path, p.values));
  if (!done) throw new Error(`cannot set list ${p.path.join('.')}`);
  return { ok: true };
});

// --- IPC: the map's own settings (the original's map-properties tree) ---
// Read from map.desc, plus the visible name/description pulled from the sibling
// text files they reference. Those files are shown read-only for now: they are a
// separate document from the in-memory map.xdb, so editing them wants the same
// undo/save plumbing terrain floors have, which is a later step.
ipcMain.handle('map:props', async (): Promise<MapPropsResult> => {
  if (!session) throw new Error('no map loaded');
  return {
    props: session.map.mapProps(),
    name: readSidecarText(session, session.map.nameFileRef),
    description: readSidecarText(session, session.map.descriptionFileRef),
  };
});

// --- IPC: set one map-root simple field ---
ipcMain.handle('map:set-prop', async (_e: IpcMainInvokeEvent, p: SetMapPropPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const done = record(session, `set ${p.name}`, { map: true }, () => session!.map.setMapProp(p.name, p.value));
  if (!done) throw new Error(`${p.name} is not an editable map field`);
  return { ok: true };
});

// --- IPC: read/write a text file the map references (name.txt, a rumour…) ---
// The original's "Edit" button on a text ref opens a plain-text editor on the
// referenced file; these back that. Written straight to disk (the file is its
// own document, not part of map.xdb), with the watcher resynced.
ipcMain.handle('map:read-file', async (_e: IpcMainInvokeEvent, { href }: ReadFilePayload): Promise<ReadFileResult> => {
  if (!session) throw new Error('no map loaded');
  return { text: readSidecarText(session, href) };
});
ipcMain.handle('map:write-file', async (_e: IpcMainInvokeEvent, { href, text }: WriteFilePayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  if (!writeSidecarText(session, href, text)) throw new Error(`cannot write ${href}`);
  return { ok: true };
});

/**
 * Read a text file the map references (name.txt, description.txt), decoding the
 * BOM the game writes. Empty href or a missing file returns '' rather than
 * throwing — a map with no name is a display gap, not an error.
 */
function readSidecarText(s: Session, href: string): string {
  if (!href) return '';
  // The refs are basenames beside map.xdb; strip any xpointer just in case.
  const file = join(s.mapDir, basename(href.split('#')[0]!));
  if (!existsSync(file)) return '';
  const buf = readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  return buf.toString('utf8');
}

/**
 * Write a text file the map references, keeping its existing encoding (default
 * UTF-16LE+BOM, which is what the game writes for name/description). Our own
 * write is folded into the watcher baseline so it is not reported back as an
 * external change.
 */
function writeSidecarText(s: Session, href: string, text: string): boolean {
  if (!href) return false;
  const file = join(s.mapDir, basename(href.split('#')[0]!));
  let enc: 'utf16le' | 'utf8' = 'utf16le';
  let bom = true;
  if (existsSync(file)) {
    const b = readFileSync(file);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { enc = 'utf8'; bom = true; }
    else if (!(b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)) { enc = 'utf8'; bom = false; }
  }
  const head = enc === 'utf16le' ? Buffer.from([0xff, 0xfe]) : (bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0));
  writeFileSync(file, Buffer.concat([head, Buffer.from(text, enc)]));
  s.watch.resync();
  return true;
}

// --- IPC: delete an object ---
// `remove` takes out the whole <Item> wrapper and the blank line after it, so
// the surrounding XML is left exactly as it was — which is also what lets the
// recorded patch put it back byte for byte on undo.
ipcMain.handle('object:remove', async (_e: IpcMainInvokeEvent, { id }: RemoveObjectPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, id);
  const gone = record(session, 'delete object', { map: true }, () => session!.map.remove(obj));
  if (!gone) throw new Error(`could not remove ${id}`);
  return { ok: true };
});

// --- IPC: paint a ground tile over a set of vertices ---
// The renderer has already painted its own copy for immediate feedback; this is
// the authoritative write. Only tiles the map has a layer for can be painted —
// adding a layer means restructuring the .bin (see src/terrain.ts).
ipcMain.handle('terrain:paint', async (_e: IpcMainInvokeEvent, p: PaintTilePayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  record(session, 'paint ground', { floors: [p.floor] },
    () => terrainDoc(session!, p.floor).paintTile(p.tile, p.verts, p.strength ?? 255));
  return { ok: true };
});

// --- IPC: raise/lower vertices ---
// The payload carries final heights and flags, not an operation, so this is a
// plain assignment. Flags travel with heights because the format ties them: a
// bed dug to 0 is water, and raising it off 0 makes it ground again.
ipcMain.handle('terrain:sculpt', async (_e: IpcMainInvokeEvent, p: SculptPayload): Promise<SculptResult> => {
  if (!session) throw new Error('no map loaded');
  record(session, 'sculpt terrain', { floors: [p.floor] },
    () => terrainDoc(session!, p.floor).setVertices(p.verts, p.heights, p.flags));
  return { ok: true };
});

// --- IPC: paint a river ---
// Mask, river plane and heights in one message: a river whose plane is unset is
// only paint as far as the game is concerned, and one whose bed was not sunk
// sits on top of its own banks. Applying them separately would leave the file
// briefly — or on a failure, permanently — inconsistent.
ipcMain.handle('terrain:paint-river', async (_e: IpcMainInvokeEvent, p: PaintRiverPayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  record(session, 'paint river', { floors: [p.floor] }, () => {
    const doc = terrainDoc(session!, p.floor);
    doc.paintTile(p.tile, p.verts);
    doc.setRiver(p.verts);
    doc.setVertices(p.heightVerts, p.heights, null);
  });
  return { ok: true };
});

// --- IPC: the river plane on its own, at a chosen strength ---
ipcMain.handle('terrain:river-cells', async (_e: IpcMainInvokeEvent, p: RiverCellsPayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  record(session, p.value ? 'paint river' : 'erase river', { floors: [p.floor] },
    () => terrainDoc(session!, p.floor).setRiverCells(p.cells, p.value));
  return { ok: true };
});

// --- IPC: the passability mask (the original editor's Masks tab) ---
ipcMain.handle('terrain:mask', async (_e: IpcMainInvokeEvent, p: MaskPayload): Promise<PaintTileResult> => {
  if (!session) throw new Error('no map loaded');
  record(session, p.walkable ? 'unblock tiles' : 'block tiles', { floors: [p.floor] },
    () => terrainDoc(session!, p.floor).setPassable(p.verts, p.walkable));
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
  record(session, 'add ground layer', { floors: [p.floor] }, () => doc.addLayer(p.tile));
  const paths = doc.layerPaths().filter((x) => x);
  // Keep the palette's "already in this map" markers in step for every floor.
  session.layerPaths = [...new Set([...session.layerPaths, ...paths])];
  return { ok: true, splat: splatFor(doc.buffer(), session.assetRoot), inMap: paths };
});

// --- IPC: undo / redo ---
//
// The step is applied to the documents here; what goes back to the renderer is
// the state it cannot derive on its own. Objects come back as the whole
// instance list — the map was re-parsed, so every id is new-ish and matching
// them up one by one would be more work than rebuilding the batches. Terrain
// comes back as its planes plus a rebuilt splat, which is what a repainted mask
// or an added layer changes.
function undoResult(s: Session, step: Step | null, dir: 'undo' | 'redo'): UndoResult {
  const moved = step ? applyStep(s, step, dir) : {};
  const terrain: UndoResult['terrain'] = [];
  for (const floor of moved.floors ?? []) {
    const doc = terrainDoc(s, floor);
    terrain.push({
      floor,
      heights: [...doc.heightsCopy()],
      flags: doc.flagsCopy() ? [...doc.flagsCopy()!] : null,
      splat: splatFor(doc.buffer(), s.assetRoot),
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

/** The undo stack's reach, for a UI that greys out what cannot be done. */
function historyState(s: Session): HistoryState {
  return {
    canUndo: s.history.canUndo, canRedo: s.history.canRedo,
    undoLabel: s.history.undoLabel, redoLabel: s.history.redoLabel,
  };
}

ipcMain.handle('history:undo', async (): Promise<UndoResult> => {
  if (!session) throw new Error('no map loaded');
  return undoResult(session, session.history.takeUndo(), 'undo');
});

ipcMain.handle('history:redo', async (): Promise<UndoResult> => {
  if (!session) throw new Error('no map loaded');
  return undoResult(session, session.history.takeRedo(), 'redo');
});

/** Flush every terrain document that has unsaved brush work. */
function saveTerrain(s: Session): void {
  for (const doc of s.terrain.values()) if (doc.dirty) doc.save();
}

// --- IPC: save map.xdb (latin1 preserves the original bytes) ---
ipcMain.handle('map:save', async (): Promise<MapSaveResult> => {
  if (!session) throw new Error('no map loaded');
  // The folder the session points at must still be a map. If it is not — it was
  // deleted, or the session outlived a workspace rebuild — then writing and
  // repacking would put a stub where the user's map was.
  if (!existsSync(dirname(session.mapPath))) throw new Error(`${session.mapDir} is gone — reopen the map before saving`);
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  saveTerrain(session);
  // Our own write — fold it into the watcher's baseline so it isn't reported
  // back to us as somebody else's edit.
  session.watch.resync();
  // The bytes just changed on disk, so the hash the history is keyed by has
  // moved with them. Rewriting it here is what keeps undo usable across a
  // save-and-quit, which is the case worth having.
  saveHistory(session);

  // A map opened from an archive is edited in a workspace the user never chose
  // and will never look in, so writing the files there is not saving in any
  // sense they would recognise. Save means "put my work back where I got it":
  // for an archive-backed project that is the archive itself, repacked at the
  // path the map has to sit at inside it. For a loose map folder — one we
  // created, or one someone points us at — the files ARE the map, and writing
  // them is the whole of it.
  const src = readManifest(session.mapDir).source;
  if (src && existsSync(src.path)) {
    // preserveFrom: the archive can hold more than the map (the original packs
    // its scene-property template along), and the project is only the map folder.
    const res = packProject(session.mapDir, src.path,
      { prefix: archivePrefixFor(session.mapDir), preserveFrom: src.path });
    console.log(`[save] ${session.mapDir} → ${src.path} · ${res.entries} entries`);
    // The archive just changed, so the workspace's record of what it was opened
    // from has to move with it, or the next open would call the workspace stale
    // and unpack over the work still sitting in it.
    const m = readManifest(session.mapDir);
    m.source = { path: src.path, hash: createHash('sha1').update(readFileSync(src.path)).digest('hex') };
    writeManifest(session.mapDir, m);
    return { ok: true, output: src.path, status: status(session.mapDir) };
  }
  return { ok: true, status: status(session.mapDir) };
});

/**
 * Where this map has to sit inside its .h5m.
 *
 * The game addresses files in an archive by their path under its data root, so
 * a map packed at the archive root is a map the game never finds. A project
 * opened from an archive remembers the path it came with; anything else — a
 * map we created, or a loose folder someone points us at — is placed by where
 * it sits under the data root, which is the same thing said another way.
 */
function archivePrefixFor(mapDir: string): string {
  const stored = readManifest(mapDir).archivePrefix;
  if (stored != null) return stored; // '' is a real answer: packed at the root
  const rel = relative(GAME_DATA, mapDir);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  // Outside the data root. Take everything from the last Maps/ segment on, and
  // failing that assume a single-scenario map of that folder's name.
  const parts = mapDir.split(sep);
  const i = parts.lastIndexOf('Maps');
  return i >= 0 ? parts.slice(i).join('/') : `Maps/SingleMissions/${basename(mapDir)}`;
}

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
  // A copy of the map should be as complete as the original it came from, so it
  // carries over whatever the source archive held outside the map folder too.
  const from = readManifest(session.mapDir).source?.path;
  const res = packProject(session.mapDir, r.filePath,
    { prefix: archivePrefixFor(session.mapDir), preserveFrom: from });
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

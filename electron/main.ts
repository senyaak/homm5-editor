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
import { dirname, join, basename, relative, resolve, sep, isAbsolute } from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildScene, createGeomResolver, findAssetRoot, listTiles, splatFor, pngDataUri } from '../src/scene.ts';
import type { GeomData } from '../src/scene.ts';
import { transferEffect } from '../src/effects.ts';
import type { FxTransfer } from '../src/effects.ts';
import { listPlaceable, iconPathFor, readIconFile } from '../src/objects.ts';
import { decodeDDS } from '../src/dds.ts';
import { editorRoot, APP_ROOT, gameData, gameRoot, isConfigured, mountedAssets, preloadPath, readSettings, rendererFile, saveSettings, tmpRoot } from './paths.ts';
import { assets } from '../src/assets.ts';
import type { Assets } from '../src/assets.ts';
import { closeSetup, runSetup } from './setup.ts';
import { initProject, openProject, packProject, exportLocalized, readManifest, writeManifest, status, pickMapRel, MANIFEST_NAME } from '../src/project.ts';
import { listDirFiles } from '../src/pak.ts';
import scriptApi from '../src/script-api.json' with { type: 'json' };
import { watchMapDir } from '../src/watch.ts';
import { donorFor } from '../src/donors.ts';
import type { MapWatch } from '../src/watch.ts';
import { TerrainDoc } from '../src/terrain-edit.ts';
import { History, diff, apply } from '../src/history.ts';
import { loadMap } from '../src/map.ts';
import { buildMapTag } from '../src/map-tag.ts';
import { createField } from '../src/defaults.ts';
import { buildNewMapProject } from '../src/new-map.ts';
import { MAP_SIZES } from '../src/terrain-blank.ts';
import { Registry, artifactPreset, creatureAbilities, creaturePreset, creatureSources } from '../src/registry.ts';
import type { RosterEntry } from '../src/registry.ts';
import {
  addArtifact, addArtifactSet, addCreature, removeArtifact, removeArtifactSet, removeCreature,
  updateArtifact, updateArtifactSet, artifactLimit, buildCreatureMod, dataReader, findCreatureMods,
  installCreatureMod, MOD_STEM, newCreatureMod, packCreatureMod,
} from '../src/creature-mod.ts';
import { MOD_DIR, MOD_EXT, ensureModDir, modDir, modFile } from '../src/mod-paths.ts';
import { extractMapFolder, gameArchives, listOurMaps, listStockMaps, mapFolderIn } from '../src/map-source.ts';
import type { MapSource } from '../src/map-source.ts';
import { builtDll, extensionState, installExtension, writeEffectsFile } from '../src/extension.ts';
import { describeUses, findArtifactUses, findCreatureUses } from '../src/artifact-usage.ts';
import { EFFECT_STATS, effectsOf } from '../src/artifact-effects.ts';
import type { EffectStat } from '../src/artifact-effects.ts';
import type { BuildReport, CreatureMod, Installed, ModCreature } from '../src/creature-mod.ts';
import { decodeDDSBuffer } from '../src/dds.ts';
import { writeDDS } from '../src/texture.ts';
import { extractPalette, isIdentity, recolorPixels } from '../src/recolor.ts';
import { readEntries, writeArchive } from '../src/pak.ts';
import type { ArtifactRank, ArtifactSlot, ArtifactSpec, HeroStats } from '../src/artifacts.ts';
import type { ArtifactExeResult } from '../src/artifact-limit.ts';
import type { ExeResult } from '../src/creature-limit.ts';
import { blankStats } from '../src/creatures.ts';
import type { RegistryName, FieldSchema } from '../src/schema.ts';
import { readTypeSpec, fieldOrder, typesXmlPath, fieldValues } from '../src/typespec.ts';
import type { FieldOrder, SpecType } from '../src/typespec.ts';
import { readTree, setPath, addStringItem, addRefItem, removeItem, appendItem, indentText, nodeAt, setList } from '../src/tree.ts';
import { mapSchema, resolveSchemaAtPath, resolveObjectPath, deref, schemaForClass, objectProps, objectSchema, controlOf } from '../src/schema.ts';
import { buildItem, isBuildable, buildEntity } from '../src/skeleton.ts';
import { TOWN_BONUS_IDS } from '../src/town-bonuses.ts';
import { children, find, text, childText, setText, serialize, parse } from '../src/xml.ts';
import {
  CAMPAIGN_TEXTS, addMission, buildNewCampaignProject, handOnTo, hasEntryPoint,
  heroScriptName, loadCampaignProject, missionTexts, missions, placedHeroes,
  readBonuses, readHeroesPool, readProjectText, removeMission, saveCampaignProject,
  writeBonuses, writeHeroesPool, writeProjectText,
} from '../src/campaign-project.ts';
import { packCampaign, missionMapDir } from '../src/campaign-pack.ts';
import type {
  CampaignDirPayload, CampaignDoc, CampaignListEntry, CampaignListResult,
  CampaignPackResult, MapHeroesPayload, MapHeroesResult, NewCampaignPayload,
  SaveCampaignPayload,
} from './ipc.ts';
import type { XmlElement, XmlNode } from '../src/xml.ts';
import type { DocPatch, Step, StoredHistory } from '../src/history.ts';
import type { TileInfo, GeomResolver, Instance as SceneInstance } from '../src/scene.ts';
import type { HommMap, MapObject, ObjectProp } from '../src/map.ts';
import type {
  MapsListResult, MapListEntry, MapLoadResult, MoveObjectPayload, MoveObjectResult, FxPayload,
  RotateObjectPayload, RemoveObjectPayload, ObjectEditResult, ObjectPropsResult, SetPropPayload,
  SpecValuesPayload, SpecValuesResult,
  MapPropsResult, SetMapPropPayload, RosterPayload, RosterResult, OfClassPayload, NewEntityPayload, NewEntityResult,
  EntityReadPayload, EntityReadResult, EntitySetPathPayload, PickTextResult, EntityCopyPayload, EntityCopyResult,
  SuggestNamePayload, SuggestNameResult,
  MapTreeResult, SetPathPayload, AddItemPayload, RemoveItemPayload2, SetListPayload, NamesPayload, NamesResult,
  ObjectTreePayload, ObjectTreeResult, ObjectSetPathPayload, ObjectAddItemPayload, ObjectRemoveItemPayload,
  ReadFilePayload, ReadFileResult, WriteFilePayload,
  ScriptContextResult, ApiFn, MapFilesPayload, MapFilesResult,
  ScriptNewPayload, ScriptNewResult, ScriptResolvePayload, ScriptResolveResult,
  SpecNewPayload, SpecNewResult,
  LocResult, LocEnablePayload, LocLangPayload, LocExportPayload,
  ObjectCatalogResult, IconPayload, IconResult, AddObjectPayload, AddObjectResult,
  MapSaveResult, MapPackResult, TerrainTilesResult, MapStatusResult, OpenMapDialogResult,
  NewMapPayload, NewMapResult, OpenArchivePayload, OpenArchiveResult,
  ExternalChange, PaintTilePayload, PaintTileResult, SculptPayload, SculptResult,
  AddLayerPayload, AddLayerResult, PaintRiverPayload, RiverCellsPayload, MaskPayload, UndoResult, HistoryState,
  ModsListResult, ModsInstallPayload, ModsInstallResult, ModsFormDataResult, ModsPresetPayload,
  CreaturePresetDTO, ArtifactPresetDTO, ModsInstallArtifactPayload, ModsInstallArtifactResult,
  ModsInstallSetPayload, ModsInstallSetResult, ExtensionStatus,
  ModsRemovePayload, ModsRemoveResult, ModsUsesResult,
  ModsTexturesPayload, ModsTexturesResult, ModsRecolorPayload, ModsRecolorResult,
} from './ipc.ts';

// [perf] Windows-only Chromium bug: the native occlusion calculator intermittently
// decides a fully visible window is covered and throttles its compositor to a
// crawl for the rest of the session — the "sometimes the whole editor goes
// slow-motion, and alt-tab fixes it" symptom (a focus change resets the state).
// Turning the feature off is the standard workaround and costs nothing here: we
// only ever run one visible window. Must be set before app is ready.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Software rendering, if a previous run was told to remember it. Chromium picks
// its GL backend while coming up, so this has to be said here and cannot be a
// setting the running editor applies. It exists because a driver that gives no
// WebGL leaves the editor with nothing to draw on, and someone running a
// packaged build has no command line to pass the switch on — see
// Settings.softwareRendering.
if (readSettings().softwareRendering) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  // Paired on purpose: if the driver was merely blocklisted, ANGLE's software
  // path is a heavy price for a machine that could have run on the GPU, and
  // whoever turned this on has already seen the editor fail to start.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  console.log('[gpu] software rendering, remembered from a previous run');
}

/** Unpacked archives, one folder per archive. */
const workspaces = (): string => join(tmpRoot(), 'workspaces');

/** The map currently open for editing, with everything derived at load time. */
interface Session {
  /** Absolute path to the open map.xdb. */
  mapPath: string;
  /** Folder holding map.xdb — the project dir for status()/packProject(). */
  mapDir: string;
  /** Unpacked data root — the base of the chain, for the plain-path uses. */
  assetRoot: string;
  /**
   * What the meshes, textures and rosters actually resolve against: the data
   * root with the installed creature mods layered over it, the way the game
   * mounts them. A creature a mod adds exists only here.
   */
  assets: Assets;
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
  return join(tmpRoot(), 'history', `${key}.json`);
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

/** The object catalogue, scanned once — 1466 small files is not a per-call cost. */
let catalogCache: ReturnType<typeof listPlaceable> | null = null;
function catalog(): ReturnType<typeof listPlaceable> {
  // Through the mounted chain, so a mod's palette entries are in the catalogue.
  if (!catalogCache) catalogCache = listPlaceable(mountedAssets(gameData()), editorRoot() || '');
  return catalogCache;
}

// Current editing session (one map at a time for now).
let session: Session | null = null;
let win: BrowserWindow | null = null;

/**
 * Where the file dialog opens. Follows the last map opened; starts at ours.
 *
 * Our folder rather than `<data>/Maps`: that is where every map of ours is a
 * file, and where the game reads them from. The unpacked tree holds working
 * copies and the game's own maps, neither of which is what a person means by
 * "open a map".
 */
let lastDir = '';
function openDialogDir(): string {
  if (lastDir) return lastDir;
  const g = gameRoot();
  if (g && existsSync(modDir(g))) return modDir(g);
  const root = gameData();
  if (!root) return '';
  const maps = join(root, 'Maps');
  return existsSync(maps) ? maps : root;
}

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
      preload: preloadPath('preload.cjs'),
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
  // Renderer failures, in the terminal that launched the app. Until this was
  // here, a renderer that died on its first line left no trace anywhere the
  // person hitting it would look: DevTools is closed, and start-editor.bat keeps
  // its window open for exactly this and had nothing to show.
  w.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error(`[renderer] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  w.webContents.on('preload-error', (_e, path, err) => {
    console.error(`[preload] ${path} failed to load: ${err.message}`);
  });
  w.webContents.on('render-process-gone', (_e, d) => {
    console.error(`[renderer gone] ${d.reason} (exit ${d.exitCode})`);
  });
  w.loadFile(rendererFile('index.html'));
}

/** The graphics answer behind `gpuReport` — see EditorApi. */
async function gpuReport(): Promise<string> {
  const lines: string[] = [`electron ${process.versions.electron} · chrome ${process.versions.chrome} · ${process.platform}`];
  // Only the features Chromium turned off. The enabled ones are noise here, and
  // this block is meant to be pasted into a message by someone with a problem.
  const status = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  const off = Object.entries(status).filter(([, v]) => !v.startsWith('enabled'));
  lines.push(off.length ? `disabled GPU features:\n  ${off.map(([k, v]) => `${k}: ${v}`).join('\n  ')}`
    : 'GPU features: all enabled');
  try {
    // 'basic' rather than 'complete': the complete report is hundreds of lines
    // of driver detail, and the adapter's identity is what actually names the
    // cause. A blocked driver and a session with no GPU at all read differently
    // here even though both end as "no WebGL".
    const info = await app.getGPUInfo('basic') as Record<string, unknown>;
    lines.push(`gpu: ${JSON.stringify(info)}`);
  } catch (e) {
    lines.push(`gpu: unavailable (${e instanceof Error ? e.message : String(e)})`);
  }
  const switches = process.argv.filter((a) => a.startsWith('--'));
  if (switches.length) lines.push(`switches: ${switches.join(' ')}`);
  return lines.join('\n');
}

// Every channel says how long it took, and says so again while it is still
// going. The main process is single-threaded: one slow handler stops the
// window, and from outside that is indistinguishable from a crash — which cost
// an afternoon of guessing at which call it was. Now it names itself.
{
  const raw = ipcMain.handle.bind(ipcMain);
  type Listener = (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
  ipcMain.handle = ((channel: string, listener: Listener) => raw(channel, async (e, ...args) => {
    const started = Date.now();
    const stuck = setInterval(
      () => console.error(`[ipc] ${channel} still running after ${Math.round((Date.now() - started) / 1000)}s`),
      2000,
    );
    try {
      return await listener(e, ...args);
    } finally {
      clearInterval(stuck);
      const ms = Date.now() - started;
      // Only the slow ones: a line per call would bury them.
      if (ms > 200) console.error(`[ipc] ${channel} ${ms}ms`);
    }
  })) as typeof ipcMain.handle;
}

ipcMain.handle('app:gpu-report', gpuReport);
ipcMain.handle('app:open-devtools', () => { win?.webContents.openDevTools({ mode: 'detach' }); });
ipcMain.handle('app:gpu-software', (): boolean => !!readSettings().softwareRendering);
// Remember, then come back up with the switches applied. A restart is the whole
// mechanism, not an inconvenience of it: the backend is chosen before the app is
// ready, so this is the only moment the choice can be made.
ipcMain.handle('app:set-gpu-software', (_e: IpcMainInvokeEvent, { on }: { on: boolean }) => {
  saveSettings({ softwareRendering: on });
  app.relaunch();
  app.exit(0);
});

app.whenReady().then(async () => {
  // Nothing to read means nothing to edit, so setup comes first: it asks where
  // the game is and unpacks its archives. `--setup` forces it, which is the way
  // back in once the answers are wrong (the game moved, the data root was
  // deleted) and the editor would otherwise open onto an empty map list.
  if (!isConfigured() || process.argv.includes('--setup')) {
    const ok = await runSetup();
    if (!ok) { app.quit(); return; }
  }
  createWindow();
  // Only now is setup's window redundant. It stays open (hidden) until here so
  // that the app is never windowless, which Electron takes as its cue to quit.
  closeSetup();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Dev smoke test: HOMM5_SMOKE=<map.xdb> loads a map through the real pipeline
  // and exits, so CI/headless can verify the backend without clicking.
  if (process.env.HOMM5_SMOKE) runSmoke(process.env.HOMM5_SMOKE);
});

/**
 * The base asset root for a map: the tree above it when the map sits inside one,
 * else the configured game data.
 *
 * A map opened from a `.h5m` is extracted on its own and has no data above it,
 * which is the ordinary case — the archive holds the map, never the models. The
 * smoke test used to insist on the walk alone and so could not load any map the
 * editor itself can.
 */
function assetRootFor(mapPath: string): string {
  const above = findAssetRoot(mapPath);
  if (above) return above;
  if (existsSync(join(gameData(), 'MapObjects')) || existsSync(join(gameData(), 'bin', 'Geometries'))) return gameData();
  throw new Error('asset root not found (need MapObjects/ or bin/Geometries/ above the map, or set HOMM5_DATA)');
}

async function runSmoke(mapPath: string): Promise<void> {
  try {
    const { map, scene, skipped, resolver } = buildScene(mountedAssets(assetRootFor(mapPath)), mapPath);
    initProject(dirname(mapPath));
    const placed = scene.floors.reduce((a, f) => a + f.instances.length, 0);
    console.log(`SMOKE ok: ${map.tileX}x${map.tileY}, geoms ${scene.geoms.length}, floors ${scene.floors.length}, placed ${placed}, skipped ${skipped}`);
    app.exit(0);
  } catch (e) { console.error('SMOKE fail:', e instanceof Error ? e.message : String(e)); app.exit(1); }
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { session?.watch.stop(); });

// --- IPC: the maps on offer — ours, and the game's own ---
//
// Both come out of archives in the install, never out of the unpacked data:
// `<game>/H5E/*.mod` are ours, `<game>/data/*.pak` hold the shipped ones. What
// each list is and how it is read lives in src/map-source.ts, where it can be
// tested without a window; the stock ones are cached because their archives do
// not change while the editor runs.
let stockMaps: { root: string; maps: MapSource[] } | null = null;

ipcMain.handle('maps:list', async (): Promise<MapsListResult> => {
  const g = gameRoot();
  const started = performance.now();
  if (g && stockMaps?.root !== g) stockMaps = { root: g, maps: listStockMaps(g) };
  const maps: MapListEntry[] = [...listOurMaps(g), ...(g ? stockMaps!.maps : [])];
  console.log(`[perf] maps:list ${(performance.now() - started) | 0}ms · ${maps.length} maps`);
  return { root: g ?? gameData(), maps };
});

// --- IPC: open a map file via the OS dialog (starts in the last-used folder) ---
ipcMain.handle('dialog:openMap', async (): Promise<OpenMapDialogResult> => {
  const opts = {
    title: 'Open a map',
    defaultPath: openDialogDir(),
    properties: ['openFile' as const],
    // Both halves of the round trip: an unpacked folder's map.xdb, or the .h5m
    // Pack produced from one.
    filters: [
      { name: 'HoMM5 map', extensions: ['xdb', 'mod', 'h5m', 'h5c', 'h5u'] },
      { name: 'Map folder', extensions: ['xdb'] },
      { name: 'Packed map', extensions: ['mod', 'h5m', 'h5c', 'h5u'] },
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

  // A new map is a FILE from the moment it exists: `<game>/H5E/<name>.mod`, the
  // one our build reads and the only place the picker looks. It is written into
  // a working folder like any other map (unpackRoot) and packed straight away,
  // so Save goes back into the .mod and there is never a map that exists only as
  // a folder nothing ships from.
  const g = gameRoot();
  if (!g) throw new Error('no game install configured — a new map needs somewhere to be a file');
  const archive = modFile(g, 'map', name);
  if (existsSync(archive)) throw new Error(`${archive} already exists`);
  // Its path inside the archive is how the game addresses it, and the working
  // folder keeps the same shape, so packing is a copy.
  const prefix = `Maps/${p.multiplayer ? 'Multiplayer' : 'SingleMissions'}/${name}`;
  const mapDir = join(unpackRoot(archive).root, prefix);
  if (existsSync(mapDir)) throw new Error(`${mapDir} already exists`);

  // The enabled-spell and artifact lists are the game's own, so they follow the
  // installed data (and any mod) rather than a list frozen into the source.
  const registry = new Registry(gameData());
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
  ensureModDir(g);
  packProject(mapDir, archive, { prefix });
  // From here it is a map opened from an archive, like any other, and Save
  // already knows what that means.
  const m = readManifest(mapDir);
  m.source = { path: archive, hash: createHash('sha1').update(readFileSync(archive)).digest('hex') };
  // Written down rather than worked out from where the folder happens to be:
  // that folder moves with HOMM5_UNPACK_TO, and the path inside the archive
  // must not.
  m.archivePrefix = prefix;
  writeManifest(mapDir, m);
  console.log(`[new] ${archive} · ${p.tiles}×${p.tiles}${p.twoLevel ? ' two-level' : ''} · ${files.length} files`);
  return { mapPath: join(mapDir, 'map.xdb'), mapDir, archive };
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
  return join(workspaces(), `${basename(archivePath).replace(/[^\w.-]+/g, '_')}-${key}`);
}

/**
 * WHERE MAPS ARE UNPACKED TO WORK IN — one answer for every kind of map.
 *
 * Every map the editor opens is inside an archive now (ours in `H5E/`, the
 * game's in its paks), so every one of them is unpacked somewhere first. By
 * default that is a workspace per archive under `_tmp`, which nobody has to look
 * at or clean up.
 *
 * `HOMM5_UNPACK_TO` puts them in a folder of your choosing instead, at their
 * in-game path: with it pointed at the data root, `Foo.mod` unpacks to
 * `<data>/Maps/SingleMissions/Foo` — a fixed, predictable place, which is what
 * the e2e suite reads after driving the window, and how the editor behaved
 * before maps became files.
 *
 * `shared` says which it is, because it decides what may be deleted: a workspace
 * is ours alone and is thrown away whole, while a shared root holds other maps
 * (and everything else) and only the map's own folder may go.
 */
function unpackRoot(archive: string, key = archive): { root: string; shared: boolean } {
  const to = process.env.HOMM5_UNPACK_TO;
  return to ? { root: resolve(to), shared: true } : { root: workspaceFor(key), shared: false };
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
  if (!existsSync(workspaces())) return;
  const dirs = readdirSync(workspaces())
    .map((n) => join(workspaces(), n))
    .filter((d) => d !== keep && statSync(d).isDirectory())
    .map((d) => ({ d, at: statSync(d).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { d } of dirs.slice(KEEP_WORKSPACES)) {
    try { if (status(findMapDir(d) ?? d).dirty) continue; } catch { /* unreadable — let it go */ }
    rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Take one shipped map out of the game's archives and open the copy.
 *
 * Keyed by archive AND folder, so two maps out of the same `.pak` get a
 * workspace each. Rebuilt every time rather than reused: the game's archives do
 * not change, so a workspace that is already there is either this map as it
 * shipped — nothing to gain by unpacking it again — or work in progress, which
 * is exactly what must not be overwritten.
 */
function openStockMap(archive: string, inner: string): OpenArchiveResult {
  const { root } = unpackRoot(archive, `${archive}#${inner}`);
  const mapDir = join(root, inner);
  if (existsSync(join(mapDir, 'map.xdb'))) {
    console.log(`[open] ${inner} of ${basename(archive)} → ${mapDir} (workspace reused)`);
    return { mapPath: join(mapDir, 'map.xdb'), mapDir, files: listDirFiles(root).length };
  }
  // Every archive the game mounts, not just the one the listing found it in: a
  // shipped map is spread across them (A2S1's terrain and sounds are in
  // data.pak, its patched map.xdb in the addon's, its texts in texts.pak), and
  // the newest copy of each file is the one the game reads.
  const g = gameRoot();
  const files = extractMapFolder(g ? gameArchives(g) : [archive], inner, root);
  if (!existsSync(join(mapDir, 'map.xdb'))) throw new Error(`${inner} in ${basename(archive)} holds no map.xdb`);
  // No source: the workspace is a copy, and Save writes the copy. Nothing here
  // may ever lead back to writing into the game's own archive. The prefix is
  // written down rather than left to be guessed from the path, so packing this
  // map puts it back exactly where it was addressed from.
  initProject(mapDir);
  const m = readManifest(mapDir);
  m.archivePrefix = inner.replace(/\\/g, '/');
  writeManifest(mapDir, m);
  console.log(`[open] ${inner} of ${basename(archive)} → ${mapDir} · ${files} files`);
  return { mapPath: join(mapDir, 'map.xdb'), mapDir, files };
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
  // One map out of an archive that holds many — the game's own `.pak`. Only that
  // folder is taken, the archive is never written to, and the workspace records
  // no source: saving a shipped map means saving the copy, and packing it offers
  // our folder. Opening one is starting FROM it.
  //
  // Keyed on `stock`, NOT on `inner` having a value: ours carry an inner path
  // too — it is how a campaign mission names them — and taking that as the
  // signal sent every map of ours looking for itself inside the game's paks.
  if (p.stock && p.inner) return openStockMap(archive, p.inner);
  const { root, shared } = unpackRoot(archive);
  // Where this archive's map will land, so a shared root can be cleared of THIS
  // map without touching whatever else is in it.
  const inner = mapFolderIn(archive);

  // Reopening the same archive returns to the same folder rather than unpacking
  // a second copy beside the first: unsaved work and the undo history are keyed
  // to it, so a new one every time would silently drop both. Only when the
  // archive itself has moved on is it rebuilt. The manifest lives with map.xdb,
  // which is usually deeper — the archive's own folder structure is kept as it
  // stands.
  const guess = inner ? join(root, inner) : null;
  const existing = guess && existsSync(guess) ? guess : (existsSync(root) ? findMapDir(root) : null);
  if (existing && existsSync(join(existing, MANIFEST_NAME)) && sourceMatches(existing, archive)) {
    console.log(`[open] ${archive} → ${existing} (unpacked copy reused)`);
    return { mapPath: join(existing, 'map.xdb'), mapDir: existing, files: listDirFiles(existing).length };
  }
  // Rebuilding: the watcher has the old copy of this very folder open, and on
  // Windows an open handle is enough to make the delete fail.
  const stale = shared ? (guess ?? '') : root;
  if (stale) {
    if (session && session.mapDir.startsWith(stale)) { session.watch.stop(); session = null; }
    rmSync(stale, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  if (!shared) pruneWorkspaces(root);

  // The map is usually NOT at the archive root: members are named by their path
  // under the game's data root ('Maps/SingleMissions/foo/map.xdb'), which is how
  // the game finds them. openProject unpacks that tree as it stands and reports
  // the inner folder holding map.xdb as the project.
  const { files, projectDir } = openProject(archive, root, { mapProject: true });
  const mapPath = join(projectDir, 'map.xdb');
  if (!existsSync(mapPath)) throw new Error(`${basename(archive)} holds no map.xdb (${files.length} files)`);
  console.log(`[open] ${archive} → ${projectDir} · ${files.length} files`);
  return { mapPath, mapDir: projectDir, files: files.length };
});

// --- IPC: load a map -> decode into a renderable scene ---
ipcMain.handle('map:load', async (_e: IpcMainInvokeEvent, mapPath: string): Promise<MapLoadResult> => {
  const assetRoot = assetRootFor(mapPath);
  lastDir = dirname(mapPath);
  const mapDir = dirname(mapPath);
  // [perf] map:load is the heavy startup step (mesh + texture decode). Timed so
  // an intermittent stall can be pinned to a phase rather than guessed at; grep
  // the terminal for "[perf]".
  const tStart = performance.now();
  const data = mountedAssets(assetRoot);
  // Whether the scene carries bones and clips at all is decided here, once, from
  // the setting — an animated model's payload roughly doubles, so a map opened
  // with idles off must not pay for them anywhere down the chain.
  const idleAnimation = readSettings().idleAnimation ?? 'off';
  const { map, scene, skipped, resolver } = buildScene(data, mapPath, { animate: idleAnimation !== 'off' });
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
    mapPath, mapDir, assetRoot, assets: data, map, layerPaths, watch, terrain: new Map(), resolver,
    history: new History(), historyPath: historyPathFor(mapDir),
    registry: new Registry(data),
  };
  // A history from a previous run is adopted only if the documents still hash
  // to what they hashed when it was written.
  loadHistory(session);
  // The map's tile set is derived from the terrain's layers, and a map built
  // before the editor kept the two in step carries a stale one. Fixed on open
  // rather than quietly at save, so it is a change the user can see and undo.
  const tilesNamed = syncMapTiles(session, layerPaths);
  if (tilesNamed) console.log(`[load] tile set: named ${tilesNamed} tile(s) the terrain paints with`);
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
      tilesNamed,
    },
    status: status(mapDir),
    history: historyState(session),
    idleAnimation,
  };
});

// --- IPC: the idle-animation setting ---
// Read and written here rather than in the renderer, because it decides what
// map:load builds; the renderer only learns which mode the scene it was handed
// was built for. A scene built with it off can be topped up in place through
// map:idle-skins below, so changing the setting never needs a reload.
ipcMain.handle('app:idle-animation', (): 'off' | 'visible' | 'all' => readSettings().idleAnimation ?? 'off');
ipcMain.handle('app:set-idle-animation', (_e: IpcMainInvokeEvent, { mode }: { mode: 'off' | 'visible' | 'all' }) => {
  saveSettings({ idleAnimation: mode });
  return {};
});

// --- IPC: animation data for a scene that was built without it ---
// A map opened with idles off carries no bones anywhere in its payload — that
// is what makes `off` free. Turning the setting on used to mean reopening the
// map; instead, this replays the open map's models through a fresh resolver
// with animation on and returns just the skin payloads, keyed by the geom
// indices the renderer already holds. Resolution is deterministic (same hrefs,
// same order, same dedup), so the indices line up; anything that does not is
// dropped here rather than handed over misaligned.
ipcMain.handle('map:idle-skins', async (): Promise<Record<number, NonNullable<GeomData['skin']>>> => {
  if (!session) throw new Error('no map loaded');
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

// --- IPC: baked particle keys, by bin/effects uid ---
// Separate from the scene payload on purpose: these are tens of MB as JSON and
// a few MB as typed arrays, and structured clone ships typed arrays binary.
// The renderer asks once per unique uid after the scene is up.
ipcMain.handle('map:fx', async (_e: IpcMainInvokeEvent, { uids }: FxPayload): Promise<Record<string, FxTransfer>> => {
  if (!session) throw new Error('no map loaded');
  const t0 = performance.now();
  const out: Record<string, FxTransfer> = {};
  for (const uid of uids) {
    // The uid names a file; nothing else is accepted (it lands in a path).
    if (!/^[0-9A-F-]{36}$/.test(uid)) continue;
    try {
      const p = session.assets.path(join('bin', 'effects', uid));
      if (!existsSync(p)) continue;
      out[uid] = transferEffect(readFileSync(p));
    } catch { /* an unreadable effect stays a static card */ }
  }
  console.log(`[perf] map:fx ${(performance.now() - t0) | 0}ms · ${Object.keys(out).length}/${uids.length} effect(s)`);
  return out;
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
    hasEditor: !!editorRoot(),
  };
});

// --- IPC: one palette icon, decoded on demand ---
// 1466 icons at 64x64 RGBA would be ~24 MB pushed across the bridge for a panel
// showing a few dozen at a time, so they are fetched per tile as it scrolls in.
ipcMain.handle('objects:icon', async (_e: IpcMainInvokeEvent, { path }: IconPayload): Promise<IconResult> => {
  const root = editorRoot();
  const file = root ? iconPathFor(root, path) : null;
  if (file) {
    try {
      const icon = readIconFile(readFileSync(file));
      // A few entries hold an image declared 0x0 — a placeholder with no picture.
      if (icon) return pngDataUri(icon.w, icon.h, icon.rgba);
    } catch { /* fall through to the entry's own texture */ }
  }
  // No cache entry. The cache is keyed by link path and only the game's own
  // installer writes it, so everything a MOD adds lands here — a blank tile
  // among 185 that have pictures. A link may name a texture instead, and a
  // creature's 128px icon is already in the mod beside its model.
  return linkTexture(catalog().objects.find((o) => o.path === path)?.iconFile);
});

/**
 * Decode a texture a palette entry names, as a data URI.
 *
 * The href is a `.(Texture).xdb`, which is a description; the pixels are in the
 * `.dds` its `DestName` names, beside it. Anything that does not resolve — the
 * shipped links' authoring `.tga` paths, above all — is simply no icon.
 */
function linkTexture(href: string | undefined): IconResult {
  if (!href || !/\.xdb$/i.test(href)) return null;
  const data = mountedAssets(gameData());
  const rel = href.replace(/\\/g, '/').replace(/^\/+/, '');
  const xml = data.text(rel);
  if (!xml) return null;
  const dest = /<DestName href="([^"]+)"/.exec(xml)?.[1];
  if (!dest) return null;
  const dds = data.path(join(dirname(rel), dest).split(sep).join('/'));
  try {
    const img = decodeDDS(dds);
    return pngDataUri(img.width, img.height, img.rgba);
  } catch { return null; }
}

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
    const p = typesXmlPath(gameData());
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
  const donor = donorFor(gameData(), p.type);
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
  // A reference field (`x-ref`) is written as an href, even into a bare element
  // that has no attribute yet — a town's `<Specialization/>` set for the first
  // time. Text there would not resolve in the game.
  const raw = objectProps(obj.type)[p.name];
  const isRef = raw ? deref(objectSchema, raw)['x-ref'] === true : false;
  const done = record(session, `set ${p.name}`, { map: true }, () => {
    // Filling in a field the object never had: create it where the spec puts
    // it, then set it like any other. Recorded inside the same step, so undo
    // takes the field away again rather than leaving an empty one behind.
    if (!find(obj.el, p.name)) {
      const order = orderFor(obj.type);
      if (!order || !raw) return false;
      if (!createField(obj.el, p.name, order.names, isRef)) return false;
    }
    return obj.setProp(p.name, p.value, isRef);
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
  } else if (kind === 'region') {
    // A region's name is what a script addresses it by, and the only place it
    // is written; the objective walk below would not find it.
    const regions = find(session.map.desc, 'regions');
    for (const item of regions ? children(regions) : []) {
      const n = text(find(item, 'Name'));
      if (n) seen.add(n);
    }
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

// --- IPC: everything the script editor completes from ---
//
// Three sources, and none of them is "the words already in the buffer": the
// engine's API (extracted from the manuals the game ships — src/script-api.json,
// see tools/script-api.ts), the functions and constants the game's own scripts
// declare, and the names THIS map defines. The last is the one that matters
// most: `GetObjectPosition("Isabel")` for a hero called `Isabell` fails silently
// inside the game, and a list of the map's actual names is the fix.
ipcMain.handle('script:context', async (): Promise<ScriptContextResult> => {
  const api = scriptApi as ApiFn[];
  const helpers = new Set<string>();
  const constants = new Set<string>();
  // The game's own Lua: helpers a mission is expected to call, and the constants
  // they define. Read from the data root, so it follows the installation.
  const scripts = session ? join(session.assetRoot, 'scripts') : null;
  if (scripts && existsSync(scripts)) {
    for (const f of readdirSync(scripts)) {
      if (!/\.lua$/i.test(f)) continue;
      let src: string;
      try { src = readFileSync(join(scripts, f), 'latin1'); } catch { continue; }
      for (const m of src.matchAll(/^\s*function\s+([A-Za-z_]\w*)/gm)) helpers.add(m[1]!);
      for (const m of src.matchAll(/^([A-Z][A-Z0-9_]{2,})\s*=/gm)) constants.add(m[1]!);
    }
  }
  // The ID rosters: a script says CREATURE_PEASANT and SPELL_MAGIC_ARROW, and
  // those come from the installation rather than from any document.
  if (session) {
    for (const e of [...session.registry.creatures(), ...session.registry.spells(),
      ...session.registry.artifacts(), ...session.registry.skills()]) {
      if (/^[A-Z][A-Z0-9_]*$/.test(e.id)) constants.add(e.id);
    }
  }
  const names = { object: [] as string[], region: [] as string[], objective: [] as string[] };
  if (session) {
    for (const o of session.map.objects) { const n = text(find(o.el, 'Name')); if (n && !names.object.includes(n)) names.object.push(n); }
    const regions = find(session.map.desc, 'regions');
    for (const item of regions ? children(regions) : []) { const n = text(find(item, 'Name')); if (n) names.region.push(n); }
    const collect = (el: XmlElement): void => {
      for (const c of children(el)) {
        if (c.name === 'Item') { const n = text(find(c, 'Name')); if (n && !names.objective.includes(n)) names.objective.push(n); }
        collect(c);
      }
    };
    for (const c of ['ScenarioInformation', 'Objectives']) { const el = find(session.map.desc, c); if (el) collect(el); }
  }
  return {
    api,
    helpers: [...helpers].sort(),
    constants: [...constants].sort(),
    names: {
      object: names.object.sort(), region: names.region.sort(), objective: names.objective.sort(),
    },
  };
});

/** Every file in the map folder the script editor can open — its Lua and texts. */
ipcMain.handle('map:files', async (_e: IpcMainInvokeEvent, { exts }: MapFilesPayload): Promise<MapFilesResult> => {
  if (!session) throw new Error('no map loaded');
  const want = exts.map((e) => e.toLowerCase());
  const files = listDirFiles(session.mapDir)
    .filter((rel) => want.some((e) => rel.toLowerCase().endsWith(e)))
    .sort();
  return { files };
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
  return { entries: [...mapLocalEntities(session, className), ...session.registry.objectsOfClass(className)] };
});

/**
 * Entities that live BESIDE the map, listed first.
 *
 * A mission carries its own: C1M1's splash picture is `PWL.(Texture).xdb` in the
 * map folder, referenced relatively, and the same goes for a script wrapper or a
 * light made for one map. The registry scans the data root, so without this the
 * picker offered every texture the game ships and not the one the map is about
 * to point at — and "New" wrote a document that could then only be referenced
 * by hand.
 */
function mapLocalEntities(s: Session, className: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  let files: string[];
  try { files = readdirSync(s.mapDir); } catch { return out; }
  for (const f of files.sort()) {
    if (!f.toLowerCase().endsWith('.xdb')) continue;
    let head: string;
    try { head = readFileSync(join(s.mapDir, f), 'latin1').slice(0, 400); } catch { continue; }
    // The root element IS the class, which is also what the xpointer names.
    if (!new RegExp(`<${className}[\s>]`).test(head)) continue;
    out.push({
      id: `${f}#xpointer(/${className})`,
      name: f.replace(/\.xdb$/i, ''),
      group: 'This map',
    });
  }
  return out;
}

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
  // Through the chain, so a definition that lives in a mounted mod opens too —
  // read-only either way, since it is not the map's own document.
  if (noPtr.startsWith('/')) return { file: s.assets.path(noPtr.slice(1)), editable: false };
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
  // from its schema with default values; a list of plain values gets <Item>v</Item>;
  // a list of references gets the href, which is where a reference lives.
  const arrField = resolveSchemaAtPath(mapSchema, p.path);
  const itemSchema = arrField?.items ? deref(mapSchema, arrField.items) : null;
  const done = record(session, `add ${p.path.join('.')}`, { map: true }, () => {
    if (isBuildable(itemSchema)) {
      const container = nodeAt(desc, p.path);
      if (!container) return false;
      return appendItem(desc, p.path, buildItem(mapSchema, itemSchema!, indentText(container)));
    }
    if (itemSchema?.['x-ref']) return addRefItem(desc, p.path, p.value ?? '');
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
// --- IPC: one object as a tree ---
//
// The property panel edits an object's simple fields; its STRUCTURES — a hero's
// army, a capture trigger, a monster's reward resources — have children and no
// honest text box. They are declared in the object schema's `$defs` and reached
// with the same tree the map's own settings use: one renderer, one set of edit
// primitives (src/tree.ts), rooted at the object's element instead of the map's.
ipcMain.handle('object:tree', async (_e: IpcMainInvokeEvent, p: ObjectTreePayload): Promise<ObjectTreeResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, p.id);
  return { type: obj.type, tree: readTree(obj.el) };
});
ipcMain.handle('object:set-path', async (_e: IpcMainInvokeEvent, p: ObjectSetPathPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, p.id);
  const done = record(session, `set ${p.path.join('.')}`, { map: true }, () => setPath(obj.el, p.path, p.value));
  if (!done) throw new Error(`cannot set ${p.path.join('.')}`);
  return { ok: true };
});
ipcMain.handle('object:add-item', async (_e: IpcMainInvokeEvent, p: ObjectAddItemPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, p.id);
  // A list of structures (army stacks) gets an item built from its schema with
  // the declared defaults; a list of plain values gets <Item>v</Item>.
  const arrField = resolveObjectPath(obj.type, p.path);
  const itemSchema = arrField?.items ? deref(objectSchema, arrField.items) : null;
  const done = record(session, `add ${p.path.join('.')}`, { map: true }, () => {
    if (isBuildable(itemSchema)) {
      const container = nodeAt(obj.el, p.path);
      if (!container) return false;
      return appendItem(obj.el, p.path, buildItem(objectSchema, itemSchema!, indentText(container)));
    }
    return addStringItem(obj.el, p.path, p.value ?? '');
  });
  if (!done) throw new Error(`cannot add to ${p.path.join('.')}`);
  return { ok: true };
});
ipcMain.handle('object:remove-item', async (_e: IpcMainInvokeEvent, p: ObjectRemoveItemPayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  const obj = findObject(session, p.id);
  const done = record(session, `remove ${p.path.join('.')}`, { map: true }, () => removeItem(obj.el, p.path));
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
  const file = sidecarPath(session, href);
  return { text: readSidecarText(session, href), exists: !!file && existsSync(file) };
});
ipcMain.handle('map:write-file', async (_e: IpcMainInvokeEvent, { href, text }: WriteFilePayload): Promise<ObjectEditResult> => {
  if (!session) throw new Error('no map loaded');
  if (!writeSidecarText(session, href, text)) throw new Error(`cannot write ${href}`);
  return { ok: true };
});

/**
 * Create a script and its wrapper, or adopt them if they are already there.
 *
 * A map script is two files: the `.lua` the engine runs, and a `.xdb` wrapper
 * that names it — the wrapper is what `MapScript` and a hero's `CombatScript`
 * reference, never the `.lua` directly. "New script" therefore makes both and
 * hands back the wrapper's xpointer to store in the ref.
 *
 * If a wrapper of that name exists it is adopted, not overwritten: it may name a
 * `.lua` that already holds a mission's script, and pointing at it is the intent.
 * The `.lua` is only created when missing, for the same reason `map:write-file`
 * does not clobber an existing text.
 */
ipcMain.handle('script:new', async (_e: IpcMainInvokeEvent, { base }: ScriptNewPayload): Promise<ScriptNewResult> => {
  if (!session) throw new Error('no map loaded');
  const clean = base.trim().replace(/\.(lua|xdb)$/i, '');
  if (!clean || /[/\\]/.test(clean)) throw new Error('a script name has no path or extension');
  const luaName = `${clean}.lua`;
  const wrapper = `${clean}.xdb`;
  const wrapperPath = sidecarPath(session, wrapper);
  if (!wrapperPath) throw new Error(`cannot create ${wrapper}`);
  let lua = luaName;
  if (existsSync(wrapperPath)) {
    // Adopt: keep whatever .lua the existing wrapper already names.
    lua = readScriptFileName(readSidecarText(session, wrapper)) ?? luaName;
  } else {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Script>\n'
      + `\t<FileName href="${luaName}"/>\n\t<ScriptText/>\n</Script>\n`;
    if (!writeSidecarText(session, wrapper, xml)) throw new Error(`cannot write ${wrapper}`);
  }
  const luaPath = sidecarPath(session, lua);
  if (luaPath && !existsSync(luaPath)) writeSidecarText(session, lua, '');
  return { href: `${wrapper}#xpointer(/Script)`, lua };
});

/** The `.lua` a Script wrapper names — so "Edit" opens the script, not the wrapper. */
ipcMain.handle('script:resolve', async (_e: IpcMainInvokeEvent, { href }: ScriptResolvePayload): Promise<ScriptResolveResult> => {
  if (!session) throw new Error('no map loaded');
  const lua = readScriptFileName(readSidecarText(session, href));
  if (!lua) throw new Error(`${href} names no script file`);
  return { lua };
});

// --- IPC: create a map-local town specialization and return its ref ---
// A specialization is a named town bonus. The shipped ones live in the game's
// GameMechanics/, but there is nothing special about that folder — a map can
// carry its own, packed beside map.xdb and referenced by a relative href, the
// same way scripts and texts are. RandomTown is TOWN_SCRIPT_ONLY: this is a
// named specialization for a placed town, not a member of the random pool.
ipcMain.handle('spec:new', async (_e: IpcMainInvokeEvent, { base, bonus, townType, name }: SpecNewPayload): Promise<SpecNewResult> => {
  if (!session) throw new Error('no map loaded');
  const clean = base.trim().replace(/\.xdb$/i, '');
  if (!clean || /[/\\]/.test(clean)) throw new Error('a specialization name has no path or extension');
  if (!TOWN_BONUS_IDS.has(bonus)) throw new Error(`unknown bonus ${bonus}`);
  const file = `${clean}.xdb`;
  // A display name, when given, is a sibling text file the spec points at — a
  // localizable ref like every other name in the map.
  let nameRef = '';
  if (name && name.trim()) {
    const nameFile = `${clean}-name.txt`;
    if (!writeSidecarText(session, nameFile, name.trim())) throw new Error(`cannot write ${nameFile}`);
    nameRef = nameFile;
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<TownSpecialization>\n'
    + `\t<NameFileRef href="${nameRef}"/>\n`
    + '\t<BiographyFileRef href=""/>\n'
    + `\t<Bonus>${bonus}</Bonus>\n`
    + '\t<BonusDescriptionFileRef href=""/>\n'
    + `\t<TownType>${townType}</TownType>\n`
    + '\t<RandomTown>TOWN_SCRIPT_ONLY</RandomTown>\n'
    + '</TownSpecialization>\n';
  if (!writeSidecarText(session, file, xml)) throw new Error(`cannot write ${file}`);
  return { href: `${file}#xpointer(/TownSpecialization)`, file };
});

/** The `href` of a Script wrapper's `<FileName>` — the `.lua` it runs. */
function readScriptFileName(xml: string): string | null {
  return /<FileName\s+href="([^"]*)"/i.exec(xml)?.[1] ?? null;
}

// --- Localization: author every language in the project, export one at a time
//
// The GAME reads ONE language: a text ref points at `name.txt` and the engine
// reads whatever bytes are there — you cannot switch language in play, it is the
// installation's. So localization is OURS, not the map's. Every language is kept
// side by side as a TAGGED file (`name.en.txt`, `name.ru.txt`), the plain
// `name.txt` the map references exists only as an EXPORT of one language, and a
// small sidecar (never shipped) records which languages the project carries.
//
// Enabling tags the existing texts with the base language; adding a language
// copies every base text so a translator edits in place; removing deletes them.

const LOC_FILE = 'localization.json';
/** The languages the editor offers — the codes the game's own text archives use. */
const LOC_KNOWN = new Set(['en', 'ru', 'de', 'fr', 'es', 'it', 'pl', 'cz', 'hu']);
const LOC_TAG = /\.([a-z]{2})\.txt$/i;

interface LocConfig { base: string; languages: string[] }

function locPath(s: Session): string { return join(s.mapDir, LOC_FILE); }
function readLoc(s: Session): LocConfig | null {
  const p = locPath(s);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as LocConfig; } catch { return null; }
}
function writeLoc(s: Session, cfg: LocConfig): void {
  writeFileSync(locPath(s), JSON.stringify(cfg, null, 1) + '\n');
  s.watch.resync();
}

/** Every `.txt` under the map folder, as posix paths relative to it. */
function allTexts(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let ents: string[]; try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const abs = join(dir, e); const r = rel ? `${rel}/${e}` : e;
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, r);
      else if (/\.txt$/i.test(e)) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

/** A text file's language tag, or '' when it is untagged — only KNOWN codes count. */
function locTagOf(path: string): string {
  const t = LOC_TAG.exec(path)?.[1]?.toLowerCase();
  return t && LOC_KNOWN.has(t) ? t : '';
}
/** Retag a text path to a language: `name.txt` / `name.ru.txt` → `name.<lang>.txt`. */
function locTagged(path: string, lang: string): string {
  const bare = locTagOf(path) ? path.replace(LOC_TAG, '.txt') : path;
  return bare.replace(/\.txt$/i, `.${lang}.txt`);
}

ipcMain.handle('loc:get', async (): Promise<LocResult> => {
  if (!session) throw new Error('no map loaded');
  const cfg = readLoc(session);
  return { enabled: !!cfg, base: cfg?.base ?? '', languages: cfg?.languages ?? [] };
});

ipcMain.handle('loc:enable', async (_e: IpcMainInvokeEvent, { base }: LocEnablePayload): Promise<LocResult> => {
  if (!session) throw new Error('no map loaded');
  if (readLoc(session)) throw new Error('localization is already enabled');
  if (!LOC_KNOWN.has(base)) throw new Error(`unknown language "${base}"`);
  // Tag every existing untagged text with the base language, so from now on every
  // source carries its language and the plain name.txt is an export artefact only.
  for (const rel of allTexts(session.mapDir)) {
    if (locTagOf(rel)) continue;
    const from = join(session.mapDir, rel);
    const to = join(session.mapDir, locTagged(rel, base));
    if (from !== to && !existsSync(to)) renameSync(from, to);
  }
  writeLoc(session, { base, languages: [base] });
  return { enabled: true, base, languages: [base] };
});

ipcMain.handle('loc:add-language', async (_e: IpcMainInvokeEvent, { lang }: LocLangPayload): Promise<LocResult> => {
  if (!session) throw new Error('no map loaded');
  const cfg = readLoc(session);
  if (!cfg) throw new Error('localization is not enabled');
  if (!LOC_KNOWN.has(lang)) throw new Error(`unknown language "${lang}"`);
  if (!cfg.languages.includes(lang)) {
    // A copy of every base text, so the translator edits in place rather than
    // from a blank — an untouched copy is still the base language until changed.
    for (const rel of allTexts(session.mapDir)) {
      if (locTagOf(rel) !== cfg.base) continue;
      const to = join(session.mapDir, locTagged(rel, lang));
      if (!existsSync(to)) copyFileSync(join(session.mapDir, rel), to);
    }
    cfg.languages.push(lang);
    writeLoc(session, cfg);
  }
  return { enabled: true, base: cfg.base, languages: cfg.languages };
});

ipcMain.handle('loc:remove-language', async (_e: IpcMainInvokeEvent, { lang }: LocLangPayload): Promise<LocResult> => {
  if (!session) throw new Error('no map loaded');
  const cfg = readLoc(session);
  if (!cfg) throw new Error('localization is not enabled');
  if (lang === cfg.base) throw new Error('cannot remove the base language');
  for (const rel of allTexts(session.mapDir)) {
    if (locTagOf(rel) === lang) rmSync(join(session.mapDir, rel), { force: true });
  }
  cfg.languages = cfg.languages.filter((l) => l !== lang);
  writeLoc(session, cfg);
  return { enabled: true, base: cfg.base, languages: cfg.languages };
});

/**
 * Where a text reference lands inside the map folder.
 *
 * A ref is relative to the map document, and it is not always a bare name: a
 * mission keeps its objective texts in a subfolder (`objectives/prim1_name.txt`
 * on C1M1), and flattening that to the basename wrote the file next to map.xdb
 * while the ref went on pointing into a folder that did not exist — a reference
 * to nothing, which is worse than refusing.
 *
 * Refuses to leave the map folder: a `..` in a ref would otherwise write
 * anywhere on disk, and no legitimate map has one.
 */
function sidecarPath(s: Session, href: string): string | null {
  if (!href) return null;
  const rel = href.split('#')[0]!.replace(/^[/\\]+/, '');
  if (!rel) return null;
  const file = resolve(s.mapDir, rel);
  const root = resolve(s.mapDir);
  if (file !== root && !file.startsWith(root + sep)) return null;
  return file;
}

/**
 * Read a text file the map references (name.txt, description.txt), decoding the
 * BOM the game writes. Empty href or a missing file returns '' rather than
 * throwing — a map with no name is a display gap, not an error.
 */
function readSidecarText(s: Session, href: string): string {
  const file = sidecarPath(s, href);
  if (!file || !existsSync(file)) return '';
  const buf = readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  return buf.toString('utf8');
}

/**
 * Write a text file of the map, keeping the encoding it already has.
 *
 * A NEW file's encoding follows what it is for: the game writes its display
 * texts (name.txt, an objective's caption) as UTF-16LE with a BOM, and reads
 * them back that way — but a .lua is source the engine's parser reads byte by
 * byte, and a UTF-16 script is a script it cannot run at all. So anything that
 * is not a .txt is written as plain UTF-8.
 *
 * Our own write is folded into the watcher baseline so it is not reported back
 * as somebody else's edit.
 */
function writeSidecarText(s: Session, href: string, text: string): boolean {
  const file = sidecarPath(s, href);
  if (!file) return false;
  // A ref into a subfolder the map does not have yet is how the folder gets
  // made — the original's objective texts live in one.
  mkdirSync(dirname(file), { recursive: true });
  const isText = /\.txt$/i.test(file);
  let enc: 'utf16le' | 'utf8' = isText ? 'utf16le' : 'utf8';
  let bom = isText;
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
    () => terrainDoc(session!, p.floor).paintTile(p.tile, p.verts, p.strength ?? 255, p.exclusive ?? true));
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

/**
 * Name every tile the terrain paints with in the map's own `<tiles>` list.
 *
 * The list is derived data — the same set of `AdvMapTile` documents the terrain
 * layers use, pointed at from the map instead of from the terrain — and the
 * editor is what keeps the two in step. Ours did not: the reconstruction added
 * twelve layers and left `<tiles>` empty, which the original never does.
 *
 * Add-only, and matched case-insensitively: a map's own list carries the game's
 * spelling (`/MapObjects/…/Field.xdb`) while the terrain keeps a lowercased one,
 * so comparing literally would append a second entry for a tile already there.
 * Nothing is ever removed — a layer cannot be taken away, and an entry we did
 * not put there is not ours to judge.
 *
 * @returns how many entries it added.
 */
function syncMapTiles(s: Session, layerPaths: string[]): number {
  const desc = s.map.desc;
  const key = (v: string): string => v.toLowerCase().replace(/^\/+/, '').split('#')[0]!;
  const tree = readTree(desc) as Record<string, unknown>;
  const have = new Set((Array.isArray(tree.tiles) ? tree.tiles : [])
    .filter((v): v is string => typeof v === 'string').map(key));
  let added = 0;
  for (const path of layerPaths) {
    if (!path || have.has(key(path))) continue;
    // The map points INTO the tile document, the way every other reference in
    // the file does; the terrain stores the plain file path.
    if (!addRefItem(desc, ['tiles'], `${path}#xpointer(/AdvMapTile)`)) break;
    have.add(key(path));
    added++;
  }
  return added;
}

// --- IPC: give this map a layer for a tile it does not carry ---
// The only terrain edit that changes the file's structure rather than its
// bytes, so it is a deliberate action rather than something a brush stroke
// triggers. Returns a rebuilt splat: one more layer means a new shader and new
// mask groups, which the renderer cannot patch in place.
ipcMain.handle('terrain:add-layer', async (_e: IpcMainInvokeEvent, p: AddLayerPayload): Promise<AddLayerResult> => {
  if (!session) throw new Error('no map loaded');
  const doc = terrainDoc(session, p.floor);
  // Two documents, one edit: the layer goes into the terrain, and the map's own
  // tile set has to name the tile as well (see syncMapTiles). Recorded together
  // so undo takes both back.
  record(session, 'add ground layer', { map: true, floors: [p.floor] }, () => {
    doc.addLayer(p.tile);
    syncMapTiles(session!, doc.layerPaths().filter((x): x is string => !!x));
  });
  const paths = doc.layerPaths().filter((x) => x);
  // Keep the palette's "already in this map" markers in step for every floor.
  session.layerPaths = [...new Set([...session.layerPaths, ...paths])];
  return { ok: true, splat: splatFor(doc.buffer(), session.assets), inMap: paths };
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
  // Last chance to keep the derived tile set honest. add-layer already does it,
  // but a map whose layers predate that — ours did — would otherwise carry an
  // empty <tiles> forever, and nothing else would ever notice.
  const tilesAdded = syncMapTiles(session, session.layerPaths);
  if (tilesAdded) console.log(`[save] tile set: named ${tilesAdded} tile(s) the terrain paints with`);
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
  const rel = relative(gameData(), mapDir);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  // Outside the data root. Take everything from the last Maps/ segment on, and
  // failing that assume a single-scenario map of that folder's name.
  const parts = mapDir.split(sep);
  const i = parts.lastIndexOf('Maps');
  return i >= 0 ? parts.slice(i).join('/') : `Maps/SingleMissions/${basename(mapDir)}`;
}

/**
 * Write the map's `map-tag.xdb` — the lobby index — into the map folder, fresh
 * from the current map.xdb, so the pack that follows includes it. Without this
 * tag the game never lists the map in its single-scenario / custom-game menus:
 * the browser indexes tags, not maps (see src/map-tag.ts).
 */
function writeMapTag(s: Session): void {
  writeFileSync(join(s.mapDir, 'map-tag.xdb'), buildMapTag(s.map.desc), 'latin1');
}

/**
 * Where the Pack dialog opens: our folder in the install, under this name.
 *
 * The game our build is — the patched executable — reads `H5E/*.mod` and nothing
 * in `Maps/`, so a map packed anywhere else is a map it will not list
 * (src/mod-paths.ts). Without an install configured there is nowhere to offer,
 * and the map's own folder is the honest fallback.
 */
function packDefault(name: string, mapDir: string): string {
  const root = gameRoot();
  return root ? modFile(root, 'map', name) : `${mapDir}.${MOD_EXT.map}`;
}

// --- IPC: pack the map folder into a .mod ---
ipcMain.handle('map:pack', async (): Promise<MapPackResult> => {
  if (!session) throw new Error('no map loaded');
  // A localized map has no plain name.txt on disk — the game would find tagged
  // files and the sidecar and no text at all. Export bakes one language in.
  if (readLoc(session)) throw new Error('this map is localized — use Localize → “export .mod” to pack a single language');
  const opts = {
    title: 'Pack map to .mod',
    defaultPath: packDefault(basename(session.mapDir), session.mapDir),
    filters: [{ name: 'HoMM5 map', extensions: ['mod', 'h5m'] }],
  };
  // Electron treats a null parent as "no parent"; pick the overload to match.
  const parent = win;
  const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
  if (r.canceled) return { canceled: true };
  // Save pending edits first so the archive reflects them.
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  saveTerrain(session);
  writeMapTag(session);
  session.watch.resync();
  // A copy of the map should be as complete as the original it came from, so it
  // carries over whatever the source archive held outside the map folder too.
  const from = readManifest(session.mapDir).source?.path;
  // Our folder may not be there yet on a fresh install, and the dialog does not
  // make one for a path it only suggested.
  mkdirSync(dirname(r.filePath), { recursive: true });
  const res = packProject(session.mapDir, r.filePath,
    { prefix: archivePrefixFor(session.mapDir), preserveFrom: from });
  return { ok: true, output: r.filePath, entries: res.entries, bytes: res.bytes, status: status(session.mapDir) };
});

/**
 * Export a single-language `.h5m` from a localized map.
 *
 * The game reads one language: this bakes the chosen one into the plain `.txt`
 * files the map references (falling back to the base where a translation is
 * missing) and packs an ordinary map — the tagged sources and the sidecar do not
 * ship. `output` skips the dialog (a test, or a caller that knows the path).
 */
ipcMain.handle('loc:export', async (_e: IpcMainInvokeEvent, { lang, output }: LocExportPayload): Promise<MapPackResult> => {
  if (!session) throw new Error('no map loaded');
  const cfg = readLoc(session);
  if (!cfg) throw new Error('localization is not enabled for this map');
  if (!cfg.languages.includes(lang)) throw new Error(`the map has no ${lang} texts`);
  let out = output;
  if (!out) {
    const opts = {
      title: `Export ${lang} map to .mod`,
      defaultPath: packDefault(`${basename(session.mapDir)}.${lang}`, `${session.mapDir}.${lang}`),
      filters: [{ name: 'HoMM5 map', extensions: ['mod', 'h5m'] }],
    };
    const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts));
    if (r.canceled || !r.filePath) return { canceled: true };
    out = r.filePath;
  }
  // Save pending edits so the export reflects them.
  writeFileSync(session.mapPath, session.map.save(), 'latin1');
  saveTerrain(session);
  writeMapTag(session);
  session.watch.resync();
  mkdirSync(dirname(out), { recursive: true });
  const res = exportLocalized(session.mapDir, out, lang, cfg.base, { prefix: archivePrefixFor(session.mapDir) });
  return { ok: true, output: out, entries: res.entries, bytes: res.bytes, status: status(session.mapDir) };
});

// --- IPC: the ground-tile palette (terrain brushes) ---
// Decoding 80+ tile textures takes ~1s, and the set never changes while the app
// runs, so it's built once and reused. `inMap` marks the tiles this map's
// terrain already has a layer for — those are the ones paintable without
// restructuring the .bin.
let tileCache: { root: string; tiles: TileInfo[] } | null = null;
ipcMain.handle('terrain:tiles', async (): Promise<TerrainTilesResult> => {
  const root = session?.assetRoot
    || (existsSync(join(gameData(), 'MapObjects')) ? gameData() : null);
  if (!root) return { tiles: [], inMap: [] };
  if (!tileCache || tileCache.root !== root) tileCache = { root, tiles: listTiles(session?.assets ?? mountedAssets(root)) };
  const inMap = session?.layerPaths || [];
  return { tiles: tileCache.tiles, inMap };
});

// --- IPC: project status (drift vs last pack) ---
ipcMain.handle('map:status', async (): Promise<MapStatusResult> => {
  if (!session) return null;
  return status(session.mapDir);
});

// --- IPC: campaigns ---------------------------------------------------------
//
// A campaign project is a folder under <data>/Campaigns holding campaign.xdb
// and its texts — the same layout that goes into UserCampaigns/<name>/ inside
// the .h5c, so packing is a copy. The maps are NOT part of it: a mission names
// its map by an absolute data-root path and the game's VFS finds it in whatever
// .h5m ships it, which is why picking a map here only records a path.

/** Where campaign projects live, mirroring <data>/Maps for map projects. */
const campaignsDir = (): string => join(gameData(), 'Campaigns');

/** The map-tag href a mission uses to name the map at `rel` under Maps. */
const missionTagFor = (mapRel: string): string =>
  mapRel ? `/Maps/${mapRel}/map-tag.xdb#xpointer(/AdvMapDescTag)` : '';

/** And back: the path under Maps a mission's tag names. */
const mapRelOf = (href: string): string => {
  const dir = missionMapDir(href);           // Maps/SingleMissions/Foo
  return dir.replace(/^Maps\//i, '');
};

/** Read a campaign project into the document the dialogs edit. */
function readCampaignDoc(dir: string): CampaignDoc {
  const root = loadCampaignProject(dir);
  const doc: CampaignDoc = {
    dir,
    name: basename(dir),
    internalName: childText(root, 'InternalName'),
    summary: readProjectText(dir, CAMPAIGN_TEXTS.NameCommentFileRef!),
    description: readProjectText(dir, CAMPAIGN_TEXTS.DescriptionFileRef!),
    missions: [],
  };
  missions(root).forEach((m, i) => {
    const texts = missionTexts(i);
    doc.missions.push({
      mapRel: mapRelOf(find(m, 'MissionTag')?.attrs.href ?? ''),
      name: readProjectText(dir, texts.NameFileRef!),
      description: readProjectText(dir, texts.NameCommentFileRef!),
      heroes: readHeroesPool(m).map((h) => ({
        scriptName: h.scriptName, targetCampaign: h.targetCampaign, targetMission: h.targetMission,
      })),
      bonuses: readBonuses(m),
    });
  });
  return doc;
}

/** Write one back: the descriptor's missions, then every text file it names. */
function writeCampaignDoc(doc: CampaignDoc): void {
  const root = loadCampaignProject(doc.dir);

  // The mission list is rebuilt to match the document, so a reorder in the UI
  // lands as a reorder here — and campaign-project renumbers the handovers.
  while (missions(root).length) removeMission(root, 0);
  for (const m of doc.missions) addMission(root, missionTagFor(m.mapRel));

  missions(root).forEach((el, i) => {
    const m = doc.missions[i]!;
    writeHeroesPool(el, m.heroes.map((h) => ({
      scriptName: h.scriptName,
      targetCampaign: h.targetCampaign || '',
      // Only an explicit destination survives; the rest follow the play order.
      targetMission: h.targetCampaign ? (h.targetMission ?? 0) : handOnTo(i),
    })));
    writeBonuses(el, m.bonuses);
    const texts = missionTexts(i);
    writeProjectText(doc.dir, texts.NameFileRef!, m.name);
    writeProjectText(doc.dir, texts.NameCommentFileRef!, m.description);
  });

  const internal = find(root, 'InternalName');
  if (internal) setText(internal, doc.internalName || doc.name);
  saveCampaignProject(doc.dir, root);

  writeProjectText(doc.dir, CAMPAIGN_TEXTS.NameFileRef!, doc.name);
  writeProjectText(doc.dir, CAMPAIGN_TEXTS.FullNameFileRef!, doc.name);
  writeProjectText(doc.dir, CAMPAIGN_TEXTS.NameCommentFileRef!, doc.summary);
  writeProjectText(doc.dir, CAMPAIGN_TEXTS.DescriptionFileRef!, doc.description);
}

ipcMain.handle('campaign:list', async (): Promise<CampaignListResult> => {
  if (!existsSync(campaignsDir())) return { campaigns: [] };
  const campaigns: CampaignListEntry[] = [];
  for (const e of readdirSync(campaignsDir())) {
    const dir = join(campaignsDir(), e);
    if (!existsSync(join(dir, 'campaign.xdb'))) continue;
    try {
      campaigns.push({ name: e, dir, missions: missions(loadCampaignProject(dir)).length });
    } catch { /* not a campaign we can read — leave it out of the list */ }
  }
  return { campaigns };
});

ipcMain.handle('campaign:new', async (_e: IpcMainInvokeEvent, p: NewCampaignPayload): Promise<CampaignDoc> => {
  const name = p.name.trim();
  if (!name) throw new Error('the campaign needs a name');
  if (/[\/:*?"<>|]/.test(name)) throw new Error('the name cannot contain \ / : * ? " < > |');
  const dir = join(campaignsDir(), name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  for (const f of buildNewCampaignProject(name)) writeFileSync(join(dir, f.path), f.data);
  return readCampaignDoc(dir);
});

ipcMain.handle('campaign:open', async (_e: IpcMainInvokeEvent, p: CampaignDirPayload): Promise<CampaignDoc> =>
  readCampaignDoc(p.dir));

ipcMain.handle('campaign:save', async (_e: IpcMainInvokeEvent, p: SaveCampaignPayload): Promise<CampaignDoc> => {
  writeCampaignDoc(p.doc);
  return readCampaignDoc(p.doc.dir);
});

// Which heroes a mission on this map can hand on.
//
// A hero travels under his CHARACTER's name — the <InternalName> of the
// AdvMapHeroShared he is an instance of — not under whatever the object on the
// map is called. So each placed hero is resolved through its shared document;
// one that cannot be read offers nothing rather than a name that would match no
// character and silently never travel.
ipcMain.handle('campaign:map-heroes', async (_e: IpcMainInvokeEvent, p: MapHeroesPayload): Promise<MapHeroesResult> => {
  const xdb = join(gameData(), 'Maps', ...p.mapRel.split('/'), 'map.xdb');
  if (!existsSync(xdb)) return { heroes: [], entryPoint: false };
  const xml = readFileSync(xdb, 'latin1');
  const heroes: string[] = [];
  for (const h of placedHeroes(xml)) {
    const file = join(gameData(), ...h.shared.replace(/#.*$/, '').replace(/^\/+/, '').split('/'));
    if (!existsSync(file)) continue;
    const name = heroScriptName(readFileSync(file, 'latin1'));
    if (name && !heroes.includes(name)) heroes.push(name);
  }
  return { heroes, entryPoint: hasEntryPoint(xml) };
});

ipcMain.handle('campaign:pack', async (_e: IpcMainInvokeEvent, p: CampaignDirPayload): Promise<CampaignPackResult> => {
  // Our build reads campaigns out of our own folder, not <game>/UserCampaigns,
  // so offer that when there is an install to offer it in. That is the game
  // folder, NOT the parent of the data root — an unpacked tree can live
  // anywhere, including inside this checkout.
  const root = gameRoot();
  const name = basename(p.dir);
  const opts = {
    title: 'Pack campaign to .h5c',
    defaultPath: root ? modFile(root, 'campaign', name) : join(p.dir, `${name}.h5c`),
    filters: [{ name: 'HoMM5 campaign', extensions: ['h5c'] }],
  };
  const parent = win;
  const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
  if (r.canceled || !r.filePath) return { canceled: true };
  mkdirSync(dirname(r.filePath), { recursive: true });
  const res = packCampaign(p.dir, r.filePath);
  return { ok: true, output: r.filePath, entries: res.entries, bytes: res.bytes };
});

// --- units mod ----------------------------------------------------------------
//
// Game-global and session-free: a creature mod is an archive in our folder plus a
// ceiling in the executable, nothing of the open map — so the dialog works with
// no map loaded. The building blocks are the same ones tools/units-mod.ts uses.

ipcMain.handle('mods:list', async (): Promise<ModsListResult> => {
  const g = gameRoot();
  if (!g) return { gameRoot: null, mods: [] };
  const mods = findCreatureMods(g).map((f) => ({
    path: f.path,
    stem: basename(f.path).replace(/\.[^.]+$/, ''),
    limit: f.limit,
    reconstructed: !!f.reconstructed,
    creatures: f.mod.creatures.map((c) => ({
      id: c.id, number: c.number, name: c.name, tier: c.stats.tier, gold: c.stats.gold,
    })),
    artifacts: (f.mod.artifacts ?? []).map((a) => ({
      id: a.id, number: a.number, name: a.name, slot: a.slot,
    })),
    // `?? []` and not a plain read: a mod installed before sets existed has a
    // manifest without the field, and it stays listable.
    sets: (f.mod.sets ?? []).map((s) => ({
      effect: s.effect, number: s.number, name: s.name, artifacts: s.artifacts,
    })),
  }));
  return { gameRoot: g, mods };
});

// Rosters and presets come from the plain data root, not the mounted chain:
// install resolves the donor's documents there, so offering a mod's own
// creature would offer a choice that then fails.
ipcMain.handle('mods:form-data', async (): Promise<ModsFormDataResult> => {
  if (!isConfigured()) throw new Error('no data root configured');
  const r = new Registry(gameData());
  return {
    donors: r.creatures(),
    artifactDonors: r.artifacts(),
    effectStats: [...EFFECT_STATS],
    abilities: creatureAbilities(assets([gameData()])),
    towns: r.races(),
  };
});

ipcMain.handle('mods:preset', async (_e: IpcMainInvokeEvent, { donor }: ModsPresetPayload): Promise<CreaturePresetDTO> => {
  if (!isConfigured()) throw new Error('no data root configured');
  const preset = creaturePreset(assets([gameData()]), donor);
  if (!preset) throw new Error(`cannot read the donor ${donor || '(none)'}`);
  return preset;
});

ipcMain.handle('mods:artifact-preset', async (_e: IpcMainInvokeEvent, { donor }: ModsPresetPayload): Promise<ArtifactPresetDTO> => {
  if (!isConfigured()) throw new Error('no data root configured');
  const preset = artifactPreset(assets([gameData()]), donor);
  if (!preset) throw new Error(`cannot read the donor ${donor || '(none)'}`);
  return preset;
});

/**
 * OUR mod: the one manifest-carrying archive in our folder, or a fresh one under
 * the default stem. The dialog never picks the archive — two creature mods
 * conflict outright, so the only sane target is the one that exists.
 */
function ourMod(g: string): CreatureMod {
  const ours = findCreatureMods(g).filter((f) => !f.reconstructed);
  if (ours.length > 1) {
    throw new Error(`more than one creature mod in ${MOD_DIR} (${ours.map((f) => basename(f.path)).join(', ')}) — they conflict; remove one first`);
  }
  return ours[0]?.mod ?? newCreatureMod(MOD_STEM);
}

/** Build the mod, pack it, install it — the shared tail of both installs. */
function buildAndInstall(g: string, mod: CreatureMod): { installed: Installed; report: BuildReport } {
  const report = buildCreatureMod(mod, dataReader(gameData()));
  const archive = packCreatureMod(report);
  return { installed: installCreatureMod(g, mod, archive), report };
}

const exeWords = (r: ExeResult | ArtifactExeResult | null): string =>
  r ? `${basename(r.path)} → ceiling ${r.to}${'build' in r ? ` (${r.build})` : ''}` : 'executable not touched';

ipcMain.handle('mods:install', async (_e: IpcMainInvokeEvent, p: ModsInstallPayload): Promise<ModsInstallResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured — a mod needs a folder to install into and the executable');
  if (!isConfigured()) throw new Error('no data root configured');
  if (!p.file.trim()) throw new Error('the file stem is required');

  const mod = ourMod(g);
  const sources = creatureSources(assets([gameData()]), p.donor);
  if (!sources) throw new Error(`cannot resolve the donor ${p.donor || '(none)'}`);

  // Art overrides: only the slots the form actually changed away from empty.
  const art: Partial<Record<'character' | 'model' | 'animSet' | 'icon', string>> = {};
  for (const [slot, href] of Object.entries(p.art ?? {})) {
    if (href && href.trim()) art[slot as keyof typeof art] = href.trim();
  }

  addCreature(mod, {
    id: p.id.trim(), file: p.file.trim(),
    name: p.name, description: p.description, abilitiesText: p.abilitiesText,
    stats: { ...blankStats(), ...p.stats },
    visualSource: sources.visual, monsterSource: sources.monster,
    ...(Object.keys(art).length ? { art } : {}),
  });

  const { installed, report } = buildAndInstall(g, mod);
  const added = mod.creatures[mod.creatures.length - 1]!;
  return { archive: installed.archive, limit: report.limit, exe: exeWords(installed.exe), art: report.art[added.id] ?? 0 };
});

ipcMain.handle('mods:install-artifact', async (_e: IpcMainInvokeEvent, p: ModsInstallArtifactPayload): Promise<ModsInstallArtifactResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured — a mod needs a folder to install into and the executable');
  if (!isConfigured()) throw new Error('no data root configured');
  if (!p.file.trim()) throw new Error('the file stem is required');
  if (!p.icon.trim()) throw new Error('an icon href is required — take the donor\'s');

  const mod = ourMod(g);
  const stats: Partial<HeroStats> = {};
  for (const k of ['Attack', 'Defence', 'Knowledge', 'SpellPower', 'Morale', 'Luck'] as const) {
    const v = Number(p.stats?.[k] ?? 0);
    if (v) stats[k] = v;
  }
  addArtifact(mod, {
    id: p.id.trim(), file: p.file.trim(),
    name: p.name, description: p.description,
    slot: p.slot as ArtifactSlot, rank: p.rank as ArtifactRank,
    cost: Number(p.cost) || 0, aiValue: Number(p.aiValue) || 0,
    canBeGeneratedToSell: !!p.canBeGeneratedToSell,
    ...(Object.keys(stats).length ? { stats } : {}),
    ...(effectsFrom(p.effects) ? { effects: effectsFrom(p.effects)! } : {}),
    icon: p.icon.trim(),
    // No model → a flat board of the artifact's own icon stands on the map.
    ...(p.model?.trim() ? { model: p.model.trim() } : { board: { tiles: p.boardTiles || 1 } }),
  });

  const { installed } = buildAndInstall(g, mod);
  // The effects file is rewritten from the WHOLE mod every time, not appended
  // to: an artifact removed from the mod must stop granting its bonus, and a
  // file that only ever grows would keep it.
  writeEffectsFile(g, effectsOf(mod.artifacts ?? []));
  return {
    archive: installed.archive,
    limit: artifactLimit(mod),
    exe: exeWords(installed.artifacts),
  };
});

/** Only the stats the extension knows, and only when they are not zero. */
function effectsFrom(raw: Record<string, number> | undefined): Partial<Record<EffectStat, number>> | null {
  if (!raw) return null;
  const out: Partial<Record<EffectStat, number>> = {};
  for (const stat of EFFECT_STATS) {
    const v = Number(raw[stat] ?? 0);
    if (v) out[stat] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The spec an artifact payload describes, shared by install and update. */
function artifactSpecOf(p: ModsInstallArtifactPayload): ArtifactSpec {
  const stats: Partial<HeroStats> = {};
  for (const k of ['Attack', 'Defence', 'Knowledge', 'SpellPower', 'Morale', 'Luck'] as const) {
    const v = Number(p.stats?.[k] ?? 0);
    if (v) stats[k] = v;
  }
  const effects = effectsFrom(p.effects);
  return {
    id: p.id.trim(), file: p.file.trim(),
    name: p.name, description: p.description,
    slot: p.slot as ArtifactSlot, rank: p.rank as ArtifactRank,
    cost: Number(p.cost) || 0, aiValue: Number(p.aiValue) || 0,
    canBeGeneratedToSell: !!p.canBeGeneratedToSell,
    ...(Object.keys(stats).length ? { stats } : {}),
    ...(effects ? { effects } : {}),
    icon: p.icon.trim(),
    ...(p.model?.trim() ? { model: p.model.trim() } : { board: { tiles: p.boardTiles || 1 } }),
  };
}

ipcMain.handle('mods:update-artifact', async (_e: IpcMainInvokeEvent, p: ModsInstallArtifactPayload): Promise<ModsInstallArtifactResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  if (!isConfigured()) throw new Error('no data root configured');
  const mod = ourMod(g);
  updateArtifact(mod, p.id.trim(), artifactSpecOf(p));
  const { installed } = buildAndInstall(g, mod);
  writeEffectsFile(g, effectsOf(mod.artifacts ?? []));
  return { archive: installed.archive, limit: artifactLimit(mod), exe: exeWords(installed.artifacts) };
});

ipcMain.handle('mods:remove-artifact', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  if (!isConfigured()) throw new Error('no data root configured');
  const mod = ourMod(g);
  const gone = removeArtifact(mod, id);
  // Rebuilt and reinstalled, ceiling and all: the executable's artifact count
  // has to come back down with it or the game reads a table shorter than it
  // was told to expect.
  const { installed } = buildAndInstall(g, mod);
  writeEffectsFile(g, effectsOf(mod.artifacts ?? []));
  return { archive: installed.archive, removed: gone.id };
});

// Looked up BEFORE anything is removed, so the person deciding sees the list.
// A map names an artifact by name, so this is exact rather than a guess.
ipcMain.handle('mods:artifact-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
  const uses = findArtifactUses(join(gameData(), 'Maps'), [id]).get(id) ?? [];
  return { uses: describeUses(uses) };
});

ipcMain.handle('mods:remove-set', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  if (!isConfigured()) throw new Error('no data root configured');
  const mod = ourMod(g);
  const gone = removeArtifactSet(mod, id);
  const { installed } = buildAndInstall(g, mod);
  return { archive: installed.archive, removed: gone.effect };
});

ipcMain.handle('mods:update-set', async (_e: IpcMainInvokeEvent, p: ModsInstallSetPayload): Promise<ModsInstallSetResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  if (!isConfigured()) throw new Error('no data root configured');
  const mod = ourMod(g);
  const set = updateArtifactSet(mod, p.effect.trim(), {
    effect: p.effect.trim(),
    artifacts: p.artifacts.map((a) => a.trim()).filter(Boolean),
    file: p.file.trim(),
    name: p.name,
    description: p.description,
    ...(p.perCount?.length ? { perCount: p.perCount } : {}),
  });
  const { installed } = buildAndInstall(g, mod);
  return { archive: installed.archive, number: set.number };
});

ipcMain.handle('mods:creature-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
  const uses = findCreatureUses(join(gameData(), 'Maps'), [id]).get(id) ?? [];
  return { uses: describeUses(uses) };
});

ipcMain.handle('mods:remove-creature', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  if (!isConfigured()) throw new Error('no data root configured');
  const mod = ourMod(g);
  const gone = removeCreature(mod, id);
  // The ceiling comes down with it: an executable told to expect more creatures
  // than the mod carries reads past the end of the table.
  const { installed } = buildAndInstall(g, mod);
  return { archive: installed.archive, removed: gone.id };
});

ipcMain.handle('mods:extension-status', async (): Promise<ExtensionStatus> => {
  const g = gameRoot();
  if (!g) return { present: false, imported: false, installed: false };
  return { ...extensionState(g), ...(existsSync(builtDll(APP_ROOT)) ? {} : { unbuilt: true }) };
});

ipcMain.handle('mods:install-extension', async (): Promise<ExtensionStatus> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  return installExtension(g, APP_ROOT);
});

// A set costs the executable nothing — no table is indexed by it, no ceiling
// counts it. It rides in the same archive as everything else because a mod
// replaces `types.xml` whole rather than merging it, which is also why members
// may name the mod's own artifacts: by then they are in the same file.
ipcMain.handle('mods:install-set', async (_e: IpcMainInvokeEvent, p: ModsInstallSetPayload): Promise<ModsInstallSetResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured — a mod needs a folder to install into and the executable');
  if (!isConfigured()) throw new Error('no data root configured');
  if (!p.file.trim()) throw new Error('the file stem is required');

  const mod = ourMod(g);
  const known = new Set([
    ...(mod.artifacts ?? []).map((a) => a.id),
    ...new Registry(gameData()).artifacts().map((a) => a.id),
  ]);
  const members = p.artifacts.map((id) => id.trim()).filter(Boolean);
  // Caught here rather than at build time: a misspelt member produces a set
  // that installs cleanly and never combines, which is the worst kind of quiet.
  const unknown = members.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`no such artifact: ${unknown.join(', ')}`);

  const set = addArtifactSet(mod, {
    effect: p.effect.trim(),
    artifacts: members,
    file: p.file.trim(),
    name: p.name,
    description: p.description,
    ...(p.perCount?.length ? { perCount: p.perCount } : {}),
  });

  const { installed } = buildAndInstall(g, mod);
  return { archive: installed.archive, number: set.number };
});

/** Our mod's archive and the creature in it, for the texture channels. */
function modCreatureArchive(g: string, creatureId: string): { path: string; creature: ModCreature } {
  for (const f of findCreatureMods(g)) {
    if (f.reconstructed) continue;
    const creature = f.mod.creatures.find((c) => c.id === creatureId);
    if (creature) return { path: f.path, creature };
  }
  throw new Error(`${creatureId} is not in any manifest-carrying mod in ${MOD_DIR}`);
}

ipcMain.handle('mods:textures', async (_e: IpcMainInvokeEvent, { creature }: ModsTexturesPayload): Promise<ModsTexturesResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  const found = modCreatureArchive(g, creature);
  const prefix = `Units/${found.creature.file}/`;
  const textures: ModsTexturesResult['textures'] = [];
  const pixels: Uint8Array[] = [];
  for (const e of readEntries(readFileSync(found.path))) {
    const name = e.name.replace(/\\/g, '/');
    if (!name.startsWith(prefix) || !name.toLowerCase().endsWith('.dds')) continue;
    const img = decodeDDSBuffer(e.data);
    pixels.push(img.rgba);
    textures.push({ path: name, width: img.width, height: img.height, png: pngDataUri(img.width, img.height, img.rgba) });
  }
  return { textures, palette: extractPalette(pixels) };
});

// Recolouring REWRITES the archive in place: the mod's textures are its own
// copies (that is what the art closure is for), so no shipped file is touched
// and reverting is re-picking the donor. The ceilings do not move — no install,
// just the new bytes where the old ones were.
ipcMain.handle('mods:recolor', async (_e: IpcMainInvokeEvent, p: ModsRecolorPayload): Promise<ModsRecolorResult> => {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured');
  if (!isConfigured()) throw new Error('no data root configured');
  if (isIdentity(p.ops)) throw new Error('nothing to change — every control is at its neutral value');

  // RECORDED, then rebuilt — not painted onto the archive in place. A build
  // copies the creature's art off the game's data every time, so paint applied
  // to the bytes afterwards lasts exactly until the next thing that touches the
  // mod: add an artifact, and the creature is the donor's colours again with
  // nothing anywhere to say it ever was not. Kept on the creature, every build
  // reapplies it.
  const mod = ourMod(g);
  const creature = mod.creatures.find((c) => c.id === p.creature);
  if (!creature) throw new Error(`${p.creature} is not in ${modFile(g, 'mod', mod.stem)}`);
  creature.recolor = p.ops;

  const { installed, report } = buildAndInstall(g, mod);
  const prefix = `Units/${creature.file}/`;
  const textures = report.files.filter(
    (x) => x.path.split('\\').join('/').startsWith(prefix) && x.path.toLowerCase().endsWith('.dds'),
  ).length;
  if (!textures) throw new Error(`${p.creature} carries no textures to recolour`);
  return { archive: installed.archive, textures };
});

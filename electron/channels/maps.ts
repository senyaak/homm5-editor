// Opening a map, and everything that has to happen before one can be edited.
//
// Every map the editor opens is inside an archive — ours in H5E/, the game's in
// its paks — so opening one means unpacking it somewhere first, and that
// somewhere is a workspace per archive under _tmp that nobody has to look at or
// clean up. Loading is the heavy step: the terrain and every placed model are
// decoded into the scene the renderer draws, and the session that comes out is
// what the rest of the channels edit.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { historyPathFor, loadHistory } from '#electron/edits.ts';
import type { ExternalChange, MapListEntry, MapLoadResult, MapsListResult, MapStatusResult, NewMapPayload, NewMapResult, OpenArchivePayload, OpenArchiveResult, OpenMapDialogResult } from '#electron/ipc.ts';
import { gameData, gameRoot, mountedAssets, readSettings, tmpRoot } from '#electron/paths.ts';
import { assetRootFor, historyState, state, syncMapTiles } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { extractMapFolder, gameArchives, listOurMaps, listStockMaps, mapFolderIn } from '#src/map/map-source.ts';
import type { MapSource } from '#src/map/map-source.ts';
import { ensureModDir, modDir, modFile } from '#src/game/mod-paths.ts';
import { buildNewMapProject } from '#src/map/new-map.ts';
import { listDirFiles } from '#src/format/pak.ts';
import { initProject, MANIFEST_NAME, openProject, packProject, pickMapRel, readManifest, status, writeManifest } from '#src/map/project.ts';
import { History } from '#src/map/history.ts';
import { Registry } from '#src/schema/registry.ts';
import { buildScene } from '#src/scene/scene.ts';
import { MAP_SIZES } from '#src/terrain/terrain-blank.ts';
import { watchMapDir } from '#src/map/watch.ts';

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

// The maps on offer — ours, and the game's own.
//
// Both come out of archives in the install, never out of the unpacked data:
// `<game>/H5E/*.h5m` are ours, `<game>/data/*.pak` hold the shipped ones. What
// each list is and how it is read lives in src/map-source.ts, where it can be
// tested without a window; the stock ones are cached because their archives do
// not change while the editor runs.
let stockMaps: { root: string; maps: MapSource[] } | null = null;

/** Unpacked archives, one folder per archive. */
const workspaces = (): string => join(tmpRoot(), 'workspaces');

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
 * in-game path: with it pointed at the data root, `Foo.h5m` unpacks to
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

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerMaps(): void {
  ipcMain.handle('maps:list', async (): Promise<MapsListResult> => {
    const g = gameRoot();
    const started = performance.now();
    if (g && stockMaps?.root !== g) stockMaps = { root: g, maps: listStockMaps(g) };
    const maps: MapListEntry[] = [...listOurMaps(g), ...(g ? stockMaps!.maps : [])];
    console.log(`[perf] maps:list ${(performance.now() - started) | 0}ms · ${maps.length} maps`);
    return { root: g ?? gameData(), maps };
  });

  // Open a map file via the OS dialog (starts in the last-used folder).
  ipcMain.handle('dialog:openMap', async (): Promise<OpenMapDialogResult> => {
    const opts = {
      title: 'Open a map',
      defaultPath: openDialogDir(),
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
    const parent = state.win;
    const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
    return r.canceled ? null : r.filePaths[0];
  });

  // Create a blank map from scratch (the original's New Map).
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

    // A new map is a FILE from the moment it exists: `<game>/H5E/<name>.h5m`, the
    // one our build reads and the only place the picker looks. It is written into
    // a working folder like any other map (unpackRoot) and packed straight away,
    // so Save goes back into the archive and there is never a map that exists only
    // as a folder nothing ships from.
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

  // Open a packed .h5m as an editable project.
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
      const open = state.session;
      if (open && open.mapDir.startsWith(stale)) { open.watch.stop(); state.session = null; }
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

  // Load a map -> decode into a renderable scene.
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
    state.session?.watch.stop();
    const watch = watchMapDir(mapDir, (c) => {
      const touched = [...c.changed, ...c.added, ...c.removed];
      const payload: ExternalChange = {
        mapPath,
        changed: c.changed, added: c.added, removed: c.removed,
        map: touched.some((f) => /(^|\/)map\.xdb$/i.test(f)),
        terrain: touched.some((f) => /(^|\/)GroundTerrain\.bin$/i.test(f)),
      };
      state.win?.webContents.send('map:external-change', payload);
    });
    const session: Session = {
      mapPath, mapDir, assetRoot, assets: data, map, layerPaths, watch, terrain: new Map(), resolver,
      history: new History(), historyPath: historyPathFor(mapDir),
      registry: new Registry(data),
    };
    state.session = session;
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

  // Put the open map down.
  //
  // The watcher is the reason this is a call and not a renderer-only affair: left
  // running, a closed map's folder would keep pushing "changed on disk" at a window
  // that no longer holds it, and on Windows the open handle alone is enough to stop
  // that folder being deleted or replaced — which is exactly what opening the same
  // archive again goes on to do.
  ipcMain.handle('map:close', (): void => {
    state.session?.watch.stop();
    state.session = null;
  });

  // Project status (drift vs last pack).
  ipcMain.handle('map:status', async (): Promise<MapStatusResult> => {
    const { session } = state;
    if (!session) return null;
    return status(session.mapDir);
  });
}

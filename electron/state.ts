// What the open map is, and what every IPC handler shares of it.
//
// The main process holds one authoritative model and hands the renderer views
// of it. That model, the window it draws in, and the handful of helpers that
// read them live here so a domain module can ask for the session without
// importing another domain to get at it.

import type { BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gameData } from '#electron/paths.ts';
import { findAssetRoot } from '#src/scene.ts';
import type { GeomResolver } from '#src/scene.ts';
import type { Assets } from '#src/assets.ts';
import type { HommMap, MapObject } from '#src/map.ts';
import type { MapWatch } from '#src/watch.ts';
import { TerrainDoc } from '#src/terrain-edit.ts';
import type { History } from '#src/history.ts';
import type { Registry } from '#src/registry.ts';
import { readTree, addRefItem } from '#src/tree.ts';
import type { HistoryState } from '#electron/ipc.ts';

/** The map currently open for editing, with everything derived at load time. */
export interface Session {
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

/** Terrain file backing each floor index. */
export const TERRAIN_FILE = ['GroundTerrain.bin', 'UndergroundTerrain.bin'];

/** The open terrain document for a floor, opened on first use. */
export function terrainDoc(s: Session, floor: number): TerrainDoc {
  const cached = s.terrain.get(floor);
  if (cached) return cached;
  const file = TERRAIN_FILE[floor];
  if (!file) throw new Error(`no terrain file for floor ${floor}`);
  const doc = TerrainDoc.open(join(s.mapDir, file));
  s.terrain.set(floor, doc);
  return doc;
}

/**
 * Everything the handlers share, on one object.
 *
 * Not two `export let`s: an ESM live binding can be read from another module
 * but never assigned, so the moment `map:load` moved out of this file a plain
 * `session` would have been a copy nobody else saw change.
 */
export const state = {
  /** The map open for editing — one at a time, for now. */
  session: null as Session | null,
  /** The editor window, from the moment it is created. */
  win: null as BrowserWindow | null,
};

/** The open map, or the error every editing channel answers with. */
export function need(): Session {
  if (!state.session) throw new Error('no map loaded');
  return state.session;
}

/**
 * The base asset root for a map: the tree above it when the map sits inside one,
 * else the configured game data.
 *
 * A map opened from a `.h5m` is extracted on its own and has no data above it,
 * which is the ordinary case — the archive holds the map, never the models. The
 * smoke test used to insist on the walk alone and so could not load any map the
 * editor itself can.
 */
export function assetRootFor(mapPath: string): string {
  const above = findAssetRoot(mapPath);
  if (above) return above;
  if (existsSync(join(gameData(), 'MapObjects')) || existsSync(join(gameData(), 'bin', 'Geometries'))) return gameData();
  throw new Error('asset root not found (need MapObjects/ or bin/Geometries/ above the map, or set HOMM5_DATA)');
}

/** The object with this id, or a throw naming the id that was not found. */
export function findObject(s: Session, id: string): MapObject {
  const obj = s.map.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`object ${id} not found`);
  return obj;
}

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
export function syncMapTiles(s: Session, layerPaths: string[]): number {
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

/** The undo stack's reach, for a UI that greys out what cannot be done. */
export function historyState(s: Session): HistoryState {
  return {
    canUndo: s.history.canUndo, canRedo: s.history.canRedo,
    undoLabel: s.history.undoLabel, redoLabel: s.history.redoLabel,
  };
}

/** Flush every terrain document that has unsaved brush work. */
export function saveTerrain(s: Session): void {
  for (const doc of s.terrain.values()) if (doc.dirty) doc.save();
}

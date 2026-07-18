// Shared IPC contract between the Electron main process and the renderer.
//
// Every `ipcMain.handle` channel in main.ts has its payload and result typed
// here, and the preload bridge (preload.cts) exposes exactly these shapes on
// `window.editor`. Type-only module: nothing here emits, so both the ESM main
// process and the CommonJS preload can import from it.

import type { Scene, TileInfo } from '../src/scene.ts';
import type { ProjectStatus } from '../src/project.ts';
import type { TypeCounts } from '../src/map.ts';

/** One openable map found under the game-data root (`maps:list`). */
export interface MapListEntry {
  /** Folder name, e.g. '12'. */
  name: string;
  /** Posix-style path relative to <data>/Maps. */
  rel: string;
  /** Absolute path to the map's map.xdb. */
  path: string;
}

/** Result of `maps:list`. */
export interface MapsListResult {
  /** The game-data root the listing was made against. */
  root: string;
  maps: MapListEntry[];
}

/** Per-floor summary carried in MapInfo. */
export interface FloorSummary {
  name: string;
  /** Number of object instances placed on this floor. */
  objects: number;
}

/** Human-facing summary of the loaded map. */
export interface MapInfo {
  /** Name of the folder holding map.xdb. */
  name: string;
  mapPath: string;
  tileX: number;
  tileY: number;
  counts: TypeCounts;
  floors: FloorSummary[];
  /** Total instances placed across all floors. */
  placed: number;
  /** Objects the scene builder could not resolve a mesh for. */
  skipped: number;
}

/** Result of `map:load`. */
export interface MapLoadResult {
  scene: Scene;
  info: MapInfo;
  status: ProjectStatus;
}

/** Payload of `object:move`. */
export interface MoveObjectPayload {
  id: string;
  x: number;
  y: number;
}

/** Result of `object:move`. */
export interface MoveObjectResult {
  ok: true;
}

/** Result of `map:save`. */
export interface MapSaveResult {
  ok: true;
  status: ProjectStatus;
}

/** `map:pack` when the user dismissed the save dialog. */
export interface MapPackCanceled {
  canceled: true;
}

/** `map:pack` when an archive was written. */
export interface MapPackOk {
  ok: true;
  /** Path the .h5m was written to. */
  output: string;
  /** Number of files in the archive. */
  entries: number;
  /** Archive size in bytes. */
  bytes: number;
  status: ProjectStatus;
}

/** Result of `map:pack`. */
export type MapPackResult = MapPackCanceled | MapPackOk;

/** Result of `terrain:tiles`. */
export interface TerrainTilesResult {
  tiles: TileInfo[];
  /** Tile paths this map's terrain already has a layer for. */
  inMap: string[];
}

/**
 * Pushed on `map:external-change` when the open map folder is edited by
 * something else — typically the original Nival editor running alongside us.
 */
export interface ExternalChange {
  /** The map this is about; pass it back to loadMap() to take the new version. */
  mapPath: string;
  /** Posix paths relative to the map folder. */
  changed: string[];
  added: string[];
  removed: string[];
  /** map.xdb changed — object placement and map properties are stale. */
  map: boolean;
  /** GroundTerrain.bin changed — heights, tiles or flags are stale. */
  terrain: boolean;
}

/** Result of `map:status`: null when no map is loaded. */
export type MapStatusResult = ProjectStatus | null;

/** Result of `dialog:openMap`: the chosen path, or null when canceled. */
export type OpenMapDialogResult = string | null;

/** The surface preload puts on `window.editor`. */
export interface EditorApi {
  listMaps(): Promise<MapsListResult>;
  openMapDialog(): Promise<OpenMapDialogResult>;
  loadMap(path: string): Promise<MapLoadResult>;
  moveObject(id: string, x: number, y: number): Promise<MoveObjectResult>;
  save(): Promise<MapSaveResult>;
  pack(): Promise<MapPackResult>;
  status(): Promise<MapStatusResult>;
  listTiles(): Promise<TerrainTilesResult>;
  /**
   * Subscribe to external edits of the open map folder. Fires once per settled
   * burst of writes; our own saves never fire it.
   */
  onExternalChange(cb: (c: ExternalChange) => void): void;
}

// Shared IPC contract between the Electron main process and the renderer.
//
// Every `ipcMain.handle` channel in main.ts has its payload and result typed
// here, and the preload bridge (preload.cts) exposes exactly these shapes on
// `window.editor`. Type-only module: nothing here emits, so both the ESM main
// process and the CommonJS preload can import from it.

import type { Scene, SplatData, TileInfo, Instance, GeomData } from '../src/scene.ts';
import type { ProjectStatus } from '../src/project.ts';
import type { TypeCounts, ObjectProp } from '../src/map.ts';

export type { ObjectProp } from '../src/map.ts';
import type { PlaceableObject } from '../src/objects.ts';
export type { PlaceableObject } from '../src/objects.ts';

/** One openable map found under the game-data root (`maps:list`). */
export interface MapListEntry {
  /** Folder name, e.g. '12'. */
  name: string;
  /** Posix-style path relative to <data>/Maps. */
  rel: string;
  /** Absolute path to the map's map.xdb, or to the .h5m when `archive`. */
  path: string;
  /** A packed .h5m rather than an unpacked folder: opening it unpacks first. */
  archive?: boolean;
}

/** Payload of `map:open-archive` — the .h5m (or .h5c/.h5u) to unpack. */
export interface OpenArchivePayload { path: string }

/** Result of `map:open-archive` — the unpacked project, ready for `map:load`. */
export interface OpenArchiveResult {
  mapPath: string;
  /** Folder the archive was unpacked into. */
  mapDir: string;
  /** Number of files taken out of the archive. */
  files: number;
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

/**
 * Payload of `map:new` — the original's Create New Map dialog.
 *
 * There is no map-type field in map.xdb (a shipped multiplayer map carries no
 * marker a single-player one lacks) — the type is expressed as the folder the
 * map lives in, which is also its path inside the packed .h5m: the original
 * editor's own blanks come out under Maps/SingleMissions/<name>, so that is
 * where a single scenario goes and Maps/Multiplayer/<name> where an arena does.
 */
export interface NewMapPayload {
  name: string;
  /** TileX = TileY: one of the New Map sizes (72, 96, 136, 176, 216, 256, 320). */
  tiles: number;
  twoLevel: boolean;
  multiplayer: boolean;
}

/** Result of `map:new` — the map.xdb just written, ready to pass to loadMap. */
export interface NewMapResult {
  mapPath: string;
  /** Folder the project was created in. */
  mapDir: string;
}

/** Result of `map:load`. */
export interface MapLoadResult {
  scene: Scene;
  info: MapInfo;
  status: ProjectStatus;
  /**
   * What the undo stack looks like on open.
   *
   * Not always empty: a history saved by a previous run is adopted when the
   * documents still hash to what they hashed when it was written, so a map
   * closed and reopened untouched can still be stepped back through.
   */
  history: HistoryState;
}

/** How far the undo stack can go in each direction, and what is next. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
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

/** Payload of `object:rotate`. */
export interface RotateObjectPayload {
  id: string;
  /** Absolute angle in radians, as the format stores it — not a delta. */
  r: number;
}

/** Payload of `object:remove`. */
export interface RemoveObjectPayload {
  id: string;
}

/** Result of `object:rotate`, `object:remove` and `object:set-prop`. */
export interface ObjectEditResult {
  ok: true;
}

/** Result of `object:props`: the selected object's simple fields. */
export interface ObjectPropsResult {
  type: string;
  props: ObjectProp[];
}

/** Payload of `object:set-prop`. */
export interface SetPropPayload {
  id: string;
  /** Element name of the field, as it appears in the file. */
  name: string;
  value: string;
}

/**
 * Result of `map:props`: the map root's simple fields, plus the visible name and
 * description resolved from the sibling text files they point at (read-only for
 * now — editing those files is a separate document, not the in-memory map.xdb).
 */
export interface MapPropsResult {
  props: ObjectProp[];
  /** Contents of the file `NameFileRef` points at, or '' if absent. */
  name: string;
  /** Contents of the file `DescriptionFileRef` points at, or '' if absent. */
  description: string;
}

/** Payload of `map:set-prop`. */
export interface SetMapPropPayload {
  /** Element name of the map-root field, as it appears in the file. */
  name: string;
  value: string;
}

/** Payload of `registry:roster` — which roster to fetch. */
export interface RosterPayload {
  /** A RegistryName from src/schema.ts (spells, artifacts, creatures, …). */
  name: string;
}

/** One roster entry (mirrors src/registry.ts RosterEntry). */
export interface RosterEntryDTO {
  id: string;
  name?: string;
  nameRef?: string;
  group?: string;
}

/** Result of `registry:roster`. */
export interface RosterResult {
  entries: RosterEntryDTO[];
}

/** Payload of `objects:of-class` — every object of an engine class, for the
 *  type-constrained browse picker (AdvMapHeroShared, AdvMapBirds, …). */
export interface OfClassPayload { className: string; }

/** Payload of `map:new-entity` — create a new object of `className` named
 *  `name` in the map folder, and return the href the ref should store. */
export interface NewEntityPayload { className: string; name: string; }
/** Result of `map:new-entity` — the href of the file just created. */
export interface NewEntityResult { href: string; }

/** Payload of `entity:read` — the referenced entity document's href. */
export interface EntityReadPayload { href: string; }
/** Result of `entity:read` — the document as a tree, its class, and whether it
 *  can be edited (map-local files are; the shipped library is read-only). */
export interface EntityReadResult { className: string; editable: boolean; tree: unknown; }
/** Payload of `entity:set-path` — set one field on a map-local entity document. */
export interface EntitySetPathPayload { href: string; path: TreePath; value: string; }

/** Result of `map:pick-text` — the basename href of the chosen (or copied-in)
 *  text file, or '' if the OS picker was cancelled. */
export interface PickTextResult { href: string; }
/** Payload of `entity:copy-to-map` — the library entity href to copy. */
export interface EntityCopyPayload { href: string; }
/** Result of `entity:copy-to-map` — the href of the editable map-local copy. */
export interface EntityCopyResult { href: string; }

/** Payload of `map:suggest-name` — the class to name a new instance of. */
export interface SuggestNamePayload { className: string; }
/** Result of `map:suggest-name` — a free `Class_00N` handle for a new object. */
export interface SuggestNameResult { name: string; }

/** Payload of `map:names` — which kind of in-map name to gather. */
export interface NamesPayload { kind: string; }
/** Result of `map:names` — names defined in the map, for x-nameRef hints. */
export interface NamesResult { names: string[]; }

/** A step into the map tree: a field name or a list index (mirrors src/tree.ts). */
export type TreePath = (string | number)[];

/** Result of `map:tree` — the whole <AdvMapDesc> as nested data. */
export interface MapTreeResult {
  /** Leaf string, list, or keyed object — see src/tree.ts TreeData. */
  tree: unknown;
}

/** Payload of `map:set-path`. */
export interface SetPathPayload { path: TreePath; value: string; }
/** Payload of `map:add-item`. `value` is used for value lists; struct lists build
 *  a default item from the schema and ignore it. */
export interface AddItemPayload { path: TreePath; value?: string; }
/** Payload of `map:remove-item` — the path's last step is the index. */
export interface RemoveItemPayload2 { path: TreePath; }
/** Payload of `map:set-list` — replace a value list's contents (checklists). */
export interface SetListPayload { path: TreePath; values: string[]; }
/** Payload of `map:read-file` — a referenced text file's href. */
export interface ReadFilePayload { href: string; }
/** Result of `map:read-file`. */
export interface ReadFileResult { text: string; }
/** Payload of `map:write-file`. */
export interface WriteFilePayload { href: string; text: string; }

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

/** Payload of `terrain:paint` — one brush stroke's worth of vertices. */
export interface PaintTilePayload {
  /** Floor index: 0 surface, 1 underground. */
  floor: number;
  /** The (AdvMapTile).xdb path to paint with; must be a layer the map already has. */
  tile: string;
  /** Vertex indices (y*V + x). */
  verts: number[];
  /** 0..255 opacity, default 255. */
  strength?: number;
}

/**
 * Payload of `terrain:paint-river`.
 *
 * A river brush does three things at once, and they have to land together or
 * the file is inconsistent: paint the tile, mark the half-tile river plane —
 * which is what makes it a river to the game rather than paint — and sink the
 * bed below its banks.
 */
export interface PaintRiverPayload {
  floor: number;
  tile: string;
  /** Vertices of the riverbed itself. */
  verts: number[];
  /** Every vertex whose height changed: the bed plus its feathered rim. */
  heightVerts: number[];
  /** New height per entry of `heightVerts`. */
  heights: number[];
}

/**
 * Payload of `terrain:mask` — the original editor's Masks tab.
 *
 * Blocking is explicit and separate from everything else: water is impassable
 * because of its ground flag, not because it is masked, so this only records
 * decisions a designer makes by hand.
 */
export interface MaskPayload {
  floor: number;
  verts: number[];
  /** true = Erase (walkable), false = Mask (blocked). */
  walkable: boolean;
}

/** Result of `terrain:paint`. */
export interface PaintTileResult {
  ok: true;
}

/**
 * Payload of `terrain:sculpt` — absolute values for the vertices a height
 * stroke moved.
 *
 * Absolute, not a delta: the falloff maths lives in the renderer, so sending
 * the operation would let the two copies compute different answers. Sending the
 * result means they cannot disagree.
 */
export interface SculptPayload {
  floor: number;
  /** Vertex indices (y*V + x). */
  verts: number[];
  /** New height per vertex, parallel to `verts`. */
  heights: number[];
  /** New ground flag per vertex, or null on a terrain with no flag plane. */
  flags: number[] | null;
}

/** Result of `terrain:sculpt`. */
export interface SculptResult {
  ok: true;
}

/** Payload of `terrain:add-layer`. */
export interface AddLayerPayload {
  floor: number;
  /** The (AdvMapTile).xdb path to give this map a layer for. */
  tile: string;
}

/**
 * Result of `terrain:add-layer`. The splat is rebuilt because the shader
 * composites a fixed number of layers: one more means new mask groups and a
 * new material, not a texture the renderer can patch.
 */
export interface AddLayerResult {
  ok: true;
  splat: SplatData | null;
  /** Every tile path this map now has a layer for. */
  inMap: string[];
}

/** Result of `objects:list` — the palette's contents. */
export interface ObjectCatalogResult {
  objects: PlaceableObject[];
  /** Group names in the order the original's Filter dropdown shows them. */
  groups: { name: string; separator: boolean }[];
  /** False when no Editor folder was found: no filters and no icons. */
  hasEditor: boolean;
}

/** Payload of `objects:icon`. */
export interface IconPayload {
  /** Link-file path as it appears in the catalogue. */
  path: string;
}

/** Result of `objects:icon`: a PNG data URI, or null when there is no picture. */
export type IconResult = string | null;

/** Payload of `object:add`. */
export interface AddObjectPayload {
  type: string;
  shared: string;
  x: number;
  y: number;
  floor: number;
  r?: number;
}

/** Result of `object:add`. */
export interface AddObjectResult {
  /** The placed object, ready for the renderer's instance list. */
  instance: Instance;
  /**
   * A newly decoded mesh and where it landed, when this object's model had not
   * been seen before. Null when it reuses one the scene already has.
   */
  geom: { index: number; data: GeomData } | null;
  /**
   * False when the map had no object of this type to copy, so only the shared
   * fields were written. The object is valid XML and round-trips, but its
   * type-specific fields are missing.
   */
  complete: boolean;
}

/** Result of `map:status`: null when no map is loaded. */
export type MapStatusResult = ProjectStatus | null;

/** Result of `dialog:openMap`: the chosen path, or null when canceled. */
export type OpenMapDialogResult = string | null;

/**
 * Result of `history:undo` / `history:redo`.
 *
 * Carries only what the renderer cannot work out for itself. `instances` is
 * present when the map document moved — the whole list, because the map was
 * re-parsed and rebuilding the batches is cheaper and safer than reconciling
 * ids one at a time. `terrain` is present per floor whose bytes moved, and
 * includes a rebuilt splat since a repainted mask or a new layer changes it.
 */
export interface UndoResult {
  ok: true;
  /** False when there was nothing left to undo or redo. */
  applied: boolean;
  /** What the step was, for the status line. Null when nothing was applied. */
  label: string | null;
  instances: Instance[][] | null;
  terrain: {
    floor: number;
    heights: number[];
    flags: number[] | null;
    splat: SplatData | null;
  }[];
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

/** The surface preload puts on `window.editor`. */
export interface EditorApi {
  listMaps(): Promise<MapsListResult>;
  openMapDialog(): Promise<OpenMapDialogResult>;
  newMap(p: NewMapPayload): Promise<NewMapResult>;
  openArchive(path: string): Promise<OpenArchiveResult>;
  loadMap(path: string): Promise<MapLoadResult>;
  moveObject(id: string, x: number, y: number): Promise<MoveObjectResult>;
  rotateObject(id: string, r: number): Promise<ObjectEditResult>;
  removeObject(id: string): Promise<ObjectEditResult>;
  objectProps(id: string): Promise<ObjectPropsResult>;
  setObjectProp(p: SetPropPayload): Promise<ObjectEditResult>;
  mapProps(): Promise<MapPropsResult>;
  setMapProp(p: SetMapPropPayload): Promise<ObjectEditResult>;
  roster(name: string): Promise<RosterResult>;
  objectsOfClass(className: string): Promise<RosterResult>;
  newEntity(p: NewEntityPayload): Promise<NewEntityResult>;
  readEntity(href: string): Promise<EntityReadResult>;
  setEntityPath(p: EntitySetPathPayload): Promise<ObjectEditResult>;
  pickText(): Promise<PickTextResult>;
  copyEntityToMap(href: string): Promise<EntityCopyResult>;
  suggestName(className: string): Promise<SuggestNameResult>;
  names(kind: string): Promise<NamesResult>;
  mapTree(): Promise<MapTreeResult>;
  setMapPath(p: SetPathPayload): Promise<ObjectEditResult>;
  addMapItem(p: AddItemPayload): Promise<ObjectEditResult>;
  removeMapItem(p: RemoveItemPayload2): Promise<ObjectEditResult>;
  setMapList(p: SetListPayload): Promise<ObjectEditResult>;
  readFile(href: string): Promise<ReadFileResult>;
  writeFile(p: WriteFilePayload): Promise<ObjectEditResult>;
  listObjects(): Promise<ObjectCatalogResult>;
  objectIcon(path: string): Promise<IconResult>;
  addObject(p: AddObjectPayload): Promise<AddObjectResult>;
  save(): Promise<MapSaveResult>;
  pack(): Promise<MapPackResult>;
  status(): Promise<MapStatusResult>;
  listTiles(): Promise<TerrainTilesResult>;
  paintTile(p: PaintTilePayload): Promise<PaintTileResult>;
  paintRiver(p: PaintRiverPayload): Promise<PaintTileResult>;
  setMask(p: MaskPayload): Promise<PaintTileResult>;
  sculpt(p: SculptPayload): Promise<SculptResult>;
  addLayer(p: AddLayerPayload): Promise<AddLayerResult>;
  undo(): Promise<UndoResult>;
  redo(): Promise<UndoResult>;
  /**
   * Subscribe to external edits of the open map folder. Fires once per settled
   * burst of writes; our own saves never fire it.
   */
  onExternalChange(cb: (c: ExternalChange) => void): void;
}

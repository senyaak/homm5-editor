// Shared IPC contract between the Electron main process and the renderer.
//
// Every `ipcMain.handle` channel in main.ts has its payload and result typed
// here, and the preload bridge (preload.cts) exposes exactly these shapes on
// `window.editor`. Type-only module: nothing here emits, so both the ESM main
// process and the CommonJS preload can import from it.

import type { Scene, SplatData, TileInfo, Instance, GeomData } from '../src/scene.ts';
import type { ProjectStatus } from '../src/project.ts';
import type { TypeCounts, ObjectProp } from '../src/map.ts';
import type { CreatureStats } from '../src/creatures.ts';
import type { PaletteEntry, RecolorOps } from '../src/recolor.ts';

export type { ObjectProp } from '../src/map.ts';
export type { CreatureStats } from '../src/creatures.ts';
export type { PaletteEntry, RecolorOps } from '../src/recolor.ts';
import type { PlaceableObject } from '../src/objects.ts';
export type { PlaceableObject } from '../src/objects.ts';

/**
 * One map on offer (`maps:list`) — ours out of `H5E/`, or the game's own out of
 * its `.pak`. Every one is inside an archive: opening it unpacks first.
 */
export interface MapListEntry {
  /** The map's name, without the extension. */
  name: string;
  /** What is shown beside the name: the file name, or its path in the archive. */
  rel: string;
  /** The archive holding it. */
  path: string;
  /** The folder inside the archive, for an archive holding many maps. */
  inner?: string;
  /** The game's own map, which is read and never written. */
  stock?: boolean;
}

/**
 * Payload of `map:open-archive` — the archive to unpack, and what to take out.
 *
 * `inner` is where the map sits inside it, and every map has one, ours included.
 * `stock` is the thing that changes what happens: the game's own archives hold
 * many maps, are gathered from as a set, and are never written to.
 */
export interface OpenArchivePayload { path: string; inner?: string; stock?: boolean }

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
  /** The install the listing was made against. */
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
  /**
   * Tiles added to the map's `<tiles>` list on open, because its terrain paints
   * with them and the list did not name them.
   *
   * Non-zero means the document changed while merely opening it, which the
   * renderer has to show as unsaved work — otherwise the fix is silently lost.
   */
  tilesNamed: number;
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
  /** The `.h5m` it was packed into — the map, as the game will read it. */
  archive: string;
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
  /**
   * Which idle-animation mode this scene was built for.
   *
   * Sent with the scene rather than read separately, because it describes THIS
   * payload: `off` means the geoms carry no bones at all, so the renderer must
   * not go looking for them, and a setting changed mid-session does not apply
   * until the next open.
   */
  idleAnimation: 'off' | 'visible' | 'all';
}

/** How far the undo stack can go in each direction, and what is next. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

/** Payload of `map:fx`. */
export interface FxPayload {
  /** bin/effects uids, as the scene's FxInstancePayload names them. */
  uids: string[];
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

/** Payload of `spec:values` — the object type whose enum fields to describe. */
export interface SpecValuesPayload {
  /** Element name, e.g. 'AdvMapMonster'. */
  type: string;
}

/**
 * Result of `spec:values`: for each field of the type whose values the game's
 * own type spec closes, the full legal set — see docs/TYPE_SPEC.md. Empty when
 * there is no spec to read (no game data), which leaves the panel's text boxes
 * as they were.
 */
export interface SpecValuesResult {
  /** Field name -> every value the game accepts there, in declaration order. */
  values: Record<string, string[]>;
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
  /** The entry's place in the source table — the order stored lists keep. */
  order?: number;
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

/**
 * An object's whole content as a tree — the same shape `map:tree` returns, for
 * the same renderer. Structures a flat property list cannot express (a hero's
 * army, a capture trigger, a monster's reward resources) are only reachable
 * this way, and they are declared once in the object schema's `$defs`.
 */
export interface ObjectTreePayload { id: string }
export interface ObjectTreeResult { type: string; tree: unknown }
/** Payload of `object:set-path` — a path INSIDE one object. */
export interface ObjectSetPathPayload { id: string; path: TreePath; value: string }
/** Payload of `object:add-item` / `object:remove-item`. */
export interface ObjectAddItemPayload { id: string; path: TreePath; value?: string }
export interface ObjectRemoveItemPayload { id: string; path: TreePath }

/** Payload of `map:set-path`. */
export interface SetPathPayload { path: TreePath; value: string; }
/** Payload of `map:add-item`. `value` is used for value lists; struct lists build
 *  a default item from the schema and ignore it. */
export interface AddItemPayload { path: TreePath; value?: string; }
/** Payload of `map:remove-item` — the path's last step is the index. */
export interface RemoveItemPayload2 { path: TreePath; }
/** Payload of `map:set-list` — replace a value list's contents (checklists). */
export interface SetListPayload { path: TreePath; values: string[]; }
/** One engine function the map script may call (src/script-api.json). */
export interface ApiFn { name: string; params: string; group: string; summary?: string }

/**
 * Result of `script:context` — everything the script editor completes from.
 *
 * Gathered per map rather than per keystroke: the API list is fixed, the game's
 * scripts do not change while the editor runs, and the map's own names change
 * only when the map does.
 */
export interface ScriptContextResult {
  api: ApiFn[];
  /** Functions the game's shipped Lua declares. */
  helpers: string[];
  /** ALL_CAPS constants: the shipped scripts' own, plus the ID rosters. */
  constants: string[];
  /** Names defined in this map, by kind. */
  names: { object: string[]; region: string[]; objective: string[] };
}

/** Payload of `map:files` — which extensions to list, e.g. ['.lua', '.txt']. */
export interface MapFilesPayload { exts: string[] }
/** Result of `map:files` — posix-style paths relative to the map folder. */
export interface MapFilesResult { files: string[] }

/** Payload of `map:read-file` — a referenced text file's href. */
export interface ReadFilePayload { href: string; }
/**
 * Result of `map:read-file`.
 *
 * `exists` is separate from an empty `text`, because the two mean different
 * things to the one caller that has to tell them apart: "New text file" adopts a
 * file that is already there and creates one that is not, and a map's name.txt
 * can legitimately be empty.
 */
export interface ReadFileResult { text: string; exists: boolean }
/** Payload of `map:write-file`. */
export interface WriteFilePayload { href: string; text: string; }

/** Payload of `script:new` — the base name a script and its wrapper take. */
export interface ScriptNewPayload { base: string }
/**
 * Result of `script:new`.
 *
 * A map script is TWO files: the `.lua` the engine runs, and a `.xdb` wrapper
 * that names it and is what the map's `MapScript` (and a hero's CombatScript)
 * actually reference. `href` is the wrapper's xpointer — what goes in the ref —
 * and `lua` is the file to open for editing.
 */
export interface ScriptNewResult { href: string; lua: string }
/** Payload of `script:resolve` — a wrapper's ref (`foo.xdb#xpointer(/Script)`). */
export interface ScriptResolvePayload { href: string }
/** Result of `script:resolve` — the `.lua` the wrapper names, relative to the map. */
export interface ScriptResolveResult { lua: string }

/**
 * Payload of `spec:new` — create a TownSpecialization file inside the map.
 *
 * A specialization is a named town bonus; the shipped ones live in the game's
 * `GameMechanics/`, but a map can carry its OWN, packed beside `map.xdb` and
 * referenced by a relative href — the same map-local pattern as scripts and
 * texts. `base` is the file name (no path/extension), `bonus` a TOWN_BONUS_* id,
 * `townType` a TOWN_* faction, `name` an optional display name (written to a
 * sibling text file when given).
 */
export interface SpecNewPayload { base: string; bonus: string; townType: string; name?: string }
/** Result of `spec:new` — the ref to store, and the file written, both map-relative. */
export interface SpecNewResult { href: string; file: string }

/**
 * The project's localization state.
 *
 * `enabled` is false until localization is turned on for the map. `base` is the
 * language the original texts are in (the reference); `languages` is every
 * language the project carries, base first — each kept as tagged `.txt` files
 * side by side, exported one at a time. Editor-only: the game never sees this.
 */
export interface LocResult { enabled: boolean; base: string; languages: string[] }
/** Payload of `loc:enable` — the language the existing texts are declared to be in. */
export interface LocEnablePayload { base: string }
/** Payload of `loc:add-language` / `loc:remove-language`. */
export interface LocLangPayload { lang: string }
/**
 * Payload of `loc:export` — the language to bake into a single-language build.
 *
 * `output` skips the save dialog (a test drives it, or a caller already knows the
 * path); without it the main process asks where to write the `.h5m`.
 */
export interface LocExportPayload { lang: string; output?: string }

/** Result of `map:save`. */
export interface MapSaveResult {
  ok: true;
  status: ProjectStatus;
  /**
   * The archive the work went back into, when the map came from one. Absent for
   * a loose map folder, where saving is just the files.
   */
  output?: string;
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

/** Result of `app:launch-game` — the executable that was started. */
export interface LaunchGameResult {
  ok: true;
  /** Absolute path of the copy that was launched, for the status line. */
  exe: string;
}

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
  /**
   * false = write only this layer, leaving the others at those vertices alone.
   * Default true: a brush stroke replaces what was there.
   */
  exclusive?: boolean;
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
 * Payload of `terrain:river-cells` — the river plane on its own.
 *
 * The river brush above bundles tile, plane and bed because drawing a river by
 * hand wants all three. This one writes the plane and nothing else, at its own
 * grid and its own strength: the plane is (2V-1)² and graded, so most of a real
 * river neither lands on a vertex nor is fully opaque, and a surface already at
 * its final height must not be dug.
 */
export interface RiverCellsPayload {
  floor: number;
  /** Indices into the (2V-1)² river plane. */
  cells: number[];
  /** 0..255, where 0 erases. */
  value: number;
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

// --- units mod ---------------------------------------------------------------
//
// Creature mods are GAME-GLOBAL, not part of any map: a .h5u in UserMODs plus a
// patched executable ceiling (src/creature-mod.ts). So these channels need no
// session — the dialog works with no map open, exactly like the game does.

/** One creature of an installed mod, as `mods:list` reports it. */
export interface ModCreatureDTO {
  id: string;
  number: number;
  name: string;
  tier: number;
  gold: number;
  /**
   * And the rest of it, because the form fills itself from this list.
   *
   * A summary meant that opening a creature to change its price came back with
   * its description, its abilities and its art blank, and saving wrote that
   * back — the artifact side learned this first, and the hero side after it.
   */
  file: string;
  description: string;
  /** Only when the author overrode the derived line. */
  abilitiesText?: string;
  stats: CreatureStats;
  /** Where its art resolved to, slot by slot. */
  from?: Record<string, string>;
}

/** One artifact of an installed mod, as `mods:list` reports it. */
/**
 * An installed artifact, in full.
 *
 * Everything the form can edit, because the form fills itself from this: sent
 * short, "Save & install" wrote back blanks for whatever was missing, and a
 * changed price cost the artifact its description, its price and its stats.
 */
export interface ModArtifactDTO {
  id: string;
  number: number;
  name: string;
  description: string;
  slot: string;
  rank?: string;
  cost: number;
  aiValue?: number;
  canBeGeneratedToSell?: boolean;
  /** The six the record itself can hold — `{ Attack: 2 }`. */
  stats?: Record<string, number>;
  /** What the extension adds while it is worn — `{ necromancy: 5 }`. */
  effects?: Record<string, number>;
  icon?: string;
  model?: string;
  /** Set when it stands on the map as a flat board of its own icon. */
  board?: { tiles: number };
}

/** One artifact set in a mod. */
export interface ModArtifactSetDTO {
  /** `ARTFSET_EFFECT_…`, ours — appended after the game's eleven. */
  effect: string;
  /** The enum value it holds. */
  number: number;
  name: string;
  description: string;
  /** Member artifact ids, in the order they combine. */
  artifacts: string[];
  /** Its tooltip per number of pieces worn, so editing keeps what was written. */
  perCount?: string[];
  /** What it adds, at a number worn — `{ stat, threshold, amount }`. */
  effects?: { stat: string; threshold: number; amount: number }[];
  /** The Lua it carries, so editing shows what is there rather than a blank. */
  script?: string;
}

/** One installed creature mod. */
export interface ModListEntry {
  /** Absolute path of the .h5u in UserMODs. */
  path: string;
  /** Archive name stem — what `mods:install` targets. */
  stem: string;
  /** The exe ceiling this mod needs. */
  limit: number;
  /** Read back without our manifest — listable, but not extendable. */
  reconstructed: boolean;
  creatures: ModCreatureDTO[];
  artifacts: ModArtifactDTO[];
  /**
   * Its artifact sets. Without these an installed set is invisible from the
   * window, and "nothing happened" looks exactly like "it worked".
   */
  sets: ModArtifactSetDTO[];
  /** Its heroes. They extend nothing, so this list is the only trace of them. */
  heroes: ModHeroDTO[];
}

/**
 * One hero of an installed mod, as `mods:list` reports it.
 *
 * The WHOLE hero, not a summary: the list is where editing starts, and a form
 * filled from a summary would quietly drop every field the summary left out —
 * the specialization's own words, his looks, the spell he starts knowing. The
 * shape is HeroSpec's, mirrored here so the renderer needs no src/ import.
 */
export interface ModHeroDTO {
  id: string;
  name: string;
  biography: string;
  /** The shipped hero his document's shape came from. */
  basedOn: string;
  town: string;
  heroClass: string;
  specialization?: string;
  specializationName?: string;
  specializationDescription?: string;
  specializationIcon?: string;
  primarySkill?: { skill: string; mastery: string };
  stats?: { offence?: number; defence?: number; spellpower?: number; knowledge?: number };
  skills?: { skill: string; mastery: string }[];
  perks?: string[];
  spells?: string[];
  machines?: { ballista?: boolean; firstAidTent?: boolean; ammoCart?: boolean };
  /** False means every tavern of his faction may offer him. */
  scenarioHero?: boolean;
  face?: string;
  faceSmall?: string;
  /** What he wears, slot by slot. */
  art?: Record<string, string>;
}

/** Result of `mods:list`. */
export interface ModsListResult {
  /** The game install the mods live in, or null when none is configured. */
  gameRoot: string | null;
  mods: ModListEntry[];
}

/** The rosters and enums the Units/Artifacts forms are built from. */
export interface ModsFormDataResult {
  /** Every creature that can donate its looks (and preset) to a new one. */
  donors: RosterEntryDTO[];
  /** Every artifact a new one can start from. */
  artifactDonors: RosterEntryDTO[];
  /**
   * The bonuses the native extension knows how to add, for the effect picker.
   *
   * A LIST rather than a field per stat in the form: this grows by reverse
   * engineering, one entry per place in the executable where we have found
   * where to append our term, and an artifact uses one or two of them.
   */
  effectStats: string[];
  /**
   * The six an artifact record can hold, offered in the same list as the
   * bonuses above — the form does not care which side of the line one is on.
   */
  heroStats: string[];
  /** Every ABILITY_… the engine's type registry names. */
  abilities: string[];
  /**
   * The same, each with the name a player sees.
   *
   * From `CombatAbilities.xdb`, which pairs an id with the text the game
   * prints. It is what lets the form offer "Стрелок" instead of ABILITY_SHOOTER
   * — and what the hire dialog's line is built from, instead of being typed in
   * beside the picker and drifting from it.
   */
  abilityNames: RosterEntryDTO[];
  /** The TOWN_… races, for a creature's home town. */
  towns: RosterEntryDTO[];
  /**
   * Every shipped hero, as donors for a new one.
   *
   * They come with this payload rather than from `registry:roster`, which needs
   * a map open — and a hero is authored with no map in sight, exactly like a
   * creature or an artifact.
   */
  heroDonors: RosterEntryDTO[];
  /** Every skill and perk (one table holds both), for a hero's starting kit. */
  skills: RosterEntryDTO[];
  /** Every spell, for the one a hero starts knowing. */
  spells: RosterEntryDTO[];
  /** The enums `AdvMapHeroShared` closes: TownType, Class, Specialization. */
  heroEnums: Record<string, string[]>;
  /**
   * Per art slot, every href the shipped heroes wear there.
   *
   * The universe of the Appearance dropdowns. Gathered from the heroes rather
   * than from the data tree: 28 models and 8 traces are a choice, while
   * `Textures/` is a haystack.
   */
  heroArt: Record<string, string[]>;
}

/** Payload of `mods:preset` / `mods:artifact-preset` — which donor to read. */
export interface ModsPresetPayload { donor: string }

/** Result of `mods:preset` (mirrors src/registry.ts CreaturePreset). */
export interface CreaturePresetDTO {
  stats: CreatureStats;
  name: string;
  description: string;
  abilitiesText: string;
  visualSource: string;
  monsterSource: string;
  art: Partial<Record<'character' | 'model' | 'animSet' | 'icon', string>>;
}

/** Result of `mods:artifact-preset` (mirrors src/registry.ts ArtifactPreset). */
export interface ArtifactPresetDTO {
  slot: string;
  rank: string;
  cost: number;
  aiValue: number;
  canBeGeneratedToSell: boolean;
  stats: Record<string, number>;
  icon: string;
  model: string;
  name: string;
  description: string;
}

/** Payload of `mods:install` — one creature to add to OUR mod. */
export interface ModsInstallPayload {
  /** `CREATURE_…` — the id maps and scripts will use. */
  id: string;
  /** File stem of everything generated for the creature. */
  file: string;
  name: string;
  description: string;
  /**
   * The ability line the hire dialog prints, in words.
   *
   * Optional, and normally absent: the line is BUILT from the creature's
   * abilities when the mod is built, so it cannot say something the creature
   * cannot do. Set it only to override those words with your own.
   */
  abilitiesText?: string;
  /** Donor creature id — its visual and its map stack are the starting point. */
  donor: string;
  stats: Partial<CreatureStats>;
  /** Art overrides per slot; anything omitted keeps the donor's file. */
  art?: Partial<Record<'character' | 'model' | 'animSet' | 'icon', string>>;
}

/** Payload of `mods:install-artifact` — one artifact to add to OUR mod. */
export interface ModsInstallArtifactPayload {
  /** `ARTIFACT_…` — the id maps, saves and scripts store. */
  id: string;
  /** File stem of everything generated for it. */
  file: string;
  name: string;
  description: string;
  slot: string;
  rank: string;
  cost: number;
  aiValue: number;
  canBeGeneratedToSell: boolean;
  /** Attack / Defence / Knowledge / SpellPower / Morale / Luck. */
  stats: Record<string, number>;
  /**
   * What it does beyond those six — percentage points, per stat the native
   * extension knows. Without the extension installed these do nothing, which
   * the dialog says.
   */
  effects?: Record<string, number>;
  /** href of the 64x64 icon (usually the donor's). */
  icon: string;
  /** href of the map model; empty means a flat board of the icon. */
  model?: string;
  /** Board width in tiles, when there is no model. */
  boardTiles?: number;
}

/** Result of `mods:install-artifact`. */
export interface ModsInstallArtifactResult {
  archive: string;
  /** The artifact ceiling the executable was set to. */
  limit: number;
  /** What happened to the executable, in words. */
  exe: string;
}

/**
 * Payload of `mods:install-hero` — one hero to add to OUR mod.
 *
 * The cheapest install there is: no id, no number, no ceiling and no file of
 * the game's touched. What a hero costs instead is a DONOR — the shipped hero
 * whose model, animations and arena character he wears, since a character
 * without art cannot stand on a map. See src/heroes.ts.
 */
export interface ModsInstallHeroPayload {
  /**
   * His unique identifier: the `<InternalName>` a campaign and a script name
   * him by, and the stem of every file made for him. Refused if any hero — the
   * game's own included — already answers to it.
   */
  id: string;
  name: string;
  biography: string;
  /**
   * The shipped hero the form was seeded from, data-root-relative.
   *
   * Its job is the document's SHAPE and the seven fields identical in all 118
   * shipped heroes; everything a person chooses arrives in the fields below,
   * `art` included.
   */
  basedOn: string;
  /** What he looks like — hrefs, each optional. Omitted, `basedOn` decides. */
  art?: Record<string, string>;
  /** `TOWN_…` — whose tavern offers him. */
  town: string;
  /** `HERO_CLASS_…` — one per faction. */
  heroClass: string;
  /** `HERO_SPEC_…`. Any faction's: what it does is keyed to the value, not the race. */
  specialization?: string;
  /** Its own words, when the specialization is borrowed from another faction. */
  specializationName?: string;
  specializationDescription?: string;
  specializationIcon?: string;
  /** The racial slot: skill and mastery. It need not be the faction's racial skill. */
  primarySkill?: { skill: string; mastery: string };
  /** Offence / Defence / Spellpower / Knowledge. Omitted, the donor's. */
  stats?: Record<string, number>;
  /** Starting secondary skills, each a skill at a mastery. */
  skills?: { skill: string; mastery: string }[];
  perks?: string[];
  spells?: string[];
  machines?: { ballista?: boolean; firstAidTent?: boolean; ammoCart?: boolean };
  /** True keeps him out of every tavern — placed by hand or by script only. */
  scenarioHero?: boolean;
  /** href of a 128x128 portrait, and of the 64x64. Omitted, the preset's face. */
  face?: string;
  faceSmall?: string;
  /** Files of the author's own: href inside the mod → where the file is now. */
  ownFiles?: Record<string, string>;
}

/** Result of `mods:install-hero`. */
export interface ModsInstallHeroResult {
  archive: string;
  /** The href a map's roster, a pool or a placed hero points at to reach him. */
  href: string;
}

/**
 * Payload of `mods:install-set` — one artifact set to add to OUR mod.
 *
 * A set costs the executable nothing: no table is indexed by it and no ceiling
 * counts it. It is two data edits, and what it buys is that the game names the
 * set and counts the pieces a hero is wearing. The BONUS rides in `effects`,
 * which is not data of the game's at all — it goes to the file the native
 * extension reads, and without the extension the set is its texts.
 */
export interface ModsInstallSetPayload {
  /** `ARTFSET_EFFECT_…` — ours. A shipped one is refused. */
  effect: string;
  /** Member artifact ids, shipped or the mod's own. Two or more. */
  artifacts: string[];
  /** File stem of the set's texts. */
  file: string;
  name: string;
  description: string;
  /** One per member, indexed from ONE piece worn. The first is normally blank. */
  perCount?: string[];
  /**
   * What it GIVES, at a number of pieces worn — `{ stat, threshold, amount }`.
   * The threshold is ours: the extension counts the worn members itself, so it
   * is not one of the engine's compiled 2/3/4.
   */
  effects?: { stat: string; threshold: number; amount: number }[];
  /** Lua the set runs on an event — see src/artifact-scripts.ts. */
  script?: string;
}

/** Payload of `mods:remove-artifact` / `mods:remove-set` — which one to drop. */
export interface ModsRemovePayload { id: string }

/** Result of `mods:artifact-uses` — one readable line per map that names it. */
export interface ModsUsesResult { uses: string[] }

/** Result of a removal: the mod as it is now, rebuilt and reinstalled. */
export interface ModsRemoveResult { archive: string; removed: string }

/** Whether the native extension is in place, and what it would take. */
export interface ExtensionStatus {
  present: boolean;
  imported: boolean;
  installed: boolean;
  size?: number;
  /** Set when the editor has no built DLL to install. */
  unbuilt?: boolean;
}

/** Result of `mods:install-set`. */
export interface ModsInstallSetResult {
  archive: string;
  /** The enum value the set was given. */
  number: number;
}

/** Payload of `mods:textures` — whose textures to show. */
export interface ModsTexturesPayload { creature: string }

/** One texture of a mod creature, ready for a preview canvas. */
export interface ModTextureDTO {
  /** Path inside the archive — what `mods:recolor` rewrites. */
  path: string;
  width: number;
  height: number;
  /** The decoded pixels as a PNG data URI. */
  png: string;
}

/** Result of `mods:textures`. */
export interface ModsTexturesResult {
  textures: ModTextureDTO[];
  /** The dominant colours across all of them — the remap's swatches. */
  palette: PaletteEntry[];
}

/** Payload of `mods:recolor` — recolour every texture of one mod creature. */
export interface ModsRecolorPayload {
  creature: string;
  ops: RecolorOps;
}

/** Result of `mods:recolor`. */
export interface ModsRecolorResult {
  archive: string;
  /** How many textures were rewritten. */
  textures: number;
}

/** Result of `mods:install`. */
export interface ModsInstallResult {
  /** Where the archive landed. */
  archive: string;
  /** The ceiling the executable was set to. */
  limit: number;
  /** What happened to the executable, in words. */
  exe: string;
  /** Art files copied for the new creature. */
  art: number;
}

/** The surface preload puts on `window.editor`. */
export interface EditorApi {
  listMaps(): Promise<MapsListResult>;
  openMapDialog(): Promise<OpenMapDialogResult>;
  newMap(p: NewMapPayload): Promise<NewMapResult>;
  /** `stock` takes ONE map out of the game's own archives, which hold many. */
  openArchive(path: string, inner?: string, stock?: boolean): Promise<OpenArchiveResult>;
  loadMap(path: string): Promise<MapLoadResult>;
  moveObject(id: string, x: number, y: number): Promise<MoveObjectResult>;
  rotateObject(id: string, r: number): Promise<ObjectEditResult>;
  removeObject(id: string): Promise<ObjectEditResult>;
  objectProps(id: string): Promise<ObjectPropsResult>;
  specValues(type: string): Promise<SpecValuesResult>;
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
  objectTree(p: ObjectTreePayload): Promise<ObjectTreeResult>;
  setObjectPath(p: ObjectSetPathPayload): Promise<ObjectEditResult>;
  addObjectItem(p: ObjectAddItemPayload): Promise<ObjectEditResult>;
  removeObjectItem(p: ObjectRemoveItemPayload): Promise<ObjectEditResult>;
  setMapPath(p: SetPathPayload): Promise<ObjectEditResult>;
  addMapItem(p: AddItemPayload): Promise<ObjectEditResult>;
  removeMapItem(p: RemoveItemPayload2): Promise<ObjectEditResult>;
  setMapList(p: SetListPayload): Promise<ObjectEditResult>;
  readFile(href: string): Promise<ReadFileResult>;
  scriptContext(): Promise<ScriptContextResult>;
  mapFiles(p: MapFilesPayload): Promise<MapFilesResult>;
  writeFile(p: WriteFilePayload): Promise<ObjectEditResult>;
  newScript(p: ScriptNewPayload): Promise<ScriptNewResult>;
  newSpecialization(p: SpecNewPayload): Promise<SpecNewResult>;
  resolveScript(p: ScriptResolvePayload): Promise<ScriptResolveResult>;
  locGet(): Promise<LocResult>;
  locEnable(p: LocEnablePayload): Promise<LocResult>;
  locAddLanguage(p: LocLangPayload): Promise<LocResult>;
  locRemoveLanguage(p: LocLangPayload): Promise<LocResult>;
  locExport(p: LocExportPayload): Promise<MapPackResult>;
  listObjects(): Promise<ObjectCatalogResult>;
  objectIcon(path: string): Promise<IconResult>;
  addObject(p: AddObjectPayload): Promise<AddObjectResult>;
  save(): Promise<MapSaveResult>;
  pack(): Promise<MapPackResult>;
  status(): Promise<MapStatusResult>;
  listTiles(): Promise<TerrainTilesResult>;
  paintTile(p: PaintTilePayload): Promise<PaintTileResult>;
  paintRiver(p: PaintRiverPayload): Promise<PaintTileResult>;
  setRiverCells(p: RiverCellsPayload): Promise<PaintTileResult>;
  setMask(p: MaskPayload): Promise<PaintTileResult>;
  sculpt(p: SculptPayload): Promise<SculptResult>;
  addLayer(p: AddLayerPayload): Promise<AddLayerResult>;
  undo(): Promise<UndoResult>;
  redo(): Promise<UndoResult>;
  /** Campaign projects on disk, for the open list. */
  listCampaigns(): Promise<CampaignListResult>;
  /** Create one and return it, ready to edit. */
  newCampaign(name: string): Promise<CampaignDoc>;
  openCampaign(dir: string): Promise<CampaignDoc>;
  /** Write the whole document back; returns it as re-read from disk. */
  saveCampaign(doc: CampaignDoc): Promise<CampaignDoc>;
  packCampaign(dir: string): Promise<CampaignPackResult>;
  /** The heroes a mission on this map can hand on, and whether it can receive. */
  mapHeroes(mapRel: string): Promise<MapHeroesResult>;
  /** Installed creature mods (units), game-global — no map needed. */
  listMods(): Promise<ModsListResult>;
  /** The rosters and enums the Units/Artifacts forms are built from. */
  modFormData(): Promise<ModsFormDataResult>;
  /** A donor creature, read whole — the form's preset. */
  modPreset(donor: string): Promise<CreaturePresetDTO>;
  /** A donor artifact, read whole — the form's preset. */
  modArtifactPreset(donor: string): Promise<ArtifactPresetDTO>;
  /** Add a creature to OUR mod, build it, install it, patch the ceiling. */
  installMod(p: ModsInstallPayload): Promise<ModsInstallResult>;
  /** Change a creature already in the mod. Its id and number do not move. */
  updateMod(p: ModsInstallPayload): Promise<ModsInstallResult>;
  /** Add an artifact to OUR mod, build it, install it, patch the ceiling. */
  installArtifact(p: ModsInstallArtifactPayload): Promise<ModsInstallArtifactResult>;
  /** Add an artifact set to OUR mod, build it, install it. No ceiling moves. */
  installArtifactSet(p: ModsInstallSetPayload): Promise<ModsInstallSetResult>;
  /** Add a hero to OUR mod, build it, install it. Nothing global moves at all. */
  installHero(p: ModsInstallHeroPayload): Promise<ModsInstallHeroResult>;
  /** Change a hero already in the mod. His identifier does not move. */
  updateHero(p: ModsInstallHeroPayload): Promise<ModsInstallHeroResult>;
  /** Take a hero out of the mod. No ceiling moves; his files simply go. */
  removeHero(p: ModsRemovePayload): Promise<ModsRemoveResult>;
  /** Which maps reach this hero — ask BEFORE removing him. */
  heroUses(p: ModsRemovePayload): Promise<ModsUsesResult>;
  /** What one shipped hero wears, slot by slot — the preset seeding the form. */
  heroArtOf(hero: string): Promise<Record<string, string>>;
  /**
   * Pick a file of your own for one appearance slot.
   *
   * Returns where it sits now and the href it will answer to inside the mod;
   * the copying happens when the hero is built, not here, so cancelling the
   * form leaves nothing behind.
   */
  pickHeroFile(p: { id: string; slot: string }): Promise<{ href: string; from: string }>;
  /** Change an artifact already in the mod. Its id and number do not move. */
  updateArtifact(p: ModsInstallArtifactPayload): Promise<ModsInstallArtifactResult>;
  /** Change a set already in the mod. Its effect value does not move. */
  updateArtifactSet(p: ModsInstallSetPayload): Promise<ModsInstallSetResult>;
  /** Which maps name this creature — ask BEFORE removing it. */
  creatureUses(p: ModsRemovePayload): Promise<ModsUsesResult>;
  /** Drop a creature and lower the executable's ceiling with it. */
  removeCreature(p: ModsRemovePayload): Promise<ModsRemoveResult>;
  /** Which maps name this artifact — ask BEFORE removing it. */
  artifactUses(p: ModsRemovePayload): Promise<ModsUsesResult>;
  /** Drop an artifact. Maps that name it stop resolving; see artifactUses. */
  removeArtifact(p: ModsRemovePayload): Promise<ModsRemoveResult>;
  /** Drop an artifact set. */
  removeArtifactSet(p: ModsRemovePayload): Promise<ModsRemoveResult>;
  /** Whether the native extension is installed — effects need it. */
  extensionStatus(): Promise<ExtensionStatus>;
  /** Put the extension in place: the DLL, and the import that loads it. */
  installExtension(): Promise<ExtensionStatus>;
  /** A mod creature's textures, decoded for the Recolor preview. */
  modTextures(creature: string): Promise<ModsTexturesResult>;
  /** Recolour a mod creature's textures and rewrite the archive. */
  recolorMod(p: ModsRecolorPayload): Promise<ModsRecolorResult>;
  /**
   * A human-readable dump of what Chromium decided about this machine's
   * graphics: which GPU features it turned off, and the adapter behind them.
   * Feeds the fatal-error screen, whose commonest cause is a WebGL context the
   * driver would not give — and which of the many reasons for that only this
   * answers.
   */
  gpuReport(): Promise<string>;
  /** Open DevTools on the editor window (the fatal screen's escape hatch). */
  openDevTools(): Promise<void>;
  /**
   * Start the game — our copy, the one that reads `H5E/`.
   *
   * Rejects when the install has not been prepared (no patched executable): the
   * shipped one would start, and would show none of what the editor makes.
   */
  launchGame(): Promise<LaunchGameResult>;
  /** Is this run rendering through SwiftShader? See Settings.softwareRendering. */
  gpuSoftware(): Promise<boolean>;
  /**
   * Remember the rendering mode and restart into it. Never returns — the app is
   * on its way down by the time the call would resolve.
   */
  setGpuSoftware(on: boolean): Promise<void>;
  /** Which idle-animation mode is remembered. See Settings.idleAnimation. */
  idleAnimation(): Promise<'off' | 'visible' | 'all'>;
  /** Remember an idle-animation mode. What the open scene does about it is the renderer's move (see idleSkins). */
  setIdleAnimation(mode: 'off' | 'visible' | 'all'): Promise<Record<string, never>>;
  /**
   * Animation payloads for the open map's models, keyed by the geom indices the
   * scene already uses — what lets a scene built with idles off start moving
   * without being reopened. Only geoms that both animate and line up with what
   * the renderer holds are present.
   */
  idleSkins(): Promise<Record<number, NonNullable<GeomData['skin']>>>;
  /**
   * Baked particle keys for the open map's effects, keyed by bin/effects uid.
   * Typed arrays, shipped binary via structured clone — never part of the
   * scene JSON. Unresolvable uids are simply absent.
   */
  fx(uids: string[]): Promise<Record<string, import('../src/effects.ts').FxTransfer>>;
  /**
   * Subscribe to external edits of the open map folder. Fires once per settled
   * burst of writes; our own saves never fire it.
   */
  onExternalChange(cb: (c: ExternalChange) => void): void;
}

// --- campaigns ---------------------------------------------------------------
//
// A campaign is edited as a whole document rather than field by field: the
// dialogs are modal, so the renderer reads one CampaignDoc, edits it, and hands
// the whole thing back. That keeps the descriptor's own shape (order, the
// fields nobody edits) in main, where src/campaign-project.ts owns it.

/** One hero a mission hands on to a later one. */
export interface PoolHeroDto {
  /** The hero's script name on THIS mission's map; empty = the default hero. */
  scriptName: string;
  /** Another campaign to send the hero to; empty stays in this one. */
  targetCampaign?: string;
  /** Destination mission, 0-based. Left alone unless targetCampaign is set. */
  targetMission?: number;
}

/** One of a mission's three start-bonus slots. */
export interface BonusDto {
  /** E_BONUS_NONE | _ARTIFACT | _CREATURE | _SPELL | _RESOURCE | _BUILDING. */
  type: string;
  /** The chosen artifact/creature/spell/building id, or the resource's name. */
  value: string;
  /** How many — creatures and resources use it. */
  count: number;
}

/** A mission as the Mission dialog edits it. */
export interface CampaignMissionDto {
  /** The map's path under Maps, e.g. "SingleMissions/My Map". */
  mapRel: string;
  name: string;
  description: string;
  heroes: PoolHeroDto[];
  bonuses: BonusDto[];
}

/** A campaign as the Campaign dialog edits it. */
export interface CampaignDoc {
  /** The project folder — the handle for save/pack. */
  dir: string;
  /** Its file name, which is also the folder name inside the .h5c. */
  name: string;
  internalName: string;
  /** The short line under the name (NameComment). */
  summary: string;
  description: string;
  missions: CampaignMissionDto[];
}

/** A campaign project on disk, for the open list. */
export interface CampaignListEntry {
  name: string;
  dir: string;
  missions: number;
}

/** Result of `campaign:list`. */
export interface CampaignListResult { campaigns: CampaignListEntry[] }

/** Payload of `campaign:new`. */
export interface NewCampaignPayload { name: string }

/** Payload of `campaign:open` / `campaign:pack`. */
export interface CampaignDirPayload { dir: string }

/** Payload of `campaign:save`. */
export interface SaveCampaignPayload { doc: CampaignDoc }

/** Payload of `campaign:map-heroes` — which map to read heroes off. */
export interface MapHeroesPayload { mapRel: string }

/**
 * Result of `campaign:map-heroes`. `heroes` are the script names a mission on
 * this map can hand on; `entryPoint` says whether the map can RECEIVE heroes.
 */
export interface MapHeroesResult { heroes: string[]; entryPoint: boolean }

/** Result of `campaign:pack`. */
export interface CampaignPackResult {
  canceled?: boolean;
  ok?: boolean;
  output?: string;
  entries?: number;
  bytes?: number;
}

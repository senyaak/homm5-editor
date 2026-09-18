// The renderer's live state: the loaded map, what is selected, what is shown.
//
// One mutable object rather than a module of `export let`s, because an ESM live
// binding can be read from another module but never assigned — and the pointer
// handler, the panels and the brushes all write here. Keeping the writes on a
// single named object (`state.world = …`) also makes it greppable which code
// owns a transition and which merely reads one.
//
// A map has one or two floors (surface + underground); each is its own terrain
// and object set. We build a group per floor and show one at a time — mixing
// them would dump underground objects onto the surface (wrong heights, chaos).

import * as THREE from 'three';

import type { Instance, SplatData, AmbientData, GeomPart } from '#src/scene/payload.ts';
import type { PlacedFx } from '#viewport/fx.ts';
import type { IdleBody, IdleKind } from '#viewport/skinning.ts';
import type { SkinnedGeom } from '#src/scene/payload.ts';
import { uiPrefs } from '#core/prefs.ts';

/** Every copy of one model on one floor, drawn in a single call. */
/**
 * One material's draw on one floor: a BatchedMesh holding, as geometries,
 * every part of every model on the floor that wears the material, and as
 * instances every placement of those (instancing.ts).
 */
export interface MaterialBatch {
  key: string;
  mesh: THREE.BatchedMesh;
  /** A part that wears it — what a floor's ground-projected material is built from. */
  part: GeomPart;
  /** The material the registry gave the part; the mesh may draw a projected one instead. */
  material: THREE.Material;
  /** A stand-in card under a particle effect: hidden with the "effect markers" toggle. */
  card: boolean;
  /** The mesh's vertex and index capacity, grown by doubling. */
  vertices: number;
  indices: number;
}

/** A floor's record of one model: which material batches draw its parts, and its objects' instances in them. */
export interface GeomBatch {
  /** Per material group of the model: the batch that draws it, the group's geometry there, and the part's index in the material array. */
  parts: { batch: MaterialBatch; geometryId: number; mi: number }[];
  /** Slot for each object. */
  slot: Map<Instance, number>;
  /** What occupies each slot; null once removed (slots are not reused). */
  at: (Instance | null)[];
  /** Per slot, the object's instance id in each part's batch, in `parts` order. */
  ids: (number[] | null)[];
}

/** One floor as it exists in the scene graph, beside the data it came from. */
export interface Floor3D {
  name: string;
  V: number;
  /** Live height plane; the sculpt brush edits it in place and remeshes. */
  heights: number[];
  /** Live ground-kind flags, edited alongside heights (digging floods, raising drains). */
  flags: number[] | null;
  /**
   * How far the river brush has already lowered each vertex, seeded from the
   * map's own river plane. Two things depend on it being a depth rather than a
   * flag:
   *
   *   * A river is a fixed depth below its banks, not a hole that deepens every
   *     time you paint over it — so this survives across strokes. Clearing it
   *     per stroke turned four passes over one stream into a canyon.
   *   * A vertex feathered as rim by one part of a stroke often ends up under
   *     the bed as the brush moves on. Recording only "touched" left it stuck
   *     0.2 above the bed forever, which is what made a dragged river ragged.
   */
  riverDrop: Map<number, number>;
  /** Explicit passability mask: 0 blocked, 1 walkable. */
  passable: number[] | null;
  /** River-bed vertices — the bed only, never the feathered rim. */
  river: Set<number>;
  /** The passability view: blocked fill, navigable fill and the tile grid. */
  passMeshes: THREE.Mesh[];
  /** Building footprint squares (blocked/active/hole/passable), shown with the grid. */
  footMeshes: THREE.Mesh[];
  /** Ground colours for the fallback material, kept for remeshing. */
  colors: number[] | null;
  /**
   * Which cells the terrain is NOT drawn on — the `<holeTiles>` of the
   * objects standing here (terrain-mesh.ts, holesMask). (V-1)² bytes, 1 = hole.
   */
  holes: Uint8Array;
  group: THREE.Group;
  objGroup: THREE.Group;
  /**
   * Per-object handles for picking and editing. Deliberately NOT in the scene:
   * `batches` does the drawing, and these exist to be raycast, dragged and
   * boxed. The raycaster gets them as an explicit list.
   *
   * Keyed by the INSTANCE, not by its id. A handle belongs to the object, and
   * not every object has an id: a dialog scene's `<objects>` are plain hrefs
   * with no `<Item id>` on them, and keyed by id all 657 of them shared one
   * entry and none of them got a transform written into its batch slot — a
   * scene drew its actors on an empty field. Selection still addresses objects
   * by id, which is what `meshById` is for.
   */
  meshes: Map<Instance, THREE.Mesh>;
  /** One instanced draw per model. See buildBatches. */
  batches: Map<number, GeomBatch>;
  /** The draws: one per material worn by the floor's objects (instancing.ts). */
  materialBatches: Map<string, MaterialBatch>;
  /**
   * Objects playing their idle clip, each its own skinned draw. Empty unless
   * the idle-stance setting is on — and an object in here is NOT in `batches`,
   * or it would be drawn twice, once moving and once frozen.
   */
  idle: IdleBody[];
  /** The bodies' draws, one per creature kind on this floor (idle.ts). */
  idleKinds: Map<SkinnedGeom, IdleKind>;
  /**
   * Playing particle effects, one batch per distinct effect payload with a
   * copy per placed object that carries it. Built asynchronously after the
   * floor (the baked keys arrive over their own IPC); empty until then and on
   * maps without effects.
   */
  fx: PlacedFx[];
  /**
   * The floor's designer point lights (map.xdb <pointLights>), baked into one
   * texture the terrain shaders add to the preset's light. See bakeLightMap.
   */
  lightMap: THREE.DataTexture;
  /** A light-carrying object moved or died; the render loop rebakes soon. */
  lightsDirty: boolean;
  terrainMesh: THREE.Mesh;
  /**
   * The height plane on the GPU, for the parts that drape over the ground
   * (viewport/drape.ts). Refilled whenever the heights change.
   */
  heightTex: THREE.DataTexture | null;
  waterMesh: THREE.Mesh | null;
  /** The sea texture, kept so sculpting can raise a sheet on a map that began dry. */
  waterTex: string | null;
  splat: SplatData | null;
  /** The packed layer masks on the GPU; the brush paints straight into it. */
  maskTex: THREE.DataArrayTexture | null;
  /** The floor's lighting preset; applied whenever this floor is shown. */
  ambient: AmbientData | null;
  instances: Instance[];
}

/** The loaded map: one group per floor, exactly one of them visible. */
export interface World { floors: Floor3D[]; active: number }

/** The currently picked object, kept with its mesh so a drag can move it. */
export interface Selection { id: string; mesh: THREE.Mesh; inst: Instance }

/** Everything rebuilt on each map load, plus the view toggles that outlive one. */
export const state = {
  world: null as World | null,
  /**
   * The last reachability answer, per floor, or null when nobody has asked.
   *
   * Kept here rather than in the feature that asks because the VIEWPORT draws
   * it (viewport/overlays.ts) and the feature (features/reach.ts) sets it, and
   * a viewport that imported a feature to find out what to draw would have the
   * layering backwards.
   */
  reach: null as { walkable: Uint8Array[]; seen: Uint8Array[] } | null,
  selected: null as Selection | null,
  /** The selection's outline, added to the scene beside the picked mesh. */
  boxHelper: null as THREE.BoxHelper | null,
  showObjects: uiPrefs.showObjects,
  showFx: uiPrefs.showFx,
  mapLight: uiPrefs.mapLight,
  showFxCards: uiPrefs.showFxCards,
  /**
   * A map is on its way in: the frame loop stands still. The old world would
   * otherwise go on drawing under the loading overlay for the whole load,
   * and a crowded map's frame is what the new map's bytes then had to share
   * the thread with — the blob fetch of a reopened stress map ran 260 ms on
   * an empty window and 1.5–3 s over a drawn one.
   */
  loading: false,
};

/** Only called while a map is loaded; every caller is gated on `state.world`. */
export const activeFloor = (): Floor3D => state.world!.floors[state.world!.active]!;

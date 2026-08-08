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

import type { Instance, SplatData, AmbientData } from '#src/scene/payload.ts';
import type { FxSystem } from '#viewport/particles.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { uiPrefs } from '#core/prefs.ts';

/** Every copy of one model on one floor, drawn in a single call. */
export interface GeomBatch {
  im: THREE.InstancedMesh;
  /** Slot in the instance buffer for each object. */
  slot: Map<Instance, number>;
  /** What occupies each slot, so a removed one can be back-filled. */
  at: (Instance | null)[];
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
  /**
   * Objects playing their idle clip, each its own skinned draw. Empty unless
   * the idle-stance setting is on — and an object in here is NOT in `batches`,
   * or it would be drawn twice, once moving and once frozen.
   */
  idle: IdleObject[];
  /**
   * Playing particle effects, one system per (placed object x its effect's
   * ParticleInstance). Built asynchronously after the floor (the baked keys
   * arrive over their own IPC); empty until then and on maps without effects.
   */
  fx: FxSystem[];
  /**
   * The floor's designer point lights (map.xdb <pointLights>), baked into one
   * texture the terrain shaders add to the preset's light. See bakeLightMap.
   */
  lightMap: THREE.DataTexture;
  /** A light-carrying object moved or died; the render loop rebakes soon. */
  lightsDirty: boolean;
  terrainMesh: THREE.Mesh;
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
};

/** Only called while a map is loaded; every caller is gated on `state.world`. */
export const activeFloor = (): Floor3D => state.world!.floors[state.world!.active]!;

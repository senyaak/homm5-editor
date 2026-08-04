// The scene as it crosses the IPC boundary — types only, no reader.
//
// Everything here is plain JSON (or typed arrays where the payload would
// otherwise double), because it is built in the main process and structurally
// cloned into the renderer. That is also why it lives apart from the builder:
// the modules that FILL these shapes — materials, splat, water, ambient,
// object effects — all need them, and the renderer needs them without wanting
// a single line of file reading in its bundle.

import type { BakedClip } from './animation.ts';
import type { MapObject, PointLightDef } from '../map/map.ts';


/**
 * How a material blends, straight from its <AlphaMode>.
 *
 * Counted across the shipped materials: ALPHA_TEST 2375, OPAQUE 1591,
 * TRANSPARENT 1049, OVERLAY 435, OVERLAY_ZWRITE 17, DECAL 4.
 */
export type AlphaMode =
  | 'AM_OPAQUE' | 'AM_ALPHA_TEST' | 'AM_TRANSPARENT'
  | 'AM_OVERLAY' | 'AM_OVERLAY_ZWRITE' | 'AM_DECAL';

/**
 * One submesh of a model, with the material it uses.
 *
 * A model's meshes are concatenated into a single vertex/index buffer, and each
 * part names the slice of `idx` it owns. The renderer turns these into geometry
 * groups with a material array, which is how a four-mesh building gets its four
 * textures without four draw-call-sized objects in the scene graph.
 */
export interface GeomPart {
  /** First index in `GeomData.idx` this part covers. */
  start: number;
  count: number;
  /** Downsampled texture as a PNG data URI, or null if unresolved. */
  tex: string | null;
  /** How this part blends, as its material declares. */
  alphaMode: AlphaMode;
  /**
   * The part is a decal lying ON the ground: its material sets
   * <ProjectOnTerrain> AND the mesh is actually flat.
   *
   * The flatness test is not redundant. Measured over the shipped models, 393
   * parts carry the flag and the extreme is three times TALLER than it is wide.
   * So the flag alone does not mean "this lies on the ground", and treating it
   * that way sent a 10-unit mountain through the decal path — which sampled the
   * ground by world XY and smeared one column of texels up every cliff face,
   * the stripes and black wedges Senya reported on Mountain10x10.
   */
  projectOnTerrain: boolean;
  /**
   * The mesh lies flat, whatever its material says about projecting.
   *
   * Kept for the ProjectOnTerrain nudge only. It is NOT what decides depth
   * writing: flatness fails to tell a solid mountain from a feathered mound —
   * Mountain10x10 (h/span 0.505) and the Abandoned Mine's hill (0.284) are both
   * non-flat AM_OVERLAY bodies, yet one must occlude and the other must not.
   */
  flat: boolean;
  /**
   * The texture is a solid skin: most of its texels are opaque.
   *
   * This, not flatness, is what decides whether a blended part writes depth.
   * Measured on the two AM_OVERLAY cases that looked identical by every other
   * signal: Mountain10x10's rock is 96% opaque — a body that must occlude — while
   * the mine's GoldMineHill is 11% opaque and near-black, a layer meant to be
   * blended over the terrain it is projected onto. Writing depth for the mound
   * punched a hole: its near-invisible pixels occluded the ground behind it, so
   * the back showed through as if the earth were not there.
   */
  opaque: boolean;
  /**
   * This part takes the TERRAIN it stands on as its surface: the renderer
   * shades it with the same ground splat the terrain uses, sampled at the
   * part's own world position, with the part's own texture applied on top as a
   * darkening. That is what the engine does for the Abandoned Mine's mound — the
   * map's grass climbs up the hump — which Senya confirmed against the original.
   *
   * The signal is `<ProjectOnTerrain>` AND a sheer texture. The flag alone is
   * not enough: 393 shipped parts carry it, most of them solid bodies, and
   * projecting the ground onto Mountain10x10 (a 96%-opaque proj part) smeared
   * one column of texels up its cliffs. But a proj part whose texture is a sheer
   * overlay (the mound's GoldMineHill, 11% opaque) is exactly the take-the-
   * ground case, and opacity separates the two with a wide margin.
   */
  terrainProjected: boolean;
  /**
   * Additive blending: the material sets `<AddPlaced>true`. Energy and glow
   * effects — a portal's Spiral, spell auras — are drawn this way, their texels
   * ADDED to the background so they read as light rather than paint. Blended
   * with ordinary alpha they come out as dark muddy discs instead of glowing.
   */
  additive: boolean;
  /**
   * Self-illuminated: the material's `<LightingMode>` is `L_SELFILLUM`, so the
   * part emits its own colour and scene lighting must not darken it. Effect
   * models are full-bright; lighting a portal's runes drops them into shadow the
   * game never shows.
   */
  selfIllum: boolean;
}

/**
 * What an animated model needs beyond its mesh: the bones, the binding and one
 * baked idle clip. Everything is plain JSON and already in the renderer's own
 * conventions, so the renderer builds a skinned mesh without knowing anything
 * about Granny — see docs/ANIMATION_FORMAT.md.
 *
 * Only filled when the editor is asked for it (`SceneOptions.animate`); a still
 * map never pays for it.
 */
export interface SkinnedGeom {
  /** 4 bone indices per vertex, in `pos` order. */
  index: number[];
  /** 4 weights per vertex, summing to 1. */
  weight: number[];
  /** Bones in skeleton order; `parent` is -1 for a root. */
  bones: { name: string; parent: number; pos: number[]; quat: number[] }[];
  /**
   * Inverse bind matrices, 16 floats per bone, **column-major** — transposed on
   * the way out, because the files are row-vector and three.js is not.
   */
  bind: number[][];
  /** The idle, sampled onto an even grid; null when the object has no clip. */
  clip: BakedClip | null;
}

/** One decoded mesh, ready for the renderer. Arrays are plain JSON. */
export interface GeomData {
  pos: number[];
  /** Null when the mesh has no usable texture coordinates. */
  uv: number[] | null;
  /**
   * Normals as the model authored them, or null to compute from the faces.
   *
   * Worth carrying: averaging face normals smooths every hard edge a modeller
   * put in, which leaves a building evenly lit and flat — the shading is what
   * separates its planks, stone and rails when they all share one greyscale
   * texture, as the Abandoned Mine's do.
   */
  nrm: number[] | null;
  idx: number[];
  /** One entry per submesh, in index order; always covers all of `idx`. */
  parts: GeomPart[];
  /**
   * The building's tile footprint, or null for objects that declare none
   * (artifacts, monsters, plain statics). Offsets are tiles relative to the
   * placed object's own tile; the renderer rotates them with the object and
   * draws them as the coloured grid squares the original editor shows under a
   * building — blocked (impassable), active (where the hero interacts), plus
   * the hole and passable cells.
   */
  footprint?: Footprint | null;
  /** Bones, binding and idle clip — present only when animation is asked for. */
  skin?: SkinnedGeom;
  /**
   * The object's particle effect, baked and ready to play — one entry per
   * ParticleInstance of its `<Effect>`. Present whenever the chain resolves;
   * the static glow card in `parts` stays as the fallback and the pick target.
   */
  fx?: FxInstancePayload[];
  /**
   * Display scale from the idle clip skeleton's root bone (Phoenix 0.37,
   * Devil 0.7, Griffin 1.5) — the game draws a creature through its rig, and
   * the rig shrinks or grows the authored mesh. Applied to the placed MESH
   * only; effects play unscaled (the phoenix's flames tower over the small
   * bird, which is the game's own picture). Absent = 1.
   */
  scale?: number;
}

/**
 * One particle instance of an object's effect (docs/EFFECTS_FORMAT.md): its
 * placement inside the object's frame and the texture frame table. The baked
 * keys themselves are NOT here — 45k particles of one map JSON-doubled the
 * scene payload — the renderer fetches them by `uid` over `map:fx`, which
 * ships typed arrays through structured clone instead of JSON.
 */
export interface FxInstancePayload {
  /** bin/effects file name; the key for map:fx. */
  uid: string;
  pos: number[];
  quat: number[];
  scale: number;
  /**
   * Set when the instance is glued to a BONE — the ghost dragon's eye glow on
   * its head. `pos`/`quat`/`scale` above carry the bone's REST transform folded
   * in, which is right for a still object and wrong the moment the skeleton
   * moves: the eyes would stay where the head was in the bind pose. So the
   * transform is also kept bone-LOCAL here, and the renderer re-hangs it off
   * the animated bone every frame (advanceFx). The bone is addressed the way
   * the effect addresses it: by name, or by index as a string.
   *
   * `scale` here has the root's display scale divided back out, because at run
   * time that scale is on the skinned mesh and so already inside the bone's
   * world matrix — folding it in twice would shrink the eyes onto the nose.
   */
  glue?: { bone: string; pos: number[]; quat: number[]; scale: number };
  /** Playback rate multiplier, from the instance's <Speed>. */
  speed: number;
  /**
   * The trigger train (docs/EFFECTS_FORMAT.md §5): the recording is NOT a
   * loop — it is a one-shot (population ramps from zero and dies back), and
   * the engine RETRIGGERS it every `endCycle` playback seconds, overlapping
   * copies summing to the steady flame. `offset` delays the train's first
   * trigger; `cycleCount` bounds how many triggers fire (0 = forever).
   */
  offset: number;
  endCycle: number;
  cycleCount: number;
  /**
   * Outer restart period, seconds — set on CLIP-hung instances to the idle
   * clip's length: the engine replays the whole effect with every animation
   * cycle, which is what makes a finite train (the phoenix's one-burst wing
   * whoosh, cycleCount 1) fire once per flap rather than once ever. Looping
   * instances of the same effects are authored with EndCycle == clip length
   * (Phoenix: 3.16666 == the clip's 3.1666667s), which is what confirmed the
   * mechanism. Absent on object effects — their trains run free.
   */
  retrigger?: number;
  /**
   * `<Light>L_LIT</Light>` — the instance is lit by the scene (163 of the 396
   * adventure-reachable instances; the rest are L_NORMAL, self-lit). A lit
   * smoke column darkens with a night map's preset; the fire next to it
   * doesn't. (The presets' ParticlesColor is 0.25,0.25,0.25 in every preset
   * that has one — an engine constant, not a per-map knob — so scene light is
   * the only thing that actually varies.)
   */
  lit: boolean;
  /**
   * The instance's `<Pivot>`, in quad units — (0,-1) anchors the bottom edge,
   * so a blade of grass grows up from where it stands. Only the standing-
   * scenery path reads it (a system whose BAKE never moves — the renderer
   * derives that; the XML's `<Static>` is P_STATIC on every instance shipped
   * and distinguishes nothing).
   */
  pivot?: number[];
  /**
   * Frame table the baked texture indices point into; null = empty slot.
   * Each frame ships as TWO data URIs — colour (alpha forced opaque) and the
   * real alpha as a grayscale image — because a browser canvas premultiplies:
   * a PNG texel with alpha 0 loses its colour on the way to the atlas, and
   * zero-alpha colour is exactly what fire IS in this art (rgb adds, alpha
   * occludes; the renderer blends ONE/ONE_MINUS_SRC_ALPHA with straight
   * colour, so one instance mixes additive fire and covering smoke frames).
   */
  textures: ({ c: string; a: string } | null)[];
}

/** A tile offset from an object's own tile, in grid axes; may be negative. */
export interface TileOffset { x: number; y: number }

/** A building's tile footprint, split by role. See AdvMapBuildingShared. */
export interface Footprint {
  blocked: TileOffset[];
  active: TileOffset[];
  hole: TileOffset[];
  passable: TileOffset[];
}

/** A placed object: tile position, rotation about Z, and its mesh index. */
export interface Instance {
  id: string | null;
  type: string;
  /** Index into Scene.geoms. */
  g: number;
  shared: string;
  x: number; y: number; z: number; r: number;
  /**
   * Designer-placed point lights riding on this object (map.ts PointLightDef:
   * world-unit map-axis offset + colour + radius). Absent on the vast majority
   * of objects; the renderer bakes the ones that exist into the floor's
   * lightmap, and moving the object moves its pool on the next bake.
   */
  lights?: PointLightDef[];
}

/** The sea: a flat sheet at  over every cell touching water-flagged ground. */
export interface WaterData {
  V: number;
  level: number;
  /** Vertex index of each covered cell corner (y*V + x). */
  cells: number[];
  wet: number;
  tex: string | null;
}

/** Everything the splat shader needs: tile textures plus their weight masks. */
export interface SplatData {
  V: number;
  size: number;
  layerCount: number;
  /** One PNG data URI per layer, sorted by the tile`s <Priority>. */
  layerTex: string[];
  /** Masks packed three per RGB image. */
  maskGroups: string[];
  rockTex: string | null;
  paths: string[];
}

/** One floor of a map: its terrain and the objects standing on it. */
export interface Floor {
  name: string;
  V: number;
  heights: number[];
  colors: number[] | null;
  /** Per-vertex ground kind; see readGroundFlags. Null if absent. */
  flags: number[] | null;
  /**
   * Vertices already marked in the half-tile river plane.
   *
   * The river brush sinks a bed exactly once. Without knowing what is already
   * river, a second stroke over the same water digs it again and a few passes
   * turn a stream into a canyon.
   */
  riverVerts: number[];
  /**
   * Explicit passability mask: 0 blocked, 1 walkable. The editor's Masks tab
   * writes this. Water is blocked implicitly by its flag and is normally NOT
   * recorded here, so anything showing "where can I walk" has to union the two.
   */
  passable: number[] | null;
  water: WaterData | null;
  splat: SplatData | null;
  /** The floor's lighting preset, or null when none could be read. */
  ambient: AmbientData | null;
  instances: Instance[];
}

/**
 * A map's AmbientLight preset — most of what makes the game's picture: sun
 * colour and direction, the two non-sun colours, and the sky behind everything.
 * Colours are the preset's own 0..1 sRGB floats, untouched; how bright to draw
 * them is the renderer's call.
 */
export interface AmbientData {
  /** Sunlit-side colour (`LightColor`). */
  light: number[];
  /** Indirect colour every surface receives (`AmbientColor`). */
  ambient: number[];
  /** Colour of surfaces facing away from the sun (`ShadeColor`). */
  shade: number[];
  /** Sun elevation above the horizon, degrees. */
  pitch: number;
  /** Sun heading around +Z, degrees. */
  yaw: number;
  /**
   * What the lit colour is multiplied by before it is clamped — the era's
   * modulate-×2, from the preset's `<Whitening>`: 2 when it is on, 1 when it is
   * not. Not a constant: 31 of the 291 shipped presets turn it off.
   */
  whiten: number;
  /**
   * The preset's `<SkyDome>` model, decoded — a self-illuminated dome
   * (SkyDome1 is a 250-unit skybox cube, the arenas are spheres) the game
   * draws behind everything, and the reason a scene's horizon is a sunset
   * rather than black. 88 shipped presets name none; absent/null then, and
   * also for callers that don't ask for it decoded (loadAmbient's `geo`).
   */
  dome?: GeomData | null;
}

/** The renderable scene — this is the payload that crosses the IPC boundary. */
export interface Scene { geoms: GeomData[]; floors: Floor[] }

/** Whether to decode bones and idle clips at all, and how finely to sample them. */
export interface SceneAnimationOptions {
  /**
   * Read the skin binding and the object's idle clip.
   *
   * Off by default, and meant to stay off unless the setting asks for it: it
   * costs two more vertex arrays per model, an extra Granny file read per
   * animated object, and a baked clip in the scene payload. A map that is only
   * being edited does not need any of it.
   */
  animate?: boolean;
  /** Samples per second when baking a clip (default 15). */
  animationFps?: number;
}

export interface BuildSceneOptions extends SceneAnimationOptions {
  /** Edge length for embedded object textures. */
  texSize?: number;
  /** Edge length for ground tile textures. */
  tileSize?: number;
  seaLevel?: number;
  /**
   * Objects to place on the map's terrain besides the map's own.
   *
   * For a dialog scene, which brings its cast and its set dressing with it and
   * borrows a bare arena to stand them on (src/dialog/stage.ts). They are
   * placed exactly like the map's — same footprint, same ground height, same
   * skipping when a shared reference leads nowhere.
   */
  extraObjects?: readonly MapObject[];
}

/** A ground tile in the palette, previewed from its own .dds. */
export interface TileInfo {
  name: string;
  category: string;
  path: string;
  priority: number;
  type: string;
  thumb: string;
}

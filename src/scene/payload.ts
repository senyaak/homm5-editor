// The scene as it crosses the IPC boundary — types only, no reader.
//
// Everything here is plain JSON (or typed arrays where the payload would
// otherwise double), because it is built in the main process and structurally
// cloned into the renderer. That is also why it lives apart from the builder:
// the modules that FILL these shapes — materials, splat, water, ambient,
// object effects — all need them, and the renderer needs them without wanting
// a single line of file reading in its bundle.

import type { BakedClip } from './animation.ts';
import type { BoneTable } from './bone-table.ts';
import type { FxBaked } from './fx-bake.ts';
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
  /**
   * The part's texture, reduced to the cap, as its texels; null if unresolved.
   * Texels rather than a PNG (which every other picture in a payload still
   * is): the PNG was encoded here and decoded again in the renderer, two
   * seconds of a map open between them, for a texture that goes straight
   * into a texture either way.
   */
  tex: Picture | CompressedPicture | null;
  /** How this part blends, as its material declares. */
  alphaMode: AlphaMode;
  /**
   * The material sets `<ProjectOnTerrain>`: the part is DRAPED over the ground.
   *
   * Every vertex takes the terrain height under its own world XY on top of its
   * authored z — so a flat decal lies on the ground however the ground rolls, a
   * mountain's skirt (authored at z = 0) meets the terrain all the way round,
   * and the mountain itself follows the hill it was put on. That is what the
   * flag means to the engine, and the shipped maps show it: on A2S2 the ground
   * under a mountain's footprint spans 3.75 units at the median and 10 at p90,
   * against a mountain 5.4 units tall — placed rigidly at one height it would
   * float on one side and be buried on the other. The hero's path arrows and
   * the creature selection ring carry the same flag, because they too have to
   * hug the slope. The draping is done in the vertex shader
   * (renderer/viewport/drape.ts), per instance, off the instance matrix.
   *
   * It says nothing about shading: 388 opaque rocks carry it beside the
   * overlays. `terrainProjected` is the shading half.
   */
  projectOnTerrain: boolean;
  /**
   * The mesh lies flat, whatever its material says about projecting.
   *
   * A draped flat part is coplanar with the ground it lies on and z-fights
   * with it, so it wants a depth nudge; a body standing on the ground does not.
   * It is NOT what decides depth writing: flatness fails to tell a solid
   * mountain from a feathered mound — Mountain10x10 (h/span 0.505) and the
   * Abandoned Mine's hill (0.284) are both non-flat AM_OVERLAY bodies, yet one
   * must occlude and the other must not.
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
   * part's own world position, and lays the part's own texture over that by
   * its alpha. Where the texture is solid the part shows its own skin; where it
   * fades, the ground shows through IN the part — the map's grass climbing the
   * Abandoned Mine's mound (11% opaque, which Senya confirmed against the
   * original editor), and the same grass running up into a mountain's skirt,
   * whose rock (96% opaque) fades out at the edges so that it reads as growing
   * out of the ground rather than set down on it.
   *
   * The signal is `<ProjectOnTerrain>` AND an `AM_OVERLAY` (or `_ZWRITE`)
   * material that is not self-lit. OVERLAY is the mode the engine keeps for
   * things laid over the ground — 357 of its 435 overlays carry the flag — and
   * the alpha-mix is what makes the mound and the mountain one rule. Opacity
   * used to be the discriminator, with the sheer mound composited and the
   * opaque mountain drawn as a body; but a body drawn on its own can only blend
   * its edges into whatever stands BEHIND it, which on a slope is not the
   * ground it is standing on — Senya's "the edges are not painted with the
   * surface they stand on". A self-lit overlay (a path arrow, a selection ring)
   * is a marker drawn over the ground, and lit ground under it would be wrong,
   * so it blends the ordinary way — draped, but not composited.
   */
  terrainProjected: boolean;
  /**
   * Additive blending: the material sets `<AddPlaced>true` AND blends at
   * all (OVERLAY, OVERLAY_ZWRITE, TRANSPARENT, DECAL). Energy and glow effects
   * — a portal's Spiral, spell auras — are drawn this way, their texels ADDED
   * to the background so they read as light rather than paint. Blended with
   * ordinary alpha they come out as dark muddy discs instead of glowing. An
   * OPAQUE material with the flag (the gold pile) is drawn opaque: the
   * engine's pass builder never consults the flag on that branch
   * (src/scene/materials.ts, MaterialInfo.additive).
   */
  additive: boolean;
  /**
   * A stand-in for a particle effect, not something the game draws: the
   * vertical card that gives an effect-only object (307 of them — the bats,
   * the fires, the glows) a shape to click and box. It is drawn only when the
   * object's particles are NOT playing — the game shows the particles and
   * nothing else, and a ten-unit bat hanging over a swarm of small ones was
   * what the card looked like once they did (Senya, bats01).
   */
  card?: true;
  /**
   * Self-illuminated: the material's `<LightingMode>` is `L_SELFILLUM`, so the
   * part emits its own colour and scene lighting must not darken it. Effect
   * models are full-bright; lighting a portal's runes drops them into shadow the
   * game never shows.
   */
  selfIllum: boolean;
  /**
   * Draw the back faces as well — the material's own `<Is2Sided>`.
   *
   * The engine culls them otherwise, and that is not a saving but part of the
   * picture: a camera INSIDE a body sees straight through it, because its near
   * faces are behind the eye and its far ones are turned away. C1M1's dialogue
   * pulls back into the ridge of mountains that lines the arena four times over
   * — shot 22 has the eye 5 units inside Mountain12x12 — and drawn two-sided
   * those shots are the inside of a rock instead of the archangel.
   *
   * Rare and real: 430 of the 11639 shipped materials set it, and they are the
   * things a single sheet of triangles has to be seen from both sides —
   * foliage cards, banners, the grass tufts.
   */
  twoSided: boolean;
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
  index: Uint8Array;
  /** 4 weights per vertex, summing to 1. */
  weight: Float32Array;
  /** Bones in skeleton order; `parent` is -1 for a root. */
  bones: { name: string; parent: number; pos: number[]; quat: number[] }[];
  /**
   * Inverse bind matrices, 16 floats per bone, **column-major** — transposed on
   * the way out, because the files are row-vector and three.js is not.
   */
  bind: number[][];
  /** The idle, sampled onto an even grid; null when the object has no clip. */
  clip: BakedClip | null;
  /**
   * The idle posed frame by frame (bone-table.ts), what a map's bodies are
   * drawn from — baked where the scene is built, like the effect tables.
   * Absent when there is no clip.
   */
  table?: BoneTable;
}

/**
 * One decoded mesh, ready for the renderer.
 *
 * The arrays are TYPED: they are what the file holds, what the GPU takes,
 * and — going to the window — what leaves the IPC reply for the blob fetch
 * (blob-table.ts). As plain `number[]` they crossed element by element: the
 * mix stress map's 6.3 million geometry numbers and its clips were ~3 s of a
 * 7.5 s open, in the clone alone.
 */
export interface GeomData {
  pos: Float32Array;
  /** Null when the mesh has no usable texture coordinates. */
  uv: Float32Array | null;
  /**
   * Normals as the model authored them, or null to compute from the faces.
   *
   * Worth carrying: averaging face normals smooths every hard edge a modeller
   * put in, which leaves a building evenly lit and flat — the shading is what
   * separates its planks, stone and rails when they all share one greyscale
   * texture, as the Abandoned Mine's do.
   */
  nrm: Float32Array | null;
  idx: Uint32Array;
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
 * placement inside the object's frame, the texture frame table, and the
 * recording BAKED — sampled into the table the shader reads (fx-bake.ts),
 * once per recording file, shared by every instance that plays it.
 */
export interface FxInstancePayload {
  /** bin/effects file name — the recording. */
  uid: string;
  /** The recording, baked: the table and what the batch needs to know about it. */
  baked: FxBaked;
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
   *
   * A frame is its straight-alpha texels, not a PNG like every other texture
   * in a payload: zero-alpha colour is exactly what fire IS in this art (rgb
   * adds, alpha occludes; the renderer blends ONE/ONE_MINUS_SRC_ALPHA with
   * straight colour, so one instance mixes additive fire and covering smoke
   * frames), and the PNG road goes through a browser canvas, which
   * premultiplies — the fire arrived black until each frame was split into
   * a colour image and an alpha image. Bytes go straight to a texture.
   *
   * One object per distinct frame, shared by every instance that names it:
   * the structured clone across the IPC keeps that identity (it copies a
   * string per field, which is why the PNGs need `packTextures` and this
   * does not), and the renderer keys its atlases on it.
   */
  textures: (Picture | null)[];
}

/**
 * A picture as its texels: `width * height * 4` bytes, R,G,B,A straight,
 * row-major from the top — a part's texture, a particle frame.
 *
 * One object per distinct picture per IPC message: the structured clone
 * keeps that identity (it is a string it copies per field, which is why the
 * PNGs need `packTextures` and this does not). `key` names the file and cap
 * it was decoded from, when it was one — the same key means the same texels
 * across messages, which is what lets the renderer keep one texture per
 * picture rather than per object that wears it.
 */
export interface Picture { width: number; height: number; rgba: Uint8Array; key?: string }

/**
 * A texture as the game ships it: S3TC blocks with the mip chain below,
 * for a GPU that takes them whole (every desktop one does) — no decode
 * here, no encode there, a sixth of the bytes across the IPC and on the
 * card, and the texels and mips the game itself draws with. The main
 * process makes these once the window has said its GPU can (render caps);
 * until then, and for a file with no chain, a part gets a `Picture`.
 */
export interface CompressedPicture {
  format: 'DXT1' | 'DXT3' | 'DXT5';
  width: number;
  height: number;
  /** Top level first, down to 1×1. */
  levels: { width: number; height: number; data: Uint8Array }[];
  key: string;
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
  /** Colour of surfaces the sun does not reach (`IncidentShadowColor`). */
  incident: number[];
  /** Sun elevation above the horizon, degrees. */
  pitch: number;
  /** Sun heading around +Z, degrees. */
  yaw: number;
  /**
   * Where the shadows come from — the sun's own angles unless the preset says
   * otherwise. `ShadowPitch`/`ShadowYaw` are 100/100 on 295 of the 308 shipped
   * presets and 100 is not an angle: the engine compares against it and copies
   * the sun direction when it matches (docs/LIGHTING.md §3b). Resolved here, so
   * nothing downstream has to know about the sentinel.
   */
  shadowPitch: number;
  shadowYaw: number;
  /**
   * The vertical range the shadow map spends its precision on
   * (`MaxShadowHeight`), world units. A caster higher than this above the
   * ground it shadows runs out of map. 20 where the preset says 0 — the
   * engine's own fallback.
   */
  maxShadowHeight: number;
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

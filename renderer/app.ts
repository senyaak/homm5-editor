// Renderer — live 3D map view with pick-and-move editing.
//
// Talks to the main process only through `window.editor` (see preload.cjs):
// loadMap returns scene data (terrain + decoded object meshes + placed
// instances); moving an object sends the new tile position back so the map
// model — the source of truth — records the edit.
//
// Interaction:
//   * left-drag empty space  -> orbit (OrbitControls)
//   * left-click an object   -> select (shows info panel + bounding box)
//   * left-drag an object    -> move it across the terrain, snapped to tiles
//   * wheel / right-drag      -> zoom / pan
//
// The game is Z-up; object positions are tile coordinates, Rot is about Z.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { UNITS_PER_TILE as U } from '../src/units.ts';
import { tierOf, RAMP_BIT, TIER_STEP } from '../src/terrain.ts';
import type { Scene, Floor, Instance, SplatData, TileInfo, GeomData, GeomPart, Footprint } from '../src/scene.ts';
import type { EditorApi, MapListEntry, ExternalChange, PlaceableObject, RosterEntryDTO } from '../electron/ipc.ts';
import type { ObjectProp } from '../src/map.ts';
import { objectProps, deref, controlOf, objectSchema, mapSchema, resolveSchemaAtPath, classOf, schemaForClass } from '../src/schema.ts';
import type { FieldSchema, HasDefs } from '../src/schema.ts';
import type { TreeData, Path as TreePath } from '../src/tree.ts';

type MapEntry = MapListEntry & { cat: string };
/**
 * The preload bridge. contextIsolation is on, so this is the entire surface the
 * renderer has — the contract lives in electron/ipc.ts and both sides bind to it.
 */
declare global {
  interface Window {
    editor: EditorApi;
    /** Plan-view geometry for click-driven tests — see "automation hook" below. */
    view: ViewApi;
  }
}


/**
 * Look up an element the page is known to contain. Throws rather than returning
 * null: every id here is hard-coded in index.html, so a miss is a typo caught on
 * first load, not a runtime condition worth handling at each call site.
 */
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element #${id}`);
  return el;
};

/** Same, for the one <select> we drive. */
const $select = (id: string): HTMLSelectElement => {
  const el = $(id);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`#${id} is not a select`);
  return el;
};

/** Same, for the buttons whose .disabled we set. */
const $button = (id: string): HTMLButtonElement => {
  const el = $(id);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return el;
};

/** Same, for the inputs whose .value we read — checked, not cast. */
const $input = (id: string): HTMLInputElement => {
  const el = $(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return el;
};

/** Set the text of a child the markup is known to contain. */
const setChild = (root: HTMLElement, sel: string, text: string): void => {
  const el = root.querySelector(sel);
  if (el) el.textContent = text;
};

/** One floor as it exists in the scene graph, beside the data it came from. */
interface Floor3D {
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
   */
  meshes: Map<string, THREE.Mesh>;
  /** One instanced draw per model. See buildBatches. */
  batches: Map<number, GeomBatch>;
  terrainMesh: THREE.Mesh;
  waterMesh: THREE.Mesh | null;
  /** The sea texture, kept so sculpting can raise a sheet on a map that began dry. */
  waterTex: string | null;
  splat: SplatData | null;
  /** The packed layer masks on the GPU; the brush paints straight into it. */
  maskTex: THREE.DataArrayTexture | null;
  instances: Instance[];
}

/** The loaded map: one group per floor, exactly one of them visible. */
interface World { floors: Floor3D[]; active: number }

/**
 * A point on a cut cell's boundary ring. Corners reuse their existing grid
 * vertex; a cut sits at an edge midpoint and carries TWO heights, since the cut
 * follows the terrain rather than sitting level.
 */
interface RingCorner { cut: false; up: boolean; gi: number }
interface RingCut { cut: true; xy: [number, number]; hz: number; lz: number }
type RingPoint = RingCorner | RingCut;

/** The currently picked object, kept with its mesh so a drag can move it. */
interface Selection { id: string; mesh: THREE.Mesh; inst: Instance }
const ALL = 'All'; // category chip meaning 'no filter', used as both label and key

// --- three.js boilerplate ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1014);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 6000);
camera.up.set(0, 0, 1); // Z-up
// Bright, wraparound lighting so back-facing / normal-less meshes never go pure
// black (a lot of decoded props have imperfect normals).
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x555044, 1.15));
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xfff0d8, 0.9);
sun.position.set(0.6, 0.4, 1); scene.add(sun);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Map-editor feel: middle-drag pans (the default dollies, which duplicates the
// wheel), and panning slides along the ground plane instead of the screen plane
// so the view doesn't drift off the terrain when the camera is tilted.
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.screenSpacePanning = false;

// --- top-down (plan) camera -------------------------------------------------
// A fixed orthographic view straight down the -Z axis. Perspective foreshortening
// and terrain height both drop out, so world (x, y) maps to the screen by a plain
// affine transform: a proper plan view for laying a map out, and — because that
// mapping is exact and camera-independent — the stable coordinate frame the
// click-driven reconstruction tests need to compute "where to click" for a tile.
//
// The orbit camera above still owns pan/target; this one just re-centres on that
// same target every frame (see syncTopCamera). Rotation is disabled in plan view
// so the affine mapping holds; pan (WASD / middle-drag) and zoom (wheel -> the
// frustum half-height) still work.
const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
topCamera.up.set(0, 1, 0); // world +Y is screen up, +X is screen right
/** Half-height of the ortho frustum, in world units — the plan-view zoom level. */
let topHalf = 40 * U;
/** false = 3D perspective + orbit; true = 2D plan (orthographic top-down). */
let topView = false;
/** The camera the render loop, raycaster and resize all read; swapped by the toggle. */
let activeCam: THREE.Camera = camera;

/** Re-fit the ortho frustum to the viewport aspect and re-centre it over the orbit target. */
function syncTopCamera(): void {
  const aspect = innerWidth / innerHeight;
  topCamera.top = topHalf; topCamera.bottom = -topHalf;
  topCamera.left = -topHalf * aspect; topCamera.right = topHalf * aspect;
  const t = controls.target;
  topCamera.position.set(t.x, t.y, 10000); // height is arbitrary under ortho, just above all geometry
  topCamera.lookAt(t.x, t.y, 0);
  topCamera.updateProjectionMatrix();
  topCamera.updateMatrixWorld();
}

/** Switch between the 3D orbit view and the 2D plan view. */
function setTopView(on: boolean): void {
  topView = on;
  activeCam = on ? topCamera : camera;
  controls.enableRotate = !on; // plan view keeps pan + zoom, drops orbit
  if (on) syncTopCamera();
  const b = document.getElementById('viewbtn');
  if (b) { b.textContent = on ? 'View: 2D' : 'View: 3D'; b.classList.toggle('on', on); }
  saveUiPrefs({ topView: on });
}

// Wheel zoom in plan view: OrbitControls dollies the (hidden) perspective camera,
// which does nothing to the ortho frustum, so adjust its half-height here instead.
addEventListener('wheel', (e) => {
  if (!topView) return;
  topHalf = Math.max(2 * U, Math.min(400 * U, topHalf * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
}, { passive: true });

// --- WASD panning ---
// Held keys move the camera and its orbit target together across the ground.
// Speed scales with zoom distance so it feels the same up close and far out.
const keys = new Set();
const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
addEventListener('keydown', (e) => { if (!isTyping(e.target)) keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear()); // don't keep sliding if focus is lost

const panVec = new THREE.Vector3(), fwdVec = new THREE.Vector3();
function keyPan(dt: number): void {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  if (!f && !s) return;
  camera.getWorldDirection(fwdVec);
  fwdVec.z = 0;                                   // travel along the ground
  if (fwdVec.lengthSq() < 1e-6) fwdVec.set(0, 1, 0);
  fwdVec.normalize();
  const speed = camera.position.distanceTo(controls.target) * 0.9
    * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1) * dt;
  // right = forward × up, for a Z-up world
  panVec.set(fwdVec.x * f + fwdVec.y * s, fwdVec.y * f - fwdVec.x * s, 0).normalize().multiplyScalar(speed);
  camera.position.add(panVec);
  controls.target.add(panVec);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  syncTopCamera(); // keep the plan-view frustum matched to the new aspect
});

// --- persisted UI preferences ----------------------------------------------
// The toolbar toggles and sliders are view state, not map data, so they live in
// localStorage and a restart reopens the editor the way it was left. Declared
// ahead of the state below because those globals initialise from it. showObjects
// now defaults ON — the first thing a session usually wants is to see the map's
// objects, and terrain-only work can still flip the toggle off (and it sticks).
interface UiPrefs {
  showObjects: boolean;
  explorerOpen: boolean;
  cliffs: boolean;
  grid: boolean;
  showHidden: boolean;
  texScale: number;
  /** Plan (top-down orthographic) view instead of the 3D orbit view. */
  topView: boolean;
  /** Height the Bulk/Dig brush moves per stroke, and how far it tapers. */
  brushForce: number;
  brushTension: number;
}
const UI_PREFS_DEFAULT: UiPrefs = {
  showObjects: true, explorerOpen: true, cliffs: true, grid: false, showHidden: false, texScale: 0.5,
  topView: false, brushForce: 0.35, brushTension: 1,
};
const UI_PREFS_KEY = 'homm5-editor.ui';
function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    // Spread over the defaults so a prefs blob written by an older build (missing
    // a key added since) still yields a complete object.
    return raw ? { ...UI_PREFS_DEFAULT, ...JSON.parse(raw) } : { ...UI_PREFS_DEFAULT };
  } catch { return { ...UI_PREFS_DEFAULT }; }
}
let uiPrefs = loadUiPrefs();
// Merge one change in and write the whole blob back. Every toggle's setter calls
// this, so the store always mirrors the live UI with no separate save step.
function saveUiPrefs(patch: Partial<UiPrefs>): void {
  uiPrefs = { ...uiPrefs, ...patch };
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs)); }
  catch { /* private mode or quota: the editor still runs, just without persistence */ }
}

// --- world state (rebuilt on each map load) ---
// A map has one or two floors (surface + underground); each is its own terrain
// and object set. We build a group per floor and show one at a time — mixing
// them would dump underground objects onto the surface (wrong heights, chaos).
let world: World | null = null; // { floors:[{ name, V, heights, group, objGroup, meshes:Map<id,mesh> }], active }
let selected: Selection | null = null; // { id, mesh, inst }
let showObjects = uiPrefs.showObjects;
let boxHelper: THREE.BoxHelper | null = null;

const raycaster = new THREE.Raycaster();
const ptr = new THREE.Vector2();

// Only called while a map is loaded; every caller is gated on `world`.
const activeFloor = (): Floor3D => world!.floors[world!.active]!;

/** Ground height at a tile of a given floor. */
function heightOn(fl: Floor3D, x: number, y: number): number {
  const { V, heights } = fl;
  const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
  return heights[iy * V + ix]!;
}

function heightAt(x: number, y: number): number {
  return heightOn(activeFloor(), x, y);
}

/**
 * World centre of a tile. An object's saved position is a CELL index (placement
 * picks the tile with floor(worldX / U)), and a cell spans [x, x+1], so its
 * centre is at (x + 0.5) · U. Rendering the model at x · U instead dropped it on
 * the cell's corner — half a tile off the square it was placed in, sitting on
 * the grid intersection. Kept out of the saved data: the file still stores x.
 */
const tileCenter = (t: number): number => (t + 0.5) * U;

// Height -> RGB (0..1). Below ~1 reads as water; above ramps green -> rocky tan,
// mirroring the reference software render's palette.
function terrainColor(h: number): [number, number, number] {
  if (h < 1) return [0.15, 0.28, 0.34];        // water
  const t = Math.max(0, Math.min(1, (h - 1) / 7));
  return [(70 + t * 70) / 255, (95 + t * 50) / 255, (60 + t * 30) / 255];
}

function clearWorld(): void {
  for (const m of splatMats.splice(0)) {
    m.uniforms.uGround.value?.dispose?.(); m.uniforms.uMask.value?.dispose?.(); m.dispose();
  }
  if (world) for (const fl of world.floors) {
    scene.remove(fl.group);
    // An InstancedMesh owns a GPU buffer of its own beyond the shared geometry;
    // without this it survives every map load.
    for (const b of fl.batches.values()) b.im.dispose();
    fl.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
  world = null; selected = null; updatePanel();
}

// The per-geom geometries and materials, shared across floors.
//
// Module-level rather than local to buildGeos because they outlive the load:
// placing an object from the palette can bring a model the map never used, and
// it is appended here at the index the main process assigned it.
let worldGeos: THREE.BufferGeometry[] = [];
/** One material ARRAY per geom, lined up with that geometry's groups. */
let worldMats: THREE.Material[][] = [];

const texLoader = new THREE.TextureLoader();
const greyMat = new THREE.MeshLambertMaterial({ color: 0x8a8f98, side: THREE.DoubleSide });

/**
 * Materials shared across every part that uses the same texture, so a model
 * naming one material for several meshes uploads it once.
 */
const texCache = new Map<string, THREE.Material>();

/**
 * Material for one submesh: its own texture, blended as its material says.
 *
 * The mode comes from the file's <AlphaMode>, not from inspecting the texels.
 * Guessing from the image said "this has soft edges, so alpha-test it", which
 * is exactly wrong for a decal meant to be blended: the Abandoned Mine's base
 * plate is a nearly black texture at alpha 33/255, and drawn opaque it is the
 * grey slab under the building instead of a soft shadow on the grass.
 */
function materialFor(part: GeomPart): THREE.Material {
  if (!part.tex) return greyMat;
  // Cached per texture AND mode: the same image is used both ways in places.
  // Flatness is in the key because it changes the material: the same texture in
  // the same blend mode is a depth-writing body on one mesh and a decal on
  // another.
  const key = `${part.alphaMode}|${part.projectOnTerrain ? 'proj' : 'own'}|${part.opaque ? 'body' : 'sheer'}|${part.additive ? 'add' : ''}${part.selfIllum ? 'lit' : ''}|${part.tex}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const tx = texLoader.load(part.tex);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.flipY = false;
  // A diffuse texture holds sRGB-encoded colour. Left unmarked, three samples it
  // as linear, so the shader over-brightens every texel and the deep browns wash
  // out to a flat pale grey -- the Garrison wall looked untextured for exactly
  // this reason. Tagging it sRGB makes the sampler decode to linear before
  // lighting, and the render finally shows the wood.
  tx.colorSpace = THREE.SRGBColorSpace;
  // A self-illuminated part (L_SELFILLUM: portal runes, spell auras) emits its
  // own colour, so it uses an unlit material — a Lambert would drop it into
  // shadow the game never shows.
  const m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial = part.selfIllum
    ? new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide });
  switch (part.alphaMode) {
    case 'AM_ALPHA_TEST':
      // Cutout (foliage): discard transparent texels so leaves aren't opaque
      // black cards, without paying for sorted transparency.
      m.alphaTest = 0.5;
      break;
    case 'AM_TRANSPARENT':
    case 'AM_OVERLAY':
    case 'AM_DECAL':
      // Blended. Whether it writes depth turns on whether the texture is a solid
      // skin, not on the blend mode or the mesh shape. A body with an opaque
      // texture (Mountain10x10's rock, 96% opaque) must occlude or it goes
      // see-through and draws its far side over its near one. A sheer overlay
      // (the Abandoned Mine's hill, 11% opaque, projected onto and blended into
      // the terrain) must NOT write depth: its near-invisible pixels would
      // occlude the ground behind it, punching the hole Senya saw where the
      // earth should be. Flatness cannot tell these two apart — both are
      // non-flat AM_OVERLAY.
      m.transparent = true;
      m.depthWrite = part.opaque;
      break;
    case 'AM_OVERLAY_ZWRITE':
      m.transparent = true;
      break;
    default: // AM_OPAQUE
      break;
  }
  // A part that declares ProjectOnTerrain lies ON the ground rather than above
  // it, so it is coplanar with the terrain and z-fights with it. Push it toward
  // the camera in depth only — the geometry does not move.
  if (part.projectOnTerrain) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
    m.depthWrite = false;
  }
  // Additive (AddPlaced): the texels are ADDED to the background, so the part
  // reads as light — a portal's glow, a spell aura. Black adds nothing and
  // bright core adds a lot. It must not write depth, or its own far side would
  // occlude its near one and the glow would tear.
  if (part.additive) {
    m.blending = THREE.AdditiveBlending;
    m.transparent = true;
    m.depthWrite = false;
  }
  texCache.set(key, m);
  return m;
}

/** Geometry for one decoded model, with a group per submesh. */
function geometryFor(g: GeomData): THREE.BufferGeometry {
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  if (g.uv) b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uv), 2));
  b.setIndex(g.idx);
  // A group per submesh, indexed into the material array. Drawn as one group
  // instead, every mesh of a building took whichever texture came first.
  g.parts.forEach((p, i) => b.addGroup(p.start, p.count, i));
  // Prefer the authored normals; computing them averages across every face at a
  // vertex and softens the hard edges that give a model its shape.
  if (g.nrm) b.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nrm), 3));
  else b.computeVertexNormals();
  return b;
}

// --- instanced drawing ------------------------------------------------------
//
// A map draws the same few models over and over: 2258 placed objects on one
// shipped map resolve to 120 distinct models, the commonest of which appears
// 363 times. Drawn one mesh each that is 2729 draw calls, which is what made
// the view stutter. Batched by model it is 229.
//
// Merging submeshes that share a material was measured first and is not worth
// doing on its own: it takes 2729 to 2630.
//
// Each object keeps a THREE.Mesh as its handle, but that mesh is NOT added to
// the scene — it exists to be picked, dragged and boxed, and the drawing is
// done by the InstancedMesh. The raycaster is handed the handles explicitly, so
// it still finds them; their world matrices just have to be kept current.

/** Every copy of one model on one floor, drawn in a single call. */
interface GeomBatch {
  im: THREE.InstancedMesh;
  /** Slot in the instance buffer for each object. */
  slot: Map<Instance, number>;
  /** What occupies each slot, so a removed one can be back-filled. */
  at: (Instance | null)[];
}

/** Spare slots kept so placing a few objects does not reallocate every time. */
const BATCH_HEADROOM = 8;

/** Write an object's transform into its slot of the instance buffer. */
function syncInstance(fl: Floor3D, inst: Instance): void {
  const batch = fl.batches.get(inst.g);
  const mesh = inst.id === null ? null : fl.meshes.get(inst.id);
  if (!batch || !mesh) return;
  const slot = batch.slot.get(inst);
  if (slot === undefined) return;
  mesh.updateMatrixWorld();
  batch.im.setMatrixAt(slot, mesh.matrixWorld);
  batch.im.instanceMatrix.needsUpdate = true;
}

/**
 * Free an object's slot.
 *
 * The last live instance is moved into the freed slot and the count drops by
 * one, so the buffer stays packed. Instances are unordered, so moving one costs
 * nothing; leaving a hole would mean either drawing a stale copy or carrying a
 * free list for no benefit.
 */
function removeFromBatch(fl: Floor3D, inst: Instance): void {
  const batch = fl.batches.get(inst.g);
  if (!batch) return;
  const slot = batch.slot.get(inst);
  if (slot === undefined) return;
  const last = batch.im.count - 1;
  if (slot !== last) {
    const moved = batch.at[last];
    const m = new THREE.Matrix4();
    batch.im.getMatrixAt(last, m);
    batch.im.setMatrixAt(slot, m);
    batch.at[slot] = moved ?? null;
    if (moved) batch.slot.set(moved, slot);
  }
  batch.at[last] = null;
  batch.slot.delete(inst);
  batch.im.count = last;
  batch.im.instanceMatrix.needsUpdate = true;
}

/**
 * Give a newly placed object a slot, growing the batch when it is full.
 *
 * A batch that has to grow is rebuilt at double capacity rather than one bigger,
 * so placing a run of the same object does not reallocate on every click.
 */
function addToBatch(fl: Floor3D, inst: Instance, mesh: THREE.Mesh): void {
  let batch = fl.batches.get(inst.g);
  const geo = worldGeos[inst.g], mat = worldMats[inst.g];
  if (!geo || !mat) return;
  if (!batch) {
    const im = new THREE.InstancedMesh(geo, mat, 1 + BATCH_HEADROOM);
    im.count = 0;
    im.frustumCulled = false;
    batch = { im, slot: new Map(), at: [] };
    fl.objGroup.add(im);
    fl.batches.set(inst.g, batch);
  }
  if (batch.im.count >= batch.im.instanceMatrix.count) {
    const bigger = new THREE.InstancedMesh(geo, mat, Math.max(4, batch.im.count * 2));
    const m = new THREE.Matrix4();
    for (let i = 0; i < batch.im.count; i++) { batch.im.getMatrixAt(i, m); bigger.setMatrixAt(i, m); }
    bigger.count = batch.im.count;
    bigger.frustumCulled = false;
    fl.objGroup.remove(batch.im);
    batch.im.dispose();
    fl.objGroup.add(bigger);
    batch.im = bigger;
  }
  const slot = batch.im.count;
  mesh.updateMatrixWorld();
  batch.im.setMatrixAt(slot, mesh.matrixWorld);
  batch.slot.set(inst, slot);
  batch.at[slot] = inst;
  batch.im.count = slot + 1;
  batch.im.instanceMatrix.needsUpdate = true;
}

/** Group a floor's objects by model and draw each group in one call. */
function buildBatches(
  instances: Instance[],
  meshes: Map<string, THREE.Mesh>,
  geos: THREE.BufferGeometry[],
  mats: THREE.Material[][],
  objGroup: THREE.Group,
): Map<number, GeomBatch> {
  const byGeom = new Map<number, Instance[]>();
  for (const it of instances) {
    const list = byGeom.get(it.g);
    if (list) list.push(it); else byGeom.set(it.g, [it]);
  }
  const batches = new Map<number, GeomBatch>();
  for (const [g, list] of byGeom) {
    const geo = geos[g], mat = mats[g];
    if (!geo || !mat) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length + BATCH_HEADROOM);
    im.count = list.length;
    // Objects sit where the map puts them, which is nowhere near the origin the
    // shared geometry is centred on, so let three.js work the bounds out.
    im.frustumCulled = false;
    const batch: GeomBatch = { im, slot: new Map(), at: [] };
    list.forEach((it, i) => {
      batch.slot.set(it, i);
      batch.at[i] = it;
      const mesh = it.id === null ? null : meshes.get(it.id);
      if (mesh) im.setMatrixAt(i, mesh.matrixWorld);
    });
    im.instanceMatrix.needsUpdate = true;
    objGroup.add(im);
    batches.set(g, batch);
  }
  return batches;
}

/**
 * Replace a floor's objects wholesale.
 *
 * Undo re-parses the map, so the instances that come back are a fresh list
 * rather than the ones already on screen. Reconciling them by id would mean
 * three cases (gone, new, moved) and a bug in any of them leaves the view
 * disagreeing with the model — the one thing undo must never do. Rebuilding is
 * a handful of milliseconds and cannot drift.
 */
function replaceInstances(fl: Floor3D, instances: Instance[]): void {
  for (const b of fl.batches.values()) { fl.objGroup.remove(b.im); b.im.dispose(); }
  fl.batches.clear();
  fl.meshes.clear();
  fl.instances = instances;
  for (const it of instances) {
    if (it.id === null) continue;
    const geo = worldGeos[it.g], mat = worldMats[it.g];
    if (!geo || !mat) continue;
    // The map stores no height, so an object lands on whatever ground is under
    // it — the same rule object:add follows.
    it.z = heightOn(fl, it.x, it.y);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(tileCenter(it.x), tileCenter(it.y), it.z);
    m.rotation.z = it.r;
    m.userData.inst = it;
    m.updateMatrixWorld();
    fl.meshes.set(it.id, m);
  }
  const batches = buildBatches(instances, fl.meshes, worldGeos, worldMats, fl.objGroup);
  for (const [g, b] of batches) fl.batches.set(g, b);
  syncFootprints(fl);
}

// Build the shared per-geom geometries + materials (reused across floors).
function buildGeos(S: Scene) {
  const geos = S.geoms.map(geometryFor);
  const mats = S.geoms.map((g) => g.parts.map(materialFor));
  geomParts.clear();
  geomFootprint.clear();
  S.geoms.forEach((g, i) => { geomParts.set(i, g.parts); geomFootprint.set(i, g.footprint ?? null); });
  worldGeos = geos;
  worldMats = mats;
  return { geos, mats };
}

// --- terrain splat shader --------------------------------------------------
// The ground is N tile textures blended by per-vertex weight masks. Baking that
// into one atlas would need ~500 texels per tile to stay sharp, so instead we
// blend live: each texture tiles across the map at `uScale` repeats per tile,
// weighted by its mask. Both texture sets are 2D array textures (WebGL2), which
// keeps it to two samplers no matter how many layers a map uses.
const SPLAT_VERT = `
out vec2 vGrid;   // 0..1 across the map -> mask lookup
out vec2 vWorld;  // tile coords -> tiled ground lookup
out vec3 vNrm;    // world-space normal (lighting must not swim with the camera)
out vec3 vPos;    // world position -> vertical projection for cliff faces
void main() {
  vGrid = uv;
  vWorld = position.xy;
  vPos = (modelMatrix * vec4(position, 1.0)).xyz;
  // The terrain mesh is built in grid space and stretched to the real tile
  // spacing in X and Y only, so its model matrix is non-uniform. Normals do not
  // survive that: scaling a surface wider without scaling its normals leaves
  // every slope reading as steep as it was before the stretch, which is the
  // whole artefact this scaling exists to remove. The inverse transpose is the
  // transform that gets it right, and it costs one 3x3 inverse per vertex.
  vNrm = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const splatFrag = (groups: number, layers: number): string => `
precision highp sampler2DArray;
uniform sampler2DArray uGround;
uniform sampler2DArray uMask;
uniform sampler2D uRock;
uniform float uScale;
uniform float uRockScale;
uniform float uCliff;   // 0 disables the rock blend entirely
in vec2 vGrid; in vec2 vWorld; in vec3 vNrm; in vec3 vPos;
out vec4 outColor;
void main() {
  // Layers arrive sorted by the tiles' <Priority>, so compositing them in order
  // paints high-priority tiles (roads, rocks) over low ones (grass, dirt). An
  // averaged blend would instead dilute each layer against the base.
  vec3 col = vec3(0.30, 0.33, 0.24);
  for (int g = 0; g < ${groups}; g++) {
    vec3 m = texture(uMask, vec3(vGrid, float(g))).rgb;
    for (int c = 0; c < 3; c++) {
      int li = g * 3 + c;
      if (li >= ${layers}) break;
      float w = m[c];
      if (w <= 0.002) continue;
      col = mix(col, texture(uGround, vec3(vWorld * uScale, float(li))).rgb, w);
    }
  }
  // Cliff faces. The ground layers are projected straight down, so on a near
  // vertical drop they smear into streaks. Steep faces instead take the rock
  // texture, projected sideways (blended between the X and Y walls) so it keeps
  // its scale down the face.
  // Thresholds matter at the shoreline: land sits at 2.0, the beach ring at 1.6
  // and the bed at 0, so the cut into water falls about 58° (steep ~0.47). The
  // old 0.35-0.68 ramp only mixed in a quarter of the rock there and the edge
  // still read as grass poured over the side, which is exactly what it looked
  // like. Starting at 0.18 makes a 58° face solid rock while leaving anything
  // gentler than ~25° untouched.
  vec3 n = normalize(vNrm);
  float steep = 1.0 - clamp(n.z, 0.0, 1.0);
  float cliff = uCliff * smoothstep(0.18, 0.45, steep);
  if (cliff > 0.001) {
    float wx = abs(n.x), wy = abs(n.y);
    // uScale counts repeats per TILE and vPos is in world units, so the rock
    // needs the world-unit rate or it would stretch along the face.
    vec3 rx = texture(uRock, vec2(vPos.y, vPos.z) * uRockScale).rgb;
    vec3 ry = texture(uRock, vec2(vPos.x, vPos.z) * uRockScale).rgb;
    // The rock texture averages 26% grey, so at minimum light a cut face landed
    // near rgb 35 — solid black against lit grass. Brightened, and mixed at 0.85
    // so the surrounding ground's hue still tints the face (brown by dirt, pale
    // by stone) instead of a flat grey band.
    vec3 rock = mix(ry, rx, wx / (wx + wy + 1e-4)) * 1.7;
    col = mix(col, rock, cliff * 0.85);
  }

  // abs(), not max(): the terrain is DoubleSide and a generated wall normal may
  // point into the cliff, which would otherwise pin the face at ambient.
  float d = abs(dot(n, normalize(vec3(0.45, 0.35, 0.82))));
  outColor = vec4(col * (0.62 + 0.5 * d), 1.0);
}`;

const loadImg = (src: string): Promise<HTMLImageElement> => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = src;
});

// Stack same-sized images into one DataArrayTexture via a canvas read-back.
async function arrayTexture(uris: string[], size: number): Promise<THREE.DataArrayTexture> {
  const data = new Uint8Array(uris.length * size * size * 4);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (!cx) throw new Error('no 2d canvas context');
  for (let i = 0; i < uris.length; i++) {
    const img = await loadImg(uris[i]!);
    cx.clearRect(0, 0, size, size);
    cx.drawImage(img, 0, 0, size, size);
    data.set(cx.getImageData(0, 0, size, size).data, i * size * size * 4);
  }
  const tex = new THREE.DataArrayTexture(data, size, size, uris.length);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
}

let texScale = uiPrefs.texScale;   // ground-texture repeats per map tile (tunable in the toolbar)
let cliffAmount = uiPrefs.cliffs ? 1 : 0;  // how strongly steep faces take the rock texture
const splatMats: THREE.ShaderMaterial[] = [];

// --- terrain-projected parts ------------------------------------------------
//
// A part flagged `terrainProjected` (in scene.ts: <ProjectOnTerrain> AND a sheer
// texture) takes the ground it stands on as its surface. The Abandoned Mine's
// mound is the case: on grass the engine draws a grassy hump, the model
// supplying only the dark ore patch, so the green has to come from the terrain
// underneath — which is what Senya saw in the original editor, the map's texture
// climbing the hill.
//
// So these parts are shaded with the SAME splat the ground uses, sampled at
// their own world position, with their own texture laid on top as a darkening.
// The sheer gate is load-bearing: this was tried once on EVERY <ProjectOnTerrain>
// part and smeared a column of ground texels up Mountain10x10's cliffs, because
// that mountain is a 96%-opaque proj body, not a decal. Opacity is what tells
// the mound (11%) from the mountain (96%).

const PROJ_VERT = `
out vec2 vGrid;   // 0..1 across the map -> mask lookup
out vec2 vWorld;  // tile coords -> tiled ground lookup
out vec2 vUv;     // the part's own uv, for its darkening texture
out vec3 vNrm;
uniform float uMapSide;   // V - 1
uniform float uUnits;     // world units per tile
void main() {
  // The mesh is batched, so the position has to come through the instance
  // matrix exactly as the instanced draw sees it.
  #ifdef USE_INSTANCING
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  #else
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNrm = normalize(mat3(modelMatrix) * normal);
  #endif
  // Objects live in world units; the splat composites in grid coords, so convert
  // once here and the ground lines up with the terrain seamlessly.
  vec2 grid = world.xy / uUnits;
  vGrid = grid / uMapSide;
  vWorld = grid;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const projFrag = (groups: number, layers: number): string => `
precision highp sampler2DArray;
uniform sampler2DArray uGround;
uniform sampler2DArray uMask;
uniform sampler2D uOverlay;
uniform float uScale;
uniform float uHasOverlay;
in vec2 vGrid; in vec2 vWorld; in vec2 vUv; in vec3 vNrm;
out vec4 outColor;
void main() {
  // Composited exactly as the ground is, so the seam between a projected part
  // and the terrain around it is invisible.
  vec3 col = vec3(0.30, 0.33, 0.24);
  for (int g = 0; g < ${groups}; g++) {
    vec3 m = texture(uMask, vec3(vGrid, float(g))).rgb;
    for (int c = 0; c < 3; c++) {
      int li = g * 3 + c;
      if (li >= ${layers}) break;
      float w = m[c];
      if (w <= 0.002) continue;
      col = mix(col, texture(uGround, vec3(vWorld * uScale, float(li))).rgb, w);
    }
  }
  // The model's own texture darkens the ground rather than replacing it: for the
  // mound it is a near-black ore patch at low alpha, which is all it contributes.
  if (uHasOverlay > 0.5) {
    vec4 o = texture(uOverlay, vUv);
    col *= mix(vec3(1.0), o.rgb, o.a);
  }
  // A little shading so the hump reads as one. The terrain itself is unlit, so
  // this stays gentle or the part would stand out against the flat ground.
  float lit = 0.82 + 0.18 * clamp(normalize(vNrm).z, 0.0, 1.0);
  outColor = vec4(col * lit, 1.0);
}`;

/**
 * Give every terrain-projected part of this floor a material that samples the
 * floor's ground. Runs after the splat exists, since it borrows its textures —
 * and its uniform objects by reference, so the ground-scale slider reaches these
 * materials through the same uScale it writes on the terrain.
 */
function applyProjectedMaterials(fl: Floor3D): void {
  for (const g of fl.batches.keys()) projectBatch(fl, g);
}

/**
 * Give one batch's terrain-projected parts their ground-sampling material.
 * Split out from applyProjectedMaterials so a freshly placed object gets the
 * same treatment a loaded one does — otherwise a mine dropped from the palette
 * kept the transparent overlay and its earth hood vanished.
 */
function projectBatch(fl: Floor3D, g: number): void {
  const s = fl.splat;
  const splatMat = fl.terrainMesh.material as THREE.ShaderMaterial;
  if (!s || !splatMat?.uniforms?.uGround) return;
  const parts = geomParts.get(g);
  const batch = fl.batches.get(g);
  if (!parts || !batch) return;
  const mats = batch.im.material;
  const list = Array.isArray(mats) ? mats : [mats];
  let changed = false;
  parts.forEach((p, i) => {
    if (!p.terrainProjected) return;
    // Already projected (re-run on add, or an add-layer rebuild): leave it.
    if ((list[i] as THREE.ShaderMaterial)?.uniforms?.uUnits) return;
    const overlay = p.tex ? texLoader.load(p.tex) : null;
    if (overlay) { overlay.wrapS = overlay.wrapT = THREE.RepeatWrapping; overlay.flipY = false; }
    list[i] = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PROJ_VERT,
      fragmentShader: projFrag(s.maskGroups.length, s.layerCount),
      uniforms: {
        uGround: splatMat.uniforms.uGround!,
        uMask: splatMat.uniforms.uMask!,
        uScale: splatMat.uniforms.uScale!,
        uOverlay: { value: overlay },
        uHasOverlay: { value: overlay ? 1 : 0 },
        uMapSide: { value: s.V - 1 },
        uUnits: { value: U },
      },
      side: THREE.DoubleSide,
      // The mound IS the ground, and the building's entrance and floor sit ON
      // it: where they are coplanar the two flickered green/dark as the camera
      // moved. Push the ground surface back in depth so the solid parts on top
      // of it always win — same trick the flat ProjectOnTerrain decals use.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    changed = true;
  });
  if (changed) batch.im.material = list;
}

/** Submesh descriptions per geom index, so materials can be rebuilt later. */
const geomParts = new Map<number, GeomPart[]>();

/** Building tile footprint per geom index (null for objects that declare none). */
const geomFootprint = new Map<number, Footprint | null>();

// Swap a floor's flat-colour terrain material for the textured splat one.
async function upgradeToSplat(fl: Floor3D): Promise<void> {
  const s = fl.splat;
  if (!s || !s.layerCount) return;
  // [perf] Ground textures decode off the critical path but still upload on the
  // GPU thread; timed so a slow splat shows up next to the other phase logs.
  const tSplat = performance.now();
  const [ground, masks] = await Promise.all([
    arrayTexture(s.layerTex, s.size),
    arrayTexture(s.maskGroups, s.V),
  ]);
  ground.wrapS = ground.wrapT = THREE.RepeatWrapping;
  ground.magFilter = THREE.LinearFilter;
  ground.minFilter = THREE.LinearMipmapLinearFilter;
  ground.generateMipmaps = true;
  ground.anisotropy = renderer.capabilities.getMaxAnisotropy();
  masks.wrapS = masks.wrapT = THREE.ClampToEdgeWrapping;
  masks.magFilter = masks.minFilter = THREE.LinearFilter;
  ground.needsUpdate = masks.needsUpdate = true;

  let rock = null;
  if (s.rockTex) {
    rock = await new THREE.TextureLoader().loadAsync(s.rockTex);
    rock.wrapS = rock.wrapT = THREE.RepeatWrapping;
    rock.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // Deliberately NOT sRGB-tagged. Tagging it makes the GPU decode to linear on
    // sample, and this shader is custom so nothing encodes back — Rock.dds's
    // 0.255 grey became 0.053 and cut faces rendered at rgb 19 instead of 94.
    // That was the "black cliffs": the standalone viewer never set the flag,
    // which is why its cuts looked right while the editor's didn't. The ground
    // array textures aren't tagged either, so this keeps the whole splat
    // consistent in one space.
  }

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SPLAT_VERT,
    fragmentShader: splatFrag(s.maskGroups.length, s.layerCount),
    uniforms: {
      uGround: { value: ground }, uMask: { value: masks },
      uRock: { value: rock }, uCliff: { value: rock ? cliffAmount : 0 },
      uScale: { value: texScale },
      uRockScale: { value: texScale / U },
    },
    side: THREE.DoubleSide,
  });
  fl.maskTex = masks; // the brush writes into this and flips needsUpdate
  const old = fl.terrainMesh.material;
  fl.terrainMesh.material = mat;
  for (const m of Array.isArray(old) ? old : [old]) {
    // Adding a layer re-runs this on a floor that already had a splat, so the
    // retired material has to leave the list too — the ground-scale slider
    // walks it and would be writing uniforms into a disposed material.
    const at = splatMats.indexOf(m as THREE.ShaderMaterial);
    if (at >= 0) splatMats.splice(at, 1);
    m.dispose();
  }
  splatMats.push(mat);
  // Parts that take their colour from the ground can only be built now: they
  // borrow this material's textures.
  applyProjectedMaterials(fl);
  console.log(`[perf] splat ${fl.name} ${(performance.now() - tSplat) | 0}ms · ${s.layerCount} layers @ ${s.size}px`);
}

// Build one floor: its coloured terrain heightmap + its placed object meshes.
/**
 * Build a floor's terrain geometry from its height and flag planes.
 *
 * Split out of buildFloor because the height brush has to rebuild it: sculpting
 * moves vertices AND can flip a vertex between water and ground, which changes
 * where cells are cut. Re-running the whole thing is far simpler than patching
 * the affected cells in place, and on a 137x137 map it costs a few ms -- cheap
 * enough to do once per brush tick.
 */
/** Cells (by their lower-left vertex) that touch a water-flagged vertex. */
function waterCells(V: number, flags: number[] | null): number[] {
  if (!flags) return [];
  const cells: number[] = [];
  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    const a = y * V + x;
    // Cover every cell touching water and let the terrain occlude the sheet:
    // the bed sits at 0 and the shore climbs to 2.0, so a flat sheet is cut
    // exactly where the beach crosses it -- a real waterline for free.
    if (!flags[a] || !flags[a + 1] || !flags[a + V] || !flags[a + V + 1]) cells.push(a);
  }
  return cells;
}

/** The flat sea sheet over those cells. Rebuilt whenever sculpting floods or drains one. */
function waterGeometry(V: number, cells: number[], level: number): THREE.BufferGeometry {
  const wpos: number[] = [], wuv: number[] = [], widx: number[] = [];
  const vmap = new Map<number, number>();
  const vert = (i: number): number => {
    let v = vmap.get(i);
    if (v === undefined) {
      v = wpos.length / 3;
      const x = i % V, y = (i / V) | 0;
      wpos.push(x, y, level);
      wuv.push(x / 8, y / 8); // gentle tiling; the sheet is mostly flat colour
      vmap.set(i, v);
    }
    return v;
  };
  for (const a of cells) {
    const A = vert(a), B = vert(a + 1), C = vert(a + V), D = vert(a + V + 1);
    widx.push(A, B, C, B, D, C);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wpos), 3));
  wg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(wuv), 2));
  wg.setIndex(widx);
  wg.computeVertexNormals();
  return wg;
}

/**
 * The sea sheet over `cells`, with its own material.
 *
 * Built here rather than inline in buildFloor because sculpting can raise a sea
 * on a map that started dry -- lowering ground to 0 floods it -- and that needs
 * the same mesh, texture and all, without a reload.
 */
function makeWaterMesh(V: number, cells: number[], level: number, tex: string | null): THREE.Mesh {
  const wg = waterGeometry(V, cells, level);
  // The sea wears its own sheet -- dark by design. Rivers are a different thing
  // entirely: painted tiles using the blue _TNL brush textures.
  const wmat = new THREE.MeshPhongMaterial({
    color: 0xffffff, transparent: true, opacity: 0.88,
    shininess: 90, specular: 0x5f7f95, side: THREE.DoubleSide, depthWrite: false,
  });
  if (tex) {
    const wt = new THREE.TextureLoader().load(tex);
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    wt.colorSpace = THREE.SRGBColorSpace; // diffuse sheet: decode sRGB, see above
    wmat.map = wt;
  } else {
    wmat.color.setHex(0x0a2b2e); // fall back to the sheet's own dark tone
  }
  const mesh = asTileSpace(new THREE.Mesh(wg, wmat));
  mesh.renderOrder = WATER_ORDER;
  return mesh;
}

function terrainGeometry(
  V: number, heights: number[], flags: number[] | null, colors: number[] | null,
): THREE.BufferGeometry {
  const tg = new THREE.BufferGeometry();
  const tp = new Float32Array(V * V * 3);
  const tc = new Float32Array(V * V * 3);
  // Half-texel offset: vertex (x,y) must land on mask texel (x,y)'s CENTRE, or
  // the splat weights drift half a tile against the heightmap.
  const tuv = new Float32Array(V * V * 2);
  // Prefer the real ground colours (blended tile textures incl. roads); fall
  // back to height-based colouring only when no texture layers resolved.
  const gc = colors;
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
    const i = y * V + x, o = i * 3, h = heights[i];
    tp[o] = x; tp[o + 1] = y; tp[o + 2] = h;
    tuv[i * 2] = (x + 0.5) / V; tuv[i * 2 + 1] = (y + 0.5) / V;
    if (gc) { tc[o] = gc[o]; tc[o + 1] = gc[o + 1]; tc[o + 2] = gc[o + 2]; }
    else { const [r, g, b] = terrainColor(h); tc[o] = r; tc[o + 1] = g; tc[o + 2] = b; }
  }
  // --- cliff-aware meshing -------------------------------------------------
  // The ground is built from flat steps, not a smooth field: 92.5% of map 12's
  // cells have all four corners at the same height (68.8% on A1M5). The cells
  // that don't are transitions, and there are two kinds. A RAMP (flag bit 3) is
  // a deliberate walkable incline — a whole cell the height slides down. Every
  // other big step is a CUT, and interpolating it across the cell turns a sheer
  // edge into a diagonal slide, which is why shorelines looked like grass
  // poured over the side.
  //
  // So cut cells are split marching-squares style: the corners snap to the
  // cell's high or low level, the boundary runs through the midpoints of the
  // two edges that straddle it, each side is laid flat, and a vertical quad
  // joins them. Diagonal (checkerboard) cases are ambiguous, so those fall back
  // to the smooth quad.
  // A cut is a change of GROUND KIND, not merely a steep spot. Height alone is
  // the wrong signal: raise a hill and smooth it and its slopes get as steep as
  // a cliff, yet it stays smooth ground. What actually marks an edge is the flag
  // plane — and it is emphatic about it. Every single cell straddling a kind
  // boundary carries a step of 0.8 or more: 200 of 200 on map 12, 216 of 216 on
  // A1M5, 16 of 16 on A2C2M3. Meanwhile cells wholly inside one kind reach 12.4
  // of relief on A2C2M3 while still being smooth hillside.
  //
  // So: any change of tier is cut — water to land, ground to plateau, plateau to
  // the plateau stacked on it — while anything within one tier is smooth however
  // steep. Ramps (bit 3) sit half a tier up and stay smooth across the boundary,
  // which is what makes them walkable.
  const fl = flags;
  // The flag is the tier number times 16 (plus 8 for a ramp), so a cut forms
  // wherever the TIER changes — 0 water, 1 ground, 2+ stacked plateaus, each
  // 2.0 above the last. Lumping everything above ground into one "plateau" kind
  // smoothed away the edge between a plateau and the plateau raised on top of
  // it, which is a wall in the game.
  const tierOf = (i: number): number => fl![i]! >> 4;
  const isRamp = (i: number): boolean => (fl![i]! & 8) !== 0;
  const MIN_STEP = 0.1; // a boundary with no real drop isn't worth a wall

  const ti: number[] = [];
  // Which tile each triangle belongs to, so an overlay can follow the ground
  // exactly instead of laying flat quads over it. Cut cells are split into
  // several triangles at odd angles, and a quad drawn across one floats over
  // the hole or pokes through the cliff.
  const triTile: number[] = [];
  let cell = 0;
  /** Push triangles for the current cell, recording which cell they came from. */
  const emit = (...idx: number[]): void => {
    for (let i = 0; i < idx.length; i += 3) triTile.push(cell);
    ti.push(...idx);
  };
  const extra: number[] = [];          // [x, y, z] triples appended after the grid vertices
  const addV = (x: number, y: number, z: number): number => {
    extra.push(x, y, z);
    return V * V + extra.length / 3 - 1;
  };

  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    cell = y * (V - 1) + x;
    // corner indices, counter-clockwise from (x,y)
    const ci = [y * V + x, y * V + x + 1, (y + 1) * V + x + 1, (y + 1) * V + x];
    const h = ci.map((i) => heights[i]);
    const smooth = () => { const [a, b, c, d] = [ci[0], ci[1], ci[3], ci[2]]; emit(a, b, c, b, d, c); };
    if (!fl) { smooth(); continue; }
    if (ci.some(isRamp)) { smooth(); continue; }

    const k0 = tierOf(ci[0]);
    if (ci.every((i) => tierOf(i) === k0)) { smooth(); continue; } // all one tier
    if (Math.max(...h) - Math.min(...h) < MIN_STEP) { smooth(); continue; }

    // The boundary is authoritative; heights only say which side is up.
    const level = (Math.max(...h) + Math.min(...h)) / 2;
    const up = h.map((v) => v > level);
    const nUp = up.filter(Boolean).length;
    if (nUp === 0 || nUp === 4) { smooth(); continue; }
    // Checkerboard: two crossings on each diagonal, no single boundary line.
    if ((up[0] === up[2]) && (up[1] === up[3])) { smooth(); continue; }

    // Ring of the cell boundary: corner, edge-midpoint, corner, ... (CCW).
    // A cut is NOT level. A plateau dropped onto uneven ground inherits that
    // unevenness, so the edge flows with it — raise one side and the cut rises
    // with it. Flattening each side to a single height was what produced the
    // rectangular tabs along the rim. So corners keep their OWN heights (and
    // their existing grid vertices, which also welds the cell to its smooth
    // neighbours), and each break point carries two: the upper surface's height
    // and the lower one's, taken from the corners that edge spans.
    const cxy = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const ring: RingPoint[] = [];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      ring.push({ cut: false, up: up[k], gi: ci[k] });
      if (up[k] !== up[n]) {
        ring.push({
          cut: true,
          xy: [(cxy[k][0] + cxy[n][0]) / 2, (cxy[k][1] + cxy[n][1]) / 2],
          hz: up[k] ? h[k] : h[n],   // where the upper surface meets the break
          lz: up[k] ? h[n] : h[k],   // where the lower one does
        });
      }
    }
    const cuts = ring.filter((p): p is RingCut => p.cut);
    if (cuts.length !== 2) { smooth(); continue; }

    // Walk the ring from one cut to the other: one arc is the high side, the
    // other the low side.
    const start = ring.findIndex((p) => p.cut);
    const arcs: RingPoint[][] = [[], []];
    let side = 0;
    for (let k = 0; k <= ring.length; k++) {
      const p = ring[(start + k) % ring.length]!;
      arcs[side]!.push(p);
      if (p.cut && k > 0 && k < ring.length) { side = 1; arcs[1]!.push(p); }
    }
    const cutHi = cuts.map((p) => addV(p.xy[0], p.xy[1], p.hz));
    const cutLo = cuts.map((p) => addV(p.xy[0], p.xy[1], p.lz));

    for (const arc of arcs) {
      const corners = arc.filter((p): p is RingCorner => !p.cut);
      if (!corners.length) continue;
      const top = corners[0].up;
      const ends = [arc[0], arc[arc.length - 1]] as [RingCut, RingCut];
      const edge = (p: RingCut) => (top ? cutHi : cutLo)[cuts.indexOf(p)];
      const poly = [edge(ends[0]), ...corners.map((p) => p.gi), edge(ends[1])];
      for (let k = 1; k < poly.length - 1; k++) emit(poly[0], poly[k], poly[k + 1]);
    }
    // The wall, both faces (material is DoubleSide anyway).
    emit(cutHi[0], cutHi[1], cutLo[0], cutHi[1], cutLo[1], cutLo[0]);
  }
  // Cut cells contributed vertices beyond the regular grid; append them, taking
  // uv from their position and colour from the grid vertex they sit nearest.
  const nExtra = extra.length / 3;
  const pos = new Float32Array((V * V + nExtra) * 3);
  const col = new Float32Array((V * V + nExtra) * 3);
  const uvs = new Float32Array((V * V + nExtra) * 2);
  pos.set(tp); col.set(tc); uvs.set(tuv);
  for (let k = 0; k < nExtra; k++) {
    const x = extra[k * 3], y = extra[k * 3 + 1], z = extra[k * 3 + 2];
    const o = (V * V + k) * 3, u = (V * V + k) * 2;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    uvs[u] = (x + 0.5) / V; uvs[u + 1] = (y + 0.5) / V;
    const gi = (Math.min(V - 1, Math.round(y)) * V + Math.min(V - 1, Math.round(x))) * 3;
    col[o] = tc[gi]; col[o + 1] = tc[gi + 1]; col[o + 2] = tc[gi + 2];
  }

  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  tg.setIndex(ti); tg.computeVertexNormals();
  tg.userData.triTile = new Int32Array(triTile);
  return tg;
}

/**
 * Mark a mesh as built from GRID indices rather than world coordinates.
 *
 * The scene is handed over exactly as the files store it: terrain heights and
 * model geometry in world units, terrain and object positions as tile indices.
 * The renderer's world is the game's world, so anything laid out by walking the
 * grid — the ground, the sea, the passability overlays, the brush cursor — is
 * stretched to the real tile spacing here instead of every loop that builds one
 * multiplying as it goes. Z is untouched: heights are already world units.
 *
 * Doing it with a transform rather than at the vertex writes also keeps those
 * buffers in grid space, which the cut-cell meshing and the per-triangle tile
 * map both rely on.
 */
function asTileSpace<T extends THREE.Object3D>(o: T): T {
  o.scale.set(U, U, 1);
  return o;
}

function buildFloor(floor: Floor, geos: THREE.BufferGeometry[], mats: THREE.Material[][]): Floor3D {
  const group = new THREE.Group();
  const V = floor.V, heights = floor.heights;

  const tg = terrainGeometry(V, heights, floor.flags, floor.colors);
  // Start on the flat MinimapColor blend; the textured splat material replaces
  // it as soon as its textures finish decoding (see upgradeToSplat).
  const terrainMesh = asTileSpace(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  group.add(terrainMesh);
  let waterMesh = null;

  // Water surface: a flat sheet over each dug basin at that body's own level.
  // The basin floor is often below it, so without this the map shows a dry pit
  // and anything sitting at water level looks like it hovers.
  // Sea: one flat sheet at sea level over every cell touching a water-flagged
  // vertex. The bed is dug to 0 and the shore climbs to 2.0, so the terrain
  // itself clips the sheet and produces the waterline — no feathering needed.
  const wat = floor.water;
  if (wat && wat.cells.length) {
    waterMesh = makeWaterMesh(V, wat.cells, wat.level, wat.tex);
    group.add(waterMesh);
  }

  // Objects live in their own subgroup so they can be hidden wholesale while
  // working on the terrain (which they otherwise cover almost completely).
  const objGroup = new THREE.Group();
  objGroup.visible = showObjects;
  group.add(objGroup);

  const meshes = new Map();
  for (const it of floor.instances) {
    const m = new THREE.Mesh(geos[it.g], mats[it.g]);
    // Tile index out to where the tile actually is; z is already a world height.
    m.position.set(tileCenter(it.x), tileCenter(it.y), it.z);
    m.rotation.z = it.r;
    m.userData.inst = it;
    // NOT added to the scene: this mesh is the pick-and-edit handle, and the
    // drawing is done by the instanced meshes below. Its world matrix still has
    // to be current, because the raycaster and the selection box read it.
    m.updateMatrixWorld();
    meshes.set(it.id, m);
  }
  const batches = buildBatches(floor.instances, meshes, geos, mats, objGroup);
  return {
    name: floor.name, V, heights, flags: floor.flags, colors: floor.colors,
    // A river already in the map is at full depth: never dig it again.
    riverDrop: new Map(floor.riverVerts.map((v) => [v, RIVER_DEPTH])),
    passable: floor.passable, river: new Set(floor.riverVerts), passMeshes: [], footMeshes: [],
    group, objGroup, meshes, batches, terrainMesh, waterMesh, waterTex: floor.water?.tex ?? null,
    splat: floor.splat, maskTex: null, instances: floor.instances,
  };
}

function buildWorld(S: Scene): void {
  clearWorld();
  const { geos, mats } = buildGeos(S);
  const floors = S.floors.map((f) => buildFloor(f, geos, mats));
  for (const fl of floors) scene.add(fl.group);
  world = { floors, active: 0 };
  setActiveFloor(0); // frames the floor + builds its explorer list
  updateFloorUI();
  // Textured ground arrives asynchronously; the flat blend shows meanwhile.
  for (const fl of floors) {
    upgradeToSplat(fl).catch((e: unknown) => {
      console.error('splat failed', fl.name, e);
      $('hud').textContent = 'ground textures: ' + (e instanceof Error ? e.message : String(e));
    });
  }
}

// Switch which floor is shown; only its group is visible and pickable.
function setActiveFloor(i: number): void {
  if (!world) return;
  world.active = i;
  world.floors.forEach((fl, idx) => { fl.group.visible = idx === i; });
  deselect();
  const { V, heights } = activeFloor();
  // Frame the camera on this floor (its terrain sits at its own height range).
  let sum = 0; for (const h of heights) sum += h;
  const midZ = sum / heights.length, c = (V / 2) * U;
  controls.target.set(c, c, midZ);
  camera.position.set(c, -V * 0.5 * U, midZ + V * 0.7 * U);
  controls.update();
  // Fit the whole floor in the plan view too (a touch of margin past the edge).
  topHalf = V * 0.55 * U;
  syncTopCamera();
  updateFloorUI();
  if (world) renderExplorer(); // floor switch -> its own object list
}

// --- selection ---
function selectById(id: string): void {
  const mesh = activeFloor().meshes.get(id);
  if (!mesh) return;
  selected = { id, mesh, inst: mesh.userData.inst };
  if (!boxHelper) { boxHelper = new THREE.BoxHelper(mesh, 0x4fd1c5); scene.add(boxHelper); }
  else { boxHelper.setFromObject(mesh); boxHelper.visible = true; }
  updatePanel();
  void loadProps();
  syncExplorerSel();
}
function deselect(): void {
  selected = null;
  if (boxHelper) boxHelper.visible = false;
  updatePanel();
  void loadProps();
  syncExplorerSel();
}

// Frame the camera on a mesh: keep the current view direction but recenter and
// back off to a distance that fits the object — so clicking a list row actually
// brings the (often tiny, often hidden) object into view.
function frameObject(mesh: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const dist = Math.max(box.getSize(new THREE.Vector3()).length() * 2.0, 8 * U);
  let dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (dir.lengthSq() < 1e-4) dir.set(0, -1, 0.7);
  dir.normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
  controls.update();
}

// --- object explorer (left sidebar) ---------------------------------------
// Lists the loaded map's objects by category so you can find and select an
// object you can't see in the 3D view. Gameplay objects (towns, monsters,
// mines…) group by a friendly type name; decorative statics group by their
// MapObjects/ folder (Grass, Dirt, Subterra…). Click a row -> select + frame.
const TYPE_LABEL: Record<string, string> = {
  AdvMapStatic: 'Decor', AdvMapTreasure: 'Treasure', AdvMapMonster: 'Monsters',
  AdvMapBuilding: 'Buildings', AdvMapMine: 'Mines', AdvMapArtifact: 'Artifacts',
  AdvMapDwelling: 'Dwellings', AdvMapShrine: 'Shrines', AdvMapHero: 'Heroes',
  AdvMapTown: 'Towns', AdvMapGarrison: 'Garrisons', AdvMapAbanMine: 'Abandoned mines',
  AdvMapShipyard: 'Shipyards', AdvMapSign: 'Signs', AdvMapTent: 'Tents',
  AdvMapHillFort: 'Hill forts', AdvMapDwarvenWarren: 'Warrens', AdvMapSeerHut: 'Seer huts',
  AdvMapPrison: 'Prisons', AdvMapCartographer: 'Cartographers', AdvMapSphinx: 'Sphinxes',
};

function objName(it: Instance): string {
  const base = (it.shared || '').split('/').pop() || it.type;
  return base.replace(/\.\(AdvMap\w+Shared\)\.xdb$/i, '').replace(/\.xdb$/i, '') || it.type;
}
function objCategory(it: Instance): string {
  if (it.type !== 'AdvMapStatic') return TYPE_LABEL[it.type] || it.type;
  const m = (it.shared || '').match(/\/MapObjects\/([^/]+)\//i);
  return m ? m[1] : 'Decor';
}

let exCat = ALL;
const exInstances = () => (world ? activeFloor().instances : []);

function renderExplorer(): void { renderExCats(); renderExList(); }

function renderExCats(): void {
  const insts = exInstances();
  const counts = new Map();
  for (const it of insts) { const c = objCategory(it); counts.set(c, (counts.get(c) || 0) + 1); }
  if (!counts.has(exCat) && exCat !== ALL) exCat = ALL;
  const el = $('ex-cats'); el.innerHTML = '';
  const chip = (label: string, n: number, key: string): void => {
    const c = document.createElement('span');
    c.className = 'chip' + (key === exCat ? ' on' : '');
    c.textContent = `${label} (${n})`;
    c.onclick = () => { exCat = key; renderExCats(); renderExList(); };
    el.appendChild(c);
  };
  chip(ALL, insts.length, ALL);
  for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) chip(c, n, c);
}

function renderExList(): void {
  const list = $('ex-list');
  const f = $input('ex-search').value.trim().toLowerCase();
  let shown = exInstances();
  if (exCat !== ALL) shown = shown.filter((it) => objCategory(it) === exCat);
  if (f) shown = shown.filter((it) => (objName(it) + ' ' + it.type + ' ' + it.x + ',' + it.y).toLowerCase().includes(f));
  $('ex-count').textContent = `${shown.length} / ${exInstances().length}`;
  shown = shown.slice().sort((a, b) => objName(a).localeCompare(objName(b)) || a.x - b.x || a.y - b.y);
  list.innerHTML = '';
  if (!shown.length) { list.innerHTML = '<div class="empty">no objects</div>'; return; }
  const frag = document.createDocumentFragment();
  for (const it of shown.slice(0, 2000)) {
    const div = document.createElement('div');
    div.className = 'exrow' + (selected && selected.id === it.id ? ' sel' : '');
    div.dataset.id = it.id ?? undefined;
    div.innerHTML = `<span class="nm"></span><span class="co"></span>`;
    setChild(div, '.nm', objName(it));
    setChild(div, '.co', `${it.x},${it.y}`);
    div.onclick = () => {
      const id = it.id;
      if (!id) return;
      selectById(id);
      const m = activeFloor().meshes.get(id);
      if (m) frameObject(m);
    };
    frag.appendChild(div);
  }
  list.appendChild(frag);
  if (shown.length > 2000) list.insertAdjacentHTML('beforeend', '<div class="empty">…first 2000 shown</div>');
}

// Highlight the selected object's row (and scroll it into view when off-screen).
function syncExplorerSel(): void {
  const list = $('ex-list'); if (!list) return;
  let selRow = null;
  for (const r of list.querySelectorAll<HTMLElement>('.exrow')) {
    const on = selected !== null && r.dataset.id === selected.id;
    r.classList.toggle('sel', on);
    if (on) selRow = r;
  }
  if (selRow) selRow.scrollIntoView({ block: 'nearest' });
}

function updatePanel(): void {
  const p = $('panel');
  if (!selected) { p.style.display = 'none'; return; }
  p.style.display = 'block';
  const it = selected.inst;
  $('p-type').textContent = it.type;
  $('p-id').textContent = it.id ? it.id.replace('item_', '').slice(0, 8) : '—';
  $('p-xy').textContent = `${it.x}, ${it.y}`;
  // Degrees on screen, radians in the file. Nobody thinks about placement in
  // radians, and 3.142 tells you far less than 180°.
  $('p-rot').textContent = `${degOf(it.r).toFixed(0)}°`;
  $input('p-rotslider').value = String(degOf(it.r));
  $('p-shared').textContent = '—';
  // Deliberately NOT loading properties here: updatePanel runs on every
  // pointermove of an object drag, and refetching a field list per mouse move
  // would both flood the bridge and yank focus out of an input mid-edit.
  // Properties follow the SELECTION, so they load in selectById.
}

// --- rotate and delete ------------------------------------------------------
//
// Both write straight through: the mesh turns or disappears at once and the
// main process is told afterwards, where the edit is recorded so Ctrl+Z brings
// it back. Deletion does not prompt — undo is the safety net, the way Del works
// in every editor — and nothing touches disk until Save regardless.

/** An angle in radians as degrees in [0, 360). */
const degOf = (r: number): number => ((r * 180 / Math.PI) % 360 + 360) % 360;

/**
 * Nearest quarter turn, in degrees [0, 360). The game only turns objects in 90°
 * steps about their anchor tile, so every user-driven rotation lands on the
 * grid. Applied on the rotate action only — a shipped object sitting at an odd
 * angle keeps it until it is actually turned.
 */
const snap90 = (deg: number): number => (Math.round(deg / 90) * 90 % 360 + 360) % 360;

/**
 * Turn the selected object to an absolute angle in degrees.
 *
 * @param commit false while a slider is still being dragged — the mesh turns
 *   live, but the map is written once on release rather than once per pixel.
 */
async function rotateSelected(deg: number, commit = true): Promise<void> {
  if (!selected) return;
  const r = snap90(deg) * Math.PI / 180;
  selected.inst.r = r;
  selected.mesh.rotation.z = r;
  syncInstance(activeFloor(), selected.inst);
  syncFootprints();
  boxHelper?.setFromObject(selected.mesh);
  $('p-rot').textContent = `${degOf(r).toFixed(0)}°`;
  // Skipped while the slider itself is the source, or dragging it would fight
  // its own value being written back mid-gesture.
  if (commit) $input('p-rotslider').value = String(degOf(r));
  if (!commit) return;
  try {
    await window.editor.rotateObject(selected.id, r);
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'rotate failed: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** Delete the selected object, from the scene and from the map. */
// --- undo / redo -----------------------------------------------------------
//
// The step itself is applied in the main process, against the documents it
// owns; this only takes delivery of whatever the renderer cannot recompute.
// Objects arrive as a whole list, terrain as its planes plus a rebuilt splat.
async function stepHistory(dir: 'undo' | 'redo'): Promise<void> {
  if (!world) return;
  let r;
  try {
    r = dir === 'undo' ? await window.editor.undo() : await window.editor.redo();
  } catch (e) {
    $('hud').textContent = `${dir} failed: ` + (e instanceof Error ? e.message : String(e));
    return;
  }
  if (!r.applied) {
    $('hud').textContent = dir === 'undo' ? 'nothing to undo' : 'nothing to redo';
    return;
  }
  // The selection may name an object this step removed, and its handle mesh is
  // about to be discarded either way.
  deselect();
  if (r.instances) {
    world.floors.forEach((fl, i) => replaceInstances(fl, r.instances![i] ?? []));
  }
  for (const t of r.terrain) {
    const fl = world.floors[t.floor];
    if (!fl) continue;
    fl.heights = t.heights;
    fl.flags = t.flags;
    if (t.splat) fl.splat = t.splat;
    remeshFloor(fl);
    if (t.splat) {
      await upgradeToSplat(fl).catch((e: unknown) => {
        $('hud').textContent = 'ground textures: ' + (e instanceof Error ? e.message : String(e));
      });
    }
  }
  renderExplorer();
  markDirty(true);
  $('hud').textContent = `${dir === 'undo' ? 'undid' : 'redid'} ${r.label ?? 'edit'}`;
  updateHistoryUI(r.canUndo, r.canRedo, r.undoLabel, r.redoLabel);
}

/** Reflect what is undoable in the toolbar buttons. */
function updateHistoryUI(canUndo: boolean, canRedo: boolean, undoLabel: string | null, redoLabel: string | null): void {
  const u = $button('undobtn'), rd = $button('redobtn');
  u.disabled = !canUndo;
  rd.disabled = !canRedo;
  u.title = canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo';
  rd.title = canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';
}

async function deleteSelected(): Promise<void> {
  if (!selected) return;
  const { id, mesh, inst } = selected;
  try {
    await window.editor.removeObject(id);
  } catch (e) {
    $('hud').textContent = 'delete failed: ' + (e instanceof Error ? e.message : String(e));
    return;
  }
  // Only take it off screen once the map has accepted it, so a failure leaves
  // the two copies agreeing rather than showing a deletion that did not happen.
  const fl = activeFloor();
  fl.group.remove(mesh);
  fl.meshes.delete(id);
  removeFromBatch(fl, inst);
  // The geometry is shared between every instance of this model, so it is the
  // scene's to dispose, not ours.
  const i = fl.instances.indexOf(inst);
  if (i >= 0) fl.instances.splice(i, 1);
  syncFootprints(fl);
  deselect();
  renderExplorer();
  markDirty(true);
  $('hud').textContent = `deleted ${objName(inst)}`;
}

// --- property panel ---------------------------------------------------------
//
// The fields come from the object itself rather than from a per-type table
// here: 21 object types, and the file already says what each one carries. See
// MapObject.props().
//
// Written on `change`, not on every keystroke, so a half-typed number never
// reaches the map. The panel does not re-read afterwards — the map took the
// value verbatim, so re-rendering would only risk showing something else.

/** Which object the visible property list belongs to, so a stale reply is dropped. */
let propsFor: string | null = null;

async function loadProps(): Promise<void> {
  const host = $('p-props');
  host.innerHTML = '';
  if (!selected) { propsFor = null; return; }
  const id = selected.id;
  propsFor = id;
  let res;
  try {
    res = await window.editor.objectProps(id);
  } catch (e) {
    host.textContent = 'could not read properties: ' + (e instanceof Error ? e.message : String(e));
    return;
  }
  // Selection can move while the reply is in flight; showing the old object's
  // fields under the new object's heading would be a quiet lie.
  if (propsFor !== id || !selected || selected.id !== id) return;
  if (!res.props.length) { host.innerHTML = '<div class="ph">no simple fields</div>'; return; }

  const head = document.createElement('div');
  head.className = 'ph';
  head.textContent = 'properties';
  host.appendChild(head);

  // Look up this object type's schema once; each field is typed by it, or falls
  // back to inference when the schema does not describe it.
  const typeFields = objectProps(res.type);
  // And what the GAME's type spec says a field may hold — the closed sets our
  // schema does not spell out. Awaited here so a row is built once, complete.
  const allowed = await loadSpecValues(res.type);
  if (propsFor !== id || !selected || selected.id !== id) return;
  const rowFor = (p: ObjectProp): HTMLElement => {
    const raw = typeFields[p.name];
    const field = raw ? deref(objectSchema, raw) : null;
    const row = fieldRow(p, field, (n, v) => void setProp(id, n, v), res.type, allowed[p.name]);
    if (p.absent) {
      row.classList.add('absent');
      row.title = `${p.name} is not in this object yet — the game's type spec says it belongs, so setting it adds it`;
    }
    return row;
  };
  for (const p of res.props) if (!p.absent) host.appendChild(rowFor(p));

  // Fields the type has that this object does not carry, under their own
  // heading — they are a different thing from a field with an empty value, and
  // mixing them into the list would read as "set to nothing".
  const absent = res.props.filter((p) => p.absent);
  if (absent.length) {
    const h2 = document.createElement('div');
    h2.className = 'ph';
    h2.textContent = 'not set on this object';
    h2.title = 'This object was built from one the game shipped, whose version had no such field. Setting one adds it.';
    host.appendChild(h2);
    for (const p of absent) host.appendChild(rowFor(p));
  }
}

/**
 * One field row — a label and an editor chosen from the value's kind — shared by
 * the object panel and the map-settings dialog. `commit(name, value)` runs on
 * change. Read-only fields (href refs, and the map root's dimensions and empty
 * placeholders) are shown, not edited. An optional `label` overrides the raw
 * element name for the curated General tab.
 */
function propRow(p: ObjectProp, commit: (name: string, value: string) => void, label = p.name): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pf';
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.title = p.name;
  row.appendChild(lab);

  if (p.kind === 'href') {
    const ro = document.createElement('span');
    ro.className = 'ro';
    // Empty hrefs are common and mean "nothing referenced"; say so rather than
    // showing a blank that reads as a rendering bug.
    ro.textContent = p.value || '(none)';
    ro.title = p.value;
    row.appendChild(ro);
  } else if (p.readonly) {
    // A dimension or an empty asset/enum placeholder: shown, not edited. Empty
    // reads as "null", the way the original's tree shows it.
    const ro = document.createElement('span');
    ro.className = 'rov';
    ro.textContent = p.value || 'null';
    ro.title = p.value;
    row.appendChild(ro);
  } else if (p.kind === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.value === 'true';
    cb.addEventListener('change', () => commit(p.name, String(cb.checked)));
    row.appendChild(cb);
  } else {
    const inp = document.createElement('input');
    inp.type = p.kind === 'number' ? 'number' : 'text';
    inp.value = p.value;
    // A text box only when nobody could tell us the legal set: the game's type
    // spec closes most enum fields and fieldRow() turns those into dropdowns
    // before reaching here (see loadSpecValues). Without types.xml — no game
    // data — this is still the honest control, since a guessed list would
    // refuse values the game accepts.
    if (p.kind === 'enum') inp.title = 'one of the game’s enum values (no type spec loaded)';
    inp.addEventListener('change', () => commit(p.name, inp.value));
    row.appendChild(inp);
  }
  return row;
}

/**
 * The values the game's own type spec allows for a field, by object type.
 *
 * Fetched once per type and kept: it never changes for an installation, and the
 * panel needs it while building rows rather than after. Empty when there is no
 * types.xml to read, which leaves every control exactly as it was.
 */
const specValuesByType = new Map<string, Record<string, string[]>>();
async function loadSpecValues(type: string): Promise<Record<string, string[]>> {
  const hit = specValuesByType.get(type);
  if (hit) return hit;
  let values: Record<string, string[]> = {};
  try { values = (await window.editor.specValues(type)).values; } catch { /* no spec, no dropdowns */ }
  specValuesByType.set(type, values);
  return values;
}

/**
 * A dropdown over a closed set that still accepts what is already there.
 *
 * The current value is prepended when the set does not contain it, because a
 * control that silently drops a value the file holds is worse than one offering
 * an extra choice — and a modded install can carry values this build's spec
 * does not know.
 */
function specSelect(value: string, allowed: string[], commit: (v: string) => void): HTMLElement {
  const opts = allowed.map((v) => ({ value: v, label: v }));
  if (value && !allowed.includes(value)) opts.unshift({ value, label: `${value} (not in the game's list)` });
  return selectFrom(value, opts, commit);
}

// --- typed rows (schema-driven) ----------------------------------------------
//
// The property panel upgrades each field to the control its schema declares
// (src/schema.ts): an enum or registry-backed field becomes a dropdown, a
// dimension read-only, a bounded number a spinner. Anything the schema does not
// describe falls back to propRow()'s value-shape inference, so the panel is
// always usable.

/** Roster entries per name, fetched once from the main process and cached. */
const rosterCache = new Map<string, Promise<RosterEntryDTO[]>>();
function roster(name: string): Promise<RosterEntryDTO[]> {
  let p = rosterCache.get(name);
  if (!p) { p = window.editor.roster(name).then((r) => r.entries).catch(() => []); rosterCache.set(name, p); }
  return p;
}

/** Every object of an engine class (the "…" browse picker's universe), cached
 *  per class for the session. A New entity invalidates its class's cache. */
const classCache = new Map<string, Promise<RosterEntryDTO[]>>();
function objectsOfClass(className: string): Promise<RosterEntryDTO[]> {
  let p = classCache.get(className);
  if (!p) { p = window.editor.objectsOfClass(className).then((r) => r.entries).catch(() => []); classCache.set(className, p); }
  return p;
}

/** Whether "New" can author a class — the schema has a template for it (a map
 *  entity $def, or an object type). Shared identity classes have none. */
function canCreateClass(className: string): boolean {
  return schemaForClass(className) !== null;
}

/** In-map names per kind (objective, object), for x-nameRef autocomplete. Not
 *  cached across edits — names change as the map is edited — but per render pass
 *  the same promise is reused. */
function mapNames(kind: string): Promise<string[]> {
  return window.editor.names(kind).then((r) => r.names).catch(() => []);
}

/** A text input with a <datalist> of names defined elsewhere in the map — a
 *  reference hint, not a hard constraint (a value not yet defined is still
 *  typeable). `display:contents` lets the input be the flex child, not the span. */
let datalistSeq = 0;
function nameRefInput(kind: string, value: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = value;
  const id = `nl${datalistSeq++}`;
  const list = document.createElement('datalist'); list.id = id; inp.setAttribute('list', id);
  inp.title = `references a ${kind} by name`;
  inp.addEventListener('change', () => commit(inp.value));
  void mapNames(kind).then((names) => {
    for (const n of names) { const o = document.createElement('option'); o.value = n; list.appendChild(o); }
  });
  wrap.append(inp, list);
  return wrap;
}

/** A label + its title/description tooltip — the left half every row shares. */
function rowShell(field: FieldSchema | null, rawName: string): { row: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'pf';
  const label = document.createElement('label');
  label.textContent = field?.title || rawName;
  label.title = field?.description ? `${rawName} — ${field.description}` : rawName;
  row.appendChild(label);
  return { row };
}

/** A <select>, its current value guaranteed present even if outside the options. */
function selectFrom(current: string, options: { value: string; label: string }[], onChange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  const opts = options.some((o) => o.value === current)
    ? options
    : [{ value: current, label: current || '(none)' }, ...options];
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value; el.textContent = o.label;
    if (o.value === current) el.selected = true;
    sel.appendChild(el);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/**
 * One property row, typed by its schema when there is one. Handles the
 * single-value controls (dropdowns, enums, read-only, bounded numbers); arrays
 * and nested structures are a later pass, so those fall through to propRow.
 */
function fieldRow(p: ObjectProp, field: FieldSchema | null, commit: (name: string, value: string) => void, objectType?: string, allowed?: string[]): HTMLElement {
  // What the GAME allows here beats both the schema's own enum list and the
  // value-shape guess: it is the closed set the engine defines, and it is the
  // difference between typing ATTACK_MELEE from memory and picking it.
  // Registry-backed fields keep their roster — it carries display names.
  if (allowed?.length && field?.['x-registry'] === undefined) {
    const { row } = field ? rowShell(field, p.name) : rowShell({ title: p.name }, p.name);
    row.appendChild(specSelect(p.value, allowed, (v) => commit(p.name, v)));
    return row;
  }
  if (!field) return propRow(p, commit);
  if (field['x-nameRef']) {
    const { row } = rowShell(field, p.name);
    row.appendChild(nameRefInput(field['x-nameRef'], p.value, (v) => commit(p.name, v)));
    return row;
  }
  // A reference to a whole object — an object's Shared identity, or a single
  // entity ref: the type-constrained picker + New, same as the tree's rows.
  if (field.type !== 'array') {
    const cls = classOf(field, objectType);
    if (cls) {
      const { row } = rowShell(field, p.name);
      row.appendChild(entityRefControl(cls, p.value, (v) => commit(p.name, v)));
      return row;
    }
  }
  const control = controlOf(field);

  if (control === 'dropdown' && field['x-registry']) {
    const { row } = rowShell(field, p.name);
    // Show the current value immediately; fill the options once the roster loads.
    const sel = selectFrom(p.value, [], (v) => commit(p.name, v));
    sel.disabled = true;
    row.appendChild(sel);
    void roster(field['x-registry']).then((entries) => {
      const cur = sel.value;
      sel.innerHTML = '';
      const opts = entries.map((e) => ({ value: e.id, label: e.name || e.id }));
      if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur || '(none)' });
      for (const o of opts) {
        const el = document.createElement('option');
        el.value = o.value; el.textContent = o.label;
        if (o.value === cur) el.selected = true;
        sel.appendChild(el);
      }
      sel.disabled = false;
    });
    return row;
  }

  if (control === 'enum' && field.enum) {
    const { row } = rowShell(field, p.name);
    row.appendChild(selectFrom(p.value, field.enum.map((v) => ({ value: v, label: v })), (v) => commit(p.name, v)));
    return row;
  }

  if (control === 'number') {
    const { row } = rowShell(field, p.name);
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = p.value;
    if (field.minimum !== undefined) inp.min = String(field.minimum);
    if (field.maximum !== undefined) inp.max = String(field.maximum);
    inp.addEventListener('change', () => commit(p.name, inp.value));
    row.appendChild(inp);
    return row;
  }

  if (control === 'checkbox') {
    const { row } = rowShell(field, p.name);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = p.value === 'true';
    cb.addEventListener('change', () => commit(p.name, String(cb.checked)));
    row.appendChild(cb);
    return row;
  }

  // readonly, refs, and anything structural: keep the schema's nicer label but
  // let propRow render the value (it already shows href/readonly sensibly).
  return propRow(field['x-readonly'] ? { ...p, readonly: true } : p, commit, field.title || p.name);
}

async function setProp(id: string, name: string, value: string): Promise<void> {
  try {
    await window.editor.setObjectProp({ id, name, value });
    markDirty(true);
    $('hud').textContent = `${name} = ${value || '(empty)'}`;
  } catch (e) {
    $('hud').textContent = `could not set ${name}: ` + (e instanceof Error ? e.message : String(e));
  }
}

$('p-del').onclick = () => { void deleteSelected(); };
// A button is a quarter turn from the current heading. Snapping the current
// angle first means an object at an odd shipped angle aligns to the grid on the
// first press, then turns cleanly from there.
$('p-rotl').onclick = () => { if (selected) void rotateSelected(snap90(degOf(selected.inst.r)) - 90); };
$('p-rotr').onclick = () => { if (selected) void rotateSelected(snap90(degOf(selected.inst.r)) + 90); };
$input('p-rotslider').addEventListener('input', (e) => {
  void rotateSelected(+(e.currentTarget as HTMLInputElement).value, false);
});
$input('p-rotslider').addEventListener('change', (e) => {
  void rotateSelected(+(e.currentTarget as HTMLInputElement).value);
});

// --- map settings dialog ----------------------------------------------------
//
// The map's own properties — the original's map-properties form — read from the
// <AdvMapDesc> root through map.mapProps(). Two views in one modal: a curated
// General tab and the full field tree, mirroring the two forms the original
// offers (a friendly dialog and a raw property tree). Opened from the toolbar,
// since these are map-level and not tied to any selection.

// The eight tabs of the original's Adventure Map Properties, driven by the
// schema: each field's x-tab says where it belongs, its control comes from its
// type, its value from the map tree (map:tree). Edits go through the same path
// API as the tree, so dialog and tree stay in sync.
const MP_TABS: { id: string; label: string }[] = [
  { id: 'general', label: 'General' }, { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' }, { id: 'heroes', label: 'Heroes' },
  { id: 'spells', label: 'Spells' }, { id: 'artifacts', label: 'Artifacts' },
  { id: 'script', label: 'Script' }, { id: 'rumours', label: 'Rumours' },
];
let mpData: TreeData = {};
let mpNameDesc = { name: '', description: '' };
let mpTab = 'general';
let mpPlayer = 0;

const mapDialog = (): HTMLDialogElement => {
  const el = $('mapprops');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#mapprops is not a <dialog>');
  return el;
};
const mapPropsOpen = (): boolean => mapDialog().open;

async function openMapProps(): Promise<void> {
  buildMpTabs();
  mpTab = 'general'; mpPlayer = 0;
  await loadMpData();
  renderMpTab();
  mapDialog().showModal();
}
function closeMapProps(): void { mapDialog().close(); }

function buildMpTabs(): void {
  const bar = $('mp-tabs'); bar.innerHTML = '';
  for (const t of MP_TABS) {
    const b = document.createElement('button');
    b.className = 'mp-tab'; b.textContent = t.label; b.dataset.tab = t.id;
    b.addEventListener('click', () => { mpTab = t.id; renderMpTab(); });
    bar.appendChild(b);
  }
}

/** Read the whole map tree (values) plus the resolved name/description. */
async function loadMpData(): Promise<void> {
  try { mpData = (await window.editor.mapTree()).tree as TreeData; } catch { mpData = {}; }
  try { const r = await window.editor.mapProps(); mpNameDesc = { name: r.name, description: r.description }; } catch { /* keep */ }
}
/** Re-read after a structural edit (a rumour added/removed), then re-render. */
async function mpReload(): Promise<void> { await loadMpData(); renderMpTab(); }

/** The value/subtree at a path within the dialog's cached map data. */
function mpAt(path: TreePath): TreeData | undefined {
  let c: TreeData | undefined = mpData;
  for (const s of path) c = dataAt(c, s);
  return c;
}
const mpVal = (path: TreePath): string => { const v = mpAt(path); return typeof v === 'string' ? v : ''; };

function renderMpTab(): void {
  for (const b of document.querySelectorAll('.mp-tab'))
    b.classList.toggle('on', (b as HTMLElement).dataset.tab === mpTab);
  const body = $('mp-body'); body.innerHTML = '';
  ({
    general: mpGeneral, players: mpPlayers, teams: mpTeams,
    heroes: (b: HTMLElement) => mpChecklist(b, 'AvailableHeroes', 'heroes'),
    spells: (b: HTMLElement) => mpChecklist(b, 'spellIDs', 'spells'),
    artifacts: (b: HTMLElement) => mpChecklist(b, 'artifactIDs', 'artifacts'),
    script: mpScript, rumours: mpRumours,
  } as Record<string, (b: HTMLElement) => void>)[mpTab]?.(body);
}

const ph = (text: string): HTMLElement => { const d = document.createElement('div'); d.className = 'ph'; d.textContent = text; return d; };
const mpNote = (text: string): HTMLElement => { const d = document.createElement('div'); d.className = 'mp-note'; d.textContent = text; return d; };

function mpGeneral(body: HTMLElement): void {
  body.appendChild(nameBlock());
  body.appendChild(restrictHeroLevel(mpVal(['HeroMaxLevel'])));
  body.appendChild(ph('rules'));
  const skip = new Set(['HeroMaxLevel', 'NameFileRef', 'DescriptionFileRef']);
  for (const [name, raw] of Object.entries(mapSchema.properties)) {
    const field = deref(mapSchema, raw);
    if (field['x-tab'] !== 'general' || skip.has(name)) continue;
    body.appendChild(leafRow(name, field, mpVal([name]), [name]));
  }
  body.appendChild(mpNote('Size and version are read-only. The Tree panel shows every field, including advanced ones this tab omits.'));
}

function mpPlayers(body: HTMLElement): void {
  const players = mpAt(['players']);
  const n = Array.isArray(players) ? players.length : 0;
  if (!n) { body.textContent = 'this map has no players'; return; }
  if (mpPlayer >= n) mpPlayer = 0;
  const pick = document.createElement('div'); pick.className = 'mp-picker';
  const lab = document.createElement('label'); lab.textContent = 'Player:';
  const sel = document.createElement('select');
  for (let i = 0; i < n; i++) {
    const o = document.createElement('option'); o.value = String(i);
    o.textContent = `Player ${i + 1}${mpVal(['players', i, 'Colour']) ? ` (${mpVal(['players', i, 'Colour']).replace('PCOLOR_', '').toLowerCase()})` : ''}`;
    if (i === mpPlayer) o.selected = true; sel.appendChild(o);
  }
  sel.addEventListener('change', () => { mpPlayer = +sel.value; renderMpTab(); });
  pick.append(lab, sel); body.appendChild(pick);
  const playerDef = deref(mapSchema, resolveSchemaAtPath(mapSchema, ['players', 0]) || {});
  for (const [name, raw] of Object.entries(playerDef.properties ?? {})) {
    const field = deref(mapSchema, raw);
    if (field['x-tab'] !== 'players' || controlOf(field) === 'group') continue;
    body.appendChild(leafRow(name, field, mpVal(['players', mpPlayer, name]), ['players', mpPlayer, name]));
  }
}

function mpTeams(body: HTMLElement): void {
  const ct = document.createElement('label'); ct.className = 'mp-restrict';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = mpVal(['CustomTeams']) === 'true';
  cb.addEventListener('change', () => { void setMapPath(['CustomTeams'], String(cb.checked)); });
  ct.append(cb, document.createTextNode('Custom teams')); body.appendChild(ct);
  const players = mpAt(['players']); const n = Array.isArray(players) ? players.length : 0;
  const table = document.createElement('table'); table.className = 'mp-teams';
  const head = document.createElement('tr'); head.appendChild(document.createElement('th'));
  for (const t of ['—', '1', '2', '3', '4', '5', '6', '7', '8']) { const th = document.createElement('th'); th.textContent = t; head.appendChild(th); }
  table.appendChild(head);
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr');
    const pl = document.createElement('td'); pl.className = 'pl'; pl.textContent = `Player ${i + 1}`; tr.appendChild(pl);
    for (let team = 0; team <= 8; team++) {
      const td = document.createElement('td');
      const r = document.createElement('input'); r.type = 'radio'; r.name = `mpteam${i}`;
      r.checked = (+mpVal(['players', i, 'Team']) || 0) === team;
      r.addEventListener('change', () => { void setMapPath(['players', i, 'Team'], String(team)); });
      td.appendChild(r); tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  body.appendChild(table);
}

/** A checklist tab (Heroes / Spells / Artifacts): the whole roster as checkboxes,
 *  with search and Check/Uncheck All; a change rewrites the list in one call. */
function mpChecklist(body: HTMLElement, fieldName: string, regName: string): void {
  const currentArr = (() => { const v = mpAt([fieldName]); return Array.isArray(v) ? v.map(String) : []; })();
  const currentSet = new Set(currentArr);
  const tools = document.createElement('div'); tools.className = 'mp-cl-tools';
  const search = document.createElement('input'); search.type = 'text'; search.placeholder = 'filter…';
  const checkAll = document.createElement('button'); checkAll.textContent = 'Check all';
  const uncheckAll = document.createElement('button'); uncheckAll.textContent = 'Uncheck all';
  const count = document.createElement('span'); count.className = 'mp-cl-count';
  tools.append(search, checkAll, uncheckAll, count);
  const grid = document.createElement('div'); grid.className = 'mp-checklist';
  body.append(tools, grid);
  grid.textContent = 'loading…';
  void roster(regName).then((entries) => {
    const ros = entries.map((e) => ({ id: e.id, name: e.name || e.id }));
    const known = new Set(ros.map((e) => e.id));
    for (const id of currentArr) if (!known.has(id)) ros.push({ id, name: id });  // keep custom entries
    const updateCount = (): void => { count.textContent = `${currentSet.size} / ${ros.length}`; };
    const commitList = (): void => {
      const vals = ros.filter((e) => currentSet.has(e.id)).map((e) => e.id);
      (mpData as Record<string, TreeData>)[fieldName] = vals;
      void window.editor.setMapList({ path: [fieldName], values: vals }).then(() => markDirty(true));
    };
    const render = (): void => {
      const f = search.value.toLowerCase();
      grid.innerHTML = '';
      for (const e of ros) {
        if (f && !e.name.toLowerCase().includes(f) && !e.id.toLowerCase().includes(f)) continue;
        const label = document.createElement('label');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = currentSet.has(e.id);
        cb.addEventListener('change', () => { if (cb.checked) currentSet.add(e.id); else currentSet.delete(e.id); commitList(); updateCount(); });
        label.append(cb, document.createTextNode(e.name)); label.title = e.id; grid.appendChild(label);
      }
    };
    search.addEventListener('input', render);
    checkAll.addEventListener('click', () => { ros.forEach((e) => currentSet.add(e.id)); commitList(); render(); updateCount(); });
    uncheckAll.addEventListener('click', () => { currentSet.clear(); commitList(); render(); updateCount(); });
    render(); updateCount();
  });
}

function mpScript(body: HTMLElement): void {
  const f = deref(mapSchema, mapSchema.properties.MapScript!);
  body.appendChild(leafRow('MapScript', f, mpVal(['MapScript']), ['MapScript']));
  body.appendChild(mpNote('The map script reference. Full Lua editing is Phase 5.'));
}

function mpRumours(body: HTMLElement): void {
  const rum = mpAt(['MapRumours']); const arr = Array.isArray(rum) ? rum : [];
  const rumourDef = deref(mapSchema, resolveSchemaAtPath(mapSchema, ['MapRumours', 0]) || {});
  arr.forEach((_r, i) => {
    const box = document.createElement('div'); box.className = 'mt-grp';
    const head = document.createElement('div'); head.className = 'mt-ghead';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = `Rumour ${i + 1}`;
    const x = document.createElement('button'); x.className = 'mt-x'; x.textContent = '✕'; x.title = 'remove'; x.style.marginLeft = 'auto';
    x.addEventListener('click', () => { void window.editor.removeMapItem({ path: ['MapRumours', i] }).then(() => { markDirty(true); return mpReload(); }); });
    head.append(nm, x); box.appendChild(head);
    for (const [name, raw] of Object.entries(rumourDef.properties ?? {})) {
      const field = deref(mapSchema, raw);
      box.appendChild(leafRow(name, field, mpVal(['MapRumours', i, name]), ['MapRumours', i, name]));
    }
    body.appendChild(box);
  });
  const add = document.createElement('div'); add.className = 'mt-add';
  const btn = document.createElement('button'); btn.textContent = '＋ add rumour';
  btn.addEventListener('click', () => { void window.editor.addMapItem({ path: ['MapRumours'] }).then(() => { markDirty(true); return mpReload(); }); });
  add.appendChild(btn); body.appendChild(add);
}

/** The editable name + description block at the top of General. Each writes the
 *  sibling text file it references (the same files the tree's ✎ edits). When no
 *  file is referenced yet, a ref control lets one be created or picked. */
function nameBlock(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mp-name';
  box.appendChild(nameFileRow('Map name', 'NameFileRef', 'name', false));
  box.appendChild(nameFileRow('Description', 'DescriptionFileRef', 'description', true));
  return box;
}

/** One editable name/description field bound to its referenced text file. */
function nameFileRow(label: string, hrefField: string, which: 'name' | 'description', multiline: boolean): HTMLElement {
  const box = document.createElement('div');
  const k = document.createElement('div'); k.className = 'k'; k.textContent = label;
  box.appendChild(k);
  const href = mpVal([hrefField]);
  if (!href) {
    // No text file referenced — offer the …/New/✎ control to make or pick one.
    const row = document.createElement('div'); row.className = 'mt-row';
    row.appendChild(fileRefControl('', label, (v) => { void setMapPath([hrefField], v).then(mpReload); }));
    box.appendChild(row);
    return box;
  }
  const input = document.createElement(multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  if (!multiline) (input as HTMLInputElement).type = 'text';
  input.className = multiline ? 'mp-desc-edit' : 'mp-name-edit';
  input.value = which === 'name' ? mpNameDesc.name : mpNameDesc.description;
  input.spellcheck = false;
  input.addEventListener('change', () => {
    const text = input.value;
    void window.editor.writeFile({ href, text }).then(() => {
      markDirty(true);
      if (which === 'name') mpNameDesc.name = text; else mpNameDesc.description = text;
      $('hud').textContent = `saved ${href}`;
    }).catch((e: unknown) => { $('hud').textContent = 'save failed: ' + (e instanceof Error ? e.message : String(e)); });
  });
  box.appendChild(input);
  return box;
}

/**
 * "Restrict hero level to N": a checkbox gating a number, 0 = unrestricted,
 * matching the original's General tab. Off writes 0; on writes the number.
 */
function restrictHeroLevel(current: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mp-restrict';
  const cur = +current || 0;
  const lab = document.createElement('label');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = cur > 0;
  lab.append(cb, document.createTextNode('Restrict hero level to'));
  const num = document.createElement('input');
  num.type = 'number'; num.min = '1'; num.max = '999';
  num.value = String(cur > 0 ? cur : 40); num.disabled = cur === 0;
  wrap.append(lab, num);
  const push = (): void => { void setMapPath(['HeroMaxLevel'], cb.checked ? String(Math.max(1, +num.value || 1)) : '0'); };
  cb.addEventListener('change', () => { num.disabled = !cb.checked; if (cb.checked && !+num.value) num.value = '40'; push(); });
  num.addEventListener('change', push);
  return wrap;
}

// --- map tree editor (left panel) -------------------------------------------
//
// The whole <AdvMapDesc> as an expandable, schema-typed tree — the raw, complete
// counterpart to the curated dialog. It walks the schema (src/schema.ts) and the
// map's data (map:tree) together: a field's control comes from its schema, its
// value from the data. Where the schema stops (deep stubs, mod additions) it
// recurses on the data itself, so nothing in the file is hidden.

const mapTreeOpen = (): boolean => $('maptree').style.display !== 'none';
let mtShowAdvanced = false;
/** Expanded group paths, so a rebuild (after add/remove) keeps them open. */
const mtOpen = new Set<string>();
const pathKey = (path: TreePath): string => path.join(' ');

function openMapTree(): void {
  $('maptree').style.display = 'flex';
  $('maptreebtn').classList.add('on');
  void refreshMapTree();
}
function closeMapTree(): void { $('maptree').style.display = 'none'; $('maptreebtn').classList.remove('on'); }

async function refreshMapTree(): Promise<void> {
  const body = $('maptree-body');
  let data: TreeData;
  try { data = (await window.editor.mapTree()).tree as TreeData; }
  catch (e) { body.textContent = 'could not read map tree: ' + (e instanceof Error ? e.message : String(e)); return; }
  body.innerHTML = '';
  for (const [name, raw] of Object.entries(mapSchema.properties)) {
    const field = deref(mapSchema, raw);
    if (field['x-advanced'] && !mtShowAdvanced) continue;
    body.appendChild(treeNode(name, field, dataAt(data, name), [name]));
  }
}

/** A child of tree data by key/index, or undefined for a leaf. */
function dataAt(data: TreeData | undefined, key: string | number): TreeData | undefined {
  if (data && typeof data === 'object') return (data as Record<string | number, TreeData>)[key];
  return undefined;
}

/** A minimal schema inferred from a data value, for fields the schema omits. */
function inferField(v: TreeData | undefined): FieldSchema {
  if (Array.isArray(v)) return { type: 'array' };
  if (v && typeof v === 'object') return { type: 'object' };
  if (v === 'true' || v === 'false') return { type: 'boolean' };
  if (typeof v === 'string' && v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return { type: 'number' };
  return { type: 'string' };
}

/** One node: a leaf row, or an expandable group (object or list). */
function treeNode(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath): HTMLElement {
  return controlOf(field) === 'group' ? groupNode(name, field, data, path) : leafRow(name, field, data, path);
}

/** A labelled leaf row whose control is set by the field's schema. */
function leafRow(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mt-row';
  const label = document.createElement('label');
  label.textContent = field.title || name;
  label.title = field.description ? `${name} — ${field.description}` : name;
  row.appendChild(label);
  const value = typeof data === 'string' ? data : '';
  row.appendChild(leafControl(field, value, (v) => { void setMapPath(path, v); }));
  return row;
}

/** The control element for a leaf value (no label). */
function leafControl(field: FieldSchema, value: string, commit: (v: string) => void): HTMLElement {
  if (field['x-nameRef']) return nameRefInput(field['x-nameRef'], value, commit);
  // A text-file reference: show the path, and an Edit button that opens the
  // referenced file in the text editor (the original's "Edit" on such a row).
  if (field['x-file']) return fileRefControl(value, field.title || '', commit);
  // A reference to a whole object (a single AdvMapBirds/Wind/AmbientLight…):
  // show the ref, and offer the type-constrained picker + New. Arrays of refs
  // stay checklists (handled by fillArray), so only single refs come here.
  if (field.type !== 'array') {
    const cls = classOf(field);
    if (cls) return entityRefControl(cls, value, commit);
  }
  const c = controlOf(field);
  if (c === 'readonly') {
    const s = document.createElement('span'); s.className = 'ro';
    s.textContent = value || 'null'; s.title = value; return s;
  }
  if (c === 'dropdown' && field['x-registry']) return regSelect(field['x-registry'], value, commit);
  if (c === 'enum' && field.enum) return selectFrom(value, field.enum.map((v) => ({ value: v, label: v })), commit);
  if (c === 'number') {
    const i = document.createElement('input'); i.type = 'number'; i.value = value;
    if (field.minimum !== undefined) i.min = String(field.minimum);
    if (field.maximum !== undefined) i.max = String(field.maximum);
    i.addEventListener('change', () => commit(i.value)); return i;
  }
  if (c === 'checkbox') {
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = value === 'true';
    cb.addEventListener('change', () => commit(String(cb.checked))); return cb;
  }
  // ref / textfile / script / text — editable raw in the tree.
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = value;
  inp.addEventListener('change', () => commit(inp.value)); return inp;
}

/** A <select> filled from a registry roster once it loads; shows value meanwhile. */
function regSelect(reg: string, value: string, commit: (v: string) => void): HTMLSelectElement {
  const sel = selectFrom(value, value ? [] : [{ value: '', label: '—' }], commit);
  sel.disabled = true;
  void roster(reg).then((entries) => {
    const cur = sel.value;
    sel.innerHTML = '';
    const opts = entries.map((e) => ({ value: e.id, label: e.name || e.id }));
    if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur || '—' });
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = o.value; el.textContent = o.label;
      if (o.value === cur) el.selected = true;
      sel.appendChild(el);
    }
    sel.disabled = false;
  });
  return sel;
}

/** An expandable group — an object's fields or a list's items, filled on expand.
 *  `onRemove`, when given, adds a delete affordance (a struct item in a list). */
function groupNode(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath, onRemove?: () => void): HTMLElement {
  const grp = document.createElement('div');
  grp.className = 'mt-grp';
  const head = document.createElement('div');
  head.className = 'mt-ghead';
  const tw = document.createElement('span'); tw.className = 'tw'; tw.textContent = '▸';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = field.title || name;
  const co = document.createElement('span'); co.className = 'co';
  const isArray = field.type === 'array';
  const count = isArray && Array.isArray(data) ? data.length : 0;
  if (isArray) co.textContent = ` (${count})`;
  head.append(tw, nm, co);
  if (onRemove) {
    const x = document.createElement('button'); x.className = 'mt-x'; x.textContent = '✕'; x.title = 'remove';
    x.style.marginLeft = 'auto';
    x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
    head.appendChild(x);
  }
  const kids = document.createElement('div');
  kids.className = 'mt-kids collapsed';
  let filled = false;
  const k = pathKey(path);
  const setOpen = (open: boolean): void => {
    kids.classList.toggle('collapsed', !open);
    tw.textContent = open ? '▾' : '▸';
    if (open) { mtOpen.add(k); if (!filled) { filled = true; (isArray ? fillArray : fillObject)(kids, field, data, path); } }
    else mtOpen.delete(k);
  };
  head.addEventListener('click', () => setOpen(kids.classList.contains('collapsed')));
  // Restore expansion across a rebuild: refreshMapTree recreates every node, so
  // without this an add/remove (which reloads the tree) would collapse the group
  // the edit happened in. Groups re-open recursively as their parents fill.
  if (mtOpen.has(k)) setOpen(true);
  grp.append(head, kids);
  return grp;
}

/** Fill an object group with its child fields (schema first, then any extra data keys). */
function fillObject(kids: HTMLElement, field: FieldSchema, data: TreeData | undefined, path: TreePath): void {
  const props = field.properties ?? {};
  const dataKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  const seen = new Set<string>();
  for (const k of [...Object.keys(props), ...dataKeys]) {
    if (seen.has(k)) continue; seen.add(k);
    const cf = props[k] ? deref(mapSchema, props[k]) : inferField(dataAt(data, k));
    if (cf['x-advanced'] && !mtShowAdvanced) continue;
    kids.appendChild(treeNode(k, cf, dataAt(data, k), [...path, k]));
  }
}

/** Fill a list group: struct items recurse; value items get remove + an add row. */
function fillArray(kids: HTMLElement, field: FieldSchema, data: TreeData | undefined, path: TreePath): void {
  const items = Array.isArray(data) ? data : [];
  const itemField = field.items ? deref(mapSchema, field.items) : inferField(items[0]);
  const isStruct = itemField.type === 'object' || !!itemField.properties;
  if (isStruct) {
    // Struct items: each expandable, removable down to minItems; add builds a
    // default item from the schema (main side), allowed up to maxItems.
    const canRemove = items.length > (field.minItems ?? 0);
    items.forEach((it, i) => kids.appendChild(groupNode(`[${i}]`, itemField, it, [...path, i],
      canRemove ? () => void mutateList(() => window.editor.removeMapItem({ path: [...path, i] })) : undefined)));
    if (field.maxItems === undefined || items.length < field.maxItems) {
      const add = document.createElement('div'); add.className = 'mt-add';
      const btn = document.createElement('button'); btn.textContent = `＋ add ${itemField.title || 'item'}`;
      btn.addEventListener('click', () => void mutateList(() => window.editor.addMapItem({ path })));
      add.appendChild(btn); kids.appendChild(add);
    }
    return;
  }
  // A list of plain values: each removable, plus an add row.
  const reg = field['x-registry'] || itemField['x-registry'];
  items.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'mt-item';
    const iv = document.createElement('span'); iv.className = 'iv'; iv.textContent = String(it); iv.title = String(it);
    const x = document.createElement('button'); x.className = 'mt-x'; x.textContent = '✕'; x.title = 'remove';
    x.addEventListener('click', () => { void mutateList(() => window.editor.removeMapItem({ path: [...path, i] })); });
    row.append(iv, x); kids.appendChild(row);
  });
  const add = document.createElement('div'); add.className = 'mt-add';
  const input = reg ? regSelect(reg, '', () => {}) : Object.assign(document.createElement('input'), { type: 'text' });
  add.appendChild(input);
  const btn = document.createElement('button'); btn.textContent = '＋ add';
  btn.addEventListener('click', () => {
    const v = (input as HTMLInputElement | HTMLSelectElement).value;
    if (v) void mutateList(() => window.editor.addMapItem({ path, value: v }));
  });
  add.appendChild(btn); kids.appendChild(add);
}

/** Run a structural list edit, then reflect dirty and rebuild the tree. */
async function mutateList(op: () => Promise<unknown>): Promise<void> {
  try { await op(); markDirty(true); await refreshMapTree(); }
  catch (e) { $('hud').textContent = 'tree edit failed: ' + (e instanceof Error ? e.message : String(e)); }
}

/** Write one leaf by path, then reflect dirty (the input already shows the value). */
async function setMapPath(path: TreePath, value: string): Promise<void> {
  try { await window.editor.setMapPath({ path, value }); markDirty(true); $('hud').textContent = `${path.join('.')} = ${value || '(empty)'}`; }
  catch (e) { $('hud').textContent = `could not set ${path.join('.')}: ` + (e instanceof Error ? e.message : String(e)); }
}

// --- text-file reference editing ("Edit" on a text ref) ---------------------
//
// A text reference (NameFileRef, a rumour's Text…) shows its path plus an Edit
// button that opens the referenced file in a plain-text editor — the original's
// behaviour. The file is its own document, written straight to disk on Save.

/** A ref row's control: the path, then an ✎ button opening the text editor. */
function fileRefControl(href: string, label: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const box = document.createElement('span'); box.className = 'mt-ref';
  const rv = document.createElement('span'); rv.className = 'rv';
  const edit = document.createElement('button'); edit.textContent = '✎'; edit.title = 'edit text';
  const show = (v: string): void => { rv.textContent = v || '(none)'; rv.title = v; edit.disabled = !v; };
  show(href);
  const browse = document.createElement('button'); browse.textContent = '…'; browse.title = 'pick an existing text file';
  browse.addEventListener('click', () => {
    void window.editor.pickText().then((r) => { if (r.href) { commit(r.href); show(r.href); } });
  });
  const nw = document.createElement('button'); nw.textContent = 'New'; nw.title = 'create a new text file';
  nw.addEventListener('click', () => {
    void createText().then((v) => { if (v != null) { commit(v); show(v); void openTextEdit(v, label || v); } });
  });
  edit.addEventListener('click', () => { if (rv.title) void openTextEdit(rv.title, label || rv.title); });
  box.append(rv, browse, nw, edit);
  wrap.appendChild(box);
  return wrap;
}

const docDialog = (): HTMLDialogElement => {
  const el = $('docedit');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#docedit is not a <dialog>');
  return el;
};
let deHref = '';

async function openTextEdit(href: string, label: string): Promise<void> {
  deHref = href;
  $('de-title').textContent = label && label !== href ? `${label} — ${href}` : href;
  const ta = $textarea('de-text');
  ta.value = 'loading…'; ta.disabled = true;
  docDialog().showModal();
  try { ta.value = (await window.editor.readFile(href)).text; }
  catch (e) { ta.value = ''; $('hud').textContent = 'could not read ' + href; }
  ta.disabled = false; ta.focus();
}

const $textarea = (id: string): HTMLTextAreaElement => {
  const el = $(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`#${id} is not a textarea`);
  return el;
};

$('de-save').onclick = () => {
  void window.editor.writeFile({ href: deHref, text: $textarea('de-text').value })
    .then(() => { markDirty(true); $('hud').textContent = `saved ${deHref}`; docDialog().close(); if (mapTreeOpen()) void refreshMapTree(); })
    .catch((e: unknown) => { $('hud').textContent = 'save failed: ' + (e instanceof Error ? e.message : String(e)); });
};
$('de-close').onclick = () => docDialog().close();
$('de-cancel').onclick = () => docDialog().close();
docDialog().addEventListener('click', (e) => { if (e.target === docDialog()) docDialog().close(); });

// --- structured object references (the "…" browse + "New" of the tree) -------
//
// A reference to a whole object (an AdvMapBirds flock, an AmbientLight, an
// object's Shared identity) shows only the reference inline, with buttons:
//   …    a type-constrained picker — the compatible class only, like the
//        original's "Objects: <Class>" explorer;
//   New  create a fresh object of that class beside the map (when the schema
//        can build a template for it).
// Both go through a native <dialog>; the entity's own field-form ("Edit") is a
// later pass, so structured refs stay pick-or-create for now.

const pickDialog = (): HTMLDialogElement => {
  const el = $('objpick');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#objpick is not a <dialog>');
  return el;
};
const newDialog = (): HTMLDialogElement => {
  const el = $('objnew');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#objnew is not a <dialog>');
  return el;
};

// A picker session, held while its <dialog> is open. `resolve` is called once,
// with the chosen id or null (cancel), and cleared so late clicks are inert.
let pick: { entries: RosterEntryDTO[]; sel: string; resolve: (v: string | null) => void } | null = null;

/** Open the type-constrained picker for `className`, preselecting `current`.
 *  Resolves the chosen ref id, or null if cancelled. */
function pickFromClass(className: string, current: string): Promise<string | null> {
  $('op-title').textContent = `Select ${className}`;
  const search = $input('op-search');
  search.value = '';
  const list = $('op-list');
  list.innerHTML = '<div class="op-empty">loading…</div>';
  pickDialog().showModal();
  search.focus();
  return new Promise<string | null>((resolve) => {
    const session = pick = { entries: [] as RosterEntryDTO[], sel: current, resolve };
    void objectsOfClass(className).then((entries) => {
      if (pick !== session) return; // closed, or another picker opened, before it loaded
      pick.entries = entries;
      renderPickList('');
    });
  });
}

/** (Re)build the picker list, filtered by `q`, grouped like the roster. */
function renderPickList(q: string): void {
  if (!pick) return;
  const list = $('op-list');
  list.innerHTML = '';
  const needle = q.trim().toLowerCase();
  const hits = pick.entries.filter((e) =>
    !needle || (e.name || e.id).toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle));
  if (!hits.length) { list.innerHTML = '<div class="op-empty">nothing matches</div>'; return; }
  let group: string | undefined;
  for (const e of hits) {
    const g = e.group || '';
    if (g !== (group ?? '')) {
      group = g;
      if (g) { const gh = document.createElement('div'); gh.className = 'op-grp'; gh.textContent = g; list.appendChild(gh); }
    }
    const opt = document.createElement('div');
    opt.className = 'op-opt' + (e.id === pick.sel ? ' sel' : '');
    opt.textContent = e.name || e.id;
    opt.title = e.id;
    opt.addEventListener('click', () => {
      if (!pick) return;
      pick.sel = e.id;
      for (const el of list.querySelectorAll('.op-opt.sel')) el.classList.remove('sel');
      opt.classList.add('sel');
    });
    opt.addEventListener('dblclick', () => closePick(true));
    list.appendChild(opt);
    if (e.id === pick.sel) queueMicrotask(() => opt.scrollIntoView({ block: 'nearest' }));
  }
}

/** Settle the picker: `ok` selects the highlighted id, else cancels (null). */
function closePick(ok: boolean): void {
  const p = pick; pick = null;
  pickDialog().close();
  if (p) p.resolve(ok ? (p.sel || null) : null);
}

$input('op-search').addEventListener('input', (e) => renderPickList((e.currentTarget as HTMLInputElement).value));
$('op-ok').onclick = () => closePick(true);
$('op-cancel').onclick = () => closePick(false);
$('op-close').onclick = () => closePick(false);
pickDialog().addEventListener('click', (e) => { if (e.target === pickDialog()) closePick(false); });
pickDialog().addEventListener('cancel', () => closePick(false)); // Esc

// A create session. `submit` turns the entered name into the href the ref
// should store (creating a file as a side effect); it throws to show an error
// and keep the dialog open. The picker and this share the #objnew dialog.
let creating: { submit: (name: string) => Promise<string>; resolve: (v: string | null) => void } | null = null;

/** Open the create dialog. `typeLabel` shows a fixed Type row (entities) or is
 *  hidden (a plain file). Resolves the created href, or null if cancelled. */
function openCreate(title: string, typeLabel: string | null, nameLabel: string, submit: (name: string) => Promise<string>, defaultName = ''): Promise<string | null> {
  $('on-title').textContent = title;
  $('on-typerow').style.display = typeLabel ? '' : 'none';
  if (typeLabel) $input('on-type').value = typeLabel;
  $('on-namelabel').textContent = nameLabel;
  const name = $input('on-name');
  name.value = defaultName;
  $('on-err').textContent = '';
  newDialog().showModal();
  name.focus(); name.select(); // pre-select the default so a keystroke replaces it
  return new Promise<string | null>((resolve) => { creating = { submit, resolve }; });
}

/** Create a new entity object of a class (writes Name.(Class).xdb in the map).
 *  Prefills a free `Class_00N` handle so it is never empty or a duplicate. */
async function createEntity(className: string): Promise<string | null> {
  let suggested = '';
  try { suggested = (await window.editor.suggestName(className)).name; } catch { /* prefill is optional */ }
  return openCreate(`Create New <${className}> Object`, className, 'Name',
    (name) => window.editor.newEntity({ className, name }).then((r) => { classCache.delete(className); return r.href; }), suggested);
}

/** Name a new text file for a text ref and create it empty at once (so the ref
 *  is never left dangling), returning its basename href. The editor opens next
 *  for content. */
function createText(): Promise<string | null> {
  return openCreate('New text file', null, 'File name', (name) => {
    const href = /\.txt$/i.test(name) ? name : `${name}.txt`;
    return window.editor.writeFile({ href, text: '' }).then(() => href);
  });
}

function submitNew(): void {
  if (!creating) return;
  const name = $input('on-name').value.trim();
  if (!name) { $('on-err').textContent = 'name is required'; return; }
  const { submit, resolve } = creating;
  void submit(name)
    .then((href) => { creating = null; newDialog().close(); resolve(href); })
    .catch((err: unknown) => { $('on-err').textContent = err instanceof Error ? err.message : String(err); });
}
function cancelNew(): void { const c = creating; creating = null; newDialog().close(); if (c) c.resolve(null); }

$('on-ok').onclick = () => submitNew();
$('on-cancel').onclick = () => cancelNew();
$('on-close').onclick = () => cancelNew();
$input('on-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } });
newDialog().addEventListener('click', (e) => { if (e.target === newDialog()) cancelNew(); });
newDialog().addEventListener('cancel', () => cancelNew()); // Esc

/**
 * A structured-reference control: the reference shown inline (read-only), then
 * a "…" browse picker and, where the class is authorable, a "New" button. On a
 * pick/create it commits the new href and updates the shown value in place.
 */
function entityRefControl(className: string, value: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const box = document.createElement('span'); box.className = 'mt-ref';
  const rv = document.createElement('span'); rv.className = 'rv';
  // Edit the referenced object's own fields (map-local: editable; library:
  // shown read-only). Enabled only when something is referenced.
  const edit = document.createElement('button'); edit.textContent = '✎'; edit.title = 'edit the referenced object';
  const show = (v: string): void => { rv.textContent = v || '(none)'; rv.title = v; edit.disabled = !v; };
  show(value);
  const set = (v: string | null): void => { if (v != null) { commit(v); show(v); } };
  const browse = document.createElement('button'); browse.textContent = '…'; browse.title = `pick a ${className}`;
  browse.addEventListener('click', () => { void pickFromClass(className, rv.title).then(set); });
  box.append(rv, browse);
  if (canCreateClass(className)) {
    const nw = document.createElement('button'); nw.textContent = 'New'; nw.title = `create a new ${className}`;
    nw.addEventListener('click', () => { void createEntity(className).then(set); });
    box.appendChild(nw);
  }
  edit.addEventListener('click', () => { if (rv.title) void openEntityEdit(rv.title, className, set); });
  box.appendChild(edit);
  wrap.appendChild(box);
  return wrap;
}

// --- entity document editor (the "✎ Edit" on a structured ref) --------------
//
// Opens the referenced object's own typed fields — a Wind's Angle/Speed, an
// AdvMapBirds' Model, an AmbientLight's colours — read from the document and
// written back per field. Map-local documents are editable; the shipped library
// is shown read-only (use "New" to make an editable copy). The form reuses the
// tree's typed controls (leafControl), rooted at the entity's $def.

const entDialog = (): HTMLDialogElement => {
  const el = $('entedit');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#entedit is not a <dialog>');
  return el;
};
let eeHref = '';
let eeRepoint: ((href: string) => void) | null = null;
let eeClassName = '';
// The $defs root the open document's fields resolve against (map entities vs
// object types), and — for an object type — its class, so a nested Shared field
// resolves to `${type}Shared`.
let eeRoot: HasDefs = mapSchema;
let eeObjType = '';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Open the entity editor for `href`. `onRepoint` (from the ref control) lets a
 *  read-only library entity be copied into the map and the ref re-pointed. */
async function openEntityEdit(href: string, className: string, onRepoint?: (href: string) => void): Promise<void> {
  // Only one entity dialog at a time — a nested ref's Edit would clash with the
  // single <dialog>. Such refs are rare inside these documents; ignore the nest.
  if (entDialog().open) return;
  eeRepoint = onRepoint ?? null;
  eeClassName = className;
  entDialog().showModal();
  await loadEntity(href);
}

/** Read `href` and (re)build the form; used on open and after copy-to-map. */
async function loadEntity(href: string): Promise<void> {
  eeHref = href;
  $('ee-title').textContent = `${eeClassName} — ${href.split('#')[0]}`;
  const note = $('ee-note'); note.textContent = '';
  const host = $('ee-form'); host.innerHTML = '<div class="ph">loading…</div>';
  $('ee-copy').style.display = 'none';
  let res;
  try { res = await window.editor.readEntity(href); }
  catch (e) { host.innerHTML = ''; note.textContent = 'could not read: ' + errMsg(e); return; }
  if (eeHref !== href) return; // a later load won the race
  const sc = schemaForClass(res.className);
  eeRoot = sc?.root ?? mapSchema;
  eeObjType = sc && objectSchema.types[res.className] ? res.className : '';
  const rootField = sc ? deref(eeRoot, sc.field) : inferField(res.tree as TreeData);
  const fs = document.createElement('fieldset');
  fs.className = 'ee-fs' + (res.editable ? '' : ' ee-form-ro');
  fs.style.border = '0'; fs.style.padding = '0'; fs.style.margin = '0'; fs.style.minInlineSize = '0';
  fs.disabled = !res.editable;
  fillEntity(fs, rootField, res.tree as TreeData, []);
  host.innerHTML = ''; host.appendChild(fs);
  // A library entity is read-only; offer to copy it into the map to edit — but
  // only when the ref control gave us a way to re-point at the copy.
  note.textContent = res.editable ? '' : 'Read-only — from the shipped library. Save a copy in the map to edit it.';
  $('ee-copy').style.display = !res.editable && eeRepoint ? '' : 'none';
}

/** Copy the shipped-library entity into the map and switch to editing the copy. */
async function copyEntityToMap(): Promise<void> {
  try {
    const r = await window.editor.copyEntityToMap(eeHref);
    if (eeRepoint) eeRepoint(r.href);
    markDirty(true);
    await loadEntity(r.href);
  } catch (e) { $('ee-note').textContent = 'copy failed: ' + errMsg(e); }
}

/** Commit one entity field to disk, then reflect dirty. */
async function entitySet(path: TreePath, value: string): Promise<void> {
  try { await window.editor.setEntityPath({ href: eeHref, path, value }); markDirty(true); $('hud').textContent = `${path.join('.')} = ${value || '(empty)'}`; }
  catch (e) { $('hud').textContent = 'entity edit failed: ' + errMsg(e); }
}

/** Fill a container with an entity object's fields, schema-typed, recursing into
 *  nested objects. Arrays are shown read-only (rare in these documents). */
function fillEntity(container: HTMLElement, field: FieldSchema, data: TreeData | undefined, path: TreePath): void {
  const props = field.properties ?? {};
  const dataKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  const seen = new Set<string>();
  const keys = [...Object.keys(props), ...dataKeys];
  if (!keys.length) { const p = document.createElement('div'); p.className = 'ph'; p.textContent = 'no fields'; container.appendChild(p); return; }
  for (const k of keys) {
    if (seen.has(k)) continue; seen.add(k);
    const cf = props[k] ? deref(eeRoot, props[k]) : inferField(dataAt(data, k));
    container.appendChild(entNode(k, cf, dataAt(data, k), [...path, k]));
  }
}

/** One entity field: a nested object becomes a collapsible group; everything
 *  else a typed row (arrays are shown read-only). */
function entNode(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath): HTMLElement {
  const c = controlOf(field);
  if (c === 'group' && field.type !== 'array') {
    const grp = document.createElement('div'); grp.className = 'mt-grp';
    const head = document.createElement('div'); head.className = 'mt-ghead';
    const tw = document.createElement('span'); tw.className = 'tw'; tw.textContent = '▸';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = field.title || name;
    head.append(tw, nm);
    const kids = document.createElement('div'); kids.className = 'mt-kids collapsed';
    let filled = false;
    head.addEventListener('click', () => {
      const open = kids.classList.toggle('collapsed') === false;
      tw.textContent = open ? '▾' : '▸';
      if (open && !filled) { filled = true; fillEntity(kids, field, data, path); }
    });
    grp.append(head, kids);
    return grp;
  }
  const row = document.createElement('div'); row.className = 'mt-row';
  const label = document.createElement('label'); label.textContent = field.title || name; label.title = name;
  row.appendChild(label);
  if (c === 'group') { // an array — read-only summary for now
    const ro = document.createElement('span'); ro.className = 'ro';
    ro.textContent = Array.isArray(data) ? `[${data.length} items]` : '(list)';
    row.appendChild(ro);
  } else {
    const value = typeof data === 'string' ? data : '';
    const commit = (v: string): void => void entitySet(path, v);
    // An object document's Shared identity resolves to `${type}Shared` — give it
    // the type-constrained picker, which leafControl can't (it has no objType).
    const cls = field['x-shared'] ? classOf(field, eeObjType) : null;
    row.appendChild(cls ? entityRefControl(cls, value, commit) : leafControl(field, value, commit));
  }
  return row;
}

$('ee-done').onclick = () => entDialog().close();
$('ee-close').onclick = () => entDialog().close();
$('ee-copy').onclick = () => void copyEntityToMap();
entDialog().addEventListener('click', (e) => { if (e.target === entDialog()) entDialog().close(); });

$('maptreebtn').onclick = () => { if (mapTreeOpen()) closeMapTree(); else openMapTree(); };
$('mt-close').onclick = () => closeMapTree();
$input('mt-adv').addEventListener('change', (e) => { mtShowAdvanced = (e.currentTarget as HTMLInputElement).checked; if (mapTreeOpen()) void refreshMapTree(); });

$('mapbtn').onclick = () => { if (mapPropsOpen()) closeMapProps(); else openMapProps(); };
$('mp-close').onclick = () => closeMapProps();
// Tabs are built dynamically (buildMpTabs), each with its own click handler.
// A click on the backdrop lands on the dialog element itself (the card stops its
// own clicks), so that dismisses — the one behaviour <dialog> leaves to us. Esc,
// the backdrop paint and focus are the platform's.
mapDialog().addEventListener('click', (e) => { if (e.target === mapDialog()) closeMapProps(); });

// Keyboard shortcuts for the selection. Registered separately from the WASD set
// because those are held-key state and these are one-shot actions. The rotate
// keys sit next to each other on the keyboard and are free: WASD pans and the
// brush owns no keys.
// Undo/redo are the one pair that must work while typing is NOT happening but
// with a modifier held, so they are checked before the selection shortcuts —
// which bail out on any modifier.
addEventListener('keydown', (e) => {
  if (isTyping(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const z = e.code === 'KeyZ', y = e.code === 'KeyY';
  if (!z && !y) return;
  e.preventDefault();
  void stepHistory(y || e.shiftKey ? 'redo' : 'undo');
});

addEventListener('keydown', (e) => {
  if (!selected || isTyping(e.target) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  const cur = snap90(degOf(selected.inst.r));
  if (e.code === 'BracketLeft') { void rotateSelected(cur - 90); }
  else if (e.code === 'BracketRight') { void rotateSelected(cur + 90); }
  else if (e.code === 'Delete') { void deleteSelected(); }
  else return;
  e.preventDefault();
});

// --- pointer: orbit / select / move ---
//
// The map is densely covered with objects, so we must NOT hijack every drag for
// object-moving or the camera could never orbit. Rules:
//   * A plain click (no drag) selects the object under the cursor (or clears).
//   * The camera orbits on any drag EXCEPT when the drag starts on the object
//     that is already selected — that drag moves it. So: click to select, then
//     drag it to move. Orbiting stays available everywhere else.
const CLICK_SLOP = 5; // px; movement under this = a click, not a drag
let down: { sx: number; sy: number; hitId: string | null } | null = null; // { sx, sy, hitId }
let dragging = false, moved = false;
// [perf] The plain hover marker needs a full-terrain raycast, which is the most
// expensive thing a pointermove can do (≈6ms on a 256² map — brute force, three
// has no BVH). A high-poll mouse fires many moves per frame, so the raycast is
// deferred: the latest move is stashed here and resolved once, in the render
// loop, right before drawing. Many moves between frames now cost one raycast.
let hoverEv: PointerEvent | null = null;

function pickObject(ev: PointerEvent): THREE.Mesh | null {
  if (!showObjects) return null; // hidden objects must not swallow clicks
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, activeCam);
  const hits = raycaster.intersectObjects<THREE.Mesh>([...activeFloor().meshes.values()], false);
  return hits.length ? hits[0]!.object : null;
}

renderer.domElement.addEventListener('pointerleave', () => { updateBrushCursor(null); updateHoverCursor(null); hoverEv = null; });

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (!world || ev.button !== 0) return;
  // With the brush armed, left-drag paints instead of orbiting. Middle and
  // right still move the camera, so the view stays reachable mid-stroke.
  if (brushOn) {
    painting = true;
    controls.enabled = false;
    strokeVerts.clear();
    riverHeights.clear();
    lastTile = -1; lastTick = 0;   // a new stroke always applies its first tick
    rectAnchor = rectMode ? tileUnderCursor(ev) : null;
    applyBrush(ev);
    return;
  }
  // With an object armed, a click places it — but a DRAG still orbits, so the
  // camera stays usable without disarming. Which it was is only known on
  // pointerup, so nothing is decided here beyond remembering where it started.
  if (placeObject) {
    down = { sx: ev.clientX, sy: ev.clientY, hitId: null };
    return;
  }
  const hit = pickObject(ev);
  down = { sx: ev.clientX, sy: ev.clientY, hitId: hit ? hit.userData.inst.id : null };
  // Grab-to-move only when pressing on the already-selected object.
  if (selected && hit && hit.userData.inst.id === selected.id) {
    dragging = true; moved = false;
    controls.enabled = false;
  }
  // Otherwise leave controls enabled so this drag orbits the camera.
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  // [perf] While a mouse button is held and we are neither painting nor moving
  // an object, the user is orbiting or panning the camera. That gesture wants no
  // cursor gizmo, and running a terrain raycast on every one of its many moves is
  // exactly what made dragging the map crawl. Bail before any raycast.
  if (ev.buttons !== 0 && !painting && !dragging) {
    updateBrushCursor(null); updateHoverCursor(null); hoverEv = null;
    return;
  }
  // Track the footprint on every move, painting or not -- the point of the
  // gizmo is to show where a stroke WOULD land before committing to one.
  if (brushOn) updateBrushCursor(tileUnderCursor(ev));
  // The armed object borrows the brush's footprint gizmo, so where it will land
  // is visible before committing — the same feedback painting gets.
  else if (placeObject) updateBrushCursor(tileUnderCursor(ev));
  // Otherwise show the plain one-tile marker, but not mid-drag: the object being
  // dragged already says where it is, and a second square trailing it is noise.
  // The raycast for it is deferred to the frame loop (see hoverEv) so a burst of
  // moves between two frames resolves to a single pick.
  if (!brushOn && !placeObject && !dragging) hoverEv = ev;
  else { updateHoverCursor(null); hoverEv = null; }
  // A move with no button held cannot belong to a stroke. If `painting` survived
  // one, the pointerup was lost — the window took focus elsewhere, or the event
  // was swallowed — and the brush would go on painting under a released button.
  // For a person that is a brush stuck on; while rebuilding C1M1 it showed up as
  // a handful of vertices out of 9409 carrying a stroke twice, a different
  // handful each run. End the stroke here instead, and flush what it did.
  if (painting && ev.buttons === 0) {
    painting = false;
    controls.enabled = true;
    void commitBrush();
    return;
  }
  if (painting) { applyBrush(ev); return; }
  if (!dragging || !selected) return;
  // Project the cursor onto a horizontal plane at the object's height and snap
  // the resulting world position to the tile grid.
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, activeCam);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -selected.mesh.position.z);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return;
  // The ray lands in world units; the object's position is a CELL index, the
  // same floor() convention placement uses, so a drag lands on the same square a
  // fresh placement would rather than snapping half a tile across to the corner.
  const nx = Math.floor(hit.x / U), ny = Math.floor(hit.y / U);
  if (nx === selected.inst.x && ny === selected.inst.y) return;
  selected.inst.x = nx; selected.inst.y = ny;
  selected.mesh.position.set(tileCenter(nx), tileCenter(ny), heightAt(nx, ny));
  syncInstance(activeFloor(), selected.inst);
  syncFootprints();
  boxHelper?.setFromObject(selected.mesh);
  moved = true;
  updatePanel();
});

addEventListener('pointerup', async (ev) => {
  if (painting) {
    painting = false;
    controls.enabled = true;
    // Rect did nothing while dragging: this is where the rectangle lands.
    if (rectMode && rectAnchor) {
      const r = currentRect(ev);
      if (r) applyRect(r);
      rectAnchor = null;
    }
    await commitBrush();
    return;
  }
  if (!world || !down) return;
  const wasClick = Math.abs(ev.clientX - down.sx) < CLICK_SLOP && Math.abs(ev.clientY - down.sy) < CLICK_SLOP;

  if (placeObject) {
    down = null;
    if (!wasClick) return; // that was an orbit
    const tile = tileUnderCursor(ev);
    if (!tile) { $('hud').textContent = 'click on the terrain to place'; return; }
    await placeAt(tile);
    return;
  }

  if (dragging) {
    dragging = false; controls.enabled = true;
    if (moved && selected) {
      await window.editor.moveObject(selected.id, selected.inst.x, selected.inst.y);
      markDirty(true);
    }
  } else if (wasClick) {
    // A click that didn't move the camera: (de)select.
    if (down.hitId) selectById(down.hitId); else deselect();
  }
  down = null;
});

// --- terrain brush ---------------------------------------------------------
//
// Painting is applied twice: into the mask texture on the GPU, so the stroke
// appears under the cursor with no round trip, and — on pointer-up — into the
// main process, which owns the bytes that get saved. The two use the same rule
// (target layer to full strength, every other layer cleared at that vertex),
// because the shader composites by priority: raising the target alone would
// leave any higher-priority layer sitting on top of the new paint.
//
// The renderer's copy is never read back. A reload always takes what the main
// process wrote, so the GPU copy drifting would show up immediately rather than
// corrupting anything.

let brushOn = false;
let brushSize = 1;         // in tiles: 1, 3, 5, 7
let painting = false;
/** Vertices touched by the stroke in progress, deduped. */
const strokeVerts = new Set<number>();

// --- passability overlay ----------------------------------------------------
//
// The original editor's Masks tab paints impassable ground and shows it as a
// red wash. This shows the same thing, and ONLY that: the mask plane is the
// whole truth about blocking.
//
// It is tempting to also paint water red, on the grounds that you cannot walk
// there. That is backwards. Sea carries ground flag 0, which means NAVIGABLE —
// boats cross it — so it is not blocked at all, and the shipped maps agree:
// flag-0 vertices are masked 6.4% of the time against a 9.0% background, i.e.
// less often than average, precisely because there is nothing to block. A small
// pond that a designer wants closed off gets masked by hand like anything else.

let showBlocked = uiPrefs.grid;

/** Draw order for the sea sheet; the ground overlay lands underneath it. */
const WATER_ORDER = 2;

/**
 * A drop across one tile that a unit cannot climb.
 *
 * Every cell straddling a ground-kind boundary carries a step of 0.8 or more
 * (200 of 200 on map 12, 216 of 216 on A1M5), which is the mesher's own signal
 * for cutting a vertical face — so anything at or above it is a cliff edge.
 * Ordinary slopes inside one kind stay well under.
 */
const CLIFF_STEP = 0.8;

/**
 * How a tile reads for movement. Three states, because "can I walk here" and
 * "is this blocked" are different questions and the map answers them separately:
 * a lake stops a footman and carries a boat, and the format says so with the
 * ground flag rather than the mask.
 */
const PASS_WALK = 0, PASS_BLOCKED = 1, PASS_NAVIGABLE = 2;

/**
 * Classify every tile of a floor. Index = y*(V-1) + x.
 *
 * Blocking is a UNION, not just the mask. The mask records what a designer
 * decided by hand, and on a map where nobody opened the Masks tab it is empty —
 * Senya's map 12 has the plane at all ones despite being full of rivers and
 * cliffs. The rest is inherent to the terrain and the engine derives it:
 *
 *   * the river plane — you do not wade a river, which is why bog and lava
 *     flows stop you without anyone marking them,
 *   * a step too tall to climb, i.e. a cut face between plateau and ground.
 *
 * Navigable (sea) is not blocking: a boat crosses it.
 *
 * The passability plane is stored vertex-sized but addressed PER TILE — entry
 * (x, y) is tile (x, y), last row and column filler. Reading it as four corners
 * made a 1x1 mask stroke show up as 3x3.
 */
function classifyTiles(fl: Floor3D): Uint8Array {
  const V = fl.V, T = V - 1;
  const out = new Uint8Array(T * T); // zero-filled, and PASS_WALK is 0
  const water = (v: number): boolean => fl.flags ? fl.flags[v] === 0 : false;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const a = y * V + x, b = a + 1, c = a + V, d = c + 1;
    // Sea first: it is crossed by boat, so it is neither walkable nor blocked.
    if (water(a) && water(b) && water(c) && water(d)) { out[y * T + x] = PASS_NAVIGABLE; continue; }

    if (fl.passable && fl.passable[a] === 0) { out[y * T + x] = PASS_BLOCKED; continue; }
    if (fl.river.has(a) || fl.river.has(b) || fl.river.has(c) || fl.river.has(d)) {
      out[y * T + x] = PASS_BLOCKED; continue;
    }
    // A ramp is a deliberate walkable incline, and its half-step of 1.0 is taller
    // than the cliff threshold — so the slope rule would mark the one thing on
    // the map built to be climbed. The mesher skips ramp cells for the same
    // reason; this has to agree with it or the view contradicts the geometry.
    const ramp = fl.flags
      ? ((fl.flags[a]! | fl.flags[b]! | fl.flags[c]! | fl.flags[d]!) & 8) !== 0
      : false;
    if (ramp) continue;
    const h = [fl.heights[a]!, fl.heights[b]!, fl.heights[c]!, fl.heights[d]!];
    if (Math.max(...h) - Math.min(...h) > CLIFF_STEP) out[y * T + x] = PASS_BLOCKED;
  }
  return out;
}

/**
 * The terrain's own triangles for every tile of one class, lifted a hair.
 *
 * Not a flat quad per tile: a cell straddling a cut is split marching-squares
 * style into several triangles at different heights, and a quad laid across it
 * floats over the hole or pokes through the cliff face. Reusing the ground's
 * triangulation makes the overlay hug whatever the ground actually does — which
 * is why a half-submerged tile at a lake edge shows up as a triangle, exactly
 * as it does in the original editor.
 */
function tileFill(fl: Floor3D, cls: Uint8Array, want: number): THREE.BufferGeometry {
  const src = fl.terrainMesh.geometry;
  const pos = src.getAttribute('position');
  const index = src.getIndex();
  const triTile = src.userData.triTile as Int32Array | undefined;
  const out: number[] = [];
  const LIFT = 0.05;
  if (pos && index && triTile) {
    for (let t = 0; t < triTile.length; t++) {
      const tile = triTile[t]!;
      if (cls[tile] !== want) continue;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k);
        out.push(pos.getX(v), pos.getY(v), pos.getZ(v) + LIFT);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  g.computeBoundingSphere();
  return g;
}

/** Outline of every tile of one class. */
function tileOutline(fl: Floor3D, cls: Uint8Array, want: number): THREE.BufferGeometry {
  const V = fl.V, T = V - 1;
  const pos: number[] = [];
  const LIFT = 0.1;
  const z = (x: number, y: number): number => fl.heights[y * V + x]! + LIFT;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (cls[y * T + x] !== want) continue;
    const c: [number, number][] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = c[k]!, [bx, by] = c[(k + 1) % 4]!;
      pos.push(ax, ay, z(ax, ay), bx, by, z(bx, by));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * The tile grid itself, following the ground.
 *
 * Movement in this game is per tile, so a wash of colour is only half the
 * answer — you also need to count squares to know whether a gap is passable.
 * Drawn for the whole floor at once: a 137x137 map is ~37k segments, which is
 * one buffer and no measurable cost.
 */
function tileGrid(fl: Floor3D): THREE.BufferGeometry {
  const V = fl.V;
  const LIFT = 0.06;
  const pos: number[] = [];
  const z = (x: number, y: number): number => fl.heights[y * V + x]! + LIFT;
  for (let y = 0; y < V; y++) for (let x = 0; x < V - 1; x++) {
    pos.push(x, y, z(x, y), x + 1, y, z(x + 1, y));
  }
  for (let x = 0; x < V; x++) for (let y = 0; y < V - 1; y++) {
    pos.push(x, y, z(x, y), x, y + 1, z(x, y + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeBoundingSphere();
  return g;
}

/** Rebuild the passability view for a floor. */
function refreshBlocked(fl: Floor3D): void {
  for (const m of fl.passMeshes) {
    fl.group.remove(m);
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  }
  fl.passMeshes = [];
  // Footprints ride with the grid: rebuilt when it is on, cleared when off.
  // Done before the early return so turning the grid off actually removes them
  // rather than leaving the last set on the ground.
  refreshFootprints(fl);
  if (!showBlocked) return;

  const cls = classifyTiles(fl);
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, lines = false): void => {
    if (!g.getAttribute('position')?.count) { g.dispose(); mat.dispose(); return; }
    const mesh = asTileSpace(lines ? new THREE.LineSegments(g, mat) : new THREE.Mesh(g, mat));
    // The mask belongs to the GROUND, and water is a separate sheet lying over
    // it. Drawing before the sheet lets the sea tint what shows through, the way
    // a masked pond reads in the original editor: the bed is red, not the water.
    // Drawn last instead, it was a flat red film on top of the sea.
    mesh.renderOrder = WATER_ORDER - 1;
    fl.passMeshes.push(mesh as THREE.Mesh);
    fl.group.add(mesh);
  };

  const fill = (c: number, o: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false,
  });
  // Bright and fairly opaque: this wash sits on ground that is already dark
  // rock or dirt half the time, and at 0.45 of a muted red it vanished into it.
  add(tileFill(fl, cls, PASS_BLOCKED), fill(0xff2020, 0.62));
  // Navigable water is outlined ON TOP of the sea rather than filled under it.
  // A fill beneath the sheet is invisible; a fill above it hides the water
  // texture, which is most of what makes a lake readable. An outline says "boat
  // goes here" and leaves the water looking like water.
  const navGrid = tileOutline(fl, cls, PASS_NAVIGABLE);
  if (navGrid.getAttribute('position')?.count) {
    const m = asTileSpace(new THREE.LineSegments(navGrid, new THREE.LineBasicMaterial({
      color: 0x6fb2ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
    })));
    m.renderOrder = WATER_ORDER + 1;
    fl.passMeshes.push(m as unknown as THREE.Mesh);
    fl.group.add(m);
  } else navGrid.dispose();
  add(tileGrid(fl), new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false,
  }), true);
}

// The roles a building declares tiles for, with the colour each is drawn in.
// Ordered back-to-front: hole and passable first, then blocked, then the active
// tile on top, so where they overlap the more important one wins. Red blocked
// and green active are the pair Senya named; hole and passable get their own
// colours rather than being folded into those.
const FOOT_ROLES: [keyof Footprint, number, number][] = [
  ['hole', 0x9b59ff, 0.32],
  ['passable', 0xe8d23a, 0.32],
  ['blocked', 0xff2020, 0.5],
  ['active', 0x2ad04a, 0.62],
];

/** Merged footprint squares for one role across every building on the floor. */
function footprintQuads(fl: Floor3D, role: keyof Footprint): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const inst of fl.instances) {
    const tiles = geomFootprint.get(inst.g)?.[role];
    if (!tiles || !tiles.length) continue;
    const cos = Math.cos(inst.r), sin = Math.sin(inst.r);
    // A tile (x, y) is the cell spanning grid [x, x+1] — its centre is at
    // (x+0.5, y+0.5), the same convention classifyTiles/tileOutline use. The
    // object sits at the cell's corner vertex, so anchor the footprint at the
    // cell centre; without the half-tile the squares straddled the grid lines.
    const ax = inst.x + 0.5, ay = inst.y + 0.5;
    for (const t of tiles) {
      // The tile's centre: the object's own cell plus this offset, turned with
      // the object so a rotated building's footprint rotates with it.
      const cx = ax + t.x * cos - t.y * sin;
      const cy = ay + t.x * sin + t.y * cos;
      // Each corner is sampled against the ground it sits over, so the square
      // hugs a slope instead of floating flat above it.
      const corner = (ox: number, oy: number): number[] => {
        const gx = cx + ox * cos - oy * sin;
        const gy = cy + ox * sin + oy * cos;
        return [gx, gy, heightOn(fl, gx, gy) + 0.06];
      };
      const a = corner(-0.5, -0.5), b = corner(0.5, -0.5), c = corner(0.5, 0.5), d = corner(-0.5, 0.5);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/**
 * Rebuild the building footprint squares. Kept apart from refreshBlocked's
 * passability wash because it only walks the placed objects, not the whole
 * V×V grid, so moving or rotating an object can refresh it cheaply.
 *
 * Drawn depth-test off, above the models: the original shows these as an
 * overlay lying over the building, not tucked under it.
 */
function refreshFootprints(fl: Floor3D): void {
  for (const m of fl.footMeshes) {
    fl.group.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  fl.footMeshes = [];
  if (!showBlocked) return;
  for (const [role, color, opacity] of FOOT_ROLES) {
    const g = footprintQuads(fl, role);
    if (!g.getAttribute('position')?.count) { g.dispose(); continue; }
    const mesh = asTileSpace(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      depthWrite: false, depthTest: false,
    })));
    mesh.renderOrder = 900;
    fl.footMeshes.push(mesh as THREE.Mesh);
    fl.group.add(mesh);
  }
}

/** Refresh a floor's footprints if the grid is showing; a no-op otherwise. */
function syncFootprints(fl: Floor3D = activeFloor()): void {
  if (showBlocked) refreshFootprints(fl);
}

function setShowBlocked(on: boolean): void {
  showBlocked = on;
  $('blockbtn').classList.toggle('on', on);
  $('passlegend').style.display = on ? 'flex' : 'none';
  if (world) for (const fl of world.floors) refreshBlocked(fl);
  saveUiPrefs({ grid: on });
}

/** Paint or erase the mask under the brush. */
function maskAt(tiles: number[], walkable: boolean): void {
  const fl = activeFloor();
  if (!fl.passable) return;
  const fresh = tiles.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) return;
  for (const v of fresh) {
    strokeVerts.add(v);
    fl.passable[v] = walkable ? 1 : 0;
  }
  // The overlay is the only feedback this brush has, so force it on: masking
  // blind would be indistinguishable from the tool not working.
  if (!showBlocked) setShowBlocked(true); else refreshBlocked(fl);
}

/** Send the finished mask stroke. */
async function commitMask(walkable: boolean): Promise<void> {
  if (!strokeVerts.size || !world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  try {
    await committing(window.editor.setMask({ floor: world.active, verts, walkable }));
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'mask failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

// --- brush cursor ----------------------------------------------------------
//
// The system cursor says nothing about what a stroke will cover: the brush is
// square, sized in tiles, and lands on the grid, none of which an arrow conveys.
// So the arrow is hidden while the brush is armed and replaced by the footprint
// drawn on the ground — every cell it will touch, following the terrain.
//
// Drawn with depthTest off so it stays readable inside a pit or behind a hill.
// A gizmo that disappears exactly where the ground is interesting is worse than
// none, and a depth offset large enough to survive a cliff would float visibly
// over flat ground.

let brushCursor: THREE.LineSegments | null = null;

function ensureBrushCursor(): THREE.LineSegments {
  if (brushCursor) return brushCursor;
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false,
  });
  brushCursor = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  brushCursor.renderOrder = 999;
  brushCursor.visible = false;
  scene.add(brushCursor);
  return brushCursor;
}

/** Redraw the footprint outline over tile (cx, cy), or hide it when off-map. */
function updateBrushCursor(at: { x: number; y: number } | null): void {
  const c = ensureBrushCursor();
  if (!at || !world) { c.visible = false; return; }
  const fl = activeFloor();
  // Mid-drag in Rect mode the footprint is the rectangle so far, not a square
  // under the cursor — otherwise the one size whose shape you choose yourself is
  // the one size you cannot see before committing to it.
  const r = rectMode && rectAnchor
    ? { x0: Math.min(rectAnchor.x, at.x), y0: Math.min(rectAnchor.y, at.y),
        x1: Math.max(rectAnchor.x, at.x), y1: Math.max(rectAnchor.y, at.y) }
    : squareRect(at.x, at.y, rectMode ? 1 : brushSize);
  const LIFT = 0.05; // just clear of the surface, so it reads as lying on it
  const z = (x: number, y: number): number => {
    const cx = Math.min(fl.V - 1, Math.max(0, x)), cy = Math.min(fl.V - 1, Math.max(0, y));
    return fl.heights[cy * fl.V + cx]! + LIFT;
  };
  const pts: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    pts.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  // Every cell edge in the footprint, so the grid reads as tiles rather than
  // one box — the brush works per tile and should look like it.
  for (let y = r.y0; y <= r.y1 + 1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (y < 0 || y >= fl.V || x < 0 || x + 1 >= fl.V) continue;
      seg(x, y, x + 1, y);
    }
  }
  for (let x = r.x0; x <= r.x1 + 1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      if (x < 0 || x >= fl.V || y < 0 || y + 1 >= fl.V) continue;
      seg(x, y, x, y + 1);
    }
  }
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.computeBoundingSphere();
  c.visible = pts.length > 0;
}

// A quiet one-tile marker that follows the mouse whenever no brush or object is
// armed, so it is always clear which square a click would act on — the same job
// the brush gizmo does while armed, kept up the rest of the time.
let hoverCursor: THREE.LineSegments | null = null;

function ensureHoverCursor(): THREE.LineSegments {
  if (hoverCursor) return hoverCursor;
  const mat = new THREE.LineBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.7, depthTest: false,
  });
  hoverCursor = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  hoverCursor.renderOrder = 998; // just under the brush gizmo's 999
  hoverCursor.visible = false;
  scene.add(hoverCursor);
  return hoverCursor;
}

/** Outline the single cell under the cursor, or hide it when off-map. */
function updateHoverCursor(at: { x: number; y: number } | null): void {
  const c = ensureHoverCursor();
  const fl = world ? activeFloor() : null;
  // A cell (x, y) needs its far corner (x+1, y+1) to exist, so stop one short.
  if (!at || !fl || at.x < 0 || at.y < 0 || at.x + 1 >= fl.V || at.y + 1 >= fl.V) {
    c.visible = false; return;
  }
  const LIFT = 0.05;
  const z = (x: number, y: number): number => fl.heights[y * fl.V + x]! + LIFT;
  const x = at.x, y = at.y;
  const p: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    p.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  seg(x, y, x + 1, y); seg(x + 1, y, x + 1, y + 1);
  seg(x + 1, y + 1, x, y + 1); seg(x, y + 1, x, y);
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.computeBoundingSphere();
  c.visible = true;
}

/** Tile under the cursor, from a ray against the terrain itself (so it follows hills). */
function tileUnderCursor(ev: PointerEvent): { x: number; y: number } | null {
  return tileAtClient(ev.clientX, ev.clientY);
}

/**
 * The VERTEX nearest the cursor — the grid corner, not the tile.
 *
 * Heights live on vertices, and a map has one more of them per side than it has
 * tiles, so the outermost row and column can only be addressed this way. It
 * rounds where the tile pick floors, off the same ray.
 */
function vertexAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const V = activeFloor().V;
  const x = Math.round(p.x / U), y = Math.round(p.y / U);
  if (x < 0 || y < 0 || x >= V || y >= V) return null;
  return { x, y };
}

/** Same, from bare client coordinates — what the automation hook picks with. */
function tileAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const T = activeFloor().V - 1;
  const x = Math.floor(p.x / U), y = Math.floor(p.y / U);
  if (x < 0 || y < 0 || x >= T || y >= T) return null;
  return { x, y };
}

/**
 * The ground position under the pointer, in world units.
 *
 * In the plan view the ray is vertical, so where it lands on the ground plane
 * follows from the camera alone — and taking it from the camera is not just
 * cheaper but MORE correct than asking what the ray hit. A cut face between two
 * tiers stands vertical, edge-on to this camera, and a ray grazing one reports a
 * hit sitting exactly on the grid line between two vertices; rounding that
 * lands on the neighbour. Rebuilding C1M1 that way put 18 of 9409 vertices on
 * the wrong side of a steep step, every one of them beside a tall spike.
 *
 * The 3D view has no such shortcut: there the ray is oblique and the ground's
 * height is what decides where it meets, so it still asks the geometry.
 */
function groundPointAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!world) return null;
  if (topView) {
    syncTopCamera();
    const aspect = innerWidth / innerHeight;
    const ndcX = (clientX / innerWidth) * 2 - 1, ndcY = -(clientY / innerHeight) * 2 + 1;
    return {
      x: topCamera.position.x + ndcX * topHalf * aspect,
      y: topCamera.position.y + ndcY * topHalf,
    };
  }
  const p = hitPointAtClient(clientX, clientY);
  return p ? { x: p.x, y: p.y } : null;
}

/** Where a ray through these client coordinates meets the ground, in world units. */
function hitPointAtClient(clientX: number, clientY: number): THREE.Vector3 | null {
  if (!world) return null;
  ptr.x = (clientX / innerWidth) * 2 - 1;
  ptr.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, activeCam);
  const ground = activeFloor().terrainMesh;
  // The raycaster tests against matrixWorld, and three.js only refreshes that
  // while rendering. The ground carries a real transform now — it is built in
  // grid space and stretched to tile spacing — so a stale matrix is no longer
  // harmlessly the identity: it aims the ray at a map half the size and every
  // pick misses. Cheap to make certain, and it removes the dependency on a
  // frame having been drawn between the mesh appearing and the first click.
  ground.updateMatrixWorld();
  const hit = raycaster.intersectObject(ground, false)[0];
  // intersectObject reports the hit in world units, whatever the mesh's own
  // transform; the callers divide by U to get grid coordinates.
  return hit ? hit.point : null;
}

// --- automation hook: where to click for a tile ------------------------------
//
// Rebuilding a shipped mission means driving this editor the way a person does —
// real clicks on real tiles (docs/E2E_RECONSTRUCTION.md) — and a click needs a
// pixel. Under the plan camera that mapping is exact and height-independent (see
// the top-down camera above), so it is published here, next to the camera it
// depends on, rather than reimplemented inside the tests: if the view changes,
// one function moves and every test follows.
//
// This is deliberately only about WHERE to click. Which tool is armed, what is
// painted and what gets saved all go through the ordinary UI, because that is
// what the reconstruction is meant to prove.

/** Screen position of a tile, and whether it is actually in the viewport. */
interface TilePoint { x: number; y: number; onScreen: boolean }

interface ViewApi {
  /** Switch the plan (2D) view on or off — the same call the toolbar makes. */
  plan(on: boolean): void;
  /** Fit the whole active floor in the plan view. */
  fit(): void;
  /** Centre the plan view on a tile, so tiles near it are clickable. */
  focus(x: number, y: number): void;
  /** Plan-view zoom, as the number of tiles spanned from the centre to the top edge. */
  zoom(halfTiles: number): void;
  /** Where to click for the centre of tile (x, y), in CSS pixels. */
  tileToScreen(x: number, y: number): TilePoint;
  /** Which tile a click at these CSS pixels lands on — the app's own picking. */
  tileAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Where to click for grid VERTEX (x, y) — what the vertex brush addresses. */
  vertexToScreen(x: number, y: number): TilePoint;
  /** Which vertex a click at these CSS pixels lands on — the app's own picking. */
  vertexAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Where to click for river-plane cell (x, y) — the half-tile grid. */
  cellToScreen(x: number, y: number): TilePoint;
  /** Which river cell a click at these CSS pixels lands on. */
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Cells per side of the river plane, or 0 when no map is open. */
  cells(): number;
  /** The active floor's live heights and ground kinds — what the app believes. */
  heights(): number[];
  kinds(): number[];
  /** True once the ground textures are decoded and a stroke would land. */
  paintReady(): boolean;
  /** Edits sent to the main process and not yet acknowledged. */
  pending(): number;
  /**
   * Open a map by path, the way the Open dialog does.
   *
   * `window.editor.loadMap` is only the main-process half; the scene, the title
   * and the toolbar all come from the renderer's own open path, which the file
   * dialog normally drives and a test cannot.
   */
  open(path: string): Promise<void>;
  /** Tiles per side of the active floor, or 0 when no map is open. */
  size(): number;
}

/** A world point under the plan camera, in CSS pixels. */
function worldToScreen(wx: number, wy: number): TilePoint {
  // The camera is re-synced first: its frustum follows the orbit target and the
  // viewport, and both can have moved since the last frame was drawn.
  syncTopCamera();
  const aspect = innerWidth / innerHeight;
  const ndcX = (wx - topCamera.position.x) / (topHalf * aspect);
  const ndcY = (wy - topCamera.position.y) / topHalf;
  const px = ((ndcX + 1) / 2) * innerWidth, py = ((1 - ndcY) / 2) * innerHeight;
  return { x: px, y: py, onScreen: px >= 0 && py >= 0 && px < innerWidth && py < innerHeight };
}

const view: ViewApi = {
  plan(on) { setTopView(on); },
  fit() {
    if (!world) return;
    const V = activeFloor().V, c = (V / 2) * U;
    controls.target.set(c, c, controls.target.z);
    topHalf = V * 0.55 * U;
    syncTopCamera();
  },
  focus(x, y) {
    if (!world) return;
    controls.target.set((x + 0.5) * U, (y + 0.5) * U, controls.target.z);
    syncTopCamera();
  },
  zoom(halfTiles) {
    topHalf = Math.max(2 * U, Math.min(400 * U, halfTiles * U));
    syncTopCamera();
  },
  tileToScreen(x, y) { return worldToScreen((x + 0.5) * U, (y + 0.5) * U); },
  tileAt(clientX, clientY) { return tileAtClient(clientX, clientY); },
  // A vertex sits ON the grid line, at a whole multiple of the tile spacing —
  // which is why the outermost row and column exist at all.
  //
  // A vertex on the map's edge sits exactly on the boundary of the terrain
  // mesh, and a ray aimed there is as likely to pass beside it as to hit it, so
  // the point is pulled a quarter tile inwards. The pick rounds to the nearest
  // vertex, so it still resolves to the same one — but it now lands on ground.
  // Without this, every click along the outer ring silently does nothing.
  vertexToScreen(x, y) {
    const last = world ? activeFloor().V - 1 : 0;
    const inset = (v: number): number => (v === 0 ? 0.25 : v === last ? -0.25 : 0);
    return worldToScreen((x + inset(x)) * U, (y + inset(y)) * U);
  },
  vertexAt(clientX, clientY) { return vertexAtClient(clientX, clientY); },
  // Cells sit every half tile, and the outermost ring gets the same inward nudge
  // as the vertices: on the boundary a ray can pass beside the mesh entirely.
  cellToScreen(x, y) {
    const last = world ? riverSide(activeFloor().V) - 1 : 0;
    const inset = (v: number): number => (v === 0 ? 0.5 : v === last ? -0.5 : 0);
    return worldToScreen((x + inset(x)) * (U / 2), (y + inset(y)) * (U / 2));
  },
  cellAt(clientX, clientY) { return riverCellAtClient(clientX, clientY); },
  cells() { return world ? riverSide(activeFloor().V) : 0; },
  // Reading the live planes separates "the stroke never landed" from "it landed
  // and did not reach the file", which otherwise look identical in the diff.
  // Painting refuses until the splat textures are decoded, and a refused stroke
  // looks exactly like a brush that did nothing — so the state is published.
  paintReady() { const fl = world ? activeFloor() : null; return !!(fl && fl.splat && fl.maskTex); },
  pending() { return pendingCommits; },
  open(path) { return loadMapPath(path); },
  heights() { return world ? Array.from(activeFloor().heights) : []; },
  kinds() { return world && activeFloor().flags ? Array.from(activeFloor().flags!) : []; },
  size() { return world ? activeFloor().V - 1 : 0; },
};
window.view = view;

/**
 * Tiles a square brush of `size` covers, as indices into a vertex-sized plane.
 *
 * Separate from brushVerts because the two address different things: textures
 * and heights are per vertex, so their brush takes the corners and spans one
 * more than the tile count. Passability is per tile, so its brush must take the
 * tiles themselves or a 1x1 stroke lands on 3x3.
 */
/**
 * A tile rectangle, inclusive, clamped to the map.
 *
 * Every brush works from one of these. A square brush is the rectangle around
 * the cursor; the Rect size is the rectangle dragged out between two corners.
 * Keeping "which cells" in one place is what let Rect be added withouteach brush
 * growing its own copy of the geometry.
 */
export interface TileRect { x0: number; y0: number; x1: number; y1: number }

/** The rectangle a square brush of `size` covers, centred on tile (cx, cy). */
function squareRect(cx: number, cy: number, size: number): TileRect {
  const k = Math.floor(Math.max(1, size) / 2);
  return { x0: cx - k, y0: cy - k, x1: cx + k, y1: cy + k };
}

/** Tiles in a rectangle, as indices into a vertex-sized plane. */
function rectTiles(V: number, r: TileRect): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, r.y0); y <= Math.min(V - 2, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(V - 2, r.x1); x++) out.push(y * V + x);
  }
  return out;
}

/** Corner vertices of every tile in a rectangle — one more along each axis. */
function rectVerts(V: number, r: TileRect): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, r.y0); y <= Math.min(V - 1, r.y1 + 1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(V - 1, r.x1 + 1); x++) out.push(y * V + x);
  }
  return out;
}

function brushTiles(V: number, cx: number, cy: number, size: number): number[] {
  const k = Math.floor(Math.max(1, size) / 2);
  const out: number[] = [];
  for (let y = cy - k; y <= cy + k; y++) {
    if (y < 0 || y >= V - 1) continue;
    for (let x = cx - k; x <= cx + k; x++) {
      if (x < 0 || x >= V - 1) continue;
      out.push(y * V + x);
    }
  }
  return out;
}

/** Vertices of a square brush of `size` tiles centred on tile (cx, cy). */
function brushVerts(V: number, cx: number, cy: number, size: number): number[] {
  const r = Math.floor(Math.max(1, size) / 2);
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r + 1; y++) {
    if (y < 0 || y >= V) continue;
    for (let x = cx - r; x <= cx + r + 1; x++) {
      if (x < 0 || x >= V) continue;
      out.push(y * V + x);
    }
  }
  return out;
}

/** Write the stroke into the GPU masks. Layer i lives in group i/3, channel i%3. */
function paintMaskTexture(fl: Floor3D, layerIdx: number, verts: number[], strength = 255, exclusive = true): void {
  const tex = fl.maskTex, s = fl.splat;
  if (!tex || !s) return;
  const data = tex.image.data;
  if (!data) return; // the texture always carries its data; three's type says maybe
  const n = fl.V * fl.V;
  const at = (i: number, v: number): number => ((i / 3 | 0) * n + v) * 4 + (i % 3);
  for (const v of verts) {
    if (!exclusive) { data[at(layerIdx, v)] = strength; continue; }
    for (let i = 0; i < s.layerCount; i++) data[at(i, v)] = i === layerIdx ? strength : 0;
  }
  tex.needsUpdate = true;
}

// --- river brushes ---------------------------------------------------------
//
// Water, Bog and LavaFlow are not ordinary ground tiles. They are the original
// editor's "river" brushes, and painting one sinks the bed below its banks —
// measured against every shipped map, the painted bed sits below the
// surrounding high ground 90% of the time for LavaFlow, 74% for Bog, 65% for
// Water. Senya's map 12 shows the profile plainly: bank 2.0, one vertex at 1.8,
// bed at 1.6.
//
// They also write the half-tile river plane, which is what actually makes a
// river a river to the game. Painting one as a plain tile produced something
// that looked like a river and was not one.

/** Tiles that behave as river brushes. They live under the Water folder. */
const isRiverTile = (path: string): boolean => /\/_\(AdvMapTile\)\/Water\//.test(path);

const RIVER_DEPTH = 0.4;   // how far the bed drops below the bank
const RIVER_FEATHER = 0.2; // the single rim vertex between bank and bed

/** Height changes accumulated over the stroke, keyed by vertex. */
const riverHeights = new Map<number, number>();

/**
 * Sink the bed under `verts` and feather its rim.
 *
 * Idempotent per vertex: a river is a fixed depth below its banks, not a hole
 * that deepens the longer you hold the mouse down. Dragging back over the same
 * bed must leave it where it is.
 */
function sinkRiver(fl: Floor3D, verts: number[]): void {
  const drop = fl.riverDrop;
  // Sea is not a river. Flag 0 means navigable water and it sits at exactly 0.0
  // in 100% of the 62,788 flagged vertices across 60 shipped maps, so digging it
  // another 0.4 because someone painted the water texture over it would break an
  // invariant the engine relies on. What makes water swimmable is that flag, not
  // its depth: Bog and LavaFlow never carry it, Water only where a basin was dug.
  const isSea = (v: number): boolean => fl.flags ? fl.flags[v] === 0 : false;

  /**
   * Lower `v` until it sits `want` below where the ground started.
   *
   * Expressed as a target depth rather than a step, so applying it twice is a
   * no-op and promoting a rim vertex to bed digs only the remaining 0.2. Never
   * raises: a vertex already deeper belongs to someone else's terrain.
   */
  const sink = (v: number, want: number): void => {
    if (isSea(v)) return;
    const had = drop.get(v) ?? 0;
    if (want <= had) return;
    const target = fl.heights[v]! - (want - had);
    fl.heights[v] = target;
    drop.set(v, want);
    riverHeights.set(v, target);
  };

  for (const v of verts) { sink(v, RIVER_DEPTH); fl.river.add(v); }
  // One ring of rim vertices, dropped half as far, so the bank does not fall
  // away from the bed as a sheer step.
  const bed = new Set(verts);
  for (const v of verts) {
    const x = v % fl.V, y = (v / fl.V) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= fl.V || ny < 0 || ny >= fl.V) continue;
      const n = ny * fl.V + nx;
      if (!bed.has(n)) sink(n, RIVER_FEATHER);
    }
  }
  remeshFloor(fl);
}

/**
 * Commits sent to the main process and not yet acknowledged.
 *
 * A stroke hands its edit over and does not wait — that is what keeps painting
 * responsive. It also means the file can lag behind the screen, and at
 * reconstruction scale (a hundred thousand vertex writes) the backlog outlives
 * a Save: the save runs, then the queue drains and marks the map dirty again.
 * Publishing the count lets a caller wait for quiet; nothing else depends on it.
 */
let pendingCommits = 0;
async function committing<T>(work: Promise<T>): Promise<T> {
  pendingCommits++;
  try { return await work; } finally { pendingCommits--; }
}

/** Weight the tile brush writes, from the toolbar. */
const tileStrength = (): number => Math.max(0, Math.min(255, +$input('tilestrength').value || 0));
/** Blend mode: write this layer only, leaving the others under it alone. */
const tileBlend = (): boolean => ($('tilesolo') as HTMLInputElement).checked;
/** Whether painting water also sinks the bed under it. */
const riverCarve = (): boolean => ($('rivercarve') as HTMLInputElement).checked;

/** Paint at the cursor, if the brush is armed and the tile is paintable. */
function brushAt(verts: number[]): void {
  const fl = activeFloor();
  const tile = paintTile;
  if (!tile || !fl.splat) return;
  // Before upgradeToSplat finishes there is nothing to paint into. Refusing here
  // matters: the stroke would otherwise reach the file but never the screen.
  if (!fl.maskTex) { $('hud').textContent = 'ground textures still loading…'; return; }
  const layerIdx = fl.splat.paths.indexOf(tile.path);
  if (layerIdx < 0) return; // not a layer this map has — the palette shows which do
  const fresh = verts.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) return;
  for (const v of fresh) strokeVerts.add(v);
  const strength = tileStrength();
  paintMaskTexture(fl, layerIdx, fresh, strength, !tileBlend());
  // Water carves its bed — unless there is no water being painted (strength 0
  // erases) or carving is off because the ground is already at its final shape.
  if (isRiverTile(tile.path) && strength > 0 && riverCarve()) sinkRiver(fl, fresh);
}

/** Hand the finished stroke to the main process in one message. */
async function commitStroke(): Promise<void> {
  const tile = paintTile;
  if (!tile || !strokeVerts.size || !world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  const heightEdits = [...riverHeights];
  riverHeights.clear();
  try {
    // Water is a river only if it carries the plane and a bed; "carve" says
    // whether this stroke does that physical part or is paint alone. Off, the
    // stroke is an ordinary tile — which is what you want when the plane is
    // already authored and the ground is at its final height.
    if (isRiverTile(tile.path) && riverCarve()) {
      // Mask, river plane and heights travel together: a river missing any one
      // of the three is not a river, and a half-applied stroke would be worse
      // than a rejected one.
      await committing(window.editor.paintRiver({
        floor: world.active, tile: tile.path, verts,
        heightVerts: heightEdits.map(([v]) => v),
        heights: heightEdits.map(([, h]) => h),
      }));
    } else {
      await committing(window.editor.paintTile({
        floor: world.active, tile: tile.path, verts,
        strength: tileStrength(), exclusive: !tileBlend(),
      }));
    }
    markDirty(true);
  } catch (e) {
    // The GPU already shows the stroke, so a failure here means the two copies
    // disagree. Say so plainly rather than leaving a lie on screen.
    $('hud').textContent = 'paint failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

// --- height brush ----------------------------------------------------------
//
// Raise and lower, with a linear falloff from the brush centre so a stroke
// leaves a rounded mound rather than a stack of boxes.
//
// Heights and flags move together, because the format ties them. Ground sits at
// the 2.0 default and a bed dug by `lower` is always exactly 0.0 and flagged
// water. So: lower a vertex to 0 and it floods; raise a flooded vertex off 0 and
// it drains back to ordinary ground. Flags matter beyond the water sheet — the
// mesher cuts a cell wherever the ground KIND changes, so getting them wrong
// puts cliffs in the middle of a hillside.
//
// Unlike the tile brush, this sends absolute values rather than an operation.
// The falloff maths only runs here, so the main process cannot compute a
// different answer and drift.

const GROUND_LEVEL = 2.0;   // the format's default ground height
const WATER_LEVEL = 0.0;    // what `lower` digs a bed to, exactly
const STEP = 0.35;          // default height change per brush tick at full strength
const TICK_MS = 70;         // how often a held brush reapplies

/**
 * How much one Bulk/Dig tick moves the ground at the centre of the brush, and
 * how sharply that movement tapers towards the rim.
 *
 * Both were constants, and that made most of a real map unreachable: a fixed
 * 0.35 per tick with a fixed taper puts every height the brush can produce on
 * one lattice, and C1M1's field — 7420 distinct values, 87.7% of them off any
 * step grid — is nowhere near it (docs/E2E_RECONSTRUCTION.md). With a force you
 * can set, a stroke can land on a chosen value exactly; with a tension you can
 * choose between a sharp spike and a flat lift, which is the difference between
 * carving a gully and raising a field.
 */
let brushForce = uiPrefs.brushForce;
/** 1 = taper to a third at the rim (what it always did); 0 = flat stamp. */
let brushTension = uiPrefs.brushTension;
/**
 * Vertex mode: Bulk/Dig moves the single grid corner nearest the cursor.
 *
 * The smallest square brush is still four vertices — a tile's corners — and
 * four vertices moved together cannot express a surface whose corners differ,
 * which every real map's does. It is also the only way to reach the outermost
 * row and column, of which there is one more than there are tiles.
 */
let vertexMode = false;

/**
 * Does this flag record a deliberate ground kind that sculpting must not undo?
 *
 * Plateau tiers and ramps are authored, so a height change leaves them alone.
 * The test used to be `flag & 32`, which is only true for tiers 2 and 3: tier 4
 * (64) has no bit in common with it, so sculpting anywhere on a tier-4 plateau
 * silently reset it to ordinary ground — and C1M1 has 623 such vertices.
 */
const keepsGroundKind = (flag: number): boolean => tierOf(flag) >= 2 || (flag & RAMP_BIT) !== 0;

/** What a left-drag does. Mirrors the mode selector in the toolbar. */
type BrushMode = 'paint' | 'bulk' | 'dig' | 'raise' | 'lower' | 'ramp' | 'level' | 'kind' | 'river' | 'mask' | 'erase';
let brushMode: BrushMode = 'paint';
/** Height direction for the sculpt modes; 0 for the rest. */
let sculptDir = 0;
let lastTick = 0;
let lastTile = -1;

/** Rebuild the meshes a sculpt stroke invalidated. */
function remeshFloor(fl: Floor3D): void {
  const old = fl.terrainMesh.geometry;
  fl.terrainMesh.geometry = terrainGeometry(fl.V, fl.heights, fl.flags, fl.colors);
  old.dispose();
  // Flooding or draining changes which cells the sheet covers. On a map that
  // began dry there is no sheet yet, so digging the first basin creates one —
  // otherwise the new sea would not appear until a reload.
  const cells = waterCells(fl.V, fl.flags);
  if (!cells.length) {
    if (fl.waterMesh) {
      fl.group.remove(fl.waterMesh);
      fl.waterMesh.geometry.dispose();
      fl.waterMesh = null;
    }
  } else if (fl.waterMesh) {
    const prev = fl.waterMesh.geometry;
    fl.waterMesh.geometry = waterGeometry(fl.V, cells, seaBase);
    prev.dispose();
  } else {
    fl.waterMesh = makeWaterMesh(fl.V, cells, seaBase, fl.waterTex);
    fl.group.add(fl.waterMesh);
    $('seawrap').style.display = 'flex'; // the map has a sea now, so offer its level
  }
  // The overlay is built from the terrain's triangles, which have just been
  // replaced — and sculpting changes what counts as a cliff anyway.
  refreshBlocked(fl);
}

// --- the river plane, painted directly --------------------------------------
//
// The plane lives on a (2V-1)² grid — twice the resolution of the vertices — and
// its values are graded. The tile-driven river brush above writes full strength
// at vertex positions, which draws a river fine and cannot reproduce one: of
// C1M1's 2317 wet cells, 1815 sit between vertices and they hold 134 distinct
// values. This mode addresses the plane on its own terms.

/** Cells painted in the current stroke, as indices into the (2V-1)² plane. */
const strokeCells = new Set<number>();

/** Cells per side of the river plane for a V-vertex map. */
const riverSide = (V: number): number => 2 * V - 1;

/** The river cell nearest these client coordinates, or null when off the map. */
function riverCellAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const W = riverSide(activeFloor().V);
  // Cells sit every half tile, so the grid step is U/2.
  const x = Math.round(p.x / (U / 2)), y = Math.round(p.y / (U / 2));
  if (x < 0 || y < 0 || x >= W || y >= W) return null;
  return { x, y };
}

/** Paint the river plane under the cursor at the chosen strength. */
function riverAt(cells: { x: number; y: number }[]): void {
  const fl = activeFloor();
  const W = riverSide(fl.V);
  const value = Math.max(0, Math.min(255, +$input('riverstrength').value || 0));
  const carve = riverCarve();
  const bed: number[] = [];
  for (const c of cells) {
    const idx = c.y * W + c.x;
    if (strokeCells.has(idx)) continue;
    strokeCells.add(idx);
    // A cell that lands on a vertex is the only one with ground under it to
    // sink; the ones between vertices have no height of their own.
    if (carve && value > 0 && c.x % 2 === 0 && c.y % 2 === 0) bed.push((c.y / 2) * fl.V + (c.x / 2));
  }
  if (bed.length) {
    sinkRiver(fl, bed);
    for (const v of bed) strokeVerts.add(v);
  }
}

/** Send the finished river stroke. */
async function commitRiver(): Promise<void> {
  const fl = activeFloor();
  if (!strokeCells.size || !world) { strokeCells.clear(); strokeVerts.clear(); return; }
  const cells = [...strokeCells];
  strokeCells.clear();
  const value = Math.max(0, Math.min(255, +$input('riverstrength').value || 0));
  try {
    await committing(window.editor.setRiverCells({ floor: world.active, cells, value }));
    // Carving moved ground, and those heights travel by the sculpt path.
    if (strokeVerts.size) await commitSculpt(); else strokeVerts.clear();
    markDirty(true);
  } catch (e) {
    strokeVerts.clear();
    $('hud').textContent = 'river failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
  void fl;
}

/**
 * The ground kind the Tier brush paints: `16 × tier`, plus 8 for a ramp.
 * Read from the toolbar at the moment of the stroke.
 */
function selectedKind(): number {
  const tier = +$select('kindtier').value;
  return tier * TIER_STEP + (($('kindramp') as HTMLInputElement).checked ? RAMP_BIT : 0);
}

/**
 * Paint the ground kind, leaving the height exactly where it is.
 *
 * Every other tool changes a tier by MOVING the ground: Raise adds a step and
 * takes the tier with it, Lower digs to 0 and calls it water. That is right for
 * sculpting and useless once the surface is already at its final height — which
 * is exactly the state a reconstruction is in when it comes to set the tiers
 * (docs/E2E_RECONSTRUCTION.md), and the state you are in whenever a hill is
 * shaped the way you want but reads as the wrong kind of ground.
 *
 * @returns the vertices it changed, or null if they already held that kind.
 */
function kindAt(verts: number[], vertexOnly = false): number[] | null {
  const fl = activeFloor();
  if (!fl.flags) return null;
  const kind = selectedKind();
  const moved: number[] = [];
  for (const v of verts) {
    if (!vertexOnly && strokeVerts.has(v)) continue;
    if (fl.flags[v] === kind) continue;
    fl.flags[v] = kind;
    moved.push(v);
  }
  if (!moved.length) return null;
  // The mesher reads flags: tier boundaries become cut walls, ramps are smoothed
  // and flag 0 is where the sea sheet goes, so the view is stale until it runs.
  remeshFloor(fl);
  return moved;
}

/**
 * Move one vertex by the brush force. Nothing tapers, nothing else moves.
 * @returns the vertex it moved, or null if the force changed nothing.
 */
function sculptVertex(fl: Floor3D, x: number, y: number): number[] | null {
  const i = y * fl.V + x;
  const next = Math.max(WATER_LEVEL, fl.heights[i]! + sculptDir * brushForce);
  if (next === fl.heights[i]) return null;
  fl.heights[i] = next;
  if (fl.flags) {
    const f = fl.flags[i]!;
    if (!keepsGroundKind(f)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
  }
  return [i];
}

/**
 * Apply one tick of the height brush at tile (cx, cy).
 * @returns the vertices it moved, or null if nothing changed.
 */
function sculptAt(fl: Floor3D, cx: number, cy: number): number[] | null {
  // Footprint: the same vertex box the tile brush paints, so both brushes cover
  // what the cursor visibly highlights. A size-N brush spans tiles cx-k..cx+k,
  // whose corners are vertices cx-k..cx+k+1.
  //
  // Distance is Chebyshev (square), not Euclidean. A radial test fails outright
  // at size 1: the tile centre is 0.707 from each of its four corners, so a
  // radius of 0.5 excludes every vertex and the brush silently does nothing.
  const k = Math.floor(Math.max(1, brushSize) / 2);
  const rad = k + 0.5;              // half-width in tiles, centre to outer vertices
  const ox = cx + 0.5, oy = cy + 0.5;
  const touched: number[] = [];
  for (let y = cy - k; y <= cy + k + 1; y++) for (let x = cx - k; x <= cx + k + 1; x++) {
    if (x < 0 || x >= fl.V || y < 0 || y >= fl.V) continue;
    const d = Math.max(Math.abs(x - ox), Math.abs(y - oy));
    if (d > rad) continue;
    // The innermost ring sits at 0.5, so subtracting it puts full strength
    // there and tapers towards the rim. Size 1 is a flat 2x2 stamp. Tension
    // scales how much of that taper applies: at 0 the whole footprint moves
    // together, at 1 the rim gets a third of the centre, as it always did.
    const falloff = k === 0 ? 1 : 1 - brushTension * ((d - 0.5) / rad);
    const i = y * fl.V + x;
    const next = Math.max(WATER_LEVEL, fl.heights[i]! + sculptDir * brushForce * falloff);
    if (next === fl.heights[i]) continue;
    fl.heights[i] = next;
    if (fl.flags) {
      // A vertex at exactly 0 is a dug bed, which is what water is. Anything
      // above it is ordinary ground. Plateau (32) and ramp (8) bits are
      // deliberate authoring, so leave those vertices' kind alone.
      const f = fl.flags[i]!;
      if (!keepsGroundKind(f)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
    }
    touched.push(i);
  }
  return touched.length ? touched : null;
}

/**
 * The step a plateau stands above the ground it sits on.
 *
 * Measured across every shipped map: of 23,539 plateau edges, 45% are exactly
 * 2.00 and both the median and the lower quartile are 2.00 — which is also the
 * format's default ground level. Nothing else comes close.
 */
const PLATEAU_STEP = 2.0;

/**
 * How far from the stroke's starting level a vertex may sit and still count as
 * the same tier.
 *
 * Half the step: tiers are 2.0 apart, so anything within 1.0 is the level you
 * started on and anything beyond is a different one. It cannot be an exact
 * match — only 25.6% of plateau vertices sit level with their neighbours, since
 * a plateau keeps the relief of the ground it was raised from.
 */
const PLATEAU_TOL = PLATEAU_STEP / 2;

/** The level a height stroke started on; NaN between strokes. */
let plateauBase = NaN;
/** The tier flag that goes with it, for the levelling tool. */
let plateauBaseFlag = 16;
/** True while the size selector is on Rect: drag out a rectangle, apply on release. */
let rectMode = false;
/** Where a Rect drag started. */
let rectAnchor: { x: number; y: number } | null = null;

/**
 * Raise a plateau, or dig a pit — the original editor's Raise and Lower, as
 * opposed to the smooth Bulk and Dig.
 *
 * Raise ADDS the step rather than levelling to it: only 25.6% of plateau
 * vertices have all their plateau neighbours at the same height, so a plateau
 * is not a flat table. It carries the relief of the ground it was raised from,
 * which is why its cut edge flows with the terrain instead of sitting level.
 *
 * Marking the kind is the whole point. A cut is a change of ground KIND, not of
 * steepness, so without flag 32 the mesher would blend the new step into a
 * smooth ramp however tall it is. Lower digs to exactly 0.0 and flags water,
 * which is what makes the pit flood.
 */
function plateauAt(verts: number[], up: boolean, start: number): void {
  const fl = activeFloor();
  // The first tick of a stroke fixes the tier being worked on. Dragging off it
  // onto a step above or below must leave that ground alone: otherwise tracing
  // along the rim of a tier quietly raises the one beneath it too, and one pass
  // leaves a staircase of mixed heights. Lower is bound the same way — a pit
  // traced along a plateau's edge should not swallow the plateau.
  if (!strokeVerts.size) plateauBase = fl.heights[start]!;
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    if (Math.abs(fl.heights[v]! - plateauBase) > PLATEAU_TOL) continue;
    strokeVerts.add(v);
    fl.heights[v] = up ? fl.heights[v]! + PLATEAU_STEP : 0;
    if (fl.flags) {
      // Step to the NEXT tier, keeping the count rather than pinning everything
      // to 32: tier 3 stacked on tier 2 must be a different kind or the mesher
      // blends the wall between them into a slope. The ramp bit is dropped —
      // this makes a wall, not an incline.
      fl.flags[v] = up ? Math.min(240, (fl.flags[v]! & 0xf0) + 16) : 0;
    }
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/**
 * Cut a walkable ramp into a tier boundary.
 *
 * A ramp is not a gentle slope the tool draws freehand: the format has exactly
 * one intermediate value, bit 3, and a ramp vertex sits precisely half a tier
 * up. Measured across every shipped map, 16->24 and 24->32 each step 1.00 —
 * half of the 2.00 between tiers. So this raises the vertices it touches by half
 * a step and flags them, turning one wall into two half-height steps that the
 * mesher smooths, because it smooths any cell holding a ramp vertex.
 *
 * Bound to its starting level like Raise and Lower: a ramp traced along a rim
 * must not chew into the tier above or below it.
 */
function rampAt(verts: number[], start: number): void {
  const fl = activeFloor();
  const flags = fl.flags;
  if (!flags) return;
  if (!strokeVerts.size) plateauBase = fl.heights[start]!;

  /** A ramp only exists where a cut does — and it is cut INTO the low side. */
  const onLowSideOfCut = (v: number): boolean => {
    const x = v % fl.V, y = (v / fl.V) | 0;
    const me = flags[v]! >> 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= fl.V || ny < 0 || ny >= fl.V) continue;
      if ((flags[ny * fl.V + nx]! >> 4) > me) return true;
    }
    return false;
  };

  let touched = false, blocked = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    if (Math.abs(fl.heights[v]! - plateauBase) > PLATEAU_TOL) continue;
    // Already a ramp: leave it. It still sits on the low tier and still borders
    // the high one, so without this a second pass raises it another half step
    // and a few clicks push it clean through the tier it was meant to reach.
    if (flags[v]! & 8) continue;
    // Nowhere but a cut. Every one of the 3,718 ramp vertices across the shipped
    // maps has a neighbour on a different tier — 100.0%, not merely most — so a
    // ramp in open ground is not a thing the format expresses. Refusing beats
    // leaving half a step stranded in a field.
    if (!onLowSideOfCut(v)) { blocked = true; continue; }
    strokeVerts.add(v);
    fl.heights[v] = fl.heights[v]! + PLATEAU_STEP / 2;
    flags[v] = (flags[v]! & 0xf0) | 8;
    touched = true;
  }
  if (touched) remeshFloor(fl);
  // Say so rather than appearing broken: the brush is armed and nothing happens.
  else if (blocked) $('hud').textContent = 'ramps go at the foot of a cut — aim at the low side of a step';
}

/** Sculpt at the cursor, rate-limited so holding still is controllable. */
function sculptTick(ev: PointerEvent): void {
  const fl = activeFloor();
  const at = vertexMode ? vertexAtClient(ev.clientX, ev.clientY) : tileUnderCursor(ev);
  if (!at) return;
  const tile = at.y * fl.V + at.x;
  const now = performance.now();
  // Reapply when the cursor moves to a new tile, or on a timer while held —
  // otherwise a stroke that pauses would silently stop sculpting.
  if (tile === lastTile && now - lastTick < TICK_MS) return;
  lastTile = tile; lastTick = now;
  const idx = at.y * fl.V + at.x;
  if (brushMode === 'paint') { brushAt([idx]); return; }
  const moved = brushMode === 'kind'
    ? kindAt([idx], true)
    : vertexMode ? sculptVertex(fl, at.x, at.y) : sculptAt(fl, at.x, at.y);
  if (!moved) return;
  for (const v of moved) strokeVerts.add(v);
  remeshFloor(fl);
}

/** Hand the finished sculpt to the main process as absolute values. */
async function commitSculpt(): Promise<void> {
  const fl = activeFloor();
  if (!strokeVerts.size || !world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  try {
    await committing(window.editor.sculpt({
      floor: world.active,
      verts,
      heights: verts.map((v) => fl.heights[v]!),
      flags: fl.flags ? verts.map((v) => fl.flags![v]!) : null,
    }));
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'sculpt failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

/**
 * Level everything under the brush to the tier the stroke started on.
 *
 * The plateau tool: drag on an upper tier and the ground around is pulled up to
 * it, drag on a lower one and what stands above is cut down. Unlike Raise it
 * sets an absolute height and tier rather than adding a step, which is the whole
 * point — it is how you get a flat table at a chosen level out of uneven ground.
 */
function levelAt(verts: number[], start: number): void {
  const fl = activeFloor();
  if (!strokeVerts.size) {
    plateauBase = fl.heights[start]!;
    plateauBaseFlag = fl.flags ? fl.flags[start]! : 16;
  }
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    strokeVerts.add(v);
    if (fl.heights[v] === plateauBase && (!fl.flags || fl.flags[v] === plateauBaseFlag)) continue;
    fl.heights[v] = plateauBase;
    // The tier travels with the height. Levelling the ground without it leaves
    // a tier boundary with no step across it, which the mesher then cuts into a
    // wall of zero height — a seam through the middle of a flat plateau.
    if (fl.flags) fl.flags[v] = plateauBaseFlag;
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/**
 * The tiles a stroke acts on right now.
 *
 * Rect defers: while the button is down it only previews, and the whole
 * rectangle is applied once on release. Every other size acts under the cursor
 * as you move.
 */
function currentRect(ev: PointerEvent): TileRect | null {
  const at = tileUnderCursor(ev);
  if (!at) return null;
  if (!rectMode) return squareRect(at.x, at.y, brushSize);
  if (!rectAnchor) return squareRect(at.x, at.y, 1);
  return {
    x0: Math.min(rectAnchor.x, at.x), y0: Math.min(rectAnchor.y, at.y),
    x1: Math.max(rectAnchor.x, at.x), y1: Math.max(rectAnchor.y, at.y),
  };
}

/** One tick of whichever brush is armed, over `r`. */
function applyRect(r: TileRect): void {
  const fl = activeFloor();
  const verts = rectVerts(fl.V, r);
  const start = Math.max(0, Math.min(fl.V * fl.V - 1, r.y0 * fl.V + r.x0));
  switch (brushMode) {
    case 'paint': brushAt(verts); break;
    case 'bulk': case 'dig': sculptRect(verts); break;
    case 'raise': plateauAt(verts, true, start); break;
    case 'lower': plateauAt(verts, false, start); break;
    case 'ramp': rampAt(verts, start); break;
    case 'level': levelAt(verts, start); break;
    case 'kind': { const moved = kindAt(verts); if (moved) for (const v of moved) strokeVerts.add(v); break; }
    case 'mask': maskAt(rectTiles(fl.V, r), false); break;
    case 'erase': maskAt(rectTiles(fl.V, r), true); break;
  }
}

/**
 * Bulk and Dig over a rectangle: one step at full strength, no falloff.
 *
 * The radial falloff exists to round a mound made by dragging. A rectangle is
 * an explicit shape, so tapering its edges would fight what was asked for.
 */
function sculptRect(verts: number[]): void {
  const fl = activeFloor();
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    strokeVerts.add(v);
    const next = Math.max(WATER_LEVEL, fl.heights[v]! + sculptDir * brushForce);
    if (next === fl.heights[v]) continue;
    fl.heights[v] = next;
    if (fl.flags) {
      const f = fl.flags[v]!;
      if (!keepsGroundKind(f)) fl.flags[v] = next <= WATER_LEVEL ? 0 : 16;
    }
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/** One tick of whichever brush is armed. */
function applyBrush(ev: PointerEvent): void {
  // Rect only previews while dragging; the work happens on release.
  if (rectMode) { updateBrushCursor(tileUnderCursor(ev)); return; }
  // Bulk and Dig keep their own rate limiting and radial falloff; the kind
  // brush borrows that path when it is painting one vertex at a time.
  if (brushMode === 'bulk' || brushMode === 'dig'
      || (vertexMode && (brushMode === 'kind' || brushMode === 'paint'))) { sculptTick(ev); return; }
  if (brushMode === 'river') {
    const c = riverCellAtClient(ev.clientX, ev.clientY);
    if (c) riverAt([c]);
    return;
  }
  const r = currentRect(ev);
  if (r) applyRect(r);
}

/** Hand the finished stroke to the main process. */
async function commitBrush(): Promise<void> {
  switch (brushMode) {
    case 'paint': await commitStroke(); break;
    case 'bulk': case 'dig': case 'raise': case 'lower': case 'ramp': case 'level': case 'kind':
      await commitSculpt(); break;
    case 'river': await commitRiver(); break;
    case 'mask': await commitMask(false); break;
    case 'erase': await commitMask(true); break;
  }
}

function setBrush(on: boolean): void {
  brushOn = on;
  // The two are mutually exclusive, both being left-click on the terrain.
  // armObject() disarms the brush; this is the same rule the other way round,
  // and it must not call back into armObject or the two would bounce.
  if (on && placeObject) {
    placeObject = null;
    $('obj-sel').textContent = 'no object selected';
    renderObjGrid();
  }
  const b = $button('brushbtn');
  b.classList.toggle('on', on);
  // The label says the state rather than the action: with the mode selector
  // beside it, "Brush" alone gave no way to tell armed from not.
  b.textContent = on ? 'Brush: on' : 'Brush: off';
  // The arrow is hidden, not restyled: the footprint gizmo IS the cursor, and
  // an arrow on top of it only obscures the tile under the tip.
  renderer.domElement.style.cursor = on ? 'none' : '';
  if (!on) updateBrushCursor(null);
  if (!on && painting) { painting = false; controls.enabled = true; }
}

// --- toolbar ---
let isDirty = false;
function markDirty(v: boolean): void {
  isDirty = v;
  $('dirty').textContent = v ? '● unsaved changes' : '';
  $('dirty').className = v ? 'on' : '';
  $button('save').disabled = !v;
  // An edit just landed, so there is certainly something to undo and nothing
  // left to redo — the stack discards its redo tail on any new edit. Cheaper
  // and more immediate than asking the main process what it now holds; undo and
  // redo report the authoritative state themselves.
  if (v) {
    $button('undobtn').disabled = false;
    $button('undobtn').title = 'Undo (Ctrl+Z)';
    $button('redobtn').disabled = true;
    $button('redobtn').title = 'Nothing to redo';
  }
}

const FLOOR_LABEL: Record<string, string> = { surface: 'Surface', underground: 'Underground' };
// Floor button: shown only for two-floor maps; label names the OTHER floor it
// switches to, and clicking cycles.
function updateFloorUI(): void {
  const btn = $('floor');
  if (!world || world.floors.length < 2) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const next = world.floors[(world.active + 1) % world.floors.length];
  const cur = world.floors[world.active];
  btn.textContent = `${FLOOR_LABEL[cur.name] || cur.name} → ${FLOOR_LABEL[next.name] || next.name}`;
}
$('floor').onclick = () => { if (world) setActiveFloor((world.active + 1) % world.floors.length); };

// Explorer show/hide + search wiring.
let explorerOpen = uiPrefs.explorerOpen;
function setExplorer(open: boolean): void {
  explorerOpen = open;
  $('explorer').style.display = open ? 'flex' : 'none';
  $('hud').style.left = open ? '296px' : '12px';
  $('objects').classList.toggle('on', open);
  saveUiPrefs({ explorerOpen: open });
}
$('objects').onclick = () => {
  const open = !explorerOpen;
  // Opening the list while objects are hidden brings them back. The list exists
  // to find an object and click through to it, and every one of those clicks
  // would select something invisible — picking is disabled while they are
  // hidden, so the 3D view would not even answer.
  //
  // Only on this click, not inside setExplorer: loading a map opens the list
  // too, and doing it there would quietly undo a deliberate "objects off"
  // every time a map was opened.
  if (open && world && !showObjects) setShowObjects(true);
  setExplorer(open);
};

// Hide/show all placed objects — terrain work needs an unobstructed ground view.
function setShowObjects(on: boolean): void {
  showObjects = on;
  if (world) for (const fl of world.floors) fl.objGroup.visible = on;
  if (!on) deselect();
  $('showobj').classList.toggle('on', on);
  $('showobj').textContent = on ? 'Objects: on' : 'Objects: off';
  saveUiPrefs({ showObjects: on });
}
$('showobj').onclick = () => setShowObjects(!showObjects);
$('viewbtn').onclick = () => setTopView(!topView);

// --- object palette (the original editor's Objects tab) --------------------
//
// The catalogue is 1466 entries with an icon each, so two things are lazy: the
// grid renders a page at a time, and an icon is fetched only when its tile is
// actually built. Pushing every icon up front would be ~24 MB across the bridge
// for a panel that shows two dozen at once.
//
// Placing is click-to-arm, then click on the map — and the armed object STAYS
// armed, so a row of ten gold piles is ten clicks. Dragging one tile per object
// was the first attempt and it was wrong twice over: HTML5 drag-and-drop over
// the WebGL canvas did not fire at all, and even working it would have made the
// common case (many copies of the same thing) the most tiring one.

let catalog: PlaceableObject[] = [];
let catGroups: { name: string; separator: boolean }[] = [];
let objPalOpen = false;
let objCat = ALL;
let objSearch = '';
let showHiddenObjects = uiPrefs.showHidden;
/** The catalogue entry armed for placing, or null. Stays set across placements. */
let placeObject: PlaceableObject | null = null;
/** Icons already fetched, so scrolling back does not refetch. */
const iconCache = new Map<string, string | null>();

/** How many tiles to render before the "show more" row. */
const OBJ_PAGE = 120;
let objShown = OBJ_PAGE;

function objMatches(o: PlaceableObject): boolean {
  if (o.hidden && !showHiddenObjects) return false;
  if (objCat !== ALL && o.group !== objCat) return false;
  // Search both: the label is what is on screen, the file name is what someone
  // who knows the assets will type.
  if (objSearch && !(o.label + ' ' + o.name).toLowerCase().includes(objSearch)) return false;
  return true;
}

/**
 * In flight while the catalogue is being fetched.
 *
 * The scan reads the Editor folder and decodes the icon cache — a second or two
 * on disk — so it is kicked off in the background the moment a map opens, and
 * the panel simply awaits it. This handle is what makes both safe: a click that
 * arrives mid-scan waits on the same promise instead of starting a second scan,
 * and the preload does not care whether the panel is even open yet.
 */
let catalogLoad: Promise<void> | null = null;

/** Fetch the catalogue once, whoever asks first. Idempotent and re-entrant. */
function initObjectPalette(): Promise<void> {
  if (catalog.length) return Promise.resolve();
  if (catalogLoad) return catalogLoad;
  // Only speaks if the panel is already showing; a background preload leaves it
  // blank until the data lands.
  if (objPalOpen) $('obj-grid').innerHTML = '<div style="color:#8b949e;font-size:11px;padding:8px">loading objects…</div>';
  catalogLoad = (async () => {
    try {
      const r = await window.editor.listObjects();
      catalog = r.objects;
      catGroups = r.groups;
      if (!r.hasEditor) {
        $('hud').textContent = 'no Editor folder found — objects are ungrouped and have no icons';
      }
      renderObjCats();
      renderObjGrid();
    } catch (e) {
      catalogLoad = null; // let a later open retry a scan that failed
      $('obj-grid').innerHTML = `<div style="color:#f85149;font-size:11px">${
        e instanceof Error ? e.message : String(e)}</div>`;
    }
  })();
  return catalogLoad;
}

function renderObjCats(): void {
  const sel = $select('obj-cat');
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = ALL;
  all.textContent = `All (${catalog.length})`;
  sel.appendChild(all);
  const counts = new Map<string, number>();
  for (const o of catalog) counts.set(o.group, (counts.get(o.group) || 0) + 1);
  for (const g of catGroups) {
    const opt = document.createElement('option');
    if (g.separator) {
      // Kept, and kept unselectable: the original shows these headings in the
      // same list, and dropping them would lose the grouping they carry.
      opt.textContent = g.name;
      opt.disabled = true;
    } else {
      opt.value = g.name;
      opt.textContent = `${g.name} (${counts.get(g.name) || 0})`;
    }
    sel.appendChild(opt);
  }
  // "Other" is ours, not the original's: entries no filter covers. A mod's own
  // folder lands here rather than vanishing.
  if (counts.get('Other')) {
    const opt = document.createElement('option');
    opt.value = 'Other';
    opt.textContent = `Other (${counts.get('Other')})`;
    sel.appendChild(opt);
  }
  sel.value = objCat;
}

function renderObjGrid(): void {
  const grid = $('obj-grid');
  grid.innerHTML = '';
  const list = catalog.filter(objMatches);
  for (const o of list.slice(0, objShown)) {
    const el = document.createElement('div');
    el.className = 'obj' + (placeObject?.path === o.path ? ' on' : '');
    // The original's tooltip is the object's own description. The file name is
    // kept beside it because that is what the map and the assets are keyed on,
    // and it is the only handle when something needs looking up on disk.
    el.title = [o.label, o.description, `${o.name} · ${o.type || 'unknown type'} · ${o.group}`]
      .filter(Boolean).join('\n\n');
    const img = document.createElement('img');
    img.className = 'ic';
    el.appendChild(img);
    void setIcon(img, o.path);
    if (o.random) { const b = document.createElement('span'); b.className = 'rnd'; b.textContent = 'rnd'; el.appendChild(b); }
    if (o.hidden) { const b = document.createElement('span'); b.className = 'hid'; b.textContent = 'hid'; el.appendChild(b); }
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = o.label;
    el.appendChild(nm);
    // Clicking the armed one again disarms, so the palette is its own off switch.
    el.onclick = () => armObject(placeObject?.path === o.path ? null : o);
    grid.appendChild(el);
  }
  if (list.length > objShown) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `+${list.length - objShown} more — click to show`;
    more.onclick = () => { objShown += OBJ_PAGE; renderObjGrid(); };
    grid.appendChild(more);
  }
  if (!list.length) {
    grid.innerHTML = '<div class="more">nothing matches</div>';
  }
}

/** Fill an icon, fetching it once per catalogue entry. */
async function setIcon(img: HTMLImageElement, path: string): Promise<void> {
  if (iconCache.has(path)) {
    const uri = iconCache.get(path);
    if (uri) img.src = uri;
    return;
  }
  try {
    const uri = await window.editor.objectIcon(path);
    iconCache.set(path, uri);
    if (uri) img.src = uri;
  } catch { iconCache.set(path, null); }
}

function setObjPalette(open: boolean): void {
  objPalOpen = open;
  // Closing the panel puts the armed object down. The palette is the only place
  // that shows what is armed, so leaving it live behind a closed panel means a
  // click on the map plants something you can no longer see the name of.
  if (!open && placeObject) armObject(null);
  $('objpal').style.display = open ? 'flex' : 'none';
  $('objpalbtn').classList.toggle('on', open);
  // Only one right-hand panel at a time; they occupy the same strip.
  if (open && paletteOpen) setPalette(false);
  $('help').style.right = open ? '262px' : '12px';
  $('panel').style.right = open ? '262px' : '12px';
  if (open) void initObjectPalette();
}

/**
 * Arm (or disarm) a catalogue entry for placing.
 *
 * Arming takes the terrain brush down: both want the left button on the
 * terrain, and leaving both live would mean painting ground every time you
 * placed a tree.
 */
function armObject(o: PlaceableObject | null): void {
  placeObject = o;
  if (o) {
    if (brushOn) setBrush(false);
    $('obj-sel').textContent = `placing: ${o.label} · ${o.type || '?'}`;
    $('hud').textContent = o.type
      ? `click the map to place ${o.name} — Esc or click it again to stop`
      : `${o.name} has no object type we recognise, so it cannot be placed`;
    renderer.domElement.style.cursor = 'none';
  } else {
    $('obj-sel').textContent = 'no object selected';
    renderer.domElement.style.cursor = '';
    updateBrushCursor(null);
  }
  renderObjGrid();
}

/**
 * Place the armed object at a tile.
 *
 * Stays armed afterwards, and does NOT select what it just placed: selecting
 * would fight the next click, which is meant to be the next copy. The explorer
 * list is refreshed so the new object is findable there straight away.
 */
async function placeAt(tile: { x: number; y: number }): Promise<void> {
  const o = placeObject;
  if (!o || !world) return;
  if (!o.type) { $('hud').textContent = `${o.name}: unknown object type, not placed`; return; }
  try {
    const res = await window.editor.addObject({
      type: o.type, shared: o.shared, x: tile.x, y: tile.y, floor: world.active,
    });
    addInstanceToScene(res.instance, res.geom);
    markDirty(true);
    renderExplorer();
    $('hud').textContent = res.complete
      ? `placed ${o.label} at ${tile.x}, ${tile.y}`
      // Said out loud rather than silently: with no object of this type on the
      // map to copy, only the shared fields were written.
      : `placed ${o.label} at ${tile.x}, ${tile.y} — no ${o.type} to copy from this map or the game's, so type-specific fields are missing`;
  } catch (e) {
    $('hud').textContent = 'could not place: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** Add a freshly placed object to the live scene. */
function addInstanceToScene(inst: Instance, geom: { index: number; data: GeomData } | null): void {
  if (!world) return;
  const fl = world.floors[world.active];
  if (!fl) return;
  // Every path that selects, moves, rotates or deletes an object finds it by
  // id, so an object without one would be on screen and unreachable.
  if (!inst.id) { $('hud').textContent = 'placed, but it came back without an id — reload'; return; }
  // A model this scene has never drawn arrives with the instance; build its
  // geometry and material now and park them at the index the main process used,
  // so `inst.g` means the same thing on both sides.
  if (geom) {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(geom.data.pos), 3));
    if (geom.data.uv) b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geom.data.uv), 2));
    b.setIndex(geom.data.idx);
    // Same grouping as buildGeos: one group per submesh, one material each.
    geom.data.parts.forEach((p, i) => b.addGroup(p.start, p.count, i));
    if (geom.data.nrm) b.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geom.data.nrm), 3));
    else b.computeVertexNormals();
    worldGeos[geom.index] = b;
    worldMats[geom.index] = geom.data.parts.map(materialFor);
    // Rebuildable-materials registry, same as buildGeos — without this a newly
    // placed terrain-projected model has no parts to project and its ground
    // material is never built.
    geomParts.set(geom.index, geom.data.parts);
    geomFootprint.set(geom.index, geom.data.footprint ?? null);
  }
  const g = worldGeos[inst.g], m = worldMats[inst.g];
  if (!g || !m) { $('hud').textContent = 'placed, but its mesh is missing — reload to see it'; return; }
  // Stand it on the ground: the main process does not have the height plane the
  // renderer is drawing.
  inst.z = heightAt(inst.x, inst.y);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(tileCenter(inst.x), tileCenter(inst.y), inst.z);
  mesh.rotation.z = inst.r;
  mesh.userData.inst = inst;
  // The handle stays out of the scene, as in buildFloor; the batch draws it.
  mesh.updateMatrixWorld();
  fl.meshes.set(inst.id, mesh);
  addToBatch(fl, inst, mesh);
  // If this model takes the ground it stands on, give the batch its projection
  // material now that it exists — the load path does this via upgradeToSplat.
  if (geomParts.get(inst.g)?.some((p) => p.terrainProjected)) projectBatch(fl, inst.g);
  fl.instances.push(inst);
  syncFootprints(fl);
}

// --- terrain palette (content browser) -------------------------------------
// The ground tiles the game ships, grouped by their folder the way the original
// editor's "Terra skin" list is. Selecting one arms it as the paint tile.
// A green dot marks tiles this map's terrain already has a layer for — only
// those can be painted, since a new one means restructuring the .bin.
let allTiles: TileInfo[] = [];
let tilesInMap = new Set();
let palCat: string | null = null;
let paintTile: TileInfo | null = null;
let paletteOpen = false;

/**
 * Give this map a layer for `t`, so it can be painted with.
 *
 * This is the one terrain edit that changes the file's structure rather than
 * overwriting bytes in place, so it is an explicit action on the tile rather
 * than something a brush stroke does silently. The mask starts empty, so the
 * map looks unchanged until the first stroke.
 */
async function addTileLayer(t: TileInfo): Promise<void> {
  if (!world) return;
  const fl = activeFloor();
  $('hud').textContent = `adding ${t.name} to this map…`;
  try {
    const r = await window.editor.addLayer({ floor: world.active, tile: t.path });
    // One more layer means a different shader, not a texture we can patch.
    if (r.splat) { fl.splat = r.splat; await upgradeToSplat(fl); }
    tilesInMap = new Set(r.inMap);
    markDirty(true);
    renderPalette();
    $('hud').textContent = `${t.name} added — paint away`;
  } catch (e) {
    $('hud').textContent = 'could not add the tile: ' + (e instanceof Error ? e.message : String(e));
  }
}

function renderPalette(): void {
  const grid = $('pal-grid');
  grid.innerHTML = '';
  const shown = allTiles.filter((t) => t.category === palCat);
  if (!shown.length) { grid.innerHTML = '<div style="color:#6e7681;font-size:11px">empty</div>'; return; }
  for (const t of shown) {
    const used = tilesInMap.has(t.path);
    const el = document.createElement('div');
    el.className = 'tile' + (paintTile?.path === t.path ? ' on' : '');
    el.title = `${t.name}\n${t.type || '—'} · priority ${t.priority} (higher paints on top)`;
    const img = document.createElement('img'); img.src = t.thumb; img.alt = t.name;
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = t.name;
    el.append(img, nm);
    if (used) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = 'This map already carries a layer for this tile. Tiles without a dot get one added when picked.';
      el.appendChild(dot);
    }
    el.onclick = () => {
      paintTile = t;
      // Tiles with no layer in this map cannot be painted yet — adding one means
      // inserting an array into the .bin. Say so at selection time rather than
      // letting the brush no-op silently.
      $('pal-sel').textContent = `${t.name} · priority ${t.priority}`;
      // Choosing a tile is the intent to paint with it: switch to paint mode
      // and arm, so the click leads somewhere instead of highlighting a swatch.
      brushMode = 'paint'; sculptDir = 0;
      $select('brushmode').value = 'paint';
      setBrush(true);
      renderPalette();
      // A tile this map has no layer for gets one now, on the spot.
      if (!used) addTileLayer(t);
    };
    grid.appendChild(el);
  }
}

function renderPalCats(): void {
  const cats = [...new Set(allTiles.map((t) => t.category))].sort();
  const sel = $select('pal-cat');
  sel.innerHTML = '';
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = `${c} (${allTiles.filter((t) => t.category === c).length})`;
    sel.appendChild(o);
  }
  if (palCat === null || !cats.includes(palCat)) palCat = cats.includes('Grass') ? 'Grass' : (cats[0] ?? null);
  if (palCat !== null) sel.value = palCat;
}
$select('pal-cat').addEventListener('change', (e) => {
  palCat = (e.currentTarget as HTMLSelectElement).value;
  renderPalette();
});

async function initPalette() {
  if (allTiles.length) return;
  try {
    const { tiles, inMap } = await window.editor.listTiles();
    allTiles = tiles;
    tilesInMap = new Set(inMap);
    renderPalCats();
    renderPalette();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    $('pal-grid').innerHTML = `<div style="color:#f85149;font-size:11px">${msg}</div>`;
  }
}

function setPalette(open: boolean): void {
  paletteOpen = open;
  // The two palettes occupy the same strip, so opening this one closes the
  // object panel — which also puts down whatever it had armed.
  if (open && objPalOpen) setObjPalette(false);
  $('palette').style.display = open ? 'flex' : 'none';
  $('palbtn').classList.toggle('on', open);
  $('help').style.right = open ? '262px' : '12px';
  $('panel').style.right = open ? '262px' : '12px'; // keep the object panel clear of it
  if (open) initPalette();
}
$('palbtn').onclick = () => setPalette(!paletteOpen);
$('objpalbtn').onclick = () => {
  const open = !objPalOpen;
  // Same reason as the object list: this panel exists to put objects ON the
  // map, and placing one while objects are hidden drops it somewhere invisible.
  // Worse here than in the list, because the object really was added — it just
  // cannot be seen, so it reads as the placement having failed.
  if (open && world && !showObjects) setShowObjects(true);
  setObjPalette(open);
};
$select('obj-cat').addEventListener('change', (e) => {
  objCat = (e.currentTarget as HTMLSelectElement).value;
  objShown = OBJ_PAGE;
  renderObjGrid();
});
$input('obj-search').addEventListener('input', (e) => {
  objSearch = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase();
  objShown = OBJ_PAGE;
  renderObjGrid();
});
$input('obj-hidden').checked = showHiddenObjects; // match the restored pref
$input('obj-hidden').addEventListener('change', (e) => {
  showHiddenObjects = (e.currentTarget as HTMLInputElement).checked;
  saveUiPrefs({ showHidden: showHiddenObjects });
  objShown = OBJ_PAGE;
  renderObjGrid();
});

// Right-click gives the armed object up — the hand is already on the mouse, so
// this is the exit that costs nothing.
//
// A right DRAG still moves the camera, so this waits for pointerup and only
// acts if the button did not travel. Registered separately from the left-button
// handler, which returns early on any button but 0.
let rdown: { sx: number; sy: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2 && placeObject) rdown = { sx: ev.clientX, sy: ev.clientY };
});
addEventListener('pointerup', (ev) => {
  if (ev.button !== 2 || !rdown) return;
  const moved = Math.abs(ev.clientX - rdown.sx) >= CLICK_SLOP || Math.abs(ev.clientY - rdown.sy) >= CLICK_SLOP;
  rdown = null;
  if (moved || !placeObject) return; // that was a camera move
  armObject(null);
  $('hud').textContent = 'stopped placing';
});

// Esc gives the armed object up. Without it the only way out is finding the
// same tile in the palette again, which is a poor exit from a sticky mode.
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && placeObject && !isTyping(e.target)) {
    armObject(null);
    $('hud').textContent = 'stopped placing';
    e.preventDefault();
  }
});

$('brushbtn').onclick = () => {
  // Arming the tile brush without a tile chosen would silently do nothing, so
  // open the palette instead and let the user pick one. Sculpting needs no tile.
  if (!brushOn && brushMode === 'paint' && !paintTile) {
    setPalette(true);
    $('hud').textContent = 'pick a ground tile to paint with';
    return;
  }
  setBrush(!brushOn);
};
$select('brushsizesel').addEventListener('change', (e) => {
  const v = (e.currentTarget as HTMLSelectElement).value;
  rectMode = v === 'rect';
  vertexMode = v === 'vertex';
  if (!rectMode && !vertexMode) brushSize = +v;
  if (rectMode) $('hud').textContent = 'rect: drag out a rectangle, it applies on release';
  if (vertexMode) $('hud').textContent = 'vertex: Bulk/Dig moves the single corner nearest the cursor';
});
$input('brushforce').addEventListener('input', (e) => {
  const v = +(e.currentTarget as HTMLInputElement).value;
  // A force of zero is a brush that does nothing; ignore rather than arm it.
  if (!Number.isFinite(v) || v <= 0) return;
  brushForce = v;
  saveUiPrefs({ brushForce });
});
$input('brushtension').addEventListener('input', (e) => {
  brushTension = +(e.currentTarget as HTMLInputElement).value;
  $('brushtensionval').textContent = brushTension.toFixed(2);
  saveUiPrefs({ brushTension });
});
$select('brushmode').addEventListener('change', (e) => {
  brushMode = (e.currentTarget as HTMLSelectElement).value as BrushMode;
  sculptDir = brushMode === 'bulk' ? 1 : brushMode === 'dig' ? -1 : 0;
  // Picking a mode is the intent to use it, so arm right away. Only paint needs
  // something else chosen first, so that is the one case that redirects.
  if (brushMode === 'paint' && !paintTile) {
    setBrush(false); setPalette(true);
    $('hud').textContent = 'pick a ground tile to paint with';
    return;
  }
  setBrush(true);
  const says: Record<BrushMode, string> = {
    paint: 'painting',
    bulk: 'bulk: smooth raise', dig: 'dig: smooth lower',
    raise: 'raise: a plateau 2.0 up, with cut edges',
    lower: 'lower: a pit dug to 0, which floods',
    ramp: 'ramp: half a step up, walkable instead of a wall',
    level: 'plateau: pull everything to the level you start on',
    kind: 'ground kind: paints the tier (and ramp) without moving the ground',
    river: 'river plane: half-tile cells at the chosen strength; carve is optional',
    mask: 'masking: left-drag blocks movement', erase: 'erasing the movement mask',
  };
  $('hud').textContent = says[brushMode];
});
$('blockbtn').onclick = () => setShowBlocked(!showBlocked);

// Cliff shading on/off, so the rock blend can be compared against the raw
// stretched-ground look it replaces.
function setCliffs(on: boolean): void {
  cliffAmount = on ? 1 : 0;
  for (const m of splatMats) if (m.uniforms.uRock.value) m.uniforms.uCliff.value = cliffAmount;
  $('cliffbtn').classList.toggle('on', on);
  saveUiPrefs({ cliffs: on });
}
$('cliffbtn').onclick = () => setCliffs(!cliffAmount);

// Sea level. The bed is dug to 0 and ordinary ground sits at 2.0, but the fill
// level isn't recorded anywhere, so it's tuned by eye. The sheet is flat, so
// moving the mesh is enough — no rebuild.
let seaBase = 1.5;
$input('sealevel').addEventListener('input', (e) => {
  const v = +(e.currentTarget as HTMLInputElement).value;
  $('sealevelval').textContent = v.toFixed(2);
  if (world) for (const fl of world.floors) if (fl.waterMesh) fl.waterMesh.position.z = v - seaBase;
});

// Ground texture tiling density. The format doesn't record it, so it's tuned by
// eye against the game's own look and applied live to every splat material.
$input('texscale').addEventListener('input', (e) => {
  texScale = +(e.currentTarget as HTMLInputElement).value;
  $('texscaleval').textContent = texScale.toFixed(2);
  for (const m of splatMats) {
    m.uniforms.uScale.value = texScale;
    m.uniforms.uRockScale.value = texScale / U;
  }
  saveUiPrefs({ texScale });
});
$input('ex-search').addEventListener('input', renderExList);

async function loadMapPath(path: string | null): Promise<void> {
  if (!path) return;
  // Whatever the banner was offering is about to be on screen for real.
  hideExternalChange();
  const say = (m: string): Promise<void> => {
    $('loadmsg').textContent = m;
    // Two frames: one to run the style change, one to paint it — a single rAF
    // fires before paint, so the message would not show before the blocking
    // work that follows it.
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  };
  $('loading').classList.add('on');
  await say('decoding map…');
  try {
    // The heavy lifting is in the main process (mesh/texture decode), so the
    // renderer's own thread is free to keep the spinner turning while it runs.
    const tReq = performance.now();
    const { scene: S, info, history } = await window.editor.loadMap(path);
    const tLoad = performance.now();
    // buildWorld DOES block this thread, so let the new message paint first —
    // the GPU-composited spinner keeps moving through the freeze regardless.
    await say('building scene…');
    buildWorld(S);
    // [perf] The two halves of opening a map: the main-process decode (IPC) and
    // the renderer-blocking scene build. Grep "[perf]" while chasing a stall.
    console.log(`[perf] loadMap ${(tLoad - tReq) | 0}ms · buildWorld ${(performance.now() - tLoad) | 0}ms · ${S.geoms.length} geoms`);
    // A history kept from a previous run is adopted when the files still hash
    // the same, so opening a map is not always a blank slate.
    updateHistoryUI(history.canUndo, history.canRedo, history.undoLabel, history.redoLabel);
    $('empty').style.display = 'none';
    $('title').textContent = `homm5-editor — ${info.name} (${info.tileX}×${info.tileY})`;
    $button('pack').disabled = false;
    $('viewbtn').style.display = '';
    $('objects').style.display = '';
    $('showobj').style.display = '';
    $('scalewrap').style.display = 'flex';
    // Reflect the persisted ground-scale on the slider itself, or its thumb would
    // sit at the HTML default while the terrain uses the restored value.
    $input('texscale').value = String(texScale);
    $('texscaleval').textContent = texScale.toFixed(2);
    // Sea controls only matter on maps that actually have water-flagged ground.
    const hasSea = S.floors.some((f) => f.water && f.water.cells.length);
    $('seawrap').style.display = hasSea ? 'flex' : 'none';
    seaBase = S.floors.find((f) => f.water)?.water?.level ?? 1.5;
    $('palbtn').style.display = '';
    $('objpalbtn').style.display = '';
    $('mapbtn').style.display = '';
    $('maptreebtn').style.display = '';
    $('brushwrap').style.display = 'flex';
    // Same reason as the ground-scale slider: show the restored force and
    // tension, not the HTML defaults the brush is not using.
    $input('brushforce').value = String(brushForce);
    $input('brushtension').value = String(brushTension);
    $('brushtensionval').textContent = brushTension.toFixed(2);
    setBrush(false); // a fresh map starts in camera mode
    $('cliffbtn').style.display = '';
    $('blockbtn').style.display = '';
    setCliffs(cliffAmount > 0);
    setShowBlocked(showBlocked);
    $('help').style.display = '';
    // A newly loaded map has its own layer set; refresh the "used" markers.
    tilesInMap = new Set((await window.editor.listTiles()).inMap);
    if (allTiles.length) renderPalette();
    // Restore the panels the way they were left rather than forcing them open —
    // that is the whole point of persisting the toggles.
    setExplorer(explorerOpen);
    setShowObjects(showObjects);
    setTopView(uiPrefs.topView); // restore the plan/3D view choice
    markDirty(false);
    const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
    const floorsTxt = info.floors.length > 1
      ? ' · floors: ' + info.floors.map((f) => `${FLOOR_LABEL[f.name] || f.name} ${f.objects}`).join(', ')
      : '';
    $('hud').textContent = `${total} objects · placed ${info.placed}, no model ${info.skipped} · ${S.geoms.length} meshes${floorsTxt}`;
    // Warm the object catalogue in the background, so opening the palette is
    // instant rather than a disk scan on the first click. Kicked off only once
    // the map itself is on screen and the loading overlay is down, so it never
    // competes with the work the user is actually waiting for. Not awaited.
    void initObjectPalette();
  } catch (e) {
    $('hud').textContent = 'error: ' + (e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    $('loading').classList.remove('on');
  }
}

// --- external changes ---------------------------------------------------
//
// The original editor can be open on the same map folder. When it saves, the
// main process notices and pushes here; we offer to take its version rather
// than reloading behind the user's back, because reloading throws away whatever
// they have done on our side since the last save.

/** The change we are currently offering to take, or null when the banner is down. */
let pendingChange: ExternalChange | null = null;

function describeChange(c: ExternalChange): string {
  const parts: string[] = [];
  if (c.terrain) parts.push('terrain');
  if (c.map) parts.push('objects');
  const n = c.changed.length + c.added.length + c.removed.length;
  const what = parts.length ? parts.join(' and ') : `${n} file${n === 1 ? '' : 's'}`;
  return isDirty
    ? `Another editor rewrote ${what}. Reloading discards your unsaved changes.`
    : `Another editor rewrote ${what}.`;
}

function showExternalChange(c: ExternalChange): void {
  pendingChange = c;
  $('extchange-what').textContent = describeChange(c);
  $('extchange').style.display = 'flex';
}

function hideExternalChange(): void {
  pendingChange = null;
  $('extchange').style.display = 'none';
}

window.editor.onExternalChange((c) => { showExternalChange(c); });

$('extchange-reload').onclick = () => {
  const c = pendingChange;
  hideExternalChange();
  if (c) loadMapPath(c.mapPath);
};
// Dismissing only hides the banner: the main process has already advanced its
// baseline, so the next external save raises it again.
$('extchange-ignore').onclick = hideExternalChange;

/**
 * Open whatever the user picked: an unpacked folder's map.xdb, or a packed
 * archive — which is unpacked beside itself first, so what gets edited is always
 * a working folder and the archive stays as the game got it.
 */
async function openAny(path: string | null): Promise<void> {
  if (!path) return;
  if (!/\.(h5m|h5c|h5u|pak)$/i.test(path)) { await loadMapPath(path); return; }
  $('loading').classList.add('on');
  $('loadmsg').textContent = 'unpacking…';
  try {
    const { mapPath, mapDir, files } = await window.editor.openArchive(path);
    await loadMapPath(mapPath);
    $('hud').textContent = `unpacked ${files} files → ${mapDir}`;
    // The folder that just appeared belongs in the picker's list.
    void initPicker();
  } catch (e) {
    $('hud').textContent = 'error: ' + (e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    $('loading').classList.remove('on');
  }
}

async function openViaDialog() {
  await openAny(await window.editor.openMapDialog());
}

// In-window map picker: list openable maps under the game-data root, grouped by
// category (top folder under Maps) with search. Combat arenas / duel / test maps
// are the bulk of the list but rarely what you want to edit, so real scenarios
// (Single, Multiplayer, Campaign) sort first and get their own filter chips.
let allMaps: MapEntry[] = [];
let activeCat = ALL;

const CATEGORY = (rel: string): string => {
  const top = rel.split('/')[0] || '';
  if (/^SingleMissions/i.test(top) || /Campaign/i.test(rel)) return 'Campaigns';
  if (/^Multiplayer/i.test(top)) return 'Multiplayer';
  if (/^CombatArenas/i.test(top)) return 'Arenas';
  if (/^DuelMode/i.test(top)) return 'Duels';
  if (/TEST/i.test(rel)) return 'Tests';
  return top || 'Other';
};
const CAT_ORDER = ['Campaigns', 'Multiplayer', 'Other', 'Duels', 'Arenas', 'Tests'];
const catRank = (c: string): number => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };

function renderMapList() {
  const list = $('maplist');
  const f = $input('search').value.trim().toLowerCase();
  let shown = allMaps.filter((m) => activeCat === ALL || m.cat === activeCat);
  if (f) shown = shown.filter((m) => (m.rel + ' ' + m.name).toLowerCase().includes(f));
  shown.sort((a, b) => catRank(a.cat) - catRank(b.cat) || a.rel.localeCompare(b.rel));
  if (!shown.length) { list.innerHTML = `<div class="empty">${allMaps.length ? 'nothing found' : 'no maps found'}</div>`; return; }
  list.innerHTML = '';
  for (const m of shown.slice(0, 500)) {
    const div = document.createElement('div');
    div.className = 'm';
    div.innerHTML = `<span class="name"></span><span class="rel"></span>`;
    setChild(div, '.name', m.name);
    // Packed maps are opened by unpacking, which creates a folder — worth saying
    // so before the click rather than after.
    setChild(div, '.rel', m.archive ? `${m.rel} · unpacks` : m.rel);
    div.onclick = () => { void openAny(m.path); };
    list.appendChild(div);
  }
}

function renderCats() {
  const cats = [ALL, ...CAT_ORDER.filter((c) => allMaps.some((m) => m.cat === c))];
  const el = $('cats');
  el.innerHTML = '';
  for (const c of cats) {
    const n = c === ALL ? allMaps.length : allMaps.filter((m) => m.cat === c).length;
    const chip = document.createElement('span');
    chip.className = 'chip' + (c === activeCat ? ' on' : '');
    chip.textContent = `${c} (${n})`;
    chip.onclick = () => { activeCat = c; renderCats(); renderMapList(); };
    el.appendChild(chip);
  }
}

async function initPicker() {
  try {
    const { root, maps } = await window.editor.listMaps();
    allMaps = maps.map((m) => ({ ...m, cat: CATEGORY(m.rel) }));
    // Default to the most useful non-empty category.
    activeCat = ['Campaigns', 'Multiplayer', 'Other'].find((c) => allMaps.some((m) => m.cat === c)) || ALL;
    $('picker-foot').textContent = `${maps.length} maps · ${root}`;
    renderCats();
    renderMapList();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    $('maplist').innerHTML = `<div class="empty">could not load the list: ${msg}</div>`;
  }
}

// --- New Map -------------------------------------------------------------
//
// The original's startup dialog. Everything it asks for goes into the generated
// files; the map is written under the game's Maps folder — where the original
// editor keeps its own maps and where our Pack writes .h5m — and then opened
// like any other, so there is no separate "unsaved new map" state to get wrong.

function newMapDialog(): HTMLDialogElement {
  const el = $('newmap');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#newmap is not a <dialog>');
  return el;
}

/** Show where the map will land, so the folder is never a surprise. */
function updateNewMapWhere(): void {
  const name = $input('nm-name').value.trim() || 'New Map';
  const sub = $select('nm-type').value === 'multi' ? 'Maps/Multiplayer/' : 'Maps/SingleMissions/';
  $('nm-where').textContent = `→ <game data>/${sub}${name}`;
}

function openNewMap(): void {
  $('nm-err').textContent = '';
  updateNewMapWhere();
  newMapDialog().showModal();
  $input('nm-name').select();
}

async function submitNewMap(): Promise<void> {
  const ok = $button('nm-ok');
  ok.disabled = true;
  $('nm-err').textContent = '';
  try {
    const { mapPath } = await window.editor.newMap({
      name: $input('nm-name').value.trim(),
      tiles: Number($select('nm-size').value),
      twoLevel: $input('nm-two').checked,
      multiplayer: $select('nm-type').value === 'multi',
    });
    newMapDialog().close();
    await loadMapPath(mapPath);
    // The picker's list is now one map out of date.
    void initPicker();
  } catch (e) {
    // Stay open on failure — a name clash is fixed by editing the name.
    $('nm-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

$('newmapbtn').onclick = openNewMap;
$('newmap2').onclick = openNewMap;
$('nm-close').onclick = () => newMapDialog().close();
$('nm-cancel').onclick = () => newMapDialog().close();
$('nm-ok').onclick = () => { void submitNewMap(); };
$input('nm-name').addEventListener('input', updateNewMapWhere);
$select('nm-type').addEventListener('change', updateNewMapWhere);
// Enter in the name field creates, matching the original's default button.
$input('nm-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); void submitNewMap(); }
});

$('open').onclick = openViaDialog;
$('open2').onclick = openViaDialog;
$input('search').addEventListener('input', renderMapList);
initPicker();
// Save puts the work back where the map came from. For a map opened from a
// .h5m that is the archive itself — the working folder is ours, not something
// the user picked, so writing only there would look like nothing happened.
$('save').onclick = async () => {
  const r = await window.editor.save();
  markDirty(false);
  $('hud').textContent = r.output ? `saved → ${r.output}` : 'saved';
};
$('undobtn').onclick = () => { void stepHistory('undo'); };
$('redobtn').onclick = () => { void stepHistory('redo'); };
$('pack').onclick = async () => {
  const r = await window.editor.pack();
  if ('canceled' in r) return;
  markDirty(false);
  $('hud').textContent = `packed → ${r.output} (${(r.bytes / 1024 | 0)} KB)`;
};

// --- render loop ---
// [perf] A frame longer than this means the main thread was blocked between two
// animation frames — the "поток забит" symptom. Logging each one with its
// duration turns an intermittent stall into something you can see and time
// against the phase logs above. 100ms ≈ six dropped frames, so ordinary work
// stays quiet and only real stalls speak up.
const JANK_MS = 100;
let lastT = performance.now();
(function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const frame = now - lastT;
  if (frame > JANK_MS) console.warn(`[perf] jank: main thread blocked ${frame | 0}ms`);
  const dt = Math.min(frame / 1000, 0.1); // clamp so a stall can't teleport
  lastT = now;
  keyPan(dt);
  // Resolve at most one deferred hover pick per frame (see hoverEv).
  if (hoverEv) { updateHoverCursor(tileUnderCursor(hoverEv)); hoverEv = null; }
  controls.update();
  if (topView) syncTopCamera(); // follow pan/zoom + the orbit target each frame
  renderer.render(scene, activeCam);
})();

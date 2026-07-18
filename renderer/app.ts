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

import type { Scene, Floor, Instance, SplatData, TileInfo } from '../src/scene.ts';
import type { EditorApi, MapListEntry, ExternalChange } from '../electron/ipc.ts';

type MapEntry = MapListEntry & { cat: string };
/**
 * The preload bridge. contextIsolation is on, so this is the entire surface the
 * renderer has — the contract lives in electron/ipc.ts and both sides bind to it.
 */
declare global {
  interface Window { editor: EditorApi }
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
  /** Ground colours for the fallback material, kept for remeshing. */
  colors: number[] | null;
  group: THREE.Group;
  objGroup: THREE.Group;
  meshes: Map<string, THREE.Mesh>;
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
});

// --- world state (rebuilt on each map load) ---
// A map has one or two floors (surface + underground); each is its own terrain
// and object set. We build a group per floor and show one at a time — mixing
// them would dump underground objects onto the surface (wrong heights, chaos).
let world: World | null = null; // { floors:[{ name, V, heights, group, objGroup, meshes:Map<id,mesh> }], active }
let selected: Selection | null = null; // { id, mesh, inst }
let showObjects = false; // off by default: terrain work needs a clear ground view
let boxHelper: THREE.BoxHelper | null = null;

const raycaster = new THREE.Raycaster();
const ptr = new THREE.Vector2();

// Only called while a map is loaded; every caller is gated on `world`.
const activeFloor = (): Floor3D => world!.floors[world!.active]!;

function heightAt(x: number, y: number): number {
  const { V, heights } = activeFloor();
  const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
  return heights[iy * V + ix];
}

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
  if (world) for (const fl of world.floors) { scene.remove(fl.group); fl.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
  world = null; selected = null; updatePanel();
}

// Build the shared per-geom geometries + materials (reused across floors).
function buildGeos(S: Scene) {
  const loader = new THREE.TextureLoader();
  const grey = new THREE.MeshLambertMaterial({ color: 0x8a8f98, side: THREE.DoubleSide });
  const geos = S.geoms.map((g) => {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
    if (g.uv) b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uv), 2));
    b.setIndex(g.idx); b.computeVertexNormals();
    return b;
  });
  const mats = S.geoms.map((g) => {
    if (!g.tex) return grey;
    const tx = loader.load(g.tex); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.flipY = false;
    const m = new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide });
    // Cutout textures (foliage): discard transparent texels so leaves aren't
    // opaque black cards. alphaTest avoids the sorting cost of full transparency.
    if (g.alpha) { m.alphaTest = 0.5; m.transparent = false; }
    return m;
  });
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
  vNrm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const splatFrag = (groups: number, layers: number): string => `
precision highp sampler2DArray;
uniform sampler2DArray uGround;
uniform sampler2DArray uMask;
uniform sampler2D uRock;
uniform float uScale;
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
    vec3 rx = texture(uRock, vec2(vPos.y, vPos.z) * uScale).rgb;
    vec3 ry = texture(uRock, vec2(vPos.x, vPos.z) * uScale).rgb;
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

let texScale = 0.5;   // ground-texture repeats per map tile (tunable in the toolbar)
let cliffAmount = 1;  // how strongly steep faces take the rock texture
const splatMats: THREE.ShaderMaterial[] = [];

// Swap a floor's flat-colour terrain material for the textured splat one.
async function upgradeToSplat(fl: Floor3D): Promise<void> {
  const s = fl.splat;
  if (!s || !s.layerCount) return;
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
    wmat.map = wt;
  } else {
    wmat.color.setHex(0x0a2b2e); // fall back to the sheet's own dark tone
  }
  const mesh = new THREE.Mesh(wg, wmat);
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

function buildFloor(floor: Floor, geos: THREE.BufferGeometry[], mats: THREE.Material[]): Floor3D {
  const group = new THREE.Group();
  const V = floor.V, heights = floor.heights;

  const tg = terrainGeometry(V, heights, floor.flags, floor.colors);
  // Start on the flat MinimapColor blend; the textured splat material replaces
  // it as soon as its textures finish decoding (see upgradeToSplat).
  const terrainMesh = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
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
    m.position.set(it.x, it.y, it.z);
    m.rotation.z = it.r;
    m.userData.inst = it;
    objGroup.add(m);
    meshes.set(it.id, m);
  }
  return {
    name: floor.name, V, heights, flags: floor.flags, colors: floor.colors,
    // A river already in the map is at full depth: never dig it again.
    riverDrop: new Map(floor.riverVerts.map((v) => [v, RIVER_DEPTH])),
    passable: floor.passable, river: new Set(floor.riverVerts), passMeshes: [],
    group, objGroup, meshes, terrainMesh, waterMesh, waterTex: floor.water?.tex ?? null,
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
  const midZ = sum / heights.length, c = V / 2;
  controls.target.set(c, c, midZ);
  camera.position.set(c, -V * 0.5, midZ + V * 0.7);
  controls.update();
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
  syncExplorerSel();
}
function deselect(): void { selected = null; if (boxHelper) boxHelper.visible = false; updatePanel(); syncExplorerSel(); }

// Frame the camera on a mesh: keep the current view direction but recenter and
// back off to a distance that fits the object — so clicking a list row actually
// brings the (often tiny, often hidden) object into view.
function frameObject(mesh: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const dist = Math.max(box.getSize(new THREE.Vector3()).length() * 2.0, 8);
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
  $('p-rot').textContent = it.r.toFixed(3);
  $('p-shared').textContent = '—';
}

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

function pickObject(ev: PointerEvent): THREE.Mesh | null {
  if (!showObjects) return null; // hidden objects must not swallow clicks
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, camera);
  const hits = raycaster.intersectObjects<THREE.Mesh>([...activeFloor().meshes.values()], false);
  return hits.length ? hits[0]!.object : null;
}

renderer.domElement.addEventListener('pointerleave', () => updateBrushCursor(null));

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
    applyBrush(ev);
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
  // Track the footprint on every move, painting or not -- the point of the
  // gizmo is to show where a stroke WOULD land before committing to one.
  if (brushOn) updateBrushCursor(tileUnderCursor(ev));
  if (painting) { applyBrush(ev); return; }
  if (!dragging || !selected) return;
  // Project the cursor onto a horizontal plane at the object's height and snap
  // the resulting world position to the tile grid.
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -selected.mesh.position.z);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return;
  const nx = Math.round(hit.x), ny = Math.round(hit.y);
  if (nx === selected.inst.x && ny === selected.inst.y) return;
  selected.inst.x = nx; selected.inst.y = ny;
  selected.mesh.position.set(nx, ny, heightAt(nx, ny));
  boxHelper?.setFromObject(selected.mesh);
  moved = true;
  updatePanel();
});

addEventListener('pointerup', async (ev) => {
  if (painting) {
    painting = false;
    controls.enabled = true;
    await commitBrush();
    return;
  }
  if (!world || !down) return;
  const wasClick = Math.abs(ev.clientX - down.sx) < CLICK_SLOP && Math.abs(ev.clientY - down.sy) < CLICK_SLOP;

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

let showBlocked = false;

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
  if (!showBlocked) return;

  const cls = classifyTiles(fl);
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, lines = false): void => {
    if (!g.getAttribute('position')?.count) { g.dispose(); mat.dispose(); return; }
    const mesh = lines ? new THREE.LineSegments(g, mat) : new THREE.Mesh(g, mat);
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
  add(tileFill(fl, cls, PASS_BLOCKED), fill(0xd63030, 0.45));
  // Navigable water is outlined ON TOP of the sea rather than filled under it.
  // A fill beneath the sheet is invisible; a fill above it hides the water
  // texture, which is most of what makes a lake readable. An outline says "boat
  // goes here" and leaves the water looking like water.
  const navGrid = tileOutline(fl, cls, PASS_NAVIGABLE);
  if (navGrid.getAttribute('position')?.count) {
    const m = new THREE.LineSegments(navGrid, new THREE.LineBasicMaterial({
      color: 0x6fb2ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
    }));
    m.renderOrder = WATER_ORDER + 1;
    fl.passMeshes.push(m as unknown as THREE.Mesh);
    fl.group.add(m);
  } else navGrid.dispose();
  add(tileGrid(fl), new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false,
  }), true);
}

function setShowBlocked(on: boolean): void {
  showBlocked = on;
  $('blockbtn').classList.toggle('on', on);
  $('passlegend').style.display = on ? 'flex' : 'none';
  if (world) for (const fl of world.floors) refreshBlocked(fl);
}

/** Paint or erase the mask under the brush. */
function maskAt(ev: PointerEvent, walkable: boolean): void {
  const fl = activeFloor();
  if (!fl.passable) return;
  const at = tileUnderCursor(ev);
  if (!at) return;
  const tiles = brushTiles(fl.V, at.x, at.y, brushSize);
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
    await window.editor.setMask({ floor: world.active, verts, walkable });
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
  brushCursor = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
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
  const k = Math.floor(Math.max(1, brushSize) / 2);
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
  for (let y = at.y - k; y <= at.y + k + 1; y++) {
    for (let x = at.x - k; x <= at.x + k; x++) {
      if (y < 0 || y >= fl.V || x < 0 || x + 1 >= fl.V) continue;
      seg(x, y, x + 1, y);
    }
  }
  for (let x = at.x - k; x <= at.x + k + 1; x++) {
    for (let y = at.y - k; y <= at.y + k; y++) {
      if (x < 0 || x >= fl.V || y < 0 || y + 1 >= fl.V) continue;
      seg(x, y, x, y + 1);
    }
  }
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.computeBoundingSphere();
  c.visible = pts.length > 0;
}

/** Tile under the cursor, from a ray against the terrain itself (so it follows hills). */
function tileUnderCursor(ev: PointerEvent): { x: number; y: number } | null {
  if (!world) return null;
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, camera);
  const hit = raycaster.intersectObject(activeFloor().terrainMesh, false)[0];
  if (!hit) return null;
  return { x: Math.floor(hit.point.x), y: Math.floor(hit.point.y) };
}

/**
 * Tiles a square brush of `size` covers, as indices into a vertex-sized plane.
 *
 * Separate from brushVerts because the two address different things: textures
 * and heights are per vertex, so their brush takes the corners and spans one
 * more than the tile count. Passability is per tile, so its brush must take the
 * tiles themselves or a 1x1 stroke lands on 3x3.
 */
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
function paintMaskTexture(fl: Floor3D, layerIdx: number, verts: number[]): void {
  const tex = fl.maskTex, s = fl.splat;
  if (!tex || !s) return;
  const data = tex.image.data;
  if (!data) return; // the texture always carries its data; three's type says maybe
  const n = fl.V * fl.V;
  for (const v of verts) {
    for (let i = 0; i < s.layerCount; i++) {
      const off = ((i / 3 | 0) * n + v) * 4 + (i % 3);
      data[off] = i === layerIdx ? 255 : 0;
    }
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

/** Paint at the cursor, if the brush is armed and the tile is paintable. */
function brushAt(ev: PointerEvent): void {
  const fl = activeFloor();
  const tile = paintTile;
  if (!tile || !fl.splat) return;
  // Before upgradeToSplat finishes there is nothing to paint into. Refusing here
  // matters: the stroke would otherwise reach the file but never the screen.
  if (!fl.maskTex) { $('hud').textContent = 'ground textures still loading…'; return; }
  const layerIdx = fl.splat.paths.indexOf(tile.path);
  if (layerIdx < 0) return; // not a layer this map has — the palette shows which do
  const at = tileUnderCursor(ev);
  if (!at) return;
  const verts = brushVerts(fl.V, at.x, at.y, brushSize);
  const fresh = verts.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) return;
  for (const v of fresh) strokeVerts.add(v);
  paintMaskTexture(fl, layerIdx, fresh);
  if (isRiverTile(tile.path)) sinkRiver(fl, fresh);
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
    if (isRiverTile(tile.path)) {
      // Mask, river plane and heights travel together: a river missing any one
      // of the three is not a river, and a half-applied stroke would be worse
      // than a rejected one.
      await window.editor.paintRiver({
        floor: world.active, tile: tile.path, verts,
        heightVerts: heightEdits.map(([v]) => v),
        heights: heightEdits.map(([, h]) => h),
      });
    } else {
      await window.editor.paintTile({ floor: world.active, tile: tile.path, verts });
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
const STEP = 0.35;          // height change per brush tick at full strength
const TICK_MS = 70;         // how often a held brush reapplies

/** What a left-drag does. Mirrors the mode selector in the toolbar. */
type BrushMode = 'paint' | 'bulk' | 'dig' | 'raise' | 'lower' | 'mask' | 'erase';
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
    // there and tapers to a third at the rim. Size 1 is a flat 2x2 stamp.
    const falloff = k === 0 ? 1 : 1 - (d - 0.5) / rad;
    const i = y * fl.V + x;
    const next = Math.max(WATER_LEVEL, fl.heights[i]! + sculptDir * STEP * falloff);
    if (next === fl.heights[i]) continue;
    fl.heights[i] = next;
    if (fl.flags) {
      // A vertex at exactly 0 is a dug bed, which is what water is. Anything
      // above it is ordinary ground. Plateau (32) and ramp (8) bits are
      // deliberate authoring, so leave those vertices' kind alone.
      const f = fl.flags[i]!;
      if (!(f & 32) && !(f & 8)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
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

/** The level a Raise or Lower stroke started on; NaN between strokes. */
let plateauBase = NaN;

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
function plateauAt(ev: PointerEvent, up: boolean): void {
  const fl = activeFloor();
  const at = tileUnderCursor(ev);
  if (!at) return;
  // The first tick of a stroke fixes the tier being worked on. Dragging off it
  // onto a step above or below must leave that ground alone: otherwise tracing
  // along the rim of a tier quietly raises the one beneath it too, and one pass
  // leaves a staircase of mixed heights. Lower is bound the same way — a pit
  // traced along a plateau's edge should not swallow the plateau.
  if (!strokeVerts.size) plateauBase = fl.heights[at.y * fl.V + at.x]!;
  const verts = brushVerts(fl.V, at.x, at.y, brushSize);
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

/** Sculpt at the cursor, rate-limited so holding still is controllable. */
function sculptTick(ev: PointerEvent): void {
  const fl = activeFloor();
  const at = tileUnderCursor(ev);
  if (!at) return;
  const tile = at.y * fl.V + at.x;
  const now = performance.now();
  // Reapply when the cursor moves to a new tile, or on a timer while held —
  // otherwise a stroke that pauses would silently stop sculpting.
  if (tile === lastTile && now - lastTick < TICK_MS) return;
  lastTile = tile; lastTick = now;
  const moved = sculptAt(fl, at.x, at.y);
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
    await window.editor.sculpt({
      floor: world.active,
      verts,
      heights: verts.map((v) => fl.heights[v]!),
      flags: fl.flags ? verts.map((v) => fl.flags![v]!) : null,
    });
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'sculpt failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

/** One tick of whichever brush is armed. */
function applyBrush(ev: PointerEvent): void {
  switch (brushMode) {
    case 'paint': brushAt(ev); break;
    case 'bulk': case 'dig': sculptTick(ev); break;
    case 'raise': plateauAt(ev, true); break;
    case 'lower': plateauAt(ev, false); break;
    case 'mask': maskAt(ev, false); break;
    case 'erase': maskAt(ev, true); break;
  }
}

/** Hand the finished stroke to the main process. */
async function commitBrush(): Promise<void> {
  switch (brushMode) {
    case 'paint': await commitStroke(); break;
    case 'bulk': case 'dig': case 'raise': case 'lower': await commitSculpt(); break;
    case 'mask': await commitMask(false); break;
    case 'erase': await commitMask(true); break;
  }
}

function setBrush(on: boolean): void {
  brushOn = on;
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
let explorerOpen = true;
function setExplorer(open: boolean): void {
  explorerOpen = open;
  $('explorer').style.display = open ? 'flex' : 'none';
  $('hud').style.left = open ? '296px' : '12px';
  $('objects').classList.toggle('on', open);
}
$('objects').onclick = () => setExplorer(!explorerOpen);

// Hide/show all placed objects — terrain work needs an unobstructed ground view.
function setShowObjects(on: boolean): void {
  showObjects = on;
  if (world) for (const fl of world.floors) fl.objGroup.visible = on;
  if (!on) deselect();
  $('showobj').classList.toggle('on', on);
  $('showobj').textContent = on ? 'Objects: on' : 'Objects: off';
}
$('showobj').onclick = () => setShowObjects(!showObjects);

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
  $('palette').style.display = open ? 'flex' : 'none';
  $('palbtn').classList.toggle('on', open);
  $('help').style.right = open ? '262px' : '12px';
  $('panel').style.right = open ? '262px' : '12px'; // keep the object panel clear of it
  if (open) initPalette();
}
$('palbtn').onclick = () => setPalette(!paletteOpen);

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
  brushSize = +(e.currentTarget as HTMLSelectElement).value;
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
  for (const m of splatMats) m.uniforms.uScale.value = texScale;
});
$input('ex-search').addEventListener('input', renderExList);

async function loadMapPath(path: string | null): Promise<void> {
  if (!path) return;
  // Whatever the banner was offering is about to be on screen for real.
  hideExternalChange();
  $('loading').classList.add('on');
  // Yield a frame so the overlay paints before the (blocking) decode starts.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const { scene: S, info } = await window.editor.loadMap(path);
    buildWorld(S);
    $('empty').style.display = 'none';
    $('title').textContent = `homm5-editor — ${info.name} (${info.tileX}×${info.tileY})`;
    $button('pack').disabled = false;
    $('objects').style.display = '';
    $('showobj').style.display = '';
    $('scalewrap').style.display = 'flex';
    // Sea controls only matter on maps that actually have water-flagged ground.
    const hasSea = S.floors.some((f) => f.water && f.water.cells.length);
    $('seawrap').style.display = hasSea ? 'flex' : 'none';
    seaBase = S.floors.find((f) => f.water)?.water?.level ?? 1.5;
    $('palbtn').style.display = '';
    $('brushwrap').style.display = 'flex';
    setBrush(false); // a fresh map starts in camera mode
    $('cliffbtn').style.display = '';
    $('blockbtn').style.display = '';
    setCliffs(cliffAmount > 0);
    $('help').style.display = '';
    // A newly loaded map has its own layer set; refresh the "used" markers.
    tilesInMap = new Set((await window.editor.listTiles()).inMap);
    if (allTiles.length) renderPalette();
    setExplorer(true);
    setShowObjects(showObjects);
    markDirty(false);
    const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
    const floorsTxt = info.floors.length > 1
      ? ' · floors: ' + info.floors.map((f) => `${FLOOR_LABEL[f.name] || f.name} ${f.objects}`).join(', ')
      : '';
    $('hud').textContent = `${total} objects · placed ${info.placed}, no model ${info.skipped} · ${S.geoms.length} meshes${floorsTxt}`;
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

async function openViaDialog() {
  const path = await window.editor.openMapDialog();
  if (path) loadMapPath(path);
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
    setChild(div, '.rel', m.rel);
    div.onclick = () => loadMapPath(m.path);
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

$('open').onclick = openViaDialog;
$('open2').onclick = openViaDialog;
$input('search').addEventListener('input', renderMapList);
initPicker();
$('save').onclick = async () => { await window.editor.save(); markDirty(false); $('hud').textContent = 'saved'; };
$('pack').onclick = async () => {
  const r = await window.editor.pack();
  if ('canceled' in r) return;
  markDirty(false);
  $('hud').textContent = `packed → ${r.output} (${(r.bytes / 1024 | 0)} KB)`;
};

// --- render loop ---
let lastT = performance.now();
(function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1); // clamp so a stall can't teleport
  lastT = now;
  keyPan(dt);
  controls.update();
  renderer.render(scene, camera);
})();

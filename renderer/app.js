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

const $ = (id) => document.getElementById(id);
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
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
addEventListener('keydown', (e) => { if (!isTyping(e.target)) keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear()); // don't keep sliding if focus is lost

const panVec = new THREE.Vector3(), fwdVec = new THREE.Vector3();
function keyPan(dt) {
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
let world = null; // { floors:[{ name, V, heights, group, objGroup, meshes:Map<id,mesh> }], active }
let selected = null; // { id, mesh, inst }
let showObjects = false; // off by default: terrain work needs a clear ground view
let boxHelper = null;

const raycaster = new THREE.Raycaster();
const ptr = new THREE.Vector2();

const activeFloor = () => world.floors[world.active];

function heightAt(x, y) {
  const { V, heights } = activeFloor();
  const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
  return heights[iy * V + ix];
}

// Height -> RGB (0..1). Below ~1 reads as water; above ramps green -> rocky tan,
// mirroring the reference software render's palette.
function terrainColor(h) {
  if (h < 1) return [0.15, 0.28, 0.34];        // water
  const t = Math.max(0, Math.min(1, (h - 1) / 7));
  return [(70 + t * 70) / 255, (95 + t * 50) / 255, (60 + t * 30) / 255];
}

function clearWorld() {
  for (const m of splatMats.splice(0)) {
    m.uniforms.uGround.value?.dispose?.(); m.uniforms.uMask.value?.dispose?.(); m.dispose();
  }
  if (world) for (const fl of world.floors) { scene.remove(fl.group); fl.group.traverse((o) => o.geometry?.dispose?.()); }
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
  world = null; selected = null; updatePanel();
}

// Build the shared per-geom geometries + materials (reused across floors).
function buildGeos(S) {
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

const splatFrag = (groups, layers) => `
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

const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = src;
});

// Stack same-sized images into one DataArrayTexture via a canvas read-back.
async function arrayTexture(uris, size) {
  const data = new Uint8Array(uris.length * size * size * 4);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < uris.length; i++) {
    const img = await loadImg(uris[i]);
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
const splatMats = [];

// Swap a floor's flat-colour terrain material for the textured splat one.
async function upgradeToSplat(fl) {
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
  const old = fl.terrainMesh.material;
  fl.terrainMesh.material = mat;
  old.dispose?.();
  splatMats.push(mat);
}

// Build one floor: its coloured terrain heightmap + its placed object meshes.
function buildFloor(floor, geos, mats) {
  const group = new THREE.Group();
  const V = floor.V, heights = floor.heights;

  const tg = new THREE.BufferGeometry();
  const tp = new Float32Array(V * V * 3);
  const tc = new Float32Array(V * V * 3);
  // Half-texel offset: vertex (x,y) must land on mask texel (x,y)'s CENTRE, or
  // the splat weights drift half a tile against the heightmap.
  const tuv = new Float32Array(V * V * 2);
  // Prefer the real ground colours (blended tile textures incl. roads); fall
  // back to height-based colouring only when no texture layers resolved.
  const gc = floor.colors;
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
  // So: water meeting land, or a plateau meeting ground, is cut; anything within
  // one kind is smooth however steep. Ramps (bit 3) are the deliberate walkable
  // inclines and stay smooth even across a boundary.
  const WATER = 0, GROUND = 1, PLATEAU = 2;
  const fl = floor.flags;
  const kindOf = (i) => { const f = fl[i]; return f === 0 ? WATER : (f & 32) ? PLATEAU : GROUND; };
  const isRamp = (i) => (fl[i] & 8) !== 0;
  const MIN_STEP = 0.1; // a boundary with no real drop isn't worth a wall

  const ti = [];
  const extra = [];          // [x, y, z] triples appended after the grid vertices
  const addV = (x, y, z) => { extra.push(x, y, z); return V * V + extra.length / 3 - 1; };

  for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
    // corner indices, counter-clockwise from (x,y)
    const ci = [y * V + x, y * V + x + 1, (y + 1) * V + x + 1, (y + 1) * V + x];
    const h = ci.map((i) => heights[i]);
    const smooth = () => { const [a, b, c, d] = [ci[0], ci[1], ci[3], ci[2]]; ti.push(a, b, c, b, d, c); };
    if (!fl) { smooth(); continue; }
    if (ci.some(isRamp)) { smooth(); continue; }

    const k0 = kindOf(ci[0]);
    if (ci.every((i) => kindOf(i) === k0)) { smooth(); continue; } // inside one kind
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
    const ring = [];
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
    const cuts = ring.filter((p) => p.cut);
    if (cuts.length !== 2) { smooth(); continue; }

    // Walk the ring from one cut to the other: one arc is the high side, the
    // other the low side.
    const start = ring.findIndex((p) => p.cut);
    const arcs = [[], []];
    let side = 0;
    for (let k = 0; k <= ring.length; k++) {
      const p = ring[(start + k) % ring.length];
      arcs[side].push(p);
      if (p.cut && k > 0 && k < ring.length) { side = 1; arcs[1].push(p); }
    }
    const cutHi = cuts.map((p) => addV(p.xy[0], p.xy[1], p.hz));
    const cutLo = cuts.map((p) => addV(p.xy[0], p.xy[1], p.lz));

    for (const arc of arcs) {
      const corners = arc.filter((p) => !p.cut);
      if (!corners.length) continue;
      const top = corners[0].up;
      const ends = [arc[0], arc[arc.length - 1]];
      const edge = (p) => (top ? cutHi : cutLo)[cuts.indexOf(p)];
      const poly = [edge(ends[0]), ...corners.map((p) => p.gi), edge(ends[1])];
      for (let k = 1; k < poly.length - 1; k++) ti.push(poly[0], poly[k], poly[k + 1]);
    }
    // The wall, both faces (material is DoubleSide anyway).
    ti.push(cutHi[0], cutHi[1], cutLo[0], cutHi[1], cutLo[1], cutLo[0]);
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
    const wpos = [], wuv = [], widx = [];
    const vmap = new Map();
    const vert = (i) => {
      let v = vmap.get(i);
      if (v === undefined) {
        v = wpos.length / 3;
        const x = i % V, y = (i / V) | 0;
        wpos.push(x, y, wat.level);
        wuv.push(x / 8, y / 8); // gentle tiling; the sheet is mostly flat colour
        vmap.set(i, v);
      }
      return v;
    };
    for (const a of wat.cells) {
      const A = vert(a), B = vert(a + 1), C = vert(a + V), D = vert(a + V + 1);
      widx.push(A, B, C, B, D, C);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wpos), 3));
    wg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(wuv), 2));
    wg.setIndex(widx);
    wg.computeVertexNormals();
    // The sea wears its own sheet — dark by design. Rivers are a different
    // thing entirely: painted tiles using the blue _TNL brush textures.
    const wmat = new THREE.MeshPhongMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88,
      shininess: 90, specular: 0x5f7f95, side: THREE.DoubleSide, depthWrite: false,
    });
    if (wat.tex) {
      const wt = new THREE.TextureLoader().load(wat.tex);
      wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
      wmat.map = wt;
    } else {
      wmat.color.setHex(0x0a2b2e); // fall back to the sheet's own dark tone
    }
    waterMesh = new THREE.Mesh(wg, wmat);
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
  return { name: floor.name, V, heights, group, objGroup, meshes, terrainMesh, waterMesh, splat: floor.splat, instances: floor.instances };
}

function buildWorld(S) {
  clearWorld();
  const { geos, mats } = buildGeos(S);
  const floors = S.floors.map((f) => buildFloor(f, geos, mats));
  for (const fl of floors) scene.add(fl.group);
  world = { floors, active: 0 };
  setActiveFloor(0); // frames the floor + builds its explorer list
  updateFloorUI();
  // Textured ground arrives asynchronously; the flat blend shows meanwhile.
  for (const fl of floors) {
    upgradeToSplat(fl).catch((e) => { console.error('splat failed', fl.name, e); $('hud').textContent = 'ground textures: ' + e.message; });
  }
}

// Switch which floor is shown; only its group is visible and pickable.
function setActiveFloor(i) {
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
function selectById(id) {
  const mesh = activeFloor().meshes.get(id);
  if (!mesh) return;
  selected = { id, mesh, inst: mesh.userData.inst };
  if (!boxHelper) { boxHelper = new THREE.BoxHelper(mesh, 0x4fd1c5); scene.add(boxHelper); }
  else { boxHelper.setFromObject(mesh); boxHelper.visible = true; }
  updatePanel();
  syncExplorerSel();
}
function deselect() { selected = null; if (boxHelper) boxHelper.visible = false; updatePanel(); syncExplorerSel(); }

// Frame the camera on a mesh: keep the current view direction but recenter and
// back off to a distance that fits the object — so clicking a list row actually
// brings the (often tiny, often hidden) object into view.
function frameObject(mesh) {
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
const TYPE_LABEL = {
  AdvMapStatic: 'Decor', AdvMapTreasure: 'Treasure', AdvMapMonster: 'Monsters',
  AdvMapBuilding: 'Buildings', AdvMapMine: 'Mines', AdvMapArtifact: 'Artifacts',
  AdvMapDwelling: 'Dwellings', AdvMapShrine: 'Shrines', AdvMapHero: 'Heroes',
  AdvMapTown: 'Towns', AdvMapGarrison: 'Garrisons', AdvMapAbanMine: 'Abandoned mines',
  AdvMapShipyard: 'Shipyards', AdvMapSign: 'Signs', AdvMapTent: 'Tents',
  AdvMapHillFort: 'Hill forts', AdvMapDwarvenWarren: 'Warrens', AdvMapSeerHut: 'Seer huts',
  AdvMapPrison: 'Prisons', AdvMapCartographer: 'Cartographers', AdvMapSphinx: 'Sphinxes',
};

function objName(it) {
  const base = (it.shared || '').split('/').pop() || it.type;
  return base.replace(/\.\(AdvMap\w+Shared\)\.xdb$/i, '').replace(/\.xdb$/i, '') || it.type;
}
function objCategory(it) {
  if (it.type !== 'AdvMapStatic') return TYPE_LABEL[it.type] || it.type;
  const m = (it.shared || '').match(/\/MapObjects\/([^/]+)\//i);
  return m ? m[1] : 'Decor';
}

let exCat = ALL;
const exInstances = () => (world ? activeFloor().instances : []);

function renderExplorer() { renderExCats(); renderExList(); }

function renderExCats() {
  const insts = exInstances();
  const counts = new Map();
  for (const it of insts) { const c = objCategory(it); counts.set(c, (counts.get(c) || 0) + 1); }
  if (!counts.has(exCat) && exCat !== ALL) exCat = ALL;
  const el = $('ex-cats'); el.innerHTML = '';
  const chip = (label, n, key) => {
    const c = document.createElement('span');
    c.className = 'chip' + (key === exCat ? ' on' : '');
    c.textContent = `${label} (${n})`;
    c.onclick = () => { exCat = key; renderExCats(); renderExList(); };
    el.appendChild(c);
  };
  chip(ALL, insts.length, ALL);
  for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) chip(c, n, c);
}

function renderExList() {
  const list = $('ex-list');
  const f = $('ex-search').value.trim().toLowerCase();
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
    div.dataset.id = it.id;
    div.innerHTML = `<span class="nm"></span><span class="co"></span>`;
    div.querySelector('.nm').textContent = objName(it);
    div.querySelector('.co').textContent = `${it.x},${it.y}`;
    div.onclick = () => {
      selectById(it.id);
      const m = activeFloor().meshes.get(it.id);
      if (m) frameObject(m);
    };
    frag.appendChild(div);
  }
  list.appendChild(frag);
  if (shown.length > 2000) list.insertAdjacentHTML('beforeend', '<div class="empty">…first 2000 shown</div>');
}

// Highlight the selected object's row (and scroll it into view when off-screen).
function syncExplorerSel() {
  const list = $('ex-list'); if (!list) return;
  let selRow = null;
  for (const r of list.querySelectorAll('.exrow')) {
    const on = selected && r.dataset.id === selected.id;
    r.classList.toggle('sel', on);
    if (on) selRow = r;
  }
  if (selRow) selRow.scrollIntoView({ block: 'nearest' });
}

function updatePanel() {
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
let down = null;      // { sx, sy, hitId }
let dragging = false, moved = false;

function pickObject(ev) {
  if (!showObjects) return null; // hidden objects must not swallow clicks
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, camera);
  const hits = raycaster.intersectObjects([...activeFloor().meshes.values()], false);
  return hits.length ? hits[0].object : null;
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (!world || ev.button !== 0) return;
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
  boxHelper.setFromObject(selected.mesh);
  moved = true;
  updatePanel();
});

addEventListener('pointerup', async (ev) => {
  if (!world || !down) return;
  const wasClick = Math.abs(ev.clientX - down.sx) < CLICK_SLOP && Math.abs(ev.clientY - down.sy) < CLICK_SLOP;

  if (dragging) {
    dragging = false; controls.enabled = true;
    if (moved && selected) {
      await window.editor.moveObject(selected.inst.id, selected.inst.x, selected.inst.y);
      markDirty(true);
    }
  } else if (wasClick) {
    // A click that didn't move the camera: (de)select.
    if (down.hitId) selectById(down.hitId); else deselect();
  }
  down = null;
});

// --- toolbar ---
let isDirty = false;
function markDirty(v) {
  isDirty = v;
  $('dirty').textContent = v ? '● unsaved changes' : '';
  $('dirty').className = v ? 'on' : '';
  $('save').disabled = !v;
}

const FLOOR_LABEL = { surface: 'Surface', underground: 'Underground' };
// Floor button: shown only for two-floor maps; label names the OTHER floor it
// switches to, and clicking cycles.
function updateFloorUI() {
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
function setExplorer(open) {
  explorerOpen = open;
  $('explorer').style.display = open ? 'flex' : 'none';
  $('hud').style.left = open ? '296px' : '12px';
  $('objects').classList.toggle('on', open);
}
$('objects').onclick = () => setExplorer(!explorerOpen);

// Hide/show all placed objects — terrain work needs an unobstructed ground view.
function setShowObjects(on) {
  showObjects = on;
  if (world) for (const fl of world.floors) fl.objGroup.visible = on;
  if (!on) deselect();
  $('showobj').classList.toggle('on', on);
  $('showobj').textContent = on ? 'Objects: on' : 'Objects: off';
}
$('showobj').onclick = () => setShowObjects(!showObjects);

// --- terrain palette (content browser) -------------------------------------
// The ground tiles the game ships, grouped by their folder the way the original
// editor's "Terra skin" list is. Selecting one arms it as the paint tile; the
// brushes that consume it come next. A green dot marks tiles this map's terrain
// already has a layer for — those paint without restructuring the .bin.
let allTiles = [];
let tilesInMap = new Set();
let palCat = null;
let paintTile = null;
let paletteOpen = false;

function renderPalette() {
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
      dot.title = 'This map already has a layer for this tile — paintable by editing the existing mask, no terrain.bin rebuild';
      el.appendChild(dot);
    }
    el.onclick = () => {
      paintTile = t;
      $('pal-sel').textContent = `${t.name} · priority ${t.priority}`;
      renderPalette();
    };
    grid.appendChild(el);
  }
}

function renderPalCats() {
  const cats = [...new Set(allTiles.map((t) => t.category))].sort();
  const sel = $('pal-cat');
  sel.innerHTML = '';
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = `${c} (${allTiles.filter((t) => t.category === c).length})`;
    sel.appendChild(o);
  }
  if (!cats.includes(palCat)) palCat = cats.includes('Grass') ? 'Grass' : cats[0];
  sel.value = palCat;
}
$('pal-cat').addEventListener('change', (e) => { palCat = e.target.value; renderPalette(); });

async function initPalette() {
  if (allTiles.length) return;
  try {
    const { tiles, inMap } = await window.editor.listTiles();
    allTiles = tiles;
    tilesInMap = new Set(inMap);
    renderPalCats();
    renderPalette();
  } catch (e) {
    $('pal-grid').innerHTML = `<div style="color:#f85149;font-size:11px">${e.message}</div>`;
  }
}

function setPalette(open) {
  paletteOpen = open;
  $('palette').style.display = open ? 'flex' : 'none';
  $('palbtn').classList.toggle('on', open);
  $('help').style.right = open ? '262px' : '12px';
  $('panel').style.right = open ? '262px' : '12px'; // keep the object panel clear of it
  if (open) initPalette();
}
$('palbtn').onclick = () => setPalette(!paletteOpen);

// Cliff shading on/off, so the rock blend can be compared against the raw
// stretched-ground look it replaces.
function setCliffs(on) {
  cliffAmount = on ? 1 : 0;
  for (const m of splatMats) if (m.uniforms.uRock.value) m.uniforms.uCliff.value = cliffAmount;
  $('cliffbtn').classList.toggle('on', on);
}
$('cliffbtn').onclick = () => setCliffs(!cliffAmount);

// Sea level. The bed is dug to 0 and ordinary ground sits at 2.0, but the fill
// level isn't recorded anywhere, so it's tuned by eye. The sheet is flat, so
// moving the mesh is enough — no rebuild.
let seaBase = 1.5;
$('sealevel').addEventListener('input', (e) => {
  const v = +e.target.value;
  $('sealevelval').textContent = v.toFixed(2);
  if (world) for (const fl of world.floors) if (fl.waterMesh) fl.waterMesh.position.z = v - seaBase;
});

// Ground texture tiling density. The format doesn't record it, so it's tuned by
// eye against the game's own look and applied live to every splat material.
$('texscale').addEventListener('input', (e) => {
  texScale = +e.target.value;
  $('texscaleval').textContent = texScale.toFixed(2);
  for (const m of splatMats) m.uniforms.uScale.value = texScale;
});
$('ex-search').addEventListener('input', renderExList);

async function loadMapPath(path) {
  if (!path) return;
  $('loading').classList.add('on');
  // Yield a frame so the overlay paints before the (blocking) decode starts.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const { scene: S, info } = await window.editor.loadMap(path);
    buildWorld(S);
    $('empty').style.display = 'none';
    $('title').textContent = `homm5-editor — ${info.name} (${info.tileX}×${info.tileY})`;
    $('pack').disabled = false;
    $('objects').style.display = '';
    $('showobj').style.display = '';
    $('scalewrap').style.display = 'flex';
    // Sea controls only matter on maps that actually have water-flagged ground.
    const hasSea = S.floors.some((f) => f.water && f.water.cells.length);
    $('seawrap').style.display = hasSea ? 'flex' : 'none';
    if (hasSea) seaBase = S.floors.find((f) => f.water)?.water.level ?? 1.5;
    $('palbtn').style.display = '';
    $('cliffbtn').style.display = '';
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
    $('hud').textContent = 'error: ' + e.message;
    console.error(e);
  } finally {
    $('loading').classList.remove('on');
  }
}

async function openViaDialog() {
  const path = await window.editor.openMapDialog();
  if (path) loadMapPath(path);
}

// In-window map picker: list openable maps under the game-data root, grouped by
// category (top folder under Maps) with search. Combat arenas / duel / test maps
// are the bulk of the list but rarely what you want to edit, so real scenarios
// (Single, Multiplayer, Campaign) sort first and get their own filter chips.
let allMaps = [];
let activeCat = ALL;

const CATEGORY = (rel) => {
  const top = rel.split('/')[0] || '';
  if (/^SingleMissions/i.test(top) || /Campaign/i.test(rel)) return 'Campaigns';
  if (/^Multiplayer/i.test(top)) return 'Multiplayer';
  if (/^CombatArenas/i.test(top)) return 'Arenas';
  if (/^DuelMode/i.test(top)) return 'Duels';
  if (/TEST/i.test(rel)) return 'Tests';
  return top || 'Other';
};
const CAT_ORDER = ['Campaigns', 'Multiplayer', 'Other', 'Duels', 'Arenas', 'Tests'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };

function renderMapList() {
  const list = $('maplist');
  const f = $('search').value.trim().toLowerCase();
  let shown = allMaps.filter((m) => activeCat === ALL || m.cat === activeCat);
  if (f) shown = shown.filter((m) => (m.rel + ' ' + m.name).toLowerCase().includes(f));
  shown.sort((a, b) => catRank(a.cat) - catRank(b.cat) || a.rel.localeCompare(b.rel));
  if (!shown.length) { list.innerHTML = `<div class="empty">${allMaps.length ? 'nothing found' : 'no maps found'}</div>`; return; }
  list.innerHTML = '';
  for (const m of shown.slice(0, 500)) {
    const div = document.createElement('div');
    div.className = 'm';
    div.innerHTML = `<span class="name"></span><span class="rel"></span>`;
    div.querySelector('.name').textContent = m.name;
    div.querySelector('.rel').textContent = m.rel;
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
    $('maplist').innerHTML = `<div class="empty">could not load the list: ${e.message}</div>`;
  }
}

$('open').onclick = openViaDialog;
$('open2').onclick = openViaDialog;
$('search').addEventListener('input', renderMapList);
initPicker();
$('save').onclick = async () => { await window.editor.save(); markDirty(false); $('hud').textContent = 'saved'; };
$('pack').onclick = async () => {
  const r = await window.editor.pack();
  if (r?.canceled) return;
  markDirty(false);
  $('hud').textContent = r?.ok ? `packed → ${r.output} (${(r.bytes / 1024 | 0)} KB)` : 'pack failed';
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

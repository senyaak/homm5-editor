// The ground splat: N tile textures blended by per-vertex weight masks, and the
// parts of a model that take the ground they stand on as their surface.
//
// Baking the blend into one atlas would need ~500 texels per tile to stay
// sharp, so instead it blends live: each texture tiles across the map at
// `uScale` repeats per tile, weighted by its mask. Both texture sets are 2D
// array textures (WebGL2), which keeps it to two samplers no matter how many
// layers a map uses.

import * as THREE from 'three';

import { uiPrefs } from '#core/prefs.ts';
import type { Floor3D } from '#core/state.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';
import { geomParts } from '#viewport/geoms.ts';
import { uSunDir, uSunCol, uAmbCol, uShadeCol, uLmGain, uWhiten } from '#viewport/lighting.ts';
import { partTexture } from '#viewport/materials.ts';
import { renderer } from '#viewport/stage.ts';

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
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uShade;
uniform float uWhiten;
uniform sampler2D uLm;  // baked designer point lights (bakeLightMap)
uniform float uInvTiles;
uniform float uLmGain;  // the Light toggle: 0 turns the pools off
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

  // The game's own fixed-function sum, in the same gamma space it ran in:
  // albedo · (ambient + sun·NdotL + pointLights) · 2 — the ×2 is the era's
  // modulate-×2 (the preset's colours are authored around 0.2-0.55 with it in
  // mind), and the baked designer lights join the sum before it, like the
  // engine's own vertex lights would.
  // The lightmap spans the TILES (vWorld/tiles), not vGrid: vGrid is nudged
  // half a texel to hit the V-wide mask's texel centers and would smear the
  // pools half a tile off their objects.
  float ndl = dot(n, normalize(uSunDir));
  vec3 pl = texture(uLm, vWorld * uInvTiles).rgb * uLmGain;
  outColor = vec4(col * ((uAmb + max(ndl, 0.0) * (uSunCol - uAmb)
                               + max(-ndl, 0.0) * (uShade - uAmb) + pl) * uWhiten), 1.0);
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

/** Ground-texture repeats per map tile, and how strongly steep faces take the
 *  rock texture. Both are toolbar settings; the setters below are what moves
 *  them, so every live material is updated in one place. */
let texScale = uiPrefs.texScale;
let cliffAmount = uiPrefs.cliffs ? 1 : 0;
const splatMats: THREE.ShaderMaterial[] = [];

/** Re-tile the ground (and the rock on cliff faces) at `repeats` per tile. */
export function setGroundScale(repeats: number): void {
  texScale = repeats;
  for (const m of splatMats) {
    m.uniforms.uScale!.value = texScale;
    m.uniforms.uRockScale!.value = texScale / U;
  }
}

/** Turn the rock blend on steep faces on or off. */
export function setCliffAmount(on: boolean): void {
  cliffAmount = on ? 1 : 0;
  for (const m of splatMats) if (m.uniforms.uRock!.value) m.uniforms.uCliff!.value = cliffAmount;
}

/** Whether cliff faces currently take the rock texture — the toolbar's label. */
export const cliffsOn = (): boolean => cliffAmount > 0;

/** Drop every live splat material and its textures (a map is being put down). */
export function disposeSplats(): void {
  for (const m of splatMats.splice(0)) {
    m.uniforms.uGround!.value?.dispose?.(); m.uniforms.uMask!.value?.dispose?.(); m.dispose();
  }
}

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
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uShade;
uniform float uWhiten;
uniform sampler2D uLm;
uniform float uLmGain;
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
  // Lit with the terrain's own sun formula: the part IS ground, and a mound
  // shaded differently from the flat around it reads as a decal, not a hump.
  // Here vGrid is exactly grid/tiles (see PROJ_VERT), which is the lightmap's
  // own mapping, so the pools land where the terrain draws them.
  float ndl = dot(normalize(vNrm), normalize(uSunDir));
  vec3 pl = texture(uLm, vGrid).rgb * uLmGain;
  outColor = vec4(col * ((uAmb + max(ndl, 0.0) * (uSunCol - uAmb)
                               + max(-ndl, 0.0) * (uShade - uAmb) + pl) * uWhiten), 1.0);
}`;

/**
 * Give every terrain-projected part of this floor a material that samples the
 * floor's ground. Runs after the splat exists, since it borrows its textures —
 * and its uniform objects by reference, so the ground-scale slider reaches these
 * materials through the same uScale it writes on the terrain.
 */
export function applyProjectedMaterials(fl: Floor3D): void {
  for (const g of fl.batches.keys()) projectBatch(fl, g);
}

/**
 * Give one batch's terrain-projected parts their ground-sampling material.
 * Split out from applyProjectedMaterials so a freshly placed object gets the
 * same treatment a loaded one does — otherwise a mine dropped from the palette
 * kept the transparent overlay and its earth hood vanished.
 */
export function projectBatch(fl: Floor3D, g: number): void {
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
    const overlay = p.tex ? partTexture(p.tex) : null;
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
        uLm: { value: fl.lightMap }, uLmGain,
        uSunDir, uSunCol, uAmb: uAmbCol, uShade: uShadeCol, uWhiten,
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

// Swap a floor's flat-colour terrain material for the textured splat one.
export async function upgradeToSplat(fl: Floor3D): Promise<void> {
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
      uLm: { value: fl.lightMap }, uInvTiles: { value: 1 / (s.V - 1) }, uLmGain,
      uSunDir, uSunCol, uAmb: uAmbCol, uShade: uShadeCol, uWhiten,
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


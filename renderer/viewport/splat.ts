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
import type { Floor3D, MaterialBatch } from '#core/state.ts';
import type { IdleKind } from '#viewport/skinning.ts';
import type { GeomPart, Instance, SplatData } from '#src/scene/payload.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';
import { DRAPE_PARS, DRAPE_VERT_PARS, TERRAIN_DEPTH, drapeUniforms } from '#viewport/drape.ts';
import { geomParts } from '#viewport/geoms.ts';
import { uSunDir, uSunCol, uAmbCol, uShadeCol, uIncidentCol, uLmGain, uWhiten } from '#viewport/lighting.ts';
import { partTexture } from '#viewport/materials.ts';
import { SHADOW_FRAG_PARS, SHADOW_VERT_PARS, shadowUniforms, shadowVert } from '#viewport/shadows.ts';
import { renderer } from '#viewport/stage.ts';
import { refreshHoles } from '#viewport/terrain-mesh.ts';

const SPLAT_VERT = `
${SHADOW_VERT_PARS}
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
${shadowVert('modelMatrix * vec4(position, 1.0)', 'vNrm')}
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const splatFrag = (groups: number, layers: number): string => `
precision highp sampler2DArray;
${SHADOW_FRAG_PARS}
uniform sampler2DArray uGround;
uniform sampler2DArray uMask;
uniform sampler2D uRock;
uniform float uScale;
uniform float uRockScale;
uniform float uCliff;   // 0 disables the rock blend entirely
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uShade;
uniform vec3 uIncident;
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
  // In shadow the sun end of that mix becomes IncidentShadowColor — the same
  // substitution the objects make (renderer/viewport/materials.ts), because the
  // engine makes it for every surface: it bakes both colours into every vertex.
  // The ground is where a shadow is actually seen, so this is the half of the
  // feature that shows.
  float ndl = dot(n, normalize(uSunDir));
  vec3 sunEnd = mix(uIncident, uSunCol, sunlitHere());
  vec3 pl = texture(uLm, vWorld * uInvTiles).rgb * uLmGain;
  outColor = vec4(col * ((uAmb + max(ndl, 0.0) * (sunEnd - uAmb)
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
// A part flagged `terrainProjected` (model-geom.ts: <ProjectOnTerrain> on an
// AM_OVERLAY material) takes the ground it stands on as its surface. The
// Abandoned Mine's mound is the clearest case: on grass the engine draws a
// grassy hump, the model supplying only the dark ore patch, so the green has
// to come from the terrain underneath — which is what Senya saw in the
// original editor, the map's texture climbing the hill. A mountain is the same
// rule at the other end of the alpha: its rock is 96% opaque and its skirt
// fades out, and where it fades the ground runs up into it.
//
// So these parts are shaded with the SAME splat the ground uses, sampled at
// their own world position, with their own texture laid over it by its alpha.
// The mix, not a darkening: the old shader multiplied the texture in, which
// suits a near-black ore patch and turns a mountain into ground with dark rock
// smeared over it. And they are draped like every other <ProjectOnTerrain>
// part (drape.ts), so the skirt they blend out along lies on the ground it
// blends into.
//
// Once this ran on every <ProjectOnTerrain> part with the darkening mix and
// smeared a column of ground texels up Mountain10x10's cliffs; the fix then
// was to gate it on a sheer texture. The smear was the darkening — with the
// rock laid over by its alpha there is no ground to see on a cliff face.

const PROJ_VERT = `
${SHADOW_VERT_PARS}
${DRAPE_VERT_PARS}
#include <batching_pars_vertex>
out vec2 vGrid;   // 0..1 across the map -> mask lookup
out vec2 vWorld;  // tile coords -> tiled ground lookup
out vec2 vUv;     // the part's own uv, for its own texture
out vec3 vNrm;
uniform float uMapSide;   // V - 1
uniform float uUnits;     // world units per tile
void main() {
  // The mesh is batched, so the position has to come through the batch's
  // matrix for this instance exactly as three's own materials take it.
  #include <batching_vertex>
  mat4 model = modelMatrix;
  #ifdef USE_BATCHING
    model = modelMatrix * batchingMatrix;
  #endif
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
  #endif
  vec4 world = drape(model * vec4(position, 1.0), model[3].z, 1.0);
  vNrm = normalize(mat3(model) * normal);
  // Objects live in world units; the splat composites in grid coords, so convert
  // once here and the ground lines up with the terrain seamlessly.
  vec2 grid = world.xy / uUnits;
  vGrid = grid / uMapSide;
  vWorld = grid;
  vUv = uv;
${shadowVert('world', 'vNrm')}
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const projFrag = (groups: number, layers: number): string => `
precision highp sampler2DArray;
${SHADOW_FRAG_PARS}
${DRAPE_PARS}
uniform sampler2DArray uGround;
uniform sampler2DArray uMask;
uniform sampler2D uOverlay;
uniform float uScale;
uniform float uHasOverlay;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uShade;
uniform vec3 uIncident;
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
  // The model's own texture lies over the ground by its alpha: the mound's
  // near-black ore patch at low alpha darkens the grass, the mountain's rock at
  // full alpha replaces it, and the rock's fading skirt hands over to the
  // ground it stands on.
  vec4 o = uHasOverlay > 0.5 ? texture(uOverlay, vUv) : vec4(0.0);
  // Lit with the terrain's own sun formula — and, for the ground's share, with
  // the GROUND's normal, not the mesh's. The mesh's normals belong to the
  // rock: along a mountain's skirt they lean with the slope of the model, and
  // ground lit by them came out a shade darker than the same ground a step
  // away, a visible seam round every mountain (Senya, Mountain10x10). The
  // ground under the part is lit as the terrain lights it, the texture as the
  // part does, and the two are mixed by the same alpha as the colours. On a
  // mound that is mostly ground (the mine's), the hump therefore shades as the
  // flat around it — which is the game's picture, where the mound is a
  // near-transparent overlay and what shows is the terrain itself.
  // Here vGrid is exactly grid/tiles (see PROJ_VERT), which is the lightmap's
  // own mapping, so the pools land where the terrain draws them.
  vec3 sunEnd = mix(uIncident, uSunCol, sunlitHere());
  vec3 pl = texture(uLm, vGrid).rgb * uLmGain;
  float ndlGround = dot(drapeNormal(vWorld * uDrapeUnits), normalize(uSunDir));
  float ndlPart = dot(normalize(vNrm), normalize(uSunDir));
  vec3 litGround = col * ((uAmb + max(ndlGround, 0.0) * (sunEnd - uAmb)
                                + max(-ndlGround, 0.0) * (uShade - uAmb) + pl) * uWhiten);
  vec3 litPart = o.rgb * ((uAmb + max(ndlPart, 0.0) * (sunEnd - uAmb)
                                + max(-ndlPart, 0.0) * (uShade - uAmb) + pl) * uWhiten);
  outColor = vec4(mix(litGround, litPart, o.a), 1.0);
}`;

/**
 * Give every terrain-projected part of this floor a material that samples the
 * floor's ground. Runs after the splat exists, since it borrows its textures —
 * and its uniform objects by reference, so the ground-scale slider reaches these
 * materials through the same uScale it writes on the terrain.
 */
export function applyProjectedMaterials(fl: Floor3D): void {
  // One batch's failure must not leave every batch after it unprojected — a
  // skin drawn with the untextured stand-in is a light grey plate on the
  // ground, and an overlay drawn as a plain decal is a see-through floor.
  for (const b of fl.materialBatches.values()) {
    try { projectMaterialBatch(fl, b); } catch (e) { console.error(`projected material failed for ${b.key}`, e); }
  }
  // The animated bodies are drawn by their own skinned meshes, not by a batch
  // (idle.ts), and they need the ground just the same: a sawmill's floor and
  // the Inferno post's crucible pit are ground-projected parts on models with
  // an idle clip. Left to the registry's materials they drew the pit's skin as
  // a light grey plate and the floor as a see-through decal — only with the
  // animation on, which is why the harness, built without it, showed neither
  // (Senya).
  for (const kind of fl.idleKinds.values()) {
    try { projectIdle(fl, kind); } catch (e) { console.error('projected material failed for an animated object', e); }
  }
}

/** The animated-body counterpart of projectBatch: the same materials on a kind's skinned draw. */
export function projectIdle(fl: Floor3D, kind: IdleKind): void {
  const g = kind.bodies[0]?.inst.g;
  if (g === undefined) return;
  const list = projectedList(fl, g, kind.mesh.material);
  if (list) kind.mesh.material = list;
}

/**
 * Give one batch's terrain-projected parts their ground-sampling material.
 * Split out from applyProjectedMaterials so a freshly placed object gets the
 * same treatment a loaded one does — otherwise a mine dropped from the palette
 * kept the transparent overlay and its earth hood vanished.
 */
export function projectBatch(fl: Floor3D, g: number): void {
  const batch = fl.batches.get(g);
  if (!batch) return;
  for (const p of batch.parts) projectMaterialBatch(fl, p.batch);
}

/**
 * A material batch whose part takes the ground draws with this floor's
 * ground-sampling material — built once per batch, since every part in it
 * wears the same overlay; left alone when the splat is not up yet, or when
 * the batch already samples THIS floor's ground.
 */
function projectMaterialBatch(fl: Floor3D, b: MaterialBatch): void {
  if (!b.part.terrainProjected) return;
  const s = fl.splat;
  const splatMat = fl.terrainMesh.material as THREE.ShaderMaterial;
  if (!s || !splatMat?.uniforms?.uGround) return;
  if ((b.mesh.material as THREE.ShaderMaterial)?.uniforms?.uGround === splatMat.uniforms.uGround) return;
  b.mesh.material = projectedMaterial(fl, b.part, s, splatMat);
}

/** The ground-sampling material for one ground-projected part on one floor. */
function projectedMaterial(fl: Floor3D, p: GeomPart, s: SplatData, splatMat: THREE.ShaderMaterial): THREE.ShaderMaterial {
  const overlay = p.tex ? partTexture(p.tex) : null;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PROJ_VERT,
    fragmentShader: projFrag(s.maskGroups.length, s.layerCount),
    uniforms: {
      ...shadowUniforms(),
      ...drapeUniforms(),
      uGround: splatMat.uniforms.uGround!,
      uMask: splatMat.uniforms.uMask!,
      uScale: splatMat.uniforms.uScale!,
      uOverlay: { value: overlay },
      uHasOverlay: { value: overlay ? 1 : 0 },
      uMapSide: { value: s.V - 1 },
      uUnits: { value: U },
      uLm: { value: fl.lightMap }, uLmGain,
      uSunDir, uSunCol, uAmb: uAmbCol, uShade: uShadeCol, uIncident: uIncidentCol, uWhiten,
    },
    lights: true, // what makes three define the shadow chunks and fill them
    // Culled like any other part (materials.ts on why): a mountain drawn
    // two-sided fills the frame with its inside when a dialogue camera pulls
    // back into the ridge.
    side: p.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    // The mound IS the ground, and the building's entrance and floor sit ON
    // it: where they are coplanar the two flickered green/dark as the camera
    // moved. Push the ground surface back in depth so the solid parts on top
    // of it always win — but less far than the terrain itself is pushed
    // (upgradeToSplat), since a draped swamp or crater is coplanar with THAT
    // and has to win there.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * Geom `g`'s material list with every ground-projected part given this
 * floor's ground-sampling material — or null when nothing needed changing.
 * Shared by the batches and the animated bodies, which hold their lists apart.
 */
function projectedList(fl: Floor3D, g: number, mats: THREE.Material | THREE.Material[]): THREE.Material[] | null {
  const s = fl.splat;
  const splatMat = fl.terrainMesh.material as THREE.ShaderMaterial;
  if (!s || !splatMat?.uniforms?.uGround) return null;
  const parts = geomParts.get(g);
  if (!parts) return null;
  // A COPY of the model's material list, never the registry's own array
  // (geoms.ts hands the same array to every floor's batch): written into in
  // place, the surface floor's ground-sampling material ended up on the
  // underground batch too, with the surface's grass on a mound in the caves.
  const list = (Array.isArray(mats) ? mats : [mats]).slice();
  let changed = false;
  parts.forEach((p, i) => {
    if (!p.terrainProjected) return;
    // Already projected against THIS floor's splat (a re-run on add): leave it.
    // Against another one — an add-layer rebuild replaced the ground textures —
    // it has to be built again.
    if ((list[i] as THREE.ShaderMaterial)?.uniforms?.uGround === splatMat.uniforms.uGround) return;
    list[i] = projectedMaterial(fl, p, s, splatMat);
    changed = true;
  });
  return changed ? list : null;
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
      ...shadowUniforms(),
      uGround: { value: ground }, uMask: { value: masks },
      uRock: { value: rock }, uCliff: { value: rock ? cliffAmount : 0 },
      uScale: { value: texScale },
      uRockScale: { value: texScale / U },
      uLm: { value: fl.lightMap }, uInvTiles: { value: 1 / (s.V - 1) }, uLmGain,
      uSunDir, uSunCol, uAmb: uAmbCol, uShade: uShadeCol, uIncident: uIncidentCol, uWhiten,
    },
    lights: true,
    side: THREE.DoubleSide,
    // Pushed back in depth behind everything laid ON it: a draped overlay (a
    // swamp, a crater, a mountain's skirt) is coplanar with the ground and
    // sits at offset 1, a flat decal is pulled forward — and the ground has to
    // lose to both, or a swamp flickers in and out of the grass it lies on.
    // The flat-colour stand-in (world.ts) carries the same offset.
    ...TERRAIN_DEPTH,
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
  const tProj = performance.now();
  applyProjectedMaterials(fl);
  // Now that what lies under a hole is drawn as ground, the ground can open.
  refreshHoles(fl);
  console.log(`[perf] splat ${fl.name} ${(performance.now() - tSplat) | 0}ms · ${s.layerCount} layers @ ${s.size}px · projection ${(performance.now() - tProj) | 0}ms`);
}


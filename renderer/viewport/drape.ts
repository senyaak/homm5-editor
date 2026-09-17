// Draping a part over the ground: the vertex-shader half of <ProjectOnTerrain>.
//
// A part whose material sets the flag takes the terrain height under each of
// its own vertices (GeomPart.projectOnTerrain): a mountain's skirt meets the
// ground all the way round, and the mountain follows the hill it was put on.
// The engine does this per object at load — every object draws out of one
// dynamic vertex buffer it fills itself (docs/LIGHTING.md §2). Here the
// geometry is shared between every copy of a model and drawn instanced, so the
// displacement is done on the GPU instead: the floor's height plane is a float
// texture, and the vertex shader of a draped part looks its own world XY up in
// it and moves in z by the difference between that and the ground the object
// was anchored on. The instance matrix is all it needs, so the batches, the
// pick handles and the undo path are untouched.
//
// The lookup reproduces the terrain mesh's own interpolation (terrain-mesh.ts:
// each cell is two triangles split along the (x+1,y)-(x,y+1) diagonal), so a
// flat decal lands ON the ground rather than near it. Cut cells — the vertical
// walls a change of tier gets — are the one place the two disagree: the wall
// is the mesh's, and a decal across it takes the smooth slope instead.
//
// One floor is visible at a time (world.ts), so the height texture is a single
// global uniform pointed at the active floor's plane, like the sun.

import * as THREE from 'three';

import type { Floor3D } from '#core/state.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';

/** The active floor's height plane, one float per grid vertex, V × V. */
export const uHeightTex: THREE.IUniform<THREE.DataTexture | null> = { value: null };
/** Its side in vertices. */
export const uHeightV = { value: 1 };
/** World units per tile, to turn a world XY into a grid coordinate. */
export const uDrapeUnits = { value: U };

/**
 * The ground's place in the depth order, as material parameters.
 *
 * Three surfaces can be coplanar with the terrain once parts are draped over
 * it: a flat decal (materials.ts, pulled toward the camera by one unit), a
 * ground-composited overlay such as a swamp (splat.ts, pushed back by one, so
 * the solid parts of the same model still win over it), and the terrain
 * itself — which has to lose to both, or a swamp flickers in and out of the
 * grass it lies on. So the terrain goes back by two.
 */
export const TERRAIN_DEPTH = { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 } as const;

/** Build (or refill) a floor's height texture from its live height plane. */
export function updateHeightTexture(fl: Floor3D): void {
  const V = fl.V;
  if (!fl.heightTex || fl.heightTex.image.width !== V) {
    fl.heightTex?.dispose();
    const tex = new THREE.DataTexture(new Float32Array(V * V), V, V, THREE.RedFormat, THREE.FloatType);
    // Read with texelFetch, so no filtering — float textures filter only with
    // an extension anyway, and the mesh's own interpolation is wanted, not the
    // sampler's.
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    fl.heightTex = tex;
  }
  (fl.heightTex.image.data as Float32Array).set(fl.heights);
  fl.heightTex.needsUpdate = true;
}

/** Point every draped material at this floor's ground. */
export function useDrapeFloor(fl: Floor3D | null): void {
  uHeightTex.value = fl?.heightTex ?? null;
  uHeightV.value = fl?.V ?? 1;
}

/** The uniforms a draped shader carries, by reference — shared, not copied. */
export const drapeUniforms = (): Record<string, THREE.IUniform> => ({
  uHeightTex, uHeightV, uDrapeUnits,
});

/**
 * GLSL for either stage: the ground under a world XY, read off the height
 * plane the way the terrain mesh interpolates it, and the ground's normal.
 */
export const DRAPE_PARS = `
uniform sampler2D uHeightTex;
uniform float uHeightV;
uniform float uDrapeUnits;
float drapeVertex(ivec2 v) {
  v = clamp(v, ivec2(0), ivec2(int(uHeightV) - 1));
  return texelFetch(uHeightTex, v, 0).r;
}
// Ground height under a world XY: the terrain mesh's own two-triangle cell.
float drapeGround(vec2 worldXY) {
  vec2 g = clamp(worldXY / uDrapeUnits, vec2(0.0), vec2(uHeightV - 1.0));
  vec2 f = floor(g), t = g - f;
  ivec2 i = ivec2(f);
  float h00 = drapeVertex(i), h10 = drapeVertex(i + ivec2(1, 0));
  float h01 = drapeVertex(i + ivec2(0, 1)), h11 = drapeVertex(i + ivec2(1, 1));
  return t.x + t.y <= 1.0
    ? h00 + t.x * (h10 - h00) + t.y * (h01 - h00)
    : h11 + (1.0 - t.x) * (h01 - h11) + (1.0 - t.y) * (h10 - h11);
}
// The ground's normal at a world XY: central differences over the nearest
// grid vertex, which is close to the smoothed vertex normal the terrain mesh
// carries (computeVertexNormals averages the faces round a vertex) — and on
// flat ground exactly it.
vec3 drapeNormal(vec2 worldXY) {
  ivec2 i = ivec2(floor(worldXY / uDrapeUnits + 0.5));
  float dx = drapeVertex(i + ivec2(1, 0)) - drapeVertex(i - ivec2(1, 0));
  float dy = drapeVertex(i + ivec2(0, 1)) - drapeVertex(i - ivec2(0, 1));
  return normalize(vec3(-dx, -dy, 2.0 * uDrapeUnits));
}`;

/**
 * GLSL for the vertex stage: `drape(world, anchorZ)` is the vertex moved onto
 * the ground, given the anchor height the instance was placed at.
 */
export const DRAPE_VERT_PARS = `
${DRAPE_PARS}
// The vertex keeps its height above the object's anchor and takes the ground
// under itself instead of the ground under the anchor. With no height plane
// bound (a scene without terrain) it stays where the object put it.
vec4 drape(vec4 world, float anchorZ) {
  if (uHeightV > 1.0) world.z += drapeGround(world.xy) - anchorZ;
  return world;
}`;

/**
 * Splice the draping into one of three's own vertex shaders.
 *
 * Three computes the clip position straight from the model-view matrix and
 * never has the world position in hand unless something else (a shadow, an
 * env map) asks for it. Both chunks are replaced with one path that goes
 * through the world position, drapes it, and carries on — the world position
 * is then also what the shadow coordinates are built from, so a draped part
 * receives its shadow where it is drawn.
 */
export function drapeThreeShader(shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, drapeUniforms());
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${DRAPE_VERT_PARS}`)
    .replace('#include <project_vertex>', `
  mat4 drapeModel = modelMatrix;
  #ifdef USE_INSTANCING
    drapeModel = modelMatrix * instanceMatrix;
  #endif
  vec4 drapedWorld = drape(drapeModel * vec4(transformed, 1.0), drapeModel[3].z);
  vec4 mvPosition = viewMatrix * drapedWorld;
  gl_Position = projectionMatrix * mvPosition;`)
    .replace('#include <worldpos_vertex>', `
  #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
    vec4 worldPosition = drapedWorld;
  #endif`);
}

/**
 * The depth material the shadow pass draws a draped object with.
 *
 * Three casts shadows with a depth material of its own that knows nothing of
 * the displacement, so a draped mountain would shade the ground from where it
 * was authored rather than where it is drawn. A custom depth material is per
 * OBJECT, not per part, so it is only given to a mesh whose parts are all
 * draped (instancing.ts); a model with a draped skirt under a rigid house
 * casts from the rigid position, which is off by the ground's slope under it.
 */
export function drapedDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => drapeThreeShader(shader);
  m.customProgramCacheKey = () => 'draped-depth';
  return m;
}

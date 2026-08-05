// The sun's shadows.
//
// WHAT THE GAME DOES, and why three's own shadow map is the same thing.
// docs/LIGHTING.md §3b: the engine keeps one texture over the ground whose u/v
// are the world x/y SHEARED along the sun (`c25`/`c26` carry the sun's
// horizontal-over-vertical ratio in their z terms), and stores in it the height
// of the highest caster. A lookup is therefore "which sun ray am I on", and the
// comparison is "is anything on my ray above me" — which is exactly what an
// ordinary light-space shadow map answers, only sampled on a sheared grid
// instead of a square one. So the mechanism is reproduced here rather than the
// parametrisation: three's DirectionalLight shadow gives the same rays with
// even texels, plus the alpha test for foliage, plus skinning and instancing,
// none of which a hand-rolled pass would get for free.
//
// WHAT IS NOT REPRODUCED, deliberately: the map's 8-bit depth over
// `MaxShadowHeight` (a precision budget, not a look), its logarithmic texel
// warp (`c3.z` = 7), and its rgb channel — the soft footprint the engine also
// multiplies cloud shadows into. Those would be emulating the engine's limits,
// not its picture.

import * as THREE from 'three';

import { state } from '#core/state.ts';
import type { AmbientData } from '#src/scene/payload.ts';
import { sunDirection } from '#src/scene/sun.ts';
import { onAmbient } from '#viewport/lighting.ts';
import { cam, camera, controls, renderer, scene } from '#viewport/stage.ts';

/**
 * The caster is its OWN light, and contributes none.
 *
 * Reusing `lighting.ts`'s `sun` would have been shorter by an object, and wrong
 * twice: that light's position IS the preset's sun direction, unit length, and
 * the specs read it back as such (`ambientState().sunPos`) — a shadow camera
 * needs it moved out to where it can see the scene from. And the direction is
 * not always the same one: 13 shipped presets aim their shadows somewhere the
 * sun is not. Intensity 0 keeps it out of the picture; three still renders a
 * shadow map for a light that lights nothing.
 */
const caster = new THREE.DirectionalLight(0xffffff, 0);
scene.add(caster, caster.target);

/**
 * How far across the shadow map reaches, world units — and it follows the zoom.
 *
 * The engine re-fits its own map to what the camera can see: the probe caught
 * it 125 and then 250 units across in the same run. A fixed size cannot do the
 * job here either, and both ways of getting it wrong are visible. Too small and
 * shadows stop dead at a circle around the orbit target while the rest of the
 * floor stands in flat sun; too large and a 2048 map spread over a 300-tile
 * floor gives a tree four texels to be drawn with.
 *
 * So it is derived from the view each frame and clamped: 40 units is 20 tiles,
 * closer than the camera can get, and 400 is the whole of most floors at 5
 * texels per world unit.
 */
const MIN_EXTENT = 40, MAX_EXTENT = 400;
let extent = 160;
const MAP_SIZE = 2048;
/** How far up the light sits. Only the near/far planes care; the light is directional. */
const DISTANCE = 400;

let enabled = false;
/** The shadow direction, which is the sun's unless the preset says otherwise. */
const dir = new THREE.Vector3(0.45, 0.35, 0.82);

/**
 * Turn the machinery on once, before any material compiles.
 *
 * `shadowMap.enabled` is a compile-time fact for every program three builds: a
 * material compiled while it was off has no shadow chunks in it and will not
 * grow them without `needsUpdate`. So this runs at start-up and the toggling is
 * done with the light instead.
 */
export function initShadows(): void {
  renderer.shadowMap.enabled = true;
  // HARD, because the engine's edge is hard. Its pixel shader takes ONE sample
  // of the map and decides with `cnd` — a binary pick between the lit and the
  // shadowed colour, with nothing between them (docs/LIGHTING.md §3b). Soft
  // PCF was put here first and it is not a small difference: it is nine taps of
  // blur the game never draws, and Senya spotted it against the real picture.
  // (The engine does have a soft term — the map's rgb footprint, bilinear —
  // but that channel carries the cloud shadows and is not filled here.)
  renderer.shadowMap.type = THREE.BasicShadowMap;
  caster.castShadow = true;
  caster.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
  caster.shadow.camera.near = 1;
  caster.shadow.camera.far = DISTANCE * 2;
  // Bias against self-shadowing. These two were measured when every mesh was
  // drawn DoubleSide — a wall's back face sat in the map at its own depth, so
  // every front face was a hair behind something — and the culling that came in
  // with `<Is2Sided>` (materials.ts) makes three render the BACK faces into the
  // map instead, which is the usual cure for that acne. So this is looser than
  // it now needs to be; it is left alone because tightening it is a measurement
  // of its own (e2e/shadows.spec.ts scores the direction, not the offset) and a
  // constant bias large enough to matter detaches a shadow from its feet.
  caster.shadow.bias = -0.0005;
  caster.shadow.normalBias = 0.6;
  enabled = true;
  onAmbient(applyShadowAmbient);
}

/** Point the shadow at where the preset says the sun is — or is not. */
function applyShadowAmbient(a: AmbientData | null): void {
  // Not `pitch`/`yaw`: a preset may aim its shadows somewhere else entirely,
  // and 13 of the 308 shipped ones do (docs/LIGHTING.md §3b). `loadAmbient` has
  // already resolved the 100/100 sentinel, so these are angles either way.
  // The SAME reading as the shading (sun.ts). A shadow falling away from a
  // light that is lighting the other side is the one combination that is wrong
  // whichever way the axis turns out to be, so these two never diverge.
  dir.set(...sunDirection(a?.shadowPitch ?? 45, a?.shadowYaw ?? 0));
  // No preset means the flat editing light, which has no direction to cast
  // from: shadows off rather than shadows from a made-up sun.
  caster.castShadow = enabled && !!a;
}

/**
 * Follow the view, in whole texels.
 *
 * Snapping the centre to the shadow map's own texel grid is not tidiness: an
 * unsnapped map re-samples every caster edge each time the camera moves a
 * fraction of a texel, and the shadows crawl. The snap is done in the light's
 * own frame, which is what the texels are laid out in.
 */
const target = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
export function updateShadowCamera(): void {
  if (!caster.castShadow) return;
  target.copy(controls.target);
  // How much ground the view covers: the plan camera says so outright, and the
  // perspective one is measured from how far it is standing back. Both name
  // their HALF-HEIGHT, and a window is wider than it is tall — the frustum has
  // to reach the corners or the shadows stop before the edge of the frame.
  const half = cam.top ? cam.half : camera.position.distanceTo(controls.target)
    * Math.tan(camera.fov * Math.PI / 360);
  const want = Math.min(MAX_EXTENT, Math.max(MIN_EXTENT, half * Math.max(1, camera.aspect) * 1.6));
  if (Math.abs(want - extent) > extent * 0.05) { // hysteresis: a wheel notch must not re-fit every frame
    extent = want;
    const c = caster.shadow.camera;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent;
  }
  // The light's frame: `dir` is its z, and three builds x/y from the world up
  // the same way `Object3D.lookAt` does.
  right.set(0, 0, 1).cross(dir);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  up.copy(dir).cross(right).normalize();
  const texel = (2 * extent) / MAP_SIZE;
  const snap = (v: THREE.Vector3): void => {
    const a = Math.round(target.dot(v) / texel) * texel - target.dot(v);
    target.addScaledVector(v, a);
  };
  snap(right);
  snap(up);
  caster.target.position.copy(target);
  caster.target.updateMatrixWorld();
  caster.position.copy(target).addScaledVector(dir, DISTANCE);
  caster.updateMatrixWorld();
  caster.shadow.camera.updateProjectionMatrix();
}

/**
 * Who casts and who receives.
 *
 * Everything drawn, both ways — the engine decides it per material
 * (`CastShadow` on 10062 of 11639, `ReceiveShadow` on 10156) and our decoder
 * does not read those flags yet, so the majority answer is used for all. The
 * terrain is a receiver only: a heightfield casting into a map indexed along
 * the sun shadows itself along every slope, and the ground's own shading
 * already darkens what faces away. So is the water sheet — it is a transparent
 * surface, and a lake that shadowed its own bed would be a black lake.
 */
export function markShadowRoles(root: THREE.Object3D, ...receiveOnly: Array<THREE.Object3D | null>): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  for (const o of receiveOnly) o?.traverse((m) => { if (m instanceof THREE.Mesh) m.castShadow = false; });
}

// --- receiving in a shader of our own ---------------------------------------
//
// The ground and the ground-projected parts are hand-written ShaderMaterials
// outside three's material system, so nothing wires the shadow into them. These
// four pieces do it, and they live here rather than in splat.ts so the sampling
// is the same sampling the object materials get.
//
// `lights: true` is what makes three define NUM_DIR_LIGHT_SHADOWS and fill the
// light uniforms, and that in turn requires the material to carry
// `UniformsLib.lights` — three writes the shadow map and matrix INTO those
// entries, so a material without them throws on the first frame the sun casts.
// Cloned per material: the entries are three's to overwrite, not ours to share.

/** The lights uniforms a shadow-receiving ShaderMaterial has to carry. */
export const shadowUniforms = (): Record<string, THREE.IUniform> =>
  THREE.UniformsUtils.clone(THREE.UniformsLib.lights);

export const SHADOW_VERT_PARS = `
#include <common>
#include <shadowmap_pars_vertex>`;

/**
 * Fill the shadow coordinates. `world` is this vertex's world position and
 * `worldNormal` its world normal — the chunk wants a VIEW-space normal it can
 * turn back into a world one (it offsets along it by the normal bias), so the
 * round trip is done here rather than asking the caller for both.
 */
export const shadowVert = (world: string, worldNormal: string): string => `
  {
    vec4 worldPosition = ${world};
    vec3 transformedNormal = (viewMatrix * vec4(${worldNormal}, 0.0)).xyz;
    #include <shadowmap_vertex>
  }`;

export const SHADOW_FRAG_PARS = `
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
// 1 in the sun, 0 in shadow. The only light that casts is the shadow caster
// (renderer/viewport/shadows.ts), so slot 0 is always it.
float sunlitHere() {
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow s = directionalLightShadows[0];
    return getShadow(directionalShadowMap[0], s.shadowMapSize, s.shadowBias,
                     s.shadowRadius, vDirectionalShadowCoord[0]);
  #else
    return 1.0;
  #endif
}`;

/**
 * Turn the pass off and on again.
 *
 * Exists for the check, not for the user: a picture with shadows and the same
 * picture without is the only way to say what the pass actually contributes,
 * and a test that cannot switch it off cannot tell a shadow from a dark texture.
 */
export function setShadows(on: boolean): void {
  enabled = on;
  caster.castShadow = on && !!state.world?.floors[state.world.active]?.ambient;
}

/** What the specs read: is a shadow being drawn, and from where. */
export function shadowState(): { on: boolean; dir: number[]; extent: number; size: number } {
  return {
    on: !!(state.world && caster.castShadow),
    dir: [dir.x, dir.y, dir.z],
    extent: +extent.toFixed(1),
    size: MAP_SIZE,
  };
}

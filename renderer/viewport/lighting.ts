// The map's AmbientLight preset, as a handful of uniforms — and three three.js
// lights that no longer light anything the game draws.
//
// ONE LIGHT MODEL. The game has one, and it is not three.js's. Its own shaders
// (read out of the executable, docs/LIGHTING.md §2) end every surface the same
// way — `saturate(vertexColour · texel · Whitening)`, multiplied in GAMMA space
// on the raw texel — and a probe in the running game says Direct3D's lighting
// is switched off entirely and no preset colour ever reaches a shader constant.
// So the terrain shader's formula is not a terrain formula, it is THE formula,
// and everything else is shaded with it too (renderer/viewport/materials.ts).
//
// The three lights below stay only as a floor for anything the editor draws
// that is not the game's content — gizmos, handles, a mesh with no material of
// its own. Nothing the preset is about goes through them any more.

import * as THREE from 'three';

import { state } from '#core/state.ts';
import type { AmbientData } from '#src/scene/payload.ts';
import { scene, DEFAULT_BG } from '#viewport/stage.ts';

// The three lights a map's AmbientLight preset drives (applyAmbient). Their
// initial values are the fallback look for a map with no readable preset:
// bright, wraparound lighting so back-facing / normal-less meshes never go
// pure black (a lot of decoded props have imperfect normals).
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x555044, 1.15);
const amb = new THREE.AmbientLight(0xffffff, 0.35);
// Exported for the automation hook, which reports the live preset to the specs.
export const sun = new THREE.DirectionalLight(0xfff0d8, 0.9);
sun.position.set(0.6, 0.4, 1);
scene.add(hemi, amb, sun);

// GAIN, and why it is ~4.6 and not 2: the game's fixed-function pipeline
// multiplies colours in GAMMA space (its `Whitening` is the era's modulate-×2),
// while three.js lights in linear. Multiplication commutes with a pure power
// transfer, so a gamma-space ×2 is a linear-space ×2^2.2 — with the honest
// factor 2 the same preset renders a dusk. Whether Yaw counts from +X and
// which way it turns is not written down anywhere reachable — this mapping is
// the one that matched the game's picture on the maps checked visually.
const AMBIENT_GAIN = Math.pow(2, 2.2);

// The terrain and the terrain-projected parts draw with custom shaders outside
// three.js's lighting, so the preset reaches them as uniforms — these three
// objects are shared by reference across every such material, and applyAmbient
// mutates the values in place. They hold GAMMA-space colours (the splat works
// on raw texture values, like the game did); the defaults reproduce the old
// hard-coded look, `0.62 + 0.5·d = 2·(0.31 + 0.25·d)`.
export const uSunDir = { value: new THREE.Vector3(0.45, 0.35, 0.82) };
/** `LightColor` — the colour a surface facing the sun is turned INTO, not a term added to it. */
export const uSunCol = { value: new THREE.Color(0.55, 0.55, 0.55) };
/** `AmbientColor` — what a surface edge-on to the sun gets, and the middle of the mix. */
export const uAmbCol = { value: new THREE.Color(0.31, 0.31, 0.31) };
/**
 * `ShadeColor` — the other pole: what a surface facing AWAY from the sun gets.
 *
 * Never used here until 08.2026, and it is not a small term: on the shipped
 * menu preset it is `0.255/0.443/0.506` against an ambient of
 * `0.259/0.275/0.349` — a sky-blue that lifts every upward-facing surface. It
 * arrived with the vertex-colour measurement (docs/LIGHTING.md §2).
 */
export const uShadeCol = { value: new THREE.Color(0.31, 0.31, 0.31) };
/**
 * `IncidentShadowColor` — what stands in for `LightColor` where the sun does
 * not reach.
 *
 * A shadow in this engine is not a darkening: the same three-way mix is
 * evaluated twice per surface, once with `LightColor` at the sun end and once
 * with this, and the shadow map picks between the two results
 * (docs/LIGHTING.md §3b). So it is a COLOUR, not a factor — 0.145/0.180/0.271
 * on the commonest day preset, a cold blue against a warm sun.
 */
export const uIncidentCol = { value: new THREE.Color(0.55, 0.55, 0.55) };
// The Light toggle's reach into the terrain: 1 = the baked designer point
// lights add in, 0 = they don't (flat editing light keeps pools off too).
export const uLmGain = { value: 1 };
/**
 * What the vertex colour multiplies the texel by: **4**, saturated.
 *
 * The chain, all of it measured: the CPU writes the mixed colour into the
 * vertex as a plain byte (no doubling — `AmbientColor` arrives as its own
 * 66/70/89), the vertex shader scales it by `c29`, and the pixel shader's
 * `mul_x4_sat` multiplies by four and clamps.
 *
 * `c29` IS NOT A CONSTANT, and reading it as one is what made this ×2 for an
 * afternoon and every map half as bright as the game. One probe run had caught
 * it at 0.5 and the number went into a document as the halving; the run that
 * settled the mix caught it at **1.000, 0.564, 0.220 and 0.500 in the same
 * session** — it is the scene FADE, and its steady state on a map is 1. The
 * old photometric check agrees and always did: the Sharpshooter map measured
 * `tex·1.66` in the game against a mix of 0.415, and 4 × 0.415 = 1.66.
 *
 * A single sample of a value that moves is not a constant. Kept as a uniform
 * because the flat editing light drives it.
 */
export const uWhiten = { value: 4 };
// Scene light on L_LIT particle instances (docs/EFFECTS_FORMAT.md §5): the
// terrain's own gamma-space sum at full incidence, 2·(amb + sun) clamped to
// 1 — daylight leaves lit smoke alone, a night preset darkens it while the
// self-lit (L_NORMAL) fire beside it keeps burning. Shared by reference into
// every fx system; flat editing light resets it to white.
export const uFxTint = { value: new THREE.Color(1, 1, 1) };

// Whoever draws FROM the preset beyond these uniforms (the sky dome) registers
// here rather than being imported: materials.ts already imports this module for
// the uniforms, so lighting reaching back into mesh-building would be a cycle.
const ambientHooks: Array<(a: AmbientData | null) => void> = [];
export function onAmbient(fn: (a: AmbientData | null) => void): void { ambientHooks.push(fn); }

/** Apply a floor's lighting preset, or the flat fallback when there is none. */
export function applyAmbient(a: AmbientData | null): void {
  for (const fn of ambientHooks) fn(a);
  scene.background = DEFAULT_BG;
  if (!a) {
    hemi.color.set(0xdfeaff); hemi.groundColor.set(0x555044); hemi.intensity = 1.15;
    amb.color.set(0xffffff); amb.intensity = 0.35;
    sun.color.set(0xfff0d8); sun.intensity = 0.9;
    sun.position.set(0.6, 0.4, 1);
    uSunDir.value.set(0.45, 0.35, 0.82);
    uSunCol.value.setRGB(0.55, 0.55, 0.55);
    uAmbCol.value.setRGB(0.31, 0.31, 0.31);
    uShadeCol.value.setRGB(0.31, 0.31, 0.31);
    uIncidentCol.value.setRGB(0.55, 0.55, 0.55); // no preset, no shadow contrast
    uFxTint.value.setRGB(1, 1, 1);
    uWhiten.value = 4;
    return;
  }
  const [lr, lg, lb] = a.light as [number, number, number];
  const [ar, ag, ab] = a.ambient as [number, number, number];
  const [sr, sg, sb] = a.shade as [number, number, number];
  sun.color.setRGB(lr, lg, lb, THREE.SRGBColorSpace);
  sun.intensity = AMBIENT_GAIN;
  // Pitch counts from the ZENITH, not the horizon: presets carry 35-50, and
  // read as elevation those made flat ground catch barely half the sun and
  // every shipped day map rendered as dusk (the engine's own PWL preview of
  // the same maps shows bright noon grass).
  //
  // The AZIMUTH is turned half a circle from the naive reading, and that is
  // measured: under Pitch 35 / Yaw 40 the probe in the running game reads
  // `vs c35` — the vector the object shader dots the normal against — as
  // (-0.439, -0.369, 0.819), while sin/cos of the preset give (+0.439, +0.369,
  // +0.819). Only x and y flip; z does not, so this is not "the same vector
  // negated" (a light travelling with z UP would be a sun under the ground) but
  // a yaw counted from the opposite direction. See docs/LIGHTING.md §3.
  const p = a.pitch * Math.PI / 180, yw = a.yaw * Math.PI / 180;
  sun.position.set(-Math.sin(p) * Math.cos(yw), -Math.sin(p) * Math.sin(yw), Math.cos(p));
  hemi.color.setRGB(ar, ag, ab, THREE.SRGBColorSpace);
  hemi.groundColor.setRGB(sr, sg, sb, THREE.SRGBColorSpace);
  hemi.intensity = AMBIENT_GAIN;
  amb.color.set(0xffffff); amb.intensity = 0.12;
  uSunDir.value.copy(sun.position);
  uSunCol.value.setRGB(lr, lg, lb); // raw, no conversion: gamma-space shader
  uAmbCol.value.setRGB(ar, ag, ab);
  uShadeCol.value.setRGB(sr, sg, sb);
  const [ir, ig, ib] = a.incident as [number, number, number];
  uIncidentCol.value.setRGB(ir, ig, ib);
  // Not `a.whiten`: the multiplier is the pipeline's ×4 and the preset's
  // <Whitening> flag does not reach it. See the uniform above.
  uWhiten.value = 4;
  // Lit particles take the scene's light at full incidence, which under the
  // mix is simply LightColor doubled.
  uFxTint.value.setRGB(Math.min(1, 4 * lr), Math.min(1, 4 * lg), Math.min(1, 4 * lb));
}

/**
 * Point the lighting at what the Light toggle says: the active floor's own
 * preset + its baked point-light pools, or the flat neutral look (the same one
 * a preset-less map gets) for editing a dark underground without squinting.
 */
export function refreshLighting(): void {
  const fl = state.world ? state.world.floors[state.world.active] : null;
  applyAmbient(state.mapLight ? fl?.ambient ?? null : null);
  uLmGain.value = state.mapLight ? 1 : 0;
}

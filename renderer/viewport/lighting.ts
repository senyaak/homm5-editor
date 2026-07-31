// The map's AmbientLight preset, as three lights and a handful of uniforms.
//
// Mapping the game's four-colour model onto three lights: the sun carries
// LightColor from its Pitch/Yaw; the hemisphere spans AmbientColor (sky side)
// down to ShadeColor (the colour the game paints surfaces facing away from the
// sun — three.js has no shade term, but a hemisphere's underside reaches the
// same faces); a small constant floor stays so decoded props with broken
// normals never go black.

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
export const uSunCol = { value: new THREE.Color(0.25, 0.25, 0.25) };
export const uAmbCol = { value: new THREE.Color(0.31, 0.31, 0.31) };
// The Light toggle's reach into the terrain: 1 = the baked designer point
// lights add in, 0 = they don't (flat editing light keeps pools off too).
export const uLmGain = { value: 1 };
// Scene light on L_LIT particle instances (docs/EFFECTS_FORMAT.md §5): the
// terrain's own gamma-space sum at full incidence, 2·(amb + sun) clamped to
// 1 — daylight leaves lit smoke alone, a night preset darkens it while the
// self-lit (L_NORMAL) fire beside it keeps burning. Shared by reference into
// every fx system; flat editing light resets it to white.
export const uFxTint = { value: new THREE.Color(1, 1, 1) };

/** Apply a floor's lighting preset, or the flat fallback when there is none. */
export function applyAmbient(a: AmbientData | null): void {
  scene.background = DEFAULT_BG;
  if (!a) {
    hemi.color.set(0xdfeaff); hemi.groundColor.set(0x555044); hemi.intensity = 1.15;
    amb.color.set(0xffffff); amb.intensity = 0.35;
    sun.color.set(0xfff0d8); sun.intensity = 0.9;
    sun.position.set(0.6, 0.4, 1);
    uSunDir.value.set(0.45, 0.35, 0.82);
    uSunCol.value.setRGB(0.25, 0.25, 0.25);
    uAmbCol.value.setRGB(0.31, 0.31, 0.31);
    uFxTint.value.setRGB(1, 1, 1);
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
  const p = a.pitch * Math.PI / 180, yw = a.yaw * Math.PI / 180;
  sun.position.set(Math.sin(p) * Math.cos(yw), Math.sin(p) * Math.sin(yw), Math.cos(p));
  hemi.color.setRGB(ar, ag, ab, THREE.SRGBColorSpace);
  hemi.groundColor.setRGB(sr, sg, sb, THREE.SRGBColorSpace);
  hemi.intensity = AMBIENT_GAIN;
  amb.color.set(0xffffff); amb.intensity = 0.12;
  uSunDir.value.copy(sun.position);
  uSunCol.value.setRGB(lr, lg, lb); // raw, no conversion: gamma-space shader
  uAmbCol.value.setRGB(ar, ag, ab);
  uFxTint.value.setRGB(
    Math.min(1, 2 * (ar + lr)), Math.min(1, 2 * (ag + lg)), Math.min(1, 2 * (ab + lb)));
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

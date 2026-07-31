// The designer point lights a map places, baked into one texture per floor.
//
// The terrain shaders add this on top of the preset's light, which is how the
// engine's own vertex lights behaved — see the splat's `uLm`/`uLmGain`.

import * as THREE from 'three';

import type { Floor3D } from '#core/state.ts';
import type { Instance } from '#src/scene/scene.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';
import { tileCenter } from '#core/coords.ts';

// Most of the light a map designer actually placed is here: ~10,800 point
// lights across the shipped maps ride on placed objects (map.xdb
// <pointLights>) — the violet pool under an underground crystal, the torch
// glow on a mine. Hundreds per map is far beyond what three.js light objects
// can carry, and they only move when their object does, so each floor bakes
// them into one texture over the ground plane; the terrain shaders add that
// sample to the preset's ambient+sun sum, in the same gamma space. Objects
// standing in a pool are NOT tinted by it yet — the pool on the ground is
// what reads as "the crystal glows".

/** Lightmap texels per tile side. 4 keeps the common torch pool (radius 8 = 4 tiles) 32 texels wide. */
const LM_T = 4;

export function makeLightMap(V: number): THREE.DataTexture {
  const side = Math.max(1, (V - 1) * LM_T);
  const tex = new THREE.DataTexture(new Uint8Array(side * side * 4), side, side, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Re-accumulate every light on the floor into its lightmap. */
export function bakeLightMap(fl: Floor3D): void {
  fl.lightsDirty = false;
  const img = fl.lightMap.image as unknown as { data: Uint8Array; width: number };
  const side = img.width, data = img.data;
  data.fill(0);
  const { V, heights } = fl;
  const texelW = U / LM_T; // texel p sits at world (p + 0.5) * texelW
  for (const inst of fl.instances) {
    if (!inst.lights) continue;
    for (const l of inst.lights) {
      const r = l.radius;
      if (r <= 0) continue;
      // The offset is world units in MAP axes — the editor that wrote it baked
      // the object's rotation in (see MapObject.pointLights) — so it is added
      // as-is, and z is height above the object's ground.
      const wx = tileCenter(inst.x) + l.x;
      const wy = tileCenter(inst.y) + l.y;
      const wz = inst.z + l.z;
      const x0 = Math.max(0, Math.floor((wx - r) / texelW)), x1 = Math.min(side - 1, Math.ceil((wx + r) / texelW));
      const y0 = Math.max(0, Math.floor((wy - r) / texelW)), y1 = Math.min(side - 1, Math.ceil((wy + r) / texelW));
      for (let py = y0; py <= y1; py++) {
        const ty = (py + 0.5) * texelW;
        const rowH = Math.max(0, Math.min(V - 1, Math.round(ty / U))) * V;
        for (let px = x0; px <= x1; px++) {
          const tx = (px + 0.5) * texelW;
          const dx = tx - wx, dy = ty - wy;
          const dz = wz - heights[rowH + Math.max(0, Math.min(V - 1, Math.round(tx / U)))]!;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= r) continue;
          // Falloff [~]: the game's own curve is unmeasured; quadratic reads as
          // a soft pool without the hard rim a linear cone leaves.
          const t = 1 - d / r;
          const a = t * t * 255;
          const at = (py * side + px) * 4;
          // Saturating add by hand — a Uint8Array otherwise wraps at 256 and a
          // spot where two torches overlap would go DARK.
          data[at] = Math.min(255, data[at]! + a * l.color[0]);
          data[at + 1] = Math.min(255, data[at + 1]! + a * l.color[1]);
          data[at + 2] = Math.min(255, data[at + 2]! + a * l.color[2]);
        }
      }
    }
  }
  fl.lightMap.needsUpdate = true;
}

/** Note that this object's pools must be re-baked — cheap no-op for the 99% without lights. */
export function markLightsDirty(fl: Floor3D, inst: Instance): void {
  if (inst.lights?.length) fl.lightsDirty = true;
}


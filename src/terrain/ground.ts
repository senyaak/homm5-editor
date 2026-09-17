// The ground an object stands on — the engine's own rule, read out of the
// executable rather than guessed.
//
// WHAT THE GAME DOES (H5_Game_H5E.exe, the scene-object builder at 0xb51f40,
// which every placed map object goes through):
//
//   1. the object's world XY is (Pos + 0.5) · 2 — the CENTRE of its tile;
//   2. if all four corner flags of the tile floor(Pos) are 0 — the tile is
//      sea — its z is 1.5, the sea level (0x9ec510, then the constant at
//      0xf533e4), whatever the bed under it does;
//   3. otherwise z is the height plane read BILINEARLY at that centre
//      (0x5e4400: floor both coordinates, clamp the four corners into the
//      grid, interpolate along y at each x column, then along x);
//   4. on the UNDERGROUND (the terrain's flag at +0x78) the flags plane is
//      read the same way, truncated to a byte at each step (0x5e42a0), and
//      1.125 · (flag − 16) is taken off — 9 · 0.0625, doubled. That is the
//      massif carve undone: an underground height is 18 + 1.125 · (flag − 16)
//      (A2S1: flag 32 → 36.0, 26 → 29.3, 21 → 23.6, 19 → 21.4), so every
//      object stands on the cave floor at 18, and one placed on a wall tile
//      stands inside the rock rather than on top of it;
//   5. Pos.z is added last, and every shipped map stores 0 there.
//
// Bilinear, not the two triangles the editor's terrain mesh is drawn with
// (renderer/viewport/terrain-mesh.ts, and drape.ts on the GPU): at a tile's
// centre the two differ by a quarter of the cell's twist, which on smooth
// ground is nothing and on a twisted cell puts the object where the game
// puts it rather than where our mesh happens to be.

import { FLAG_GROUND, FLAG_WATER } from './terrain.ts';
import { SEA_LEVEL } from '../scene/units.ts';

/** What the underground carve adds per flag step above ground: 9 · 0.0625 · 2. */
const UNDERGROUND_RISE_PER_FLAG = 1.125;

/**
 * The height plane at grid coordinates (gx, gy), bilinear, clamped the way
 * the engine clamps (0x5e4400).
 */
export function heightBilinear(heights: ArrayLike<number>, V: number, gx: number, gy: number): number {
  const fx = Math.floor(gx), fy = Math.floor(gy);
  const tx = gx - fx, ty = gy - fy;
  const c = (i: number): number => Math.max(0, Math.min(V - 1, i));
  const x0 = c(fx), x1 = c(fx + 1), y0 = c(fy), y1 = c(fy + 1);
  const at = (x: number, y: number): number => heights[y * V + x]!;
  const atX0 = at(x0, y0) + (at(x0, y1) - at(x0, y0)) * ty;
  const atX1 = at(x1, y0) + (at(x1, y1) - at(x1, y0)) * ty;
  return atX0 + (atX1 - atX0) * tx;
}

/**
 * The flags plane at grid coordinates, the engine's way (0x5e42a0): the same
 * bilinear walk, truncated to a byte after each step.
 */
export function flagBilinear(flags: ArrayLike<number>, V: number, gx: number, gy: number): number {
  const fx = Math.floor(gx), fy = Math.floor(gy);
  const tx = gx - fx, ty = gy - fy;
  const c = (i: number): number => Math.max(0, Math.min(V - 1, i));
  const x0 = c(fx), x1 = c(fx + 1), y0 = c(fy), y1 = c(fy + 1);
  const at = (x: number, y: number): number => flags[y * V + x]!;
  const atX0 = Math.trunc(at(x0, y0) + (at(x0, y1) - at(x0, y0)) * ty) & 0xff;
  const atX1 = Math.trunc(at(x1, y0) + (at(x1, y1) - at(x1, y0)) * ty) & 0xff;
  return Math.trunc(atX0 + (atX1 - atX0) * tx);
}

/**
 * The z an object on tile (x, y) stands at, as the game places it. `flags`
 * may be null when a floor has no flags plane; then nothing is sea and the
 * underground carve is not undone. (x, y) may be fractional — a free drag
 * places at thousandths of a tile — and the centre offset applies the same.
 */
export function groundUnder(
  heights: ArrayLike<number>, flags: ArrayLike<number> | null, V: number,
  x: number, y: number, underground = false,
): number {
  if (flags) {
    const tx = Math.max(0, Math.min(V - 2, Math.trunc(x))), ty = Math.max(0, Math.min(V - 2, Math.trunc(y)));
    const f = (dx: number, dy: number): number => flags[(ty + dy) * V + tx + dx]!;
    if (f(0, 0) === FLAG_WATER && f(1, 0) === FLAG_WATER && f(0, 1) === FLAG_WATER && f(1, 1) === FLAG_WATER) return SEA_LEVEL;
  }
  const gx = x + 0.5, gy = y + 0.5;
  let z = heightBilinear(heights, V, gx, gy);
  if (underground && flags) z -= UNDERGROUND_RISE_PER_FLAG * (flagBilinear(flags, V, gx, gy) - FLAG_GROUND);
  return z;
}

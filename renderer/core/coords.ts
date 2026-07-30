// Tiles to world units, and the ground under a tile.
//
// A map is authored in tiles and drawn in world units; every panel, brush and
// placement crosses that line, so the conversion lives in one place rather than
// as a `* U` at each call site.

import { UNITS_PER_TILE as U } from '#src/units.ts';
import { activeFloor } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';

/**
 * World centre of a tile. An object's saved position is a CELL index (placement
 * picks the tile with floor(worldX / U)), and a cell spans [x, x+1], so its
 * centre is at (x + 0.5) · U. Rendering the model at x · U instead dropped it on
 * the cell's corner — half a tile off the square it was placed in, sitting on
 * the grid intersection. Kept out of the saved data: the file still stores x.
 */
export const tileCenter = (t: number): number => (t + 0.5) * U;

/** Ground height at a tile of a given floor. */
export function heightOn(fl: Floor3D, x: number, y: number): number {
  const { V, heights } = fl;
  const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
  return heights[iy * V + ix]!;
}

/** The same, on the floor currently shown. */
export function heightAt(x: number, y: number): number {
  return heightOn(activeFloor(), x, y);
}

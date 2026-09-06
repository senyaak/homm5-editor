// The minimap's darkening mask — which tiles the terrain pass halves.
//
// `0xAD13C0` hands the pass the FIRST of three per-floor bitmasks, and
// `0xAD0F50` is what writes it. Its very first arm, before any tile kind is
// looked at, sets BOTH of the first two masks when the descriptor's `+0x10`
// is 1 (`0xAD0F6B` -> `0xAD1003`, `bts` on each) — and `+0x10 = 1` is what
// OBJECT REGISTRATION stamps: `0xA4FF00` walks the object's virtual slot
// `+0xB4`, a per-instance vector of signed (dx, dy) byte pairs, adds each to
// the object's own packed tile key and writes `{+0x10 = 1, +0x14 = obj}`.
// Slot `+0xB4` is the BLOCKED list (`0xAD06F0`, `lea eax,[ecx-68h]`); its
// neighbour `+0xB8` (`-0x5C`) is the ACTIVE one and stamps `+0x10 = 2`,
// which only reaches the THIRD mask. Every consumer adds those pairs
// straight to the object's tile with no rotation of its own, so what the
// vector holds is already in world orientation — the port rotates the shared
// document's `blockedTiles` to get there, the same way the height pass does.
//
// The registration is LIVE rather than cumulative: `CWorld`'s vtable pairs
// `+0x14C` (register) with `+0x150` / `+0x154` (unregister, which writes the
// descriptor's type and owner back to 0), and the movers call them around a
// move. By the time the minimap is drawn the mask therefore holds the
// objects that are standing, which for a generated map is all of them.
//
// The other arms `0xA4F6D0` feeds are the border ring, `terrain[+0x6C] == 0`
// (that one IS live — it is the passability plane below), all four ground-flag
// corners zero, BIG WATER over the tile, the river half-grid, and a `TT_NONE`
// tile. A generated floor's flags are a uniform 16 everywhere, so the flag
// arms cannot fire — but the big-water one can, and does: it was called
// inactive because the reference template paints no water layer at all, which
// is a fact about one template and not about the arm. Two maps that do have
// one — a lava LAKE, which the generator paints as `TT_BIG_WATER` with a lava
// texture, and an ordinary `-water 2` sea — put 8 and 26 tiles outside the
// plane-and-objects mask, and the engine's own mask dump has every one of them.
//
// So FOUR arms speak, and which of them can fire is a fact about the floor:
// the plane and the objects everywhere, big water wherever a template paints a
// lake or a sea, and the ground-flag corners on an UNDERGROUND floor, where the
// flags are the massif carve's bytes rather than the constructor's uniform 16.
// The border ring and `TT_NONE` stay named and unported: no map here reaches
// either, and the ring was scored at every width from 0 to 16 and fits at none.

import { rotateOffsets } from './heights.ts';
import type { TerrainLayer } from './terrain.ts';
import type { Offset } from './town-data.ts';

/** One object as the mask reads it: where it stands and what it blocks. */
export interface MaskObject {
  x: number;
  y: number;
  /** Radians, the stored rotation; the blocked list is turned by it. */
  rot: number;
  floor: number;
  /** The shared document's `blockedTiles`, unrotated, in document order. */
  blocked: readonly Offset[];
}

/** What the mask is built from, for one floor. */
export interface MaskInput {
  /** The map's TileX; the mask is `side` x `side` tiles. */
  side: number;
  /** The floor's passability plane, `(size + 1)^2`, laid out `[y * dim + x]`. */
  plane: Uint8Array;
  /** That plane's row stride — `size + 1`. */
  dim: number;
  /** Every object standing on this floor. */
  objects: readonly MaskObject[];
  /**
   * The floor's texture layers — only the `TT_BIG_WATER` ones are read.
   * A floor that has none (the reference template is one) needs no list.
   */
  layers?: readonly TerrainLayer[];
  /**
   * The floor's ground flags on the vertex grid, `(side + 1)^2`.
   *
   * Uniform 16 on a surface floor, so the arm that reads them is dead there and
   * the field can be left out. Underground they are the massif carve's bytes.
   */
  flags?: Uint8Array;
}

/**
 * `0x9EBAE0` — does BIG WATER cover this tile?
 *
 * It walks the tile's texture layers, keeps the ones whose `Type` is 0x0B
 * (`TT_BIG_WATER`) and tests that layer's mask at the tile's FOUR CORNER
 * vertices. `0x9EC570` reaches it and answers kind 2, which sets the mask bit;
 * the halving's own exemption reads it too (see `minimap.ts`). Whether the test
 * is "painted at all" or "painted past a threshold" no map here can separate:
 * on all of them, every corner such a layer touches it touches at 0x80 or more.
 */
export function bigWaterCovers(
  layers: readonly TerrainLayer[], dim: number, tx: number, ty: number,
): boolean {
  for (const l of layers) {
    if (l.type !== 'TT_BIG_WATER') continue;
    if (l.mask[ty * dim + tx]! > 0 || l.mask[ty * dim + tx + 1]! > 0
      || l.mask[(ty + 1) * dim + tx]! > 0 || l.mask[(ty + 1) * dim + tx + 1]! > 0) return true;
  }
  return false;
}

/** `0x9EB9E0` — are the tile's four ground-flag corner vertices all equal? */
function cornersAgree(flags: Uint8Array, dim: number, tx: number, ty: number): boolean {
  const a = flags[ty * dim + tx]!;
  return flags[ty * dim + tx + 1] === a && flags[(ty + 1) * dim + tx] === a
    && flags[(ty + 1) * dim + tx + 1] === a;
}

/** The darkening mask: one byte a tile, `[y * side + x]`, 1 = darkened. */
export function buildMinimapMask(input: MaskInput): Uint8Array {
  const { side, plane, dim, objects } = input;
  const mask = new Uint8Array(side * side);
  const layers = input.layers ?? [];
  const flags = input.flags;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      // `0x9EBCB0`: the plane reads 0 -> kind 3 -> the bit is set.
      if (plane[y * dim + x] === 0) mask[y * side + x] = 1;
      else if (bigWaterCovers(layers, dim, x, y)) mask[y * side + x] = 1;
      // `0x9EB9E0` — do the tile's four ground-flag corners DIFFER? Kind 3
      // again. Uniform 16 makes it dead on a surface floor; underground the
      // carve's bytes change at every rock edge and ramp, and the arm draws the
      // shading around every cave wall.
      else if (flags && !cornersAgree(flags, dim, x, y)) mask[y * side + x] = 1;
    }
  }
  for (const obj of objects) {
    for (const [dx, dy] of rotateOffsets([...obj.blocked], obj.rot)) {
      const tx = Math.trunc(obj.x + dx);
      const ty = Math.trunc(obj.y + dy);
      if (tx < 0 || ty < 0 || tx >= side || ty >= side) continue;
      mask[ty * side + tx] = 1;
    }
  }
  return mask;
}

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
// So three arms speak: the plane, the objects, and big water.

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
}

/** The darkening mask: one byte a tile, `[y * side + x]`, 1 = darkened. */
export function buildMinimapMask(input: MaskInput): Uint8Array {
  const { side, plane, dim, objects } = input;
  const mask = new Uint8Array(side * side);
  // `0x9EBAE0` — does big water cover this tile? It walks the tile's texture
  // layers, keeps the ones whose `Type` is 0x0B (`TT_BIG_WATER`) and tests that
  // layer's mask at the tile's FOUR CORNER vertices. `0x9EC570` reaches it and
  // answers kind 2, which sets the bit. Whether the test is "painted at all" or
  // "painted past a threshold" the two maps cannot separate: on both, every
  // corner the layer touches at all it touches at 0x80 or more.
  const bigWater = (input.layers ?? []).filter((l) => l.type === 'TT_BIG_WATER');
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      // `0x9EBCB0`: the plane reads 0 -> kind 3 -> the bit is set.
      if (plane[y * dim + x] === 0) mask[y * side + x] = 1;
      else if (bigWater.some((l) => l.mask[y * dim + x]! > 0 || l.mask[y * dim + x + 1]! > 0
        || l.mask[(y + 1) * dim + x]! > 0 || l.mask[(y + 1) * dim + x + 1]! > 0)) {
        mask[y * side + x] = 1;
      }
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

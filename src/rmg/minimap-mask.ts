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
  /**
   * Its `activeTiles`, unrotated — the OTHER registration, and it is not just
   * a list this mask ignores: see `buildMinimapMask`, where an active tile
   * takes a blocked one's place in the per-tile descriptor.
   */
  active?: readonly Offset[];
  /**
   * Does the veto at `0xA46E80` answer for this object? Then `0xA55C10`
   * registers NEITHER of its lists — see `buildMinimapMask`.
   */
  vetoed?: boolean;
}

/**
 * WHICH CLASSES THE VETO TAKES — measured on ten contested tiles.
 *
 * A tile one object claims with its ACTIVE list while another BLOCKS it is
 * rare: eleven in the whole corpus, all of them on a dwarven underground where
 * a `Subterra/Fakel_*` torch stands on something. The engine's answer splits by
 * the claimant's CLASS and by nothing else:
 *
 *   AdvMapShrineShared    4 tiles   left BRIGHT — the claim stands
 *   AdvMapBuildingShared  2 tiles   left BRIGHT
 *   AdvMapTreasureShared  3 tiles   DARKENED — the claim never happened
 *   AdvMapMonsterShared   1 tile    DARKENED
 *
 * The monster is what settles it, and it took a two-level editor map to find
 * one: a guard's own tile with a torch on it is DARK, and a guard is not
 * guarded by anything — which kills the reading that had fitted the first nine
 * cases, "an object with a guard beside it claims nothing" (every darkened
 * treasure here is a mine's pile with its guard next to it, which is what made
 * that reading look inevitable). The reading it also kills is the port's old
 * proxy, "only an object that blocks something claims anything": the shrines
 * and the Shaman have no blocked list either.
 *
 * WHY A CLASS LIST rather than the predicates themselves: the veto's eight
 * slots are one shared `xor eax,eax; ret` seven times over in every class
 * involved, and the eighth hands back a virtual base's subobject whose state
 * is then asked — so the class is what the engine is reading THROUGH, and the
 * chain that gets there is not ported. What is listed is measured; a pickup
 * class nobody has seen under a torch is named below rather than guessed at.
 */
const VETOED_CLASSES = new Set(['AdvMapTreasureShared', 'AdvMapMonsterShared']);

/**
 * The claimant's class, out of the shared document's own xpointer, and whether
 * the veto takes it.
 *
 * `AdvMapArtifactShared` is the one that is NOT decided: an artifact is a
 * pickup like a treasure and would be expected to go the same way, but no map
 * here puts one under a blocked tile, so it is left claiming — which is a
 * statement this function makes on purpose and the first such map will correct.
 */
export function vetoesRegistration(shared: string | undefined): boolean {
  const cls = /#xpointer\(\/(\w+)\)/.exec(shared ?? '')?.[1] ?? '';
  return VETOED_CLASSES.has(cls);
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
  // THE OBJECT ARM IS ONE DESCRIPTOR PER TILE, not a union. `0xA4FF00` looks
  // the tile's descriptor up, copies it whole, writes `+0x10` and puts it back
  // — so a tile registered twice keeps ONE kind, and only kind 1 (blocked)
  // darkens; kind 2 (active) reaches the third mask alone. On `ГСК-011` a
  // Fakel stands on (59,140), which is also the active tile of the
  // `RandomSancutuary` at (59,139): the engine leaves that tile bright and the
  // port, ORing the two, darkened it — one source pixel, and a whole lanczos
  // kernel of it in the finished picture.
  //
  // WHICH REGISTRATION WINS: the ACTIVE one, and the port models it as two
  // passes — all the blocked lists, then all the active ones.
  //
  // Of the two shapes this used to hold as equally admissible, the other one
  // is read out of the way: "the first write stands" would need the put-back
  // to refuse an occupied tile, and `0xAD12A0` addresses the record and calls
  // `0xAD1F10`, which is an unconditional field-by-field copy. Nor is it
  // "objects in order, each one's blocked then its active": the placement
  // order has the claimant FIRST on every tile here, bright and dark alike.
  //
  // A VETOED object registers neither list — `0xA55C10` calls `0xA46E80`
  // first and returns without touching the grid when it answers. Which classes
  // it answers for is `VETOED_CLASSES` above, measured rather than fitted.
  const kind = new Uint8Array(side * side);
  const stamp = (obj: MaskObject, list: readonly Offset[], value: number): void => {
    for (const [dx, dy] of rotateOffsets([...list], obj.rot)) {
      const tx = Math.trunc(obj.x + dx);
      const ty = Math.trunc(obj.y + dy);
      if (tx < 0 || ty < 0 || tx >= side || ty >= side) continue;
      kind[ty * side + tx] = value;
    }
  };
  for (const obj of objects) if (!obj.vetoed) stamp(obj, obj.blocked, 1);
  for (const obj of objects) if (!obj.vetoed) stamp(obj, obj.active ?? [], 2);
  // Only kind 1 darkens: kind 2 reaches the THIRD mask, and this is the first.
  for (let i = 0; i < mask.length; i++) if (kind[i] === 1) mask[i] = 1;
  return mask;
}

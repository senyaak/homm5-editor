// The passability plane — the last thing GenerateMap writes, and the one
// plane the port used to leave at its initial all-ones.
//
// WHERE. Between the "treasure blocks set" and "finished creating map" log
// sites (0xEAC0C3 .. 0xEAC21F), drawlessly — the oracle's `pass` probe reads
// all ones on every step boundary before it and the reference's own count
// after. GenerateMap loops the LEVELS (stride 0x120) and walks each level's
// chained table at `level+0xAC` / `+0xB0`; the payload is a CGameZone, and
// the call is its vtable slot `+0x38` (editor `0xBF9BC0`). So this is a
// per-ZONE pass, not a per-object one — which is why no single rule over
// object footprints, the occupancy grid or the terrain slope could ever fit
// the plane (79.6% / 82.4% / 70.1% at best).
//
// WHAT. Per zone: recompute the room grid with mask 0x3C — the same list the
// statics sweep uses — then walk the zone's own tile list (`zone+0xCC`) and
// mark a tile when
//
//   room > 2,   or   room <= 2 and border == 0
//
// A WATER-BORDERED zone overrides the slot (editor `0xC069E0` against the
// base's `0xBF9BC0`) with the same walk and the condition turned into an AND:
//
//   room > 2   and   border > 1
//
// — the coast is left alone, the way every other water-zone rule keeps off it.
//
// where "mark" is the terrain processor's `0x7949A0` on `map+0x60`, whose
// whole body is `plane_rows[floor][a][b] = 0`.
//
// So the plane's sense is the opposite of its name: it starts at 1 and this
// pass writes 0 into the OPEN ground. Nothing here reads geometry, and the
// order of the zones cannot matter — every zone only ever writes zeros, and
// only over its own tiles, off a room grid it recomputed itself.

import { recomputeRoom } from './placement.ts';
import type { Tile } from './placement.ts';

export interface PassabilityZone {
  index: number;
  /** The zone's `+0xCC` tile list, as the run left it. */
  tiles: Tile[];
  /** The mask-0x3C point list: the zone's actives and its three road lists. */
  points: Tile[];
  /** A CGameWaterBorderedZone: the overridden slot, the AND rule. */
  water?: boolean;
}

/**
 * @param room the floor's room grid — MUTATED, exactly as the engine's is
 * @returns the floor's plane, 1 everywhere the pass did not reach
 */
export function markPassability(
  size: number,
  grid: Int32Array[],
  border: Int32Array[],
  room: Int32Array[],
  zones: PassabilityZone[],
): Uint8Array {
  const v = size + 1;
  const plane = new Uint8Array(v * v).fill(1);
  for (const zone of zones) {
    recomputeRoom(room, size, grid, zone.index, zone.points, zone.tiles);
    for (const [x, y] of zone.tiles) {
      if (room[y]?.[x] === undefined || border[y]?.[x] === undefined) continue;
      const open = zone.water
        ? room[y]![x]! > 2 && border[y]![x]! > 1
        : room[y]![x]! > 2 || border[y]![x]! === 0;
      if (!open) continue;
      // The engine indexes the plane's rows by the tile pair's SECOND field
      // and the row by its first — the transpose of the texture masks, the
      // same way the river plane's in-memory rows sit transposed against the
      // file. Held by the byte comparison, not by argument.
      plane[y * v + x] = 0;
    }
  }
  return plane;
}

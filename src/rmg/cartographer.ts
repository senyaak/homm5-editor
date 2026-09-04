// The cartographer step of MainObjects — 0xEBD4B0, between the prisons and
// the shrines.
//
// The prisons placer's twin: the same 0xEC1500 candidate helper (room divisor
// 3, its own border >= 1 gate, the pool rebuilt for each one), the same
// attempt loop — below(pool) and below(4) a try, the tile dropped from the
// pool on a footprint refusal — and the same two below(65535) minting the
// name on success. What differs is the count and the object: the template
// zone's `LandCartographer` (+0x4C, the field right after Prisons) and a
// fixed `AdvMapCartographerShared`.
//
// It stayed invisible for a long time because it is rare: of the twenty-two
// shipped templates the reference has none, and `S1-3P2Z7V3` — the first run
// whose CHAIN matched the engine draw for draw and whose map still did not —
// asks for exactly one, in zone 5. Its trace is the reading: pool of 258, a
// footprint refusal, then a seat out of 257, then the name.

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { ensureRoom, filterByRoom, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

export const CARTOGRAPHER_HREF = '/MapObjects/Cartographer.(AdvMapCartographerShared).xdb';

export interface PlacedCartographer {
  name: string;
  x: number;
  y: number;
  /** The quadrant drawn — the rotation is `q * PI/2`. */
  q: number;
}

export interface CartographerInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4. */
  occupancy: Uint8Array;
  /** MUTATED: the stamp's 4s join the zone's room points. */
  points: Tile[];
  /** MUTATED when carried: stamped-blocked tiles join the zone's `+0x5C` ledger. */
  blocked?: Tile[];
  zoneIndex: number;
  /** The zone's floor — floor 1 adds the fit's five-tile margin. */
  floor?: number;
  /** The level's persistent room grid, recomputed in place when carried. */
  room?: Int32Array[];
  /** The zone's `+0xCC` when the grid no longer derives it (water carve). */
  tiles?: Tile[];
  /** The template zone's LandCartographer, raw. */
  count: number;
  /** The cartographer shared's footprint (CARTOGRAPHER_HREF). */
  foot: Footprint;
}

/** One zone's cartographers — `0xEBD4B0`, draws and all. */
export function placeZoneCartographers(
  input: CartographerInput,
  rng: DrawSource,
): PlacedCartographer[] {
  const { size, grid, border, occupancy, zoneIndex, foot } = input;
  const placed: PlacedCartographer[] = [];
  if (input.count <= 0) return placed;

  const candidates = input.tiles ?? zoneTiles(size, grid, zoneIndex);
  for (let i = 0; i < input.count; i++) {
    const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
    const { kept } = filterByRoom(candidates, room, grid, border, occupancy, size, zoneIndex, 3);
    const gated = kept.filter(([x, y]) => border[y]![x]! >= 1);

    const found = tryPlace(input, foot, gated, rng);
    if (!found) continue; // this one is skipped, the next still tries
    const { tile, q } = found;

    const name = mintName(rng);
    stampFootprint(input, foot, tile, q);
    placed.push({ name, x: tile[0], y: tile[1], q });
  }
  return placed;
}

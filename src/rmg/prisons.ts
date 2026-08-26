// The prisons step of MainObjects — 0xEBD1C0, the 0xEC1500-family placer
// with a fixed shared object instead of a price list.
//
//   count      the template zone's Prisons (+0x48), a raw int — no float
//              scale, unlike its upgrade-buildings neighbour
//   per prison the shared candidate helper 0xEC1500 (room divisor 3, its
//              own border >= 1 gate, the pool rebuilt each time), then the
//              ordinary attempt loop — below(pool) + below(4) a try — and
//              two below(65535) minting the name on success
//   no guard   none of the 0xEC1500 family calls SetMonster
//   failure    an exhausted pool skips THIS prison and moves to the next —
//              continue where dwellings abandon the step and the price
//              lists return
//
// The object is an AdvMapPrison with RandomHero written true and
// PrisonedHero left empty: the generator never picks the hero and spends
// nothing on one — the game does, when the map is loaded.
//
// The step was dead on the surface reference (every Prisons was 0); the
// underground run is what made it measurable — 8 draws in zone 1 (two fit
// refusals, then a seat) and 6 in zone 2.

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { ensureRoom, filterByRoom, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

export const PRISON_HREF = '/MapObjects/Prison.(AdvMapPrisonShared).xdb';

export interface PlacedPrison {
  name: string;
  x: number;
  y: number;
  /** The quadrant drawn — the rotation is `q * PI/2`. */
  q: number;
}

export interface PrisonsInput {
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
  /** The template zone's Prisons count, raw. */
  count: number;
  /** The prison shared's footprint (PRISON_HREF). */
  foot: Footprint;
}

/** One zone's prisons — `0xEBD1C0`, draws and all. */
export function placeZonePrisons(input: PrisonsInput, rng: DrawSource): PlacedPrison[] {
  const { size, grid, border, occupancy, zoneIndex, foot } = input;
  const placed: PlacedPrison[] = [];
  if (input.count <= 0) return placed;

  const candidates = input.tiles ?? zoneTiles(size, grid, zoneIndex);
  for (let i = 0; i < input.count; i++) {
    const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
    const { kept } = filterByRoom(candidates, room, grid, border, occupancy, size, zoneIndex, 3);
    const gated = kept.filter(([x, y]) => border[y]![x]! >= 1);

    const found = tryPlace(input, foot, gated, rng);
    if (!found) continue; // this prison is skipped, the next still tries
    const { tile, q } = found;

    const name = mintName(rng);
    stampFootprint(input, foot, tile, q);
    placed.push({ name, x: tile[0], y: tile[1], q });
  }
  return placed;
}

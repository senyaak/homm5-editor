// The shrines step of MainObjects — read from 0xEBE1C0, held to the traced
// run. A price-list placer like the upgrade buildings, with three deliberate
// differences, each one measured:
//
//   points     the template's ShrinePoints RAW (`zone params +0x54`) — no
//              tile scaling, no /10000; under 6 the step returns before any
//              draw
//   list       NOT the preset — a hardcoded three-entry table, mines-style:
//              Shrine_Of_Magic_1/2/3 at costs {6, 10, 12} (records at
//              0x121CA90, costs at 0xFF4C94). The preset's NewShrines
//              vector is never read by this worker.
//   filter     the shared helper 0xEC1500 — same room > trunc(2·max/3) over
//              the zone+0xCC tiles, PLUS a border distance >= 1 gate the
//              inline filters of dwellings and upgrade buildings do not have
//   guard      none, ever: 0xED3200's only caller in the image is the
//              upgrade-buildings worker, and SetMonster is called by none of
//              the 0xEC1500 family (prisons, cartographer, shrines,
//              resource, treasury, luck/morale, shops)
//   loop       spent += cost; while spent + 6 <= points — the 6 is a literal
//              in the code, not cost[0] recomputed
//   failure    exhausted candidates end the whole step ("Cant set shrine %s
//              in zone %d"), dwellings-style
//
// The created shrine gets no SpellID — the reference's SPELL_NONE is the
// shared document's default, not the generator's choice. Draw cost per
// shrine: 1 (which) + 2 per attempt + 2 (name).

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { filterByRoom, roomGrid, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

/**
 * The engine's own table at 0x121CA90 (hrefs, static init 0x4D5B40) and
 * 0xFF4C94 (costs). The order is the table's — the prefix draw indexes it.
 */
export const SHRINE_TYPES: ReadonlyArray<{ name: string; cost: number }> = [
  { name: 'Shrine_Of_Magic_1', cost: 6 },
  { name: 'Shrine_Of_Magic_2', cost: 10 },
  { name: 'Shrine_Of_Magic_3', cost: 12 },
];

export interface PlacedShrine {
  type: string;
  name: string;
  x: number;
  y: number;
  q: number;
}

export interface ShrineStepInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4 the way the engine does. */
  occupancy: Uint8Array;
  /** MUTATED: the stamp's 4s join the zone's room points. */
  points: Tile[];
  zoneIndex: number;
  /** The template's ShrinePoints, raw. */
  shrinePoints: number;
  /** Footprints for the three shrines, in SHRINE_TYPES order. */
  footprints: Footprint[];
}

/** One zone's shrines — `0xEBE1C0`, draws and all. */
export function placeZoneShrines(input: ShrineStepInput, rng: DrawSource): PlacedShrine[] {
  const { size, grid, border, occupancy, zoneIndex, shrinePoints } = input;
  const candidates = zoneTiles(size, grid, zoneIndex);
  const placed: PlacedShrine[] = [];

  let spent = 0;
  while (spent + 6 <= shrinePoints) {
    let prefix = 0;
    while (prefix < SHRINE_TYPES.length && SHRINE_TYPES[prefix]!.cost + spent <= shrinePoints) prefix++;
    const which = rng.below(prefix);
    const spec = SHRINE_TYPES[which]!;
    const foot = input.footprints[which]!;

    // The shared candidate helper 0xEC1500: rebuilt from the original list
    // per shrine, room threshold at divisor 3, and the border >= 1 gate that
    // is this helper's own.
    const room = roomGrid(size, grid, zoneIndex, input.points);
    const { kept } = filterByRoom(candidates, room, grid, border, occupancy, size, zoneIndex, 3);
    const gated = kept.filter(([x, y]) => border[y]![x]! >= 1);

    const found = tryPlace(input, foot, gated, rng);
    if (!found) return placed;
    const { tile, q } = found;

    const name = mintName(rng);
    stampFootprint(input, foot, tile, q);
    placed.push({ type: spec.name, name, x: tile[0], y: tile[1], q });
    spent += spec.cost;
  }
  return placed;
}

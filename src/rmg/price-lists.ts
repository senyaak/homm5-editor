// The four price-list steps that share one body — resource buildings
// (0xEBE540), treasury buildings (0xEBECB0), luck/morale (0xEBF090) and
// shops (0xEBF540) — and the generic placer the shrines step also fits.
// Read as a diff against the shape docs/RMG.md establishes for upgrade
// buildings and shrines, and held to the traced run: all 33 objects of the
// four steps replay draw for draw, name for name, Rot for Rot.
//
// What the four share, read out of all four bodies:
//
//   candidates  the shared helper 0xEC1500 — room > trunc(2·max/3) over
//               the zone+0xCC tiles PLUS the border >= 1 gate; rebuilt per
//               object, struck-out tiles return for the next one
//   grammar     below(affordable leading prefix) picks the type, then
//               attempt pairs and the two-draw mint — nothing else; no
//               properties are set on the created object
//   guards      NONE, ever. 0xED3200's only caller is upgrade buildings,
//               and SetMonster appears in none of the four — the records'
//               GuardStrenght is dead data (twelve traced objects carry a
//               non-zero one and not one drew a guard)
//   stop        while list[0].Value + spent <= points — the FIRST element,
//               like upgrade buildings; the shrines' hardcoded 6 is that
//               list's cost[0] and a quirk of that worker alone
//   failure     exhausted candidates abandon the step whole
//
// The budgets differ, and the template field's SUFFIX predicts the rule —
// `…Points` fields arrive raw, `…Density` fields scale by the zone's tile
// count over 10000 (the 0x68DB8BAD magic):
//
//   resource     trunc(tiles · ResourceBuildingsDensity / 10000)
//   treasury     TreasureBuildingPoints raw
//   luck/morale  trunc(tiles · (LuckMoralBuildingsDensity + 40) / 10000)
//                — the +40 is `add eax,28h` at 0xEBF0C6, applied to the
//                density INSIDE the product, and it is what makes a
//                density-0 zone still build (2279·40/10000 = 9 points)
//   shops        ShopPoints raw
//
// A list entry need not be a building: shops ship two dwelling hrefs
// (ElementalConflux, RefugeeCamp) and place them as plain objects — the
// worker casts to the shared BASE type. The one exception is treasury,
// whose working descriptor is cast to SAdvMapBuildingShared: a non-building
// entry there would abort the step silently. Nothing shipped reaches it.

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { ensureRoom, filterByRoom, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

/**
 * `trunc(tiles · (density + offset) / 10000)` — the `…Density` budget rule.
 * Offset is 0 everywhere except luck/morale's 40.
 */
export const scaledBudget = (tiles: number, density: number, offset = 0): number =>
  Math.trunc((tiles * (density + offset)) / 10000);

export interface PricedItem {
  /** The Building href — identity for the map file; may be a dwelling. */
  type: string;
  value: number;
  foot: Footprint;
}

export interface PlacedPriced {
  type: string;
  name: string;
  x: number;
  y: number;
  q: number;
}

export interface PriceListInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4 the way the engine does. */
  occupancy: Uint8Array;
  /** MUTATED: the stamp's 4s join the zone's room points. */
  points: Tile[];
  zoneIndex: number;
  /** The level's persistent room grid, recomputed in place when carried. */
  room?: Int32Array[];
  /** The step's points, already through its budget rule. */
  budget: number;
  /** The preset vector in file order — the prefix draw leans on it. */
  list: PricedItem[];
}

/**
 * The `0xEC1500`-family placer, draws and all. The shrines step is this
 * with its hardcoded three-entry list; the four preset-vector steps are
 * this with theirs.
 */
export function placePriceList(input: PriceListInput, rng: DrawSource): PlacedPriced[] {
  const { size, grid, border, occupancy, zoneIndex, budget, list } = input;
  const placed: PlacedPriced[] = [];
  if (list.length === 0) return placed;

  const candidates = zoneTiles(size, grid, zoneIndex);
  let spent = 0;
  while (list[0]!.value + spent <= budget) {
    // The affordable LEADING prefix — breaks at the first element over
    // budget, so entries behind an expensive one stay unreachable.
    let prefix = 0;
    while (prefix < list.length && list[prefix]!.value + spent <= budget) prefix++;
    const entry = list[rng.below(prefix)]!;

    // The shared candidate helper 0xEC1500: rebuilt from the original list
    // per object, room threshold at divisor 3, and its own border >= 1 gate.
    const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
    const { kept } = filterByRoom(candidates, room, grid, border, occupancy, size, zoneIndex, 3);
    const gated = kept.filter(([x, y]) => border[y]![x]! >= 1);

    const found = tryPlace(input, entry.foot, gated, rng);
    if (!found) return placed;
    const { tile, q } = found;

    const name = mintName(rng);
    stampFootprint(input, entry.foot, tile, q);
    placed.push({ type: entry.type, name, x: tile[0], y: tile[1], q });
    spent += entry.value;
  }
  return placed;
}

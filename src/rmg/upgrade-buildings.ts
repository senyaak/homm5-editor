// The upgrade-buildings step of MainObjects — read from 0xEB96D0, held to
// the traced run. This is the first of the PRICE-LIST placers: a points
// budget buys objects off a sorted list until nothing is affordable.
//
//   points     trunc(zoneTiles · trunc(density · mult) / 10000); density is
//              the template's UpgBuildingsDensity raw, and mult is the
//              {0.2, 0.5, 1, 2, 4} ladder indexed by generator+0xB0 — the
//              traced run's draw counts pin that index to 1 (× 0.5), which
//              is the whole of why a town zone at density 40 spends nothing:
//              2302·20/10000 = 4 points against a cheapest Value of 8.
//              Towns are never consulted.
//   list       the race preset's NewUpgradeBuildings ([zone+0x20]+0x168),
//              {href, Value, GuardStrenght} — shipped sorted ascending by
//              Value, and the prefix draw depends on that: the affordable
//              prefix BREAKS at the first element with Value+spent > points
//              rather than filtering the whole list
//   per object below(prefix) picks the building, then the dwellings-shaped
//              body: room recomputed, filter room > trunc(2·max/3) over the
//              zone+0xCC tiles, two draws per attempt, two for the name
//   guard      the wrapper 0xED3200 — its own seat rule, see seatGuard —
//              at BasicLeverGuardPower × the element's GuardStrenght
//   loop       spent += Value; while list[0].Value + spent <= points (the
//              FIRST element, not a recomputed minimum)
//   failure    exhausted candidates abandon the step, dwellings-style
//
// The engine's mint-failure path (0xEB9B37) skips the accounting and loops
// with an identical candidate list — a suspected infinite loop it never
// reaches; this port's mint cannot fail.

import { mintName, setMonster } from './armies.ts';
import type { DrawSource, Guard, GuardTables } from './armies.ts';
import { EIGHT, ensureRoom, filterByRoom, isFree, stampFootprint, tryPlace, zoneTiles } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';
import { rotate } from './towns.ts';

/** `{0.2, 0.5, 1, 2, 4}` — the jump table at 0xEA543C, indexed by generator+0xB0. */
export const DENSITY_MULTIPLIERS: readonly number[] = [0.2, 0.5, 1, 2, 4];

export interface PricedEntry {
  /** The Building href, identity for the map file. */
  href: string;
  value: number;
  guardStrenght: number;
  foot: Footprint;
}

export interface SeatedGuard {
  x: number;
  y: number;
  /** null when the power was under 100 — the seat is still taken. */
  guard: Guard | null;
}

/**
 * The guard wrapper `0xED3200` — how a price-list object seats its guard,
 * and it differs from the mines' inline seat in both anchors:
 *
 * - the base tile is the object's position plus the FIRST active-tile offset
 *   rotated by the object's angle (the mines use the LAST stamped tile);
 * - EIGHT directions are tried, orthogonals then diagonals from index 2q
 *   (the mines try only the four orthogonals).
 *
 * The freeness test is the road-lenient one, with no border or zone check.
 * On a found seat the engine calls SetMonster FIRST and then writes
 * occupancy 4 regardless of the result — a GuardStrenght of 0 spends no
 * draws (SetMonster's own power < 100 gate) but still burns the tile. The
 * guard tile joins `zone+0x98` — not the room points, so no room computation
 * sees it, but the treasure blocks phase keeps its piles away from every
 * entry in that ledger. The tile comes back in `SeatedGuard` for callers that
 * need to rebuild the list.
 * No free neighbour: no draws, no writes, no guard.
 */
export function seatGuard(
  input: {
    size: number;
    occupancy: Uint8Array;
    at: Tile;
    q: number;
    foot: Footprint;
    power: number;
    monsterStrength: number;
    tables: GuardTables;
  },
  rng: DrawSource,
): SeatedGuard | null {
  const { size, occupancy, at, q, foot } = input;
  const first = foot.active[0];
  if (!first) return null;
  const [dx, dy] = rotate(q, first);
  const base: Tile = [at[0] + dx, at[1] + dy];
  const start = 2 * q;
  for (let j = 0; j < 8; j++) {
    const [ox, oy] = EIGHT[(start + j) & 7]!;
    const x = base[0] + ox;
    const y = base[1] + oy;
    if (x < 0 || x >= size || y < 0 || y >= size) continue;
    if (!isFree(occupancy[y * size + x]!)) continue;
    const guard = setMonster(input.power, input.monsterStrength, input.tables, rng);
    occupancy[y * size + x] = 4;
    return { x, y, guard };
  }
  return null;
}

export interface PlacedUpgradeBuilding {
  type: string;
  name: string;
  x: number;
  y: number;
  q: number;
  guard: SeatedGuard | null;
}

export interface UpgradeBuildingsInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp marks 2 and 4; a seated guard marks 4. */
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
  /** The template's UpgBuildingsDensity, raw (`zone params +0x3C`). */
  density: number;
  /** generator+0xB0 — 1 in every traced run. What writes it is unread. */
  multIndex: number;
  /** The race preset's NewUpgradeBuildings, file order, with footprints. */
  list: PricedEntry[];
  basicLeverGuardPower: number;
  monsterStrength: number;
  tables: GuardTables;
}

/** One zone's upgrade buildings — `0xEB96D0`, draws and all. */
export function placeZoneUpgradeBuildings(input: UpgradeBuildingsInput, rng: DrawSource): PlacedUpgradeBuilding[] {
  const { size, grid, border, occupancy, zoneIndex, list } = input;
  const candidates = zoneTiles(size, grid, zoneIndex);

  const mult = DENSITY_MULTIPLIERS[input.multIndex] ?? 1;
  const budget = Math.trunc((candidates.length * Math.trunc(input.density * mult)) / 10000);

  const placed: PlacedUpgradeBuilding[] = [];
  if (list.length === 0) return placed;

  let spent = 0;
  while (list[0]!.value + spent <= budget) {
    // The affordable LEADING prefix — the scan breaks at the first element
    // over budget, so the shipped ascending order is load-bearing.
    let prefix = 0;
    while (prefix < list.length && list[prefix]!.value + spent <= budget) prefix++;
    const entry = list[rng.below(prefix)]!;

    const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
    const { kept } = filterByRoom(candidates, room, grid, border, occupancy, size, zoneIndex, 3);

    // Exhausted candidates are the "Can't place building" line — terminal
    // for the whole step.
    const found = tryPlace(input, entry.foot, kept, rng);
    if (!found) return placed;
    const { tile, q } = found;

    const name = mintName(rng);
    stampFootprint(input, entry.foot, tile, q);
    const guard = seatGuard({
      size, occupancy, at: tile, q, foot: entry.foot,
      power: input.basicLeverGuardPower * entry.guardStrenght,
      monsterStrength: input.monsterStrength, tables: input.tables,
    }, rng);

    placed.push({ type: entry.href, name, x: tile[0], y: tile[1], q, guard });
    spent += entry.value;
  }
  return placed;
}

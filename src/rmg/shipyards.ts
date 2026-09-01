// The shipyard — the water half of a zone's connections sweep.
//
// ZoneConnections (0xEA3930) is two sweeps over every zone: the land digger
// (0xEB7C40), then the vtable's +0x2C. The base slot IS the teleport pass
// (0xEB7C60 — teleports.ts); CGameWaterBorderedZone's override (0xECCB30)
// calls that same pass and then, when the zone's `+0x164` Shipyard bit is
// set (the template's, default true), tail-jumps into the shipyard placer
// 0xECC0A0. So an island zone gets its monoliths from the code the
// underground already proved, and ONE shipyard from here.
//
// The placer, read from 0xECC0A0:
//
//   candidates  the rebuilt `+0xCC` list (rim included) where the ADJUSTED
//               border sits in [2, 3] and the tile keeps strictly more than
//               depth+3 from every map edge (depth = zone+0x160, the carve's
//               argument); then the room recompute (0xEC28E0 mask 4, the
//               ensureRoom the whole family shares) and the max (0xEC2EB0),
//               keeping room > trunc(4*max/5) — the 0x66666667 magic over
//               max*4, the abandoned mines' divisor.
//   facing      NOT drawn: the shipyard faces the town entry (zone+0xC,
//               under the +0xF8 flag) or, townless, the CENTROID of the
//               zone's tiles — singles accumulated in list order, divided
//               by the count. |dx| > |dy| picks the axis, the sign the
//               quadrant, and pi/2 is added on top: q = dx-major
//               ? (dx > 0 ? 0 : 2) : (dy < 0 ? 3 : 1), rotation q*pi/2
//               (dx > 0 lands on 2*pi, one full turn — the fit and the
//               eight-direction start wrap it back to q 0).
//   attempt     ONE below(pool) per try — no quadrant draw, the facing is
//               fixed — a failed fit (0xEC3510) strikes the candidate and
//               draws again; exhaustion means no shipyard, no draws left
//               behind.
//   place       0xEB43D0 mints the name (two below(65535)) and creates the
//               object; the stamp (0xEC2F90) writes the blocked 2s (and the
//               `+0x5C` ledger) and pushes the ACTIVE tiles into the zone's
//               `+0xC0` connection points — the roads phase will wire the
//               shipyard into the network. Then a 5x5 halo around the tile
//               turns occupancy 0 into 1 — a reservation only the guard
//               seat test below ever distinguishes.
//   guard       base = the LAST `+0xC0` entry (the stamp's last active);
//               eight directions from index trunc(facing*4/pi + 0.5) = 2q,
//               the shared EIGHT table; a seat qualifies when its occupancy
//               is 0 or intersects 0x39 — the road-lenient test PLUS the
//               halo's 1. Power = BasicLeverGuardPower * ConnectionGuardLevel
//               * 20 — the 20 is an immediate (lea/shl at 0xECC901), not a
//               read of ShipyardGuardsLevelCoef (+0x1F0), though the shipped
//               value is the same 20. SetMonster runs via 0xED1DC0, the
//               guard's rotation records facing - pi, and the seat joins the
//               `+0x98` ledger the treasure blocks repel from.

import { setMonster } from './armies.ts';
import type { DrawSource, Guard, GuardTables } from './armies.ts';
import { EIGHT, ensureRoom, fits, stampFootprint } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';
import { mintName } from './armies.ts';

export const SHIPYARD_HREF = '/MapObjects/Shipyard.(AdvMapShipyardShared).xdb';

export interface ShipyardInput {
  size: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the stamp's 2s, the guard's 4, and the 5x5 halo of 1s. */
  occupancy: Uint8Array;
  /** The floor's persistent room grid — recomputed here (0xEC28E0 mask 4). */
  room: Int32Array[];
  /**
   * The zone's `+0x68` room points, for the recompute — and MUTATED: the
   * stamp pushes the shipyard's actives and marker here too, like every
   * 0xEC2F90 stamp, so the mines' room downstream sees the shipyard.
   */
  points: Tile[];
  /** MUTATED: the stamp's blocked tiles join the `+0x5C` ledger. */
  blocked: Tile[];
  /** MUTATED: the stamp's actives join the `+0xC0` connection points. */
  connectionPoints: Tile[];
  /** MUTATED: the guard's seat joins the `+0x98` ledger. */
  guardSeats: Tile[];
  zoneIndex: number;
  floor: number;
  /** The rebuilt `+0xCC` — the carve's kept list, rim included. */
  tiles: Tile[];
  /** The carve's depth (zone+0x160). */
  depth: number;
  /** The town entry (zone+0xC) when the +0xF8 flag says the zone has one. */
  town: { x: number; y: number } | null;
  foot: Footprint;
  /** BasicLeverGuardPower * ConnectionGuardLevel — the connection unit. */
  guardPowerUnit: number;
  monsterStrength: number;
  tables: GuardTables;
}

export interface PlacedShipyard {
  name: string;
  x: number;
  y: number;
  /** The facing quarter — 0 is the engine's 2*pi. */
  q: number;
  guard: { x: number; y: number; guard: Guard | null } | null;
}

const fl = Math.fround;

/** `0xECC0A0` — one shipyard for a water-bordered zone. */
export function placeShipyard(input: ShipyardInput, rng: DrawSource): PlacedShipyard | null {
  const { size, grid, border, occupancy, zoneIndex, depth, tiles } = input;

  const margin = depth + 3;
  const framed = tiles.filter(([x, y]) => {
    const b = border[y]![x]!;
    if (b < 2 || b > 3) return false;
    return x > margin && y > margin && x < size - margin && y < size - margin;
  });

  const room = ensureRoom(input.room, size, grid, zoneIndex, input.points);
  // The maximum over the framed list, with 0xEC2EB0's own gates — a border-2
  // candidate counts toward the POOL but not toward the maximum.
  let max = 0;
  for (const [x, y] of framed) {
    if (grid[y]![x] !== zoneIndex) continue;
    if (border[y]![x]! <= 2) continue;
    if (occupancy[y * size + x] === 2) continue;
    const r = room[y]![x]!;
    if (r > max) max = r;
  }
  // (max*4) through the 0x66666667 magic (>>33, a *0.2) — trunc(4*max/5),
  // the abandoned mines' divisor, not the mines' 2/5.
  const threshold = Math.trunc((max * 4) / 5);
  const pool = framed.filter(([x, y]) => room[y]![x]! > threshold);
  if (!pool.length) return null;

  // The facing — toward the town entry, or the tile centroid without one.
  let ref: { x: number; y: number };
  if (input.town) {
    ref = input.town;
  } else {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of tiles) {
      sx = fl(sx + x);
      sy = fl(sy + y);
    }
    const inv = fl(1 / tiles.length);
    ref = { x: fl(sx * inv), y: fl(sy * inv) };
  }

  const fitCtx = { size, grid, border, occupancy, zoneIndex, floor: input.floor };
  let placedAt: Tile | null = null;
  let q = 0;
  while (pool.length) {
    const pick = rng.below(pool.length);
    const tile = pool[pick]!;
    const dx = fl(tile[0] - ref.x);
    const dy = fl(tile[1] - ref.y);
    q = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy < 0 ? 3 : 1);
    if (fits(fitCtx, input.foot, tile, q)) {
      placedAt = tile;
      break;
    }
    pool.splice(pick, 1);
  }
  if (!placedAt) return null;

  const name = mintName(rng);
  const actives = stampFootprint(
    { size, occupancy, points: input.points, blocked: input.blocked },
    input.foot, placedAt, q,
  );
  input.connectionPoints.push(...actives);

  // The 5x5 reservation halo — untouched tiles only.
  for (let ox = -2; ox <= 2; ox++) {
    for (let oy = -2; oy <= 2; oy++) {
      const x = placedAt[0] + ox;
      const y = placedAt[1] + oy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      if (occupancy[y * size + x] === 0) occupancy[y * size + x] = 1;
    }
  }

  // The guard — from the last stamped active, eight directions from 2q.
  let guard: PlacedShipyard['guard'] = null;
  const base = actives[actives.length - 1];
  if (base) {
    for (let j = 0; j < 8; j++) {
      const [ox, oy] = EIGHT[(2 * q + j) & 7]!;
      const x = base[0] + ox;
      const y = base[1] + oy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const occ = occupancy[y * size + x]!;
      if (occ !== 0 && (occ & 0x39) === 0) continue;
      const seated = setMonster(input.guardPowerUnit * 20, input.monsterStrength, input.tables, rng);
      // Unlike the price-list guards, the shipyard's seat writes NO
      // occupancy — the halo's 1 (or the road bit) stays, and the island
      // run's oc dump is what said so: the four divergent cells of the
      // whole grid were the four shipyard guard seats, engine 1 to the
      // port's 4. The freed cell is what hands the treasure blocks their
      // extra (rejected) seed candidate beside the shipyard road.
      input.guardSeats.push([x, y]);
      guard = { x, y, guard: seated };
      break;
    }
  }

  return { name, x: placedAt[0], y: placedAt[1], q, guard };
}

/**
 * The 46-entry ring `0xCB1960` walks, straight out of `0x10918E0`: per
 * entry the OUTER offset — the one that becomes the ShipTile — and the
 * INNER one, a step back toward the yard. Rows at ±4 first, then the
 * corners, then the sides.
 */
const SHIP_RING: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -4, 0, -3], [-1, -4, -1, -3], [1, -4, 1, -3], [-2, -4, -2, -3], [2, -4, 2, -3],
  [0, 4, 0, 3], [-1, 4, -1, 3], [1, 4, 1, 3], [-2, 4, -2, 3], [2, 4, 2, 3],
  [-3, -3, -2, -3], [-3, -3, -3, -2], [3, -3, 2, -3], [3, -3, 3, -2],
  [-3, 3, -2, 3], [-3, 3, -3, 2], [3, 3, 2, 3], [3, 3, 3, 2],
  [-4, -2, -3, -2], [4, -2, 3, -2], [-4, -1, -3, -1], [4, -1, 3, -1],
  [-4, 0, -3, 0], [4, 0, 3, 0], [-4, 1, -3, 1], [4, 1, 3, 1], [-4, 2, -3, 2], [4, 2, 3, 2],
  [-3, 2, -2, 2], [-3, 2, -3, 1], [3, 2, 2, 2], [3, 2, 3, 1],
  [-3, -2, -2, -2], [-3, -2, -3, -1], [3, -2, 2, -2], [3, -2, 3, -1],
  [0, 3, 0, 2], [-1, 3, -1, 2], [1, 3, 1, 2], [-2, 3, -2, 2], [2, 3, 2, 2],
  [0, -3, 0, -2], [-1, -3, -1, -2], [1, -3, 1, -2], [-2, -3, -2, -2], [2, -3, 2, -2],
];

/**
 * `ShipTile` — where the shipyard's boat sits, as an offset from the yard.
 *
 * `0xCB1960` is a search, not a formula: it walks the ring above and takes
 * the OUTER offset of the first entry whose outer tile is water and whose
 * inner tile is neither water nor a transition. Finding nothing drops the
 * shipyard candidate entirely, so a placed yard always has one.
 *
 * "Water" is `0x9EC3C0`, and on a generated surface it collapses to one
 * test. The predicate first reads the four corner vertices of the GROUND
 * FLAGS plane (`+0x24`, clamped to `[0, dim-2]`): all zero takes an early
 * exit, otherwise it asks whether they DIFFER (`0x9EB9E0`, the same four
 * bytes) and whether a texture layer of the right class covers the vertex
 * (`0x9EBAE0`). A surface floor's flags are the constructor's uniform 16
 * forever — so they are never all zero, never differ, and the layer arm is
 * unreachable. What is left is the river half-grid, sampled at the tile's
 * CENTRE cell (2y+1, 2x+1) and compared against 0x8C — 140.
 *
 * The float plane at `+0x54` guards the tail (`> 0.0` refuses), but its
 * dims gate the read and no generated map allocates it; that arm is
 * untested here and named rather than guessed at. Same for the two flag
 * arms above: they are dead on every floor this port produces, and a
 * dwarven underground — whose flags are the massif carve's byte grid, not
 * a uniform — would be where they wake up. No shipyard has ever been
 * placed there, and none can be: shipyards are water-bordered zones only.
 */
export function shipTile(
  at: readonly [number, number],
  river: { w: number; data: Uint8Array },
  size: number,
): readonly [number, number] | null {
  const { w, data } = river;
  const water = (x: number, y: number): boolean => {
    // The engine clamps both coordinates into [0, dim-2] before it reads.
    const cx = x < 0 ? 0 : x > size - 1 ? size - 1 : x;
    const cy = y < 0 ? 0 : y > size - 1 ? size - 1 : y;
    return data[(2 * cy + 1) * w + (2 * cx + 1)]! > 0x8c;
  };
  for (const [ox, oy, ix, iy] of SHIP_RING) {
    if (!water(at[0] + ox, at[1] + oy)) continue;
    if (water(at[0] + ix, at[1] + iy)) continue;
    return [ox, oy];
  }
  return null;
}

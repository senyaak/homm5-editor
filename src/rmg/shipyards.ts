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
  /**
   * MUTATED and CARRIED between the zone's attempts: the candidate vector the
   * engine builds once per call of the placer and never clears — see the body.
   */
  framed: Tile[];
  /**
   * THE GAME'S BUILD ONLY — the centroid accumulator, MUTATED and CARRIED
   * the way `framed` is. Absent, the facing is computed the editor's way.
   *
   * The centroid's running sum is an uninitialised local in both builds. In
   * the editor the facing is a routine of its own (`0xC06830`) whose frame
   * the fit and `shipTile` calls overwrite between attempts, so each attempt
   * starts from a sum that reads as zero — the one-shot centroid the corpus
   * matched. In the game the routine is INLINED into the placer
   * (`0xECC3FC..0xECC427`): the sum lives in the placer's own frame, the
   * retry re-enters ABOVE the summing block, and nothing zeroes it — so
   * attempt k adds the whole tile list a k-th time and faces `k × centroid`.
   * On a 96x96 island map that turns a shipyard's q=2 into the game's q=3:
   * the reference is not elsewhere, it is the same point multiplied.
   */
  centroidSum?: { x: number; y: number };
  /** The rebuilt `+0xCC` — the carve's kept list, rim included. */
  tiles: Tile[];
  /** The carve's depth (zone+0x160). */
  depth: number;
  /**
   * The river plane as the carve left it — a GATE, not a decoration. See the
   * seat loop: a tile with nowhere to put the ship is refused.
   */
  river: { w: number; data: Uint8Array };
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

  // THE CANDIDATE VECTOR IS THE CALLER'S, and that is the whole reason it is a
  // parameter. `0xECC0A0` zeroes it at the function HEAD (0xECC0A9) and loops
  // its body from 0xECC0F0, so a zone that gets two shipyards scans its tiles
  // twice into the SAME vector: the second pass's pool is the first pass's
  // entries plus its own, duplicates and all. Measured, not inferred - zone 2
  // of `S2-3P2Z7N2` draws from 12 then 100 where a fresh vector would give 12
  // then 50, and zone 1 from 43 then 38 against 43 then 19.
  const framed = input.framed;
  const margin = depth + 3;
  for (const [x, y] of tiles) {
    const b = border[y]![x]!;
    if (b < 2 || b > 3) continue;
    if (x > margin && y > margin && x < size - margin && y < size - margin) framed.push([x, y]);
  }

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
  // The sum starts wherever the accumulator stands: fresh here for the
  // editor, carried in for the game (see `centroidSum`), and in the game
  // it is added to again on EVERY attempt, inside the loop below.
  const sum = input.centroidSum ?? { x: 0, y: 0 };
  const reference = (): { x: number; y: number } => {
    if (input.town) return input.town;
    for (const [x, y] of tiles) {
      sum.x = fl(sum.x + x);
      sum.y = fl(sum.y + y);
    }
    const inv = fl(1 / tiles.length);
    return { x: fl(sum.x * inv), y: fl(sum.y * inv) };
  };
  let ref = input.centroidSum ? null : reference();

  const fitCtx = { size, grid, border, occupancy, zoneIndex, floor: input.floor };
  let placedAt: Tile | null = null;
  let q = 0;
  while (pool.length) {
    const pick = rng.below(pool.length);
    const tile = pool[pick]!;
    if (input.centroidSum) ref = reference();
    const dx = fl(tile[0] - ref!.x);
    const dy = fl(tile[1] - ref!.y);
    q = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy < 0 ? 3 : 1);
    // AND THE SHIP HAS TO HAVE SOMEWHERE TO FLOAT. `shipTile` is the engine's
    // own ring walk over the river plane, and a shipyard whose ring holds no
    // usable water is refused here rather than placed and left without a ship
    // — measured on `S3-5P2Z7N2.2` at seed 987654321, where zone 6's first
    // shipyard drew (165,100) fifth (its ring: nothing) and the engine went on
    // to draw (166,95) sixth (its ring: [-1,-4]). Every other gate reads the
    // same on the two tiles; this is the one that separates them.
    if (fits(fitCtx, input.foot, tile, q) && shipTile(tile, input.river, size)) {
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

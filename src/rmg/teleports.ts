// The teleport pass of ZoneConnections — 0xEB7C60, vtable slot 11, the
// phase's SECOND sweep: floors in order, zones in bucket order, after every
// zone has run the land digger. A connection that got no land passage — a
// different floor, or a border too thin — gets its teleports here.
//
// EACH ZONE PLACES ITS OWN HALF. The pass writes nothing into the
// connected list (`zone+0xD8`), so both endpoint zones see the connection
// as unserved and each places one object; the halves are paired by nothing
// but a shared GroupID = min(a,b)*100 + max(a,b). Same floor gets two
// Monolith_Two_Way, a cross-floor link a Gate_In on the surface and a
// Gate_Out below — decided by floors alone, no draw.
//
// Per half, in draw order:
//
//   below(candidates)     the tile — candidates are the zone's tiles at
//                         border 3..9 (the 2 and 10 are LITERALS in the
//                         code; the Teleport*BorderDistance params exist
//                         and are never read), filtered by room > 2max/3
//                         after a (4,0) recompute; a fit refusal strikes
//                         the tile and draws again
//   below(65535) twice    the name, once the fit passes
//   SetMonster            the guard — 4 or 5 draws, at the connection's
//                         power over sqrt(2), rounded to nearest
//
// An EMPTY candidate list is a return from the whole zone — the rest of
// its connections are silently lost, drawlessly if the room filter left
// nothing, with the "cant find empty tiles" log if the fit refused them
// all. The guard seats on the first FREE neighbour of the stamp's last
// active tile — four orthogonals then four diagonals, both rings walked
// from a start the rotation picks — its tile joins `zone+0x98` and
// occupancy is NOT written under it. The stamp's actives join `zone+0xC0`,
// which the roads phase later wires into the 0x08 network.

import { mintName, setMonster } from './armies.ts';
import type { DrawSource, Guard, GuardTables } from './armies.ts';
import { fits, isFree, stampFootprint } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';
import type { RmgConnection } from './template.ts';

const fl = Math.fround;

export const MONOLITH_HREF = '/MapObjects/Monolith_Two_Way.(AdvMapBuildingShared).xdb';
export const GATE_IN_HREF = '/MapObjects/Subterranean_Gate_In.(AdvMapBuildingShared).xdb';
export const GATE_OUT_HREF = '/MapObjects/Subterranean_Gate_Out.(AdvMapBuildingShared).xdb';

/** The guard's neighbour rings — 0x1093968 orthogonals, 0x1093988 diagonals. */
const ORTHO4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const DIAG4: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

export interface PlacedTeleport {
  href: string;
  name: string;
  x: number;
  y: number;
  /** The rotation in quarter turns — Rot is `q * PI/2`. */
  q: number;
  groupId: number;
  guard: (Guard & { x: number; y: number }) | null;
}

export interface ZoneTeleportsInput {
  size: number;
  zoneIndex: number;
  floor: number;
  /** The ZONE's floor's grids. */
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: the teleport's stamp marks 2 and 4; the guard marks nothing. */
  occupancy: Uint8Array;
  /** MUTATED: the stamp's 4s join the zone's room points (`zone+0x68`). */
  points: Tile[];
  /** MUTATED: the stamp's actives join `zone+0xC0` for the roads phase. */
  connectionPoints: Tile[];
  /** MUTATED: the guard's tile joins the `zone+0x98` ledger. */
  guardSeats: Tile[];
  /** The template's connections, in FILE order. */
  connections: readonly RmgConnection[];
  /** The connections the land digger could not serve. */
  unconnected: ReadonlySet<RmgConnection>;
  /** `zone+0x0C/0x10` — the town entry, or the townless centroid. */
  centre: { x: number; y: number };
  floorOf(zoneIndex: number): number;
  footprint(href: string): Footprint;
  /** `BasicLeverGuardPower * ConnectionGuardLevel`. */
  guardPowerUnit: number;
  monsterStrength: number;
  tables: GuardTables;
  /** The room-filter threshold input — recompute and max are the caller's. */
  roomKept(tiles: Tile[]): Tile[];
}

/**
 * One zone's teleport pass. Returns what stood; a zone whose candidates
 * ran dry mid-way keeps what it placed and loses its remaining links, the
 * way the engine's `return` does.
 */
export function placeZoneTeleports(input: ZoneTeleportsInput, rng: DrawSource): PlacedTeleport[] {
  const { size, zoneIndex, border, grid, occupancy } = input;
  const placed: PlacedTeleport[] = [];

  for (const conn of input.connections) {
    // Dest is compared FIRST — a self-loop would resolve to the source.
    let other: number;
    if (conn.destZoneIndex === zoneIndex) other = conn.sourceZoneIndex;
    else if (conn.sourceZoneIndex === zoneIndex) other = conn.destZoneIndex;
    else continue;
    if (!input.unconnected.has(conn)) continue; // the land digger served it

    // Candidates: the zone's tiles at border 3..9, then the room filter.
    const ring: Tile[] = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (grid[y]![x] !== zoneIndex) continue;
        const bd = border[y]![x]!;
        if (bd > 2 && bd < 10) ring.push([x, y]);
      }
    }
    const cand = input.roomKept(ring);
    if (!cand.length) return placed; // no log, no draw, the zone is done

    const otherFloor = input.floorOf(other);
    const href = otherFloor === input.floor ? MONOLITH_HREF
      : input.floor === 0 ? GATE_IN_HREF : GATE_OUT_HREF;
    const foot = input.footprint(href);
    const groupId = Math.min(zoneIndex, other) * 100 + Math.max(zoneIndex, other);

    // The seat: one draw a try, a fit refusal strikes the candidate out.
    let tile: Tile | null = null;
    let q = 0;
    while (cand.length) {
      const k = rng.below(cand.length);
      const [px, py] = cand[k]!;
      const dx = px - input.centre.x;
      const dy = py - input.centre.y;
      const rot = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : (dy < 0 ? 2 : 0);
      if (fits({ size, grid, border, occupancy, zoneIndex, floor: input.floor }, foot, [px, py], rot)) {
        tile = [px, py];
        q = rot;
        break;
      }
      cand.splice(k, 1);
    }
    if (!tile) return placed; // "cant find empty tiles to set teleport"

    const name = mintName(rng);
    const actives = stampFootprint({ size, occupancy, points: input.points }, foot, tile, q);
    input.connectionPoints.push(...actives);

    // The guard: the stamp's LAST active tile, orthogonals then diagonals,
    // both rings walked from the rotation's start — 1 for even quarters,
    // 3 for odd — and the first FREE tile seats it.
    let guard: PlacedTeleport['guard'] = null;
    const anchor = actives[actives.length - 1];
    if (anchor) {
      const start = q % 2 === 0 ? 1 : 3;
      const rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [ORTHO4, DIAG4];
      seat: for (const ring4 of rings) {
        for (let s = start; s < start + 4; s++) {
          const [ox, oy] = ring4[s & 3]!;
          const gx = anchor[0] + ox;
          const gy = anchor[1] + oy;
          if (gx < 0 || gx >= size || gy < 0 || gy >= size) continue;
          if (!isFree(occupancy[gy * size + gx]!)) continue;
          const power = Math.trunc(fl(fl((input.guardPowerUnit * conn.guardStrenght) / fl(Math.SQRT2)) + fl(0.5)));
          const set = setMonster(power, input.monsterStrength, input.tables, rng);
          if (set) guard = { ...set, x: gx, y: gy };
          input.guardSeats.push([gx, gy]);
          break seat;
        }
      }
    }

    placed.push({ href, name, x: tile[0], y: tile[1], q, groupId, guard });
  }
  return placed;
}

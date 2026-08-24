// `FillDistToTownsTable` — how far every tile is from its zone's centre, and
// which tiles turn out to be unreachable from it.
//
// Read from the inline loop in GenerateMap (0xeabc01..0xeabcec) calling
// `CGameZone::FillDistToTown` (0xEC06E0) per zone, floors in order, zones in
// the same hash order every zone phase uses. It draws nothing.
//
// A wavefront, not a straight-line distance: from the zone's centre —
// a town's MARK, or a townless zone's centroid — the value spreads only
// through the zone's OWN tiles, four ways at cost 2 and four diagonally at
// cost 3 (an integer stand-in for 2·√2). Everything starts at 10000, and
// tiles of other zones are walls, so a zone's arm that is walled off from
// its own centre never gets a value at all.
//
// AND THOSE TILES ARE THEN DISOWNED. The tail of the function writes −2 into
// the ZONE grid for every tile of the zone still reading 10000 — the tile
// stops belonging to anyone. Every later phase sees that, which is why this
// port mutates the grid it is given rather than returning a copy: the
// engine's own side effect is the point.
//
// The distance grid is one per FLOOR, shared by its zones (the first zone to
// arrive allocates and fills it) — safe, because zones do not overlap.

import { floorIterationOrder } from './zones.ts';

/** The unreachable value the grid starts at, and the disowned marker. */
export const UNREACHED = 10000;
export const DISOWNED = -2;

export interface DistToTownsZone {
  index: number;
  floor: number;
}

/** Four orthogonal steps at cost 2, then four diagonals at cost 3. */
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 2], [1, 0, 2], [0, 1, 2], [-1, 0, 2],
  [-1, -1, 3], [1, -1, 3], [1, 1, 3], [-1, 1, 3],
];

/**
 * @param floors the zone grids — MUTATED: unreachable tiles become −2
 * @param centres per zone index, the point the wave starts from (towns.ts)
 * @returns per floor, the distance grid
 */
export function fillDistToTowns(
  size: number,
  floors: Int32Array[][],
  zones: DistToTownsZone[],
  centres: Map<number, { a: number; b: number }>,
): Int32Array[][] {
  const grids: Int32Array[][] = [];

  for (let f = 0; f < floors.length; f++) {
    const grid = floors[f]!;
    const dist = Array.from({ length: size }, () => new Int32Array(size).fill(UNREACHED));
    grids.push(dist);

    for (const zone of floorIterationOrder(zones.filter((z) => z.floor === f))) {
      const centre = centres.get(zone.index);
      if (!centre) continue;
      const ca = Math.trunc(centre.a);
      const cb = Math.trunc(centre.b);

      // The zone's own tiles, in the collection order — the engine walks this
      // very list on every wave.
      const tiles: Array<[number, number]> = [];
      for (let b = 0; b < size; b++) {
        for (let a = 0; a < size; a++) if (grid[a]![b] === zone.index) tiles.push([a, b]);
      }
      if (!tiles.length) continue;

      for (let wave = 0; wave < 3 * size; wave++) {
        for (const [a, b] of tiles) {
          // Re-seeded every wave, exactly as the engine does it.
          if (a === ca && b === cb) dist[a]![b] = 0;
          if (dist[a]![b] !== wave) continue;
          for (const [da, db, cost] of STEPS) {
            const na = a + da;
            const nb = b + db;
            if (na < 0 || na >= size || nb < 0 || nb >= size) continue;
            if (grid[na]![nb] !== zone.index) continue;
            const value = dist[a]![b]! + cost;
            if (value < dist[na]![nb]!) dist[na]![nb] = value;
          }
        }
        if (tiles.every(([a, b]) => dist[a]![b] !== UNREACHED)) break;
      }

      // Whatever the wave could not reach stops being part of the zone.
      for (const [a, b] of tiles) if (dist[a]![b] === UNREACHED) grid[a]![b] = DISOWNED;
    }
  }

  return grids;
}

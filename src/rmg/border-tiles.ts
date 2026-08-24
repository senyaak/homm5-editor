// `CalcBorderTiles` — every tile learns how deep inside its zone it sits.
//
// Read from 0xEA90D0 in the unwrapped game executable (thiscall on
// CRandomMapGenerator, sole caller GenerateMap at 0xeab97f). The phase draws
// NOTHING — confirmed both by the traced run's counters (18459 on both sides
// of it) and by the reading: the only calls in its body are malloc and free.
//
// The table it fills is the floor's second grid (floor+0xE0, int32, arriving
// all -1 from the map-created step — which is also where the ZONE grid gets
// its initial -1, closing the hole fill-zones.ts had to assume). A tile's
// value is the TRUNCATED EUCLIDEAN distance to the nearest border tile OF
// ITS OWN ZONE on its own floor; border tiles themselves get 0. A border
// tile is an assigned tile with at least one of its four orthogonal
// neighbours off the map or in another zone (unassigned included). No
// wavefront, no cleverness: the engine gathers the floor's border tiles into
// a list and takes a brute-force minimum per tile, O(W*H*B).
//
// Everything the placement phases later see comes through this table — the
// readers filter zone tiles by thresholds like `dist > R/2` (the deep core)
// or `dist >= 1` (off the border) — so every truncation and every
// single-precision step below decides which tiles become candidates, and
// through them how many draws the placement phases spend. The differences,
// the squares, their sum and the running minimum are single precision
// (subss/mulss/addss/minss); the square root alone is double, rounded back;
// the final value is cvttss2si, truncation toward zero. A tile of zone -1
// matches no border tile and keeps the minimum's starting value, 10000.0f
// ([0xFAA664]) — none exist on the reference map, but the path is real.
//
// The engine checks neighbour bounds against the swapped dimension pair, the
// same square-safe quirk FillZones has — and the same refusal applies here.

const fl = Math.fround;
const FAR = fl(10000); // [0xFAA664] — where the minimum starts

/**
 * @param floors the zone grids exactly as fillZones left them:
 *               per floor, grid[a][b] = zone index or -1
 * @returns per floor: dist[a][b], int32 — 0 on borders, truncated Euclid
 *          elsewhere, 10000 where no own-zone border exists
 */
export function calcBorderTiles(width: number, height: number, floors: Int32Array[][]): Int32Array[][] {
  if (width !== height) throw new Error('calcBorderTiles: the engine is only ever run square — rectangle semantics unread');
  const size = width;

  return floors.map((grid) => {
    const dist = Array.from({ length: size }, () => new Int32Array(size).fill(-1));

    // Pass 1: mark the borders and remember them, scan order a outer / b
    // inner, neighbours probed +a, +b, -a, -b — a pure predicate, but kept
    // as written.
    const borders: Array<[number, number]> = [];
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        const z = grid[a]![b]!;
        if (z === -1) continue;
        const interior =
          a + 1 < size && grid[a + 1]![b] === z
          && b + 1 < size && grid[a]![b + 1] === z
          && a - 1 >= 0 && grid[a - 1]![b] === z
          && b - 1 >= 0 && grid[a]![b - 1] === z;
        if (!interior) {
          dist[a]![b] = 0;
          borders.push([a, b]);
        }
      }
    }

    // Pass 2: brute-force minimum over the same-zone borders.
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        if (dist[a]![b] === 0) continue;
        const z = grid[a]![b]!;
        let m = FAR;
        for (const [bx, by] of borders) {
          if (grid[bx]![by] !== z) continue;
          const dx = fl(a - bx);
          const dy = fl(b - by);
          const d = fl(Math.sqrt(fl(fl(dx * dx) + fl(dy * dy))));
          if (d < m) m = d; // minss
        }
        // The engine guards the write on the ORIGINAL -1 — with the grid
        // arriving freshly filled that is every non-border tile.
        if (dist[a]![b] === -1) dist[a]![b] = Math.trunc(m);
      }
    }

    return dist;
  });
}

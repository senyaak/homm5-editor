// What a tile does to a hero who walks onto it.
//
// One rule, in one place, because two things ask it: the passability wash in
// the viewport (renderer/viewport/overlays.ts) and the reachability check
// (src/map/reach.ts, run in the main process). A view that disagreed with the
// check would be worse than either alone — you would look at open ground and be
// told nobody can get there.
//
// Blocking is a UNION, not just the mask. The mask records what a designer
// decided by hand, and on a map where nobody opened the Masks tab it is empty —
// Senya's map 12 has the plane at all ones despite being full of rivers and
// cliffs. The rest is inherent to the terrain and the engine derives it:
//
//   * the river plane — you do not wade a river, which is why bog and lava
//     flows stop you without anyone marking them,
//   * a step too tall to climb, i.e. a cut face between plateau and ground.
//
// Navigable (sea) is a third answer rather than "blocked": a boat crosses it,
// and the format says so with the ground flag rather than the mask. Whoever is
// asking has to decide what that means for them — for a hero on foot it is not
// walkable, for the wash it is its own colour.

/** How a tile reads for movement. */
export const PASS_WALK = 0, PASS_BLOCKED = 1, PASS_NAVIGABLE = 2;

/**
 * A drop across one tile that a unit cannot climb.
 *
 * Every cell straddling a ground-kind boundary carries a step of 0.8 or more
 * (200 of 200 on map 12, 216 of 216 on A1M5), which is the mesher's own signal
 * for cutting a vertical face — so anything at or above it is a cliff edge.
 * Ordinary slopes inside one kind stay well under.
 */
export const CLIFF_STEP = 0.8;

/** One floor's planes, as either side of the app happens to hold them. */
export interface FloorPassability {
  /** Vertices per side; the tile grid is (V-1)². */
  V: number;
  heights: ArrayLike<number>;
  /** Per-vertex ground kind, or null when the terrain carries none. */
  flags: ArrayLike<number> | null;
  /** The explicit mask: 0 blocked, 1 walkable. Null when the map has none. */
  passable: ArrayLike<number> | null;
  /** Is this vertex a river bed? The bed only, never the feathered rim. */
  river: (vertex: number) => boolean;
}

/**
 * Classify every tile of a floor. Index = y*(V-1) + x.
 *
 * The passability plane is stored vertex-sized but addressed PER TILE — entry
 * (x, y) is tile (x, y), last row and column filler. Reading it as four corners
 * made a 1x1 mask stroke show up as 3x3.
 */
export function classifyTiles(fl: FloorPassability): Uint8Array {
  const V = fl.V, T = V - 1;
  const out = new Uint8Array(T * T); // zero-filled, and PASS_WALK is 0
  const water = (v: number): boolean => (fl.flags ? fl.flags[v] === 0 : false);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const a = y * V + x, b = a + 1, c = a + V, d = c + 1;
    // Sea first: it is crossed by boat, so it is neither walkable nor blocked.
    if (water(a) && water(b) && water(c) && water(d)) { out[y * T + x] = PASS_NAVIGABLE; continue; }

    if (fl.passable && fl.passable[a] === 0) { out[y * T + x] = PASS_BLOCKED; continue; }
    if (fl.river(a) || fl.river(b) || fl.river(c) || fl.river(d)) {
      out[y * T + x] = PASS_BLOCKED; continue;
    }
    // A ramp is a deliberate walkable incline, and its half-step of 1.0 is taller
    // than the cliff threshold — so the slope rule would mark the one thing on
    // the map built to be climbed. The mesher skips ramp cells for the same
    // reason; this has to agree with it or the view contradicts the geometry.
    const ramp = fl.flags
      ? ((fl.flags[a]! | fl.flags[b]! | fl.flags[c]! | fl.flags[d]!) & 8) !== 0
      : false;
    if (ramp) continue;
    const h = [fl.heights[a]!, fl.heights[b]!, fl.heights[c]!, fl.heights[d]!];
    if (Math.max(...h) - Math.min(...h) > CLIFF_STEP) out[y * T + x] = PASS_BLOCKED;
  }
  return out;
}

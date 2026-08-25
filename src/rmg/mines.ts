// The mines step of MainObjects — the candidate machinery, from 0xEB5C50.
//
// This is the part of the step that decides WHERE a mine can go; the full
// step composes it with the guard (armies.ts) and the resource piles. It is
// held to the traced run four ways: the first mine of every zone lands on the
// reference map's tile from the recorded draw (test-rmg-mines), and the
// reading of each rule is in docs/RMG.md with the addresses.
//
// The shape, per zone, once — before the loop over mine types:
//
//   candidates: every tile of the zone with border distance ABOVE 1,
//     scanned map-x outer, map-y inner. A zone with a town keeps two rings
//     around it — near (Mine1Level radii) for types 0-1, far (Mine2Level) for
//     types 2 and up, both bounds strict; a zone without one puts every tile
//     in both lists.
//
// And per mine:
//
//   room     = per tile, trunc of the Euclidean distance to the nearest
//              point the zone has stamped (its +0x68 list: the town's active
//              tiles and marker, a dug passage's mouth on the digger's side
//              and the adopted tile on the neighbour's, and each placed
//              mine's own footprint as the step goes)
//   max      = the room's maximum over the candidates that sit in the zone
//              with border distance above 2 and occupancy other than 2
//   keep     room > trunc(2 * max / 5), strictly — the ONLY filter
//   the pick below(kept.length), then below(4) for the rotation quadrant
//
// The engine computes the distances in single precision and this port in
// double; every measured draw lands regardless, and if a future template
// diverges by exactly one tile at a threshold boundary, this is the first
// place to look.

export type Tile = readonly [number, number];

export interface MineListsInput {
  size: number;
  /** The floor's zone grid, `[a][b]` with `b` the map x. */
  grid: Int32Array[];
  /** The distance-to-border table, as the phases before this one left it. */
  border: Int32Array[];
  zoneIndex: number;
  /** Rings are measured from here — the TOWN (zone+0x0C, written by PlaceTowns). */
  town: { x: number; y: number } | null;
  nearMin: number;
  nearMax: number;
  farMin: number;
  farMax: number;
}

export interface MineLists {
  /** Types 0-1: Sawmill, Ore_Pit. */
  near: Tile[];
  /** Types 2 and up: the rarer mines, and the Gold_Mine. */
  far: Tile[];
}

/** The once-per-zone gather — 0xEB5C72..0xEB601A. */
export function mineLists(input: MineListsInput): MineLists {
  const { size, grid, border, zoneIndex, town } = input;
  const near: Tile[] = [];
  const far: Tile[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      if (border[y]![x]! <= 1) continue;
      if (!town) {
        // No town yet: no rings, every tile of the zone in both lists.
        near.push([x, y]);
        far.push([x, y]);
        continue;
      }
      const d = Math.hypot(town.x - x, town.y - y);
      if (input.farMax > d && d > input.farMin) far.push([x, y]);
      if (input.nearMax > d && d > input.nearMin) near.push([x, y]);
    }
  }
  return { near, far };
}

/**
 * The room grid — 0xEC28E0 with mask 4: per tile of the zone, the truncated
 * distance to the nearest stamped point.
 *
 * With NO points the engine's answer is stale xmm0 — the conversion reads the
 * register, and nothing wrote it for this tile (docs/RMG.md). That path is
 * unmeasured: every zone of the reference run has at least one point by the
 * time mines are placed. This port answers 10000 — the engine's own "min
 * never beaten" start — which keeps every candidate, and says so here so the
 * divergence is findable if a template ever reaches it.
 */
export function roomGrid(size: number, grid: Int32Array[], zoneIndex: number, points: Tile[]): Int32Array[] {
  const out = Array.from({ length: size }, () => new Int32Array(size).fill(-1));
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (grid[y]![x] !== zoneIndex) continue;
      let m = 10000;
      for (const [px, py] of points) {
        const d = Math.hypot(px - x, py - y);
        if (d < m) m = d;
      }
      out[y]![x] = Math.trunc(m);
    }
  }
  return out;
}

export interface RoomFilterResult {
  kept: Tile[];
  /** 0xEC2EB0's answer — the room's maximum over the qualifying candidates. */
  max: number;
  /** `trunc(2 * max / 5)` — signed, so 0 when nothing qualifies. */
  threshold: number;
}

/**
 * The per-mine filter — 0xEB60B7..0xEB61C6. The zone, border and occupancy
 * tests decide what counts toward the MAXIMUM (0xEC2EB0); the survival test
 * is the room against the threshold and nothing else. The kept list is built
 * fresh from the original each time, so a candidate struck out by a failed
 * fit earlier is back for the next mine.
 */
export function filterByRoom(
  candidates: Tile[],
  room: Int32Array[],
  grid: Int32Array[],
  border: Int32Array[],
  occupancy: Uint8Array,
  size: number,
  zoneIndex: number,
): RoomFilterResult {
  let max = 0;
  for (const [x, y] of candidates) {
    if (grid[y]![x] !== zoneIndex) continue;
    if (border[y]![x]! <= 2) continue;
    if (occupancy[y * size + x] === 2) continue;
    const r = room[y]![x]!;
    if (r > max) max = r;
  }
  const threshold = Math.trunc((2 * max) / 5);
  return { kept: candidates.filter(([x, y]) => room[y]![x]! > threshold), max, threshold };
}

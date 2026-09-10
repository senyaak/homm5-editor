// The obelisks, and the Graal — what the dialog's GRAIL checkbox adds.
//
// The checkbox is `request+0xA5`, which reaches the generator as `+0xB5`, and
// the MainObjects orchestrator reads it TWICE:
//
//   `0xEA3FB4`  the phase's prologue draw. With the grail on it is
//               `below(zoneCount)` — the zone the Graal goes into, taken from
//               the zone vector's own element count — and with it off a bare
//               `next()` whose result nothing reads. That draw had been in the
//               port from the start, spent and unexplained; this is what it is.
//
//   `0xEA463B`  inside the zone loop, straight after the DWELLINGS step (its
//               draws land under the "upgrade buildings" boundary in the step
//               log, which is the next one the engine prints): if this zone is
//               the drawn one, `0xEC00F0` puts the Graal in it, and then EVERY
//               zone gets its obelisks through `0xEBFFC0`.
//
// HOW MANY OBELISKS. `0xEA4652..0xEA468E` computes it: a per-size number — 10
// at size index 0, 18 at index 1, 26 at anything larger — times the zone's own
// tile count, divided by the map's tile AREA, `inc`remented once by the caller
// and once more by the callee's `lea ebp,[eax+1]`. So it is
// `trunc(zoneTiles * N / (dim * dim)) + 2`, and the loop body runs exactly that
// many times whether or not a placement lands. On the measured map (a
// seven-zone medium, so N = 26) the seven zones come to 5+5+5+5+5+5+8 = 38,
// which is the number of obelisks in the archive.
//
// WHERE EACH ONE GOES (`0xEBFCF0` per obelisk, `0xEC1500` for its candidates):
// the room grid is recomputed with mask 4 — the zone's actives alone — the
// maximum is taken the way every other worker takes it, and a zone tile is a
// candidate when `room > trunc(2 * max / 3)` AND `border >= 1`. That border
// test is the worker's own: `filterByRoom` keeps the room test only, and its
// `border > 2` belongs to the maximum. Then at most ONE HUNDRED attempts
// (`cmp ebx,64h`), each `below(candidates)` for the tile and `below(4)` for the
// quadrant, a refusal striking the candidate and drawing again — the shared
// attempt loop, with a cap the others do not have.
//
// THE GRAAL ITSELF is one artifact from the parameters' `Grail` href
// (`/MapObjects/Artifacts/Graal.(AdvMapArtifactShared).xdb`), placed in the
// drawn zone before its obelisks.

import { mintName } from './armies.ts';
import type { DrawSource } from './armies.ts';
import { fits, recomputeRoom, stampFootprint } from './placement.ts';
import type { Footprint, Tile } from './placement.ts';

/** `0xEA4655..0xEA466B` — the per-size numerator, by MapSize INDEX. */
export function obeliskNumerator(sizeIndex: number): number {
  if (sizeIndex === 0) return 10;
  if (sizeIndex === 1) return 18;
  return 26;
}

/**
 * How many times the obelisk loop runs for one zone — `+2`, and both increments
 * are in the code: the caller's `inc eax` and the callee's `lea ebp,[eax+1]`.
 */
export function obeliskCount(zoneTiles: number, sizeIndex: number, size: number): number {
  return Math.trunc((zoneTiles * obeliskNumerator(sizeIndex)) / (size * size)) + 2;
}

export interface ObeliskInput {
  size: number;
  /** The MapSize index the order named — the numerator's only input. */
  sizeIndex: number;
  grid: Int32Array[];
  border: Int32Array[];
  /** MUTATED: each obelisk stamps its footprint. */
  occupancy: Int32Array;
  /** MUTATED: the level's room grid — this pass recomputes it itself. */
  room: Int32Array[];
  /** MUTATED: stamped actives join the zone's points. */
  points: Tile[];
  zoneIndex: number;
  /** The zone's floor — the fit's five-tile margin below. */
  floor: number;
  /** The zone's own tile list, in `+0xCC` order. */
  tiles: readonly Tile[];
  /** The parameters' `Obelisk` footprint. */
  obelisk: Footprint;
}

export interface PlacedObelisk {
  name: string;
  x: number;
  y: number;
  /** Radians — the drawn quadrant times pi/2. */
  angle: number;
  actives: Tile[];
}

/** `0xEC1500` — the candidates, and the two tests that keep one. */
export function obeliskCandidates(input: ObeliskInput): Tile[] {
  const { grid, border, occupancy, room, size, zoneIndex } = input;
  // `0xEC153A`: `recomputeRoom(mask 4, all = 0)` — the zone's ACTIVES alone,
  // and inside the builder, so every obelisk filters on a grid that carries the
  // last one's stamp. Leaving it out is what made the first candidate list 285
  // where the engine's was 418.
  recomputeRoom(room, size, grid, zoneIndex, [...input.points]);
  let max = 0;
  for (const [x, y] of input.tiles) {
    if (grid[y]![x] !== zoneIndex) continue;
    if (border[y]![x]! <= 2) continue;
    if (occupancy[y * size + x] === 2) continue;
    const r = room[y]![x]!;
    if (r > max) max = r;
  }
  const threshold = Math.trunc((2 * max) / 3);
  const kept: Tile[] = [];
  for (const [x, y] of input.tiles) {
    if (room[y]![x]! <= threshold) continue;
    if (border[y]![x]! < 1) continue;
    kept.push([x, y]);
  }
  return kept;
}

/** `0xEBFFC0` — the whole per-zone pass, obelisk after obelisk. */
export function placeZoneObelisks(input: ObeliskInput, rng: DrawSource & { below(n: number): number }): PlacedObelisk[] {
  const placed: PlacedObelisk[] = [];
  const rounds = obeliskCount(input.tiles.length, input.sizeIndex, input.size);
  const ctx = {
    size: input.size, grid: input.grid, border: input.border,
    occupancy: input.occupancy, zoneIndex: input.zoneIndex, floor: input.floor,
  };
  for (let round = 0; round < rounds; round++) {
    // The list is rebuilt for EVERY obelisk — `0xEBFD35` calls the builder
    // inside the loop, so each one sees the last one's stamp.
    const pool = obeliskCandidates(input);
    let hit: { tile: Tile; q: number } | null = null;
    for (let attempt = 0; attempt < 100 && pool.length; attempt++) {
      const pick = rng.below(pool.length);
      const q = rng.below(4);
      const tile = pool[pick]!;
      if (fits(ctx, input.obelisk, tile, q)) { hit = { tile, q }; break; }
      pool.splice(pick, 1);
    }
    if (!hit) continue;
    const name = mintName(rng);
    const actives = stampFootprint(
      { size: input.size, occupancy: input.occupancy, points: input.points },
      input.obelisk, hit.tile, hit.q,
    );
    placed.push({ name, x: hit.tile[0], y: hit.tile[1], angle: hit.q * (Math.PI / 2), actives });
  }
  return placed;
}

/**
 * `0xEC00F0` — the Graal, one artifact in the drawn zone. It calls the SAME
 * candidate builder as the obelisks (`0xEC0240` -> `0xEC1500`), so the filter,
 * the recompute and the hundred attempts are the obelisks' own; only the
 * footprint and the count differ.
 *
 * WHERE IT SITS in the zone: the code places it BEFORE that zone's obelisks
 * (`0xEA464D` precedes `0xEA468E`), and the draw stream cannot tell the two
 * orders apart — both builders answer the same list at that moment, so a run of
 * six placements reads the same whichever end the Graal is at. The code is what
 * this follows; the archive's object ORDER is what would settle it, and it is
 * checked in `tools/test-rmg-obelisks.ts`.
 */
export function placeZoneGraal(
  input: ObeliskInput & { graal: Footprint },
  rng: DrawSource & { below(n: number): number },
): PlacedObelisk | null {
  const ctx = {
    size: input.size, grid: input.grid, border: input.border,
    occupancy: input.occupancy, zoneIndex: input.zoneIndex, floor: input.floor,
  };
  const pool = obeliskCandidates(input);
  for (let attempt = 0; attempt < 100 && pool.length; attempt++) {
    const pick = rng.below(pool.length);
    const q = rng.below(4);
    const tile = pool[pick]!;
    if (fits(ctx, input.graal, tile, q)) {
      const name = mintName(rng);
      // ITS OWN STAMP, by hand — `0xEC03F5` pushes the tile into the zone's
      // `+0x68` points and `0xEC0425` writes occupancy 4 for it. The shared
      // document's blocked, active, hole and passable lists are ALL empty, so
      // the ordinary footprint stamp would write nothing at all — and then the
      // room recompute the next obelisk runs would answer the same candidate
      // list twice, where the engine's grows from 259 to 294.
      input.occupancy[tile[1] * input.size + tile[0]] = 4;
      input.points.push([tile[0], tile[1]]);
      return { name, x: tile[0], y: tile[1], angle: q * (Math.PI / 2), actives: [[tile[0], tile[1]]] };
    }
    pool.splice(pick, 1);
  }
  return null;
}

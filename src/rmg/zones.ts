// `GenerateGameZones` — the phase that gives every zone a start point and a
// radius. The blobs begin here: FillZones later grows each zone outward from
// the point this phase picked.
//
// Read from 0xEA2760 in the unwrapped game executable (thiscall on
// CRandomMapGenerator; the only caller is GenerateMap at 0xeab86d). The
// reading reconciles against reference run 1 exactly: 176x176, one floor, one
// pass — predicted 1234 draws, the oracle counted 1234. See docs/RMG.md.
//
// The shape of it:
//
//   points = tiles/100 random candidates, drawn ONCE          2n draws
//   retry:
//     shuffle the points (Fisher-Yates)                       n-1 draws
//     recompute every zone's radius from k (k starts at 0.9)
//     for each floor:
//       shuffle again — even for an empty floor               n-1 draws each
//       for each zone: take the first point that fits
//     k *= 0.97; if any zone failed, retry
//
// So the budget is 2n + P*(n-1)*(1+F) for P passes over F floors, and a
// failed placement costs no draws at all — the point scan never touches the
// stream. Only `below` is called; `betweenFloat` is NOT here (it is in
// FillZones), and the `k == %2.2f` the engine logs is this constant 0.9
// decayed by 3% per pass, not a drawn number.
//
// A point fits when it keeps R tiles from the map border (equality passes —
// the rejections are strict) and does not overlap a zone ALREADY PLACED THIS
// PASS ON THE SAME FLOOR. That narrow condition is the engine's own, twice
// over: the overlap scan walks every floor but stops at the zone itself, so
// same-floor successors are never seen; and a cross-floor pair cannot fail
// because failing requires the floor indices to match. Different floors may
// overlap freely, and the uninitialised coordinates the engine reads off
// not-yet-placed zones on other floors are provably harmless — this port
// simply does not read them.
//
// Zone order is the engine's hash_map order, modelled in floorIterationOrder
// below. Single precision is marked with fround exactly where the code says
// `ss`; the square roots and the /3.0 are genuinely double.

import type { RmgRandom } from './random.ts';

/** A zone as LoadTemplate leaves it: index, template Size, floor. */
export interface ZoneSeed {
  index: number;
  /** The template's `Size` — relative weight, not tiles (zone+0x144). */
  size: number;
  /** Which floor holds the zone (zone+0xF4). */
  floor: number;
}

export interface PlacedZone extends ZoneSeed {
  /** Start point, float32 — whole numbers here, drawn as below(W)/below(H). */
  x: number;
  y: number;
  /** Radius in tiles, truncated to int (zone+0x140). */
  r: number;
}

export interface GeneratedZones {
  /** Every zone, placed, in engine iteration order (floors, then hash order). */
  zones: PlacedZone[];
  /** Full passes spent; 1 means nothing ever failed to fit. */
  passes: number;
  /** k as the LAST pass used it: fround(0.9) decayed by fround(0.97) each retry. */
  k: number;
}

/**
 * The order a floor's hash_map yields its zones in.
 *
 * The container is an STLPort-style hash_map: bucket = index % bucketCount,
 * insertion at the HEAD of a bucket, iteration buckets ascending. It starts
 * at 13 buckets and rehashes when an insert would push the count past the
 * bucket count — so the fourteenth zone grows it to 29, the thirtieth to 53
 * (the prime table at 0xF49470). Zones come in here in template file order,
 * the order LoadTemplate inserts them.
 *
 * This order is load-bearing and not the obvious one: indices in shipped
 * templates reach 15, so on a small table zone 14 sits in bucket 1 and
 * iterates before zone 2 — but a template big enough to rehash holds its
 * zones in a 29-bucket table where indices up to 28 stop colliding at all.
 *
 * The one path this refuses: a collision in a table that has been rehashed.
 * Within-bucket order there depends on the order the rehash re-inserted the
 * old elements, which has not been read out of the executable — and no
 * shipped template reaches it (the suite checks). A named hole, not a guess.
 */
export function floorIterationOrder<T extends { index: number }>(seeds: T[]): T[] {
  const bucketCount = [13, 29, 53].find((p) => seeds.length <= p);
  if (!bucketCount) throw new Error('floorIterationOrder: >53 zones — grow the prime table when something needs it');
  const rehashed = seeds.length > 13;
  const buckets: T[][] = Array.from({ length: bucketCount }, () => []);
  for (const s of seeds) {
    const bucket = buckets[s.index % bucketCount]!;
    if (rehashed && bucket.length) {
      throw new Error('floorIterationOrder: bucket collision after a rehash — within-bucket order unverified');
    }
    bucket.unshift(s);
  }
  return buckets.flat();
}

const fl = Math.fround;
const K_START = fl(0.9); // [0xF4DD60]
const K_DECAY = fl(0.97); // [0xFE1DC4]
const SQRT2 = fl(1.41421354); // the constant as the executable spells it

/**
 * One zone's radius for the pass: the multiplies and the divide in single
 * precision, the square root and the /3.0 genuinely double, truncated to int.
 * With `twoFloors` the result stretches by the executable's own sqrt(2).
 */
export function zoneRadius(tiles: number, size: number, sizeSum: number, k: number, twoFloors: boolean): number {
  const scale = fl(tiles * k);
  let r = Math.trunc(Math.sqrt(fl(fl(size * scale) / sizeSum)) / 3.0);
  if (twoFloors) r = Math.trunc(fl(r * SQRT2));
  return r;
}

/**
 * @param zones     every zone of the template in the order LoadTemplate made
 *                  them — ascending Index, which is also the hash insertion
 *                  order. (The engine's sizeSum walks the template FILE
 *                  instead, but integer sizes sum exactly in float32, so the
 *                  order cannot change the number.)
 * @param twoFloors the byte at generator+0x1D — CreateMap's underground coin.
 *                  Radii stretch by sqrt(2), and the floor count IS this bit
 *                  plus one: the map-created step resizes the floor vector to
 *                  exactly 1 + gen[0x1D] elements (0xE9FFC0). An empty second
 *                  floor still costs a shuffle per pass.
 */
export function generateGameZones(
  width: number,
  height: number,
  zones: ZoneSeed[],
  twoFloors: boolean,
  rng: RmgRandom,
): GeneratedZones {
  const floorCount = twoFloors ? 2 : 1;
  const tiles = width * height;

  // Accumulated in FLOAT, element order and all — an int sum would be exact
  // where the engine's is rounded.
  let sizeSum = 0;
  for (const z of zones) sizeSum = fl(sizeSum + fl(z.size));

  // The candidate points, drawn once. below(W) feeds x, below(H) feeds y.
  const n = Math.trunc(tiles / 100);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    points.push({ x: fl(rng.below(width)), y: fl(rng.below(height)) });
  }

  const floors: ZoneSeed[][] = Array.from({ length: floorCount }, () => []);
  for (const z of zones) floors[z.floor]!.push(z);
  const ordered = floors.map(floorIterationOrder);

  const shuffle = (): void => {
    for (let i = 1; i < n; i++) {
      const j = rng.below(i + 1);
      const t = points[i]!;
      points[i] = points[j]!;
      points[j] = t;
    }
  };

  let k = K_START;
  let passes = 0;
  const out: PlacedZone[] = [];

  for (;;) {
    passes++;
    shuffle();

    const r = new Map<ZoneSeed, number>();
    for (const floor of ordered) for (const z of floor) r.set(z, zoneRadius(tiles, z.size, sizeSum, k, twoFloors));

    out.length = 0;
    let allPlaced = true;
    for (const floor of ordered) {
      shuffle(); // unconditional — drawn even when the floor is empty or a zone already failed
      // Zones already placed THIS pass on THIS floor — the only ones the
      // engine's overlap scan can actually reach (see the header).
      const placedHere: PlacedZone[] = [];
      for (const z of floor) {
        if (!allPlaced) continue; // after one failure the rest are not even tried
        const zr = r.get(z)!;
        let placed: PlacedZone | null = null;
        for (const p of points) {
          if (p.x < zr || p.x > width - zr) continue; // strict: sitting ON the ring passes
          if (p.y < zr || p.y > height - zr) continue;
          let ok = true;
          for (const other of placedHere) {
            const dx = fl(other.x - p.x);
            const dy = fl(other.y - p.y);
            const d = fl(Math.sqrt(fl(fl(dx * dx) + fl(dy * dy))));
            if (other.r + zr > d) { ok = false; break; }
          }
          if (ok) { placed = { ...z, x: p.x, y: p.y, r: zr }; break; }
        }
        if (placed) { placedHere.push(placed); out.push(placed); } else allPlaced = false;
      }
    }

    const kUsed = k;
    k = fl(k * K_DECAY); // decays whether or not the pass succeeded
    if (allPlaced) return { zones: out, passes, k: kUsed };
  }
}

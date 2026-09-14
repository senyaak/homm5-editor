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

import { DOUBLES } from './arith.ts';
import type { Arith } from './arith.ts';
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
 * The container the engine keeps these collections in, and the order it yields
 * them in.
 *
 * It is an STLPort-style hash_map: bucket = key % bucketCount, insertion at the
 * HEAD of a bucket, iteration buckets ascending. It starts at 13 buckets and
 * rehashes when an insert would push the count past the bucket count — so the
 * fourteenth key grows it to 29, the thirtieth to 53 (the prime table at
 * 0xF49470).
 *
 * This order is load-bearing and not the obvious one: indices in shipped
 * templates reach 15, so on a small table zone 14 sits in bucket 1 and iterates
 * before zone 2 — while a collection big enough to rehash holds its keys in a
 * 29-bucket table where indices up to 28 stop colliding at all and the order is
 * plain ascending again.
 *
 * The rehash is read, not assumed (the floor's zone insert is `0xEB0CB0`,
 * called from LoadTemplate at 0xEA26A3; FillZones' two containers inline the
 * same template at 0xEA8DE1 and 0xEAA0EB): `insert_unique` first grows the
 * table when `count + 1 > buckets` — `next_size(count + 1)` at 0x4E3D30 is a
 * lower bound over the prime table — and moves the old nodes by walking the
 * OLD buckets ascending, each chain from its head, hanging every node on the
 * HEAD of its new bucket:
 *
 *     0xeb0d12  mov eax,[ecx+4]          ; node->key
 *     0xeb0d17  div dword ptr [esp+14h]  ; % new bucket count
 *     0xeb0d1b  mov eax,[ecx]            ; old[i] = node->next
 *     0xeb0d1d  mov [esi],eax
 *     0xeb0d1f  mov eax,[ebp+edx*4]      ; node->next = new[b]
 *     0xeb0d23  mov [ecx],eax
 *     0xeb0d25  mov [ebp+edx*4],ecx      ; new[b] = node
 *
 * then the new key goes to the head of its bucket (0xEB0DDE / 0xEB0DE3). So a
 * bucket that collides after a rehash holds the moved keys in REVERSE of the
 * order the old table yielded them, and anything inserted later in front.
 * Growing the table live, exactly like this, is the only way to get that
 * right — laying the final table out in one pass is not.
 */
const HASH_PRIMES = [13, 29, 53] as const;

export function hashMapOrder<T>(items: readonly T[], keyOf: (item: T) => number, what: string): T[] {
  // The engine's hash takes the key as size_t, so a negative index wraps:
  // the water carve's -1 (sea) hashes as 0xFFFFFFFF and lands in bucket 8
  // of 13. Non-negative keys are untouched by the >>> 0.
  const slot = (item: T, bucketCount: number): number => (keyOf(item) >>> 0) % bucketCount;
  let buckets: T[][] = Array.from({ length: HASH_PRIMES[0] }, () => []);
  let count = 0;
  for (const item of items) {
    if (count + 1 > buckets.length) {
      const grownTo = HASH_PRIMES.find((p) => p >= count + 1);
      if (!grownTo) throw new Error(`${what}: over ${HASH_PRIMES[HASH_PRIMES.length - 1]} keys — grow the prime table when something needs it`);
      const grown: T[][] = Array.from({ length: grownTo }, () => []);
      // Old buckets ascending, each chain head first, each node to the new head.
      for (const chain of buckets) for (const node of chain) grown[slot(node, grownTo)]!.unshift(node);
      buckets = grown;
    }
    buckets[slot(item, buckets.length)]!.unshift(item);
    count++;
  }
  return buckets.flat();
}

/**
 * The order a floor's hash_map yields its zones in. Zones come in here in
 * template file order, the order LoadTemplate inserts them.
 */
export function floorIterationOrder<T extends { index: number }>(seeds: T[]): T[] {
  return hashMapOrder(seeds, (s) => s.index, 'floorIterationOrder');
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
export function zoneRadius(
  tiles: number, size: number, sizeSum: number, k: number, twoFloors: boolean,
  ar: Arith = DOUBLES,
): number {
  const scale = ar.store(ar.mul(tiles, k));
  let r = Math.trunc(ar.div(ar.sqrt(ar.store(ar.div(ar.store(ar.mul(size, scale)), sizeSum))), 3.0));
  if (twoFloors) r = Math.trunc(ar.store(ar.mul(r, SQRT2)));
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
  ar: Arith = DOUBLES,
  // WHICH DRAW IS WHICH AXIS. The two builds disagree, and it is visible in
  // their own dumps: on one order and one seed, all eight zone centres come out
  // of the game TRANSPOSED against the editor's — (49,118) where the editor has
  // (118,49), zone for zone, with the same ids, the same radii and the same
  // sizes. The draws are the same numbers in the same sequence; only which of
  // the two coordinates each lands in differs. That is C++ leaving the
  // evaluation order of two arguments unspecified and two builds taking it two
  // ways, and it is the whole reason the same order gives two different maps.
  swapAxes = false,
): GeneratedZones {
  const floorCount = twoFloors ? 2 : 1;
  const tiles = width * height;

  // Accumulated in FLOAT, element order and all — an int sum would be exact
  // where the engine's is rounded.
  let sizeSum = 0;
  for (const z of zones) sizeSum = ar.store(ar.add(sizeSum, ar.store(z.size)));

  // The candidate points, drawn once. below(W) feeds x, below(H) feeds y.
  const n = Math.trunc(tiles / 100);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const first = fl(rng.below(width));
    const second = fl(rng.below(height));
    points.push(swapAxes ? { x: second, y: first } : { x: first, y: second });
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
    for (const floor of ordered) for (const z of floor) r.set(z, zoneRadius(tiles, z.size, sizeSum, k, twoFloors, ar));

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
            const dx = ar.store(ar.sub(other.x, p.x));
            const dy = ar.store(ar.sub(other.y, p.y));
            const d = ar.store(ar.sqrt(ar.store(ar.add(ar.store(ar.mul(dx, dx)), ar.store(ar.mul(dy, dy))))));
            if (other.r + zr > d) { ok = false; break; }
          }
          if (ok) { placed = { ...z, x: p.x, y: p.y, r: zr }; break; }
        }
        if (placed) { placedHere.push(placed); out.push(placed); } else allPlaced = false;
      }
    }

    const kUsed = k;
    k = ar.store(ar.mul(k, K_DECAY)); // decays whether or not the pass succeeded
    if (allPlaced) return { zones: out, passes, k: kUsed };
  }
}

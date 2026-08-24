// `FillZones` — every tile gets a zone, and the blobs get their shape.
//
// Read from 0xEA94C0 in the unwrapped game executable (thiscall on
// CRandomMapGenerator, sole caller GenerateMap at 0xeab8f6). Reference run 1
// says the phase spent 106,717 draws on a 176x176 map; the structural half of
// that reconciles exactly — 305 sweeps at two coin flips each — and the rest
// is the border jitter below, which only a lockstep run can confirm.
//
// Three steps decide a tile's owner:
//
//   1. PAINT (no draws): a tile strictly inside a zone's circle — distance
//      from the TRUNCATED start point, single precision — belongs to the
//      first such zone in the floor's hash order. Everything else is -1.
//   2. GROW (no draws): an unassigned tile joins the zone that owns >= 3 of
//      its 8 neighbours — the majority rule that eats the gaps between blobs.
//   3. JITTER (the draws): an assigned tile deep enough in the map (6 tiles
//      from the border, no unassigned neighbour) flips to a neighbouring zone
//      owning >= 3 neighbours with probability ~0.6 (betweenFloat(0,1) drawn,
//      kept when > 0.4f) — but only while that zone is UNDER QUOTA:
//      sizeOther/sizeOwn > countOther/countOwn, both divisions single
//      precision. Areas converge to the template's proportions; borders
//      stay ragged.
//
// A sweep scans the whole grid with a drawn direction per axis (two below(2)
// per sweep, per floor — even a zone-less floor pays them), queues every
// decision, applies them all at once, then rebuilds each zone's tile list.
// The tile counts the jitter reads are therefore a SNAPSHOT of the previous
// sweep's end — and on the first sweep they are zero, so the ratio test
// computes NaN or infinity and refuses without drawing: sweep one costs
// exactly the two coins. The sweep count is fixed up front:
// while fl(fl(width) * 1.7320508f) > counter.
//
// Tie-breaks are the engine's hash containers, modelled exactly: 13 buckets,
// bucket = key % 13 unsigned (so -1 lands in bucket 8), head insertion,
// buckets iterated ascending, and the first strict maximum in that order
// wins. The engine also checks the 6-tile margin against the SWAPPED
// dimension pair (map+0xC vs +0x10) — indistinguishable on the square maps
// the generator makes, and this port refuses rectangles rather than guess
// which reading is faithful (see fillZones).

import type { RmgRandom } from './random.ts';
import type { PlacedZone } from './zones.ts';

const fl = Math.fround;
const SQRT3 = fl(1.7320508); // [0xF4D5D8]
const KEEP_ABOVE = fl(0.4); // [0xF5E500] — the jitter keeps a draw above this

/** Neighbour offsets in the engine's own order (table 0x1093870). */
const NBR: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1],
];

/**
 * The engine's per-tile counter: an STLPort hash_map keyed by zone index.
 * Which zone "has the most neighbours" depends on this container's iteration
 * order, so it is modelled rather than replaced with a plain max.
 */
class HashCounts {
  private buckets: Array<Array<{ key: number; count: number }>> = Array.from({ length: 13 }, () => []);
  private keys = 0;

  add(key: number): void {
    const bucket = this.buckets[(key >>> 0) % 13]!;
    const hit = bucket.find((e) => e.key === key);
    if (hit) hit.count++;
    else {
      bucket.unshift({ key, count: 1 });
      this.keys++;
    }
  }

  get size(): number { return this.keys; }

  has(key: number): boolean {
    return this.buckets[(key >>> 0) % 13]!.some((e) => e.key === key);
  }

  /** The first strict maximum in iteration order, never key -1. */
  best(): { key: number; count: number } | null {
    let best: { key: number; count: number } | null = null;
    for (const bucket of this.buckets) {
      for (const e of bucket) {
        if (e.key === -1) continue;
        if (!best || e.count > best.count) best = e;
      }
    }
    return best;
  }
}

/**
 * The deferred-decision queues (map1/map2): zone index -> tiles to repaint,
 * applied in the container's iteration order. Same 13 buckets, same head
 * insertion — and the same refusal as floorIterationOrder: a fourteenth
 * distinct zone would rehash, and post-rehash order is an unread path no
 * shipped template can reach (a floor holds at most 12 zones).
 */
class HashQueue {
  private buckets: Array<Array<{ key: number; points: Array<[number, number]> }>> = Array.from({ length: 13 }, () => []);
  private keys = 0;

  push(key: number, a: number, b: number): void {
    const bucket = this.buckets[(key >>> 0) % 13]!;
    const hit = bucket.find((e) => e.key === key);
    if (hit) hit.points.push([a, b]);
    else {
      if (this.keys === 13) throw new Error('HashQueue: a 14th zone would rehash — order unverified');
      bucket.unshift({ key, points: [[a, b]] });
      this.keys++;
    }
  }

  /** Iteration order: buckets ascending, newest key first, points as pushed. */
  *entries(): Iterable<{ key: number; points: Array<[number, number]> }> {
    for (const bucket of this.buckets) yield* bucket;
  }
}

export interface FilledZones {
  /** Per floor: tiles[a][b] = zone index, -1 where nothing claimed the tile. */
  floors: Int32Array[][];
  /** Sweeps each floor ran — fixed by the map size, listed for the budget. */
  sweepsPerFloor: number;
  /** betweenFloat draws in total, and on each floor's FIRST sweep (predicted 0). */
  jitterDraws: number;
  firstSweepJitterDraws: number;
  /**
   * Cumulative draws at every tenth sweep, recorded where the engine logs
   * "filling zones, %d" — BEFORE that sweep's own coins — so each entry is
   * directly comparable to an oracle `sweep <n> <draws>` line.
   */
  decades: Array<{ sweep: number; draws: number }>;
}

/**
 * @param zones every placed zone, exactly as generateGameZones returned them —
 *              engine iteration order, floor by floor
 * @param twoFloors gen+0x1D — the floor count is this bit plus one, the same
 *              contract generateGameZones takes
 */
export function fillZones(
  width: number,
  height: number,
  zones: PlacedZone[],
  twoFloors: boolean,
  rng: RmgRandom,
): FilledZones {
  const floorCount = twoFloors ? 2 : 1;
  // The engine checks the jitter's 6-tile margin against the dimensions
  // SWAPPED relative to the neighbour bounds. On the square maps it makes the
  // two readings agree; on a rectangle they would not, and porting either one
  // would be a guess wearing the other's clothes.
  if (width !== height) throw new Error('fillZones: the engine is only ever run square — rectangle semantics unread');
  const size = width;

  const byFloor: PlacedZone[][] = Array.from({ length: floorCount }, () => []);
  for (const z of zones) byFloor[z.floor]!.push(z);

  // GetZone searches floor 0 then floor 1, so with a duplicated index the
  // lower floor's zone would answer for both. Shipped templates number zones
  // uniquely; the map mirrors the engine's search order all the same.
  const byIndex = new Map<number, PlacedZone>();
  for (const floor of byFloor) for (const z of floor) if (!byIndex.has(z.index)) byIndex.set(z.index, z);

  // Assumed, and said: the grid arrives all -1. FillZones itself never writes
  // the initial value; whoever builds the floor does, and that constructor is
  // still unread. The first oracle-held sweep will confirm or deny.
  const grids: Int32Array[][] = byFloor.map(() =>
    Array.from({ length: size }, () => new Int32Array(size).fill(-1)));

  // ---- pass 1: paint the circles, first zone in hash order wins ----
  for (let f = 0; f < floorCount; f++) {
    const grid = grids[f]!;
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        for (const z of byFloor[f]!) {
          const dax = fl(a - Math.trunc(z.x));
          const dby = fl(b - Math.trunc(z.y));
          const d = fl(Math.sqrt(fl(fl(dax * dax) + fl(dby * dby))));
          if (z.r > d) { grid[a]![b] = z.index; break; }
        }
      }
    }
  }

  // ---- pass 2: grow and jitter, sweep by sweep ----
  const sweepLimit = fl(fl(size) * SQRT3);
  let sweepsPerFloor = 0;
  let jitterDraws = 0;
  let firstSweepJitterDraws = 0;
  const decades: Array<{ sweep: number; draws: number }> = [];

  for (let f = 0; f < floorCount; f++) {
    const grid = grids[f]!;
    // The previous sweep's snapshot of each zone's area — zero before the
    // first sweep, which is what starves the ratio test of a defined answer.
    const counts = new Map<number, number>();
    for (const z of byFloor[f]!) counts.set(z.index, 0);

    let sweeps = 0;
    for (let counter = 0; sweepLimit > fl(counter); counter++) {
      if (counter % 10 === 0) decades.push({ sweep: counter, draws: rng.draws });
      sweeps++;
      const grow = new HashQueue();
      const flip = new HashQueue();

      const dirA = rng.below(2);
      const dirB = rng.below(2);
      const scanA = dirA !== 0 ? { from: 0, step: 1 } : { from: size - 1, step: -1 };
      const scanB = dirB !== 0 ? { from: 0, step: 1 } : { from: size - 1, step: -1 };

      for (let ia = 0, a = scanA.from; ia < size; ia++, a += scanA.step) {
        for (let ib = 0, b = scanB.from; ib < size; ib++, b += scanB.step) {
          const own = grid[a]![b]!;
          if (own === -1) {
            const cnt = new HashCounts();
            for (const [da, db] of NBR) {
              const na = a + da;
              const nb = b + db;
              if (na < 0 || na >= size || nb < 0 || nb >= size) continue;
              const z = grid[na]![nb]!;
              if (z !== own) cnt.add(z);
            }
            const best = cnt.best();
            if (best && best.count > 2) grow.push(best.key, a, b);
          } else {
            if (a < 6 || a > size - 6 || b < 6 || b > size - 6) continue;
            const cnt = new HashCounts();
            for (const [da, db] of NBR) {
              const na = a + da;
              const nb = b + db;
              if (na < 0 || na >= size || nb < 0 || nb >= size) continue;
              const z = grid[na]![nb]!;
              if (z !== own) cnt.add(z);
            }
            if (cnt.has(-1) || cnt.size === 0) continue;
            const best = cnt.best();
            if (!best || best.count <= 2) continue;
            const zOwn = byIndex.get(own);
            const zOther = byIndex.get(best.key);
            if (!zOwn || !zOther) continue;
            // Stale on purpose: last sweep's areas. 0/0 is NaN and x/0 is
            // infinity, and a strict comiss says "no" to both — the engine's
            // own way of sitting the first sweep out.
            const countRatio = fl((counts.get(zOther.index) ?? 0) / (counts.get(zOwn.index) ?? 0));
            const sizeRatio = fl(zOther.size / zOwn.size);
            if (sizeRatio > countRatio) {
              const r = rng.betweenFloat(0, 1);
              jitterDraws++;
              if (sweeps === 1) firstSweepJitterDraws++;
              if (r > KEEP_ABOVE) flip.push(best.key, a, b);
            }
          }
        }
      }

      for (const { key, points } of grow.entries()) for (const [pa, pb] of points) grid[pa]![pb] = key;
      for (const { key, points } of flip.entries()) for (const [pa, pb] of points) grid[pa]![pb] = key;

      // CollectOwnTiles, reduced to what the jitter reads: the new areas.
      for (const z of byFloor[f]!) counts.set(z.index, 0);
      for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
          const z = grid[a]![b]!;
          if (z !== -1 && counts.has(z)) counts.set(z, counts.get(z)! + 1);
        }
      }
    }
    sweepsPerFloor = sweeps;
  }

  return { floors: grids, sweepsPerFloor, jitterDraws, firstSweepJitterDraws, decades };
}

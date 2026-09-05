// The surface height plane — the late pass `0xECF760` on the terrain
// processor, called ONCE per generation at 0xEAC206, after the road
// painter and just before "finished creating map". It touches FLOOR 0
// only (both object sub-passes skip floor indices != 0, everything else
// derefs floors[0]); the underground floor's heights are the massif
// carve's (`massif-carve.ts`).
//
// The plane starts at a constant (the level constructor `0xEB2B60`), the
// STATICS phase adds the mountain relief cones (`0xED1660`, `coneRelief`
// here), and this pass then lays the base field over everything:
//
//   0xECF9A0  base sin/cos field + road dents      (baseField)
//   lake dents: -0.5 on the 0x80 tiles' corners    (lakeDents)
//   0xED0240  Inferno-town / dwelling craters      (craterPass)
//   0xED06D0  footprint mask-zero + flatten-to-avg (flattenPass)
//   0xEB2580  smooth, kernel 0.8/0.025             (smooth, flag 1)
//   mask refilled to all-ones, smooth 0.8/0.025 again
//   0xED06D0  flatten again (post-smooth average)
//   0xECFE40  lake bodies flattened to min - 0.1   (lakeFlatten)
//   0xEB2580  smooth, kernel 0.2/0.1               (smooth, flag 0)
//
// ORIENTATION. Everything here works in the ENGINE'S memory layout —
// `mem[first * v + second]` with the height helper `0xEB1800` indexing
// rows by a point's FIRST component and every other helper
// (0xEB2420/0xEB24B0/0xEB1890) by the SECOND. The two conventions are
// transposed against each other and only agree because the map is
// square; the port copies each access literally rather than reasoning
// about it, and `heightsToFile` transposes once at the end (the file
// holds the plane the other way around, the same fact the river plane
// and the massif grids established).
//
// PRECISION. The reference is an EDITOR run, and the editor is the x87
// compilation — the same fact the road wave established, and here it is
// visible in the file itself: the game's SSE kernel (per-tap mulss/addss)
// drifts a constant-9 plateau by +1.9e-6 per 0.8-pass, while the
// reference holds 4,414 vertices at EXACTLY 9.0. So this port speaks the
// editor's arithmetic: f32 OPERANDS (the plane's cells, the .data
// constants), DOUBLE intermediates (x87 with the CRT's 53-bit precision
// control), and a SINGLE rounding at each store into the plane. A sum of
// nine f32-times-f32 products is exact in double, which is exactly why
// the plateau survives the smoothing in the file.

import type { Offset } from './town-data.ts';
import { rotate } from './towns.ts';

const fl = Math.fround;

export interface HeightPlane {
  size: number;
  /** Vertices per side. */
  v: number;
  /** Engine memory layout — `mem[first * v + second]`. */
  mem: Float32Array;
}

/** The level constructor's fill — `0xEB2B60`; the surface floor's constant. */
export function makeHeightPlane(size: number, fill: number): HeightPlane {
  const v = size + 1;
  return { size, v, mem: new Float32Array(v * v).fill(fl(fill)) };
}

/**
 * `0xEB1800` — one add into the plane; rows by the FIRST component. The
 * delta arrives as the x87 DOUBLE intermediate; the store rounds once.
 */
function heightAdd(h: HeightPlane, first: number, second: number, delta: number): void {
  const i = Math.trunc(first) * h.v + Math.trunc(second);
  h.mem[i] = fl(h.mem[i]! + delta);
}

/**
 * `0xED1660` — the mountain relief cone, called by the statics accept
 * path with the static's position and its UNROTATED blocked list. Per
 * rotated offset within 3.5 of the centre, `2 * (3.5f - r)` is ADDED to
 * ONE vertex: EB1800((y + dy, x + dx)) — rows by the y half. The radius
 * is single except the sqrt (double, rounded back).
 */
export function coneRelief(
  h: HeightPlane, x: number, y: number, q: number, blocked: readonly Offset[],
): void {
  for (const off of blocked) {
    const [dx, dy] = rotate(q, off);
    const r = Math.sqrt(dy * dy + dx * dx);
    const t = 3.5 - r;
    if (t <= 0) continue;
    // The engine's pt is (+0x44, +0x48) = the port's (y, x) — the cone
    // lands mem[x+dx][y+dy], the file's natural (row y+dy, col x+dx).
    heightAdd(h, x + dx, y + dy, t + t);
  }
}

/**
 * The dwelling families the craters and the flatten test by the shared's
 * BuildingType (`+0xEC`). {0x48..0x4B} = the INFERNO dwellings — they melt
 * a -2.5 crater; {0x51, 0x55..0x57} = the ACADEMY dwellings — they hover,
 * so the flatten skips them (as does the Academy town itself).
 */
export const CRATER_DWELLING_TYPES: ReadonlySet<string> = new Set([
  'BUILDING_DEMON_GATE', 'BUILDING_IMP_CRUCIBLE', 'BUILDING_KENNELS', 'BUILDING_INFERNO_MILITARY_POST',
]);
export const SKIP_FLATTEN_DWELLING_TYPES: ReadonlySet<string> = new Set([
  'BUILDING_ACADEMY_MILITARY_POST', 'BUILDING_WORKSHOP', 'BUILDING_STONE_PARAPET', 'BUILDING_GOLEM_FORGE',
]);

/** What the object passes need to know about one placed map object. */
export interface HeightObject {
  /** Engine +0x44/+0x48 — the port's x and y. */
  x: number;
  y: number;
  /** Engine +0x4C; 0 for everything the surface run places. */
  z: number;
  /** Engine +0x50 — radians, as the map file records them. */
  rot: number;
  floor: number;
  /** SAdvMapStatic casts are excluded from the flatten pass. */
  isStatic: boolean;
  /** Town whose shared `+0xFC` == 8 — Inferno; digs the -1.0 crater. */
  craterTown?: boolean;
  /** Town whose shared `+0xFC` == 5 — Academy; skips the flatten. */
  skipFlattenTown?: boolean;
  /** Dwelling shared `+0xEC` in {0x48..0x4B} — the -2.5 crater. */
  craterDwelling?: boolean;
  /** Dwelling shared `+0xEC` in {0x51,0x55,0x56,0x57} — skips the flatten. */
  skipFlattenDwelling?: boolean;
  /** The shared document's blockedTiles, unrotated, in document order. */
  blocked: readonly Offset[];
  /** The FIRST activeTiles entry, when the vector is non-empty. */
  firstActive?: Offset;
}

export interface HeightsInput {
  size: number;
  /** Floor 0 tile grids, the port's own layout (rows literal to the engine). */
  occupancy: Uint8Array;
  border: Int32Array[];
  /** Every placed object, in the map's slot (creation) order. */
  objects: readonly HeightObject[];
}

/**
 * `0xECF9A0` — the base field plus the road dents, one interleaved walk.
 * Per vertex the noise product runs in double over single quotients, the
 * dist term is added, and the sum clamps to the 3.0 plateau. The value is
 * ADDED to `mem[o][n]` while the road dent lands on the TRANSPOSED tile's
 * corners — copied literally, square-only consistent.
 *
 * THE DIG IS NOT PORTED, AND THAT IS A MEASUREMENT. The engine has a branch
 * this function does not: it looks the vertex's zone up through the floor's
 * index map (`0xE9FF00` on `floor+0xAC`, keyed by the value in the zone grid)
 * and, when that zone's `+0x18` is 8 or 7, NEGATES the dist term — Inferno
 * and Necromancy dig toward their own interior instead of rising out of it.
 * The frame is resolved with a tracker rather than by eye, so the `-1.0f` at
 * `0xF4A9BC` really does land on the dist slot (`esp0-0x50`) and on nothing
 * else. `+0x18` really is the resolved race: the map hands back the zone (one
 * caller prints "no zone found with index %d", and `[zone+0x20]` is the
 * preset the road painter takes its texture from — our road masks are
 * byte-identical, so the lookup finds the right zone), and the lakes gate
 * `0xEBC260` reads the same `+0x18` against exactly {3,4,7,8,9,10}, our
 * `LAKE_RACES`.
 *
 * And yet negating on the resolved race is WRONG on the maps we can check.
 * Over the twenty-one templates the port accepts it costs 2,345 differing
 * vertices (9,138 against 6,793), and `S1-2P2-8Z8K2S` goes from 221 vertices
 * (worst 1.25) to EXACTLY ZERO the moment the dig stops firing on its
 * resolved-Inferno zone. Two crater plateaus vanish with it: they were the
 * dig inside a crater disc moving the average the crater flattens to.
 *
 * WITHOUT the negation the term cannot be seen at all: `noise/0.15` spans
 * ±6.67 and `dist/3` is non-negative, so `noise + dist/3 + 12` never falls
 * under the 3.0 cap — this function returns a flat 3.0 at every vertex of
 * every shipped template, checked.
 *
 * AND THE TABLE IS NOT THE CULPRIT — that is measured, not reasoned. The
 * oracle's `grids` dump was taken from the engine for both of the maps that
 * disagree (`tools/rmg-diff-grids.ts`), and `floor+0xE4` comes back IDENTICAL
 * to what `border-tiles.ts` computes: 30,976 of 30,976 cells on
 * `S3-4P2-4Z4K1M`, 9,216 of 9,216 on `S1-2P2-8Z8K2S`, the zone grid with it.
 * So the dist this branch would scale is exactly ours, the branch's output is
 * exactly what the port produces with it switched on, and switching it on is
 * wrong on both maps: `S1-2P2-8Z8K2S` goes from an exact plane to 221 differing
 * vertices, and `S3-4P2-4Z4K1M` stays 5.25 out either way. The negation does
 * not happen. WHY it does not, with `+0x18` reading the resolved race and the
 * lookup finding the right zone, is the open question — and it is now a
 * question about the branch, not about its input.
 *
 * NOTE WHY THIS SURVIVED SO LONG. On the reference `S1P2Z2M1` the dig would
 * not have bitten either — its lowest value is 3.00 even with the resolved
 * race, as on `S3-5P4Z12B4` and `S2-4P2Z7B2`. A plane that is bit-identical
 * on the reference could never have caught this; it took the sweep.
 */
export function baseField(h: HeightPlane, input: HeightsInput): void {
  const { size } = input;
  for (let o = 0; o <= size; o++) {
    const A = Math.sin(o / 10.0);
    const B = Math.sin(o / 42.0);
    for (let n = 0; n <= size; n++) {
      const ri = Math.min(n, size - 1);
      const ci = Math.min(o, size - 1);
      // The engine negates this for an Inferno or Necromancy zone; see above
      // for why that branch is deliberately absent and what would restore it.
      const dterm = input.border[ri]![ci]! / 3.0;
      let p = Math.cos(n / 13.0);
      p = p * A;
      p = p * B;
      p = p * Math.sin(n / 29.0);
      let val = p / 0.15000000596046448; // the f32 0.15 promoted
      val = val + dterm;
      val = val + 12.0;
      val = Math.min(val, 3.0);
      heightAdd(h, o, n, val);
      if (o < size && n < size && (input.occupancy[o * size + n]! & 0x18) !== 0) {
        heightAdd(h, n, o, -1.0);
        heightAdd(h, n + 1, o, -1.0);
        heightAdd(h, n, o + 1, -1.0);
        heightAdd(h, n + 1, o + 1, -1.0);
      }
    }
  }
}

/**
 * The lake dents — the orchestrator's own loop between the base field and
 * the craters: every 0x80 tile takes -0.5 on its four corners and leaves
 * the smoothing mask.
 */
export function lakeDents(h: HeightPlane, mask: Uint8Array, occupancy: Uint8Array, size: number): void {
  for (let o = 0; o < size; o++) {
    for (let n = 0; n < size; n++) {
      if ((occupancy[o * size + n]! & 0x80) === 0) continue;
      heightAdd(h, n, o, -0.5);
      heightAdd(h, n + 1, o, -0.5);
      heightAdd(h, n, o + 1, -0.5);
      heightAdd(h, n + 1, o + 1, -0.5);
      mask[o * size + n] = 0;
    }
  }
}

/** `0xEB2420` — set every listed vertex to their average + delta. */
function setToAverage(h: HeightPlane, points: ReadonlyArray<readonly [number, number]>, delta: number): void {
  if (points.length === 0) return;
  let sum = 0; // x87: the accumulation stays double
  for (const [first, second] of points) {
    sum += h.mem[Math.trunc(second) * h.v + Math.trunc(first)]!;
  }
  const v = fl(sum / points.length + delta);
  for (const [first, second] of points) {
    h.mem[Math.trunc(second) * h.v + Math.trunc(first)] = v;
  }
}

/**
 * `0xED0240` — the craters: an Inferno town (-1.0 within 8.0 of the object
 * minus one) and the dwelling family {0x48..0x4B} (-2.5 within 2.5, no
 * minus-one). The candidate scan is o-outer n-inner; the distance runs in
 * single with a double sqrt, dy² + dx² then + dz² in that order.
 */
export function craterPass(h: HeightPlane, input: HeightsInput): void {
  const { size } = input;
  for (const obj of input.objects) {
    if (obj.floor !== 0) continue;
    if (obj.craterTown) craterOne(h, size, obj, 1, fl(8.0), -1.0);
    if (obj.craterDwelling) craterOne(h, size, obj, 0, fl(2.5), -2.5);
  }
}

function craterOne(
  h: HeightPlane, size: number, obj: HeightObject, plusOne: number, radius: number, delta: number,
): void {
  // Engine +0x44 pairs the o axis and +0x48 the n axis — the port's y and
  // x respectively; the +0x48 difference squares FIRST (the addss order).
  const points: Array<readonly [number, number]> = [];
  for (let o = 0; o < size; o++) {
    for (let n = 0; n < size; n++) {
      const d0 = obj.y - (o + plusOne);
      const d1 = obj.x - (n + plusOne);
      const dz = obj.z - 0;
      const d = Math.sqrt(d1 * d1 + d0 * d0 + dz * dz);
      if (radius > d) points.push([o, n]);
    }
  }
  setToAverage(h, points, delta);
}

/**
 * `0xABE1D0` — the quarter-turn rotate the engine applies to a footprint:
 * the angle normalised into [0, 2pi) by repeated adds, divided by pi/2,
 * plus 0.25, ROUNDED HALF-EVEN to a quadrant. Returns rotated offsets
 * truncated to (signed byte) integers.
 */
export function quarterTurn(angle: number): number {
  let a = angle;
  if (a < 0) {
    do { a = a + fl(6.2831855); } while (a < 0);
  }
  const q = a / fl(1.5707964) + 0.25;
  // x87 fistp rounds half to even.
  let r = Math.round(q);
  if (Math.abs(q - Math.trunc(q)) === 0.5 && r % 2 !== 0) r -= 1;
  return r & 3;
}

export function rotateOffsets(offs: ReadonlyArray<Offset>, angle: number): Array<readonly [number, number]> {
  const r = quarterTurn(angle);
  // r=0: identity; 1: (x,y)->(-y,x); 2: (-x,-y); 3: (y,-x) — the jump
  // table's (A,B,C) with dx = B*y + A*x, dy = A*y + C*x.
  const [a, b, c] = [[1, 0, 0], [0, -1, 1], [-1, 0, 0], [0, 1, -1]][r]!;
  return offs.map(([x, y]) => {
    const dx = Math.trunc(b * y + a * x);
    const dy = Math.trunc(a * y + c * x);
    // The engine keeps the low byte — offsets are tiny, so this is inert.
    return [(dx << 24) >> 24, (dy << 24) >> 24] as const;
  });
}

/**
 * The STLPort `hash_map<int,int>` whose bucket order decides the flatten's
 * vertex-set tail — 13 buckets growing through the prime table, head
 * insertion, enumeration bucket-ascending chain head-to-tail. Values
 * update to the MAX on a repeated key.
 */
const PRIMES = [
  13, 29, 53, 97, 193, 389, 769, 1543, 3079, 6151, 12289, 24593, 49157,
  98317, 196613, 393241, 786433, 1572869, 3145739, 6291469, 12582917,
  25165843, 50331653, 100663319, 201326611, 402653189, 805306457,
  1610612741, 3221225473, 4294967291,
];

class EngineHashMap {
  private buckets: Array<Array<{ key: number; val: number }>>;
  private count = 0;

  constructor() {
    this.buckets = Array.from({ length: 13 }, () => []);
  }

  private bucketOf(key: number): number {
    return (key >>> 0) % this.buckets.length;
  }

  insertMax(key: number, val: number): void {
    const chain = this.buckets[this.bucketOf(key)]!;
    const node = chain.find((e) => e.key === key);
    if (node) {
      if (val > node.val) node.val = val;
      return;
    }
    if (this.count + 1 > this.buckets.length) this.grow(this.count + 1);
    // Head insertion.
    this.buckets[this.bucketOf(key)]!.unshift({ key, val });
    this.count++;
  }

  private grow(need: number): void {
    const size = PRIMES.find((p) => p >= need) ?? PRIMES[PRIMES.length - 1]!;
    const old = this.buckets;
    this.buckets = Array.from({ length: size }, () => []);
    // The rehash pops each old chain from its HEAD, bucket 0..N-1,
    // pushing to the new bucket's head — chains reverse per rehash.
    for (const chain of old) {
      for (const node of chain) this.buckets[this.bucketOf(node.key)]!.unshift(node);
    }
  }

  *entries(): Iterable<{ key: number; val: number }> {
    for (const chain of this.buckets) yield* chain;
  }
}

/**
 * `0xEB1890` — flatten one object's closed vertex set to its DOUBLE-sum
 * average. The set: the rotated offsets plus the object position, then a
 * bottom edge (per column, max row + 1) and a right edge (per row of the
 * ENLARGED list, max column + 1), both in hash-map bucket order.
 */
function flattenToAverage(
  h: HeightPlane, size: number,
  x: number, y: number, rotated: ReadonlyArray<readonly [number, number]>,
): void {
  // p.x (the second half — mem columns) carries the port x, p.y the port
  // y: the object's +0x44/+0x48 are the port's (y, x), same as the cone
  // and the craters, so the flatten lands on the file's natural vertices.
  // The closure is the engine's: first per X column a vertex BELOW the
  // lowest (x, maxY+1), then per Y row of the enlarged list a vertex
  // RIGHT of the rightmost (maxX+1, y) — the sanctuary's flat set proved
  // the axes (its odd corner is (33,29), not (32,29)).
  const pts: Array<readonly [number, number]> = rotated.map(([dx, dy]) => [fl(dy + y), fl(dx + x)] as const);
  const m1 = new EngineHashMap();
  for (const [px, py] of pts) m1.insertMax(Math.trunc(py), Math.trunc(px));
  for (const { key, val } of m1.entries()) pts.push([val + 1, key] as const);
  const m2 = new EngineHashMap();
  for (const [px, py] of pts) m2.insertMax(Math.trunc(px), Math.trunc(py));
  for (const { key, val } of m2.entries()) pts.push([key, val + 1] as const);

  let sum = 0; // double
  for (const [px, py] of pts) {
    const yy = Math.trunc(py);
    const xx = Math.trunc(px);
    if (yy < 0 || yy > size || xx < 0 || xx > size) continue;
    sum += h.mem[yy * h.v + xx]!;
  }
  const avg = fl(sum / pts.length); // len INCLUDES the skipped points
  for (const [px, py] of pts) {
    const yy = Math.trunc(py);
    const xx = Math.trunc(px);
    if (yy < 0 || yy > size || xx < 0 || xx > size) continue;
    h.mem[yy * h.v + xx] = avg;
  }
}

/**
 * `0xED06D0` — for every non-static floor-0 object (minus the Academy town
 * and the {0x51,0x55,0x56,0x57} dwellings): zero the smoothing mask under
 * the rotated footprint and flatten the footprint's closed vertex set to
 * its average. The footprint is the shared blockedTiles plus the FIRST
 * active tile.
 */
export function flattenPass(h: HeightPlane, mask: Uint8Array, input: HeightsInput): void {
  const { size } = input;
  for (const obj of input.objects) {
    if (obj.isStatic || obj.floor !== 0) continue;
    if (obj.skipFlattenTown || obj.skipFlattenDwelling) continue;
    const offs: Offset[] = [...obj.blocked];
    if (obj.firstActive) offs.push(obj.firstActive);
    const rotated = rotateOffsets(offs, obj.rot);
    if (process.env['H5E_DBG_FLATTEN'] && rotated.length) {
      const xs = rotated.map(([dx]) => dx + obj.x);
      const ys = rotated.map(([, dy]) => dy + obj.y);
      console.log(`  [flat] ${(obj as { name?: string }).name ?? '?'} at ${obj.x}:${obj.y} rot ${obj.rot.toFixed(3)} `
        + `box x ${Math.min(...xs)}..${Math.max(...xs)} y ${Math.min(...ys)}..${Math.max(...ys)} (${rotated.length} offs)`);
    }
    for (const [dx, dy] of rotated) {
      const mx = Math.trunc(fl(dx + obj.x));
      const my = Math.trunc(fl(dy + obj.y));
      // The engine writes with NO bounds check; a footprint never reaches
      // out of the map, so the guard is inert. The mask lives in the
      // port's tile layout (row y, byte x), the same the smooth consults.
      if (mx >= 0 && mx < size && my >= 0 && my < size) mask[my * size + mx] = 0;
    }
    flattenToAverage(h, size, obj.x, obj.y, rotated);
  }
}

/**
 * `0xEB2580` — one double-buffered 3x3 smoothing pass over the interior
 * vertices; kernel 0.8/0.025 with the flag, 0.2/0.1 without. The mask is
 * consulted TRANSPOSED (rows by the column index), and a masked-out
 * vertex copies through verbatim. The nine taps accumulate in the
 * engine's exact addss order.
 */
export function smooth(h: HeightPlane, mask: Uint8Array, size: number, flag: boolean): void {
  const v = h.v;
  const kc = flag ? fl(0.8) : fl(0.2);
  const kn = flag ? fl(0.025) : fl(0.1);
  const t = new Float32Array(v * v);
  const H = h.mem;
  for (let r = 1; r <= v - 2; r++) {
    for (let c = 1; c <= v - 2; c++) {
      if (mask[c * size + r] === 0) {
        t[r * v + c] = H[r * v + c]!;
        continue;
      }
      // x87: nine f32 products accumulate exactly in double; one rounding
      // at the store — which is precisely why the 9.0 plateau survives.
      let s = H[(r - 1) * v + (c - 1)]! * kn;
      s = s + H[r * v + (c - 1)]! * kn;
      s = s + H[(r + 1) * v + (c - 1)]! * kn;
      s = s + H[(r - 1) * v + c]! * kn;
      s = s + H[r * v + c]! * kc;
      s = s + H[(r + 1) * v + c]! * kn;
      s = s + H[(r - 1) * v + (c + 1)]! * kn;
      s = s + H[r * v + (c + 1)]! * kn;
      s = s + H[(r + 1) * v + (c + 1)]! * kn;
      t[r * v + c] = fl(s);
    }
  }
  for (let r = 1; r <= v - 2; r++) {
    for (let c = 1; c <= v - 2; c++) H[r * v + c] = t[r * v + c]!;
  }
}

/** `0xEB24B0` — set every listed tile's four corners to the min + delta. */
function setToMin(h: HeightPlane, tiles: ReadonlyArray<readonly [number, number]>, delta: number): void {
  if (tiles.length === 0) return;
  let m = fl(1000.0);
  for (const [first, second] of tiles) {
    m = Math.min(h.mem[Math.trunc(second) * h.v + Math.trunc(first)]!, m);
  }
  const val = fl(m + delta);
  for (const [first, second] of tiles) {
    const yy = Math.trunc(second);
    const xx = Math.trunc(first);
    h.mem[yy * h.v + xx] = val;
    h.mem[(yy + 1) * h.v + xx] = val;
    h.mem[yy * h.v + (xx + 1)] = val;
    h.mem[(yy + 1) * h.v + (xx + 1)] = val;
  }
}

/**
 * `0xECFE40` — each lake body (0x80 tiles, 8-connected) collected by
 * repeated full-grid sweeps until stable, then flattened to its corner
 * minimum minus 0.1. The sweep order fixes the member list, which fixes
 * nothing arithmetic here (min is order-blind) but is copied anyway.
 */
export function lakeFlatten(h: HeightPlane, occupancy: Uint8Array, size: number): void {
  const ids = new Int32Array(size * size);
  const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1],
  ];
  for (let o = 0; o < size; o++) {
    for (let n = 0; n < size; n++) {
      if ((occupancy[o * size + n]! & 0x80) === 0) continue;
      if (ids[o * size + n] !== 0) continue;
      const id = 0x400 * o + n; // tile (0,0) would collide with "unclaimed" — replicated as-is
      ids[o * size + n] = id;
      const members: Array<readonly [number, number]> = [[o, n]];
      let changed = true;
      while (changed) {
        changed = false;
        for (let x = 1; x <= size - 2; x++) {
          for (let y = 1; y <= size - 2; y++) {
            if ((occupancy[x * size + y]! & 0x80) === 0) continue;
            if (ids[x * size + y] !== id) continue;
            for (const [dx, dy] of NEIGHBORS) {
              const nx = x + dx;
              const ny = y + dy;
              if ((occupancy[nx * size + ny]! & 0x80) === 0) continue;
              if (ids[nx * size + ny] !== 0) continue;
              ids[nx * size + ny] = id;
              members.push([nx, ny]);
              changed = true;
            }
          }
        }
      }
      setToMin(h, members, fl(-0.1));
    }
  }
}

/**
 * The orchestrator `0xECF760` — the whole late pass over floor 0. The
 * plane arrives carrying the constructor fill plus the statics' relief
 * cones; it leaves as the file's height plane (modulo the transpose).
 */
export function latePass(h: HeightPlane, input: HeightsInput): void {
  const { size } = input;
  baseField(h, input);
  const mask = new Uint8Array(size * size).fill(1);
  lakeDents(h, mask, input.occupancy, size);
  craterPass(h, input);
  flattenPass(h, mask, input);
  smooth(h, mask, size, true);
  mask.fill(1);
  smooth(h, mask, size, true);
  flattenPass(h, mask, input); // re-zeroes the mask for the last smooth
  lakeFlatten(h, input.occupancy, size);
  smooth(h, mask, size, false);
}

/** The file holds the plane transposed against the engine's memory. */
export function heightsToFile(h: HeightPlane): Float32Array {
  const out = new Float32Array(h.v * h.v);
  for (let r = 0; r < h.v; r++) {
    for (let c = 0; c < h.v; c++) out[r * h.v + c] = h.mem[c * h.v + r]!;
  }
  return out;
}

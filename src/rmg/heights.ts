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

import { DOUBLES, type Arith } from './arith.ts';
import { RACE } from './load-template.ts';
import type { Offset } from './town-data.ts';
import { rotate } from './towns.ts';

const fl = Math.fround;

/**
 * THE GAME'S BUILD, SECOND. Every site below is written the editor's way and
 * takes an `Arith`; handed `DOUBLES` it computes what it computed before, to
 * the bit (its operations are the plain operators and its store is `fl`).
 * Handed the game's machine — single precision, every operation chopped
 * (`SSE` in `arith.ts`) — it computes the game's plane: read off a large
 * game map whose 30,625 surface vertices sat 5 to 10 ulps BELOW the port's,
 * every one of them below and none above, the chop's own signature.
 *
 * Where the two builds compute a different EXPRESSION rather than the same
 * one under two roundings — the base field — the site carries both, chosen
 * by which machine it was handed.
 */

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
function heightAdd(h: HeightPlane, first: number, second: number, delta: number, ar: Arith): void {
  const i = Math.trunc(first) * h.v + Math.trunc(second);
  h.mem[i] = ar.store(ar.add(h.mem[i]!, delta));
}

/**
 * `0xED1660` in the game, `0x794A80` in the editor — the mountain relief cone,
 * called by the statics accept path with the static's position and its
 * UNROTATED blocked list. Per rotated offset within 3.5 of the centre,
 * `2 * (3.5f - r)` is ADDED to ONE vertex: the height add on (y + dy, x + dx),
 * rows by the y half.
 *
 * THE TWO BUILDS ROUND THIS DIFFERENTLY, and the reference is the editor's.
 * The game is SSE and rounds the RADIUS back to single (`cvtsd2ss` at
 * 0xED1714) before subtracting it from 3.5f, so every step is single. The
 * editor is x87 and does the opposite: the squares come from f32 slots but the
 * sum, the sqrt, `3.5f - r` and the doubling all stay in the FPU, and the ONLY
 * rounding is the store of the doubled term into the f32 slot the add is
 * handed (0x794b60). The two disagree on every offset whose radius is
 * irrational - r² of 2, 5, 8 and 10, the diagonals - and a vertex stacks
 * several of those, which is worth a one-ulp plane on most maps of a sweep.
 *
 * The editor computes the radius TWICE, once for the guard and once for the
 * term; the guard's copy is compared against 0 unrounded (0x794afc).
 */
export function coneRelief(
  h: HeightPlane, x: number, y: number, q: number, blocked: readonly Offset[], ar: Arith = DOUBLES,
): void {
  for (const off of blocked) {
    const [dx, dy] = rotate(q, off);
    // ONE ROUNDING, AND IT IS AT THE END. The editor computes the whole term
    // in the FPU - the squares from f32 slots but exact, the sum, the sqrt,
    // `3.5f - r` and the doubling all at the register's precision - and rounds
    // exactly once, storing the doubled term into the f32 slot it passes to the
    // add (`fstp dword [esp]` at 0x794b60, then the call). Rounding the radius
    // instead, which is what the SSE build's `cvtsd2ss` does, is a DIFFERENT
    // number: the two disagree on every offset whose radius is irrational (r²
    // of 2, 5, 8, 10 - the diagonals), and a vertex stacks several of those.
    // The game's `cvtsd2ss` on the radius is `ar.sqrt` under its machine.
    const r = ar === DOUBLES ? Math.sqrt(dy * dy + dx * dx) : ar.sqrt(dy * dy + dx * dx);
    const t = ar.sub(3.5, r);
    // The guard is on the UNROUNDED value, compared against 0 (0x794afc).
    if (t <= 0) continue;
    // The engine's pt is (+0x44, +0x48) = the port's (y, x) — the cone
    // lands mem[x+dx][y+dy], the file's natural (row y+dy, col x+dx).
    heightAdd(h, x + dx, y + dy, ar.store(ar.add(t, t)), ar);
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
  /** The zone ids, indexed like `border`. */
  grid: Int32Array[];
  /** Zone index -> the race the run resolved for it; the dig gate reads this. */
  raceOf(zoneIndex: number): number | undefined;
  /** Every placed object, in the map's slot (creation) order. */
  objects: readonly HeightObject[];
}

/**
 * `0xECF9A0` in the game, `0x794F10` in the editor — the base field plus the
 * road dents, one interleaved walk. Per vertex a product of four sines and a
 * cosine is scaled, the dist term is added, and the sum clamps to the 3.0
 * plateau. The value is ADDED to `mem[o][n]` while the road dent lands on the
 * TRANSPOSED tile's corners — copied literally, square-only consistent.
 *
 * WHICH INDEX FEEDS WHICH SINE. The engine's OUTER loop is this port's SECOND
 * index, because the plane's two conventions are transposed against each other
 * (see the file header): the engine writes `rows[outer][inner]`, the dump
 * indexes rows by that same first component, and the dump's rows line up with
 * our second index. So `sin(·/10)` and `sin(·/42)`, hoisted out of the engine's
 * outer loop, belong to `n`, and `cos(·/13)` and `sin(·/29)` to `o`. Reading it
 * the other way costs nothing while the plateau caps every vertex, which is why
 * it stood: the moment the dig makes a value visible, it is wrong by metres.
 *
 * THE DIG. When the vertex's zone is Inferno or Necromancy the dist term is
 * NEGATED — those two dig toward their own interior instead of rising out of
 * it. The engine looks the zone up through the floor's index map (`0xE9FF00` on
 * `floor+0xAC`, keyed by the value in the zone grid) and compares that object's
 * `+0x18`, the RESOLVED race, against 8 then 7. It is the only thing that can
 * take a vertex under the plateau: `noise/0.15` spans ±6.67 and `dist/3` is
 * non-negative, so without the negation `noise + dist/3 + 12` never falls under
 * 3.0 and this function returns a flat 3.0 everywhere.
 *
 * It was OUT of this port for one commit, on a measurement that was real and a
 * conclusion that was not: switching it on made twenty-one templates worse. It
 * did, while the noise's two indices were swapped — the two errors were only
 * visible together, since the swap is invisible under the cap and the dig is
 * what lifts the cap. With both fixed the engine's own base field comes back
 * BIT-IDENTICAL on `S3-4P2-4Z4K1M`, all 31,329 vertices, the map whose bowl
 * this was (`tools/rmg-diff-stages.ts`).
 *
 * PRECISION. The engine multiplies by RECIPROCALS held as f32 (`1/42`, `1/10`,
 * `1/29`, `1/13`, `1/3` and `1/0.15` — read out of the editor's own .data), and
 * rounds the two hoisted sines and the dist term to f32 before using them. In
 * that order and with those roundings the double arithmetic here reproduces the
 * x87 result exactly; dividing instead of multiplying does not.
 */
export function baseField(h: HeightPlane, input: HeightsInput, ar: Arith = DOUBLES): void {
  const { size } = input;
  const R42 = fl(1 / 42), R10 = fl(1 / 10), R29 = fl(1 / 29), R13 = fl(1 / 13);
  const R3 = fl(1 / 3), SCALE = fl(1 / 0.15);
  // THE GAME'S SHAPE IS NOT THE EDITOR'S WITH CHOPPED OPERATIONS — it is a
  // different expression (`0xECF9A0`, read instruction by instruction). The
  // row arguments are DIVIDED in single (`divss` by 10.0f and 42.0f) where the
  // editor multiplies by f32 reciprocals in double; the two row sines are
  // KEPT DOUBLE (`movsd`) where the editor rounds them to f32 (`fstp dword`);
  // the column product is formed `cos(j/13) * A * B * sin(j/29)` in double,
  // where the editor forms `sin(o/29) * cos(o/13)` first; the scale is a
  // double DIVIDE by 0.15 where the editor multiplies by 6.6666665f; the
  // dist term is `divss` by 3.0f; `+ dterm + 12.0` and `min 3.0` run in
  // double and the one single rounding is the `cvtpd2ps` at the end. So the
  // two builds are two blocks here, and each is the one its disassembly says.
  const game = ar !== DOUBLES;
  // The engine's outer loop; `n` is this port's second index.
  for (let n = 0; n <= size; n++) {
    const A = game ? Math.sin(ar.div(n, 10)) : fl(Math.sin(n * R10));
    const B = game ? Math.sin(ar.div(n, 42)) : fl(Math.sin(n * R42));
    for (let o = 0; o <= size; o++) {
      const ri = Math.min(n, size - 1);
      const ci = Math.min(o, size - 1);
      let dterm = game ? ar.store(ar.div(input.border[ri]![ci]!, 3)) : fl(input.border[ri]![ci]! * R3);
      const race = input.raceOf(input.grid[ri]![ci]!);
      if (race === RACE.INFERNO || race === RACE.NECROMANCY) dterm = fl(-dterm);
      let val: number;
      if (game) {
        let p = Math.cos(ar.div(o, 13)) * A;
        p = p * B;
        p = Math.sin(ar.div(o, 29)) * p;
        // MEASURED, not read: against the game's own stage-0 plane a divide
        // by 0.15 leaves 259 vertices one ulp off, the multiply by the f32
        // reciprocal 6.6666665 fixes 128 of them and breaks none, and no
        // other rounding in a grid of 96 does better — so the constant the
        // disassembly was read as `0.15` is the reciprocal after all.
        val = p * SCALE;
        val = val + dterm;
        val = val + 12.0;
      } else {
        let p = Math.sin(o * R29) * Math.cos(o * R13);
        p = p * A;
        p = p * B;
        val = p * SCALE;
        val = val + dterm;
        val = val + 12.0;
      }
      // The engine stores the capped value to a f32 slot and passes THAT to
      // the add, so the value rounds twice: once here, once into the plane.
      heightAdd(h, o, n, ar.store(Math.min(val, 3.0)), ar);
      if (o < size && n < size && (input.occupancy[o * size + n]! & 0x18) !== 0) {
        heightAdd(h, n, o, -1.0, ar);
        heightAdd(h, n + 1, o, -1.0, ar);
        heightAdd(h, n, o + 1, -1.0, ar);
        heightAdd(h, n + 1, o + 1, -1.0, ar);
      }
    }
  }
}

/**
 * The lake dents — the orchestrator's own loop between the base field and
 * the craters: every 0x80 tile takes -0.5 on its four corners and leaves
 * the smoothing mask.
 */
export function lakeDents(
  h: HeightPlane, mask: Uint8Array, occupancy: Uint8Array, size: number, ar: Arith = DOUBLES,
): void {
  for (let o = 0; o < size; o++) {
    for (let n = 0; n < size; n++) {
      if ((occupancy[o * size + n]! & 0x80) === 0) continue;
      heightAdd(h, n, o, -0.5, ar);
      heightAdd(h, n + 1, o, -0.5, ar);
      heightAdd(h, n, o + 1, -0.5, ar);
      heightAdd(h, n + 1, o + 1, -0.5, ar);
      mask[o * size + n] = 0;
    }
  }
}

/** `0xEB2420` — set every listed vertex to their average + delta. */
function setToAverage(
  h: HeightPlane, points: ReadonlyArray<readonly [number, number]>, delta: number, ar: Arith,
): void {
  if (points.length === 0) return;
  let sum = 0; // x87: the accumulation stays double
  for (const [first, second] of points) {
    sum = ar.add(sum, h.mem[Math.trunc(second) * h.v + Math.trunc(first)]!);
  }
  const v = ar.store(ar.add(ar.div(sum, points.length), delta));
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
export function craterPass(h: HeightPlane, input: HeightsInput, ar: Arith = DOUBLES): void {
  const { size } = input;
  for (const obj of input.objects) {
    if (obj.floor !== 0) continue;
    if (obj.craterTown) craterOne(h, size, obj, 1, fl(8.0), -1.0, ar);
    if (obj.craterDwelling) craterOne(h, size, obj, 0, fl(2.5), -2.5, ar);
  }
}

function craterOne(
  h: HeightPlane, size: number, obj: HeightObject, plusOne: number, radius: number, delta: number, ar: Arith,
): void {
  // Engine +0x44 pairs the o axis and +0x48 the n axis — the port's y and
  // x respectively; the +0x48 difference squares FIRST (the addss order).
  //
  // THE SCAN IS n-OUTER. In double the 193 values of a town's crater sum the
  // same in any order, so the editor never said which; the game's single
  // chopping sum does, and against its own plane (`_tmp/crater-sum`) the
  // n-outer walk gives the crater's value to the bit — 7.874853 where
  // o-outer gives 7.874857, eight ulps off. The editor's plane is unchanged.
  const points: Array<readonly [number, number]> = [];
  for (let n = 0; n < size; n++) {
    for (let o = 0; o < size; o++) {
      const d0 = obj.y - (o + plusOne);
      const d1 = obj.x - (n + plusOne);
      const dz = obj.z - 0;
      const d = Math.sqrt(d1 * d1 + d0 * d0 + dz * dz);
      if (radius > d) points.push([o, n]);
    }
  }
  setToAverage(h, points, delta, ar);
}

/**
 * `0xABE1D0` — the quarter-turn rotate the engine applies to a footprint:
 * the angle normalised into [0, 2pi) by repeated adds, divided by pi/2,
 * plus 0.25, ROUNDED HALF-EVEN to a quadrant. Returns rotated offsets
 * truncated to (signed byte) integers.
 */
export function quarterTurn(angle: number, ar: Arith = DOUBLES): number {
  let a = angle;
  if (a < 0) {
    do { a = ar.add(a, fl(6.2831855)); } while (a < 0);
  }
  const q = ar.add(ar.div(a, fl(1.5707964)), 0.25);
  // x87 fistp rounds half to even.
  let r = Math.round(q);
  if (Math.abs(q - Math.trunc(q)) === 0.5 && r % 2 !== 0) r -= 1;
  return r & 3;
}

export function rotateOffsets(
  offs: ReadonlyArray<Offset>, angle: number, ar: Arith = DOUBLES,
): Array<readonly [number, number]> {
  const r = quarterTurn(angle, ar);
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
  x: number, y: number, rotated: ReadonlyArray<readonly [number, number]>, ar: Arith,
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

  // DOUBLE in both builds: the game's `0xEB1890` sums with `addsd` and divides
  // in double, then chops once — measured on its own planes (stage 2 in,
  // stage 3 out, `_tmp/stage-flatten`): a double sum with a chopped store
  // leaves 0 of 31,329 vertices off, a single chopping sum 342. (The
  // craters' `0xEB2420` is the other way round — see `setToAverage`.)
  let sum = 0; // double
  for (const [px, py] of pts) {
    const yy = Math.trunc(py);
    const xx = Math.trunc(px);
    if (yy < 0 || yy > size || xx < 0 || xx > size) continue;
    sum += h.mem[yy * h.v + xx]!;
  }
  const avg = ar.store(sum / pts.length); // len INCLUDES the skipped points
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
export function flattenPass(h: HeightPlane, mask: Uint8Array, input: HeightsInput, ar: Arith = DOUBLES): void {
  const { size } = input;
  for (const obj of input.objects) {
    if (obj.isStatic || obj.floor !== 0) continue;
    if (obj.skipFlattenTown || obj.skipFlattenDwelling) continue;
    const offs: Offset[] = [...obj.blocked];
    if (obj.firstActive) offs.push(obj.firstActive);
    const rotated = rotateOffsets(offs, obj.rot, ar);
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
    flattenToAverage(h, size, obj.x, obj.y, rotated, ar);
  }
}

/**
 * `0xEB2580` — one double-buffered 3x3 smoothing pass over the interior
 * vertices; kernel 0.8/0.025 with the flag, 0.2/0.1 without. The mask is
 * consulted TRANSPOSED (rows by the column index), and a masked-out
 * vertex copies through verbatim. The nine taps accumulate in the
 * engine's exact addss order.
 */
export function smooth(h: HeightPlane, mask: Uint8Array, size: number, flag: boolean, ar: Arith = DOUBLES): void {
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
      // The game's per-tap mulss/addss is the same line under its machine,
      // and there the ORDER of the nine adds is the whole result: measured
      // against the game's own plane after this pass (`_tmp/stage-local2`,
      // the engine's stage 3 in, its stage 4 out), the order below — the
      // row above, then this row, then the row below, each left to right,
      // the centre in the middle — reproduces every one of the 31,329
      // vertices, and the column-wise order the editor's reading suggested
      // leaves 3,308 of them one ulp off. In double the nine products sum
      // exactly whatever the order, so the editor's result is unchanged.
      let s = ar.mul(H[(r - 1) * v + (c - 1)]!, kn);
      s = ar.add(s, ar.mul(H[(r - 1) * v + c]!, kn));
      s = ar.add(s, ar.mul(H[(r - 1) * v + (c + 1)]!, kn));
      s = ar.add(s, ar.mul(H[r * v + (c - 1)]!, kn));
      s = ar.add(s, ar.mul(H[r * v + c]!, kc));
      s = ar.add(s, ar.mul(H[r * v + (c + 1)]!, kn));
      s = ar.add(s, ar.mul(H[(r + 1) * v + (c - 1)]!, kn));
      s = ar.add(s, ar.mul(H[(r + 1) * v + c]!, kn));
      s = ar.add(s, ar.mul(H[(r + 1) * v + (c + 1)]!, kn));
      t[r * v + c] = ar.store(s);
    }
  }
  for (let r = 1; r <= v - 2; r++) {
    for (let c = 1; c <= v - 2; c++) H[r * v + c] = t[r * v + c]!;
  }
}

/** `0xEB24B0` — set every listed tile's four corners to the min + delta. */
function setToMin(
  h: HeightPlane, tiles: ReadonlyArray<readonly [number, number]>, delta: number, ar: Arith,
): void {
  if (tiles.length === 0) return;
  let m = fl(1000.0);
  for (const [first, second] of tiles) {
    m = Math.min(h.mem[Math.trunc(second) * h.v + Math.trunc(first)]!, m);
  }
  const val = ar.store(ar.add(m, delta));
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
export function lakeFlatten(h: HeightPlane, occupancy: Uint8Array, size: number, ar: Arith = DOUBLES): void {
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
      setToMin(h, members, fl(-0.1), ar);
    }
  }
}

/**
 * The orchestrator `0xECF760` in the game, `0x796E00` in the editor — the
 * whole late pass over floor 0. The plane arrives carrying the constructor
 * fill plus the statics' relief cones; it leaves as the file's height plane
 * (modulo the transpose).
 *
 * `onStage` is what `tools/rmg-diff-stages.ts` reads: the oracle's `stages`
 * dump writes the engine's plane after each of these nine steps, and the
 * numbers here ARE that dump's, so the two line up step for step.
 */
export function latePass(
  h: HeightPlane,
  input: HeightsInput,
  onStage?: (stage: number, h: HeightPlane) => void,
  ar: Arith = DOUBLES,
): void {
  const { size } = input;
  const at = (stage: number): void => onStage?.(stage, h);
  baseField(h, input, ar);
  at(0);
  const mask = new Uint8Array(size * size).fill(1);
  lakeDents(h, mask, input.occupancy, size, ar);
  at(1);
  craterPass(h, input, ar);
  at(2);
  flattenPass(h, mask, input, ar);
  at(3);
  smooth(h, mask, size, true, ar);
  at(4);
  mask.fill(1);
  smooth(h, mask, size, true, ar);
  at(5);
  flattenPass(h, mask, input, ar); // re-zeroes the mask for the last smooth
  at(6);
  lakeFlatten(h, input.occupancy, size, ar);
  at(7);
  smooth(h, mask, size, false, ar);
  at(8);
}

/** The file holds the plane transposed against the engine's memory. */
export function heightsToFile(h: HeightPlane): Float32Array {
  const out = new Float32Array(h.v * h.v);
  for (let r = 0; r < h.v; r++) {
    for (let c = 0; c < h.v; c++) out[r * h.v + c] = h.mem[c * h.v + r]!;
  }
  return out;
}

// THE VORONOI LAYOUT — zones from their graph, the way a Heroes III template
// describes a map without a single coordinate.
//
// Ours, not the engine's: nothing here is read out of an executable, and a
// map laid out this way is our map, not one the engine would have made. It
// exists because the engine's layout cannot be asked for a shape — its zones
// start at random points and grow as blobs, so a five-zone star comes out as
// five blobs anywhere — and because the picture a template like Jebus Cross
// has in mind (four players at the edges, one rich zone in the middle) is
// entirely a consequence of the graph, if the layout listens to it.
//
// Two steps, both classical:
//
//   1. CENTRES BY RELAXATION. Every zone is a disc whose area is its share of
//      the map (`Size` over the floor's sum), and the discs are moved a few
//      hundred times by three springs: joined zones pull together until they
//      touch; any two overlapping discs push apart; start zones push each
//      other away regardless of distance, which is what sends them to the
//      corners. The map's edge is a wall a centre cannot cross.
//
//   2. TILES BY WEIGHTED VORONOI. A tile belongs to the zone whose centre is
//      nearest in units of that zone's weight — a bigger zone reaches
//      further. The cells are convex-ish polygons: a zone in a corner is a
//      wedge, one squeezed by four neighbours is a rounded square. Then a
//      few rounds of Lloyd's relaxation (each centre steps toward its cell's
//      centroid, which evens the cells out) and of weight correction (a cell
//      short of its share reaches further next round), so the areas land on
//      the template's proportions the way the engine's jitter makes them.
//
//   3. JITTER, or the map is the same map every time. The relaxed picture of
//      a star is one picture — the diamond in the middle, four wedges — and
//      with the borders on the same tiles every seed, the passages the engine
//      digs (a straight stretch of border, a draw among its tiles) and the
//      roads to them fell in the same places too. So, from the seed: every
//      centre is SCATTERED a little after the relaxation, and the cut is
//      DOMAIN-WARPED — each tile looks up its zone from a nearby point, the
//      offset a smooth noise field over the map — so the borders wander the
//      way the engine's blobs do, differently every seed. The template's
//      `<LayoutJitter>` scales both, 0 for the bare geometry; the areas still
//      converge, the warp being a bending of the borders, not a bias.
//
// Floors are laid out one at a time — a connection across floors is not a
// spring, it becomes a gate pair later, the same as in the engine's layout.
// The draws: two per zone for the starting centre, two per zone for the
// scatter, and the noise field's lattice, all from the engine's stream.

import type { RmgRandom } from './random.ts';
import type { RmgConnection } from './template.ts';
import type { PlacedZone, ZoneSeed } from './zones.ts';
import type { ZoneLayout } from './layout.ts';

export interface VoronoiInput {
  size: number;
  zones: ZoneSeed[];
  connections: RmgConnection[];
  /** Zone indices the template lets a player start in — they repel each other. */
  startZones: ReadonlySet<number>;
  twoFloors: boolean;
  /** The template's `<LayoutJitter>`, 0..1; 1 is `JITTER_SCATTER`/`JITTER_WARP` of the map's side. */
  jitter: number;
}

/** Relaxation rounds for the centres, and how far a spring moves a disc per round. */
const RELAX_ROUNDS = 300;
const PULL = 0.05;
const PUSH = 0.08;
const SCATTER = 0.02;
/** Rounds of Lloyd + weight correction over the cells. */
const CELL_ROUNDS = 12;
/** How far a centre steps toward its centroid per round (1 = all the way). */
const LLOYD_STEP = 0.5;
/** The nearest a centre may come to the map's edge, in tiles. */
const EDGE = 2;
/** At jitter 1: how far a centre may be scattered, and how far the warp bends a border, as fractions of the side. */
const JITTER_SCATTER = 0.08;
const JITTER_WARP = 0.10;
/** The noise lattice: cells per side; the field is bilinear between them. */
const NOISE_CELLS = 6;

interface Disc {
  index: number;
  /** Target share of the floor's tiles. */
  area: number;
  r: number;
  x: number;
  y: number;
  /** The Voronoi metric's weight — starts at the radius, corrected per round. */
  w: number;
}

export function voronoiLayout(input: VoronoiInput, rng: RmgRandom): ZoneLayout {
  const { size, connections, startZones } = input;
  const floorCount = input.twoFloors ? 2 : 1;
  const joined = new Set(connections.map((c) => pairKey(c.sourceZoneIndex, c.destZoneIndex)));

  const zones: PlacedZone[] = [];
  const floors: Int32Array[][] = [];
  for (let f = 0; f < floorCount; f++) {
    const grid = Array.from({ length: size }, () => new Int32Array(size).fill(-1));
    floors.push(grid);
    const seeds = input.zones.filter((z) => z.floor === f).sort((a, b) => a.index - b.index);
    if (!seeds.length) continue;

    const discs = makeDiscs(seeds, size, rng);
    relax(discs, size, joined, startZones);
    scatter(discs, size, input.jitter, rng);
    const warp = noiseField(size, input.jitter * JITTER_WARP * size, rng);
    const areas = cut(discs, grid, size, warp);
    for (const d of discs) {
      const seed = seeds.find((z) => z.index === d.index)!;
      zones.push({
        ...seed,
        x: Math.round(d.x), y: Math.round(d.y),
        r: Math.trunc(Math.sqrt((areas.get(d.index) ?? 0) / Math.PI)),
      });
    }
  }
  return { zones, floors };
}

const pairKey = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;

/** Every zone a disc of its share of the floor, at a drawn starting point. */
function makeDiscs(seeds: ZoneSeed[], size: number, rng: RmgRandom): Disc[] {
  const sum = seeds.reduce((s, z) => s + z.size, 0);
  return seeds.map((z) => {
    const area = size * size * (z.size / sum);
    const r = Math.sqrt(area / Math.PI);
    // Two draws per zone, inside the walls; the same two the engine's layout
    // spends on a candidate point, though it spends them on many more.
    const x = rng.betweenFloat(EDGE, size - EDGE);
    const y = rng.betweenFloat(EDGE, size - EDGE);
    return { index: z.index, area, r, x, y, w: r };
  });
}

/** Step 3a: every centre moved by a draw of up to the scatter, walls kept — two draws a zone, spent at jitter 0 too. */
function scatter(discs: Disc[], size: number, jitter: number, rng: RmgRandom): void {
  const reach = jitter * JITTER_SCATTER * size;
  for (const d of discs) {
    const dx = rng.betweenFloat(-1, 1);
    const dy = rng.betweenFloat(-1, 1);
    d.x = clamp(d.x + dx * reach, EDGE, size - EDGE);
    d.y = clamp(d.y + dy * reach, EDGE, size - EDGE);
  }
}

/** A smooth offset per tile — two value-noise fields over a coarse lattice, bilinear between the knots. */
export type WarpField = (a: number, b: number) => [number, number];

/**
 * Step 3b's field: `(NOISE_CELLS + 1)^2` knots a component, each a draw in
 * [-1, 1], scaled to `amplitude` tiles. Spent whatever the amplitude, so a
 * template at jitter 0 draws what one at 1 does.
 */
function noiseField(size: number, amplitude: number, rng: RmgRandom): WarpField {
  const n = NOISE_CELLS + 1;
  const kx = new Float64Array(n * n);
  const ky = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    kx[i] = rng.betweenFloat(-1, 1);
    ky[i] = rng.betweenFloat(-1, 1);
  }
  const cell = size / NOISE_CELLS;
  const at = (k: Float64Array, u: number, v: number): number => {
    const fu = Math.min(u / cell, NOISE_CELLS - 1e-9);
    const fv = Math.min(v / cell, NOISE_CELLS - 1e-9);
    const i = Math.floor(fu);
    const j = Math.floor(fv);
    const tu = fu - i;
    const tv = fv - j;
    // Smoothstep on the fractions, so the field has no creases at the knots.
    const su = tu * tu * (3 - 2 * tu);
    const sv = tv * tv * (3 - 2 * tv);
    const k00 = k[i * n + j]!;
    const k10 = k[(i + 1) * n + j]!;
    const k01 = k[i * n + j + 1]!;
    const k11 = k[(i + 1) * n + j + 1]!;
    return (k00 * (1 - su) + k10 * su) * (1 - sv) + (k01 * (1 - su) + k11 * su) * sv;
  };
  return (a, b) => [at(kx, a, b) * amplitude, at(ky, a, b) * amplitude];
}

/** Step 1: the three springs, `RELAX_ROUNDS` times, walls kept. */
function relax(discs: Disc[], size: number, joined: ReadonlySet<string>, startZones: ReadonlySet<number>): void {
  const dx = new Float64Array(discs.length);
  const dy = new Float64Array(discs.length);
  for (let round = 0; round < RELAX_ROUNDS; round++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!;
        const b = discs[j]!;
        let ex = b.x - a.x;
        let ey = b.y - a.y;
        let d = Math.sqrt(ex * ex + ey * ey);
        if (d < 1e-6) {
          // Two discs on one point have no direction between them; give them
          // one that depends on nothing drawn, so the layout stays repeatable.
          ex = (i + 1) * 0.7; ey = (j + 1) * 0.3; d = Math.sqrt(ex * ex + ey * ey);
        }
        ex /= d; ey /= d;
        const touch = a.r + b.r;
        let move = 0;
        if (joined.has(pairKey(a.index, b.index)) && d > touch) move = -PULL * (d - touch);
        if (d < touch) move = PUSH * (touch - d);
        if (startZones.has(a.index) && startZones.has(b.index)) move += SCATTER * size;
        // `move` > 0 parts the pair, < 0 closes it; each disc takes half.
        dx[i]! -= ex * move / 2; dy[i]! -= ey * move / 2;
        dx[j]! += ex * move / 2; dy[j]! += ey * move / 2;
      }
    }
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i]!;
      d.x = clamp(d.x + dx[i]!, EDGE, size - EDGE);
      d.y = clamp(d.y + dy[i]!, EDGE, size - EDGE);
    }
  }
}

/**
 * Step 2: cut the tiles as weighted Voronoi cells, `CELL_ROUNDS` times over
 * with the centres and weights corrected between rounds. Returns each zone's
 * final tile count; the grid holds the final cut.
 */
function cut(discs: Disc[], grid: Int32Array[], size: number, warp: WarpField): Map<number, number> {
  const counts = new Map<number, number>();
  const sumX = new Map<number, number>();
  const sumY = new Map<number, number>();
  for (let round = 0; round <= CELL_ROUNDS; round++) {
    counts.clear(); sumX.clear(); sumY.clear();
    for (let a = 0; a < size; a++) {
      const row = grid[a]!;
      for (let b = 0; b < size; b++) {
        // The tile asks from a nearby point, not from itself: the warp.
        const [wa, wb] = warp(a + 0.5, b + 0.5);
        let best = -1;
        let bestScore = Infinity;
        for (const d of discs) {
          const ex = a + 0.5 + wa - d.x;
          const ey = b + 0.5 + wb - d.y;
          const score = Math.sqrt(ex * ex + ey * ey) / d.w;
          if (score < bestScore) { bestScore = score; best = d.index; }
        }
        row[b] = best;
        counts.set(best, (counts.get(best) ?? 0) + 1);
        sumX.set(best, (sumX.get(best) ?? 0) + a + 0.5);
        sumY.set(best, (sumY.get(best) ?? 0) + b + 0.5);
      }
    }
    if (round === CELL_ROUNDS) break;
    for (const d of discs) {
      const n = counts.get(d.index) ?? 0;
      if (n === 0) {
        // A cell that vanished reaches further next round and stays put.
        d.w *= 1.5;
        continue;
      }
      d.x += (sumX.get(d.index)! / n - d.x) * LLOYD_STEP;
      d.y += (sumY.get(d.index)! / n - d.y) * LLOYD_STEP;
      d.w *= Math.sqrt(d.area / n);
    }
  }
  return counts;
}

const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v;

// Planning a fill: painted tiles plus a preset, in — placements out.
//
// This is the original editor's fill algorithm (CFillState, 0x490a70 in
// H5_MapEditor.exe), reimplemented rather than emulated. Everything it decides
// is decided here, and nothing here touches the map, the scene or Electron: a
// plan is a list of "put this shared definition at this spot, facing this way",
// which is exactly what a test can check and what the channel then places.
//
// What the original does, and what we kept:
//
//   * layers are applied LAST FIRST. The clearance rule below is first come,
//     first served, so the order decides who wins a contested spot — and the
//     preset's last layers are its trees. Applied the other way round, a wood
//     comes out as grass with the occasional tree that found room.
//   * a layer is held clear of the painted edge by the widths of every layer
//     BEFORE it, not by its own. One number per layer, and a preset reads as
//     bands: grass to the border, bushes half a tile in, trees further still.
//   * candidates sit on a regular lattice of the layer's Dispersion, starting
//     half a step in. The scatter is not jitter — it comes from each candidate
//     being drawn at random from the layer and then kept only with its own
//     probability.
//   * an object claims a radius (`Size`) that keeps it away from the edge AND
//     from every object already placed.
//
// Two of the original's habits we did NOT keep, because they are slips rather
// than design (see docs/FILL_TOOL.md):
//
//   * it draws the facing as `rand() % 15 * 22.5°`, so a full turn is 16 steps
//     and the sixteenth never comes up. Ours draws 16.
//   * it picks a member of a random group with `rand() % (count - 1)`, so the
//     last member of every group is unreachable. Ours draws from all of them.

import type { FillLayer, FillObject, FillPreset } from './preset.ts';

/** A painted tile. The tile (x, y) covers the square [x, x+1) x [y, y+1). */
export interface FillCell { x: number; y: number }

/**
 * One thing to place: which definition, where, and facing which way.
 *
 * `x`/`y` are in tiles and fractional — the same free coordinates Alt-placement
 * uses, since a fill lattice does not land on tile centres.
 */
export interface FillPlacement {
  shared: string;
  type: string;
  x: number;
  y: number;
  /** Facing, radians. */
  r: number;
  /** Which layer of the preset put it there — for the report, and for tests. */
  layer: number;
  /** The candidate's own id, as the preset names it. */
  id: string;
}

/** A concrete definition a preset candidate can resolve to. */
export interface FillVariant { shared: string; type: string }

export interface FillPlanOptions {
  /**
   * Members a candidate resolves to, when its shared reference names a random
   * group rather than an object. Called once per placement, so a group scatters
   * across the area instead of resolving to one member for the whole fill.
   *
   * Absent — or returning nothing — means the candidate is placed as written.
   */
  expand?: (o: FillObject) => FillVariant[];
  /**
   * How thick to lay it on: 1 is the preset exactly as written, and the only
   * value that leaves an old fill unchanged. See `thicken`.
   */
  density?: number;
}

/** What a planning run did, beyond the placements themselves. */
export interface FillPlanReport {
  /** Lattice points considered, across every layer. */
  considered: number;
  /** Rejected for being too near the painted edge. */
  nearEdge: number;
  /** Rejected by the candidate's own probability. */
  unlucky: number;
  /** Rejected for standing too close to something already placed. */
  crowded: number;
  /**
   * Painted tiles with something standing in them.
   *
   * The number the density slider is really about: "466 pieces" says nothing
   * about whether the ground shows through, and a preset with four objects per
   * tile in one corner can leave half the wood bare.
   */
  covered: number;
}

export interface FillPlan {
  placements: FillPlacement[];
  report: FillPlanReport;
}

/**
 * How much of a claimed radius has to be free.
 *
 * The original compares `distance * 0.9` against each radius, which lets two
 * objects overlap by a tenth. Kept: it is what makes a shipped-looking wood —
 * at a strict 1.0 the trees of the dense layers thin out visibly.
 */
const CLEARANCE = 0.9;

/** Facings a random angle is drawn from: sixteen steps of 22.5°. */
const ANGLE_STEPS = 16;

/**
 * A small deterministic generator.
 *
 * Seeded rather than Math.random for one reason: a fill has to be reproducible
 * to be testable at all. The same seed and the same painted area give the same
 * wood, and the panel passes a fresh seed per click so two fills differ.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A boundary segment of the painted area, in tile coordinates. */
interface Edge { x0: number; y0: number; x1: number; y1: number }

const key = (x: number, y: number): number => y * 100000 + x;

/** Squared distance from a point to a segment. */
function distToEdge2(px: number, py: number, e: Edge): number {
  const dx = e.x1 - e.x0, dy = e.y1 - e.y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - e.x0) * dx + (py - e.y0) * dy) / len2)) : 0;
  const qx = e.x0 + t * dx, qy = e.y0 + t * dy;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}

/**
 * The painted area, ready to be asked the two questions planning has.
 *
 * Both are local — "is this point inside" and "is the edge nearer than this" —
 * so both go through a per-tile index. A fill over a few thousand tiles has a
 * few thousand lattice points and a few hundred boundary segments, and checking
 * every segment against every point is the one thing here that would not scale.
 */
class Area {
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number;
  private readonly cells = new Set<number>();
  private readonly edges = new Map<number, Edge[]>();

  constructor(cells: readonly FillCell[]) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) {
      this.cells.add(key(c.x, c.y));
      if (c.x < x0) x0 = c.x;
      if (c.y < y0) y0 = c.y;
      if (c.x > x1) x1 = c.x;
      if (c.y > y1) y1 = c.y;
    }
    this.x0 = x0; this.y0 = y0;
    // The far edge of the last tile, not its index: the area covers [x, x+1).
    this.x1 = x1 + 1; this.y1 = y1 + 1;
    // A side with no painted tile beyond it is a boundary — which is true of a
    // hole's rim and of a second, separate blob as much as of the outer rim.
    // The original refuses both cases outright ("Selection has holes or
    // selection is more than one region!") because it walks the outline as a
    // single closed contour. Taking the sides themselves needs no contour, so
    // the tool works on whatever was painted and a hole keeps its clearance.
    for (const c of cells) {
      const k = key(c.x, c.y);
      const push = (e: Edge): void => {
        const at = this.edges.get(k);
        if (at) at.push(e); else this.edges.set(k, [e]);
      };
      if (!this.cells.has(key(c.x, c.y - 1))) push({ x0: c.x, y0: c.y, x1: c.x + 1, y1: c.y });
      if (!this.cells.has(key(c.x, c.y + 1))) push({ x0: c.x, y0: c.y + 1, x1: c.x + 1, y1: c.y + 1 });
      if (!this.cells.has(key(c.x - 1, c.y))) push({ x0: c.x, y0: c.y, x1: c.x, y1: c.y + 1 });
      if (!this.cells.has(key(c.x + 1, c.y))) push({ x0: c.x + 1, y0: c.y, x1: c.x + 1, y1: c.y + 1 });
    }
  }

  get empty(): boolean { return this.cells.size === 0; }

  /** Is this point on a painted tile? */
  inside(px: number, py: number): boolean {
    return this.cells.has(key(Math.floor(px), Math.floor(py)));
  }

  /**
   * Is the painted edge within `d` of this point?
   *
   * Answers the question rather than returning the distance: the caller only
   * ever compares against a threshold, and stopping at the first segment inside
   * it is most of the work saved.
   */
  edgeWithin(px: number, py: number, d: number): boolean {
    if (d <= 0) return false;
    const d2 = d * d;
    const r = Math.ceil(d);
    const cx = Math.floor(px), cy = Math.floor(py);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const list = this.edges.get(key(x, y));
        if (!list) continue;
        for (const e of list) if (distToEdge2(px, py, e) <= d2) return true;
      }
    }
    return false;
  }
}

/** Objects placed so far, indexed by tile so crowding is a local question. */
class Placed {
  private readonly at = new Map<number, Array<{ x: number; y: number; size: number }>>();
  private largest = 0;

  add(x: number, y: number, size: number): void {
    const k = key(Math.floor(x), Math.floor(y));
    const list = this.at.get(k);
    const item = { x, y, size };
    if (list) list.push(item); else this.at.set(k, [item]);
    if (size > this.largest) this.largest = size;
  }

  /**
   * Would something of this radius stand too close to what is already there?
   *
   * Both radii count, and either one is enough to refuse: a big tree keeps
   * grass out of its trunk even though the grass claims nothing.
   */
  crowds(x: number, y: number, size: number): boolean {
    const reach = Math.max(size, this.largest) / CLEARANCE;
    if (reach <= 0) return false;
    const r = Math.ceil(reach);
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let gy = cy - r; gy <= cy + r; gy++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        const list = this.at.get(key(gx, gy));
        if (!list) continue;
        for (const p of list) {
          const d = Math.hypot(p.x - x, p.y - y) * CLEARANCE;
          if (d < size || d < p.size) return true;
        }
      }
    }
    return false;
  }
}

/** The range the density knob runs over. 1 is the preset as its author wrote it. */
export const DENSITY_MIN = 0.25, DENSITY_MAX = 4;

/**
 * The preset, laid on thicker or thinner.
 *
 * Three numbers could each be turned and only one combination makes a slider:
 * dragging it right must never give LESS, and two of the three fail that.
 * Measured over a solid 24x24 square, coverage in tiles:
 *
 *   probability alone   Oak Grove 42 → 59 → 63 → 64%   stalls: the lattice and
 *                       the clearance bound it, and no probability beats them.
 *   pitch alone         Oak Grove 42 → 70 → 60 → 70%   NOT monotonic — a finer
 *                       lattice lands its points elsewhere and loses some.
 *   all three           Oak Grove 42 → 74 → 97 → 100%  monotonic to full cover.
 *
 * So above 1 all three move: more of the drawn candidates are kept, the lattice
 * closes up as the square root (so the count grows with the number, not its
 * square), and each object claims a little less room, which is what lets the
 * last gaps close instead of being refused as crowded.
 *
 * BELOW 1 only the probability drops, since the lattice and the radii are what
 * give a wood its spacing and thinning should not change that.
 *
 * It does NOT hand back the same wood with fewer trees, and it cannot: the
 * generator is one stream, so a candidate that fails its roll skips the draws
 * for its facing and everything after it shifts. Turning the knob re-rolls the
 * wood — measured, 119 of 198 pieces stood somewhere new at 0.5. Keeping the
 * survivors in place would mean a stream per lattice point, which would change
 * what every existing preset plants at 1.
 */
export function thicken(preset: FillPreset, density: number): FillPreset {
  const d = Math.max(DENSITY_MIN, Math.min(DENSITY_MAX, density));
  if (d === 1) return preset;
  const closer = d > 1 ? Math.sqrt(d) : 1;
  return {
    ...preset,
    layers: preset.layers.map((l) => ({
      ...l,
      dispersion: l.dispersion / closer,
      objects: l.objects.map((o) => ({
        ...o,
        probability: Math.min(1, o.probability * d),
        size: o.size / closer,
      })),
    })),
  };
}

/** How far from the painted edge layer `i` starts: every earlier layer's width. */
export function insetOf(layers: readonly FillLayer[], i: number): number {
  let carry = 0;
  for (let j = 0; j < i; j++) carry += layers[j]!.width;
  return carry;
}

/**
 * Plan a fill over the painted cells.
 *
 * Deterministic in (cells, preset, seed): the same three give the same plan,
 * which is what the unit suite asserts on and what makes a fill worth an undo
 * step rather than a surprise.
 */
export function planFill(
  cells: readonly FillCell[],
  authored: FillPreset,
  seed: number,
  opts: FillPlanOptions = {},
): FillPlan {
  // The knob is applied to a COPY of the preset and nothing downstream knows
  // about it: density is a way of reading the recipe, not a fourth thing the
  // planner has to weigh at every point.
  const preset = thicken(authored, opts.density ?? 1);
  const area = new Area(cells);
  const report: FillPlanReport = { considered: 0, nearEdge: 0, unlucky: 0, crowded: 0, covered: 0 };
  const placements: FillPlacement[] = [];
  if (area.empty) return { placements, report };

  const rnd = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]!;
  const placed = new Placed();

  for (let i = preset.layers.length - 1; i >= 0; i--) {
    const layer = preset.layers[i]!;
    const step = layer.dispersion;
    const inset = insetOf(preset.layers, i);
    for (let y = area.y0 + step / 2; y < area.y1; y += step) {
      for (let x = area.x0 + step / 2; x < area.x1; x += step) {
        // Outside the paint entirely: the bounding box is a rectangle and the
        // painted area rarely is. The original leans on its edge distance for
        // this, which only holds while the area is one convex-ish blob.
        if (!area.inside(x, y)) continue;
        report.considered++;
        // The candidate is drawn FIRST, because everything after it is asked
        // about that particular object: its radius, its probability, its
        // facing. Drawing later would decide the spot with one object's numbers
        // and place another.
        const obj = pick(layer.objects);
        if (area.edgeWithin(x, y, inset + obj.size)) { report.nearEdge++; continue; }
        if (rnd() > obj.probability) { report.unlucky++; continue; }
        if (placed.crowds(x, y, obj.size)) { report.crowded++; continue; }
        const variants = opts.expand?.(obj) ?? [];
        const v = variants.length ? pick(variants) : { shared: obj.shared, type: obj.type };
        const still = obj.noRandomAngle || layer.noRandomAngle;
        const r = still ? 0 : Math.floor(rnd() * ANGLE_STEPS) * (Math.PI * 2 / ANGLE_STEPS);
        placed.add(x, y, obj.size);
        placements.push({
          shared: v.shared, type: v.type, id: obj.id,
          x: +x.toFixed(3), y: +y.toFixed(3), r: +r.toFixed(6), layer: i,
        });
      }
    }
  }
  const tiles = new Set<number>();
  for (const p of placements) tiles.add(key(Math.floor(p.x), Math.floor(p.y)));
  report.covered = tiles.size;
  return { placements, report };
}

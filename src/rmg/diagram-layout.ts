// Where the template editor draws the zones when the file keeps no picture.
//
// The diagram is a picture of the GRAPH — which zones are joined — and this
// lays it out from the graph alone, the way the Voronoi layout lays out the
// map (`layout-voronoi.ts`): joined zones pull together, every pair pushes
// apart, and a start zone is pushed outward so the players end up at the
// edges with the treasure between them. Nothing here is the map's layout,
// and nothing here is random: the same template draws the same picture every
// time it is opened, which is what makes a picture the author did not touch
// worth not saving.
//
// The boxes have SIZES, and the picture has none: a zone with a dozen named
// objects is a tall box, and two such boxes need more room between them than
// two bare ones, so the caller may say how big each box is and the springs
// keep boxes from covering one another — and the picture grows as it must;
// the renderer fits its view to it. The positions are the boxes' centres in
// the diagram's units (a bare box is about 210 wide), with the picture
// shifted so nothing is left of, or above, the origin's margin.

import type { RmgConnection, RmgZone } from './template.ts';

export interface DiagramPoint {
  x: number;
  y: number;
}

/** A box's width and height, in the diagram's units. */
export interface DiagramSize {
  w: number;
  h: number;
}

/** A bare zone's box — the renderer's smallest, a header and a few rows. */
export const BARE_BOX: DiagramSize = { w: 210, h: 140 };

/** How many steps the springs settle for — enough for a ring of eight to open into a ring. */
const STEPS = 400;
/** Clear space kept between two boxes' edges. */
const GAP = 70;
/** How hard a start zone is pushed out from the middle, per step. */
const OUTWARD = 3;
/** What the picture keeps clear of the origin, so a box at the edge is not cut. */
const MARGIN = 40;

/**
 * A picture from the graph. Start zones on an outer ring to begin with, the
 * rest on an inner one (a lone inner zone at the very middle) — the picture
 * Jebus Cross has in mind before a single spring has pulled; then the
 * springs, with the boxes' sizes in them. Deterministic: no draw anywhere.
 */
export function layoutDiagram(
  zones: readonly Pick<RmgZone, 'index' | 'canBePlayerStart'>[],
  connections: readonly Pick<RmgConnection, 'sourceZoneIndex' | 'destZoneIndex'>[],
  sizes?: ReadonlyMap<number, DiagramSize>,
): Map<number, DiagramPoint> {
  const out = new Map<number, DiagramPoint>();
  const n = zones.length;
  if (!n) return out;
  const at = new Map<number, number>();
  zones.forEach((z, i) => at.set(z.index, i));
  const size = (i: number): DiagramSize => sizes?.get(zones[i]!.index) ?? BARE_BOX;
  // The rest length of a connection and the ring radii follow the boxes:
  // a box and a half of the biggest one apart.
  const biggest = Math.max(...zones.map((_, i) => Math.max(size(i).w, size(i).h)));
  const rest = biggest * 1.2 + GAP;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const ring = (members: number[], radius: number): void => {
    members.forEach((i, k) => {
      const a = (k / members.length) * Math.PI * 2 - Math.PI / 2;
      xs[i] = 500 + (members.length === 1 ? 0 : radius) * Math.cos(a);
      ys[i] = 500 + (members.length === 1 ? 0 : radius) * Math.sin(a);
    });
  };
  const outer = zones.map((z, i) => (z.canBePlayerStart ? i : -1)).filter((i) => i >= 0);
  const inner = zones.map((z, i) => (z.canBePlayerStart ? -1 : i)).filter((i) => i >= 0);
  ring(outer, rest);
  ring(inner, outer.length ? rest * 0.45 : rest);
  // A pair joined twice pulls twice: the diagram shows two lines and the map gets two passages.
  const edges: [number, number][] = [];
  for (const c of connections) {
    const a = at.get(c.sourceZoneIndex);
    const b = at.get(c.destZoneIndex);
    if (a === undefined || b === undefined || a === b) continue;
    edges.push([a, b]);
  }
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let step = 0; step < STEPS; step++) {
    fx.fill(0);
    fy.fill(0);
    // Every pair apart, harder the closer — and two boxes that COVER each
    // other are pushed out along the axis where they overlap least, so a
    // tall box and its neighbour part sideways rather than sliding along.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let d = Math.hypot(dx, dy);
        if (d < 1) { dx = Math.cos(i); dy = Math.sin(i); d = 1; }
        const si = size(i);
        const sj = size(j);
        const needX = (si.w + sj.w) / 2 + GAP;
        const needY = (si.h + sj.h) / 2 + GAP;
        const apart = Math.max(needX, needY);
        const push = (apart * apart) / (d * d) * 0.5;
        fx[i]! -= (dx / d) * push;
        fy[i]! -= (dy / d) * push;
        fx[j]! += (dx / d) * push;
        fy[j]! += (dy / d) * push;
        const overX = needX - Math.abs(dx);
        const overY = needY - Math.abs(dy);
        if (overX > 0 && overY > 0) {
          const sx = overX <= overY ? Math.sign(dx || 1) * overX * 0.25 : 0;
          const sy = overX <= overY ? 0 : Math.sign(dy || 1) * overY * 0.25;
          fx[i]! -= sx; fy[i]! -= sy;
          fx[j]! += sx; fy[j]! += sy;
        }
      }
    }
    // Joined pairs toward their rest length.
    for (const [a, b] of edges) {
      const dx = xs[b]! - xs[a]!;
      const dy = ys[b]! - ys[a]!;
      const d = Math.max(1, Math.hypot(dx, dy));
      const pull = (d - rest) * 0.02;
      fx[a]! += (dx / d) * pull;
      fy[a]! += (dy / d) * pull;
      fx[b]! -= (dx / d) * pull;
      fy[b]! -= (dy / d) * pull;
    }
    // Start zones outward from the middle of the picture — the centroid of
    // every box — until they stand a rest length and a half out; farther
    // than that is not "at the edge", it is off the picture.
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) { cx += xs[i]!; cy += ys[i]!; }
    cx /= n;
    cy /= n;
    zones.forEach((z, i) => {
      if (!z.canBePlayerStart) return;
      const dx = xs[i]! - cx;
      const dy = ys[i]! - cy;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (d > rest * 1.5) return;
      fx[i]! += (dx / d) * OUTWARD;
      fy[i]! += (dy / d) * OUTWARD;
    });
    // Cooling: big moves early, small ones late, so the picture settles.
    const temperature = 1 - step / STEPS;
    const cap = 20 * temperature + 1;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(fx[i]!, fy[i]!);
      const k = m > cap ? cap / m : 1;
      xs[i] = xs[i]! + fx[i]! * k;
      ys[i] = ys[i]! + fy[i]! * k;
    }
  }
  // Shift the picture so its top-left box sits at the margin; the picture
  // is as big as it is, and the renderer fits its view to it.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  zones.forEach((_, i) => {
    minX = Math.min(minX, xs[i]! - size(i).w / 2);
    minY = Math.min(minY, ys[i]! - size(i).h / 2);
  });
  zones.forEach((z, i) => out.set(z.index, { x: Math.round(xs[i]! - minX + MARGIN), y: Math.round(ys[i]! - minY + MARGIN) }));
  return out;
}

/**
 * Whether two boxes at these centres cover each other — the test's question,
 * and the renderer's when it decides a picture from the file still fits.
 */
export function boxesOverlap(a: DiagramPoint, sa: DiagramSize, b: DiagramPoint, sb: DiagramSize): boolean {
  return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2;
}

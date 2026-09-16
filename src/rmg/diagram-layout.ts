// Where the template editor draws the zones when the file keeps no picture.
//
// The diagram is a picture of the GRAPH — which zones are joined — and this
// lays it out from the graph alone, the way the Voronoi layout lays out the
// map (`layout-voronoi.ts`): joined zones pull together, every pair pushes
// apart, and a start zone is pushed outward so the players end up at the
// edges with the treasure between them. Nothing here is the map's layout,
// and nothing here is random: the same template draws the same picture every
// time it is opened, which is what makes a picture the author did not touch
// worth not saving. The positions are thousandths of the diagram's square,
// centres of the boxes, and the renderer keeps the boxes inside the frame.

import type { RmgConnection, RmgZone } from './template.ts';

export interface DiagramPoint {
  x: number;
  y: number;
}

/** How many steps the springs settle for — enough for a ring of eight to open into a ring. */
const STEPS = 400;
/** The rest length of a connection, in thousandths — about a box and a half apart. */
const REST = 320;
/** The nearest two unjoined boxes are allowed to settle, in thousandths. */
const APART = 300;
/** How hard a start zone is pushed out from the middle, per step. */
const OUTWARD = 3;
/** The frame the centres are kept inside, so a box at the edge still has room. */
const MARGIN = 140;

/**
 * A picture from the graph. Zones on a ring to begin with, in index order,
 * so a template with no connections at all is still readable; then the
 * springs. Deterministic: no draw anywhere.
 */
export function layoutDiagram(zones: readonly Pick<RmgZone, 'index' | 'canBePlayerStart'>[], connections: readonly Pick<RmgConnection, 'sourceZoneIndex' | 'destZoneIndex'>[]): Map<number, DiagramPoint> {
  const out = new Map<number, DiagramPoint>();
  const n = zones.length;
  if (!n) return out;
  const at = new Map<number, number>();
  zones.forEach((z, i) => at.set(z.index, i));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  // Two rings to begin with: the start zones on the outer one, the rest on
  // an inner one (a lone inner zone at the very middle) — the picture Jebus
  // Cross has in mind, before a single spring has pulled.
  const ring = (members: number[], radius: number): void => {
    members.forEach((i, k) => {
      const a = (k / members.length) * Math.PI * 2 - Math.PI / 2;
      xs[i] = 500 + (members.length === 1 ? 0 : radius) * Math.cos(a);
      ys[i] = 500 + (members.length === 1 ? 0 : radius) * Math.sin(a);
    });
  };
  const outer = zones.map((z, i) => (z.canBePlayerStart ? i : -1)).filter((i) => i >= 0);
  const inner = zones.map((z, i) => (z.canBePlayerStart ? -1 : i)).filter((i) => i >= 0);
  ring(outer, 330);
  ring(inner, outer.length ? 140 : 330);
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
    // Every pair apart, harder the closer.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let d = Math.hypot(dx, dy);
        // Two boxes on one spot push along the ring's direction, not nowhere.
        if (d < 1) { dx = Math.cos(i); dy = Math.sin(i); d = 1; }
        const push = (APART * APART) / (d * d) * 0.5;
        fx[i]! -= (dx / d) * push;
        fy[i]! -= (dy / d) * push;
        fx[j]! += (dx / d) * push;
        fy[j]! += (dy / d) * push;
      }
    }
    // Joined pairs toward their rest length.
    for (const [a, b] of edges) {
      const dx = xs[b]! - xs[a]!;
      const dy = ys[b]! - ys[a]!;
      const d = Math.max(1, Math.hypot(dx, dy));
      const pull = (d - REST) * 0.02;
      fx[a]! += (dx / d) * pull;
      fy[a]! += (dy / d) * pull;
      fx[b]! -= (dx / d) * pull;
      fy[b]! -= (dy / d) * pull;
    }
    // Start zones outward from the middle of the picture.
    zones.forEach((z, i) => {
      if (!z.canBePlayerStart) return;
      const dx = xs[i]! - 500;
      const dy = ys[i]! - 500;
      const d = Math.max(1, Math.hypot(dx, dy));
      fx[i]! += (dx / d) * OUTWARD;
      fy[i]! += (dy / d) * OUTWARD;
    });
    // Cooling: big moves early, small ones late, so the picture settles.
    const temperature = 1 - step / STEPS;
    const cap = 20 * temperature + 1;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(fx[i]!, fy[i]!);
      const k = m > cap ? cap / m : 1;
      xs[i] = Math.min(1000 - MARGIN, Math.max(MARGIN, xs[i]! + fx[i]! * k));
      ys[i] = Math.min(1000 - MARGIN, Math.max(MARGIN, ys[i]! + fy[i]! * k));
    }
  }
  zones.forEach((z, i) => out.set(z.index, { x: Math.round(xs[i]!), y: Math.round(ys[i]!) }));
  return out;
}

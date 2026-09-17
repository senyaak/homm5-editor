// A small painter for the art the editor draws itself: icons a faction, a
// creature or a building needs and nobody has drawn.
//
// Vector shapes — polygons, discs, rings, stroked polylines — filled with a
// straight-alpha colour onto an RGBA canvas. There is no anti-aliasing in the
// fill: the painter works at a multiple of the final size and the picture is
// reduced at the end (`resampleTo` averages the block), which is where the
// edges get their softness. Coordinates are in a UNIT SQUARE, 0..1, so a
// glyph drawn once serves a 55-pixel icon and a 128-pixel one alike.

import type { Image } from './dds.ts';
import { resampleTo } from './texture.ts';

/** Straight-alpha RGBA, 0..255. */
export type Color = readonly [number, number, number, number];

export interface Point { x: number; y: number }

export const pt = (x: number, y: number): Point => ({ x, y });

/** A shape's origin is the unit square's; `at`/`scale` move a glyph onto it. */
export interface Placed { at?: Point; scale?: number }

export class Painter {
  readonly rgba: Uint8Array;
  /** The canvas edge in pixels; a unit coordinate maps onto it. */
  readonly size: number;
  constructor(size: number) {
    this.size = size;
    this.rgba = new Uint8Array(size * size * 4);
  }

  /** Blend `c` over the pixel: source-over, straight alpha. */
  private blend(x: number, y: number, c: Color): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const sa = c[3] / 255;
    if (sa <= 0) return;
    const da = this.rgba[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      const sc = c[k]!, dc = this.rgba[i + k]!;
      this.rgba[i + k] = oa ? (sc * sa + dc * da * (1 - sa)) / oa + 0.5 : 0;
    }
    this.rgba[i + 3] = oa * 255 + 0.5;
  }

  /** Every pixel, the same colour — the field a glyph sits on. */
  clear(c: Color): void {
    for (let i = 0; i < this.rgba.length; i += 4) {
      this.rgba[i] = c[0]; this.rgba[i + 1] = c[1]; this.rgba[i + 2] = c[2]; this.rgba[i + 3] = c[3];
    }
  }

  /** A polygon, even-odd, by scanline. */
  polygon(points: readonly Point[], c: Color, p: Placed = {}): void {
    const s = this.size, k = (p.scale ?? 1), ox = p.at?.x ?? 0, oy = p.at?.y ?? 0;
    const xs = points.map((q) => (ox + q.x * k) * s), ys = points.map((q) => (oy + q.y * k) * s);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(s - 1, Math.ceil(Math.max(...ys)));
    const n = points.length;
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const cuts: number[] = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ya = ys[i]!, yb = ys[j]!;
        if ((ya <= cy) === (yb <= cy)) continue;
        cuts.push(xs[i]! + (cy - ya) / (yb - ya) * (xs[j]! - xs[i]!));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i += 2) {
        for (let x = Math.max(0, Math.round(cuts[i]!)); x < Math.min(s, Math.round(cuts[i + 1]!)); x++) this.blend(x, y, c);
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: Color, p: Placed = {}): void {
    this.polygon(circle(cx, cy, r), c, p);
  }

  /**
   * A disc with a hole, as a fan of quads. One polygon with the inner edge
   * run backwards is the textbook way and it leaves hairline slits where the
   * two edges are joined and where a vertex sits on a scanline; the quads
   * overlap by nothing and share every edge.
   */
  ring(cx: number, cy: number, r: number, width: number, c: Color, p: Placed = {}): void {
    const outer = circle(cx, cy, r), inner = circle(cx, cy, r - width);
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      this.polygon([outer[i]!, outer[j]!, inner[j]!, inner[i]!], c, p);
    }
  }

  /** A polyline of `width`, round-joined: one quad per segment and a disc per joint. */
  stroke(points: readonly Point[], width: number, c: Color, p: Placed = {}): void {
    const h = width / 2;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * h, ny = dx / len * h;
      this.polygon([pt(a.x + nx, a.y + ny), pt(b.x + nx, b.y + ny), pt(b.x - nx, b.y - ny), pt(a.x - nx, a.y - ny)], c, p);
    }
    for (const q of points) this.disc(q.x, q.y, h, c, p);
  }

  rect(x: number, y: number, w: number, h: number, c: Color, p: Placed = {}): void {
    this.polygon([pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)], c, p);
  }

  /** The canvas at `size` pixels, reduced from the working resolution. */
  image(size: number): Image {
    return resampleTo({ width: this.size, height: this.size, rgba: this.rgba }, size, size);
  }
}

/** A circle as a polygon: enough sides to be round at any size drawn here. */
export function circle(cx: number, cy: number, r: number, sides = 64): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push(pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

/** A regular star: `points` tips at `r`, dips at `inner`. */
export function star(cx: number, cy: number, r: number, inner: number, points = 5): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const d = i % 2 ? inner : r;
    out.push(pt(cx + Math.cos(a) * d, cy + Math.sin(a) * d));
  }
  return out;
}

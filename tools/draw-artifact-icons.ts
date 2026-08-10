// The icons for the mod's own artifacts, DRAWN rather than borrowed.
//
//   node tools/draw-artifact-icons.ts
//
// Three of the stand's artifacts had no art and wore somebody else's — the
// prism and the focus both showed the undertaker's amulet, the helm showed a
// vampire's cloak. That is worse than an ugly icon: on the hero screen the
// picture IS the identity of the thing, and two different artifacts drawn the
// same is a bug report waiting to happen ("the amulet does nothing" — it was
// never the amulet).
//
// So they are drawn here, in code, badly and on purpose: shapes anybody can
// edit without an art program, and a script that can be re-run when a number
// changes. Each is drawn at 4x and averaged down, which is all the smoothing a
// 64x64 icon needs.
//
// The output goes to assets/artifacts/, which is what e2e/mods.ts points the
// fixtures at, and is committed — the build reads a picture from disk.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngDataUri } from '../src/format/png.ts';
import { resampleTo } from '../src/format/texture.ts';
import type { Image } from '../src/format/gif.ts';

const SIZE = 64;
/** How much bigger the drawing is than the icon, before it is averaged down. */
const OVER = 4;
const N = SIZE * OVER;

type RGBA = [number, number, number, number];

/** A canvas to scribble on: straight RGBA, transparent to start with. */
function canvas(): Uint8Array {
  return new Uint8Array(N * N * 4);
}

function put(px: Uint8Array, x: number, y: number, [r, g, b, a]: RGBA): void {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  if (a >= 255) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    return;
  }
  // Straight alpha over what is already there — enough for a glow on a rim.
  const was = px[i + 3]! / 255;
  const now = a / 255;
  const out = now + was * (1 - now);
  if (!out) return;
  px[i] = (r * now + px[i]! * was * (1 - now)) / out;
  px[i + 1] = (g * now + px[i + 1]! * was * (1 - now)) / out;
  px[i + 2] = (b * now + px[i + 2]! * was * (1 - now)) / out;
  px[i + 3] = out * 255;
}

/** Fill every pixel a test says yes to. The lazy way to draw a shape. */
function fill(px: Uint8Array, inside: (x: number, y: number) => RGBA | null): void {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = inside((x + 0.5) / N, (y + 0.5) / N);
      if (c) put(px, x, y, c);
    }
  }
}

/** Distance from a point to a segment, in the 0..1 space the shapes use. */
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Is the point inside the polygon? Even-odd, which is enough for convex art. */
function inPoly(x: number, y: number, pts: [number, number][]): boolean {
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/** Lighter towards the top left, which is where every icon here is lit from. */
function shade([r, g, b, a]: RGBA, amount: number): RGBA {
  const k = 1 + amount;
  return [Math.max(0, Math.min(255, r * k)), Math.max(0, Math.min(255, g * k)),
    Math.max(0, Math.min(255, b * k)), a];
}

const OUTLINE: RGBA = [18, 14, 24, 255];

function save(name: string, px: Uint8Array): void {
  const big: Image = { width: N, height: N, rgba: px };
  const small = resampleTo(big, SIZE, SIZE);
  const uri = pngDataUri(small.width, small.height, small.rgba);
  const bytes = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  const here = join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'artifacts');
  writeFileSync(join(here, name), bytes);
  console.log(`${name} — ${bytes.length} bytes`);
}

// --- the prism: one gem, four elements ---------------------------------------
//
// A tall diamond cut into four wedges from its centre, one per element in the
// engine's own order — air, fire, water, earth — so the icon says what the
// artifact does rather than being a pretty stone.

function prism(): void {
  const px = canvas();
  const cx = 0.5, cy = 0.52;
  const body: [number, number][] = [[0.5, 0.06], [0.86, 0.5], [0.5, 0.95], [0.14, 0.5]];
  const AIR: RGBA = [225, 240, 255, 255];
  const FIRE: RGBA = [232, 96, 40, 255];
  const WATER: RGBA = [64, 140, 232, 255];
  const EARTH: RGBA = [120, 96, 56, 255];
  fill(px, (x, y) => {
    if (!inPoly(x, y, body)) return null;
    // The rim, drawn by distance to the four edges rather than by a second poly.
    const edge = Math.min(
      toSegment(x, y, 0.5, 0.06, 0.86, 0.5), toSegment(x, y, 0.86, 0.5, 0.5, 0.95),
      toSegment(x, y, 0.5, 0.95, 0.14, 0.5), toSegment(x, y, 0.14, 0.5, 0.5, 0.06));
    if (edge < 0.022) return OUTLINE;
    const left = x < cx, top = y < cy;
    const base = top ? (left ? AIR : FIRE) : (left ? EARTH : WATER);
    // A facet each, and a highlight where the light would catch the top left.
    const lit = 0.28 - Math.hypot(x - 0.36, y - 0.34) * 0.8;
    return shade(base, Math.max(-0.25, lit));
  });
  // The cuts between the facets, so four colours read as one cut stone.
  fill(px, (x, y) => {
    if (!inPoly(x, y, body)) return null;
    const cut = Math.min(Math.abs(x - cx), Math.abs(y - cy));
    return cut < 0.012 ? [40, 34, 52, 200] : null;
  });
  save('h3_elemental_prism.png', px);
}

// --- the focus: a ring with one stone -----------------------------------------
//
// Magic of no element at all, so nothing on it is coloured for one: a plain gold
// band and a violet stone, which is what every "spell power" trinket in the game
// looks like and is therefore what an author will recognise.

function focus(): void {
  const px = canvas();
  fill(px, (x, y) => {
    const d = Math.hypot(x - 0.5, (y - 0.58) * 1.06);
    const outer = 0.34, inner = 0.2;
    if (d > outer || d < inner) return null;
    const rim = Math.min(outer - d, d - inner);
    if (rim < 0.022) return OUTLINE;
    const gold: RGBA = [214, 168, 62, 255];
    return shade(gold, 0.3 - (y - 0.3) * 0.9);
  });
  // The stone, sitting on the band's top.
  fill(px, (x, y) => {
    const d = Math.hypot((x - 0.5) * 1.25, (y - 0.2) * 1.05);
    if (d > 0.19) return null;
    if (d > 0.165) return OUTLINE;
    const stone: RGBA = [148, 74, 214, 255];
    return shade(stone, 0.45 - d * 3.2);
  });
  // And its glint — three pixels of white is what makes a stone look polished.
  fill(px, (x, y) => (Math.hypot((x - 0.45) * 1.4, (y - 0.15) * 1.4) < 0.035
    ? [255, 244, 255, 220] : null));
  save('h3_magic_focus.png', px);
}

// --- the helm: what it gives and what it takes ---------------------------------
//
// Steel, a red crest, and a CRACKED violet stone on the brow. The crack is the
// point: this is the one artifact of the stand's whose bonus is negative, and an
// icon that promised magic would be a lie told in the only place a player looks.

function helm(): void {
  const px = canvas();
  const dome: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI * (i / 24);
    dome.push([0.5 - Math.cos(t) * 0.33, 0.62 - Math.sin(t) * 0.34]);
  }
  dome.push([0.83, 0.82], [0.17, 0.82]);
  // The crest first, so the dome's outline is drawn over its foot.
  fill(px, (x, y) => {
    const d = toSegment(x, y, 0.5, 0.06, 0.5, 0.3);
    if (d > 0.075) return null;
    if (d > 0.055) return OUTLINE;
    return shade([196, 54, 46, 255], 0.35 - x);
  });
  fill(px, (x, y) => {
    if (!inPoly(x, y, dome)) return null;
    let edge = 1;
    for (let i = 1; i < dome.length; i++) {
      edge = Math.min(edge, toSegment(x, y, dome[i - 1]![0], dome[i - 1]![1], dome[i]![0], dome[i]![1]));
    }
    edge = Math.min(edge, toSegment(x, y, dome[dome.length - 1]![0], dome[dome.length - 1]![1],
      dome[0]![0], dome[0]![1]));
    if (edge < 0.022) return OUTLINE;
    const steel: RGBA = [150, 158, 172, 255];
    return shade(steel, 0.34 - Math.hypot(x - 0.38, y - 0.34) * 0.7);
  });
  // The eye slit and the nose guard, which are the whole silhouette of a helm.
  fill(px, (x, y) => {
    if (y < 0.6 || y > 0.7 || x < 0.2 || x > 0.8) return null;
    if (Math.abs(x - 0.5) < 0.06) return null;
    return [26, 24, 34, 255];
  });
  fill(px, (x, y) => (Math.abs(x - 0.5) < 0.055 && y > 0.5 && y < 0.82
    ? shade([132, 140, 156, 255], 0.2 - Math.abs(x - 0.47) * 3) : null));
  // The brow stone, cracked: violet, with a dark split through it.
  fill(px, (x, y) => {
    const d = Math.hypot((x - 0.5) * 1.2, (y - 0.44) * 1.35);
    if (d > 0.12) return null;
    if (d > 0.1) return OUTLINE;
    const crack = Math.min(toSegment(x, y, 0.47, 0.36, 0.52, 0.44),
      toSegment(x, y, 0.52, 0.44, 0.46, 0.52));
    if (crack < 0.012) return [30, 16, 40, 255];
    return shade([132, 66, 190, 255], 0.4 - d * 3.4);
  });
  save('h3_war_mage_helm.png', px);
}

prism();
focus();
helm();

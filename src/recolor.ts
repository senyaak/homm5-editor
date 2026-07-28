// Recolouring a texture's pixels — the arithmetic behind the Recolor dialog.
//
// One function over raw RGBA, used twice: the renderer runs it on a canvas's
// ImageData for the live preview, and the main process runs it on the decoded
// DDS when the mod is rewritten. One implementation is what keeps the preview
// honest — what you saw is what got written.
//
// The alpha channel is never touched: on a creature texture it is the cut-out
// of the silhouette (AM_ALPHA_TEST), and "recoloured" must not mean "eroded".

/**
 * A palette remap: pixels belong to the CLUSTER whose hue centre is nearest,
 * and only clusters given a target colour change — the cloak goes grey, the
 * skin stays skin. Below `GREY_SAT` a pixel is in the neutral cluster (centre
 * -1) regardless of hue: a hue means nothing at that saturation.
 */
export interface PaletteRemap {
  /** Every cluster centre in hue degrees, plus -1 for the neutral cluster. */
  centres: number[];
  /** Target colour per centre INDEX; a missing index leaves that cluster be. */
  to: Record<number, { r: number; g: number; b: number }>;
}

/** What to do to the colours. Everything optional; nothing means identity. */
export interface RecolorOps {
  /** Per-cluster palette remap, applied first. */
  palette?: PaletteRemap;
  /** Hue rotation, in degrees. */
  hue?: number;
  /** Saturation multiplier — 0 makes it grey, 1 leaves it, 2 doubles it. */
  saturation?: number;
  /** Added lightness, -1..1 of the full range. */
  lightness?: number;
  /** Blend every pixel toward this colour, keeping its lightness shape. */
  tint?: { r: number; g: number; b: number; strength: number };
}

/** Is there anything to do at all? An identity op skips the rewrite. */
export function isIdentity(ops: RecolorOps): boolean {
  return (ops.hue ?? 0) === 0 && (ops.saturation ?? 1) === 1 && (ops.lightness ?? 0) === 0
    && !(ops.tint && ops.tint.strength > 0)
    && !(ops.palette && Object.keys(ops.palette.to).length > 0);
}

/** Saturation below which a pixel is "grey" — the neutral palette cluster. */
export const GREY_SAT = 0.12;

/** One dominant colour of a texture set, as the palette UI shows it. */
export interface PaletteEntry {
  /** The cluster's hue centre in degrees, or -1 for the neutral cluster. */
  hue: number;
  /** A representative colour, for the swatch. */
  r: number;
  g: number;
  b: number;
  /** Share of the (visible, saturated) pixels, 0..1 — for ordering. */
  weight: number;
}

/**
 * The dominant hues of a texture set — the palette the remap works over.
 *
 * Histogram over hue in 15° bins (visible pixels only; greys counted apart),
 * merged into runs around the peaks, largest `maxColors` kept. Deliberately
 * plain: the point is swatches a person recognises — "the green, the brown,
 * the gold" — not a perceptually optimal quantisation.
 */
export function extractPalette(images: ReadonlyArray<Uint8Array | Uint8ClampedArray>, maxColors = 6): PaletteEntry[] {
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  const grey = { n: 0, r: 0, g: 0, b: 0 };
  let visible = 0;
  for (const rgba of images) {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3]! < 128) continue;
      visible++;
      const [h, s] = rgbToHsl(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      const at = s < GREY_SAT ? grey : bins[Math.min(BINS - 1, Math.floor(h * BINS))]!;
      at.n++; at.r += rgba[i]!; at.g += rgba[i + 1]!; at.b += rgba[i + 2]!;
    }
  }
  if (!visible) return [];

  // A cluster is a run of non-empty neighbouring bins around a local peak; a
  // texture's "green" spans several bins and must not become several swatches.
  const floor = Math.max(16, visible * 0.004);
  const used = new Array<boolean>(BINS).fill(false);
  const clusters: PaletteEntry[] = [];
  for (;;) {
    let peak = -1;
    for (let i = 0; i < BINS; i++) {
      if (!used[i] && bins[i]!.n > floor && (peak < 0 || bins[i]!.n > bins[peak]!.n)) peak = i;
    }
    if (peak < 0) break;
    const run = { n: 0, r: 0, g: 0, b: 0, hx: 0, hy: 0 };
    const take = (i: number): void => {
      const b = bins[((i % BINS) + BINS) % BINS]!;
      used[((i % BINS) + BINS) % BINS] = true;
      run.n += b.n; run.r += b.r; run.g += b.g; run.b += b.b;
      // The centre averages on the hue CIRCLE — bins 23 and 0 are neighbours.
      const a = ((i + 0.5) / BINS) * 2 * Math.PI;
      run.hx += b.n * Math.cos(a); run.hy += b.n * Math.sin(a);
    };
    take(peak);
    for (let d = 1; d < BINS / 2; d++) {
      const at = (peak + d) % BINS;
      if (used[at] || bins[at]!.n <= floor) break;
      take(peak + d);
    }
    for (let d = 1; d < BINS / 2; d++) {
      const at = ((peak - d) % BINS + BINS) % BINS;
      if (used[at] || bins[at]!.n <= floor) break;
      take(peak - d);
    }
    const hue = ((Math.atan2(run.hy, run.hx) * 180 / Math.PI) + 360) % 360;
    clusters.push({
      hue, weight: run.n / visible,
      r: Math.round(run.r / run.n), g: Math.round(run.g / run.n), b: Math.round(run.b / run.n),
    });
  }
  clusters.sort((a, b) => b.weight - a.weight);
  const out = clusters.slice(0, maxColors);
  if (grey.n > floor) {
    out.push({
      hue: -1, weight: grey.n / visible,
      r: Math.round(grey.r / grey.n), g: Math.round(grey.g / grey.n), b: Math.round(grey.b / grey.n),
    });
  }
  return out;
}

/** Distance between two hues on the circle, in degrees. */
const hueDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Apply `ops` to RGBA pixels, in place. Alpha rides through untouched. */
export function recolorPixels(rgba: Uint8Array | Uint8ClampedArray, ops: RecolorOps): void {
  const hue = (ops.hue ?? 0) / 360;
  const sat = ops.saturation ?? 1;
  const light = ops.lightness ?? 0;
  const tint = ops.tint && ops.tint.strength > 0 ? ops.tint : null;
  // The palette remap, precomputed: each remapped centre's target hue and
  // saturation. Lightness is the pixel's own — that is where the drawing lives.
  const remap = ops.palette && Object.keys(ops.palette.to).length ? ops.palette : null;
  const targets = remap
    ? Object.entries(remap.to).map(([i, c]) => {
      const [th, ts] = rgbToHsl(c.r, c.g, c.b);
      return { index: Number(i), h: th, s: ts };
    })
    : [];
  for (let i = 0; i < rgba.length; i += 4) {
    let [h, s, l] = rgbToHsl(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    if (remap) {
      // Which cluster is this pixel's: the neutral one below GREY_SAT, else
      // the nearest hue centre.
      let cluster = -1;
      if (s < GREY_SAT) {
        cluster = remap.centres.indexOf(-1);
      } else {
        let best = Infinity;
        for (let c = 0; c < remap.centres.length; c++) {
          if (remap.centres[c] === -1) continue;
          const d = hueDist(h * 360, remap.centres[c]!);
          if (d < best) { best = d; cluster = c; }
        }
      }
      const target = targets.find((t) => t.index === cluster);
      if (target) { h = target.h; s = target.s; }
    }
    h = (h + hue + 1) % 1;
    s = Math.min(1, Math.max(0, s * sat));
    l = Math.min(1, Math.max(0, l + light));
    let [r, g, b] = hslToRgb(h, s, l);
    if (tint) {
      const k = Math.min(1, tint.strength);
      // The tint carries the pixel's own lightness, so shading survives: a flat
      // mix toward one colour would erase the drawing.
      const shade = l * 2; // 0..2 — below 1 darkens the tint, above lightens it
      const tr = shade <= 1 ? tint.r * shade : tint.r + (255 - tint.r) * (shade - 1);
      const tg = shade <= 1 ? tint.g * shade : tint.g + (255 - tint.g) * (shade - 1);
      const tb = shade <= 1 ? tint.b * shade : tint.b + (255 - tint.b) * (shade - 1);
      r = r + (tr - r) * k;
      g = g + (tg - g) * k;
      b = b + (tb - b) * k;
    }
    rgba[i] = Math.round(r);
    rgba[i + 1] = Math.round(g);
    rgba[i + 2] = Math.round(b);
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const c = (t: number): number => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [c(h + 1 / 3) * 255, c(h) * 255, c(h - 1 / 3) * 255];
}

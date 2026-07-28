// Recolouring a texture's pixels — the arithmetic behind the Recolor dialog.
//
// One function over raw RGBA, used twice: the renderer runs it on a canvas's
// ImageData for the live preview, and the main process runs it on the decoded
// DDS when the mod is rewritten. One implementation is what keeps the preview
// honest — what you saw is what got written.
//
// The alpha channel is never touched: on a creature texture it is the cut-out
// of the silhouette (AM_ALPHA_TEST), and "recoloured" must not mean "eroded".

/** What to do to the colours. Everything optional; nothing means identity. */
export interface RecolorOps {
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
    && !(ops.tint && ops.tint.strength > 0);
}

/** Apply `ops` to RGBA pixels, in place. Alpha rides through untouched. */
export function recolorPixels(rgba: Uint8Array | Uint8ClampedArray, ops: RecolorOps): void {
  const hue = (ops.hue ?? 0) / 360;
  const sat = ops.saturation ?? 1;
  const light = ops.lightness ?? 0;
  const tint = ops.tint && ops.tint.strength > 0 ? ops.tint : null;
  for (let i = 0; i < rgba.length; i += 4) {
    let [h, s, l] = rgbToHsl(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
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

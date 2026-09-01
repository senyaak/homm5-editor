// The engine's image resize — `0x9743A0`, and the Lanczos-3 filter it uses.
//
// The minimap is drawn one pixel per playable tile and then blown up to
// 256x256 through this, so the picture the `.h5m` carries is mostly this
// function's arithmetic rather than the drawer's. It is Schumacher's
// "Filtered Image Rescaling" (Graphics Gems III, zoom.c) with the half-pixel
// correction, read out of the executable step by step:
//
//   equal dimensions -> a plain copy (`0x9743D1`, the early exit);
//   scale = dst / src, per axis;
//   when scale < 1: width = support / scale, fscale = 1 / scale;
//   otherwise:      width = support,         fscale = 1;
//   per output i:   center = (i + 0.5) / scale - 0.5
//                   left  = ceil(center - width)      (`0xF044CD`)
//                   right = floor(center + width)     (`0x94AC3A`)
//                   weight(j) = filter((center - j) / fscale) / fscale
//   an out-of-range j REFLECTS: j < 0 -> -j, j >= n -> 2n - j - 1;
//   horizontal first into a (dst.width x src.height) image, then vertical;
//   every channel, alpha included, is sum(byte * weight) as a double, then
//   `trunc(sum + 0.5)` clamped to 0..255 (`0x974A06`..`0x974A6E`).
//
// The weights are NOT normalised — Lanczos sums to about one and the engine
// takes what it gets, which is where the reference minimap's alpha 253 and
// 254 come from over a layer that is uniformly 255.
//
// The filter `0x975800` is sinc(x) * sinc(x/3) with support 3.0 (`0xF4C7B8`),
// pi from `0xFA3DD8`, and both sines from the engine's own table — see
// [`../exe/sine-table.ts`](../exe/sine-table.ts), which is why this module
// needs it passed in.

import { engineSin, type EngineSine } from '../exe/sine-table.ts';

/** A 32-bit image: four bytes a pixel, in whatever channel order the caller keeps. */
export interface Bitmap {
  width: number;
  height: number;
  /** width * height * 4 bytes, row after row. */
  data: Uint8Array;
}

/** The Lanczos filter's support — `0xF4C7B8`, the 3.0 the filter table hands over. */
export const LANCZOS3_SUPPORT = 3;

/** A resampling kernel: the weight at a distance, zero beyond the support. */
export type Filter = (t: number) => number;

/** `0x975800` — sinc(t) * sinc(t/3), on the engine's table sine. */
export function lanczos3(sine: EngineSine): Filter {
  return (t: number): number => {
    const x = t < 0 ? -t : t;
    if (x >= LANCZOS3_SUPPORT) return 0;
    const a = x * Math.PI;
    const first = a === 0 ? 1 : engineSin(sine, Math.fround(a)) / a;
    const b = (x / 3) * Math.PI;
    const second = b === 0 ? 1 : engineSin(sine, Math.fround(b)) / b;
    return first * second;
  };
}

/** One output sample's inputs: which source lines it reads and at what weight. */
interface Contribution {
  index: Int32Array;
  weight: Float64Array;
}

/** The contribution table for one axis, `0x974532`..`0x9748D5` verbatim. */
function contributions(dst: number, src: number, filter: Filter, support: number): Contribution[] {
  const scale = dst / src;
  const down = scale < 1;
  const width = down ? support / scale : support;
  const fscale = down ? 1 / scale : 1;
  const out: Contribution[] = [];
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const left = Math.ceil(center - width);
    const right = Math.floor(center + width);
    const n = Math.max(0, right - left + 1);
    const index = new Int32Array(n);
    const weight = new Float64Array(n);
    for (let j = left, k = 0; j <= right; j++, k++) {
      weight[k] = down ? filter((center - j) / fscale) / fscale : filter(center - j);
      // The engine reflects rather than clamps, so an edge pixel is never
      // weighted twice: j < 0 mirrors about 0, j >= n about the last line.
      index[k] = j < 0 ? -j : j >= src ? 2 * src - j - 1 : j;
    }
    out.push({ index, weight });
  }
  return out;
}

/** `trunc(sum + 0.5)` into a byte, the engine's cvttsd2si and its two cmovs. */
function toByte(sum: number): number {
  const v = Math.trunc(sum + 0.5);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Resize `src` to `dstW` x `dstH` the way `0x9743A0` does. */
export function resampleFiltered(
  src: Bitmap, dstW: number, dstH: number, filter: Filter, support = LANCZOS3_SUPPORT,
): Bitmap {
  if (dstW === src.width && dstH === src.height) {
    return { width: dstW, height: dstH, data: Uint8Array.from(src.data) };
  }

  // Horizontal: (dst.width x src.height), one source row at a time.
  const across = contributions(dstW, src.width, filter, support);
  const mid = new Uint8Array(dstW * src.height * 4);
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width * 4;
    for (let x = 0; x < dstW; x++) {
      const { index, weight } = across[x]!;
      let b = 0, g = 0, r = 0, a = 0;
      for (let k = 0; k < index.length; k++) {
        const at = row + index[k]! * 4;
        const w = weight[k]!;
        b += src.data[at]! * w;
        g += src.data[at + 1]! * w;
        r += src.data[at + 2]! * w;
        a += src.data[at + 3]! * w;
      }
      const to = (y * dstW + x) * 4;
      mid[to] = toByte(b);
      mid[to + 1] = toByte(g);
      mid[to + 2] = toByte(r);
      mid[to + 3] = toByte(a);
    }
  }

  // Vertical: the same over the columns of what the first pass wrote.
  const down = contributions(dstH, src.height, filter, support);
  const out = new Uint8Array(dstW * dstH * 4);
  for (let x = 0; x < dstW; x++) {
    for (let y = 0; y < dstH; y++) {
      const { index, weight } = down[y]!;
      let b = 0, g = 0, r = 0, a = 0;
      for (let k = 0; k < index.length; k++) {
        const at = (index[k]! * dstW + x) * 4;
        const w = weight[k]!;
        b += mid[at]! * w;
        g += mid[at + 1]! * w;
        r += mid[at + 2]! * w;
        a += mid[at + 3]! * w;
      }
      const to = (y * dstW + x) * 4;
      out[to] = toByte(b);
      out[to + 1] = toByte(g);
      out[to + 2] = toByte(r);
      out[to + 3] = toByte(a);
    }
  }
  return { width: dstW, height: dstH, data: out };
}

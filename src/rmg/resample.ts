// The engine's image resize — `0x9743A0` in the game, `0x791330` in the
// editor, and the Lanczos-3 filter it uses.
//
// The minimap is drawn one pixel per playable tile and then blown up to
// 256x256 through this, so the picture the `.h5m` carries is mostly this
// function's arithmetic rather than the drawer's. It is Schumacher's
// "Filtered Image Rescaling" (Graphics Gems III, zoom.c) with the half-pixel
// correction, read out of the executable step by step:
//
//   equal dimensions -> a plain copy (`0x791351`, the early exit);
//   scale = dst / src, per axis;
//   when scale < 1: fscale = 1 / scale, width = support * fscale;
//   otherwise:      fscale = 1,         width = support;
//   per output i:   center = (i + 0.5) * (1/scale) - 0.5
//                   left  = ceil(center - width)
//                   right = floor(center + width)
//                   weight(j) = filter((center - j) * inv) * inv, inv = 1/fscale
//   an out-of-range j REFLECTS: j < 0 -> -j, j >= n -> 2n - j - 1;
//   horizontal first into a (dst.width x src.height) image, then vertical;
//   every channel, alpha included, is sum(byte * weight), then
//   `trunc(sum + 0.5)` clamped to 0..255.
//
// THE RECIPROCALS ARE NOT DIVISIONS. `1/scale` is computed once (`0x791680`)
// and every centre MULTIPLIES by it; the downscaling branch does the same with
// `1/fscale` twice per tap (`0x791595`, `0x7915a9`, `0x7915b8`). In real
// arithmetic that is the same thing as dividing. In the editor's it is not —
// see below — and the port used to divide.
//
// AND THE ARITHMETIC IS NOT DOUBLES. The editor runs with an x87 control word
// of `0x0C7F`: **precision single, rounding toward zero**, read out of the
// process by `native/rmg/minimap-probe.c`. So every operation here lands on a
// float and always the float nearer zero, and this module says so instruction
// by instruction through `../exe/x87.ts`. That is the whole of the minimap's
// last ten bytes: three resampled channels sat within 4e-5 of a rounding
// boundary and doubles put them on the wrong side of it.
//
// The weights are NOT normalised — Lanczos sums to about one and the engine
// takes what it gets, which is where the reference minimap's alpha 253 and
// 254 come from over a layer that is uniformly 255.
//
// The filter `0x7911C0` is sinc(x) * sinc(x/3) with support 3.0, pi from
// `0x111DA48`, and both sines from the engine's own table — see
// [`../exe/sine-table.ts`](../exe/sine-table.ts), which is why this module
// needs it passed in. Every value it returns for one minimap build — all
// 3072 of them — is reproduced here exactly.

import { engineSin24, type EngineSine } from '../exe/sine-table.ts';
import { add24, div24, mul24, sub24, tr24 } from '../exe/x87.ts';

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

/**
 * sinc(t) * sinc(t/3) — the EDITOR's copy, `0x7911C0`, not the game's.
 *
 * Two things separate the two builds and both reach the bytes: the editor
 * multiplies by the constant 1/3 where the game divides by 3.0, and it runs
 * under the control word above. The reference minimaps are the editor's
 * output, so this is the editor's.
 */
export function lanczos3(sine: EngineSine, game = false): Filter {
  if (game) {
    // THE GAME'S `0x975800`: `a = x * pi` and `b = (x / 3.0) * pi` stay
    // DOUBLES (`mulsd`, `divsd`), the sine's argument is `cvtsd2ss` of them
    // (a chop, the same float the editor's `fstp dword` gives), and the two
    // divides and the final multiply run on the x87 at 24 bits in both builds
    // — so the weights are 24-bit numbers either way, differing in the last
    // bit or two through the double `a` and `b`. Read side by side with the
    // editor's, instruction by instruction.
    return (t: number): number => {
      const x = t < 0 ? -t : t;
      if (x >= LANCZOS3_SUPPORT) return 0;
      const a = x * Math.PI;
      const first = a === 0 ? 1 : div24(engineSin24(sine, tr24(a)), a);
      const b = (x / 3.0) * Math.PI;
      const second = b === 0 ? 1 : div24(engineSin24(sine, tr24(b)), b);
      return mul24(second, first);
    };
  }
  return (t: number): number => {
    const x = t < 0 ? -t : t;
    if (x >= LANCZOS3_SUPPORT) return 0;
    const a = mul24(x, Math.PI);
    const first = a === 0 ? 1 : div24(engineSin24(sine, a), a);
    const b = mul24(mul24(x, ONE_THIRD), Math.PI);
    const second = b === 0 ? 1 : div24(engineSin24(sine, b), b);
    return mul24(second, first);
  };
}

/** `0x111DA50` — the editor's own third, which is not what dividing gives. */
const ONE_THIRD = 0.3333333333333333;

/** One output sample's inputs: which source lines it reads and at what weight. */
interface Contribution {
  index: Int32Array;
  weight: Float64Array;
}

/** The contribution table for one axis, `0x7914A2` and `0x79163F` verbatim. */
function contributions(dst: number, src: number, filter: Filter, support: number, game = false): Contribution[] {
  if (game) {
    // THE GAME'S `0x9743A0`: `cvtdq2pd` and `divsd` — the ratio, the centres
    // and the down-scaling steps are doubles and DIVIDE where the editor
    // multiplies by a 24-bit reciprocal (`0x97479D divsd` against `0x7916CB
    // fmul`). Read side by side; the weights come out of the same filter.
    const scale = dst / src;
    const down = scale < 1;
    const fscale = down ? 1 / scale : 1;
    const width = down ? support * fscale : support;
    const out: Contribution[] = [];
    for (let i = 0; i < dst; i++) {
      const center = (i + 0.5) / scale - 0.5;
      const left = Math.ceil(center - width);
      const right = Math.floor(center + width);
      const n = Math.max(0, right - left + 1);
      const index = new Int32Array(n);
      const weight = new Float64Array(n);
      for (let j = left, k = 0; j <= right; j++, k++) {
        const t = center - j;
        weight[k] = down ? filter(t / fscale) / fscale : filter(t);
        index[k] = j < 0 ? -j : j >= src ? 2 * src - j - 1 : j;
      }
      out.push({ index, weight });
    }
    return out;
  }
  // `fild` then `fidiv`: the ratio is a float, truncated, like everything else.
  const scale = div24(dst, src);
  const down = scale < 1;
  const fscale = down ? div24(1, scale) : 1;
  const width = down ? mul24(support, fscale) : support;
  // The two reciprocals the loops multiply by, each computed once.
  const invScale = div24(1, scale);
  const invFscale = down ? div24(1, fscale) : 1;
  const out: Contribution[] = [];
  for (let i = 0; i < dst; i++) {
    const center = sub24(mul24(add24(i, 0.5), invScale), 0.5);
    const left = Math.ceil(sub24(center, width));
    const right = Math.floor(add24(center, width));
    const n = Math.max(0, right - left + 1);
    const index = new Int32Array(n);
    const weight = new Float64Array(n);
    for (let j = left, k = 0; j <= right; j++, k++) {
      const t = sub24(center, j);
      weight[k] = down ? mul24(filter(mul24(t, invFscale)), invFscale) : filter(t);
      // The engine reflects rather than clamps, so an edge pixel is never
      // weighted twice: j < 0 mirrors about 0, j >= n about the last line.
      index[k] = j < 0 ? -j : j >= src ? 2 * src - j - 1 : j;
    }
    out.push({ index, weight });
  }
  return out;
}

/** `trunc(sum + 0.5)` into a byte — `fadd`, then `fistp` in truncating mode. */
function toByte(sum: number): number {
  const v = Math.trunc(add24(0.5, sum));
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** The game's: the sum is a double, `addsd 0.5` then `cvttsd2si`, clamped. */
function toByteGame(sum: number): number {
  const v = Math.trunc(sum + 0.5);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Resize `src` to `dstW` x `dstH` the way the editor's `0x791330` does — or,
 * with `game`, the way the game's `0x9743A0` does: the same taps, weights and
 * passes, but each tap `cvtdq2pd` the byte, `mulsd` the weight and `addsd`
 * into a DOUBLE accumulator, where the editor's x87 at 24 bits rounds the
 * running sum at every step. On a large map that is a handful of pixels
 * sitting within a rounding's width of a `.5` boundary.
 */
export function resampleFiltered(
  src: Bitmap, dstW: number, dstH: number, filter: Filter, support = LANCZOS3_SUPPORT, game = false,
): Bitmap {
  if (dstW === src.width && dstH === src.height) {
    return { width: dstW, height: dstH, data: Uint8Array.from(src.data) };
  }
  const mul = game ? (a: number, b: number) => a * b : mul24;
  const add = game ? (a: number, b: number) => a + b : add24;
  const byte = game ? toByteGame : toByte;

  // Horizontal: (dst.width x src.height), one source row at a time. Four
  // accumulators, one per channel, each `fild` the byte, `fmul` the weight and
  // `faddp` — so the running sum is rounded at every step, not at the end.
  const across = contributions(dstW, src.width, filter, support, game);
  const mid = new Uint8Array(dstW * src.height * 4);
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width * 4;
    for (let x = 0; x < dstW; x++) {
      const { index, weight } = across[x]!;
      let b = 0, g = 0, r = 0, a = 0;
      for (let k = 0; k < index.length; k++) {
        const at = row + index[k]! * 4;
        const w = weight[k]!;
        b = add(b, mul(src.data[at]!, w));
        g = add(g, mul(src.data[at + 1]!, w));
        r = add(r, mul(src.data[at + 2]!, w));
        a = add(a, mul(src.data[at + 3]!, w));
      }
      const to = (y * dstW + x) * 4;
      mid[to] = byte(b);
      mid[to + 1] = byte(g);
      mid[to + 2] = byte(r);
      mid[to + 3] = byte(a);
    }
  }

  // Vertical: the same over the columns of what the first pass wrote.
  const down = contributions(dstH, src.height, filter, support, game);
  const out = new Uint8Array(dstW * dstH * 4);
  for (let x = 0; x < dstW; x++) {
    for (let y = 0; y < dstH; y++) {
      const { index, weight } = down[y]!;
      let b = 0, g = 0, r = 0, a = 0;
      for (let k = 0; k < index.length; k++) {
        const at = (index[k]! * dstW + x) * 4;
        const w = weight[k]!;
        b = add(b, mul(mid[at]!, w));
        g = add(g, mul(mid[at + 1]!, w));
        r = add(r, mul(mid[at + 2]!, w));
        a = add(a, mul(mid[at + 3]!, w));
      }
      const to = (y * dstW + x) * 4;
      out[to] = byte(b);
      out[to + 1] = byte(g);
      out[to + 2] = byte(r);
      out[to + 3] = byte(a);
    }
  }
  return { width: dstW, height: dstH, data: out };
}

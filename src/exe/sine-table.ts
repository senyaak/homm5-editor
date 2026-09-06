// The engine's sine — a 513-entry table, not the CRT's.
//
// Everything that resamples an image goes through the Lanczos filter at
// `0x975800`, and the filter's two sinc terms call `0x9573B0`. That function
// is NOT `sinf`: it is a lookup with linear interpolation, whole body
//
//   t   = x * K              ; K = float at 0xF4DC88 = 512 / (2*pi)
//   i   = (int)(t - 0.5f)    ; cvttss2si, so truncation
//   idx = i & 0x1FF
//   return table[idx] + (table[idx + 1] - table[idx]) * (t - (float)i)
//
// with the table at 0xFA2898: 513 floats, `sin(2*pi*i/512)`, and 512 wraps to
// 0 so index 0x1FF can read its neighbour.
//
// It has to be READ rather than recomputed. The stored entries are not
// `(float)sin(...)`: entry 1 is 0.012271500 where the correctly rounded value
// is 0.012271538 — five ulps out, from whatever built the table. Five ulps in
// a weight is ~2.5e-3 in a resampled channel, which is enough to move a
// truncation boundary on a few hundred pixels of a 256x256 image, so a
// recomputed table would not give the engine's bytes back.

import { PEFile } from './pe.ts';
import { add24, mul24, sub24 } from './x87.ts';

/** Where the table and its scale live in `H5_Game_H5E.exe`. */
export const SINE_TABLE_VA = 0xfa2898;
export const SINE_SCALE_VA = 0xf4dc88;

/** The table plus its argument scale — everything `engineSin` needs. */
export interface EngineSine {
  /** 513 floats: sin(2*pi*i/512), the last one wrapping to the first. */
  table: Float32Array;
  /** The float 512/(2*pi) the argument is multiplied by. */
  scale: number;
}

/** Read both out of the game executable. */
export function readEngineSine(exePath: string): EngineSine {
  const pe = PEFile.read(exePath);
  const at = pe.offsetOf(SINE_TABLE_VA);
  const scaleAt = pe.offsetOf(SINE_SCALE_VA);
  if (at === null || scaleAt === null) throw new Error(`${exePath}: no sine table at 0x${SINE_TABLE_VA.toString(16)}`);
  const table = new Float32Array(513);
  for (let i = 0; i < table.length; i++) table[i] = pe.buf.readFloatLE(at + i * 4);
  return { table, scale: pe.buf.readFloatLE(scaleAt) };
}

/**
 * The engine's sine of a float — the EDITOR's copy, `0xED3A80`.
 *
 * Both builds carry the same table and the same scale, byte for byte, and
 * differ only in how they compute with them: the game's `0x9573B0` is SSE and
 * rounds every step back to a float, the editor's is x87.
 *
 * THIS IS THE APPROXIMATE ONE, and it is honest to say so: it does the
 * editor's steps in doubles, which is not what the editor's FPU does — see
 * `engineSin24` below and `../exe/x87.ts`. It stays because the road wave and
 * the height plane read it and 136 reference maps agree with them as they
 * are; what a wave or a plane hands on is an integer, and the last bit of the
 * sine does not reach it. The minimap is the one caller where it did reach,
 * and that one moved.
 */
export function engineSin(sine: EngineSine, x: number): number {
  const t = Math.fround(x) * sine.scale;
  const i = Math.trunc(t - 0.5);
  const idx = i & 0x1ff;
  const a = sine.table[idx]!;
  return a + (sine.table[idx + 1]! - a) * (t - i);
}

/**
 * The same lookup, in the arithmetic the EDITOR'S FPU actually does it in.
 *
 * The control word the editor runs with is `0x0C7F` — precision SINGLE and
 * rounding TOWARD ZERO — read out of the process itself by
 * `native/rmg/minimap-probe.c` rather than assumed, so every `fmul`, `fsub`
 * and `fadd` above lands on a float and always the float nearer zero. Held to
 * the engine's own answers: the probe logs this function's argument and result
 * for a whole minimap build, and **6208 of 6208 come out of this exactly**,
 * where the version above gets eight.
 *
 * The version above is what the rest of the port uses, and deliberately: the
 * generator's own arithmetic reaches the map as integers and tile indices, 136
 * reference maps say it agrees, and a rewrite there is a change nothing has
 * asked for. This one is for the minimap, where the last bit is the whole
 * question.
 */
export function engineSin24(sine: EngineSine, x: number): number {
  const t = mul24(Math.fround(x), sine.scale);
  const i = Math.trunc(sub24(t, 0.5));
  const idx = i & 0x1ff;
  const a = sine.table[idx]!;
  return add24(mul24(sub24(sine.table[idx + 1]!, a), sub24(t, i)), a);
}

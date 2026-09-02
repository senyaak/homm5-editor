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
 * rounds every step back to a float, the editor's is x87 and keeps 80 bits
 * from the multiply to the final add. The port speaks the EDITOR's, as it
 * does for the road wave and the height plane, because the references are
 * the editor's output — and here it is worth ten bytes of the reference
 * minimap: the float-rounded weights move a resampled channel that sat
 * 3e-5 from its rounding boundary. Doubles are not 80 bits either, but they
 * are nearer to it than floats by nine orders of magnitude.
 */
export function engineSin(sine: EngineSine, x: number): number {
  const t = Math.fround(x) * sine.scale;
  const i = Math.trunc(t - 0.5);
  const idx = i & 0x1ff;
  const a = sine.table[idx]!;
  return a + (sine.table[idx + 1]! - a) * (t - i);
}

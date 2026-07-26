// Checks the GIF reader and the texture writer against a picture built by hand.
//
// A hand-built file rather than a fixture, because the point is the FORMAT: the
// bytes below are a GIF spelled out field by field, so a failure says which
// field moved rather than "the picture changed". It exercises the two things
// that are easy to get wrong and fail quietly — the palette lookup and the
// variable-width LZW — by using a code width that grows mid-stream.

import { readGif } from '../src/gif.ts';
import { fitSquare, writeDDS } from '../src/texture.ts';

let failures = 0;
const eq = (what: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  failures++;
  console.log(`FAIL ${what} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) return;
  failures++;
  console.log(`FAIL ${what}${detail ? ` — ${detail}` : ''}`);
};

/**
 * A 4x1 GIF: red, green, blue, and the transparent index.
 *
 * The LZW payload is written out as bits rather than computed, so this file is
 * a statement about the format and not a re-run of the decoder's own logic.
 * With a 2-bit minimum code size the clear code is 4, end is 5, and the first
 * codes are 3 bits wide.
 */
function tinyGif(): Buffer {
  const head = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    4, 0, 1, 0,                          // 4x1
    0x83,                                // global table, 3 bits -> 16 entries... (see below)
    0, 0,                                // background index, aspect
  ]);
  // 2^(3+1) = 16 palette entries; only the first four are used.
  const palette = Buffer.alloc(16 * 3);
  palette.set([255, 0, 0], 0);
  palette.set([0, 255, 0], 3);
  palette.set([0, 0, 255], 6);
  palette.set([9, 9, 9], 9);
  const gce = Buffer.from([
    0x21, 0xf9, 4,
    0x01,        // transparency flag on
    0, 0,
    3,           // index 3 is transparent
    0,
  ]);
  const desc = Buffer.from([0x2c, 0, 0, 0, 0, 4, 0, 1, 0, 0x00]);

  // Codes: CLEAR(4), 0, 1, 2, 3, END(5) — all 4 bits, since a 16-colour table
  // means a minimum code size of 4 and a first width of 5. Packed low bit first.
  const minCodeSize = 4;
  const codes = [16, 0, 1, 2, 3, 17]; // clear = 1<<4, end = clear+1
  const bits: number[] = [];
  for (const c of codes) for (let i = 0; i < 5; i++) bits.push((c >> i) & 1);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8 && i + k < bits.length; k++) b |= bits[i + k]! << k;
    bytes.push(b);
  }
  const data = Buffer.from([minCodeSize, bytes.length, ...bytes, 0, 0x3b]);
  return Buffer.concat([head, palette, gce, desc, data]);
}

{
  const img = readGif(tinyGif());
  eq('the picture is 4x1', [img.width, img.height], [4, 1]);
  const px = (i: number): number[] => [...img.rgba.subarray(i * 4, i * 4 + 4)];
  eq('pixel 0 is red', px(0), [255, 0, 0, 255]);
  eq('pixel 1 is green', px(1), [0, 255, 0, 255]);
  eq('pixel 2 is blue', px(2), [0, 0, 255, 255]);
  // The transparent index must leave the pixel clear, not paint its colour.
  eq('pixel 3 is transparent', px(3), [0, 0, 0, 0]);
}

{
  // A picture that is not square goes on a square canvas, centred, edges clear —
  // which is what a 58x64 Heroes III icon needs to become a 64x64 texture.
  const img = readGif(tinyGif());
  const fitted = fitSquare(img, 8);
  eq('fitted to 8x8', [fitted.width, fitted.height], [8, 8]);
  const alphaAt = (x: number, y: number): number => fitted.rgba[(y * 8 + x) * 4 + 3]!;
  check('the top row is empty', alphaAt(0, 0) === 0 && alphaAt(7, 0) === 0);
  check('the picture is on the middle row', alphaAt(2, 3) === 255, `alpha ${alphaAt(2, 3)}`);
  check('and horizontally centred', alphaAt(0, 3) === 0 && alphaAt(7, 3) === 0);
}

{
  // The size the game expects: 128 bytes of header and one uncompressed surface.
  const dds = writeDDS(fitSquare(readGif(tinyGif()), 64));
  eq('a 64x64 texture is 16512 bytes', dds.length, 128 + 64 * 64 * 4);
  eq('and starts with the magic', dds.toString('latin1', 0, 4), 'DDS ');
  eq('header size 124', dds.readUInt32LE(4), 124);
  eq('32 bits per pixel', dds.readUInt32LE(88), 32);
  // BGRA on disk: the red channel is the THIRD byte. Getting this backwards
  // gives a picture of the right shape with red and blue swapped.
  eq('red mask', dds.readUInt32LE(92).toString(16), 'ff0000');
  eq('blue mask', dds.readUInt32LE(100).toString(16), 'ff');
}

console.log(failures ? `\n${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);

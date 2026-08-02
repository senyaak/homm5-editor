// PNG, both ways.
//
// OUT: an RGBA buffer as a data URI, which is how every decoded texture reaches
// the renderer (embedded in the scene JSON rather than fetched). RGBA (colour
// type 6) so transparency survives; foliage cutouts, particle alpha and the
// terrain masks all need it. One IDAT, filter 0 on every scanline — deflate
// does the work, and at these sizes nothing else is worth the code.
//
// IN: a picture an author points the mod at. GIF came first because the art
// people had was GIF; a PNG is what everything else produces — a screenshot, a
// wiki's copy of an old icon, an export from any drawing program — and asking
// for a conversion first is asking them to lose the alpha channel on the way.

import { deflateSync, inflateSync } from 'node:zlib';
import { readGif } from './gif.ts';
import type { Image } from './gif.ts';

const crcTab: number[] = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b: Uint8Array | Buffer): number => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** `rgba` is w*h*4 bytes, row major, straight (not premultiplied) alpha. */
export function pngDataUri(w: number, h: number, rgba: Uint8Array): string {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (t: string, d: Buffer): Buffer => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(body)); return Buffer.concat([l, body, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

// --- reading one back ---------------------------------------------------------
//
// WHAT IS SUPPORTED, and it is deliberately not all of PNG: 8 bits per channel,
// non-interlaced, colour types 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha)
// and 6 (RGBA), with `tRNS` honoured where it applies. That is what every
// drawing program writes by default. 16-bit channels and Adam7 interlacing are
// refused with the reason said, rather than decoded into noise: a picture that
// comes out scrambled is a bug hunt, and a picture that is refused is a
// re-export.
//
// The compression is DEFLATE, which node has, so the work here is the filters —
// every scanline carries one of five predictors and they have to be undone in
// order, since each row is reconstructed against the row above it.

/** The eight bytes every PNG starts with. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Is this a PNG? Cheap enough to ask before committing to a reader. */
export function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

/** How many bytes one pixel takes, per colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Undo one scanline's filter, in place.
 *
 * `prior` is the RECONSTRUCTED row above, not the filtered one — which is why
 * this cannot be done in any order but top to bottom.
 */
function unfilter(type: number, row: Uint8Array, prior: Uint8Array, bpp: number): void {
  const n = row.length;
  switch (type) {
    case 0: return;
    case 1:
      for (let i = bpp; i < n; i++) row[i] = (row[i]! + row[i - bpp]!) & 0xff;
      return;
    case 2:
      for (let i = 0; i < n; i++) row[i] = (row[i]! + prior[i]!) & 0xff;
      return;
    case 3:
      for (let i = 0; i < n; i++) {
        const left = i >= bpp ? row[i - bpp]! : 0;
        row[i] = (row[i]! + ((left + prior[i]!) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0;
        const b = prior[i]!;
        const c = i >= bpp ? prior[i - bpp]! : 0;
        // Paeth: whichever neighbour the gradient a+b-c lands nearest to.
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        row[i] = (row[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      return;
    default:
      throw new Error(`PNG: unknown filter ${type}`);
  }
}

/** Decode a PNG into RGBA — the same shape `readGif` returns. */
export function readPng(buf: Buffer): Image {
  if (!isPng(buf)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];

  for (let at = 8; at + 8 <= buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    at += 12 + length;                                   // length, type, data, CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colour = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') alpha = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }

  if (!width || !height) throw new Error('PNG: no IHDR');
  if (depth !== 8) throw new Error(`PNG: ${depth} bits per channel — save it as 8-bit`);
  if (interlace) throw new Error('PNG: interlaced — save it without Adam7 interlacing');
  const channels = CHANNELS[colour];
  if (!channels) throw new Error(`PNG: colour type ${colour} is not one this reads`);
  if (colour === 3 && !palette) throw new Error('PNG: a palette image without a PLTE');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prior = new Uint8Array(stride);
  let read = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[read++]!;
    const row = new Uint8Array(raw.subarray(read, read + stride));
    read += stride;
    unfilter(filter, row, prior, channels);
    prior = row;
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      if (colour === 6) {
        rgba.set(row.subarray(from, from + 4), to);
      } else if (colour === 2) {
        rgba.set(row.subarray(from, from + 3), to);
        rgba[to + 3] = 255;
      } else if (colour === 4) {
        rgba[to] = rgba[to + 1] = rgba[to + 2] = row[from]!;
        rgba[to + 3] = row[from + 1]!;
      } else if (colour === 0) {
        rgba[to] = rgba[to + 1] = rgba[to + 2] = row[from]!;
        rgba[to + 3] = 255;
      } else {
        const index = row[from]!;
        rgba[to] = palette![index * 3]!;
        rgba[to + 1] = palette![index * 3 + 1]!;
        rgba[to + 2] = palette![index * 3 + 2]!;
        rgba[to + 3] = alpha && index < alpha.length ? alpha[index]! : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** A picture from disk, whichever of the two formats it is in. */
export function readPicture(buf: Buffer, what = 'picture'): Image {
  if (isPng(buf)) return readPng(buf);
  if (buf.toString('latin1', 0, 3) === 'GIF') return readGif(buf);
  throw new Error(`${what}: neither a PNG nor a GIF`);
}

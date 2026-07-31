// PNG out — an RGBA buffer as a data URI, which is how every decoded texture
// reaches the renderer (embedded in the scene JSON rather than fetched).
//
// RGBA (colour type 6) so transparency survives; foliage cutouts, particle
// alpha and the terrain masks all need it. One IDAT, filter 0 on every
// scanline — deflate does the work, and at these sizes nothing else is worth
// the code.

import { deflateSync } from 'node:zlib';

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

// Minimal DDS decoder for the DXT1/DXT3/DXT5 (BC1/2/3) textures HoMM5 ships.
// Returns straight RGBA8 pixels — enough to sample for texturing/preview.
// No dependencies. Reference: the S3TC/DXT block layout.

import { readFileSync } from 'node:fs';

/** RGB565 -> [r,g,b] 0..255 */
function rgb565(c) {
  return [((c >> 11) & 0x1f) * 255 / 31 | 0, ((c >> 5) & 0x3f) * 255 / 63 | 0, (c & 0x1f) * 255 / 31 | 0];
}

/** Decode one DXT color block (4×4) into the rgba buffer at (bx,by).
 * `alpha` is a per-texel Uint8Array(16) for DXT3/5, or null. For DXT1 (no alpha
 * block) the c0<=c1 mode encodes 1-bit punch-through: colour index 3 = fully
 * transparent, which we honour so foliage cutouts don't render as black cards. */
function colorBlock(b, off, out, W, H, bx, by, alpha, dxt1) {
  const c0 = b.readUInt16LE(off), c1 = b.readUInt16LE(off + 2);
  const p0 = rgb565(c0), p1 = rgb565(c1);
  const pal = [p0, p1, [0, 0, 0], [0, 0, 0]];
  const punchThrough = dxt1 && c0 <= c1; // 3-colour + transparent mode
  if (c0 > c1) {
    pal[2] = [(2 * p0[0] + p1[0]) / 3 | 0, (2 * p0[1] + p1[1]) / 3 | 0, (2 * p0[2] + p1[2]) / 3 | 0];
    pal[3] = [(p0[0] + 2 * p1[0]) / 3 | 0, (p0[1] + 2 * p1[1]) / 3 | 0, (p0[2] + 2 * p1[2]) / 3 | 0];
  } else {
    pal[2] = [(p0[0] + p1[0]) / 2 | 0, (p0[1] + p1[1]) / 2 | 0, (p0[2] + p1[2]) / 2 | 0];
    // pal[3] stays black; in punch-through mode it is also transparent (below)
  }
  const bits = b.readUInt32LE(off + 4);
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
    const idx = (bits >> (2 * (py * 4 + px))) & 3;
    const x = bx * 4 + px, y = by * 4 + py;
    if (x >= W || y >= H) continue;
    const o = (y * W + x) * 4, c = pal[idx];
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    out[o + 3] = alpha ? alpha[py * 4 + px] : (punchThrough && idx === 3 ? 0 : 255);
  }
}

/** Decode a DXT5 alpha block (8 bytes) -> Uint8Array(16) of alpha values. */
function dxt5Alpha(b, off) {
  const a0 = b[off], a1 = b[off + 1];
  const t = new Array(8);
  t[0] = a0; t[1] = a1;
  if (a0 > a1) for (let i = 1; i <= 6; i++) t[i + 1] = ((7 - i) * a0 + i * a1) / 7 | 0;
  else { for (let i = 1; i <= 4; i++) t[i + 1] = ((5 - i) * a0 + i * a1) / 5 | 0; t[6] = 0; t[7] = 255; }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(b[off + 2 + i]) << BigInt(8 * i);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = t[Number((bits >> BigInt(3 * i)) & 7n)];
  return out;
}

/** Channel extractor for a DDS pixel-format bit mask (e.g. 0x00ff0000 -> red). */
function channel(mask) {
  if (!mask) return () => 255; // absent channel (e.g. no alpha) reads as opaque
  let shift = 0; while (!((mask >>> shift) & 1)) shift++;
  const max = mask >>> shift;
  return (px) => ((px & mask) >>> shift) * 255 / max | 0;
}

/**
 * Decode an uncompressed (DDPF_RGB) surface. HoMM5 ships a couple of these —
 * notably the water texture — so the DXT-only path would render them as noise.
 * Works for any bit depth by reading the format's channel masks.
 */
function decodeUncompressed(b, off, width, height, bpp, rgba) {
  const bytes = bpp / 8;
  const R = channel(b.readUInt32LE(92)), G = channel(b.readUInt32LE(96));
  const B = channel(b.readUInt32LE(100)), A = channel(b.readUInt32LE(104));
  for (let i = 0; i < width * height; i++) {
    const p = off + i * bytes;
    if (p + bytes > b.length) break;
    const px = bytes === 4 ? b.readUInt32LE(p) : bytes === 2 ? b.readUInt16LE(p)
      : bytes === 3 ? b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) : b[p];
    const o = i * 4;
    rgba[o] = R(px); rgba[o + 1] = G(px); rgba[o + 2] = B(px); rgba[o + 3] = A(px);
  }
}

/**
 * @param {string} path .dds file
 * @returns {{width:number, height:number, rgba:Uint8Array}}
 */
export function decodeDDS(path) {
  const b = readFileSync(path);
  if (b.subarray(0, 4).toString() !== 'DDS ') throw new Error('not a DDS');
  const height = b.readUInt32LE(12), width = b.readUInt32LE(16);
  const pfFlags = b.readUInt32LE(80);
  const fourCC = b.subarray(84, 88).toString();
  const rgba = new Uint8Array(width * height * 4);
  let off = 128; // header size

  // DDPF_FOURCC (0x4) selects the block-compressed path; otherwise it's a plain
  // RGB(A) surface described by channel masks.
  if (!(pfFlags & 0x4)) {
    decodeUncompressed(b, off, width, height, b.readUInt32LE(88) || 32, rgba);
    return { width, height, rgba };
  }
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  const blockBytes = fourCC === 'DXT1' ? 8 : 16;
  const dxt1 = fourCC === 'DXT1';
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let alpha = null, colorOff = off;
    if (fourCC === 'DXT3') {
      alpha = new Uint8Array(16);
      const a = b.readBigUInt64LE(off);
      for (let i = 0; i < 16; i++) alpha[i] = Number((a >> BigInt(4 * i)) & 0xfn) * 17;
      colorOff = off + 8;
    } else if (fourCC === 'DXT5') {
      alpha = dxt5Alpha(b, off);
      colorOff = off + 8;
    }
    colorBlock(b, colorOff, rgba, width, height, bx, by, alpha, dxt1);
    off += blockBytes;
  }
  return { width, height, rgba };
}

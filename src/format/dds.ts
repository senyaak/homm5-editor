// Minimal DDS decoder for the DXT1/DXT3/DXT5 (BC1/2/3) textures HoMM5 ships.
// Returns straight RGBA8 pixels — enough to sample for texturing/preview.
// No dependencies. Reference: the S3TC/DXT block layout.

import { readFileSync } from 'node:fs';

/** Decoded surface: straight (non-premultiplied) RGBA8, row-major from the top. */
export interface Image {
  width: number;
  height: number;
  rgba: Uint8Array;
}

// The 5- and 6-bit channels of an RGB565 colour, widened to 8 bits the way
// the arithmetic always did it (`v * 255 / 31 | 0`), as tables: the block
// decoders below run over every texel of every skin a map opens with, and
// what they used to allocate per block — a tuple per palette entry, a
// closure per channel — was most of their time.
const R5 = new Uint8Array(32), G6 = new Uint8Array(64);
for (let i = 0; i < 32; i++) R5[i] = i * 255 / 31 | 0;
for (let i = 0; i < 64; i++) G6[i] = i * 255 / 63 | 0;

/** The block's four colours, RGB each, and the alpha of its sixteen texels — scratch shared by every block. */
const pal = new Uint8Array(12);
const blockAlpha = new Uint8Array(16);
/** DXT5's eight interpolated alphas. */
const alphaRamp = new Uint8Array(8);

/**
 * Decode one DXT colour block (4×4) into the rgba buffer at (bx,by).
 * `alpha` is the texels' alpha (`blockAlpha`) for DXT3/5, or null. For DXT1
 * (no alpha block) the c0<=c1 mode encodes 1-bit punch-through: colour
 * index 3 = fully transparent, which we honour so foliage cutouts don't
 * render as black cards.
 */
function colorBlock(
  b: Buffer, off: number, out: Uint8Array, W: number, H: number,
  bx: number, by: number, alpha: Uint8Array | null, dxt1: boolean,
): void {
  const c0 = b[off]! | (b[off + 1]! << 8), c1 = b[off + 2]! | (b[off + 3]! << 8);
  const r0 = R5[c0 >> 11]!, g0 = G6[(c0 >> 5) & 0x3f]!, b0 = R5[c0 & 0x1f]!;
  const r1 = R5[c1 >> 11]!, g1 = G6[(c1 >> 5) & 0x3f]!, b1 = R5[c1 & 0x1f]!;
  pal[0] = r0; pal[1] = g0; pal[2] = b0;
  pal[3] = r1; pal[4] = g1; pal[5] = b1;
  const punchThrough = dxt1 && c0 <= c1; // 3-colour + transparent mode
  if (c0 > c1) {
    pal[6] = (2 * r0 + r1) / 3 | 0; pal[7] = (2 * g0 + g1) / 3 | 0; pal[8] = (2 * b0 + b1) / 3 | 0;
    pal[9] = (r0 + 2 * r1) / 3 | 0; pal[10] = (g0 + 2 * g1) / 3 | 0; pal[11] = (b0 + 2 * b1) / 3 | 0;
  } else {
    pal[6] = (r0 + r1) / 2 | 0; pal[7] = (g0 + g1) / 2 | 0; pal[8] = (b0 + b1) / 2 | 0;
    pal[9] = 0; pal[10] = 0; pal[11] = 0; // black; in punch-through mode also transparent (below)
  }
  const bits = (b[off + 4]! | (b[off + 5]! << 8) | (b[off + 6]! << 16) | (b[off + 7]! << 24)) >>> 0;
  const x0 = bx * 4, y0 = by * 4;
  const xn = Math.min(4, W - x0), yn = Math.min(4, H - y0);
  for (let py = 0; py < yn; py++) {
    let o = ((y0 + py) * W + x0) * 4;
    for (let px = 0; px < xn; px++, o += 4) {
      const t = py * 4 + px;
      const idx = (bits >>> (2 * t)) & 3, c = idx * 3;
      out[o] = pal[c]!; out[o + 1] = pal[c + 1]!; out[o + 2] = pal[c + 2]!;
      out[o + 3] = alpha ? alpha[t]! : (punchThrough && idx === 3 ? 0 : 255);
    }
  }
}

/** Decode a DXT3 alpha block (8 bytes: sixteen 4-bit alphas) into `blockAlpha`. */
function dxt3Alpha(b: Buffer, off: number): Uint8Array {
  for (let row = 0; row < 4; row++) {
    const v = b[off + row * 2]! | (b[off + row * 2 + 1]! << 8);
    blockAlpha[row * 4] = (v & 0xf) * 17;
    blockAlpha[row * 4 + 1] = ((v >> 4) & 0xf) * 17;
    blockAlpha[row * 4 + 2] = ((v >> 8) & 0xf) * 17;
    blockAlpha[row * 4 + 3] = ((v >> 12) & 0xf) * 17;
  }
  return blockAlpha;
}

/** Decode a DXT5 alpha block (8 bytes: two endpoints, sixteen 3-bit indices) into `blockAlpha`. */
function dxt5Alpha(b: Buffer, off: number): Uint8Array {
  const a0 = b[off]!, a1 = b[off + 1]!;
  alphaRamp[0] = a0; alphaRamp[1] = a1;
  if (a0 > a1) for (let i = 1; i <= 6; i++) alphaRamp[i + 1] = ((7 - i) * a0 + i * a1) / 7 | 0;
  else { for (let i = 1; i <= 4; i++) alphaRamp[i + 1] = ((5 - i) * a0 + i * a1) / 5 | 0; alphaRamp[6] = 0; alphaRamp[7] = 255; }
  // 48 bits of indices, as two 24-bit halves — eight texels each — so no
  // BigInt is made per block.
  const lo = b[off + 2]! | (b[off + 3]! << 8) | (b[off + 4]! << 16);
  const hi = b[off + 5]! | (b[off + 6]! << 8) | (b[off + 7]! << 16);
  for (let i = 0; i < 8; i++) {
    blockAlpha[i] = alphaRamp[(lo >> (3 * i)) & 7]!;
    blockAlpha[i + 8] = alphaRamp[(hi >> (3 * i)) & 7]!;
  }
  return blockAlpha;
}

/** Channel extractor for a DDS pixel-format bit mask (e.g. 0x00ff0000 -> red). */
function channel(mask: number): (px: number) => number {
  if (!mask) return () => 255; // absent channel (e.g. no alpha) reads as opaque
  let shift = 0; while (!((mask >>> shift) & 1)) shift++;
  const max = mask >>> shift;
  return (px: number) => ((px & mask) >>> shift) * 255 / max | 0;
}

/**
 * Decode an uncompressed (DDPF_RGB) surface. HoMM5 ships a couple of these —
 * notably the water texture — so the DXT-only path would render them as noise.
 * Works for any bit depth by reading the format's channel masks.
 */
function decodeUncompressed(
  b: Buffer, off: number, width: number, height: number, bpp: number, rgba: Uint8Array,
): void {
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
 * The picture, or with `cap` the largest of its mip levels no wider or
 * taller than `cap` — the same halving `shrinkToFit` would do, read off the
 * file instead of computed: a 1024² skin capped to 512 decodes a quarter of
 * the blocks and is not resampled after, and what comes out is the level
 * the game itself draws that texture with at that size. A file without the
 * level (no mip chain, or a chain that stops short) decodes at the largest
 * it has, and the caller reduces as before.
 */
export function decodeDDS(path: string, cap?: number): Image {
  return decodeDDSBuffer(readFileSync(path), cap);
}

/** The same, from bytes already in hand — a texture read out of an archive. */
export function decodeDDSBuffer(b: Buffer, cap?: number): Image {
  if (b.subarray(0, 4).toString() !== 'DDS ') throw new Error('not a DDS');
  let height = b.readUInt32LE(12), width = b.readUInt32LE(16);
  const pfFlags = b.readUInt32LE(80);
  const fourCC = b.subarray(84, 88).toString();
  let off = 128; // header size

  // DDPF_FOURCC (0x4) selects the block-compressed path; otherwise it's a plain
  // RGB(A) surface described by channel masks.
  const compressed = !!(pfFlags & 0x4);
  const bpp = b.readUInt32LE(88) || 32;
  const blockBytes = fourCC === 'DXT1' ? 8 : 16;
  /** Bytes one level of `w × h` takes, in this format. */
  const levelBytes = (w: number, h: number): number =>
    compressed ? Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes : w * h * (bpp / 8);
  // DDSD_MIPMAPCOUNT (0x20000) says the count at 28 is meaningful; the levels
  // follow the top one in order, each a quarter of the last.
  const levels = b.readUInt32LE(8) & 0x20000 ? Math.max(1, b.readUInt32LE(28)) : 1;
  if (cap) {
    for (let level = 1; level < levels && (width > cap || height > cap); level++) {
      off += levelBytes(width, height);
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
  }
  const rgba = new Uint8Array(width * height * 4);

  if (!compressed) {
    decodeUncompressed(b, off, width, height, bpp, rgba);
    return { width, height, rgba };
  }
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  const dxt1 = fourCC === 'DXT1';
  const dxt3 = fourCC === 'DXT3', dxt5 = fourCC === 'DXT5';
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let alpha: Uint8Array | null = null, colorOff = off;
    if (dxt3) { alpha = dxt3Alpha(b, off); colorOff = off + 8; }
    else if (dxt5) { alpha = dxt5Alpha(b, off); colorOff = off + 8; }
    colorBlock(b, colorOff, rgba, width, height, bx, by, alpha, dxt1);
    off += blockBytes;
  }
  return { width, height, rgba };
}

/** A block-compressed texture's mip chain, as the file holds it — for a GPU that takes S3TC. */
export interface DxtChain {
  format: 'DXT1' | 'DXT3' | 'DXT5';
  width: number;
  height: number;
  /** Top level first, down to 1×1; each level's blocks in their own buffer. */
  levels: { width: number; height: number; data: Uint8Array }[];
}

/**
 * The file's DXT levels from the largest that fits `cap` down to 1×1, or
 * null when the file is not block-compressed or carries no chain at all (a
 * texture with only its top level is decoded and mipmapped by the GPU
 * instead, like an uncompressed one).
 *
 * The shipped chains stop at 8×8 or 4×4 — the compressor's block minimum —
 * and a GPU asked to filter through a chain that stops short samples black.
 * The missing tail is made here: each further level is one block of the
 * average colour (and alpha) of the level above, which at 4, 2 and 1 texel
 * is what a mip would be to within a rounding.
 */
export function ddsChain(b: Buffer, cap?: number): DxtChain | null {
  if (b.subarray(0, 4).toString() !== 'DDS ') throw new Error('not a DDS');
  if (!(b.readUInt32LE(80) & 0x4)) return null;
  const fourCC = b.subarray(84, 88).toString();
  if (fourCC !== 'DXT1' && fourCC !== 'DXT3' && fourCC !== 'DXT5') return null;
  const count = b.readUInt32LE(8) & 0x20000 ? Math.max(1, b.readUInt32LE(28)) : 1;
  if (count < 2) return null;
  const blockBytes = fourCC === 'DXT1' ? 8 : 16;
  const bytesOf = (w: number, h: number): number => Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
  let width = b.readUInt32LE(16), height = b.readUInt32LE(12);
  let off = 128, level = 0;
  if (cap) {
    while (level + 1 < count && (width > cap || height > cap)) {
      off += bytesOf(width, height);
      width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
      level++;
    }
  }
  const levels: DxtChain['levels'] = [];
  let w = width, h = height;
  for (; level < count; level++) {
    const n = bytesOf(w, h);
    if (off + n > b.length) break;
    // A copy, not a view: a view would carry the whole file across the IPC.
    levels.push({ width: w, height: h, data: new Uint8Array(b.subarray(off, off + n)) });
    off += n;
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
  if (!levels.length) return null;
  // The tail the file lacks, one block per level, from the average of the
  // last level it has.
  let last = levels[levels.length - 1]!;
  while (last.width > 1 || last.height > 1) {
    const avg = averageOf(decodeLevel(b, fourCC, last));
    w = Math.max(1, last.width >> 1); h = Math.max(1, last.height >> 1);
    last = { width: w, height: h, data: flatBlock(fourCC, avg) };
    levels.push(last);
  }
  return { format: fourCC, width, height, levels };
}

/** One level's texels, through the same decoder as the whole. */
function decodeLevel(b: Buffer, fourCC: string, level: { width: number; height: number; data: Uint8Array }): Image {
  // A header for the level alone, so the decoder reads it as a file of its own.
  const head = Buffer.alloc(128);
  b.copy(head, 0, 0, 128);
  head.writeUInt32LE(0, 8); // no mip count: this is a single level
  head.writeUInt32LE(level.height, 12); head.writeUInt32LE(level.width, 16);
  return decodeDDSBuffer(Buffer.concat([head, Buffer.from(level.data)]));
}

function averageOf(img: Image): [number, number, number, number] {
  let r = 0, g = 0, bl = 0, a = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n * 4; i += 4) { r += img.rgba[i]!; g += img.rgba[i + 1]!; bl += img.rgba[i + 2]!; a += img.rgba[i + 3]!; }
  return [Math.round(r / n), Math.round(g / n), Math.round(bl / n), Math.round(a / n)];
}

/** One block of a flat colour, in the format: every index 0, both endpoints the colour. */
function flatBlock(fourCC: string, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const c = ((r * 31 / 255 | 0) << 11) | ((g * 63 / 255 | 0) << 5) | (b * 31 / 255 | 0);
  const colour = [c & 0xff, c >> 8, c & 0xff, c >> 8, 0, 0, 0, 0];
  if (fourCC === 'DXT1') return Uint8Array.from(colour);
  if (fourCC === 'DXT3') { const nib = (a >> 4) | (a & 0xf0); return Uint8Array.from([nib, nib, nib, nib, nib, nib, nib, nib, ...colour]); }
  return Uint8Array.from([a, a, 0, 0, 0, 0, 0, 0, ...colour]);
}

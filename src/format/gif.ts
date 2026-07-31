// Reading a GIF.
//
// Here because the pictures a mod starts from are whatever the author has, and
// for anything ported from an older game that is a GIF: it is what Heroes III's
// artwork survives as. The alternative was to shell out to an image tool, which
// makes a build depend on what happens to be installed — and this is one screen
// of well-understood format.
//
// Only what a source picture needs: the first frame, its palette, its
// transparent colour. Animation, interlacing beyond the standard four passes,
// and the extensions nothing reads are skipped rather than half-supported.

/** A decoded picture: straight RGBA, top row first. */
export interface Image {
  width: number;
  height: number;
  /** `width * height * 4` bytes, R,G,B,A. */
  rgba: Uint8Array;
}

/**
 * Decode a GIF's first frame.
 *
 * GIF is a palette format with LZW-compressed indices, and the only subtlety is
 * that its LZW resets its code width as the dictionary grows and can be told to
 * clear the dictionary mid-stream — a decoder that ignores either produces
 * plausible garbage rather than an error.
 */
export function readGif(buf: Buffer): Image {
  const magic = buf.toString('latin1', 0, 6);
  if (magic !== 'GIF87a' && magic !== 'GIF89a') throw new Error(`not a GIF (${magic})`);
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10]!;
  let at = 13;

  let palette: Uint8Array | null = null;
  if (packed & 0x80) {
    const n = 2 << (packed & 7);
    palette = buf.subarray(at, at + n * 3);
    at += n * 3;
  }

  // Blocks until the first image. The only one worth reading on the way is the
  // graphic control extension, which is where a transparent colour is declared.
  let transparent = -1;
  for (;;) {
    const marker = buf[at];
    if (marker === undefined) throw new Error('GIF ended before its first frame');
    if (marker === 0x3b) throw new Error('GIF has no image');
    if (marker === 0x21) {
      const label = buf[at + 1];
      const size = buf[at + 2]!;
      if (label === 0xf9 && size >= 4) {
        const flags = buf[at + 3]!;
        if (flags & 1) transparent = buf[at + 6]!;
      }
      at += 2;
      at = skipBlocks(buf, at);
      continue;
    }
    if (marker === 0x2c) break;
    throw new Error(`unknown GIF block 0x${marker.toString(16)} at ${at}`);
  }

  // The image descriptor. A frame may be smaller than the screen and sit at an
  // offset; ours are whole pictures, but honouring it costs two additions.
  const left = buf.readUInt16LE(at + 1);
  const top = buf.readUInt16LE(at + 3);
  const w = buf.readUInt16LE(at + 5);
  const h = buf.readUInt16LE(at + 7);
  const local = buf[at + 9]!;
  at += 10;
  if (local & 0x80) {
    const n = 2 << (local & 7);
    palette = buf.subarray(at, at + n * 3);
    at += n * 3;
  }
  if (!palette) throw new Error('GIF has no colour table');
  const interlaced = !!(local & 0x40);

  const minCodeSize = buf[at]!;
  at += 1;
  const indices = inflateLzw(concatBlocks(buf, at), minCodeSize, w * h);

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < h; y++) {
    const row = interlaced ? deinterlace(y, h) : y;
    for (let x = 0; x < w; x++) {
      const index = indices[y * w + x]!;
      const to = ((top + row) * width + left + x) * 4;
      if (to + 3 >= rgba.length) continue;
      if (index === transparent) continue;
      rgba[to] = palette[index * 3]!;
      rgba[to + 1] = palette[index * 3 + 1]!;
      rgba[to + 2] = palette[index * 3 + 2]!;
      rgba[to + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Where interlace pass row `y` really belongs. GIF's four passes, in order. */
function deinterlace(y: number, h: number): number {
  const p1 = Math.ceil(h / 8);
  const p2 = Math.ceil((h - 4) / 8);
  const p3 = Math.ceil((h - 2) / 4);
  if (y < p1) return y * 8;
  if (y < p1 + p2) return (y - p1) * 8 + 4;
  if (y < p1 + p2 + p3) return (y - p1 - p2) * 4 + 2;
  return (y - p1 - p2 - p3) * 2 + 1;
}

/** Walk a chain of length-prefixed sub-blocks and return where it ends. */
function skipBlocks(buf: Buffer, at: number): number {
  let p = at;
  for (;;) {
    const n = buf[p];
    if (n === undefined) throw new Error('GIF sub-blocks run past the end');
    p += 1 + n;
    if (n === 0) return p;
  }
}

/** The same chain, joined — GIF splits its compressed data into 255-byte pieces. */
function concatBlocks(buf: Buffer, at: number): Buffer {
  const parts: Buffer[] = [];
  let p = at;
  for (;;) {
    const n = buf[p];
    if (n === undefined) throw new Error('GIF sub-blocks run past the end');
    if (n === 0) break;
    parts.push(buf.subarray(p + 1, p + 1 + n));
    p += 1 + n;
  }
  return Buffer.concat(parts);
}

/**
 * GIF's variable-width LZW.
 *
 * Codes are read low bit first and grow from `minCodeSize + 1` bits as the
 * dictionary fills. Two codes are reserved: CLEAR resets the dictionary and the
 * code width, END stops. `count` bounds the output so a corrupt stream cannot
 * run away.
 */
function inflateLzw(data: Buffer, minCodeSize: number, count: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out = new Uint8Array(count);
  let written = 0;

  // The dictionary as (prefix, suffix) pairs, which avoids rebuilding strings.
  let prefix = new Int32Array(4096);
  let suffix = new Uint8Array(4096);
  let next = end + 1;
  let width = minCodeSize + 1;
  let previous = -1;

  let bit = 0;
  const stack = new Uint8Array(4096);

  const read = (): number => {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byte = data[bit >> 3];
      if (byte === undefined) return end;
      code |= ((byte >> (bit & 7)) & 1) << i;
      bit++;
    }
    return code;
  };

  for (;;) {
    const code = read();
    if (code === end) break;
    if (code === clear) {
      prefix = new Int32Array(4096);
      suffix = new Uint8Array(4096);
      next = end + 1;
      width = minCodeSize + 1;
      previous = -1;
      continue;
    }
    // The one case that looks like a bug and is not: a code may name the entry
    // about to be created, whose value is the previous string plus its own
    // first byte. Every LZW decoder has this branch.
    let current = code;
    let top = 0;
    if (code >= next) {
      if (previous < 0) throw new Error('GIF: a code before any dictionary entry');
      stack[top++] = firstOf(previous, prefix, clear);
      current = previous;
    }
    while (current >= clear) {
      stack[top++] = suffix[current]!;
      current = prefix[current]!;
      if (top >= stack.length) throw new Error('GIF: dictionary chain too long');
    }
    stack[top++] = current;
    while (top > 0 && written < count) out[written++] = stack[--top]!;
    if (written >= count) break;

    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = current;
      next++;
      // One more code than the width can express means the width grows. Off by
      // one here and the stream desynchronises a few hundred pixels in, which
      // looks like corrupt artwork rather than a decoder bug.
      if (next === (1 << width) && width < 12) width++;
    }
    previous = code;
  }
  return out;
}

/** The first byte of the string a dictionary code stands for: walk to its root. */
function firstOf(code: number, prefix: Int32Array, clear: number): number {
  let c = code;
  for (let guard = 0; guard < 4096 && c >= clear; guard++) c = prefix[c]!;
  return c;
}

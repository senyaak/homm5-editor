// The record encoding GroundTerrain.bin is built from, and the few operations
// that change a record's SIZE rather than its contents.
//
// Every other terrain edit overwrites bytes in place, because a plane's size is
// fixed for the life of a map. Two edits are not like that — adding a texture
// layer (`terrain-layer.ts`) and filling in the passability plane a fresh map
// leaves empty (`terrain-plane.ts`) — and both need to walk the record tree and
// grow every block that encloses what they spliced.
//
// --- the size encoding ---------------------------------------------------
//
// A block record is `tag <size> <body>`. The size's LOW BIT is a width flag,
// which is why every size the array scanner ever saw looked "always odd":
//
//   odd  -> the size is a little-endian u32 at that position, len = (size-1)/2
//   even -> the size IS that single byte,                    len = size/2
//
// Arrays are large and always take the u32 form; path strings are short and
// always take the one-byte form. Measured across all 20 layer paths in the two
// sample maps, with no exceptions: a path of length L is stored as
// `03 <2L+4> 03 <2L> <L bytes>` — an outer record wrapping the string record,
// each with a one-byte size.
//
// A third form is a scalar: `tag 08 <u32>`, used for grid dimensions and counts.

/** A located block record: `tag <size> <body>`. */
export interface Block {
  /** Offset of the tag byte. */
  off: number;
  tag: number;
  /** Offset of the size field. */
  sizeOff: number;
  /** 1 or 4 — how wide the size field is. */
  sizeWidth: number;
  body: number;
  bodyEnd: number;
}

/** A located scalar record: `tag 08 <u32>`. */
export interface Scalar { off: number; tag: number; int: number }

export type Record_ = Block | Scalar;

export const isBlock = (r: Record_): r is Block => !('int' in r);

/** Read one record at `p`, or null if the bytes there are not one. */
export function readRecord(b: Buffer, p: number, end: number): { rec: Record_; next: number } | null {
  if (p >= end) return null;
  const tag = b[p]!;
  if (tag < 0x01 || tag > 0x0f) return null;
  // Scalar: `tag 08 <u32>`.
  if (p + 6 <= end && b[p + 1] === 0x08) {
    return { rec: { off: p, tag, int: b.readUInt32LE(p + 2) }, next: p + 6 };
  }
  if (p + 2 > end) return null;
  const first = b[p + 1]!;
  let len: number, width: number;
  if (first & 1) {
    if (p + 5 > end) return null;
    len = (b.readUInt32LE(p + 1) - 1) / 2;
    width = 4;
  } else {
    len = first / 2;
    width = 1;
  }
  const body = p + 1 + width, bodyEnd = body + len;
  if (len < 1 || bodyEnd > end) return null;
  return { rec: { off: p, tag, sizeOff: p + 1, sizeWidth: width, body, bodyEnd }, next: bodyEnd };
}

/** Records directly inside [start, end). */
export function children(b: Buffer, start: number, end: number): Record_[] {
  const out: Record_[] = [];
  let p = start;
  while (p < end) {
    const r = readRecord(b, p, end);
    if (!r) break;
    out.push(r.rec);
    p = r.next;
  }
  return out;
}

/** Blocks enclosing `off`, outermost first. */
export function ancestors(b: Buffer, off: number, start = 0, end = b.length, acc: Block[] = []): Block[] {
  for (const r of children(b, start, end)) {
    if (!isBlock(r) || off < r.body || off >= r.bodyEnd) continue;
    acc.push(r);
    ancestors(b, off, r.body, r.bodyEnd, acc);
    return acc;
  }
  return acc;
}

/** Encode a block header for a body of `len` bytes, in whichever width fits. */
export function header(tag: number, len: number): Buffer {
  if (len <= 127) return Buffer.from([tag, len * 2]);
  const h = Buffer.alloc(5);
  h[0] = tag;
  h.writeUInt32LE(len * 2 + 1, 1);
  return h;
}

/** Encode a scalar record: `tag 08 <u32>` — a grid dimension or a count. */
export function scalar(tag: number, value: number): Buffer {
  const d = Buffer.alloc(6);
  d[0] = tag; d[1] = 0x08; d.writeUInt32LE(value, 2);
  return d;
}

/** Widen a block's declared length by `delta` bytes, in place. */
export function growBlock(out: Buffer, blk: Block, delta: number): void {
  const len = blk.bodyEnd - blk.body + delta;
  if (blk.sizeWidth === 4) {
    out.writeUInt32LE(len * 2 + 1, blk.sizeOff);
    return;
  }
  // A one-byte size cannot describe a body this large. No shipped map nests a
  // plane inside a short-form block, so this is a "the format is not what we
  // measured" signal, not a case to handle.
  if (len > 127) throw new Error(`block at ${blk.off} needs a wider size field (${len} bytes)`);
  out[blk.sizeOff] = len * 2;
}

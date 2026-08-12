// The payload format of every GS message: nested lists of strings and blobs.
//
// Ubisoft's Game Service carries no fixed structs. A message body is a
// `clDataList` — a tagged, self-describing tree, and every scalar in it is a
// STRING, numbers included: a port arrives as "40010" and a room id as "7".
// That is why our own server can be written without a table of struct layouts;
// what a message means is decided by its type and the shape of its list.
//
// Tags: `s` a NUL-terminated UTF-8 string, `b` a blob with a 4-byte big-endian
// length, `[` … `]` a nested list. The OUTER list's brackets are dropped when a
// list becomes a message body — `encodeBody`/`decodeBody` do that, `encode`/
// `decode` keep them.
//
// Exports:
//   type GSValue                     string | Uint8Array | GSValue[]
//   encode(list) / decode(buf)       a list with its brackets
//   encodeBody(list) / decodeBody(b) a message body — outer brackets implied

/** A value inside a GS list: a string, a blob, or a nested list. */
export type GSValue = string | Uint8Array | GSValue[];

const STR = 0x73; // 's'
const BIN = 0x62; // 'b'
const OPEN = 0x5b; // '['
const CLOSE = 0x5d; // ']'

function encodeInto(out: number[], list: readonly GSValue[]): void {
  out.push(OPEN);
  for (const value of list) {
    if (typeof value === 'string') {
      out.push(STR, ...Buffer.from(value, 'utf8'), 0);
    } else if (Array.isArray(value)) {
      encodeInto(out, value);
    } else {
      const size = value.length;
      out.push(BIN, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...value);
    }
  }
  out.push(CLOSE);
}

export function encode(list: readonly GSValue[]): Buffer {
  const out: number[] = [];
  encodeInto(out, list);
  return Buffer.from(out);
}

/** A message body: the same thing without the outer brackets. */
export function encodeBody(list: readonly GSValue[]): Buffer {
  return encode(list).subarray(1, -1);
}

/** Reads one list, starting at `at`, and says where it ended. */
function decodeAt(buf: Buffer, at: number): { list: GSValue[]; next: number } {
  const list: GSValue[] = [];
  let i = at;
  if (buf[i] === OPEN) i++;
  while (i < buf.length && buf[i] !== CLOSE) {
    const tag = buf[i]!;
    if (tag === STR) {
      const end = buf.indexOf(0, i + 1);
      if (end < 0) throw new Error('GS list: unterminated string');
      list.push(buf.toString('utf8', i + 1, end));
      i = end + 1;
    } else if (tag === BIN) {
      const size = buf.readUInt32BE(i + 1);
      if (i + 5 + size > buf.length) throw new Error(`GS list: blob of ${size} overruns the buffer`);
      // A plain Uint8Array, not a Buffer view: a blob outlives the buffer it
      // came out of, and a caller comparing two of them should not have to care
      // which class it got.
      list.push(new Uint8Array(buf.subarray(i + 5, i + 5 + size)));
      i += 5 + size;
    } else if (tag === OPEN) {
      const nested = decodeAt(buf, i);
      list.push(nested.list);
      i = nested.next;
    } else {
      throw new Error(`GS list: unknown tag 0x${tag.toString(16)} at ${i}`);
    }
  }
  return { list, next: i + 1 };
}

export function decode(buf: Buffer): GSValue[] {
  return decodeAt(buf, 0).list;
}

/** A message body: decode as if the missing outer brackets were there. */
export function decodeBody(buf: Buffer): GSValue[] {
  return decodeAt(Buffer.concat([Buffer.from([OPEN]), buf, Buffer.from([CLOSE])]), 0).list;
}

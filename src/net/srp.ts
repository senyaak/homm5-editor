// SRP — the reliable-UDP transport every GS service speaks underneath.
//
// It is TCP rewritten badly on top of UDP: a twelve-byte header with SYN / FIN /
// ACK / URG flags, sequence and acknowledgement numbers, a receive window
// announced in the first packet, and a one's-complement checksum. The top bits
// of the flags word are a constant 0x3040, which is how a stray datagram is told
// from a real one.
//
// A connection opens with the client's SYN, whose eight-byte body is the window:
// its own signature and the CHECKSUM SEED for the traffic it will send. Every
// later packet's checksum starts from that seed instead of zero, and each side
// announces its own — ours is 0, so the client's replies to us fold to the plain
// sum. Measured against a real client SYN: with the checksum field zeroed the
// sum of the captured packet is exactly the checksum the client wrote, and the
// sum over the packet as sent is 0, which is how a receiver checks one.
//
// Bodies are either that window (8 bytes) or a GS message (gs-message.ts).
//
// Exports:
//   Flags, HEADER_SIZE, WINDOW_SIZE
//   checksum(bytes, seed)      the value that belongs in a segment's field
//   verify(bytes, seed)        does a received segment check out
//   parseSegment(buf)          header + window or message bytes
//   buildSegment(segment)      the bytes of one segment, checksum filled in
//   type SrpConnection         what a server remembers per client

export const HEADER_SIZE = 12;
export const WINDOW_SIZE = 8;

/** Flag bits, plus the marker that says "this is SRP at all". */
export const Flags = { FIN: 1, SYN: 2, ACK: 4, URG: 8, MARKER: 0x3040 } as const;

export interface SrpHeader {
  checksum: number;
  signature: number;
  dataSize: number;
  flags: number;
  seg: number;
  ack: number;
}

export interface SrpWindow {
  tail: number;
  senderSignature: number;
  /** Seed the sender's later checksums start from. */
  checksumSeed: number;
  bufferSize: number;
}

export interface SrpSegment {
  header: SrpHeader;
  /** Present on SYN. */
  window?: SrpWindow;
  /** A GS message, still packed, when the body is not a window. */
  message?: Buffer;
}

/** What a service remembers about one client between datagrams. */
export interface SrpConnection {
  address: string;
  port: number;
  /** Seed to use when we sign packets to this client — its announced value. */
  checksumSeed: number;
  /** Signature the client expects to see in our headers. */
  signature: number;
  /** Our sequence number, one per segment we send. */
  nextSeg: number;
}

/**
 * One's-complement sum over a segment, with the checksum field replaced by
 * `seed` — the value that belongs in that field.
 *
 * An odd-length segment counts its FIRST byte on its own and pairs the rest,
 * which is unusual (the internet checksum pads at the END) and worth keeping in
 * mind if a length ever comes out odd.
 */
export function checksum(bytes: Buffer, seed = 0): number {
  const data = Buffer.from(bytes);
  if (data.length >= 2) data.writeUInt16LE(seed & 0xffff, 0);
  let total = 0;
  let at = 0;
  if (data.length % 2 === 1) {
    total += data[0]!;
    at = 1;
  }
  for (let i = 0; i < data.length >> 1; i++) {
    total += data.readUInt16LE(at);
    at += 2;
  }
  let folded = (total & 0xffff) + (total >>> 16);
  folded = (folded + (folded >>> 16)) & 0xffff;
  return ~folded & 0xffff;
}

/** Does a received segment's own checksum agree with its bytes? */
export function verify(bytes: Buffer, seed = 0): boolean {
  return bytes.length >= HEADER_SIZE && checksum(bytes, seed) === bytes.readUInt16LE(0);
}

export function parseSegment(buf: Buffer): SrpSegment {
  if (buf.length < HEADER_SIZE) throw new Error(`SRP segment of ${buf.length} bytes is shorter than a header`);
  const header: SrpHeader = {
    checksum: buf.readUInt16LE(0),
    signature: buf.readUInt16LE(2),
    dataSize: buf.readUInt16LE(4),
    flags: buf.readUInt16LE(6),
    seg: buf.readUInt16LE(8),
    ack: buf.readUInt16LE(10),
  };
  const segment: SrpSegment = { header };
  const body = buf.subarray(HEADER_SIZE, HEADER_SIZE + header.dataSize);
  if (body.length === WINDOW_SIZE) {
    segment.window = {
      tail: body.readUInt16LE(0),
      senderSignature: body.readUInt16LE(2),
      checksumSeed: body.readUInt16LE(4),
      bufferSize: body.readUInt16LE(6),
    };
  } else if (body.length > 0) {
    segment.message = Buffer.from(body);
  }
  return segment;
}

/** The bytes of one segment. The checksum is computed here, from `seed`. */
export function buildSegment(segment: SrpSegment, seed = 0): Buffer {
  const body = segment.window
    ? (() => {
        const window = Buffer.alloc(WINDOW_SIZE);
        window.writeUInt16LE(segment.window!.tail, 0);
        window.writeUInt16LE(segment.window!.senderSignature, 2);
        window.writeUInt16LE(segment.window!.checksumSeed, 4);
        window.writeUInt16LE(segment.window!.bufferSize, 6);
        return window;
      })()
    : (segment.message ?? Buffer.alloc(0));
  const out = Buffer.alloc(HEADER_SIZE + body.length);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(segment.header.signature, 2);
  out.writeUInt16LE(body.length, 4);
  out.writeUInt16LE(segment.header.flags, 6);
  out.writeUInt16LE(segment.header.seg, 8);
  out.writeUInt16LE(segment.header.ack, 10);
  body.copy(out, HEADER_SIZE);
  out.writeUInt16LE(checksum(out, seed), 0);
  return out;
}

/** Names of the flags a segment carries, for a log line. */
export function flagNames(flags: number): string {
  const names = Object.entries(Flags)
    .filter(([name, bit]) => name !== 'MARKER' && (flags & bit) !== 0)
    .map(([name]) => name);
  if ((flags & Flags.MARKER) !== Flags.MARKER) names.push('NO-MARKER');
  return names.length ? names.join('+') : 'MSG';
}

// Blowfish, and the small dialect of it the Game Service speaks.
//
// Two reasons this is here rather than a call into node:crypto: OpenSSL 3 moved
// Blowfish to its legacy provider and Node exposes no `bf-*` cipher at all
// (`getCiphers()` lists none), and the GS framing around the cipher is its own
// thing anyway:
//
//   - blocks are two 32-bit halves read LITTLE-endian, not the big-endian order
//     the reference implementations use;
//   - the plaintext is zero-padded up to a multiple of 8;
//   - the real length is appended as a little-endian u16 AFTER the ciphertext,
//     which is how the receiver trims the padding.
//
// The cipher itself is the 1993 one, unmodified: 16 rounds, the pi-digit tables
// in blowfish-tables.ts, keys of any length up to 56 bytes cycled into the
// P-array. The CD-key service uses one fixed key for everyone; the router
// negotiates a per-session key instead.
//
// Exports:
//   Blowfish   new(key); encrypt(plain) / decrypt(cipher) in the GS framing

import { ORIGINAL_P, ORIGINAL_S } from './blowfish-tables.ts';

const ROUNDS = 16;

export class Blowfish {
  private readonly p: Int32Array;
  private readonly s: Int32Array[];

  constructor(key: Uint8Array) {
    if (key.length === 0) throw new Error('Blowfish needs a key');
    this.p = Int32Array.from(ORIGINAL_P);
    this.s = ORIGINAL_S.map((box) => Int32Array.from(box));

    // The key, repeated as often as it takes, XORed into the subkeys.
    let at = 0;
    for (let i = 0; i < ROUNDS + 2; i++) {
      let data = 0;
      for (let k = 0; k < 4; k++) {
        data = ((data << 8) | key[at]!) >>> 0;
        at = (at + 1) % key.length;
      }
      this.p[i] = (ORIGINAL_P[i]! ^ data) | 0;
    }

    // Then every subkey and box entry is replaced by encrypting a running block
    // with the schedule built so far — 521 encryptions, which is why Blowfish is
    // slow to key and fast to use.
    let left = 0;
    let right = 0;
    for (let i = 0; i < ROUNDS + 2; i += 2) {
      [left, right] = this.encryptBlock(left, right);
      this.p[i] = left | 0;
      this.p[i + 1] = right | 0;
    }
    for (const box of this.s) {
      for (let j = 0; j < 256; j += 2) {
        [left, right] = this.encryptBlock(left, right);
        box[j] = left | 0;
        box[j + 1] = right | 0;
      }
    }
  }

  private f(x: number): number {
    const a = (x >>> 24) & 0xff;
    const b = (x >>> 16) & 0xff;
    const c = (x >>> 8) & 0xff;
    const d = x & 0xff;
    // Adds wrap at 32 bits; >>> 0 after each keeps that true in JS doubles.
    let y = (((this.s[0]![a]! >>> 0) + (this.s[1]![b]! >>> 0)) >>> 0) ^ (this.s[2]![c]! >>> 0);
    y = ((y >>> 0) + (this.s[3]![d]! >>> 0)) >>> 0;
    return y;
  }

  private encryptBlock(xl: number, xr: number): [number, number] {
    let left = xl >>> 0;
    let right = xr >>> 0;
    for (let i = 0; i < ROUNDS; i++) {
      left = (left ^ (this.p[i]! >>> 0)) >>> 0;
      right = (right ^ this.f(left)) >>> 0;
      [left, right] = [right, left];
    }
    [left, right] = [right, left];
    right = (right ^ (this.p[ROUNDS]! >>> 0)) >>> 0;
    left = (left ^ (this.p[ROUNDS + 1]! >>> 0)) >>> 0;
    return [left >>> 0, right >>> 0];
  }

  private decryptBlock(xl: number, xr: number): [number, number] {
    let left = xl >>> 0;
    let right = xr >>> 0;
    for (let i = ROUNDS + 1; i > 1; i--) {
      left = (left ^ (this.p[i]! >>> 0)) >>> 0;
      right = (right ^ this.f(left)) >>> 0;
      [left, right] = [right, left];
    }
    [left, right] = [right, left];
    right = (right ^ (this.p[1]! >>> 0)) >>> 0;
    left = (left ^ (this.p[0]! >>> 0)) >>> 0;
    return [left >>> 0, right >>> 0];
  }

  /** Zero-padded, encrypted, with the original length appended as a u16. */
  encrypt(plain: Uint8Array): Buffer {
    if (plain.length > 0xffff) throw new Error(`GS Blowfish cannot carry ${plain.length} bytes`);
    const padded = Buffer.alloc(Math.ceil(plain.length / 8) * 8);
    Buffer.from(plain).copy(padded);
    for (let at = 0; at < padded.length; at += 8) {
      const [left, right] = this.encryptBlock(padded.readUInt32LE(at), padded.readUInt32LE(at + 4));
      padded.writeUInt32LE(left, at);
      padded.writeUInt32LE(right, at + 4);
    }
    const out = Buffer.alloc(padded.length + 2);
    padded.copy(out);
    out.writeUInt16LE(plain.length, padded.length);
    return out;
  }

  decrypt(cipher: Uint8Array): Buffer {
    if (cipher.length < 10) throw new Error(`GS Blowfish body of ${cipher.length} bytes is too short`);
    const buf = Buffer.from(cipher);
    const size = buf.readUInt16LE(buf.length - 2);
    const blocks = buf.subarray(0, buf.length - 2);
    if (blocks.length % 8 !== 0) throw new Error(`GS Blowfish body of ${blocks.length} bytes is not whole blocks`);
    const plain = Buffer.from(blocks);
    for (let at = 0; at < plain.length; at += 8) {
      const [left, right] = this.decryptBlock(plain.readUInt32LE(at), plain.readUInt32LE(at + 4));
      plain.writeUInt32LE(left, at);
      plain.writeUInt32LE(right, at + 4);
    }
    if (size > plain.length) throw new Error(`GS Blowfish claims ${size} bytes out of ${plain.length}`);
    return plain.subarray(0, size);
  }
}

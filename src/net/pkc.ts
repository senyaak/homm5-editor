// The key exchange that opens every router connection.
//
// The client's first message on the router socket is a KEY_EXCHANGE carrying its
// own RSA public key as a 260-byte blob: a 32-bit little-endian bit count, then
// the modulus and the exponent, each right-aligned in a 128-byte big-endian
// field. Measured on a real client: 512 bits, exponent 3, so the modulus fills
// 64 of its 128 bytes and the rest is zero.
//
// We answer with our own key in the same shape, and the client then sends a
// 16-byte Blowfish session key encrypted to it (PKCS#1 v1.5). From that point on
// a message may arrive Blowfish-encrypted instead of merely shuffled.
//
// The maths is OpenSSL's, through node:crypto — a 512-bit key with exponent 3 is
// exactly what it will still generate, and PKCS#1 v1.5 is what the client uses.
// Nothing here is meant to be secure: it is 2005's handshake, kept
// bit-compatible.
//
// Exports:
//   KEY_BLOB_SIZE, PUBLIC_KEY_BITS
//   parsePublicKey(buf) / publicKeyBlob(key)   the wire shape
//   generateKeyPair()                          ours, per connection
//   encryptTo(key, data) / decryptWith(pem, data)

import { createPublicKey, generateKeyPairSync, publicEncrypt, privateDecrypt, constants, type KeyObject } from 'node:crypto';

/** Each of the two fields is 128 bytes wide, whatever the key's real size. */
const FIELD = 128;
export const KEY_BLOB_SIZE = 4 + 2 * FIELD;
export const PUBLIC_KEY_BITS = 512;

export interface RsaPublicKey {
  bits: number;
  modulus: bigint;
  exponent: bigint;
}

export interface RsaKeyPair {
  publicKey: RsaPublicKey;
  /** Kept as a KeyObject; only this side ever needs the private half. */
  privateKey: KeyObject;
}

function readBigIntBE(bytes: Buffer): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function writeBigIntBE(value: bigint, size: number): Buffer {
  const out = Buffer.alloc(size);
  let rest = value;
  for (let i = size - 1; i >= 0 && rest > 0n; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest > 0n) throw new Error(`RSA field of ${size} bytes cannot hold this number`);
  return out;
}

export function parsePublicKey(blob: Uint8Array): RsaPublicKey {
  if (blob.length < KEY_BLOB_SIZE) throw new Error(`RSA key blob is ${blob.length} bytes, expected ${KEY_BLOB_SIZE}`);
  const buf = Buffer.from(blob);
  return {
    bits: buf.readUInt32LE(0),
    modulus: readBigIntBE(buf.subarray(4, 4 + FIELD)),
    exponent: readBigIntBE(buf.subarray(4 + FIELD, 4 + 2 * FIELD)),
  };
}

export function publicKeyBlob(key: RsaPublicKey): Buffer {
  const out = Buffer.alloc(KEY_BLOB_SIZE);
  out.writeUInt32LE(key.bits, 0);
  writeBigIntBE(key.modulus, FIELD).copy(out, 4);
  writeBigIntBE(key.exponent, FIELD).copy(out, 4 + FIELD);
  return out;
}

/** The minimal big-endian bytes of a number, which is what a JWK wants. */
function base64Url(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return Buffer.from(hex, 'hex').toString('base64url');
}

/** A KeyObject for someone else's (modulus, exponent) — the client's key. */
export function publicKeyOf(key: RsaPublicKey): KeyObject {
  return createPublicKey({
    key: { kty: 'RSA', n: base64Url(key.modulus), e: base64Url(key.exponent) },
    format: 'jwk',
  });
}

export function generateKeyPair(): RsaKeyPair {
  const pair = generateKeyPairSync('rsa', { modulusLength: PUBLIC_KEY_BITS, publicExponent: 3 });
  const jwk = pair.publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  return {
    publicKey: {
      bits: PUBLIC_KEY_BITS,
      modulus: readBigIntBE(Buffer.from(jwk.n, 'base64url')),
      exponent: readBigIntBE(Buffer.from(jwk.e, 'base64url')),
    },
    privateKey: pair.privateKey,
  };
}

export function encryptTo(key: RsaPublicKey, data: Uint8Array): Buffer {
  return publicEncrypt({ key: publicKeyOf(key), padding: constants.RSA_PKCS1_PADDING }, data);
}

export function decryptWith(privateKey: KeyObject, data: Uint8Array): Buffer {
  return privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, data);
}

// One Game Service message: a six-byte header and an obfuscated list body.
//
// Header, in order: total size as a 24-bit BIG-endian number (the only
// big-endian field in the protocol), then one byte carrying the body's flavour
// in its top two bits and a priority in the rest, then the message type, then
// sender and receiver as two nibbles. Everything after the header is the body —
// a GS list (gs-data.ts) run through the shuffle (gs-xor.ts), or Blowfish when
// the flavour says so, which we do not implement yet.
//
// `size` counts the header, so a bundle of messages in one TCP read is walked by
// stepping `size` bytes at a time.
//
// Exports:
//   MessageType, Property, Party    the enums a message names itself with
//   parse(buf) -> GSMessage | null  one message off the front of a buffer
//   build(msg) -> Buffer            the bytes of one message
//   reply(to, body) -> GSMessage    same type, parties swapped, new body

import { decodeBody, encodeBody, type GSValue } from './gs-data.ts';
import { decrypt, encrypt } from './gs-xor.ts';

/** Message types we name. The protocol has ~150; these are the ones we answer. */
export const MessageType = {
  PLAYERINFO: 19,
  GSSUCCESS: 38,
  GSFAIL: 39,
  STILLALIVE: 58,
  LOGINWAITMODULE: 77,
  LOGINFRIENDS: 78,
  JOINWAITMODULE: 93,
  LOGIN: 102,
  PROXY_HANDLER: 204,
  LOBBY_MSG: 209,
  LOBBYSERVERLOGIN: 210,
  KEY_EXCHANGE: 219,
  NAT: 221,
} as const;

/** What the body is: a shuffled list, game data, or Blowfish-encrypted. */
export const Property = { GS: 0, GAME: 1, GS_ENCRYPT: 2 } as const;

/** Who a message is from or to. The client fills these in; we mirror them. */
export const Party = { ROUTER: 1, SERVER: 2, PEER: 4, PROXY: 8 } as const;

export const HEADER_SIZE = 6;

export interface GSMessage {
  size: number;
  property: number;
  priority: number;
  type: number;
  sender: number;
  receiver: number;
  /** Decoded body, or null when the message is a bare header. */
  body: GSValue[] | null;
}

/**
 * How an encrypted body is opened. Which key applies is a property of the
 * connection, not of the message, so the caller supplies this.
 */
export type BodyDecryptor = (body: Buffer) => Buffer;

/**
 * One message off the front of `buf`, or null when the buffer holds less than a
 * whole one. `size` says where the next message in a bundle begins.
 *
 * A body marked GS_ENCRYPT needs `decryptBody`; without it this throws rather
 * than hand back a message whose contents were never read.
 */
export function parse(buf: Buffer, decryptBody?: BodyDecryptor): GSMessage | null {
  if (buf.length < HEADER_SIZE) return null;
  const size = (buf[0]! << 16) | (buf[1]! << 8) | buf[2]!;
  if (size < HEADER_SIZE || buf.length < size) return null;
  const message: GSMessage = {
    size,
    property: buf[3]! >> 6,
    priority: buf[3]! & 0x3f,
    type: buf[4]!,
    sender: buf[5]! >> 4,
    receiver: buf[5]! & 0x0f,
    body: null,
  };
  if (size > HEADER_SIZE) {
    const raw = buf.subarray(HEADER_SIZE, size);
    if (message.property === Property.GS) message.body = decodeBody(decrypt(raw));
    else if (message.property === Property.GS_ENCRYPT) {
      if (!decryptBody) throw new Error('GS_ENCRYPT body with no key to open it');
      message.body = decodeBody(decryptBody(raw));
    }
  }
  return message;
}

export function build(message: Omit<GSMessage, 'size'>): Buffer {
  const body = message.body === null ? Buffer.alloc(0) : encrypt(encodeBody(message.body));
  const size = HEADER_SIZE + body.length;
  const header = Buffer.alloc(HEADER_SIZE);
  header[0] = (size >>> 16) & 0xff;
  header[1] = (size >>> 8) & 0xff;
  header[2] = size & 0xff;
  header[3] = ((message.property & 3) << 6) | (message.priority & 0x3f);
  header[4] = message.type & 0xff;
  header[5] = ((message.sender & 0x0f) << 4) | (message.receiver & 0x0f);
  return Buffer.concat([header, body]);
}

/** An answer to `to`: its type, its parties the other way round, our body. */
export function reply(to: GSMessage, body: GSValue[], type = to.type): Omit<GSMessage, 'size'> {
  return {
    property: Property.GS,
    priority: to.priority,
    type,
    sender: to.receiver,
    receiver: to.sender,
    body,
  };
}

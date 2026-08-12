// The CD-key service — and our answer to it, which is always yes.
//
// The client asks this service to challenge, activate, authorise and validate the
// key the player typed. Every one of those is a QUESTION TO THE SERVER: the
// client carries no list of valid keys and does no arithmetic of its own, it only
// shows what it is told. Since the server is ours, "is this key any good" is our
// decision — and there is no key registry to check against, so anything the
// player types is good. The screen stays (the client owns it, and remembers the
// key in its own `ubi_cdkey` setting), but it costs one typing and never fails.
//
// The framing is not SRP: a plain UDP datagram, one byte of type, a big-endian
// u32 length, then the body — a GS list, Blowfish-encrypted with a key that is
// the same for every copy of the game. That key is not a secret and never was;
// it is written into the client.
//
// The ids in the answers (activation, authorisation, validation) are opaque
// tokens the client stores and echoes; we derive them from the key it sent, so
// two different keys are answered differently, and keep the lengths the client
// has always seen.
//
// Exports:
//   CdKeyService     handle(packet, from) -> { replies, note }

import { createHash } from 'node:crypto';
import { Blowfish } from './blowfish.ts';
import { decodeBody, encodeBody, type GSValue } from './gs-data.ts';
import { MessageType } from './gs-message.ts';

/** Fixed for every client; it lives in the game's own code. */
const SHARED_KEY = Buffer.from('SKJDHF$0maoijfn4i8$aJdnv1jaldifar93-AS_dfo;hjhC4jhflasnF3fnd', 'utf8');

const HEADER_SIZE = 5;

export const CdKeyRequest = {
  CHALLENGE: 1,
  ACTIVATION: 2,
  AUTH: 3,
  VALIDATION: 4,
  PLAYER_STATUS: 5,
  DISCONNECT_USER: 6,
  STILL_ALIVE: 7,
} as const;

/** What we say about the player behind the key. */
const PLAYER_VALID = 2;

const requestNames = new Map(Object.entries(CdKeyRequest).map(([name, value]) => [value as number, name]));

export interface CdKeyResult {
  replies: Buffer[];
  note: string;
}

/**
 * A token of `length` bytes, the same every time for the same request — so a
 * client that asks twice is told the same thing.
 */
function token(seed: string, length: number): Uint8Array {
  const out = Buffer.alloc(length);
  let filled = 0;
  for (let round = 0; filled < length; round++) {
    const digest = createHash('sha256').update(`${seed}:${round}`).digest();
    const take = Math.min(length - filled, digest.length);
    digest.copy(out, filled, 0, take);
    filled += take;
  }
  return new Uint8Array(out);
}

/**
 * A blob whose contents are themselves an encoded blob.
 *
 * The reference implementation wraps its tokens twice like this and the client
 * accepts it, so we do the same rather than find out the hard way; the inner
 * layer is a `b` element with its own four-byte length.
 */
function nestedBlob(bytes: Uint8Array): Uint8Array {
  const inner = Buffer.alloc(5 + bytes.length);
  inner[0] = 0x62;
  inner.writeUInt32BE(bytes.length, 1);
  Buffer.from(bytes).copy(inner, 5);
  return new Uint8Array(inner);
}

export class CdKeyService {
  private readonly cipher = new Blowfish(SHARED_KEY);

  handle(packet: Buffer, from: { address: string; port: number }): CdKeyResult {
    if (packet.length <= HEADER_SIZE) return { replies: [], note: `${packet.length} bytes is not a CD-key message` };
    const type = packet[0]!;
    const body = decodeBody(this.cipher.decrypt(packet.subarray(HEADER_SIZE)));

    const messageId = String(body[0] ?? '0');
    const request = Number(body[1] ?? 0);
    const echo = String(body[2] ?? '0');
    const name = requestNames.get(request) ?? `request ${request}`;
    const seed = `${from.address}:${messageId}:${request}`;

    let data: GSValue[] | null;
    switch (request) {
      case CdKeyRequest.CHALLENGE:
        data = [nestedBlob(token(`${seed}:challenge`, 20))];
        break;
      case CdKeyRequest.ACTIVATION:
        data = [nestedBlob(token(`${seed}:activation`, 11)), nestedBlob(token(`${seed}:activation2`, 11))];
        break;
      case CdKeyRequest.AUTH:
        data = [nestedBlob(token(`${seed}:auth`, 15))];
        break;
      case CdKeyRequest.VALIDATION:
        data = [String(PLAYER_VALID), nestedBlob(token(`${seed}:validation`, 11))];
        break;
      case CdKeyRequest.STILL_ALIVE:
        return { replies: [], note: 'CD-key keep-alive' };
      default:
        return { replies: [], note: `${name} is not implemented — nothing sent` };
    }

    const answer = encodeBody([messageId, String(request), echo, [String(MessageType.GSSUCCESS), data]]);
    const encrypted = this.cipher.encrypt(answer);
    const out = Buffer.alloc(HEADER_SIZE + encrypted.length);
    out[0] = type;
    out.writeUInt32BE(encrypted.length, 1);
    encrypted.copy(out, HEADER_SIZE);
    return { replies: [out], note: `${name} — answered yes` };
  }
}

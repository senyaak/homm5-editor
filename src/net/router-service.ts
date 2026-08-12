// The router — the TCP door every online session comes through.
//
// It is the GS front desk: key exchange, then a login, then a hand-off to the
// next service. Nothing about a game happens here; what happens is that the
// client stops being anonymous and gets told where to go. The order, as the
// client drives it:
//
//   KEY_EXCHANGE "1"   here is my RSA public key   -> here is ours
//   KEY_EXCHANGE "2"   here is a Blowfish key      -> and here is ours
//   LOGIN              here is a username          -> GSSUCCESS
//   JOINWAITMODULE     where do I go now           -> an address and a port
//   STILLALIVE         keep-alive                     (no answer)
//
// Accounts are ours to define: the client shows a name and a password, and what
// they mean is a decision on this side. For now every name is accepted, which is
// the smallest thing that lets the session continue — `docs/NETWORK.md` says
// what registration will look like when there is somewhere to keep it.
//
// Messages arrive over a TCP stream and can be bundled, so a session buffers and
// walks whole messages by their size field.
//
// Exports:
//   RouterService     new(waitModule) -> session(); session.receive(buf) -> Buffer[]

import { MessageType, build, parse, reply, type GSMessage } from './gs-message.ts';
import { type GSValue } from './gs-data.ts';
import { decryptWith, generateKeyPair, parsePublicKey, publicKeyBlob, encryptTo, type RsaKeyPair, type RsaPublicKey } from './pkc.ts';
import { randomBytes } from 'node:crypto';

/** Where the client is sent after it logs in. */
export interface Endpoint {
  address: string;
  port: number;
}

export interface RouterEvent {
  note: string;
  replies: Buffer[];
}

/** A one-byte body value, which is how GS names the message being answered. */
function messageId(type: number): GSValue {
  return new Uint8Array([type & 0xff]);
}

/** A little-endian u32 body value — how a port travels. */
function u32(value: number): GSValue {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return new Uint8Array(out);
}

export class RouterSession {
  private buffer = Buffer.alloc(0);
  private keys: RsaKeyPair | null = null;
  private clientKey: RsaPublicKey | null = null;
  /** The key the client will encrypt bodies with, once it has told us. */
  clientBlowfishKey: Buffer | null = null;
  /** The key we would encrypt with. Generated, announced, unused so far. */
  serverBlowfishKey: Buffer | null = null;
  username = '';

  private readonly waitModule: Endpoint;

  constructor(waitModule: Endpoint) {
    this.waitModule = waitModule;
  }

  /** Feed bytes from the socket; get back what to send, and a line for the log. */
  receive(chunk: Buffer): RouterEvent[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const events: RouterEvent[] = [];
    for (;;) {
      const message = parse(this.buffer);
      if (!message) break;
      this.buffer = this.buffer.subarray(message.size);
      events.push(this.handle(message));
    }
    return events;
  }

  private handle(message: GSMessage): RouterEvent {
    switch (message.type) {
      case MessageType.KEY_EXCHANGE:
        return this.keyExchange(message);
      case MessageType.LOGIN: {
        const name = message.body?.[0];
        this.username = typeof name === 'string' ? name : '';
        return {
          note: `LOGIN as "${this.username}" — accepted`,
          replies: [build(reply(message, [messageId(MessageType.LOGIN)], MessageType.GSSUCCESS))],
        };
      }
      case MessageType.JOINWAITMODULE:
        return {
          note: `JOINWAITMODULE — sent to ${this.waitModule.address}:${this.waitModule.port}`,
          replies: [
            build(
              reply(
                message,
                [messageId(MessageType.JOINWAITMODULE), [this.waitModule.address, u32(this.waitModule.port)]],
                MessageType.GSSUCCESS,
              ),
            ),
          ],
        };
      case MessageType.STILLALIVE:
        return { note: 'STILLALIVE', replies: [] };
      default:
        return { note: `no handler for message type ${message.type} — nothing sent`, replies: [] };
    }
  }

  private keyExchange(message: GSMessage): RouterEvent {
    const step = message.body?.[0];
    const payload = message.body?.[1];
    const blob = Array.isArray(payload) ? payload[2] : undefined;

    if (step === '1') {
      if (!(blob instanceof Uint8Array)) return { note: 'KEY_EXCHANGE 1 without a key blob — ignored', replies: [] };
      this.clientKey = parsePublicKey(blob);
      this.keys = generateKeyPair();
      const ours = publicKeyBlob(this.keys.publicKey);
      return {
        note: `KEY_EXCHANGE 1 — client key ${this.clientKey.bits} bits, exponent ${this.clientKey.exponent}; ours sent`,
        replies: [build(reply(message, ['1', ['1', String(ours.length), new Uint8Array(ours)]]))],
      };
    }

    if (step === '2') {
      if (!(blob instanceof Uint8Array) || !this.keys || !this.clientKey) {
        return { note: 'KEY_EXCHANGE 2 out of order — ignored', replies: [] };
      }
      this.clientBlowfishKey = decryptWith(this.keys.privateKey, blob);
      this.serverBlowfishKey = randomBytes(16);
      const encrypted = encryptTo(this.clientKey, this.serverBlowfishKey);
      return {
        note: `KEY_EXCHANGE 2 — client session key ${this.clientBlowfishKey.length} bytes; ours sent`,
        replies: [build(reply(message, ['2', ['1', String(encrypted.length), new Uint8Array(encrypted)]]))],
      };
    }

    return { note: `KEY_EXCHANGE step ${String(step)} is not implemented`, replies: [] };
  }
}

export class RouterService {
  private readonly waitModule: Endpoint;

  constructor(waitModule: Endpoint) {
    this.waitModule = waitModule;
  }

  session(): RouterSession {
    return new RouterSession(this.waitModule);
  }
}

// The NAT service — the first thing the game insists on, and the smallest.
//
// It is the address mirror of the GS suite: the client opens an SRP connection
// over UDP and asks "what do I look like from out there", and the answer is its
// own address and port as the service sees them. Nothing else in the stack can
// start until this one replies (`NUbi::CStateUninitialized::NATInit` fails the
// whole online session otherwise, docs/NETWORK.md), which is why it is the piece
// we implement first.
//
// Kept free of sockets on purpose: `handle` takes a datagram and gives back the
// datagrams to send, so it can be driven by a test with recorded bytes instead
// of by a running game.
//
// Exports:
//   NatService     handle(packet, from) -> { replies, note }

import { inetU32 } from './address.ts';
import { MessageType, build, parse, reply } from './gs-message.ts';
import { Flags, HEADER_SIZE, buildSegment, parseSegment, flagNames, type SrpConnection } from './srp.ts';

/**
 * The answer to a NAT ask, in the ONE shape that has ever been accepted.
 *
 * Four runs, and only the third was let through — its own log said "address
 * request succeeded,address=1.0.0.127:40010":
 *
 *   subtypes 2 and 3, inet_addr order, our port      -> waited 30s, gave up
 *   subtypes 1, 2, 3, inet_addr order, our port      -> ACCEPTED
 *   subtype 1, host order, the client's port         -> waited 30s, gave up
 *   the same, sent twice 250ms apart                 -> waited 30s, gave up
 *
 * The 30 seconds is the `0x1E` handed to the NAT connect, so those are timeouts
 * being served out, not races. And the accepted answer is the one that looked
 * WRONG in the client's own log: it prints the octets of a network-order address
 * the other way round, so "1.0.0.127" is how it renders 127.0.0.1 — reading that
 * line as an error and "fixing" the byte order broke a working step.
 *
 * So: all three subtypes, `inet_addr` order, our own port. One variable at a time
 * from here, and only from a state that works.
 */
const NAT_ANSWERS = [1, 2, 3] as const;

/** Our own window: the client may start its checksums from zero. */
const OUR_WINDOW = { tail: 10, senderSignature: 2, checksumSeed: 0, bufferSize: 0x218 } as const;

export { hostU32 } from './address.ts';
export { inetU32 };

export interface NatResult {
  replies: Buffer[];
  /**
   * The same answer again, this many milliseconds later.
   *
   * Kept because the plumbing for it is in the server, but nothing asks for it
   * now: repeating the answer did NOT get it accepted, which is how the race
   * theory died and the 30-second timeout was found instead.
   */
  againAfterMs?: number;
  /** One line for the log: what this datagram was. */
  note: string;
}

export class NatService {
  private readonly connections = new Map<string, SrpConnection>();
  private readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  handle(packet: Buffer, from: { address: string; port: number }): NatResult {
    const key = `${from.address}:${from.port}`;

    // Anything too short to be a segment is a keep-alive ping, and the client
    // wants its own bytes back.
    if (packet.length < HEADER_SIZE) {
      return { replies: [packet], note: `ping, ${packet.length} bytes echoed` };
    }

    const segment = parseSegment(packet);
    const flags = segment.header.flags;

    if ((flags & Flags.FIN) !== 0) {
      this.connections.delete(key);
      return { replies: [], note: `${flagNames(flags)} — connection dropped` };
    }

    let connection = this.connections.get(key);
    if (segment.window) {
      // The SYN carries the seed and signature every later packet of ours needs.
      connection = {
        address: from.address,
        port: from.port,
        checksumSeed: segment.window.checksumSeed,
        signature: segment.window.senderSignature,
        nextSeg: 0,
      };
      this.connections.set(key, connection);
      const answer = buildSegment(
        {
          header: {
            checksum: 0,
            signature: connection.signature,
            dataSize: 0,
            flags: Flags.MARKER | Flags.SYN | Flags.ACK,
            seg: connection.nextSeg++,
            ack: segment.header.seg,
          },
          window: { ...OUR_WINDOW },
        },
        connection.checksumSeed,
      );
      return {
        replies: [answer],
        note: `${flagNames(flags)} — opened, seed 0x${connection.checksumSeed.toString(16)}, signature 0x${connection.signature.toString(16)}`,
      };
    }

    if (!connection) {
      return { replies: [], note: `${flagNames(flags)} from an unknown client — ignored` };
    }

    if (!segment.message) {
      return { replies: [], note: `${flagNames(flags)} — nothing to answer` };
    }

    const request = parse(segment.message);
    if (!request || request.type !== MessageType.NAT) {
      return { replies: [], note: `message type ${request?.type ?? '?'} is not NAT — ignored` };
    }

    // The body is [subtype, [requestId, …]] and the request id has to come back
    // with the answer: the client checks it against the one it is waiting for and
    // calls anything else a "parasite request".
    const inner = request.body?.[1];
    const requestId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '0';
    const seen = String(inetU32(from.address));
    const replies = NAT_ANSWERS.map((subtype) => {
      const message = build(reply(request, [String(subtype), [requestId, seen, String(this.port)]]));
      return buildSegment(
        {
          header: {
            checksum: 0,
            signature: connection!.signature,
            dataSize: 0,
            flags: Flags.MARKER | Flags.ACK,
            seg: connection!.nextSeg++,
            ack: segment.header.seg,
          },
          message,
        },
        connection!.checksumSeed,
      );
    });

    return {
      replies,
      note: `NAT ask, request ${requestId} — answered ${from.address} as u32 ${seen}, subtypes ${NAT_ANSWERS.join(', ')}`,
    };
  }
}

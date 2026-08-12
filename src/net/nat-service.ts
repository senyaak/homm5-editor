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

/** Sub-types of a NAT message. Both answer with an address; the client asks. */
const NatMessage = { PORT_ID: 2, ADDRESS: 3 } as const;

/** Our own window: the client may start its checksums from zero. */
const OUR_WINDOW = { tail: 10, senderSignature: 2, checksumSeed: 0, bufferSize: 0x218 } as const;

export { inetU32, hostU32 } from './address.ts';

export interface NatResult {
  replies: Buffer[];
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

    // The body is [something, [socketId, …]]; the socket id has to come back
    // with the answer so the client can match it to the socket that asked.
    const inner = request.body?.[1];
    const socketId = Array.isArray(inner) && typeof inner[0] === 'string' ? inner[0] : '0';
    const seen = String(inetU32(from.address));

    const replies = [NatMessage.PORT_ID, NatMessage.ADDRESS].map((subtype) => {
      const message = build(reply(request, [String(subtype), [socketId, seen, String(this.port)]]));
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

    return { replies, note: `NAT ask for socket ${socketId} — answered ${from.address}:${from.port} as u32 ${seen}` };
  }
}

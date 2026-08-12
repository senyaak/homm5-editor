// Checks our Game Service layers against bytes a real client sent.
//
// The recorded packets are the two the game put on our NAT port (captured
// 12.08.2026, docs/NETWORK.md): an SRP SYN with its window, and the FIN it sends
// when it gives up waiting. They are the only ground truth we have, so the
// checksum test is the one that matters most — it is the piece a wrong answer
// dies on silently.
//
// Usage: `node tools/test-net.ts`

import { decode, decodeBody, encode, encodeBody, type GSValue } from '../src/net/gs-data.ts';
import { decrypt, encrypt } from '../src/net/gs-xor.ts';
import { HEADER_SIZE, Flags, buildSegment, checksum, parseSegment, verify } from '../src/net/srp.ts';
import { MessageType, Property, build, parse } from '../src/net/gs-message.ts';
import { NatService, addressToU32 } from '../src/net/nat-service.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** The client's opening SYN, exactly as it arrived. */
const CLIENT_SYN = Buffer.from('9388000008004230000000000a000100ff441802', 'hex');
/** And the FIN+URG it repeats nine times before starting over. */
const CLIENT_FIN = Buffer.from('b6cf000000004930ffff0000', 'hex');

console.log('\nSRP against recorded client packets');
{
  const segment = parseSegment(CLIENT_SYN);
  check('SYN header reads back', segment.header.dataSize === 8 && segment.header.seg === 0);
  check('flags are the marker plus SYN', segment.header.flags === (Flags.MARKER | Flags.SYN), `0x${segment.header.flags.toString(16)}`);
  check('window is there', segment.window !== undefined);
  check(
    'window says seed 0x44ff, signature 1, buffer 536',
    segment.window?.checksumSeed === 0x44ff && segment.window?.senderSignature === 1 && segment.window?.bufferSize === 0x218,
  );

  // The one that proves the algorithm: the client's own checksum, recomputed.
  check('checksum of the SYN is the one the client wrote', checksum(CLIENT_SYN) === 0x8893, `0x${checksum(CLIENT_SYN).toString(16)}`);
  check('a segment as sent sums to a valid checksum', verify(CLIENT_SYN));

  // And it has to be able to FAIL: one flipped byte must not still verify.
  const tampered = Buffer.from(CLIENT_SYN);
  tampered[13]! ^= 0x01;
  check('a flipped byte no longer verifies', !verify(tampered));

  const fin = parseSegment(CLIENT_FIN);
  check('FIN carries FIN+URG', (fin.header.flags & Flags.FIN) !== 0 && (fin.header.flags & Flags.URG) !== 0);
  check('checksum of the FIN also matches', checksum(CLIENT_FIN) === 0xcfb6, `0x${checksum(CLIENT_FIN).toString(16)}`);
}

console.log('\nSRP segments we build');
{
  const seed = 0x44ff;
  const bytes = buildSegment(
    {
      header: { checksum: 0, signature: 1, dataSize: 0, flags: Flags.MARKER | Flags.SYN | Flags.ACK, seg: 0, ack: 0 },
      window: { tail: 10, senderSignature: 2, checksumSeed: 0, bufferSize: 0x218 },
    },
    seed,
  );
  check('a built SYN+ACK is header plus window', bytes.length === HEADER_SIZE + 8);
  check('its length field matches its body', parseSegment(bytes).header.dataSize === 8);
  check('it verifies against the seed we signed it with', verify(bytes, seed));
  check('and not against a different seed', !verify(bytes, 0));
}

console.log('\nGS list codec');
{
  const list: GSValue[] = ['2', ['7', '16777343', '40010'], new Uint8Array([1, 2, 3])];
  const round = decode(encode(list));
  check('a list survives a round trip', JSON.stringify(round) === JSON.stringify(list));
  check('a body round trips without its brackets', JSON.stringify(decodeBody(encodeBody(list))) === JSON.stringify(list));
  check('a body is the list minus two bytes', encodeBody(list).length === encode(list).length - 2);
}

console.log('\nGS obfuscation');
{
  let sizes = 0;
  let same = 0;
  for (let size = 1; size <= 200; size++) {
    const body = Buffer.alloc(size);
    for (let i = 0; i < size; i++) body[i] = (i * 37 + size) & 0xff;
    sizes++;
    if (decrypt(encrypt(body)).equals(body)) same++;
  }
  check('every length from 1 to 200 survives the shuffle', same === sizes, `${same}/${sizes}`);
  const body = Buffer.from('hello ubi', 'utf8');
  check('the shuffle actually changes the bytes', !encrypt(body).equals(body));
}

console.log('\nGS messages');
{
  const bytes = build({ property: Property.GS, priority: 0, type: MessageType.NAT, sender: 4, receiver: 8, body: ['3', ['7']] });
  const message = parse(bytes);
  check('a message reads back its own header', message?.type === MessageType.NAT && message?.sender === 4 && message?.receiver === 8);
  check('size counts the header', message?.size === bytes.length);
  check('and the body comes back', JSON.stringify(message?.body) === JSON.stringify(['3', ['7']]));
  check('a truncated message is refused, not guessed', parse(bytes.subarray(0, bytes.length - 1)) === null);
}

console.log('\nNAT service, driven by the recorded packets');
{
  const service = new NatService(40010);
  const from = { address: '127.0.0.1', port: 1024 };
  check('an address becomes the u32 GS passes around', addressToU32('127.0.0.1') === 16777343, String(addressToU32('127.0.0.1')));

  const opened = service.handle(CLIENT_SYN, from);
  check('the SYN gets exactly one answer', opened.replies.length === 1, opened.note);
  const answer = parseSegment(opened.replies[0]!);
  check('the answer is SYN+ACK', (answer.header.flags & Flags.SYN) !== 0 && (answer.header.flags & Flags.ACK) !== 0);
  check('it acknowledges the segment that opened it', answer.header.ack === 0);
  check('it carries our window', answer.window?.bufferSize === 0x218);
  check('it is signed with the seed the client announced', verify(opened.replies[0]!, 0x44ff));

  // A NAT ask, in the shape the client sends: [subtype, [socketId]].
  const ask = build({ property: Property.GS, priority: 0, type: MessageType.NAT, sender: 4, receiver: 8, body: ['1', ['7']] });
  const asked = service.handle(
    buildSegment(
      { header: { checksum: 0, signature: 1, dataSize: 0, flags: Flags.MARKER, seg: 1, ack: 1 }, message: ask },
      0x44ff,
    ),
    from,
  );
  check('an ask is answered twice — port id and address', asked.replies.length === 2, asked.note);
  const first = parse(parseSegment(asked.replies[0]!).message!);
  check('the answer is a NAT message', first?.type === MessageType.NAT);
  check(
    'it tells the client its own address and our port',
    JSON.stringify(first?.body) === JSON.stringify(['2', ['7', '16777343', '40010']]),
    JSON.stringify(first?.body),
  );

  const ping = service.handle(Buffer.from([1, 2, 3, 4]), from);
  check('a short packet is echoed as a ping', ping.replies.length === 1 && ping.replies[0]!.length === 4);

  const closed = service.handle(CLIENT_FIN, from);
  check('a FIN is answered with silence', closed.replies.length === 0, closed.note);
  const after = service.handle(
    buildSegment({ header: { checksum: 0, signature: 1, dataSize: 0, flags: Flags.MARKER, seg: 2, ack: 1 }, message: ask }, 0x44ff),
    from,
  );
  check('and the client is forgotten', after.replies.length === 0, after.note);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);

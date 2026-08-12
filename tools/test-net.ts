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
import { KEY_BLOB_SIZE, decryptWith, encryptTo, generateKeyPair, parsePublicKey, publicKeyBlob } from '../src/net/pkc.ts';
import { RouterService } from '../src/net/router-service.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** The client's opening SYN, exactly as it arrived. */
const CLIENT_SYN = Buffer.from('9388000008004230000000000a000100ff441802', 'hex');
/** And the FIN+URG it repeats nine times before starting over. */
const CLIENT_FIN = Buffer.from('b6cf000000004930ffff0000', 'hex');
/**
 * The first thing it says on the router socket once the NAT step succeeds: a
 * KEY_EXCHANGE carrying its own 512-bit RSA public key.
 */
const ROUTER_KEY_EXCHANGE = Buffer.from(
  '00011c00db82fa8bbfa4979da4acb5bfcad69f44b0b121bbfea3969ca3abb4bec9d5c96be35b2031d7e3f799a2aab3bd' +
    'c8d4ccddcaef1f30408f949aa1a9b2bcc7d36c70d6d11e2f3f4ea39da0a8b1bbc6d2b50bef751e2e3e4d5b999fa7b0ba' +
    'c5d105b26801f42d3d4c5a679ea6afb9c4d0ddc1b9e5ba2c3c4b596672a5aeb8c3cfdce561bea02b3b4a5865717cadb7' +
    'c2cedbbd1bed6a2a3a495764707b85b6c1cdda7ce0be8e29394856636f7a848dc0ccd9a557b5f328384755626e79838c' +
    '94cbd807935fe527374654616d78828b939ad79fa36b7b26364553606c77818a9299aeeede76253544525f6b76808991' +
    '98c373382f243443515e6a757f8890979ee9f7233342505d69747e878f969c4e2232414f5c68737d868e959b',
  'hex',
);

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

console.log('\nRSA key blobs, against the key a real client sent');
{
  // The KEY_EXCHANGE body the game put on our router port, captured 12.08.2026.
  const message = parse(ROUTER_KEY_EXCHANGE);
  const payload = message?.body?.[1];
  const blob = Array.isArray(payload) ? payload[2] : undefined;
  check('the captured packet is a KEY_EXCHANGE', message?.type === MessageType.KEY_EXCHANGE);
  check('its body says step 1', message?.body?.[0] === '1');
  check('the key blob is 260 bytes', blob instanceof Uint8Array && blob.length === KEY_BLOB_SIZE, String((blob as Uint8Array)?.length));

  const key = parsePublicKey(blob as Uint8Array);
  check('the client key is 512 bits with exponent 3', key.bits === 512 && key.exponent === 3n, `${key.bits} bits, e=${key.exponent}`);
  check('its modulus really is 512 bits', key.modulus.toString(2).length === 512);
  check('re-serializing gives back the same bytes', publicKeyBlob(key).equals(Buffer.from(blob as Uint8Array)));

  // Our own key has to survive the same round trip, and be usable.
  const pair = generateKeyPair();
  check('our key round trips through the blob', parsePublicKey(publicKeyBlob(pair.publicKey)).modulus === pair.publicKey.modulus);
  const secret = Buffer.from('0123456789abcdef', 'utf8');
  check('a session key encrypted to us comes back', decryptWith(pair.privateKey, encryptTo(pair.publicKey, secret)).equals(secret));
}

console.log('\nRouter, driven by the recorded packet');
{
  const session = new RouterService({ address: '127.0.0.1', port: 40001 }).session();
  const events = session.receive(ROUTER_KEY_EXCHANGE);
  check('the key exchange gets exactly one answer', events.length === 1 && events[0]!.replies.length === 1, events[0]?.note);

  const answer = parse(events[0]!.replies[0]!);
  check('the answer is a KEY_EXCHANGE too', answer?.type === MessageType.KEY_EXCHANGE);
  check('with the parties turned round', answer?.sender === 2 && answer?.receiver === 8, `${answer?.sender}->${answer?.receiver}`);
  const ours = Array.isArray(answer?.body?.[1]) ? (answer!.body![1] as GSValue[]) : [];
  check('it says step 1 and carries a key', answer?.body?.[0] === '1' && ours[0] === '1');
  check('the length it states matches the blob', ours[1] === String(KEY_BLOB_SIZE) && (ours[2] as Uint8Array)?.length === KEY_BLOB_SIZE);
  check('and that blob parses as a 512-bit key', parsePublicKey(ours[2] as Uint8Array).bits === 512);

  // A login is accepted and answered as success, naming the message it answers.
  const login = build({ property: Property.GS, priority: 0, type: MessageType.LOGIN, sender: 8, receiver: 2, body: ['senyaak', 'secret'] });
  const loggedIn = session.receive(login);
  const success = parse(loggedIn[0]!.replies[0]!);
  check('a login is answered with GSSUCCESS', success?.type === MessageType.GSSUCCESS, loggedIn[0]?.note);
  check('the answer names LOGIN', (success?.body?.[0] as Uint8Array)?.[0] === MessageType.LOGIN);
  check('the name is remembered', session.username === 'senyaak');

  // Two messages in one read must both be handled, and a split one must wait.
  const alive = build({ property: Property.GS, priority: 0, type: MessageType.STILLALIVE, sender: 8, receiver: 2, body: null });
  const bundled = session.receive(Buffer.concat([alive, login]));
  check('a bundle of two is walked, not truncated', bundled.length === 2, bundled.map((e) => e.note).join(' | '));
  const half = session.receive(login.subarray(0, 4));
  check('half a message waits for its other half', half.length === 0);
  check('and completes when the rest arrives', session.receive(login.subarray(4)).length === 1);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);

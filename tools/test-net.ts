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
import { NatService, inetU32 } from '../src/net/nat-service.ts';
import { KEY_BLOB_SIZE, decryptWith, encryptTo, generateKeyPair, parsePublicKey, publicKeyBlob } from '../src/net/pkc.ts';
import { RouterService } from '../src/net/router-service.ts';
import { Blowfish } from '../src/net/blowfish.ts';
import { CdKeyRequest, CdKeyService } from '../src/net/cdkey-service.ts';
import { LobbyMsg } from '../src/net/lobby.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A GS_ENCRYPT message, built the way the client builds one. */
function encryptedMessage(type: number, body: GSValue[], key: Buffer): Buffer {
  const encrypted = new Blowfish(key).encrypt(encodeBody(body));
  const size = 6 + encrypted.length;
  const header = Buffer.alloc(6);
  header[0] = (size >>> 16) & 0xff;
  header[1] = (size >>> 8) & 0xff;
  header[2] = size & 0xff;
  header[3] = Property.GS_ENCRYPT << 6;
  header[4] = type & 0xff;
  header[5] = (8 << 4) | 2;
  return Buffer.concat([header, encrypted]);
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
  check('the NAT mirror uses the inet_addr form', inetU32('127.0.0.1') === 16777343, String(inetU32('127.0.0.1')));

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
  const session = new RouterService({ address: '127.0.0.1', port: 40001 }, { address: '127.0.0.1', port: 40030 }, { address: '127.0.0.1', port: 40031 }, { address: '127.0.0.1', port: 40040 }).session();
  const events = session.receive(ROUTER_KEY_EXCHANGE);
  check('the key exchange gets exactly one answer', events.length === 1 && events[0]!.replies.length === 1, events[0]?.note);

  const answer = parse(events[0]!.replies[0]!);
  check('the answer is a KEY_EXCHANGE too', answer?.type === MessageType.KEY_EXCHANGE);
  check('with the parties turned round', answer?.sender === 2 && answer?.receiver === 8, `${answer?.sender}->${answer?.receiver}`);
  const ours = Array.isArray(answer?.body?.[1]) ? (answer!.body![1] as GSValue[]) : [];
  check('it says step 1 and carries a key', answer?.body?.[0] === '1' && ours[0] === '1');
  check('the length it states matches the blob', ours[1] === String(KEY_BLOB_SIZE) && (ours[2] as Uint8Array)?.length === KEY_BLOB_SIZE);
  check('and that blob parses as a 512-bit key', parsePublicKey(ours[2] as Uint8Array).bits === 512);

  // Where the client is sent next, and in the form it can actually use: a
  // decimal u32, because a dotted string reaches it as its first octet.
  const jwm = build({ property: Property.GS, priority: 0, type: MessageType.JOINWAITMODULE, sender: 4, receiver: 1, body: null });
  const sent = session.receive(jwm);
  const answer2 = parse(sent[0]!.replies[0]!);
  const where = answer2?.body?.[1] as GSValue[];
  check('the wait module answer is a success', answer2?.type === MessageType.GSSUCCESS, sent[0]?.note);
  check('the address is 127.0.0.1 in host order', where?.[0] === '2130706433', String(where?.[0]));
  check('the port is four raw bytes, little-endian', Buffer.from(where?.[1] as Uint8Array).readUInt32LE(0) === 40001);

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

console.log('\nRouter, once the session keys are up');
{
  const session = new RouterService({ address: '127.0.0.1', port: 40001 }, { address: '127.0.0.1', port: 40030 }, { address: '127.0.0.1', port: 40031 }, { address: '127.0.0.1', port: 40040 }).session();
  // Step one gives us the key the client should seal its session key to.
  const opened = session.receive(ROUTER_KEY_EXCHANGE);
  const ourBlob = (parse(opened[0]!.replies[0]!)!.body![1] as GSValue[])[2] as Uint8Array;
  const ourKey = parsePublicKey(ourBlob);
  const sessionKey = Buffer.from('0123456789abcdef', 'utf8');
  const sealed = encryptTo(ourKey, sessionKey);
  const step2 = build({
    property: Property.GS,
    priority: 0,
    type: MessageType.KEY_EXCHANGE,
    sender: 8,
    receiver: 2,
    body: ['2', ['1', String(sealed.length), new Uint8Array(sealed)]],
  });
  const keyed = session.receive(step2);
  check('the session key is taken', keyed[0]!.replies.length === 1, keyed[0]?.note);
  check('and it is the one the client sealed', session.clientBlowfishKey?.equals(sessionKey) === true);

  // A login the way it really arrived: GS_ENCRYPT, keyed with OUR session key.
  const encrypted = encryptedMessage(MessageType.LOGIN, ['senyaak', 'secret'], session.serverBlowfishKey!);
  const loggedIn = session.receive(encrypted);
  check('an encrypted login is opened and answered', loggedIn[0]!.replies.length === 1, loggedIn[0]?.note);
  check('the name inside it is read', session.username === 'senyaak');
  check('and we know which key opened it', session.encryptedWith !== null, String(session.encryptedWith));

  // What the client asked next, verbatim from the wire: where does the module
  // "persistantdata" live? (Its spelling, not ours.)
  const asked = session.receive(
    build({
      property: Property.GS,
      priority: 0,
      type: MessageType.PROXY_HANDLER,
      sender: 4,
      receiver: 1,
      body: ['1', ['persistantdata', '0', '0']],
    }),
  );
  const proxied = parse(asked[0]!.replies[0]!);
  check('a module request is answered', asked[0]!.replies.length === 1, asked[0]?.note);
  check('the answer keeps the PROXY_HANDLER type', proxied?.type === MessageType.PROXY_HANDLER);
  check(
    'and names the module with our proxy behind it',
    JSON.stringify(proxied?.body) === JSON.stringify(['38', ['1', ['persistantdata', '0', '0', [['1', '2130706433', '40030']]]]]),
    JSON.stringify(proxied?.body),
  );
  check(
    'an unknown module is not invented',
    session.receive(
      build({ property: Property.GS, priority: 0, type: MessageType.PROXY_HANDLER, sender: 4, receiver: 1, body: ['1', ['clanservice', '0', '0']] }),
    )[0]!.replies.length === 0,
  );

  // The bug that stalled the first real login: a body we cannot open must not
  // stay at the front of the stream.
  const gibberish = encryptedMessage(MessageType.LOGIN, ['nobody'], Buffer.from('a-key-we-never-agreed', 'utf8'));
  const alive = build({ property: Property.GS, priority: 0, type: MessageType.STILLALIVE, sender: 8, receiver: 2, body: null });
  const mixed = session.receive(Buffer.concat([gibberish, alive]));
  check('an unreadable message is reported, not left in the way', mixed.length === 2, mixed.map((e) => e.note).join(' | '));
  check('and the stream keeps working after it', session.receive(alive).length === 1);
}

console.log('\nBlowfish');
{
  // The 1993 test vector: an all-zero key and an all-zero block encrypt to
  // 4EF997456198DD78. Our blocks are read little-endian, so those two halves come
  // out byte-reversed — round-tripping alone would not catch a wrong S-box.
  const zeros = new Blowfish(Buffer.alloc(8));
  const block = zeros.encrypt(Buffer.alloc(8)).subarray(0, 8);
  check('the standard test vector comes out right', block.toString('hex') === '4597f94e78dd9861', block.toString('hex'));

  const cipher = new Blowfish(Buffer.from('SKJDHF$0maoijfn4i8$aJdnv1jaldifar93-AS_dfo;hjhC4jhflasnF3fnd', 'utf8'));
  let ok = 0;
  for (let size = 1; size <= 64; size++) {
    const plain = Buffer.alloc(size);
    for (let i = 0; i < size; i++) plain[i] = (i * 91 + size) & 0xff;
    if (cipher.decrypt(cipher.encrypt(plain)).equals(plain)) ok++;
  }
  check('every length from 1 to 64 survives a round trip', ok === 64, `${ok}/64`);
  check('the length trailer is where the padding is trimmed', cipher.encrypt(Buffer.alloc(5)).length === 10);
}

console.log('\nCD-key service');
{
  const service = new CdKeyService();
  const cipher = new Blowfish(Buffer.from('SKJDHF$0maoijfn4i8$aJdnv1jaldifar93-AS_dfo;hjhC4jhflasnF3fnd', 'utf8'));
  const from = { address: '127.0.0.1', port: 1030 };

  /** A request in the client's framing: type byte, big-endian size, body. */
  const ask = (request: number, inner: GSValue[] = []): Buffer => {
    const body = cipher.encrypt(encodeBody(['17', String(request), '0', inner]));
    const out = Buffer.alloc(5 + body.length);
    out[0] = 1;
    out.writeUInt32BE(body.length, 1);
    body.copy(out, 5);
    return out;
  };

  for (const [name, request] of [
    ['challenge', CdKeyRequest.CHALLENGE],
    ['activation', CdKeyRequest.ACTIVATION],
    ['authorisation', CdKeyRequest.AUTH],
  ] as const) {
    const result = service.handle(ask(request, ['ABCD-EFGH-IJKL-MNOP']), from);
    const body = decodeBody(cipher.decrypt(result.replies[0]!.subarray(5)));
    const inner = body[3] as GSValue[];
    check(`a ${name} request is answered`, result.replies.length === 1, result.note);
    check(`the ${name} answer echoes the message id and type`, body[0] === '17' && body[1] === String(request));
    check(`the ${name} answer says success`, inner?.[0] === String(MessageType.GSSUCCESS), String(inner?.[0]));
  }

  const validated = service.handle(ask(CdKeyRequest.VALIDATION), from);
  const inner = (decodeBody(cipher.decrypt(validated.replies[0]!.subarray(5)))[3] as GSValue[])[1] as GSValue[];
  check('a validation says the player is valid', inner[0] === '2', String(inner[0]));

  check('a keep-alive is not answered', service.handle(ask(CdKeyRequest.STILL_ALIVE), from).replies.length === 0);
  // The same question twice has to get the same token, or the client sees its
  // activation change under it.
  const first = service.handle(ask(CdKeyRequest.ACTIVATION), from).replies[0]!;
  const again = service.handle(ask(CdKeyRequest.ACTIVATION), from).replies[0]!;
  check('the same request gets the same answer', first.equals(again));
}

console.log('\nThe proxy desk answers differently, because the client asked it to');
{
  const proxy = new RouterService(
    { address: '127.0.0.1', port: 40001 },
    { address: '127.0.0.1', port: 40030 },
    { address: '127.0.0.1', port: 40031 },
    { address: '127.0.0.1', port: 40040 },
  ).session('proxy');

  const login = build({ property: Property.GS, priority: 0, type: MessageType.LOGIN, sender: 4, receiver: 1, body: ['Senyaak', 'secret'] });
  const loggedIn = proxy.receive(login);
  const answer = parse(loggedIn[0]!.replies[0]!);
  check('the proxy login is a success', answer?.type === MessageType.GSSUCCESS, loggedIn[0]?.note);
  check(
    'and carries the empty list the proxy expects beside the id',
    Array.isArray(answer?.body?.[1]) && (answer!.body![1] as GSValue[]).length === 0,
    JSON.stringify(answer?.body),
  );

  const jwm = build({ property: Property.GS, priority: 0, type: MessageType.JOINWAITMODULE, sender: 4, receiver: 1, body: null });
  const handed = proxy.receive(jwm);
  const onwards = parse(handed[0]!.replies[0]!)?.body?.[1] as GSValue[];
  check('the proxy names the user in its hand-off', onwards?.[0] === 'Senyaak', JSON.stringify(onwards));
  check('the address is still host order', onwards?.[1] === '2130706433');
  check('but the port is spelled out here, not four bytes', onwards?.[2] === '40031');
}

console.log('\nThe lobby, as far as the wait module goes');
{
  const desk = new RouterService(
    { address: '127.0.0.1', port: 40001 },
    { address: '127.0.0.1', port: 40030 },
    { address: '127.0.0.1', port: 40031 },
    { address: '127.0.0.1', port: 40040 },
  ).session('router');

  const lobbyMessage = (subtype: number, inner: GSValue[]): Buffer =>
    build({ property: Property.GS, priority: 0, type: MessageType.LOBBY_MSG, sender: 4, receiver: 1, body: [String(subtype), inner] });

  // Verbatim from the wire: the client logs in to the lobby naming the game.
  const loggedIn = desk.receive(lobbyMessage(LobbyMsg.LOGIN, ['HEROES_29988429c481f219']));
  const ok = parse(loggedIn[0]!.replies[0]!);
  check('the lobby login is answered', loggedIn[0]!.replies.length === 1, loggedIn[0]?.note);
  check('as a LOBBY_MSG saying success', ok?.type === MessageType.LOBBY_MSG && ok?.body?.[0] === '38');

  const listed = desk.receive(lobbyMessage(LobbyMsg.CHANGE_REQUESTED_LOBBIES, ['HEROES_29988429c481f219']));
  const info = parse(listed[0]!.replies[0]!);
  const groups = (info?.body?.[1] as GSValue[])?.[3] as GSValue[];
  check('the lobby list comes back as GROUP_INFO', info?.body?.[0] === String(LobbyMsg.GROUP_INFO), listed[0]?.note);
  check('with our three lobbies', Array.isArray(groups) && groups.length === 3, String(groups?.length));
  const ranked = (groups?.[1] as GSValue[]) ?? [];
  check('each is fourteen fields', ranked.length === 14, String(ranked.length));
  check('Ranked is named and rated', ranked[1] === 'Ranked' && ranked[11] === '1', `${String(ranked[1])}, mode ${String(ranked[11])}`);

  const joined = desk.receive(lobbyMessage(LobbyMsg.JOIN_SERVER, ['1']));
  const where = (parse(joined[0]!.replies[0]!)?.body?.[1] as GSValue[])?.[1] as GSValue[];
  check('joining a server hands over the lobby address', where?.[1] === '2130706433' && where?.[2] === '40040', JSON.stringify(where));
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);

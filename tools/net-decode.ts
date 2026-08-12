// Turns a captured packet back into something readable.
//
// The server logs hex dumps; this reads one back and says what it was — an SRP
// segment with its flags and window, a GS message with its type and party, and
// the list its body decodes to. Written because every step of this protocol is
// learned by staring at one packet, and doing that by hand is how mistakes get
// made.
//
// Feed it the dump straight from the log (offsets and the text column are
// ignored), a plain hex string, or a file of either:
//
//   node tools/net-decode.ts 00011c00db82...
//   node tools/net-decode.ts --srp <hex>        # the bytes start with an SRP header
//   node tools/net-decode.ts --file dump.txt

import { readFileSync } from 'node:fs';
import { decodeBody, type GSValue } from '../src/net/gs-data.ts';
import { decrypt } from '../src/net/gs-xor.ts';
import { HEADER_SIZE as GS_HEADER, MessageType, Property, parse } from '../src/net/gs-message.ts';
import { HEADER_SIZE as SRP_HEADER, flagNames, parseSegment, verify } from '../src/net/srp.ts';
import { IRC_KEY } from '../src/net/irc.ts';
import { Blowfish } from '../src/net/blowfish.ts';

const args = process.argv.slice(2);
const srpMode = args.includes('--srp');
const fileAt = args.indexOf('--file');
const source =
  fileAt >= 0 ? readFileSync(args[fileAt + 1]!, 'utf8') : args.filter((a) => !a.startsWith('--')).join(' ');

/** Hex out of a log dump: drop the offset column, the text column and spaces. */
function hexOf(text: string): Buffer {
  const hex = text
    .split(/\r?\n/)
    .map((line) => {
      const dump = /^\s*[0-9a-f]{4}\s+((?:[0-9a-f]{2} ?)+)/i.exec(line);
      return dump ? dump[1]! : /^[0-9a-f\s]+$/i.test(line) ? line : '';
    })
    .join('')
    .replace(/[^0-9a-f]/gi, '');
  if (hex.length % 2 !== 0) throw new Error(`odd number of hex digits (${hex.length})`);
  return Buffer.from(hex, 'hex');
}

const typeNames = new Map(Object.entries(MessageType).map(([name, value]) => [value as number, name]));
const propertyNames = new Map(Object.entries(Property).map(([name, value]) => [value as number, name]));

function show(list: GSValue[], indent = '  '): string {
  return list
    .map((value) => {
      if (typeof value === 'string') return `${indent}"${value}"`;
      if (Array.isArray(value)) return `${indent}[\n${show(value, indent + '  ')}\n${indent}]`;
      return `${indent}<${value.length} bytes> ${Buffer.from(value).toString('hex')}`;
    })
    .join('\n');
}

function showMessage(bytes: Buffer, indent = ''): void {
  const message = parse(bytes);
  if (!message) {
    console.log(`${indent}not a whole GS message (${bytes.length} bytes)`);
    return;
  }
  const type = typeNames.get(message.type) ?? `type ${message.type}`;
  const property = propertyNames.get(message.property) ?? `property ${message.property}`;
  console.log(
    `${indent}GS ${type}  ${property}  ${message.sender}->${message.receiver}  priority ${message.priority}  ${message.size} bytes`,
  );
  if (message.body) console.log(show(message.body, `${indent}  `));
  else if (message.size > GS_HEADER) console.log(`${indent}  (body not decoded)`);
  // A single read can carry several messages back to back.
  if (bytes.length > message.size) {
    console.log(`${indent}--- and ${bytes.length - message.size} bytes more:`);
    showMessage(bytes.subarray(message.size), indent);
  }
}

const bytes = hexOf(source);
if (!bytes.length) {
  console.log('nothing to decode — pass hex, a log dump, or --file <path>');
  process.exit(1);
}
console.log(`${bytes.length} bytes`);

// `--irc`: chat is IRC text, but wrapped — a big-endian u16 length and a
// Blowfish body on a key that is the same for every client.
if (args.includes('--irc')) {
  const bytes = hexOf(source);
  const cipher = new Blowfish(IRC_KEY);
  console.log(`${bytes.length} bytes`);
  for (let at = 0; at + 2 <= bytes.length; ) {
    const size = bytes.readUInt16BE(at);
    if (size === 0 || at + 2 + size > bytes.length) {
      console.log(`  stray ${bytes.length - at} bytes: ${bytes.subarray(at).toString('hex')}`);
      break;
    }
    const text = cipher.decrypt(bytes.subarray(at + 2, at + 2 + size)).toString('latin1');
    console.log(`  IRC ${JSON.stringify(text)}`);
    at += 2 + size;
  }
  process.exit(0);
}

if (srpMode) {
  const segment = parseSegment(bytes);
  const { header } = segment;
  console.log(
    `SRP  ${flagNames(header.flags)}  seg ${header.seg}  ack ${header.ack}  signature 0x${header.signature.toString(16)}  body ${header.dataSize}`,
  );
  console.log(`     checksum 0x${header.checksum.toString(16)} — ${verify(bytes) ? 'valid with seed 0' : 'needs a seed'}`);
  if (segment.window) {
    console.log(
      `     window: tail ${segment.window.tail}, signature 0x${segment.window.senderSignature.toString(16)}, seed 0x${segment.window.checksumSeed.toString(16)}, buffer ${segment.window.bufferSize}`,
    );
  }
  if (segment.message) showMessage(segment.message, '     ');
  if (!segment.window && !segment.message && bytes.length > SRP_HEADER) console.log('     (body is neither window nor message)');
} else {
  showMessage(bytes);
  // If the header did not make sense, the body shuffle at least might.
  if (!parse(bytes)) console.log(`de-shuffled: ${decrypt(bytes).toString('hex')}\n${show(decodeBody(decrypt(bytes)))}`);
}

// Recursive tree walker for the HoMM5 binary container.
//
// Grammar (little-endian):
//   record = <tag:u8 0x01..0x0f> <payload>
//     * byte after tag == 0x08  -> scalar int32:  tag 08 <u32>
//     * else                    -> length-prefixed block:
//                                  tag <u32 sizeB> <body>,  sizeB = 2*byteLen+1
//
// A block body is a NODE (child records) or a LEAF (raw vertex/normal/uv/index
// array). Discriminator: a body is a NODE iff it *starts* with a record that is
// itself well-formed and fits inside the body; raw float/index data does not.
// Blocks may carry a few trailing non-record bytes (padding / 0xffffffff
// sentinels) which we tolerate and report as `+Nb tail`.
//
// Usage: node tools/tree-geometry.js <binfile> [maxDepth]

import { readFileSync } from 'node:fs';

const file = process.argv[2];
const MAXD = Number(process.argv[3] ?? 20);
const b = readFileSync(file);
const u32 = (o) => b.readUInt32LE(o);
const f = (o) => b.readFloatLE(o);

/** Read one record at p within [.,end). @returns {rec|null} */
function readRecord(p, end) {
  if (p >= end) return null;
  const tag = b[p];
  if (tag < 0x01 || tag > 0x0f) return null;
  if (p + 6 <= end && b[p + 1] === 0x08) return { off: p, tag, int: u32(p + 2), next: p + 6 };
  if (p + 5 > end) return null;
  const s = u32(p + 1);
  if ((s & 1) === 0) return null;
  const len = (s - 1) / 2;
  const body = p + 5, bodyEnd = body + len;
  if (len < 1 || bodyEnd > end) return null;
  return { off: p, tag, len, body, bodyEnd, next: bodyEnd };
}

/** A body is a node if its first record is well-formed and fits. */
function isNode(body, bodyEnd) {
  const r = readRecord(body, bodyEnd);
  return !!r && r.next <= bodyEnd;
}

function leafKind(off, len) {
  const s = [];
  for (let i = 0; i < Math.min(3, len / 4); i++) s.push(f(off + i * 4).toFixed(2));
  const t = [];
  if (len % 12 === 0) t.push(`${len / 12}×vec3f`);
  if (len % 8 === 0) t.push(`${len / 8}×vec2f`);
  if (len % 6 === 0) t.push(`${len / 6}×tri16`);
  if (len % 2 === 0) t.push(`${len / 2}×u16`);
  return `${t.join(' ')}  ~[${s.join(',')}]`;
}

/** Parse [start,end) into records; returns {recs, tail}. */
function parseNode(start, end, depth) {
  const recs = [];
  let p = start;
  while (p < end) {
    const r = readRecord(p, end);
    if (!r) break; // trailing padding/sentinel
    if ('int' in r) recs.push(r);
    else if (depth < MAXD && isNode(r.body, r.bodyEnd)) {
      r.node = parseNode(r.body, r.bodyEnd, depth + 1);
      recs.push(r);
    } else { r.leaf = true; recs.push(r); }
    p = r.next;
  }
  return { recs, tail: end - p };
}

function print(node, indent) {
  for (const r of node.recs) {
    const pad = '  '.repeat(indent);
    if ('int' in r) { console.log(`${pad}@${r.off} tag${r.tag.toString(16)} int=${r.int}`); continue; }
    if (r.node) {
      const t = r.node.tail ? `  +${r.node.tail}b tail` : '';
      console.log(`${pad}@${r.off} tag${r.tag.toString(16)} node[${r.len}B]${t}`);
      print(r.node, indent + 1);
    } else {
      console.log(`${pad}@${r.off} tag${r.tag.toString(16)} leaf[${r.len}B] ${leafKind(r.body, r.len)}`);
    }
  }
}

const root = parseNode(0, b.length, 0);
console.log(`file ${file}  size ${b.length}  top-level tail ${root.tail}B\n`);
print(root, 0);

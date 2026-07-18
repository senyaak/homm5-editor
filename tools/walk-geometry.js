// Sequential structural walker for the HoMM5 binary container (as used by
// bin/Geometries/<uid> and GroundTerrain.bin). Unlike a scanner, this walks the
// stream record-by-record: if our grammar is correct it advances cleanly from
// offset 0 to EOF without ever desyncing. Desync = grammar bug, and the walker
// prints where it broke so we can refine.
//
// Grammar hypothesis (little-endian throughout):
//   record = <tag:u8> <payload>
//     tag in 0x01..0x0f
//     if next byte == 0x08          -> scalar int32:   tag 08 <u32>          (6 bytes)
//     else read s = u32 after tag:
//        if s is odd and len=(s-1)/2 fits the buffer   -> byte array:
//                                        tag <u32 s> <len bytes>             (5+len)
//        else                          -> scalar u32:  tag <u32>             (5 bytes)
//
// Usage: node tools/walk-geometry.js <binfile> [maxRecords]

import { readFileSync } from 'node:fs';

const file = process.argv[2];
const maxRec = Number(process.argv[3] ?? 400);
const b = readFileSync(file);
const u32 = (o) => b.readUInt32LE(o);
const f = (o) => b.readFloatLE(o);
console.log(`file ${file}  size ${b.length}\n`);

/** Classify a raw byte array by how its length divides, to guess its role. */
function describeArray(off, len) {
  const hints = [];
  if (len % 12 === 0) hints.push(`${len / 12} vec3(f32)`);
  if (len % 8 === 0) hints.push(`${len / 8} vec2(f32)`);
  if (len % 6 === 0) hints.push(`${len / 6} tri(u16)`);
  if (len % 2 === 0) hints.push(`${len / 2} u16`);
  // sample first few float32 to eyeball
  const s = [];
  for (let i = 0; i < Math.min(3, Math.floor(len / 4)); i++) s.push(f(off + i * 4).toFixed(2));
  return `${hints.join(' | ')}   ~[${s.join(', ')}]`;
}

let p = 0, n = 0, depth = 0;
while (p < b.length && n < maxRec) {
  const tag = b[p];
  if (tag < 0x01 || tag > 0x0f) { console.log(`@${p} STOP: non-tag byte 0x${tag.toString(16)}`); break; }

  if (b[p + 1] === 0x08) {
    const v = u32(p + 2);
    console.log(`@${String(p).padStart(6)}  tag${tag.toString(16).padStart(2, '0')}  int32 = ${v}`);
    p += 6; n++; continue;
  }

  const s = u32(p + 1);
  const len = (s - 1) / 2;
  if ((s & 1) && len >= 1 && p + 5 + len <= b.length) {
    console.log(`@${String(p).padStart(6)}  tag${tag.toString(16).padStart(2, '0')}  array len=${len}   ${describeArray(p + 5, len)}`);
    p += 5 + len; n++; continue;
  }

  // scalar u32 (size/offset/hash that isn't a fitting array)
  console.log(`@${String(p).padStart(6)}  tag${tag.toString(16).padStart(2, '0')}  u32 = ${s}`);
  p += 5; n++;
}
console.log(`\nstopped at @${p} / ${b.length}  (${n} records)`);

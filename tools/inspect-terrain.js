// Exploratory inspector for GroundTerrain.bin.
// Goal: locate the known blocks (per WindBell 2009 spec) inside a real file by
// signature-scanning, so we can reverse the exact layout empirically.
//
// Spec recap (vertices = tiles+1 per side):
//   Head, Texture[], Height(float32), Plateau(u8), Ramp(u8), WaterDepth(u8),
//   Passable(u8), End.
//
// Usage: node tools/inspect-terrain.js _tmp/probes/A2M3_GroundTerrain.bin 96

import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? '_tmp/probes/A2M3_GroundTerrain.bin';
const tiles = Number(process.argv[3] ?? 96);
const V = tiles + 1;            // vertices per side
const N = V * V;                // vertices total
const buf = readFileSync(path);

console.log(`file        : ${path}`);
console.log(`size        : ${buf.length} bytes`);
console.log(`tiles       : ${tiles}  ->  vertices per side = ${V},  total = ${N}`);
console.log(`float block : ${N * 4} bytes   u8 block: ${N} bytes\n`);

// --- 1. Find the Height block: a run of ~N float32 in a sane height range. ---
// Heights per spec: 0.0 = water, 2.0 = default, ramps go a few units. Allow [0,64].
function looksLikeHeightAt(off) {
  if (off + N * 4 > buf.length) return null;
  let ok = 0, sum = 0, min = Infinity, max = -Infinity, zeros = 0;
  for (let i = 0; i < N; i++) {
    const f = buf.readFloatLE(off + i * 4);
    if (!Number.isFinite(f) || f < -1 || f > 256) return null; // hard reject
    if (f >= 0 && f <= 64) ok++;
    if (f === 0) zeros++;
    sum += f; if (f < min) min = f; if (f > max) max = f;
  }
  if (ok < N * 0.98) return null;
  return { off, mean: sum / N, min, max, zeros };
}

let height = null;
for (let off = 0; off + N * 4 <= buf.length; off++) {
  const h = looksLikeHeightAt(off);
  if (h) { height = h; break; }
}

if (height) {
  console.log('== HEIGHT block (float32) found ==');
  console.log(`  offset ${height.off}  end ${height.off + N * 4}`);
  console.log(`  min ${height.min}  max ${height.max}  mean ${height.mean.toFixed(3)}  zeros(water) ${height.zeros}`);
  // Show the raw header bytes that precede the height block.
  const pre = buf.subarray(Math.max(0, height.off - 24), height.off);
  console.log(`  ${24} bytes before height: ${pre.toString('hex').replace(/(..)/g, '$1 ').trim()}\n`);
} else {
  console.log('== HEIGHT block NOT found with current assumptions ==\n');
}

// --- 2. Inspect the leading header bytes as a stream of small records. ---
console.log('== header stream (first 80 bytes, byte-by-byte) ==');
const head = buf.subarray(0, 80);
console.log('  hex : ' + head.toString('hex').replace(/(..)/g, '$1 ').trim());
console.log('  as LE u32 windows:');
for (let i = 0; i + 4 <= 40; i++) {
  const v = buf.readUInt32LE(i);
  if (v > 0 && v < buf.length * 4) console.log(`    @${i}: ${v}`);
}

// --- 3. Tail: the End block should be an arithmetic sequence. ---
console.log('\n== tail (last 48 bytes) ==');
const tail = buf.subarray(buf.length - 48);
console.log('  hex : ' + tail.toString('hex').replace(/(..)/g, '$1 ').trim());

// --- 4. Scan for embedded texture .dds path strings. ---
console.log('\n== embedded ASCII strings (len>=6) ==');
let s = '', start = 0, found = 0;
for (let i = 0; i < buf.length && found < 30; i++) {
  const c = buf[i];
  if (c >= 0x20 && c < 0x7f) { if (!s) start = i; s += String.fromCharCode(c); }
  else { if (s.length >= 6) { console.log(`  @${start}: ${s}`); found++; } s = ''; }
}

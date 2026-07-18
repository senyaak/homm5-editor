// Extract a positions+indices mesh from a HoMM5 geometry binary and write OBJ.
// Positions: stride-12 float32 triples filling the bbox (found empirically).
// Indices: a u16 run whose values are all < vertexCount and length % 6 == 0.
//
// Usage: node tools/extract-mesh.js <binfile> <cx> <cy> <cz> <sx> <sy> <sz> <out.obj>

import { readFileSync, writeFileSync } from 'node:fs';

const [file, cx, cy, cz, sx, sy, sz, out] = process.argv.slice(2);
const b = readFileSync(file);
const C = [Number(cx), Number(cy), Number(cz)];
const S = [Number(sx), Number(sy), Number(sz)];
const mrg = 0.25;
const lo = C.map((c, i) => c - S[i] / 2 - S[i] * mrg);
const hi = C.map((c, i) => c + S[i] / 2 + S[i] * mrg);
const f = (o) => b.readFloatLE(o);
const inBox = (x, y, z) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];
const isZero = (x, y, z) => x === 0 && y === 0 && z === 0;

// --- locate stride-12 position buffer: in-box run whose decoded bbox MATCHES
//     the expected mesh size (this rejects near-zero float arrays) ---
let best = null;
for (let start = 0; start + 12 <= b.length; start++) {
  let o = start, nz = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  while (o + 12 <= b.length) {
    const x = f(o), y = f(o + 4), z = f(o + 8);
    if (isZero(x, y, z)) { o += 12; continue; }
    if (!inBox(x, y, z)) break;
    nz++;
    mn[0] = Math.min(mn[0], x); mx[0] = Math.max(mx[0], x);
    mn[1] = Math.min(mn[1], y); mx[1] = Math.max(mx[1], y);
    mn[2] = Math.min(mn[2], z); mx[2] = Math.max(mx[2], z);
    o += 12;
  }
  if (nz < 16) continue;
  // decoded extent must be a good fraction of expected size on all 3 axes
  const ext = [0, 1, 2].map((k) => (mx[k] - mn[k]) / S[k]);
  if (ext.some((e) => e < 0.5 || e > 1.6)) continue; // reject too-small/too-big
  const matchErr = ext.reduce((a, e) => a + Math.abs(1 - e), 0); // 0 = perfect
  if (!best || matchErr < best.matchErr) best = { start, end: o, nz, ext, matchErr };
}
if (!best) { console.log('no position buffer matching bbox'); process.exit(1); }
console.log(`bbox-match extent per axis = [${best.ext.map((e) => e.toFixed(2)).join(', ')}] (1.0=perfect)`);

// Trim leading all-zero vertices (framing bleed).
let vStart = best.start;
while (vStart + 12 <= best.end && isZero(f(vStart), f(vStart + 4), f(vStart + 8))) vStart += 12;
const vCount = Math.floor((best.end - vStart) / 12);
console.log(`positions: @${vStart}  count=${vCount}  (raw run ${best.start}..${best.end}, ${best.nz} nonzero)`);

const verts = [];
for (let i = 0; i < vCount; i++) {
  const p = vStart + i * 12;
  verts.push([f(p), f(p + 4), f(p + 8)]);
}

// --- locate index buffer: scan for u16 run, all values < vCount, forming triangles ---
// A good index buffer references most vertices and has length divisible by 6 bytes.
function scoreIndexAt(off) {
  let o = off, n = 0; const used = new Set(); let maxIdx = 0;
  while (o + 2 <= b.length) {
    const v = b.readUInt16LE(o);
    if (v >= vCount) break;
    used.add(v); if (v > maxIdx) maxIdx = v;
    n++; o += 2;
  }
  return { off, count: n, end: o, coverage: used.size / vCount, maxIdx };
}
let bestIdx = null;
for (let off = vStart + vCount * 12; off + 2 <= b.length; off++) {
  const r = scoreIndexAt(off);
  // need enough indices to form triangles and reference a good chunk of verts
  if (r.count >= vCount && r.count % 3 === 0 && r.coverage > 0.6) {
    if (!bestIdx || r.count > bestIdx.count) bestIdx = r;
  }
}
// fallback: loosen constraints
if (!bestIdx) {
  for (let off = vStart + vCount * 12; off + 2 <= b.length; off++) {
    const r = scoreIndexAt(off);
    if (r.count >= 48 && r.coverage > 0.5) { if (!bestIdx || r.count > bestIdx.count) bestIdx = r; }
  }
}

const tris = [];
if (bestIdx) {
  const triN = Math.floor(bestIdx.count / 3);
  console.log(`indices: @${bestIdx.off} count=${bestIdx.count} (${triN} tris) coverage=${(bestIdx.coverage * 100).toFixed(1)}% maxIdx=${bestIdx.maxIdx}`);
  for (let i = 0; i < triN; i++) {
    const p = bestIdx.off + i * 6;
    tris.push([b.readUInt16LE(p), b.readUInt16LE(p + 2), b.readUInt16LE(p + 4)]);
  }
} else {
  console.log('indices: NOT found (will emit point cloud)');
}

// --- write OBJ ---
let obj = `# extracted from ${file}\n# ${vCount} verts, ${tris.length} tris\n`;
for (const v of verts) obj += `v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}\n`;
for (const t of tris) obj += `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}\n`;
writeFileSync(out, obj);
console.log(`wrote ${out}: ${vCount} verts, ${tris.length} tris`);

// sanity: decoded bbox vs expected
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const v of verts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
console.log(`decoded bbox: X[${mn[0].toFixed(2)},${mx[0].toFixed(2)}] Y[${mn[1].toFixed(2)},${mx[1].toFixed(2)}] Z[${mn[2].toFixed(2)},${mx[2].toFixed(2)}]`);
console.log(`expected size ~${S}, center ~${C}`);

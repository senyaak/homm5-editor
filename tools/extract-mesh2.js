// Clean mesh extractor v2 — uses the decoded container grammar instead of pure
// heuristics:
//   * arrays are `<marker u8> <u32 sizeB>` with sizeB = 2*byteLen + 1 (as terrain)
//   * a vertex-position array has byteLen % 12 == 0 and decodes to XYZ inside the
//     mesh bounding box; a mesh may have several (one per submesh), numbered
//     consecutively 0..N-1 across the concatenation
//   * the index buffer is a u16 array (introduced right after an `08 <triCount>`
//     field) of triCount*3 entries referencing the concatenated vertices
//
// Usage: node tools/extract-mesh2.js <bin> <cx> <cy> <cz> <sx> <sy> <sz> <out.obj>

import { readFileSync, writeFileSync } from 'node:fs';

const [file, cx, cy, cz, sx, sy, sz, out] = process.argv.slice(2);
const b = readFileSync(file);
const C = [Number(cx), Number(cy), Number(cz)];
const S = [Number(sx), Number(sy), Number(sz)];
const u16 = (o) => b.readUInt16LE(o);
const u32 = (o) => b.readUInt32LE(o);
const f = (o) => b.readFloatLE(o);
const mrg = 0.25;
const lo = C.map((c, i) => c - S[i] / 2 - S[i] * mrg);
const hi = C.map((c, i) => c + S[i] / 2 + S[i] * mrg);
const inBox = (x, y, z) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];

// The file often stores the mesh twice (LOD/copy); work in the first half.
const HALF = Math.floor(b.length / 2);

// --- 1. find the index buffer: `08 <tri>` then `<m> <2*(tri*6)+1>` u16 array ---
let idx = null;
for (let o = 0; o + 6 < HALF; o++) {
  if (b[o] !== 0x08) continue;
  const tri = u32(o + 1);
  if (tri < 8 || tri > 200000) continue;
  // marker+sizeB within next few bytes
  for (let k = 5; k <= 10; k++) {
    const s = u32(o + k);
    if (s === 2 * (tri * 6) + 1) {
      const dataOff = o + k + 4;
      // validate: all u16 in range of some plausible vertex count
      let mx = 0, ok = true;
      for (let i = 0; i < tri * 3; i++) { const v = u16(dataOff + i * 2); if (v > 65000) { ok = false; break; } if (v > mx) mx = v; }
      if (ok) { idx = { tri, dataOff, need: mx + 1 }; break; }
    }
  }
  if (idx) break;
}
if (!idx) { console.log('index buffer not found'); process.exit(1); }
console.log(`indices: @${idx.dataOff}  ${idx.tri} triangles (${idx.tri * 3} u16), max vertex ref = ${idx.need - 1}  -> need ${idx.need} verts`);

// --- 2. collect stride-12 position arrays (bbox-matching) until we have idx.need ---
const verts = [];
const seen = new Set();
for (let o = 0; o + 6 < HALF && verts.length < idx.need; o++) {
  if (b[o] < 1 || b[o] > 15) continue;
  const s = u32(o + 1);
  if (!(s & 1)) continue;
  const byteLen = (s - 1) / 2;
  if (byteLen < 24 || byteLen % 12 !== 0 || o + 5 + byteLen > HALF) continue;
  const count = byteLen / 12, dataOff = o + 5;
  if (seen.has(dataOff)) continue;
  // decode + validate bbox fill
  const vs = []; let good = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const p = dataOff + i * 12, x = f(p), y = f(p + 4), z = f(p + 8);
    vs.push([x, y, z]);
    if (inBox(x, y, z)) { good++; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], [x, y, z][k]); mx[k] = Math.max(mx[k], [x, y, z][k]); } }
  }
  const ext = [0, 1, 2].map((k) => (mx[k] - mn[k]) / S[k]);
  if (good / count > 0.95 && ext.filter((e) => e > 0.3).length >= 2) {
    seen.add(dataOff);
    console.log(`  positions block @${dataOff}: ${count} verts (fill [${ext.map((e) => e.toFixed(2)).join(',')}])`);
    for (const v of vs) verts.push(v);
    o = dataOff + byteLen - 1;
  }
}
console.log(`collected ${verts.length} vertices (need ${idx.need})`);

// --- 3. build triangles ---
const tris = [];
for (let i = 0; i < idx.tri; i++) {
  const p = idx.dataOff + i * 6;
  const a = u16(p), c2 = u16(p + 2), d = u16(p + 4);
  if (a < verts.length && c2 < verts.length && d < verts.length) tris.push([a, c2, d]);
}

let obj = `# ${file}\n# ${verts.length} verts, ${tris.length} tris\n`;
for (const v of verts) obj += `v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}\n`;
for (const t of tris) obj += `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}\n`;
writeFileSync(out, obj);
console.log(`wrote ${out}: ${verts.length} verts, ${tris.length}/${idx.tri} tris valid`);

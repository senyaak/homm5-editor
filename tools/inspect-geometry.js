// Reverse-engineering probe for HoMM5 bin/Geometries/<uid> mesh binaries.
//
// The container's length framing differs from terrain, so instead of relying on
// markers we brute-force the vertex buffer directly: a vertex position buffer is
// a run of (x,y,z) float32 triples at a fixed byte-stride that all fall inside
// the mesh bounding box (Size+Center from the .(Geometry).xdb) and collectively
// fill most of it. We slide over every offset and candidate stride and report
// the best-scoring run.
//
// Usage: node tools/inspect-geometry.js <binfile> <cx> <cy> <cz> <sx> <sy> <sz>

import { readFileSync } from 'node:fs';

const [file, cx, cy, cz, sx, sy, sz] = process.argv.slice(2);
const b = readFileSync(file);
const C = [Number(cx), Number(cy), Number(cz)];
const S = [Number(sx), Number(sy), Number(sz)];
const m = 0.2;
const lo = C.map((c, i) => c - S[i] / 2 - S[i] * m);
const hi = C.map((c, i) => c + S[i] / 2 + S[i] * m);
const f = (o) => b.readFloatLE(o);
const isZero = (x, y, z) => x === 0 && y === 0 && z === 0;
const inBox = (x, y, z) =>
  x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];

console.log(`file ${file}  size ${b.length}`);
console.log(`bbox center ${C} size ${S}  accept X[${lo[0].toFixed(1)},${hi[0].toFixed(1)}] Y[${lo[1].toFixed(1)},${hi[1].toFixed(1)}] Z[${lo[2].toFixed(1)},${hi[2].toFixed(1)}]\n`);

const strides = [12, 16, 20, 24, 28, 32, 36, 40, 44, 48];
let best = null;
for (const stride of strides) {
  for (let start = 0; start + stride * 8 <= b.length; start++) {
    let o = start, nz = 0, zero = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    while (o + 12 <= b.length) {
      const x = f(o), y = f(o + 4), z = f(o + 8);
      if (isZero(x, y, z)) { zero++; o += stride; continue; }
      if (!inBox(x, y, z)) break;
      nz++;
      mn[0] = Math.min(mn[0], x); mx[0] = Math.max(mx[0], x);
      mn[1] = Math.min(mn[1], y); mx[1] = Math.max(mx[1], y);
      mn[2] = Math.min(mn[2], z); mx[2] = Math.max(mx[2], z);
      o += stride;
    }
    if (nz < 16) continue;
    const fill = [0, 1, 2].map((k) => (mx[k] - mn[k]) / S[k]);
    const axesFilled = fill.filter((v) => v > 0.4).length;
    if (axesFilled < 2) continue;
    const score = nz * axesFilled;
    if (!best || score > best.score) best = { start, stride, nz, zero, fill, axesFilled, score, end: o };
  }
}

if (!best) { console.log('No vertex buffer found.'); process.exit(0); }
console.log(`== BEST vertex run ==`);
console.log(`  start=${best.start} stride=${best.stride}B  nonzero-verts=${best.nz} (zeros skipped ${best.zero})`);
console.log(`  bbox fill per axis = [${best.fill.map((v) => v.toFixed(2)).join(', ')}]  (1.0 = fills the box)`);
console.log(`  run spans bytes ${best.start}..${best.end}`);
console.log('\n  first 8 vertices (x,y,z | trailing floats in stride):');
for (let i = 0, shown = 0; shown < 8 && best.start + i * best.stride + 12 <= b.length; i++) {
  const p = best.start + i * best.stride;
  const x = f(p), y = f(p + 4), z = f(p + 8);
  const extra = [];
  for (let k = 3; k * 4 < best.stride; k++) extra.push(f(p + k * 4).toFixed(2));
  console.log(`    (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})  | ${extra.join(', ')}`);
  shown++;
}
console.log('\n  16 bytes before run:', b.subarray(Math.max(0, best.start - 16), best.start).toString('hex').replace(/(..)/g, '$1 ').trim());
console.log('  16 bytes after run :', b.subarray(best.end, best.end + 16).toString('hex').replace(/(..)/g, '$1 ').trim());

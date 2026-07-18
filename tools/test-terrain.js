// Validate the GroundTerrain.bin parser on real sample maps:
//  1. locate the layout and print it
//  2. read heights and sanity-check the range
//  3. edit round-trip: raise every vertex by +1.0, write, re-parse, and confirm
//     the values read back AND that only the height byte-range changed.
import { readFileSync } from 'node:fs';
import { parseTerrain, readHeights, writeHeights } from '../src/terrain.js';

const samples = process.argv.slice(2);
if (samples.length === 0) samples.push('samples/A2M3_GroundTerrain.bin', 'samples/A2M6_GroundTerrain.bin');

let failures = 0;
for (const path of samples) {
  console.log(`\n============================================================`);
  console.log(`FILE ${path}`);
  const b = readFileSync(path);
  const t = parseTerrain(b);
  console.log(`  V=${t.V}  tiles=${t.tiles}  N=${t.N}  size=${b.length}`);
  console.log(`  located ${t.arrays.length} framing-anchored arrays:`);
  const byKind = { f32: 0, u8N: 0, other: 0 };
  for (const a of t.arrays) {
    if (a.elem === 'f32') byKind.f32++;
    else if (a.len === t.N) byKind.u8N++;
    else byKind.other++;
  }
  console.log(`    float32 planes: ${byKind.f32}   u8 N-planes: ${byKind.u8N}   other: ${byKind.other}`);

  // --- read heights ---
  const h = readHeights(t);
  let min = Infinity, max = -Infinity, sum = 0, water = 0;
  for (const v of h) { if (v < min) min = v; if (v > max) max = v; sum += v; if (v === 0) water++; }
  console.log(`  height @${t.height.dataOff}: min=${min.toFixed(3)} max=${max.toFixed(3)} mean=${(sum / h.length).toFixed(3)} water(0.0)=${water}`);
  const okRange = min >= 0 && max < 256;
  console.log(`  height range sane: ${okRange ? 'OK' : 'FAIL'}`);
  if (!okRange) failures++;

  // --- edit round-trip: +1.0 to every vertex ---
  const raised = Float32Array.from(h, (v) => v + 1.0);
  const out = writeHeights(t, raised);
  const t2 = parseTerrain(out);
  const h2 = readHeights(t2);
  let readbackOk = h2.length === h.length;
  for (let i = 0; i < h.length && readbackOk; i++) {
    if (Math.abs(h2[i] - (h[i] + 1.0)) > 1e-4) readbackOk = false;
  }
  console.log(`  edit readback (+1.0 everywhere): ${readbackOk ? 'OK' : 'FAIL'}`);
  if (!readbackOk) failures++;

  // --- confirm ONLY the height byte-range changed ---
  let diffs = 0, firstDiff = -1, lastDiff = -1;
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== out[i]) { diffs++; if (firstDiff < 0) firstDiff = i; lastDiff = i; }
  }
  const hStart = t.height.dataOff, hEnd = t.height.dataOff + t.height.count * 4;
  const localized = out.length === b.length && firstDiff >= hStart && lastDiff < hEnd;
  console.log(`  changed bytes: ${diffs} (range ${firstDiff}..${lastDiff}); height range ${hStart}..${hEnd}`);
  console.log(`  edit localized to height plane only: ${localized ? 'OK' : 'FAIL'}`);
  if (!localized) failures++;
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED ✅' : `${failures} CHECK(S) FAILED ❌`}`);
process.exit(failures === 0 ? 0 : 1);

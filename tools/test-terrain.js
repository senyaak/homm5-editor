// Validate the GroundTerrain.bin parser on real sample maps:
//  1. locate the layout and print it
//  2. read heights and sanity-check the range
//  3. edit round-trip: raise every vertex by +1.0, write, re-parse, and confirm
//     the values read back AND that only the height byte-range changed.
import { readFileSync } from 'node:fs';
import { parseTerrain, readHeights, writeHeights, readTextureLayers, tilePathAt } from '../src/terrain.ts';

const samples = process.argv.slice(2);
if (samples.length === 0) samples.push('_tmp/probes/A2M3_GroundTerrain.bin', '_tmp/probes/A2M6_GroundTerrain.bin');

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

// --- tile references: any folder, and framing bytes that read as text ---
//
// A tile ref is '<path>.xdb#xpointer(/AdvMapTile)', and the path can be anywhere
// in the data root: the editor's own tiles are under /MapObjects/_(AdvMapTile)/,
// a random map's under /RMG/Tiles/, a mod's wherever it likes. Matching on the
// folder is what shipped, and every layer of an RMG map came back without a
// path — no tile paths, no splat, flat untextured ground.
//
// The second trap is the framing: a string is preceded by two length bytes, and
// those are ordinary bytes that can read as letters ('j' is 2*53). Walking back
// over printable characters therefore overshoots the path's leading slash.
const framed = (path) => Buffer.concat([
  // 03 <2*(len+2)> 03 <2*len> <string>, as the container frames it.
  Buffer.from([0x03, (2 * (path.length + 2)) & 0xff, 0x03, (2 * path.length) & 0xff]),
  Buffer.from(path + '#xpointer(/AdvMapTile)', 'latin1'),
]);
const refCases = [
  ['/MapObjects/_(AdvMapTile)/Grass/Grass.xdb', "the editor's own tiles"],
  ['/RMG/Tiles/Haven/Dark_Grass.xdb', 'a random map’s tiles (length byte reads as "j")'],
  ['/RMG/Tiles/Haven/Orc_Dirt_Sec_Road.(AdvMapTile).xdb', 'the .(AdvMapTile).xdb spelling'],
  ['/Mods/Anything/At/All.xdb', 'a folder nobody has seen before'],
];
console.log('\n============================================================');
for (const [path, what] of refCases) {
  const got = tilePathAt(framed(path), 0, 400);
  const ok = got === path;
  console.log(`  tile ref — ${what}: ${ok ? 'OK' : `FAIL (got ${got})`}`);
  if (!ok) failures++;
}
// A mask with no tile after it is a real thing; it must not borrow a neighbour's.
const none = tilePathAt(Buffer.from('\x00\x01/not/a/tile/ref.xdb\x00', 'latin1'), 0, 400);
console.log(`  tile ref — no xpointer means no path: ${none === null ? 'OK' : `FAIL (got ${none})`}`);
if (none !== null) failures++;

// And every layer of every sample resolves to an absolute path or to nothing.
for (const path of samples) {
  const ls = readTextureLayers(parseTerrain(readFileSync(path)));
  const bad = ls.filter((l) => l.path !== null && !l.path.startsWith('/'));
  console.log(`  ${path}: ${ls.length} layers, ${ls.filter((l) => l.path).length} with a tile, ${bad.length} malformed`);
  if (bad.length) failures++;
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED ✅' : `${failures} CHECK(S) FAILED ❌`}`);
process.exit(failures === 0 ? 0 : 1);

// Validates adding a texture layer to GroundTerrain.bin.
//
// This is the only terrain edit that moves bytes, so the standing question is
// not "did the new layer appear" but "did anything else shift". A missed
// ancestor length leaves a file that still parses while a later plane is
// silently truncated, so every pre-existing plane is compared byte for byte
// against the original: masks, heights, flags, and the river plane.
//
// Needs sample terrain, which is game content and not in the repo.

import { existsSync, readFileSync } from 'node:fs';
import {
  parseTerrain, readHeights, readGroundFlags, readTextureLayers, readMask, readWaterPlane,
} from '../src/terrain.ts';
import { addTextureLayer } from '../src/terrain-layer.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const eq = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const NEW_TILE = '/MapObjects/_(AdvMapTile)/Sand/Sand.xdb';

function testFile(path: string): void {
  console.log(`\nFILE ${path}`);
  const orig = readFileSync(path);
  const t0 = parseTerrain(orig);
  const before = readTextureLayers(t0);
  console.log(`  V=${t0.V} N=${t0.N} layers=${before.length} size=${orig.length}`);

  const out = addTextureLayer(orig, NEW_TILE);
  const t1 = parseTerrain(out);
  const after = readTextureLayers(t1);

  check('the terrain still parses at the same dimensions', t1.V === t0.V && t1.N === t0.N,
    `${t1.V}/${t1.N}`);
  check('one more layer than before', after.length === before.length + 1,
    `${before.length} -> ${after.length}`);
  check('the new layer carries the tile path', after.some((l) => l.path === NEW_TILE),
    after[after.length - 1]?.path ?? 'none');

  const fresh = after.find((l) => l.path === NEW_TILE);
  if (fresh) {
    const m = readMask(t1, fresh);
    check('the new mask is the right size', m.length === t0.N, `${m.length}`);
    check('the new mask starts empty', m.every((v) => v === 0));
  }

  // --- nothing else moved ---
  check('every original layer kept its path',
    eq(before.map((l) => (l.path ?? '').length), after.filter((l) => l.path !== NEW_TILE).map((l) => (l.path ?? '').length)));

  let masksOk = true;
  for (const l of before) {
    const same = after.find((x) => x.path === l.path);
    if (!same || !eq(readMask(t1, same), readMask(t0, l))) { masksOk = false; break; }
  }
  check('every original mask is byte-identical', masksOk);
  check('heights are byte-identical', eq(readHeights(t1), readHeights(t0)));

  const f0 = readGroundFlags(t0), f1 = readGroundFlags(t1);
  check('ground flags are byte-identical', !!f0 && !!f1 && eq(f0, f1));

  const w0 = readWaterPlane(t0), w1 = readWaterPlane(t1);
  if (w0) check('the river plane is byte-identical', !!w1 && eq(w0.data, w1.data));
  else console.log('  --    no river plane (skipped)');

  // --- the splice is exactly one record long ---
  const grew = out.length - orig.length;
  // mask: 6 + 6 + 5 + N, wrapped in a 5-byte block header; path: two 2-byte
  // headers around the string; the layer record adds its own 5-byte header.
  const pathLen = (NEW_TILE + '#xpointer(/AdvMapTile)').length;
  const expected = 5 + (5 + 6 + 6 + 5 + t0.N) + (2 + 2 + pathLen);
  check('the file grew by exactly one layer record', grew === expected, `${grew} vs ${expected}`);

  // --- twice in a row ---
  // Pick a second tile the map demonstrably lacks: the sample maps differ in
  // which tiles they carry, and a hardcoded one collides with A2M6's Snow.
  const taken = new Set(after.map((l) => l.path));
  const second = ['/MapObjects/_(AdvMapTile)/Lava/Lava.xdb', '/MapObjects/_(AdvMapTile)/Snow/Snow.xdb',
    '/MapObjects/_(AdvMapTile)/Dirt/Ground.xdb'].find((p) => !taken.has(p));
  if (!second) { check('a spare tile to add', false); return; }
  const twice = addTextureLayer(out, second);
  const t2 = parseTerrain(twice);
  const after2 = readTextureLayers(t2);
  check('a second layer can be added on top', after2.length === before.length + 2,
    `${after2.length}`);
  check('heights survive the second insert', eq(readHeights(t2), readHeights(t0)));
  check('the first added layer survives the second insert',
    after2.some((l) => l.path === NEW_TILE));

  // --- refusals ---
  let threw = false;
  try { addTextureLayer(out, NEW_TILE); } catch { threw = true; }
  check('adding a layer that already exists is rejected', threw);
}

const args = process.argv.slice(2);
const samples = args.length
  ? args
  : ['samples/A2M3_GroundTerrain.bin', 'samples/A2M6_GroundTerrain.bin'].filter((p) => existsSync(p));

if (!samples.length) {
  console.log('no sample terrain found — pass GroundTerrain.bin paths as arguments');
  process.exit(0);
}
for (const p of samples) testFile(p);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

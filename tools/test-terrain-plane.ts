// Validates giving a map its passability plane.
//
// Like adding a texture layer, this edit moves bytes, so the standing question
// is not "did the plane appear" but "did anything else shift": a missed ancestor
// length leaves a file that still parses while a later plane is silently
// truncated. Every pre-existing plane is therefore compared byte for byte.
//
// The blanks it runs on are generated, so this needs no game content. Given
// sample terrain as arguments it also checks the refusal on a map that already
// carries the plane.

import { existsSync, readFileSync } from 'node:fs';
import {
  parseTerrain, readHeights, readGroundFlags, readTextureLayers, readMask, readWaterPlane,
  readPassability, writeTerrain, BLOCKED, PASSABLE,
} from '../src/terrain.ts';
import { buildBlankTerrain } from '../src/terrain-blank.ts';
import { addPassabilityPlane } from '../src/terrain-plane.ts';
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

/** A blank of `tiles` tiles per side, plus whatever the caller layers on top. */
function testBlank(tiles: number): void {
  console.log(`\nBLANK ${tiles}x${tiles}`);
  const orig = buildBlankTerrain(tiles);
  const t0 = parseTerrain(orig);
  check('a blank has no passability plane', !readPassability(t0));

  const out = addPassabilityPlane(orig);
  const t1 = parseTerrain(out);
  const p = readPassability(t1);

  check('the terrain still parses at the same dimensions', t1.V === t0.V && t1.N === t0.N,
    `${t1.V}/${t1.N}`);
  check('the plane is there, vertex-sized', !!p && p.length === t0.N, `${p?.length}`);
  check('it starts all walkable', !!p && p.every((v) => v === PASSABLE));
  check('one more array than before', t1.arrays.length === t0.arrays.length + 1,
    `${t0.arrays.length} -> ${t1.arrays.length}`);

  // Nothing else moved.
  check('heights are byte-identical', eq(readHeights(t1), readHeights(t0)));
  const f0 = readGroundFlags(t0), f1 = readGroundFlags(t1);
  check('ground flags are byte-identical', !!f0 && !!f1 && eq(f0, f1));
  const l0 = readTextureLayers(t0), l1 = readTextureLayers(t1);
  check('the texture layers are unchanged',
    l0.length === l1.length && l0.every((l, i) => l.path === l1[i]!.path
      && eq(readMask(t0, l), readMask(t1, l1[i]!))));
  const w0 = readWaterPlane(t0), w1 = readWaterPlane(t1);
  check('the river plane is byte-identical', !!w0 && !!w1 && eq(w0.data, w1.data));

  // The splice is exactly one plane block: header, two dimension scalars, the
  // array's own header and its data — minus the 12-byte empty slot it replaced.
  const grew = out.length - orig.length;
  const expected = 5 + 6 + 6 + 5 + t0.N - (1 + 1 + 12);
  check('the file grew by exactly one plane block', grew === expected, `${grew} vs ${expected}`);

  // The plane is writable, which is the whole point of adding it.
  const mask = new Uint8Array(t1.N).fill(PASSABLE);
  mask[0] = BLOCKED; mask[t1.N - 1] = BLOCKED;
  const written = parseTerrain(writeTerrain(t1, { passable: mask }));
  const back = readPassability(written);
  check('a mask written into it reads back', !!back && eq(back, mask));
  check('writing the mask disturbs nothing else',
    eq(readHeights(written), readHeights(t0)));

  // Adding it twice is a bug in the caller, not something to do quietly.
  let threw = false;
  try { addPassabilityPlane(out); } catch { threw = true; }
  check('adding the plane twice is rejected', threw);

  // Order-independence with the other structural edit: a map gets its layers and
  // its mask in whichever order the user works in.
  const TILE = '/MapObjects/_(AdvMapTile)/Sand/Sand.xdb';
  const both = parseTerrain(addTextureLayer(out, TILE));
  const bothP = readPassability(both);
  check('a texture layer added afterwards leaves the plane intact',
    !!bothP && bothP.length === t0.N && bothP.every((v) => v === PASSABLE));
  const other = parseTerrain(addPassabilityPlane(addTextureLayer(orig, TILE)));
  const otherP = readPassability(other);
  check('the plane can be added after a layer instead',
    !!otherP && otherP.length === t0.N,
    `${readTextureLayers(other).length} layers`);
}

/** A shipped map: it already has the plane, so the only claim is the refusal. */
function testSample(path: string): void {
  console.log(`\nFILE ${path}`);
  const t = parseTerrain(readFileSync(path));
  const p = readPassability(t);
  if (!p) { console.log('  --    no passability plane in this sample (skipped)'); return; }
  let threw = false;
  try { addPassabilityPlane(readFileSync(path)); } catch { threw = true; }
  check('a map that has the plane is left alone', threw);
}

for (const tiles of [72, 96, 136]) testBlank(tiles);

const args = process.argv.slice(2);
const samples = args.length
  ? args
  : ['_tmp/probes/A2M3_GroundTerrain.bin', '_tmp/probes/A2M6_GroundTerrain.bin'].filter((p) => existsSync(p));
for (const p of samples) testSample(p);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

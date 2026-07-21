// Validates buildBlankTerrain() — the from-scratch GroundTerrain.bin generator.
//
// Two layers of check:
//   1. Self-contained (always runs): every offered size builds to the expected
//      byte length, parses back through the terrain reader, has the right flat
//      values (Grass 255, height 2.0, flags 16, no water), and its framed-array
//      stream re-serializes byte-for-byte — i.e. the container is well-formed.
//   2. Against the real thing (optional): if pristine blank GroundTerrain.bin
//      files from the original editor are available, compare byte-for-byte. Pass
//      a directory as argv[2] (searched recursively for GroundTerrain.bin under
//      per-size subfolders) or set HOMM5_BLANKS. Skipped when absent — the blanks
//      are game-derived content and never live in the repo.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildBlankTerrain, MAP_SIZES } from '../src/terrain-blank.ts';
import {
  parseTerrain, readHeights, readGroundFlags, readTextureLayers, readWaterPlane,
} from '../src/terrain.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const only = <T,>(a: ArrayLike<T>): T[] => [...new Set(Array.from(a))];

// The generic framed-array segmenter (see docs): the whole file is a stream of
// `08 d 02 08 d 03 sizeB` + data blocks with verbatim framing between them.
// Re-concatenating the slices must reproduce the input — a total-coverage proof.
function reserializes(b: Buffer): boolean {
  let cur = 0, i = 0;
  const parts: Buffer[] = [];
  const anchorAt = (p: number): number | null => {
    if (b[p] !== 0x08) return null;
    const d = b.readUInt32LE(p + 1);
    if (b[p + 5] !== 0x02 || b[p + 6] !== 0x08 || b.readUInt32LE(p + 7) !== d || b[p + 11] !== 0x03) return null;
    const len = (b.readUInt32LE(p + 12) - 1) / 2;
    if (!Number.isInteger(len) || len <= 0) return null;
    return p + 16 + len;
  };
  while (i < b.length) {
    const end = anchorAt(i);
    if (end != null) { parts.push(b.subarray(cur, end)); cur = end; i = end; }
    else i++;
  }
  parts.push(b.subarray(cur));
  return Buffer.concat(parts).equals(b);
}

function testSelfContained(): void {
  for (const tiles of MAP_SIZES) {
    console.log(`\nSIZE ${tiles}x${tiles}`);
    const V = tiles + 1, N = V * V, W = 2 * V - 1;
    const buf = buildBlankTerrain(tiles);
    check('byte length is 272 + 7N + W²', buf.length === 272 + 7 * N + W * W, `${buf.length}`);
    check('array stream re-serializes (well-formed container)', reserializes(buf));

    const t = parseTerrain(buf);
    check('vertex dimension is tiles+1', t.V === V, `V=${t.V}`);
    const layers = readTextureLayers(t);
    check('one Grass layer at full weight', layers.length === 1 && !!layers[0]?.path?.includes('/Grass/Grass.xdb'),
      layers.map((l) => l.path).join(','));

    const flat = only(readHeights(t));
    check('height is flat at 2.0', flat.length === 1 && flat[0] === 2, flat.join(','));
    const flags = readGroundFlags(t);
    check('ground flags are all tier-1 (16)', !!flags && only(flags).every((v) => v === 16));
    const water = readWaterPlane(t);
    check('no water', !water || [...water.data].every((v) => v === 0));
  }
}

// Recursively find a GroundTerrain.bin whose parent path hints at `tiles`, else
// any under `dir`. Blanks are typically laid out one per size subfolder.
function findBlanks(dir: string): Map<number, string> {
  const out = new Map<number, string>();
  const gts: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === 'GroundTerrain.bin') gts.push(p);
    }
  };
  walk(dir);
  // Match each GroundTerrain.bin to a size by its byte length (unique per size).
  const byLen = new Map(MAP_SIZES.map((t) => [buildBlankTerrain(t).length, t]));
  for (const p of gts) {
    const size = byLen.get(readFileSync(p).length);
    if (size !== undefined && !out.has(size)) out.set(size, p);
  }
  return out;
}

function testAgainstOracles(dir: string): void {
  console.log(`\nORACLES ${dir}`);
  const blanks = findBlanks(dir);
  if (!blanks.size) { console.log('  --    no blank GroundTerrain.bin found (skipped)'); return; }
  for (const [tiles, path] of [...blanks].sort((a, b) => a[0] - b[0])) {
    const ok = buildBlankTerrain(tiles).equals(readFileSync(path));
    check(`${tiles}x${tiles} is byte-identical to the editor's blank`, ok, path);
  }
}

testSelfContained();

const dir = process.argv[2] || process.env.HOMM5_BLANKS;
if (dir && existsSync(dir)) testAgainstOracles(dir);
else console.log('\n(no blank oracles given — pass a dir or set HOMM5_BLANKS for the byte-exact check)');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

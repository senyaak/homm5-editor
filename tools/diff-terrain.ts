// Compare two GroundTerrain.bin — the reference against a reconstruction.
//
//   node tools/diff-terrain.ts <original> <ours> [--full] [--limit N]
//
// Either argument may be a GroundTerrain.bin or the folder holding one, so a
// fixture folder and a workspace folder can be passed directly.
//
// The target for reconstruction is 1:1 (docs/E2E_RECONSTRUCTION.md): anything
// that does not match is a tool we have not built yet, not an acceptable
// difference. So this reports every plane separately and exits non-zero on any
// mismatch — it is the acceptance gate for the terrain stage, and the progress
// meter while getting there. A byte-identical file is reported as such and needs
// no further reading.
//
// The planes are compared as data, not as bytes, because "the height plane is
// off by 0.5 on 12 vertices" and "the file differs somewhere" are different
// amounts of help.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTerrain, readHeights, readGroundFlags, readPassability, readTextureLayers,
  readMask, readWaterPlane, type Terrain,
} from '../src/terrain.ts';

const args = process.argv.slice(2);
const flag = (n: string): boolean => args.includes(n);
const value = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));

if (positional.length < 2) {
  console.error('usage: node tools/diff-terrain.ts <original> <ours> [--full] [--limit N]');
  process.exit(2);
}

/** Accept either the file or the folder that holds it. */
function resolveBin(p: string): string {
  if (existsSync(p) && statSync(p).isDirectory()) return join(p, 'GroundTerrain.bin');
  return p;
}

const limit = Number(value('--limit') ?? 8);
const showFull = flag('--full');

const paths = positional.slice(0, 2).map(resolveBin);
for (const p of paths) {
  if (!existsSync(p)) { console.error(`no such file: ${p}`); process.exit(2); }
}
const [ref, ours] = paths.map((p) => readFileSync(p)) as [Buffer, Buffer];

console.log(`ref  ${paths[0]}  (${ref.length} bytes)`);
console.log(`ours ${paths[1]}  (${ours.length} bytes)\n`);

if (ref.equals(ours)) {
  console.log('byte-identical — nothing to report');
  process.exit(0);
}

const A = parseTerrain(ref), B = parseTerrain(ours);

let problems = 0;
function fail(what: string, detail: string): void {
  problems++;
  console.log(`  DIFF  ${what}${detail ? ' — ' + detail : ''}`);
}
function ok(what: string, detail = ''): void {
  console.log(`  ok    ${what}${detail ? ' — ' + detail : ''}`);
}

// --- dimensions ------------------------------------------------------------

console.log('DIMENSIONS');
if (A.V !== B.V) {
  fail('grid size', `${A.tiles}x${A.tiles} tiles vs ${B.tiles}x${B.tiles}`);
  console.log('\nsizes differ — the planes are not comparable, stopping here');
  process.exit(1);
}
ok('grid size', `${A.tiles}x${A.tiles} tiles (${A.V}² vertices)`);

const V = A.V, N = A.N;

// --- a shared way of reporting one plane -----------------------------------

/**
 * Compare two per-vertex planes and report where they disagree.
 *
 * `where` matters more than `how many`: a reconstruction that is wrong in one
 * corner is a different problem from one that is wrong everywhere, and the
 * bounding box plus a few sample vertices says which without dumping 9216 rows.
 */
/**
 * How far apart two values may be and still count as equal.
 *
 * Zero for the u8 planes — a weight is a weight. Heights are float32 written
 * from a double the brush computed, so the last bits are not reproducible and
 * are not worth reproducing: the original stores 1.7999998 where a stroke lands
 * on the nearest float32 to 1.8, a difference of one ULP and about a
 * ten-millionth of a tile's height. The threshold is the same 1e-4 the
 * reconstruction specs hold themselves to.
 */
const HEIGHT_EPS = 1e-4;

function comparePlane(
  name: string,
  a: ArrayLike<number> | null,
  b: ArrayLike<number> | null,
  side: number,
  fmt: (v: number) => string = String,
  eps = 0,
): void {
  if (!a && !b) { ok(`${name}`, 'absent in both'); return; }
  if (!a || !b) { fail(name, a ? 'missing in ours' : 'present in ours, absent in the original'); return; }
  if (a.length !== b.length) { fail(name, `length ${a.length} vs ${b.length}`); return; }

  const bad: number[] = [];
  let maxDelta = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d <= eps) continue;
    bad.push(i);
    if (d > maxDelta) maxDelta = d;
  }
  if (!bad.length) { ok(name, `${a.length} values`); return; }

  let x0 = side, y0 = side, x1 = -1, y1 = -1;
  for (const i of bad) {
    const x = i % side, y = (i / side) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pct = ((100 * bad.length) / a.length).toFixed(1);
  fail(name, `${bad.length}/${a.length} values (${pct}%), max delta ${fmt(maxDelta)}, box x ${x0}..${x1}, y ${y0}..${y1}`);

  for (const i of bad.slice(0, limit)) {
    console.log(`          (${i % side},${(i / side) | 0}) ref ${fmt(a[i]!)} vs ours ${fmt(b[i]!)}`);
  }
  if (bad.length > limit) console.log(`          … ${bad.length - limit} more`);
  if (showFull) console.log(heatmap(bad, side));
}

/**
 * A coarse picture of where a plane disagrees — the grid downsampled to ~64
 * columns, each cell showing how dense the mismatches are under it. Reading
 * "the whole east half is wrong" off a shape is faster than off coordinates.
 */
function heatmap(bad: number[], side: number): string {
  const cols = Math.min(64, side), rows = Math.max(1, Math.round(cols / 2));
  const step = side / cols, rstep = side / rows;
  const cell = (x: number, y: number): number => Math.min(rows - 1, Math.floor(y / rstep)) * cols + Math.min(cols - 1, Math.floor(x / step));

  // Cells cover an uneven number of vertices when the side does not divide by
  // the column count (97 over 64), so density has to be per cell's own capacity.
  // Dividing by the average instead paints a stripe pattern that looks like a
  // finding and is purely an artefact of the downsampling.
  const hit = new Array<number>(rows * cols).fill(0);
  const cap = new Array<number>(rows * cols).fill(0);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) cap[cell(x, y)]!++;
  for (const i of bad) hit[cell(i % side, (i / side) | 0)]!++;

  const RAMP = ' .:-=+*#%@';
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '          |';
    for (let c = 0; c < cols; c++) {
      const n = hit[r * cols + c]!, total = cap[r * cols + c]! || 1;
      line += n === 0 ? ' ' : RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.ceil((n / total) * (RAMP.length - 1))))];
    }
    out.push(line + '|');
  }
  return out.join('\n');
}

// --- texture layers --------------------------------------------------------
//
// The layer SET is what the palette can express; the masks are what the brush
// painted. Reporting them apart separates "we cannot paint with this tile at
// all" from "we painted it in the wrong place".

console.log('\nTEXTURE LAYERS');
const la = readTextureLayers(A), lb = readTextureLayers(B);

// Maps disagree on the case of the tile path — C1M1 stores it lowercased, the
// editor's own blank stores it as the asset is named — and the engine takes
// both. So layers are matched case-insensitively and the spelling is reported
// on its own line: it is a difference to reproduce, not a missing tile.
const key = (l: { path: string | null }): string => (l.path ?? '(unnamed)').toLowerCase();
const pa = la.map(key), pb = lb.map(key);
const missing = la.filter((l) => !pb.includes(key(l))).map((l) => l.path ?? '(unnamed)');
const extra = lb.filter((l) => !pa.includes(key(l))).map((l) => l.path ?? '(unnamed)');

if (missing.length) fail('layers missing in ours', missing.join(', '));
if (extra.length) fail('layers ours has and the original does not', extra.join(', '));
if (!missing.length && !extra.length) {
  ok('layer set', `${pa.length} tiles`);
  if (pa.join('\n') !== pb.join('\n')) fail('layer ORDER', `${pa.join(', ')}\n            vs ${pb.join(', ')}`);
}

const cased = la.filter((l) => lb.some((m) => key(m) === key(l) && m.path !== l.path));
if (cased.length) fail('tile path SPELLING', `${cased.length} layer(s), e.g. ${cased[0]!.path} vs ${lb.find((m) => key(m) === key(cased[0]!))!.path}`);

for (const layer of la) {
  const mate = lb.find((l) => key(l) === key(layer));
  if (!mate) continue;
  comparePlane(`mask ${layer.path ?? '(unnamed)'}`, readMask(A, layer), readMask(B, mate), V);
}

// --- heights ---------------------------------------------------------------

console.log('\nHEIGHTS');
const f2 = (v: number): string => v.toFixed(3);
comparePlane('height', A.height ? readHeights(A) : null, B.height ? readHeights(B) : null, V, f2,
  HEIGHT_EPS);

// --- movement planes -------------------------------------------------------

console.log('\nGROUND FLAGS / PASSABILITY');
comparePlane('ground flags', readGroundFlags(A), readGroundFlags(B), V);
comparePlane('passability', readPassability(A), readPassability(B), V);

// --- rivers ----------------------------------------------------------------

console.log('\nRIVERS (half-tile plane)');
const wa = readWaterPlane(A), wb = readWaterPlane(B);
comparePlane('river/water', wa?.data ?? null, wb?.data ?? null, wa?.W ?? 2 * V - 1);

// --- anything the plane-by-plane pass does not cover -----------------------
//
// The file is more than its planes (framing, tile paths, trailing records). If
// every plane matches and the bytes still differ, something structural does —
// worth saying out loud rather than reporting success.

console.log('\nCONTAINER');
if (A.arrays.length !== B.arrays.length) fail('array count', `${A.arrays.length} vs ${B.arrays.length}`);
else ok('array count', `${A.arrays.length}`);
if (ref.length !== ours.length) fail('file length', `${ref.length} vs ${ours.length} bytes`);

if (!problems) {
  console.log('\nevery plane matches, but the files differ in bytes — framing, tile paths or a trailing record');
  process.exit(1);
}

console.log(`\n${problems} difference(s)`);
process.exit(1);

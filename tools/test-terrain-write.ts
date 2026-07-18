// Validates writeTerrain() against real GroundTerrain.bin files.
//
// The parser is the oracle: after a write, re-parse the output and check that
// every plane reads back what we asked for, that planes we did NOT edit are
// untouched, and that the edit stayed inside the byte range it belongs to. That
// last one matters most — a mask written one byte too long still parses fine and
// only misbehaves in game.
//
// Needs sample terrain, which is game content and therefore not in the repo.
// Pass paths, or drop files in samples/ and run with no arguments.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  parseTerrain, readHeights, readGroundFlags, readTextureLayers, readMask, readWaterPlane,
  writeTerrain, groundFlagsPlane, waterPlane,
} from '../src/terrain.ts';
import type { Terrain } from '../src/terrain.ts';
import { TerrainDoc } from '../src/terrain-edit.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** Byte offsets where two equal-length buffers differ. */
function diffRange(a: Buffer, b: Buffer): { count: number; first: number; last: number } {
  let count = 0, first = -1, last = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    count++;
    if (first < 0) first = i;
    last = i;
  }
  return { count, first, last };
}

/** Assert the only bytes that moved lie within [off, off+len). */
function localized(orig: Buffer, out: Buffer, off: number, len: number): boolean {
  const d = diffRange(orig, out);
  return d.count > 0 && d.first >= off && d.last < off + len;
}

const eq = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

function testFile(path: string): void {
  console.log(`\nFILE ${path}`);
  const orig = readFileSync(path);
  const t: Terrain = parseTerrain(orig);
  console.log(`  V=${t.V} N=${t.N} size=${orig.length}`);

  // --- ground flags ---
  const flags = readGroundFlags(t);
  const fp = groundFlagsPlane(t);
  if (flags && fp) {
    // Invert the low bits so every byte changes but the values stay in range.
    const edited = Uint8Array.from(flags, (v) => v ^ 0x01);
    const out = writeTerrain(t, { flags: edited });
    const back = readGroundFlags(parseTerrain(out));
    check('flags read back', !!back && eq(back, edited));
    check('flags edit stays in the flag plane', localized(orig, out, fp.dataOff, fp.len));
    // Nothing else moved: heights survive a flags-only write.
    check('flags write leaves heights alone', eq(readHeights(parseTerrain(out)), readHeights(t)));
  } else {
    check('flag plane located', false);
  }

  // --- texture layer masks ---
  const layers = readTextureLayers(t);
  check('has texture layers', layers.length > 0, `${layers.length} layers`);
  const layer = layers[0];
  if (layer) {
    const before = Uint8Array.from(readMask(t, layer));
    const edited = Uint8Array.from(before, (v) => 255 - v);
    const out = writeTerrain(t, { masks: [{ layer, data: edited }] });
    const t2 = parseTerrain(out);
    const back = readMask(t2, readTextureLayers(t2)[0]!);
    check('mask reads back', eq(back, edited));
    check('mask edit stays in its own plane', localized(orig, out, layer.maskOff, layer.count));
    // Layer paths live right after the mask data; a stray write would eat them.
    check('layer paths survive', eq(
      readTextureLayers(t2).map((l) => (l.path ?? '').length),
      layers.map((l) => (l.path ?? '').length),
    ));
  }

  // --- river plane ---
  const river = readWaterPlane(t);
  const rp = waterPlane(t);
  if (river && rp) {
    const edited = Uint8Array.from(river.data, (v) => (v ? 0 : 255));
    const out = writeTerrain(t, { water: edited });
    const back = readWaterPlane(parseTerrain(out));
    check('river plane reads back', !!back && eq(back.data, edited));
    check('river edit stays in the river plane', localized(orig, out, rp.dataOff, rp.len));
  } else {
    console.log('  --    no river plane in this map (skipped)');
  }

  // --- several planes at once ---
  if (flags && layer) {
    const h = readHeights(t);
    const raised = Float32Array.from(h, (v) => v + 1);
    const newFlags = Uint8Array.from(flags, (v) => v ^ 0x01);
    const newMask = Uint8Array.from(readMask(t, layer), (v) => 255 - v);
    const out = writeTerrain(t, { heights: raised, flags: newFlags, masks: [{ layer, data: newMask }] });
    const t2 = parseTerrain(out);
    const okAll = eq(readHeights(t2), raised)
      && eq(readGroundFlags(t2)!, newFlags)
      && eq(readMask(t2, readTextureLayers(t2)[0]!), newMask);
    check('three planes in one pass', okAll);
    check('output keeps the original size', out.length === orig.length);
  }

  // --- length validation ---
  let threw = false;
  try { writeTerrain(t, { heights: new Float32Array(t.N - 1) }); } catch { threw = true; }
  check('a short height plane is rejected', threw);
  threw = false;
  try { writeTerrain(t, { flags: new Uint8Array(t.N + 1) }); } catch { threw = true; }
  check('an over-long flag plane is rejected', threw);

  // --- an empty edit is a byte-identical copy ---
  check('empty edit round-trips byte-identically', writeTerrain(t, {}).equals(orig));
}

/** The brush path: TerrainDoc.paintTile -> save -> re-read from disk. */
function testDoc(path: string): void {
  console.log(`\nBRUSH ${path}`);
  const tmp = join(mkdtempSync(join(tmpdir(), 'homm5-doc-')), 'GroundTerrain.bin');
  copyFileSync(path, tmp);
  try {
    const doc = TerrainDoc.open(tmp);
    const paths = doc.layerPaths().filter((p) => p);
    check('doc exposes layer paths', paths.length > 0, `${paths.length}`);
    const tile = paths[0]!;
    const other = paths[1];

    check('a fresh doc is clean', !doc.dirty);

    // Paint a 3x3 patch of vertices with the first tile.
    const verts: number[] = [];
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) verts.push(y * doc.V + x);
    doc.paintTile(tile, verts);
    check('painting marks the doc dirty', doc.dirty);

    const m = doc.maskOf(tile)!;
    check('target layer is at full strength', verts.every((v) => m[v] === 255));
    if (other) {
      const om = doc.maskOf(other)!;
      // Paint replaces: a higher-priority layer left over the new tile would
      // still cover it, so every other layer must be cleared there.
      check('other layers are cleared under the brush', verts.every((v) => om[v] === 0));
    }

    // Untouched vertices keep whatever they had.
    const before = TerrainDoc.open(path).maskOf(tile)!;
    const far = 5 * doc.V + 5;
    check('vertices outside the brush are untouched', m[far] === before[far]);

    doc.save();
    check('saving clears dirty', !doc.dirty);

    const reread = TerrainDoc.open(tmp).maskOf(tile)!;
    check('the stroke survives a round trip through disk', verts.every((v) => reread[v] === 255));

    // A second stroke on the already-saved doc must still land.
    const doc2 = TerrainDoc.open(tmp);
    doc2.paintTile(tile, [0]);
    doc2.save();
    check('a second save builds on the first', TerrainDoc.open(tmp).maskOf(tile)![0] === 255);

    let threw = false;
    try { doc2.paintTile('/MapObjects/_(AdvMapTile)/NoSuchTile.xdb', [0]); } catch { threw = true; }
    check('painting an absent layer is rejected', threw);
  } finally {
    rmSync(dirname(tmp), { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const samples = args.length
  ? args
  : ['samples/A2M3_GroundTerrain.bin', 'samples/A2M6_GroundTerrain.bin'].filter((p) => existsSync(p));

if (!samples.length) {
  console.log('no sample terrain found — pass GroundTerrain.bin paths as arguments');
  process.exit(0);
}
for (const p of samples) { testFile(p); testDoc(p); }

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

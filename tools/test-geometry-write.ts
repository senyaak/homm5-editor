// The geometry writer, checked without launching anything.
//
//   node tools/test-geometry-write.ts [--all] [dataRoot]
//
// Two questions, both answerable from the shipped files alone:
//
//   1. Do we understand the container? Decode every geometry the game ships,
//      re-encode it with our writer and compare byte for byte. A field we mis-read
//      — a size form chosen differently, a record we skipped past, a payload we
//      thought was data and is really a struct — cannot survive that. This is the
//      experiment that replaces "put it in the game and look at it", which cost
//      six runs and answered "invisible" every time.
//
//   2. Does a mesh built from nothing come back out correctly? Build the box,
//      write it, and read it with the same decoder the editor uses.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometry, encodeGeometry, buildGeometry, boxGroup, groupBBox, rotateGroup, VERTEX_STRIDE } from '../src/scene/geometry-write.ts';
import { extractMeshesStructured } from '../src/scene/geometry.ts';
import { dataDir } from './game-dir.ts';

const args = process.argv.slice(2);
const all = args.includes('--all');
const root = args.find((a) => !a.startsWith('--')) ?? dataDir();

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- 1. round trip -----------------------------------------------------------

const dir = join(root, 'bin', 'Geometries');
const names = readdirSync(dir);
const sample = all ? names : names.filter((_, i) => i % 7 === 0);
let exact = 0, differ = 0, remapPairs = 0, remapSame = 0;
const firstDiffs: string[] = [];

for (const n of sample) {
  const original = readFileSync(join(dir, n));
  const again = encodeGeometry(decodeGeometry(original));
  if (again.equals(original)) exact++;
  else {
    differ++;
    if (firstDiffs.length < 5) {
      let at = 0;
      while (at < Math.min(again.length, original.length) && again[at] === original[at]) at++;
      firstDiffs.push(`${n}: ${original.length} -> ${again.length} bytes, first difference at ${at}`);
    }
  }
  // While the file is open: field 6 is not a copy of field 5. Check the rule the
  // writer generates it by — first render vertex at the same position — against
  // what the library actually stores, group by group. This is the difference
  // between transcribing a mesh and being able to author one.
  for (const block of decodeGeometry(original).find((r) => r.tag === 1)?.kids
    ?.find((r) => r.tag === 2)?.kids?.filter((r) => r.tag === 1) ?? []) {
    for (const g of block.kids?.filter((r) => r.tag === 1) ?? []) {
      const dataOf = (tag: number): Buffer | undefined =>
        g.kids?.find((r) => r.tag === tag)?.kids?.find((r) => r.tag === 2)?.data;
      const a = dataOf(5), b = dataOf(6);
      if (!a || !b) continue;
      remapPairs++;
      const remap = new Uint16Array(a.length / 2);
      for (let i = 0; i < remap.length; i++) remap[i] = a.readUInt16LE(i * 2);
      const want = Buffer.alloc(b.length);
      const first = new Map<number, number>();
      for (let i = 0; i < remap.length; i++) {
        if (!first.has(remap[i]!)) first.set(remap[i]!, i);
        want.writeUInt16LE(first.get(remap[i]!)!, i * 2);
      }
      if (want.equals(b)) remapSame++;
    }
  }
}
check(`round trip is byte-exact on ${sample.length} shipped geometries`, differ === 0,
  differ ? firstDiffs.join(' | ') : `${exact} files`);
check('field 6 is the first render vertex at each position', remapPairs > 0 && remapSame === remapPairs,
  `${remapSame} of ${remapPairs} groups`);

// --- 2. a box of our own -----------------------------------------------------

const HALF: [number, number, number] = [0.55, 0.55, 0.55];
const CENTRE: [number, number, number] = [0, 0, 1];
const plain = boxGroup(CENTRE, HALF);
const bin = buildGeometry([[plain]]);
check('the box re-reads through the writer', encodeGeometry(decodeGeometry(bin)).equals(bin));

const meshes = extractMeshesStructured(bin);
check('the decoder finds exactly one mesh', meshes?.length === 1, `${meshes?.length}`);
const m = meshes?.[0];
if (m) {
  check('24 render vertices, 12 triangles', m.vertexCount === 24 && m.triCount === 12,
    `${m.vertexCount} / ${m.triCount}`);

  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = m.positions[i + c]!;
      if (v < lo[c]!) lo[c] = v;
      if (v > hi[c]!) hi[c] = v;
    }
  }
  const spans = [0, 1, 2].map((c) => hi[c]! - lo[c]!);
  check('it is a cube of the size asked for',
    spans.every((s) => Math.abs(s - 2 * HALF[0]!) < 1e-5), spans.map((s) => s.toFixed(3)).join(' × '));
  check('centred where it was asked to be',
    [0, 1, 2].every((c) => Math.abs((lo[c]! + hi[c]!) / 2 - CENTRE[c]!) < 1e-5));

  // Six faces means six distinct normals, each on four vertices.
  const normals = new Map<string, number>();
  for (let i = 0; i < m.normals.length; i += 3) {
    const k = [0, 1, 2].map((c) => Math.round(m.normals[i + c]!)).join(',');
    normals.set(k, (normals.get(k) ?? 0) + 1);
  }
  check('six flat faces, four vertices each', normals.size === 6 && [...normals.values()].every((v) => v === 4),
    [...normals.keys()].join(' '));

  // Every face carries one whole copy of the texture.
  const uvs = m.uvs!;
  let uvOut = 0, uvCorners = 0;
  for (let i = 0; i < uvs.length; i += 2) {
    if (uvs[i]! < -1e-6 || uvs[i]! > 1 + 1e-6 || uvs[i + 1]! < -1e-6 || uvs[i + 1]! > 1 + 1e-6) uvOut++;
    if ((Math.abs(uvs[i]!) < 1e-3 || Math.abs(uvs[i]! - 1) < 1e-3) &&
        (Math.abs(uvs[i + 1]!) < 1e-3 || Math.abs(uvs[i + 1]! - 1) < 1e-3)) uvCorners++;
  }
  check('texture coordinates fill the unit square exactly', uvOut === 0 && uvCorners === 24,
    `${uvOut} outside, ${uvCorners} of 24 on a corner`);

  // Winding: a closed body wound counter-clockwise from outside has positive
  // signed volume, which is what every closed shipped mesh has and what decides
  // the culled side of a single-sided material.
  let volume = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const p = [0, 1, 2].map((k) => {
      const o = m.indices[i + k]! * 3;
      return [m.positions[o]! - CENTRE[0]!, m.positions[o + 1]! - CENTRE[1]!, m.positions[o + 2]! - CENTRE[2]!];
    });
    volume += (p[0]![0]! * (p[1]![1]! * p[2]![2]! - p[1]![2]! * p[2]![1]!)
      - p[0]![1]! * (p[1]![0]! * p[2]![2]! - p[1]![2]! * p[2]![0]!)
      + p[0]![2]! * (p[1]![0]! * p[2]![1]! - p[1]![1]! * p[2]![0]!)) / 6;
  }
  check('wound outward — positive volume', volume > 0, `${volume.toFixed(3)} (a cube of ${(8 * HALF[0]! ** 3).toFixed(3)})`);

  // Every edge shared by exactly two triangles: the box is closed.
  const edges = new Map<string, number>();
  for (let i = 0; i < m.indices.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      // Count by POSITION, not by render vertex: the corners are split three ways.
      const key = (v: number): string => {
        const o = m.indices[i + v]! * 3;
        return [0, 1, 2].map((c) => m.positions[o + c]!.toFixed(4)).join(',');
      };
      const [a, b] = [key(e), key((e + 1) % 3)].sort();
      const k = `${a}|${b}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  const open = [...edges.values()].filter((v) => v !== 2).length;
  check('closed: every edge shared by two triangles', open === 0, `${open} open of ${edges.size}`);
}

// A tilted box is still the same mesh, moved.
const tilted = rotateGroup(plain, [0.14, 0.10, 0.35], CENTRE);
const tiltedBox = groupBBox([tilted]);
check('a tilt keeps the centre and widens the box',
  Math.abs(tiltedBox.cz - CENTRE[2]!) < 1e-4 && tiltedBox.sx > 2 * HALF[0]!,
  `${tiltedBox.sx.toFixed(3)} × ${tiltedBox.sy.toFixed(3)} × ${tiltedBox.sz.toFixed(3)}`);
check('the tilt turns the normals with the body', (() => {
  const n = (v: number, c: number): number => (tilted.vertices[v * VERTEX_STRIDE + 8 + c]! - 128) / 127;
  // The top face's first vertex pointed straight up; after the tilt it must not.
  return Math.abs(n(0, 2) - 1) > 0.01 && Math.hypot(n(0, 0), n(0, 1), n(0, 2)) > 0.9;
})());

console.log(failures ? `\n${failures} check(s) failed` : '\nall good');
process.exit(failures ? 1 : 0);

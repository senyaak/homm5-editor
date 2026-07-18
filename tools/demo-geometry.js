// Demo/self-check for src/geometry.js: resolve a mesh from its Model.xdb, read
// the binary, extract vertex positions, and confirm they match the declared
// bounding box. Exercises the reliable, documented capability end to end.
//
// Usage: node tools/demo-geometry.js
//   (paths point at the extracted sample tree under samples/paks/data)

import { readFileSync } from 'node:fs';
import { extractPositionArrays, readGeometryRefFromModelXdb } from '../src/geometry.ts';

const DATA = 'samples/paks/data';
const modelXdb = `${DATA}/_(Model)/TerrainObjects/Grass/Mountains/Mounting12x12_1.(Model).xdb`;

const ref = readGeometryRefFromModelXdb(readFileSync(modelXdb, 'utf8'));
if (!ref) { console.log('could not read geometry ref from Model.xdb'); process.exit(1); }
console.log(`model: ${modelXdb.split('/').pop()}`);
console.log(`geometry uid: ${ref.uid}`);
console.log(`bbox: size (${ref.bbox.sx},${ref.bbox.sy},${ref.bbox.sz}) center (${ref.bbox.cx},${ref.bbox.cy},${ref.bbox.cz})\n`);

const bin = readFileSync(`${DATA}/bin/Geometries/${ref.uid}`);
const arrays = extractPositionArrays(bin, ref.bbox);
console.log(`found ${arrays.length} position array(s):`);
for (const a of arrays) {
  const p = a.positions;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) { const v = p[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const dim = mx.map((v, k) => (v - mn[k]).toFixed(2));
  console.log(`  @${a.offset}: ${a.count} verts   extent ${dim.join(' × ')}  (expected ~${ref.bbox.sx} × ${ref.bbox.sy} × ${ref.bbox.sz})`);
}

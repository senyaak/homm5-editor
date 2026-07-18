// Decode a HoMM5 geometry binary into a drawable mesh (positions + remap +
// indices) via src/geometry.js and write an OBJ. Prints an edge-length sanity
// check: a correct decode has no edges anywhere near the mesh size.
//
// Usage: node tools/mesh-to-obj.js <modelXdb> <out.obj>
//   modelXdb resolves the geometry uid + bounding box; the binary is read from
//   the same extracted sample tree.

import { readFileSync, writeFileSync } from 'node:fs';
import { extractMeshes, readGeometryRefFromModelXdb } from '../src/geometry.js';

const [modelXdb, out] = process.argv.slice(2);
const DATA = 'samples/paks/data';

const ref = readGeometryRefFromModelXdb(readFileSync(modelXdb, 'utf8'));
if (!ref) { console.log('no geometry ref in', modelXdb); process.exit(1); }
const bin = readFileSync(`${DATA}/bin/Geometries/${ref.uid}`);
const meshes = extractMeshes(bin, ref.bbox);
if (!meshes.length) { console.log('no meshes decoded'); process.exit(1); }

const meshSize = Math.max(ref.bbox.sx, ref.bbox.sy, ref.bbox.sz);
let obj = `# ${modelXdb.split('/').pop()}  uid ${ref.uid}\n`;
let base = 0, totalV = 0, totalT = 0;
for (const [mi, m] of meshes.entries()) {
  // edge stats
  const edges = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[i + k] * 3, c = m.indices[i + (k + 1) % 3] * 3;
      edges.push(Math.hypot(m.positions[a] - m.positions[c], m.positions[a + 1] - m.positions[c + 1], m.positions[a + 2] - m.positions[c + 2]));
    }
  }
  edges.sort((x, y) => x - y);
  const maxE = edges[edges.length - 1], medE = edges[edges.length >> 1];
  const stray = edges.filter((e) => e > meshSize * 0.6).length;
  console.log(`mesh ${mi}: ${m.vertexCount} verts, ${m.triCount} tris — edge med ${medE.toFixed(2)} max ${maxE.toFixed(2)} (size ${meshSize}), stray edges ${stray}`);

  obj += `o mesh${mi}\n`;
  for (let i = 0; i < m.vertexCount; i++) obj += `v ${m.positions[i * 3].toFixed(4)} ${m.positions[i * 3 + 1].toFixed(4)} ${m.positions[i * 3 + 2].toFixed(4)}\n`;
  if (m.uvs) for (let i = 0; i < m.vertexCount; i++) obj += `vt ${m.uvs[i * 2].toFixed(4)} ${(1 - m.uvs[i * 2 + 1]).toFixed(4)}\n`;
  if (m.normals) for (let i = 0; i < m.vertexCount; i++) obj += `vn ${m.normals[i * 3].toFixed(4)} ${m.normals[i * 3 + 1].toFixed(4)} ${m.normals[i * 3 + 2].toFixed(4)}\n`;
  const ref2 = (k) => { const n = k + 1 + base; return m.uvs && m.normals ? `${n}/${n}/${n}` : m.normals ? `${n}//${n}` : `${n}`; };
  for (let i = 0; i < m.indices.length; i += 3) obj += `f ${ref2(m.indices[i])} ${ref2(m.indices[i + 1])} ${ref2(m.indices[i + 2])}\n`;
  base += m.vertexCount; totalV += m.vertexCount; totalT += m.triCount;
}
writeFileSync(out, obj);
console.log(`wrote ${out}: ${meshes.length} mesh(es), ${totalV} verts, ${totalT} tris`);

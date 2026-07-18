// Diagnose mesh-decode quality across a map's models. For every unique object
// Shared, resolve its geometry, decode it, and measure how "shattered" the result
// is: the fraction of triangle edges longer than half the model's bounding-box
// diagonal. Clean meshes score ~0; the scrambled "explosion" meshes score high.
//
// Prints the worst offenders with their geometry uid + model path so we can dig
// into the container structure of a specific broken model.
//
// Usage: node tools/mesh-quality.js <map.xdb> [topN]

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { extractMeshes, readGeometryRefFromModelXdb } from '../src/geometry.js';
import { findAssetRoot } from '../src/scene.js';

const [mapPath, topNs] = process.argv.slice(2);
const topN = +(topNs || 15);
const assetRoot = findAssetRoot(mapPath);
const readXdb = (href) => { const p = join(assetRoot, href.split('#')[0]); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

const map = readFileSync(mapPath, 'utf8');
const shareds = [...new Set([...map.matchAll(/<Shared href="([^"]+?)(?:#[^"]*)?"/g)].map((m) => m[1]))];

function meshStats(meshes, bbox) {
  const diag = Math.hypot(bbox.sx, bbox.sy, bbox.sz) || 1;
  let edges = 0, longEdges = 0, maxEdge = 0;
  for (const m of meshes) {
    for (let i = 0; i < m.indices.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = m.indices[i + e] * 3, b = m.indices[i + (e + 1) % 3] * 3;
        const d = Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
        edges++; if (d > maxEdge) maxEdge = d;
        if (d > 0.5 * diag) longEdges++;
      }
    }
  }
  return { edges, longFrac: edges ? longEdges / edges : 0, maxEdgeRel: maxEdge / diag };
}

const rows = [];
for (const sh of shareds) {
  try {
    const shared = readXdb(sh);
    const mh = shared && shared.match(/<Model href="([^"]+)"/);
    const model = mh && readXdb(mh[1]);
    const ref = model && readGeometryRefFromModelXdb(model);
    if (!ref) continue;
    const bin = join(assetRoot, 'bin', 'Geometries', ref.uid);
    if (!existsSync(bin)) continue;
    const meshes = extractMeshes(readFileSync(bin), ref.bbox);
    if (!meshes.length) continue;
    const st = meshStats(meshes, ref.bbox);
    let verts = 0, tris = 0; for (const m of meshes) { verts += m.vertexCount; tris += m.triCount; }
    rows.push({ uid: ref.uid, model: mh[1].split('/').pop(), submeshes: meshes.length, verts, tris, ...st });
  } catch { /* skip */ }
}

rows.sort((a, b) => b.longFrac - a.longFrac);
console.log(`${rows.length} models decoded from ${shareds.length} shareds\n`);
console.log('longFrac  maxEdge  subm  verts  tris   uid / model');
for (const r of rows.slice(0, topN)) {
  console.log(
    `${(r.longFrac * 100).toFixed(1).padStart(6)}%  ${r.maxEdgeRel.toFixed(2).padStart(6)}  ${String(r.submeshes).padStart(3)}  ${String(r.verts).padStart(5)}  ${String(r.tris).padStart(5)}   ${r.uid}  ${r.model}`,
  );
}
const bad = rows.filter((r) => r.longFrac > 0.02).length;
console.log(`\n${bad}/${rows.length} models look shattered (>2% long edges); ${rows.length - bad} look clean`);

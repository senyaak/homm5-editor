// Render a decoded HoMM5 mesh with its actual texture, flat per-face: each
// triangle is filled with the texture colour sampled at its centroid UV, scaled
// by simple directional lighting. Proves positions+indices+UVs+texture all line
// up. Output: a self-contained SVG.
//
// Usage: node tools/render-textured.js <modelXdb> <ddsPath> <out.svg>

import { readFileSync, writeFileSync } from 'node:fs';
import { extractMeshes, readGeometryRefFromModelXdb } from '../src/geometry.ts';
import { decodeDDS } from '../src/dds.ts';

const [modelXdb, ddsPath, out] = process.argv.slice(2);
const DATA = 'samples/paks/data';

const ref = readGeometryRefFromModelXdb(readFileSync(modelXdb, 'utf8'));
const bin = readFileSync(`${DATA}/bin/Geometries/${ref.uid}`);
const mesh = extractMeshes(bin, ref.bbox)[0];
if (!mesh || !mesh.uvs) { console.log('no mesh/uvs'); process.exit(1); }
const tex = decodeDDS(ddsPath);
console.log(`mesh ${mesh.vertexCount}v/${mesh.triCount}t, texture ${tex.width}×${tex.height}`);

const sample = (u, v) => {
  // tiling wrap
  let x = Math.floor(((u % 1) + 1) % 1 * tex.width);
  let y = Math.floor(((v % 1) + 1) % 1 * tex.height);
  const o = (y * tex.width + x) * 4;
  return [tex.rgba[o], tex.rgba[o + 1], tex.rgba[o + 2]];
};

const P = mesh.positions, N = mesh.normals, UV = mesh.uvs, I = mesh.indices;
// centre + rotate
let c = [0, 0, 0];
for (let i = 0; i < mesh.vertexCount; i++) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k];
c = c.map((x) => x / mesh.vertexCount);
const az = 0.9, ax = -0.95;
const rot = (x, y, z) => {
  x -= c[0]; y -= c[1]; z -= c[2];
  let cs = Math.cos(az), sn = Math.sin(az); const x2 = x * cs - y * sn, y2 = x * sn + y * cs;
  cs = Math.cos(ax); sn = Math.sin(ax); return [x2, y2 * cs - z * sn, y2 * sn + z * cs];
};
const PR = [];
let r = 0;
for (let i = 0; i < mesh.vertexCount; i++) { const p = rot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); PR.push(p); r = Math.max(r, Math.hypot(...p)); }

const W = 680, H = 460, s = Math.min(W, H) * 0.42 / r, ox = W / 2, oy = H / 2 + 40;
const L = [0.4, 0.35, 0.85];
const tris = [];
for (let i = 0; i < I.length; i += 3) {
  const a = I[i], b = I[i + 1], d = I[i + 2];
  const A = PR[a], B = PR[b], D = PR[d];
  // face normal for lighting (from world positions)
  const nx = (N[a * 3] + N[b * 3] + N[d * 3]) / 3, ny = (N[a * 3 + 1] + N[b * 3 + 1] + N[d * 3 + 1]) / 3, nz = (N[a * 3 + 2] + N[b * 3 + 2] + N[d * 3 + 2]) / 3;
  const nl = Math.hypot(nx, ny, nz) || 1;
  const lit = 0.45 + 0.55 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
  const uu = (UV[a * 2] + UV[b * 2] + UV[d * 2]) / 3, vv = (UV[a * 2 + 1] + UV[b * 2 + 1] + UV[d * 2 + 1]) / 3;
  const col = sample(uu, vv);
  tris.push({ A, B, D, z: (A[2] + B[2] + D[2]) / 3, col: col.map((ch) => Math.min(255, ch * lit | 0)) });
}
tris.sort((p, q) => p.z - q.z);

let svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img"><title>Textured HoMM5 mountain</title><desc>decoded mesh with its DXT3 texture sampled per face</desc><rect width="${W}" height="${H}" fill="#0f1216"/>`;
for (const t of tris) {
  const pts = [t.A, t.B, t.D].map((p) => `${Math.round(ox + p[0] * s)},${Math.round(oy - p[1] * s)}`).join(' ');
  svg += `<polygon points="${pts}" fill="rgb(${t.col[0]},${t.col[1]},${t.col[2]})"/>`;
}
svg += '</svg>';
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes)`);

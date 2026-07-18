// Software-rasterize a map scene (terrain + placed/rotated object meshes) to a
// PNG, with a z-buffer and simple lighting. Proves placement/rotation are right
// without needing a browser. No dependencies (PNG via zlib).
//
// Usage: node tools/render-scene.js <map.xdb> <out.png> [W H]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { parseTerrain, readHeights } from '../src/terrain.js';
import { extractMeshes, readGeometryRefFromModelXdb } from '../src/geometry.js';
import { decodeDDS } from '../src/dds.js';

const [mapXdb, out, Ws, Hs] = process.argv.slice(2);
const W = +(Ws || 1000), Ht = +(Hs || 680);
const DATA = 'samples/paks/data';
const readXdb = (h) => { const p = DATA + h.split('#')[0]; return existsSync(p) ? readFileSync(p, 'utf8') : null; };

// ---- gather scene (world-space triangles) ----
const mapDir = mapXdb.replace(/[^/]+$/, '');
const terr = parseTerrain(readFileSync(mapDir + 'GroundTerrain.bin'));
const H = readHeights(terr), V = terr.V;
const heightAt = (x, y) => H[Math.max(0, Math.min(V - 1, Math.round(y))) * V + Math.max(0, Math.min(V - 1, Math.round(x)))];

const tris = []; // {p:[[x,y,z]×3], col:[r,g,b]}
// terrain (colour by height)
for (let y = 0; y < V - 1; y++) for (let x = 0; x < V - 1; x++) {
  const q = (X, Y) => [X, Y, H[Y * V + X]];
  const push = (a, b, c) => {
    const hh = (a[2] + b[2] + c[2]) / 3;
    const t = Math.max(0, Math.min(1, (hh - 1) / 7));
    const col = [70 + t * 70, 90 + t * 55, 60 + t * 30];
    tris.push({ p: [a, b, c], col });
  };
  push(q(x, y), q(x, y + 1), q(x + 1, y)); push(q(x + 1, y), q(x, y + 1), q(x + 1, y + 1));
}

// objects — resolve mesh + texture
const geomCache = new Map();
const texCache = new Map();
function resolveTex(modelXml) {
  const t = modelXml.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/);
  if (!t) return null;
  if (texCache.has(t[1])) return texCache.get(t[1]);
  let tex = null;
  try {
    const tx = readXdb(t[1]); const dest = tx && tx.match(/<DestName href="([^"]+)"/);
    if (dest) {
      const dds = DATA + t[1].split('#')[0].replace(/[^/]+$/, '') + dest[1];
      if (existsSync(dds)) tex = decodeDDS(dds);
    }
  } catch {}
  texCache.set(t[1], tex); return tex;
}
function resolve(href) {
  if (geomCache.has(href)) return geomCache.get(href);
  let g = null;
  try {
    const sh = readXdb(href); const mh = sh && sh.match(/<Model href="([^"]+)"/);
    const model = mh && readXdb(mh[1]); const ref = model && readGeometryRefFromModelXdb(model);
    const bin = ref && `${DATA}/bin/Geometries/${ref.uid}`;
    if (bin && existsSync(bin)) { const m = extractMeshes(readFileSync(bin), ref.bbox); if (m.length) g = { meshes: m, tex: resolveTex(model) }; }
  } catch {}
  geomCache.set(href, g); return g;
}
const map = readFileSync(mapXdb, 'utf8');
let placed = 0;
for (const [, , body] of map.matchAll(/<AdvMap(Static|Building|Treasure)>([\s\S]*?)<\/AdvMap\1>/g)) {
  const p = body.match(/<Pos>\s*<x>([-\d.]+)<\/x>\s*<y>([-\d.]+)<\/y>\s*<z>([-\d.]+)<\/z>/);
  const rot = body.match(/<Rot>([-\d.eE]+)<\/Rot>/);
  const sh = body.match(/<Shared href="([^"]+?)(?:#[^"]*)?"/);
  if (!p || !sh) continue;
  const g = resolve(sh[1]); if (!g) continue;
  const ox = +p[1], oy = +p[2], oz = heightAt(+p[1], +p[2]), r = rot ? +rot[1] : 0;
  const cs = Math.cos(r), sn = Math.sin(r);
  for (const m of g.meshes) {
    for (let i = 0; i < m.indices.length; i += 3) {
      const P = [], UV = [];
      for (let k = 0; k < 3; k++) {
        const vi = m.indices[i + k], o3 = vi * 3, lx = m.positions[o3], ly = m.positions[o3 + 1], lz = m.positions[o3 + 2];
        P.push([ox + lx * cs - ly * sn, oy + lx * sn + ly * cs, oz + lz]);
        if (m.uvs && g.tex) UV.push([m.uvs[vi * 2], m.uvs[vi * 2 + 1]]);
      }
      tris.push(UV.length === 3 ? { p: P, uv: UV, tex: g.tex } : { p: P, col: [138, 143, 150] });
    }
  }
  placed++;
}
console.log(`scene: ${tris.length} triangles (${placed} objects on ${V}×${V} terrain)`);

// ---- camera (lookAt + perspective) ----
const c = V / 2;
const eye = [c, -V * 0.55, V * 0.72], tgt = [c, c, 3], up = [0, 0, 1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fwd = norm(sub(tgt, eye)), right = norm(cross(fwd, up)), camUp = cross(right, fwd);
const f = 1 / Math.tan((55 * Math.PI / 180) / 2), aspect = W / Ht;
const L = norm([0.5, 0.4, 0.9]);
function project(p) {
  const d = sub(p, eye); const vx = dot(d, right), vy = dot(d, camUp), vz = dot(d, fwd);
  if (vz <= 0.01) return null;
  return [(vx * f / aspect / vz * 0.5 + 0.5) * W, (1 - (vy * f / vz * 0.5 + 0.5)) * Ht, vz];
}

// ---- rasterize with z-buffer ----
const px = new Uint8Array(W * Ht * 3); // sky
for (let i = 0; i < W * Ht; i++) { px[i * 3] = 13; px[i * 3 + 1] = 16; px[i * 3 + 2] = 20; }
const zb = new Float32Array(W * Ht).fill(Infinity);
const smp = (tex, u, v) => {
  const x = ((u % 1) + 1) % 1 * tex.width | 0, y = ((v % 1) + 1) % 1 * tex.height | 0;
  const o = (y * tex.width + x) * 4; return [tex.rgba[o], tex.rgba[o + 1], tex.rgba[o + 2]];
};
for (const t of tris) {
  const s = t.p.map(project); if (s.some((v) => !v)) continue;
  const n = norm(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])));
  const lit = 0.35 + 0.65 * Math.abs(dot(n, L));
  const flat = t.col && t.col.map((ch) => Math.min(255, ch * lit) | 0);
  const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), maxY = Math.min(Ht - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
  const [ax, ay] = s[0], [bx, by] = s[1], [cx, cy] = s[2];
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
    const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
    const w2 = 1 - w0 - w1; if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2]; const o = y * W + x;
    if (z >= zb[o]) continue;
    let col = flat;
    if (t.tex) {
      const u = w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0];
      const v = w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1];
      const c = smp(t.tex, u, v); col = [Math.min(255, c[0] * lit) | 0, Math.min(255, c[1] * lit) | 0, Math.min(255, c[2] * lit) | 0];
    }
    zb[o] = z; px[o * 3] = col[0]; px[o * 3 + 1] = col[1]; px[o * 3 + 2] = col[2];
  }
}

// ---- PNG encode (truecolor, filter 0) ----
function png(W, Ht, rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * Ht);
  for (let y = 0; y < Ht; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy ? 0 : 0; Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const idat = deflateSync(raw);
  const crcTab = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTab[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const body = Buffer.concat([t, data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(body)); return Buffer.concat([len, body, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(Ht, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(out, png(W, Ht, px));
console.log(`wrote ${out}`);

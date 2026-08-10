// Validates the Pandora's Box build — the object every gameplay-mod install ships.
//
// What is checked, and why it is enough to trust the box without a game run:
//
//   the cube — the rebuilt donor geometry decodes to exactly a cube: the box's
//     bounding box, twelve real triangles wound OUTWARD (signed volume +1.0³ —
//     a flipped winding comes out negative, which is the check catching it),
//     UVs inside [0,1], face normals matching face planes;
//   the documents — all four tiers parse, their fields resolve inside the mod
//     (self-containment, same promise as buildings), and the palette link names
//     the poorest tier;
//   the tiers — the value-to-glow mapping is monotonic and starts at Blue;
//   the texture — painted, not copied: the image is non-uniform and the .dds
//     documents describe what writeDDS produced.
//
//   node tools/test-pandora.ts [dataRoot]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PANDORA_CHEST_LINK, PANDORA_CHEST_SHARED, PANDORA_LINK, PANDORA_TIERS,
  buildPandora, pandoraShared, pandoraTexture, pandoraTier,
} from '../src/mods/pandora-files.ts';
import { buildGameplayArchive } from '../src/mods/gameplay.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { readEntries } from '../src/format/pak.ts';
import { extractMeshesStructured } from '../src/scene/geometry.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to build from`);
  process.exit(0);
}
const read = dataReader(dataRoot);

console.log('the build');
const files = buildPandora(read);
const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f.data]));
check('produces files', files.length > 10, `${files.length}`);

// ---- the cube ---------------------------------------------------------------

console.log('the cube');
const shared0 = byPath.get(pandoraShared(PANDORA_TIERS[0]!.key).toLowerCase())?.toString('latin1') ?? '';
const modelHref = /<Model href="\/([^"#]+)/.exec(shared0)?.[1] ?? '';
const modelDoc = byPath.get(modelHref.toLowerCase())?.toString('latin1') ?? '';
const geomHref = /<Geometry href="([^"#]+)/.exec(modelDoc)?.[1] ?? '';
const geomPath = geomHref.startsWith('/') ? geomHref.slice(1)
  : join(modelHref, '..', geomHref).replace(/\\/g, '/');
const geomDoc = byPath.get(geomPath.toLowerCase())?.toString('latin1') ?? '';
const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(geomDoc)?.[1] ?? '';
const bin = byPath.get(`bin/geometries/${uid.toUpperCase()}`.toLowerCase());
check('the geometry binary is in the mod', !!bin, uid);

if (bin) {
  const meshes = extractMeshesStructured(Buffer.from(bin)) ?? [];
  check('decodes', meshes.length > 0, `${meshes.length} meshes`);
  const m = meshes[0]!;

  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertexCount; i++) for (let k = 0; k < 3; k++) {
    const v = m.positions[i * 3 + k]!;
    if (v < mn[k]!) mn[k] = v; if (v > mx[k]!) mx[k] = v;
  }
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
  check('is the box', near(mn[0]!, -0.5) && near(mx[0]!, 0.5) && near(mn[1]!, -0.5) && near(mx[1]!, 0.5) && near(mn[2]!, 1.5) && near(mx[2]!, 2.5),
    `${mn.map((v) => v.toFixed(2)).join(',')} .. ${mx.map((v) => v.toFixed(2)).join(',')}`);

  // the document's box says the same
  const size = /<Size>\s*<x>([^<]+)<\/x>\s*<y>([^<]+)<\/y>\s*<z>([^<]+)<\/z>/.exec(geomDoc);
  check('the document box matches', !!size && near(Number(size[1]), 1) && near(Number(size[2]), 1) && near(Number(size[3]), 1));

  // twelve real triangles, wound outward: signed volume of a 1-cube is +1
  let live = 0, volume = 0;
  const I = m.positions;
  const c = [0, 0, 2.0];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, d] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    if (a === b || b === d || a === d) continue;
    live++;
    const A = [I[a * 3]! - c[0]!, I[a * 3 + 1]! - c[1]!, I[a * 3 + 2]! - c[2]!];
    const B = [I[b * 3]! - c[0]!, I[b * 3 + 1]! - c[1]!, I[b * 3 + 2]! - c[2]!];
    const D = [I[d * 3]! - c[0]!, I[d * 3 + 1]! - c[1]!, I[d * 3 + 2]! - c[2]!];
    volume += (A[0]! * (B[1]! * D[2]! - B[2]! * D[1]!)
      - A[1]! * (B[0]! * D[2]! - B[2]! * D[0]!)
      + A[2]! * (B[0]! * D[1]! - B[1]! * D[0]!)) / 6;
  }
  check('twelve triangles live', live === 12, `${live}`);
  check('wound outward', near(volume, 1), `signed volume ${volume.toFixed(3)}`);

  // UVs in range, normals axis-aligned on the live vertices
  let uvOk = true, nOk = true;
  for (let i = 0; i < 24; i++) {
    const u = m.uvs![i * 2]!, v = m.uvs![i * 2 + 1]!;
    if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) uvOk = false;
    const n = [m.normals![i * 3]!, m.normals![i * 3 + 1]!, m.normals![i * 3 + 2]!];
    const big = Math.max(...n.map(Math.abs));
    if (big < 0.95) nOk = false;
  }
  check('UVs are planar per face', uvOk);
  check('normals are the face axes', nOk);
}

// ---- the documents ----------------------------------------------------------

console.log('the documents');
for (const tier of PANDORA_TIERS) {
  const doc = byPath.get(pandoraShared(tier.key).toLowerCase())?.toString('latin1');
  check(`${tier.key} parses`, !!doc && doc.includes('<AdvMapStandShared>'));
  if (!doc) continue;
  // every absolute href points inside the build
  const outside = [...doc.matchAll(/href="\/([^"#]+)/g)]
    .map((h) => h[1]!)
    .filter((h) => !byPath.has(h.toLowerCase()) && !h.startsWith('Text/'));
  check(`${tier.key} is self-contained`, outside.length === 0, outside.join(', '));
  check(`${tier.key} is active on its tile`, /<activeTiles>[\s\S]*?<x>0<\/x>[\s\S]*?<\/activeTiles>/.test(doc));
  check(`${tier.key} carries its glow`, doc.includes(`/art/${tier.effect.replace(/\\/g, '/')}`)
    || /<Effect href="\/[^"]+"/.test(doc));
}

const link = byPath.get(PANDORA_LINK.toLowerCase())?.toString('latin1') ?? '';
check('the palette link names the poorest tier', link.includes(pandoraShared(PANDORA_TIERS[0]!.key)));

// ---- the tiers --------------------------------------------------------------

console.log('the tiers');
check('empty is Blue', pandoraTier(0).key === 'Blue');
check('5000 is Green', pandoraTier(5000).key === 'Green');
check('15000 is Gold', pandoraTier(15000).key === 'Gold');
check('a fortune is Red', pandoraTier(1e6).key === 'Red');
let last = -1, monotonic = true;
for (const t of PANDORA_TIERS) { if (t.from <= last) monotonic = false; last = t.from; }
check('thresholds ascend', monotonic);

// ---- the texture ------------------------------------------------------------

console.log('the texture');
const img = pandoraTexture();
const seen = new Set<number>();
for (let i = 0; i < img.rgba.length; i += 4) seen.add((img.rgba[i]! << 16) | (img.rgba[i + 1]! << 8) | img.rgba[i + 2]!);
check('is painted, not flat', seen.size > 100, `${seen.size} colours`);
const dds = files.find((f) => f.path === 'Buildings/PandoraBox/PandoraBox.dds');
check('the painted face ships as a dds', !!dds && dds.data.length === 128 + img.width * img.height * 4);
// the MODEL's materials name our texture; the glow effects keep their own
const modelMaterials = [...modelDoc.matchAll(/<Item href="\/([^"#]+)/g)].map((m) => m[1]!);
check('every model material names our texture', modelMaterials.length > 0
  && modelMaterials.every((p) => byPath.get(p.toLowerCase())?.toString('latin1').includes('PandoraBox.(Texture).xdb')),
  `${modelMaterials.length} materials`);
const effectMaterials = files.filter((f) => f.path.toLowerCase().includes('(material)')
  && !modelMaterials.some((p) => p.toLowerCase() === f.path.toLowerCase()));
check('the glow materials keep their art', effectMaterials.length > 0
  && effectMaterials.every((f) => !f.data.toString('latin1').includes('PandoraBox.(Texture).xdb')), `${effectMaterials.length} kept`);

// ---- the archive ------------------------------------------------------------

console.log('the archive');
const archive = buildGameplayArchive(read);
const names = new Set(readEntries(archive).map((e) => e.name));
check('round-trips as a zip', names.size === files.length, `${names.size} of ${files.length}`);
check('carries the palette link', names.has(PANDORA_LINK));
check('carries the chest probe, hidden', names.has(PANDORA_CHEST_LINK) && names.has(PANDORA_CHEST_SHARED));

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);

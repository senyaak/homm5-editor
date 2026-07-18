// Scoreboard for the mesh decoder, scored against the models' own claims.
//
// Every (Model).xdb states <NumMeshes> and names them in <MeshNames>. That is a
// ground truth we get for free: if the decoder returns a different number of
// meshes than the model declares, it is wrong, and no human has to look at a
// picture to say so. MESH_PLAN assumed model quality needed manual verdicts —
// for the mesh COUNT it does not.
//
// This does not prove a model is right: correct count with mangled triangles
// still scores as exact. It is a lower bound on breakage and a progress meter
// for fixing the decoder one family of models at a time.
//
//   node tools/mesh-audit.ts [dataRoot] [--list=short|over|none] [--limit=N]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractMeshes, readGeometryRefFromModelXdb } from '../src/geometry.ts';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--')) ?? 'samples/paks/data';
const listWhat = /^--list=(\w+)$/.exec(args.find((a) => a.startsWith('--list=')) ?? '')?.[1] ?? '';
const limit = +(/^--limit=(\d+)$/.exec(args.find((a) => a.startsWith('--limit=')) ?? '')?.[1] ?? 25);

/** Every (Model).xdb under the data root. */
function findModels(dir: string, out: string[] = []): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    const f = join(dir, e);
    let st;
    try { st = statSync(f); } catch { continue; }
    if (st.isDirectory()) findModels(f, out);
    else if (e.endsWith('.xdb')) out.push(f);
  }
  return out;
}

type Verdict = 'exact' | 'short' | 'over' | 'none' | 'noGeometry';

interface Row { path: string; declared: number; found: number; verdict: Verdict }

const rows: Row[] = [];
for (const p of findModels(join(root, '_(Model)'))) {
  const xml = readFileSync(p, 'utf8');
  const declared = +(/<NumMeshes>(\d+)</.exec(xml)?.[1] ?? 0);
  if (!declared) continue; // not a mesh-bearing model
  const ref = readGeometryRefFromModelXdb(xml);
  const bin = ref && join(root, 'bin', 'Geometries', ref.uid);
  if (!ref || !bin || !existsSync(bin)) {
    rows.push({ path: p, declared, found: 0, verdict: 'noGeometry' });
    continue;
  }
  let found = 0;
  // A decoder throw is a failure to decode, not a reason to stop the audit.
  try { found = extractMeshes(readFileSync(bin), ref.bbox).length; } catch { found = 0; }
  const verdict: Verdict = found === 0 ? 'none'
    : found === declared ? 'exact'
    : found < declared ? 'short' : 'over';
  rows.push({ path: p, declared, found, verdict });
}

const count = (v: Verdict): number => rows.filter((r) => r.verdict === v).length;
const scored = rows.filter((r) => r.verdict !== 'noGeometry').length;
const pct = (n: number): string => `${((100 * n) / scored).toFixed(1)}%`;

console.log(`models declaring meshes : ${rows.length}`);
console.log(`  no geometry file      : ${count('noGeometry')}  (not scored)`);
console.log(`scored                  : ${scored}`);
console.log(`  exact mesh count      : ${count('exact')}\t${pct(count('exact'))}`);
console.log(`  too few meshes        : ${count('short')}\t${pct(count('short'))}`);
console.log(`  too many meshes       : ${count('over')}\t${pct(count('over'))}`);
console.log(`  nothing decoded       : ${count('none')}\t${pct(count('none'))}`);

if (listWhat) {
  const sel = rows.filter((r) => r.verdict === listWhat)
    // Worst first: the biggest shortfall is usually the most informative case.
    .sort((a, b) => (b.declared - b.found) - (a.declared - a.found));
  console.log(`\n${listWhat} (${sel.length}), worst first:`);
  for (const r of sel.slice(0, limit)) {
    console.log(`  ${r.declared} -> ${r.found}\t${r.path.split(/[\\/]/).slice(-2).join('/')}`);
  }
}

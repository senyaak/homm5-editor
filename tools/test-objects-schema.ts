// Object-schema coverage + integrity test, mirroring test-schema for the map.
//
//   node tools/test-objects-schema.ts [dataRoot]

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { objectSchema, objectProps, resolveRef, controlOf, deref } from '../src/schema.ts';
import type { FieldSchema, RegistryName } from '../src/schema.ts';
import { Registry } from '../src/registry.ts';
import { loadMap } from '../src/map.ts';
import { children } from '../src/xml.ts';

const dataRoot = process.argv[2] ?? 'samples/paks/data';
const VALID_REGISTRIES: RegistryName[] = ['spells', 'artifacts', 'heroes', 'races', 'ambientLights', 'creatures', 'skills'];

let problems = 0;
const fail = (m: string) => { console.log('  ✗ ' + m); problems++; };

// --- 1. integrity: $refs resolve, x-registry names valid, allOf branches ok ---
function walk(f: FieldSchema, where: string): void {
  if (f.$ref) { if (!resolveRef(objectSchema, f.$ref)) fail(`${where}: unresolved $ref ${f.$ref}`); return; }
  for (const b of f.allOf ?? []) walk(b, `${where}/allOf`);
  const reg = f['x-registry'];
  if (reg && !VALID_REGISTRIES.includes(reg)) fail(`${where}: unknown x-registry "${reg}"`);
  if (f.properties) for (const [k, v] of Object.entries(f.properties)) walk(v, `${where}.${k}`);
  if (f.items) walk(f.items, `${where}[]`);
}
console.log('=== integrity ===');
for (const [k, v] of Object.entries(objectSchema.$defs ?? {})) walk(v, `$defs.${k}`);
for (const [k, v] of Object.entries(objectSchema.types)) walk(v, `types.${k}`);
console.log(problems ? `  ${problems} problem(s)` : '  ✓ all $refs resolve, all x-registry valid, allOf branches sound');

// --- 2. registries the objects need ---
const reg = new Registry(dataRoot);
console.log('\n=== new registries ===');
const creatures = reg.creatures(), skills = reg.skills();
console.log(`  creatures ${creatures.length}  e.g. ${creatures.slice(1, 4).map((c) => c.id).join(', ')}`);
console.log(`  skills    ${skills.length}  e.g. ${skills.slice(1, 4).map((s) => s.id).join(', ')}`);
if (creatures.length < 100) fail('creatures roster too small');
if (skills.length < 50) fail('skills roster too small');

// --- 3. coverage: every field each object type carries should be declared ---
console.log('\n=== coverage across all maps ===');
const files = execSync('find samples -path "*/SingleMissions/*/map.xdb" -o -path "*/Multiplayer/*/map.xdb"', { encoding: 'utf8', maxBuffer: 1e8 }).trim().split('\n').filter(Boolean);
const byType = new Map<string, Set<string>>();
let maps = 0;
for (const f of files) {
  let m; try { m = loadMap(readFileSync(f, 'utf8')); } catch { continue; } maps++;
  for (const o of m.objects) {
    let s = byType.get(o.type); if (!s) { s = new Set(); byType.set(o.type, s); }
    for (const c of children(o.el)) s.add(c.name);
  }
}
let uncovered = 0;
for (const [type, fields] of [...byType].sort()) {
  const declared = new Set(Object.keys(objectProps(type)));
  const missing = [...fields].filter((f) => !declared.has(f));
  const mark = objectSchema.types[type] ? '' : ' (no type schema — generic fallback)';
  if (missing.length) { console.log(`  ${type}: ${missing.join(', ')}${mark}`); uncovered += missing.length; }
  else console.log(`  ✓ ${type} (${declared.size} fields)`);
}
console.log(`  scanned ${maps} maps, ${byType.size} object types`);

// --- 4. spot-check controls ---
console.log('\n=== controls (AdvMapMonster) ===');
const mon = objectProps('AdvMapMonster');
for (const name of ['Shared', 'Amount', 'Mood', 'ArtifactID', 'Resources', 'AllowQuickCombat']) {
  const f = mon[name]; if (!f) { fail(`AdvMapMonster.${name} missing`); continue; }
  const d = deref(objectSchema, f);
  console.log(`  ${name.padEnd(18)} -> ${controlOf(d)}${d['x-registry'] ? ` (${d['x-registry']})` : ''}${d['x-shared'] ? ' (shared)' : ''}`);
}

const ok = problems === 0 && uncovered === 0;
console.log(`\n${ok ? 'PASS' : `FAIL (${uncovered} uncovered fields)`}`);
process.exit(ok ? 0 : 1);

// Schema coverage + integrity test.
//
// Proves the map schema (1) is internally sound — every $ref resolves, every
// x-registry names a real roster — and (2) covers the fields a real map carries,
// so the typed editor drives them rather than falling back to inference.
//
//   node tools/test-schema.ts [dataRoot]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mapSchema, deref, controlOf, resolveRef } from '../src/schema.ts';
import type { FieldSchema, RegistryName } from '../src/schema.ts';
import { loadMap } from '../src/map.ts';
import { children } from '../src/xml.ts';

const dataRoot = process.argv[2] ?? 'data-unpacked';

/**
 * Any map the data root has, preferring a rich one.
 *
 * NOT a named map. These tests used to open `Maps/SingleMissions/12` — a map
 * someone made by hand on one machine — so they broke the moment that folder
 * was cleaned up, and until then they were asserting against a personal
 * artifact rather than the game's own content.
 */
function anyMap(root: string): string | null {
  const roots = ['Maps/Scenario', 'Maps/SingleMissions', 'Maps/Multiplayer', 'Maps'];
  const walk = (d: string, out: string[] = []): string[] => {
    let ents: string[];
    try { ents = readdirSync(d); } catch { return out; }
    for (const e of ents) {
      const p = join(d, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, out);
      else if (e === 'map.xdb') out.push(p);
    }
    return out;
  };
  for (const r of roots) {
    const found = walk(join(root, r)).sort((a, b) => statSync(a).size - statSync(b).size);
    if (!found.length) continue;
    // The first map big enough to carry players and a spell list, not the
    // biggest: an RMG map runs to 13 MB and turns a fast check into a slow one.
    return found.find((f) => statSync(f).size >= 100_000) ?? found[found.length - 1]!;
  }
  return null;
}
const VALID_REGISTRIES: RegistryName[] = ['spells', 'artifacts', 'heroes', 'races', 'ambientLights', 'creatures', 'skills', 'birds', 'winds', 'weathers'];

let problems = 0;
const fail = (m: string) => { console.log('  ✗ ' + m); problems++; };

// --- 1. integrity: walk every node, check $refs and x-registry names ---
function walk(f: FieldSchema, where: string): void {
  if (f.$ref) {
    if (!resolveRef(mapSchema, f.$ref)) fail(`${where}: unresolved $ref ${f.$ref}`);
    return; // the def itself is walked from $defs
  }
  const reg = f['x-registry'];
  if (reg && !VALID_REGISTRIES.includes(reg)) fail(`${where}: unknown x-registry "${reg}"`);
  if (f.properties) for (const [k, v] of Object.entries(f.properties)) walk(v, `${where}.${k}`);
  if (f.items) walk(f.items, `${where}[]`);
}
console.log('=== integrity ===');
for (const [k, v] of Object.entries(mapSchema.properties)) walk(v, k);
for (const [k, v] of Object.entries(mapSchema.$defs ?? {})) walk(v, `$defs.${k}`);
console.log(problems ? `  ${problems} problem(s)` : '  ✓ all $refs resolve, all x-registry names valid');

// --- 2. coverage: every field a real map carries should be described ---
//
// Any map the tree has, not a named one: this used to open
// `Maps/SingleMissions/12`, a map made by hand on one machine, so the check
// was hostage to a personal artifact and broke when it was cleaned up.
const sample = anyMap(dataRoot);
console.log(`\n=== coverage vs ${sample ?? '(no map found)'} ===`);
if (!sample) { console.log('  (no maps under the data root — skipping)'); process.exit(problems ? 1 : 0); }
const map = loadMap(readFileSync(sample, 'utf8'));
// `objects` is the map's placed content, not a setting — it has its own editor,
// so it is deliberately outside the properties schema.
const present = children(map.desc).map((c) => c.name).filter((n) => n !== 'objects');
const declared = new Set(Object.keys(mapSchema.properties));
const undeclared = present.filter((n) => !declared.has(n));
console.log(`  map has ${present.length} top-level fields; schema declares ${declared.size}`);
if (undeclared.length) console.log(`  not yet in schema (fall back to inference): ${undeclared.join(', ')}`);
else console.log('  ✓ every field the map carries is declared');

// --- 3. spot-check the control decisions the UI will make ---
console.log('\n=== controls (a few) ===');
for (const name of ['HeroMaxLevel', 'ReflectiveWater', 'spellIDs', 'AvailableHeroes', 'GroundAmbientLights', 'TileX', 'players', 'MapScript']) {
  const f = mapSchema.properties[name];
  if (!f) { fail(`sample field ${name} missing`); continue; }
  const d = deref(mapSchema, f);
  console.log(`  ${name.padEnd(20)} -> ${controlOf(d)}${d['x-registry'] ? ` (registry: ${d['x-registry']})` : ''}${d['x-tab'] ? ` [tab: ${d['x-tab']}]` : ''}`);
}

const coverageOk = undeclared.length === 0;
console.log(`\n${problems === 0 && coverageOk ? 'PASS' : 'FAIL'}`);
process.exit(problems === 0 && coverageOk ? 0 : 1);

// The game's type spec as the source for select boxes.
//
//   1. Parsing (needs game data): enums come out whole, count sentinels are
//      dropped, and a LIST field resolves through the anonymous array type to
//      the enum its items must come from.
//   2. The claim that matters (needs game data): every value the shipped maps
//      actually use is in the list we would offer. A dropdown that omits a
//      value the file holds is worse than no dropdown — it silently rewrites
//      the map on the next save. This is the check that earns the feature.
//   3. Drift: where our own schema also spells an enum out, it agrees with the
//      game's.
//
//   node tools/test-typespec.ts [dataRoot]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readTypeSpec, typesXmlPath, fieldValues, valuesAtPath, enums } from '../src/typespec.ts';
import { objectSchema, objectProps, deref } from '../src/schema.ts';
import { loadMap } from '../src/map.ts';
import { children, text } from '../src/xml.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.argv[2] ?? 'data-unpacked';
const specPath = typesXmlPath(dataRoot);
if (!specPath) {
  console.log(`(no types.xml under ${dataRoot} — skipping)`);
  process.exit(0);
}
const spec = readTypeSpec(specPath);

console.log('\nPARSING');
const all = enums(spec);
check('the spec declares enums', all.size > 50, `${all.size} enum types`);
check('MoonWeekID is whole', all.get('MoonWeekID')?.length === 126, `${all.get('MoonWeekID')?.length}`);
// MonsterMood has no sentinel; MonsterCourage ends with MONSTER_COURAGES_COUNT.
check('a count sentinel is dropped',
  fieldValues(spec, 'AdvMapMonster', 'Courage')?.length === 3
  && !fieldValues(spec, 'AdvMapMonster', 'Courage')!.some((v) => v.endsWith('_COUNT')),
  fieldValues(spec, 'AdvMapMonster', 'Courage')?.join(', '));
check('a value list is not truncated by it',
  fieldValues(spec, 'AdvMapMonster', 'Mood')?.length === 4, `${fieldValues(spec, 'AdvMapMonster', 'Mood')?.length}`);

// The point of reading the spec rather than the maps.
const attack = fieldValues(spec, 'AdvMapMonster', 'AttackType') ?? [];
check('a field with one value in every shipped map still offers its type’s set',
  attack.length === 3 && attack.includes('ATTACK_MELEE'), attack.join(', '));

// A list field points at an anonymous TYPE_TYPE_ARRAY whose element is the enum.
check('a list field resolves to its item enum',
  (fieldValues(spec, 'AdvMapDesc', 'spellIDs') ?? []).length > 300,
  `${fieldValues(spec, 'AdvMapDesc', 'spellIDs')?.length} spells`);
check('a nested field resolves by path',
  (valuesAtPath(spec, 'AdvMapSeerHut', ['Quest', 'Kind']) ?? []).includes('OBJECTIVE_KIND_MANUAL'));

console.log('\nAGREEMENT WITH OUR SCHEMA');
for (const type of Object.keys(objectSchema.types)) {
  for (const [name, raw] of Object.entries(objectProps(type))) {
    const f = deref(objectSchema, raw);
    if (!f.enum) continue;
    const theirs = fieldValues(spec, type, name);
    if (!theirs) continue;
    const missing = f.enum.filter((v) => !theirs.includes(v));
    check(`${type}.${name}`, missing.length === 0, missing.length ? `we list ${missing.join(', ')}, the game does not` : `${f.enum.length} of ${theirs.length}`);
  }
}

console.log('\nNO SHIPPED VALUE IS REFUSED');

/** Every map.xdb under the data root. */
function mapFiles(dir: string, out: string[] = []): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    const full = join(dir, e);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) mapFiles(full, out);
    else if (e === 'map.xdb') out.push(full);
  }
  return out;
}

const maps = mapFiles(join(dataRoot, 'Maps'));
if (!maps.length) {
  console.log('  (no maps to check against)');
} else {
  // What the maps actually hold, per type and field — the ground truth a
  // dropdown must never contradict.
  const used = new Map<string, Set<string>>();
  for (const file of maps) {
    let map;
    try { map = loadMap(readFileSync(file, 'latin1')); } catch { continue; }
    for (const obj of map.objects) {
      for (const c of children(obj.el)) {
        if (children(c).length) continue;
        const v = text(c).trim();
        if (!/^[A-Z][A-Z0-9_]{2,}$/.test(v)) continue; // only enum-shaped values
        const key = `${obj.type}.${c.name}`;
        if (!used.has(key)) used.set(key, new Set());
        used.get(key)!.add(v);
      }
    }
  }
  let checked = 0;
  const offenders: string[] = [];
  for (const [key, values] of used) {
    const [type, field] = key.split('.') as [string, string];
    const allowed = fieldValues(spec, type, field);
    if (!allowed) continue;
    checked++;
    const missing = [...values].filter((v) => !allowed.includes(v));
    if (missing.length) offenders.push(`${key}: ${missing.slice(0, 4).join(', ')}`);
  }
  check(`every value ${maps.length} shipped maps use is offered`, offenders.length === 0,
    offenders.length ? offenders.slice(0, 5).join(' | ') : `${checked} fields checked`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);


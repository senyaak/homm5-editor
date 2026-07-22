// Structured tree read/write test: values move by path, lists add/remove, and
// nothing else in the file shifts.
//
//   node tools/test-tree.ts [dataRoot]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadMap } from '../src/map.ts';
import { readTree, nodeAt, setPath, addStringItem, removeItem, appendItem, indentText, setList } from '../src/tree.ts';
import { mapSchema, resolveSchemaAtPath, deref } from '../src/schema.ts';
import { buildItem, isBuildable } from '../src/skeleton.ts';
import { children, find } from '../src/xml.ts';

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

const path = anyMap(dataRoot);
if (!path) { console.log('  (no maps under ' + dataRoot + ' — skipping)'); process.exit(0); }
let bad = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) bad++; };

const map = loadMap(readFileSync(path, 'utf8'));

// --- read: shape mirrors the XML ---
console.log('=== read ===');
const players = readTree(nodeAt(map.desc, ['players'])!);
ok(Array.isArray(players) && players.length === 8, 'players reads as a list of 8');
// What is asserted here is the SHAPE the tree reads, not a particular map's
// content: these lines used to pin `Race === 'TOWN_NO_TYPE'` and exactly 353
// spells, which is the content of one hand-made map and says nothing about
// readTree. Checked against the document itself instead, so any map works.
const p0 = readTree(nodeAt(map.desc, ['players', 0])!);
const race = typeof p0 === 'object' && !Array.isArray(p0) ? String((p0 as Record<string, unknown>).Race) : '';
ok(/^TOWN_[A-Z_]+$/.test(race), `players[0].Race reads as a race (${race})`);
const spells = readTree(nodeAt(map.desc, ['spellIDs'])!);
const spellItems = children(nodeAt(map.desc, ['spellIDs'])!).length;
ok(spellItems === 0
    ? !Array.isArray(spells) || spells.length === 0
    : Array.isArray(spells) && spells.length === spellItems && spells.every((s) => typeof s === 'string' && s.startsWith('SPELL_')),
   `spellIDs reads as ${spellItems} strings, matching the document`);

// --- set a nested leaf, surgically ---
console.log('\n=== set path ===');
const before = map.save();
ok(setPath(map.desc, ['players', 0, 'Race'], 'TOWN_HEAVEN'), 'set players[0].Race');
ok(setPath(map.desc, ['HeroMaxLevel'], '25'), 'set HeroMaxLevel');
const after = map.save();
ok(after.includes('<Race>TOWN_HEAVEN</Race>'), 'players[0].Race written');
ok(after.includes('<HeroMaxLevel>25</HeroMaxLevel>'), 'HeroMaxLevel written');
// exactly two lines changed
const diff = after.split('\n').filter((l, i) => l !== before.split('\n')[i]).length;
ok(diff === 2, `only the two edited lines changed (got ${diff})`);

// --- list add / remove ---
console.log('\n=== list edit ===');
const n0 = children(find(map.desc, 'spellIDs')!).length;
addStringItem(map.desc, ['spellIDs'], 'SPELL_MAGIC_ARROW');
const n1 = children(find(map.desc, 'spellIDs')!).length;
ok(n1 === n0 + 1, `add appends one Item (${n0} -> ${n1})`);
removeItem(map.desc, ['spellIDs', n1 - 1]);
const n2 = children(find(map.desc, 'spellIDs')!).length;
ok(n2 === n0, `remove drops it again (${n1} -> ${n2})`);

// add+remove round-trips to the original bytes (indentation preserved)
const roundtrip = map.save();
ok(roundtrip === after, 'add then remove leaves the file byte-identical');

// --- struct item built from the schema ---
console.log('\n=== struct item (schema-built) ===');
const moonsBefore = children(find(map.desc, 'moons')!).length;
{
  const arrField = resolveSchemaAtPath(mapSchema, ['moons']);
  const itemSchema = arrField?.items ? deref(mapSchema, arrField.items) : null;
  ok(isBuildable(itemSchema), 'moons item schema is buildable');
  const container = nodeAt(map.desc, ['moons'])!;
  appendItem(map.desc, ['moons'], buildItem(mapSchema, itemSchema!, indentText(container)));
}
const moonsAfter = children(find(map.desc, 'moons')!).length;
ok(moonsAfter === moonsBefore + 1, `moons grew by one (${moonsBefore} -> ${moonsAfter})`);
const newMoon = readTree(nodeAt(map.desc, ['moons', moonsAfter - 1])!) as Record<string, string>;
ok(newMoon.State === '0' && newMoon.RotationRate === '0', 'new moon has State=0, RotationRate=0');
// a rumour carries its schema defaults (Weight 100, TownType default)
{
  const arrField = resolveSchemaAtPath(mapSchema, ['MapRumours']);
  const itemSchema = arrField?.items ? deref(mapSchema, arrField.items) : null;
  const container = nodeAt(map.desc, ['MapRumours'])!;
  appendItem(map.desc, ['MapRumours'], buildItem(mapSchema, itemSchema!, indentText(container)));
  // The one just added, not index 0: a shipped map may already carry rumours.
  const last = children(find(map.desc, 'MapRumours')!).length - 1;
  const r = readTree(nodeAt(map.desc, ['MapRumours', last])!) as Record<string, string>;
  ok(r.Weight === '100' && r.TownType === 'TOWN_NO_TYPE', 'new rumour has Weight=100, TownType=TOWN_NO_TYPE');
  ok(r.Text === '', 'new rumour Text is empty (a ref href)');
}
// the map still round-trips through a reload (structure is well-formed)
ok(!!loadMap(map.save()), 'map with the new items reloads');

// --- setList: rewrite a value list wholesale (the checklist primitive) ---
console.log('\n=== setList ===');
setList(map.desc, ['spellIDs'], ['SPELL_MAGIC_ARROW', 'SPELL_FIREBALL', 'SPELL_HASTE']);
const sl = readTree(nodeAt(map.desc, ['spellIDs'])!);
ok(Array.isArray(sl) && sl.length === 3 && sl[1] === 'SPELL_FIREBALL', 'setList replaced spellIDs with 3');
setList(map.desc, ['spellIDs'], []);
const empt = children(find(map.desc, 'spellIDs')!).length;
ok(empt === 0, 'setList [] empties the list');
ok(!!loadMap(map.save()), 'map reloads after setList');

console.log(`\n${bad === 0 ? 'PASS' : `FAIL (${bad})`}`);
process.exit(bad === 0 ? 0 : 1);

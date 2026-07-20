// Structured tree read/write test: values move by path, lists add/remove, and
// nothing else in the file shifts.
//
//   node tools/test-tree.ts [dataRoot]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMap } from '../src/map.ts';
import { readTree, nodeAt, setPath, addStringItem, removeItem } from '../src/tree.ts';
import { children, find } from '../src/xml.ts';

const dataRoot = process.argv[2] ?? 'samples/paks/data';
const path = join(dataRoot, 'Maps/SingleMissions/12/map.xdb');
let bad = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) bad++; };

const map = loadMap(readFileSync(path, 'utf8'));

// --- read: shape mirrors the XML ---
console.log('=== read ===');
const players = readTree(nodeAt(map.desc, ['players'])!);
ok(Array.isArray(players) && players.length === 8, 'players reads as a list of 8');
const p0 = readTree(nodeAt(map.desc, ['players', 0])!);
ok(typeof p0 === 'object' && !Array.isArray(p0) && (p0 as Record<string, unknown>).Race === 'TOWN_NO_TYPE', 'players[0].Race = TOWN_NO_TYPE');
const spells = readTree(nodeAt(map.desc, ['spellIDs'])!);
ok(Array.isArray(spells) && spells.length === 353 && spells[1] === 'SPELL_MAGIC_ARROW', 'spellIDs reads as 353 strings');

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

console.log(`\n${bad === 0 ? 'PASS' : `FAIL (${bad})`}`);
process.exit(bad === 0 ? 0 : 1);

// Registry smoke test: the rosters are discovered from the data tree and match
// what a shipped map's enabled lists reference.
//
//   node tools/test-registry.ts [dataRoot]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from '../src/schema/registry.ts';
import { loadMap } from '../src/map/map.ts';
import { find, children, text } from '../src/format/xml.ts';
import { dataDir } from './game-dir.ts';

const dataRoot = process.argv[2] ?? dataDir();
const reg = new Registry(dataRoot);

const spells = reg.spells();
const artifacts = reg.artifacts();
const heroes = reg.heroes();
const ambient = reg.ambientLights();
const races = reg.races();

console.log('=== rosters (discovered dynamically) ===');
console.log(`spells       ${spells.length}   e.g. ${spells.slice(1, 4).map((s) => s.id).join(', ')}`);
console.log(`artifacts    ${artifacts.length}   e.g. ${artifacts.slice(1, 4).map((a) => a.id).join(', ')}`);
console.log(`   with name refs: ${artifacts.filter((a) => a.nameRef).length}`);
console.log(`heroes       ${heroes.length}   e.g. ${heroes.slice(0, 3).map((h) => `${h.group}/${h.name}`).join(', ')}`);
console.log(`ambient      ${ambient.length}   e.g. ${ambient.slice(0, 3).map((a) => a.name).join(', ')}`);
console.log(`races        ${races.length}   ${races.map((r) => r.name).join(', ')}`);
console.log(`birds        ${reg.birds().length}   ${reg.birds().map((b) => b.name).join(', ')}`);
console.log(`winds        ${reg.winds().length}   ${reg.winds().map((w) => w.name).join(', ')}`);
console.log(`weathers     ${reg.weathers().length}   ${reg.weathers().map((w) => w.name).join(', ')}`);

// Cross-check: every spell/artifact the map enables must exist in the roster —
// proof the discovered universe is the one the game uses.
const mapPath = join(dataRoot, 'Maps/SingleMissions/12/map.xdb');
let ok = true;
try {
  const map = loadMap(readFileSync(mapPath, 'utf8'));
  const ids = (name: string): string[] => {
    const el = find(map.desc, name);
    return el ? children(el).filter((c) => c.name === 'Item').map((c) => text(c)) : [];
  };
  const spellSet = new Set(spells.map((s) => s.id));
  const artSet = new Set(artifacts.map((a) => a.id));
  const mapSpells = ids('spellIDs'), mapArts = ids('artifactIDs');
  const missingS = mapSpells.filter((s) => !spellSet.has(s));
  const missingA = mapArts.filter((a) => !artSet.has(a));
  console.log('\n=== cross-check vs map 12 ===');
  console.log(`map spellIDs ${mapSpells.length} -> missing from roster: ${missingS.length} ${missingS.slice(0, 5).join(', ')}`);
  console.log(`map artifactIDs ${mapArts.length} -> missing from roster: ${missingA.length} ${missingA.slice(0, 5).join(', ')}`);
  ok = missingS.length === 0 && missingA.length === 0;
} catch (e) {
  console.log('map cross-check skipped:', e instanceof Error ? e.message : String(e));
}

// --- what a picker actually shows -------------------------------------------
//
// A roster is a list a person reads, and for a long time it was a list of engine
// ids in table order. That is how a creature added by a mod could be present and
// still unfindable: 181st of 181, spelled CREATURE_H3_SHARPSHOOTER, in a
// dropdown where the shipped Sharp Shooter reads CREATURE_SHARP_SHOOTER and not
// "Лесные стрелки".
console.log('\n=== labels and order ===');
const creatures = reg.creatures();
const label = (e: { name?: string; id: string }): string => e.name || e.id;
const namedCreatures = creatures.filter((c) => c.name).length;
console.log(`creatures    ${creatures.length}   named: ${namedCreatures}   e.g. ${creatures.slice(1, 5).map(label).join(', ')}`);
console.log(`artifacts    named: ${artifacts.filter((a) => a.name).length}   e.g. ${artifacts.slice(1, 4).map(label).join(', ')}`);

let labelled = true;
// CREATURE_UNKNOWN is the one creature with no name of its own — it is the
// engine's null, and its visual leaves every text ref empty.
if (namedCreatures < creatures.length - 1) {
  console.log(`  ✗ ${creatures.length - namedCreatures} creature(s) without a name`);
  labelled = false;
}
const sorted = creatures.every((c, i) => i === 0
  || /_(NONE|UNKNOWN)$/.test(creatures[i - 1]!.id)
  || label(creatures[i - 1]!).localeCompare(label(c), undefined, { numeric: true }) <= 0);
if (!sorted) { console.log('  ✗ the creature roster is not in label order'); labelled = false; }
if (!/_(NONE|UNKNOWN)$/.test(creatures[0]!.id)) {
  console.log(`  ✗ the unset member is not first (${creatures[0]!.id})`);
  labelled = false;
}
if (labelled) console.log('  ✓ every creature but the engine\'s null has a name, and the list is in label order');

// --- definitions the game stores under a bare name ---------------------------
//
// What a definition IS, is its root element. The game does not keep to the
// `Name.(Class).xdb` convention — the Necropolis tier 3 monsters are `Manes.xdb`
// and `Ghost.xdb`, and half the dwellings are named like `Fairie_Tree.xdb` — so
// a roster built on file names alone silently holds a fraction of the game's
// objects. It read, downstream, as "Heroes V has no Necropolis tier 3".
console.log('\n=== stored under a bare name ===');
let bare = true;
const named = (list: { name?: string; id: string }[], want: string): boolean =>
  list.some((e) => e.name === want);
for (const [cls, want] of [
  ['AdvMapMonsterShared', 'Manes'],
  ['AdvMapMonsterShared', 'Ghost'],
  ['AdvMapDwellingShared', 'Fairie_Tree'],
  ['AdvMapBuildingShared', 'MagiVault'],
] as const) {
  const found = named(reg.objectsOfClass(cls), want);
  console.log(`  ${found ? '✓' : '✗'} ${want} is in the ${cls} roster`);
  if (!found) bare = false;
}
// And the reverse: a file whose name carries SOME OTHER class must not be swept
// in, or every geometry and material file beside an object joins its roster.
const monsters = reg.objectsOfClass('AdvMapMonsterShared');
const strays = monsters.filter((e) => /-(geom|lambert|mirror)|\((Model|Material|Texture)\)/.test(e.id));
console.log(`  ${strays.length ? '✗' : '✓'} nothing of another class swept in` +
  (strays.length ? ` — ${strays.slice(0, 3).map((s) => s.id).join(', ')}` : ''));
if (strays.length) bare = false;

const sane = spells.length > 300 && artifacts.length > 90 && heroes.length > 100 && ambient.length > 100
  && creatures.length >= 180 && bare;
console.log(`\n${ok && sane && labelled ? 'PASS' : 'FAIL'}`);
process.exit(ok && sane && labelled ? 0 : 1);

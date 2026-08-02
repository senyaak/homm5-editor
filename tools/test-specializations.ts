// Validates a specialization of our own — the enum entry, and the term behind it.
//
// A specialization is two halves that have to agree, and this checks both plus
// the seam between them:
//
//   the DATA — one entry appended to the `HeroSpecialization` enum in
//     types.xml, and nothing else moved. There is no table to extend and no
//     size to retune, which is the whole reason it is cheap; the check is that
//     the patch keeps that promise and that the game's own parser would still
//     read the file (asked of our type-spec reader, which is the same shape).
//   the WORDS — they live on the HERO in this game, not with the
//     specialization, so a hero holding ours must come out of the build
//     carrying its name, description and icon as files of his own.
//   the TERM — the line in the file the native extension reads, which is the
//     only place a value the executable never heard of turns into an effect.
//
//   node tools/test-specializations.ts [dataRoot]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addHero, addSpecialization, newCreatureMod, removeSpecialization } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { heroPaths } from '../src/mods/heroes.ts';
import type { HeroSpec } from '../src/mods/heroes.ts';
import {
  LAST_SHIPPED_SPECIALIZATION, SHIPPED_SPECIALIZATIONS, SPECIALIZATION_TYPE,
  patchSpecializationTypes, takenSpecializations,
} from '../src/mods/specializations.ts';
import type { SpecializationSpec } from '../src/mods/specializations.ts';
import {
  readEffects, readSpecializations, specializationRowsOf, writeEffects,
} from '../src/mods/artifact-effects.ts';
import { parseTypeSpec } from '../src/schema/typespec.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const REPO = join(import.meta.dirname, '..');
const dataRoot = process.argv[2] ?? process.env.HOMM5_DATA ?? join(REPO, 'data-unpacked');
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const types = readFileSync(join(dataRoot, 'types.xml'), 'utf8');

/** Heroes III's Gem: the specialization this whole slice exists to make. */
const FIRST_AID: SpecializationSpec = {
  id: 'HERO_SPEC_H3_FIRST_AID',
  name: 'First Aid',
  description: 'The first aid tent is five percent stronger for every level of the hero.',
  picture: join(REPO, 'assets', 'specializations', 'first_aid.gif'),
  effect: { stat: 'tent', percentPerLevel: 5 },
};

// ---- 1. what the game already has -------------------------------------------

console.log('the shipped enum');

const shipped = takenSpecializations(types);
check(`the game declares ${SHIPPED_SPECIALIZATIONS} specializations`,
  shipped.size === SHIPPED_SPECIALIZATIONS, `${shipped.size} found`);
check('...ending at the one we append after',
  shipped.has(LAST_SHIPPED_SPECIALIZATION) && types.includes(`<Name>${LAST_SHIPPED_SPECIALIZATION}</Name>`));
check('...and the enum declares no size, which is why a new one is cheap', (() => {
  const at = types.indexOf(`<TypeName>${SPECIALIZATION_TYPE}</TypeName>`);
  const decl = types.slice(at, types.indexOf('</Entries>', at));
  return !decl.includes('MaxElements') && !decl.includes('MinElements');
})());

// ---- 2. the patch -----------------------------------------------------------

console.log('\nthe enum, patched');

const mod = newCreatureMod();
const ours = addSpecialization(mod, FIRST_AID, shipped);
check('ours takes the first value after the shipped ones', ours.number === SHIPPED_SPECIALIZATIONS,
  String(ours.number));

const patched = patchSpecializationTypes(types, [ours]);
check('the entry is there, with its value',
  patched.includes(`<Name>${FIRST_AID.id}</Name>`) && patched.includes(`<Value>${ours.number}</Value>`));
check('it follows the last shipped one', (() => {
  const last = patched.indexOf(`<Name>${LAST_SHIPPED_SPECIALIZATION}</Name>`);
  const mine = patched.indexOf(`<Name>${FIRST_AID.id}</Name>`);
  // Nothing but the closing tags of the entry it follows may come between them.
  return mine > last && !patched.slice(last + 1, mine).includes('<Name>');
})());
check('and it is inside the enum, not after it',
  patched.indexOf(`<Name>${FIRST_AID.id}</Name>`)
  < patched.indexOf('</Entries>', patched.indexOf(`<TypeName>${SPECIALIZATION_TYPE}</TypeName>`)));

// Nothing else moved. A patch that reflows the file is a patch nobody can
// review, and this one is four lines by construction.
check('only the four lines of the entry are added',
  patched.split('\n').length === types.split('\n').length + 4,
  `${patched.split('\n').length - types.split('\n').length} lines`);
check('every other enum is untouched',
  patched.replace(/[\s\S]*?<\/Entries>/, '').length > 0
  && types.split('<TypeName>').length === patched.split('<TypeName>').length);

// And it is still a file the reader can parse — the closest thing we have to
// asking the game, and the same shape of parser.
const spec = parseTypeSpec(patched);
const members = spec.get(SPECIALIZATION_TYPE)?.members ?? [];
check('the type spec reads it back, one longer',
  members.length === SHIPPED_SPECIALIZATIONS + 1 && members.includes(FIRST_AID.id),
  `${members.length} members`);
check('...with ours last', members[members.length - 1] === FIRST_AID.id);

// ---- 3. what the model refuses ----------------------------------------------

console.log('\nwhat is refused');

check('a name the game already uses', (() => {
  try { addSpecialization(mod, { ...FIRST_AID, id: 'HERO_SPEC_EMPIRIC' }, shipped); return false; } catch { return true; }
})());
check('the same one twice', (() => {
  try { addSpecialization(mod, FIRST_AID, shipped); return false; } catch { return true; }
})());
check('an id that is not one', (() => {
  try { addSpecialization(mod, { ...FIRST_AID, id: 'first aid' }, shipped); return false; } catch { return true; }
})());
check('a nameless one', (() => {
  try { addSpecialization(mod, { ...FIRST_AID, id: 'HERO_SPEC_X', name: '  ' }, shipped); return false; } catch { return true; }
})());

// ---- 4. the hero who holds it -----------------------------------------------

console.log('\nthe hero holding it');

const GEM: HeroSpec = {
  id: 'H3Gem',
  name: 'Gem',
  biography: 'A sorceress of Enroth, newly come to AvLee.',
  basedOn: 'MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb',
  town: 'TOWN_PRESERVE',
  heroClass: 'HERO_CLASS_RANGER',
  specialization: FIRST_AID.id,
  skills: [{ skill: 'HERO_SKILL_WAR_MACHINES', mastery: 'MASTERY_BASIC' }],
  machines: { firstAidTent: true },
};
addHero(mod, GEM);

const files = buildCreatureMod(mod, dataReader(dataRoot)).files;
const paths = files.map((f) => f.path);
const p = heroPaths(GEM);
const heroXml = files.find((f) => f.path === p.shared)!.data.toString('latin1');

check('his document names our specialization', heroXml.includes(`<Specialization>${FIRST_AID.id}</Specialization>`));
// The words live on the HERO, so a specialization of ours has to reach them —
// otherwise every hero holding it would have to be told what it is called, and
// a hero who was not told shows the words of whoever the donor borrowed from.
const specName = files.find((f) => f.path === p.specName);
const specDesc = files.find((f) => f.path === p.specDescription);
check('its name became his file', !!specName && specName.data.toString('utf16le').slice(1) === FIRST_AID.name);
check('its description too',
  !!specDesc && specDesc.data.toString('utf16le').slice(1) === FIRST_AID.description);
check('its picture became his icon texture', paths.includes(p.specIconDDS) && paths.includes(p.specIconXDB));
check('and the document points at that icon',
  heroXml.includes(`<SpecializationIcon href="/${p.specIconXDB}#xpointer(/Texture)"/>`),
  /<SpecializationIcon href="([^"]*)"/.exec(heroXml)?.[1]);

// A hero with words of his own keeps them: the specialization is a default, and
// two heroes may describe one differently — which is what the shipped data does
// in reverse, a Sylvan hero described as a Necropolis embalmer.
const own = newCreatureMod();
addSpecialization(own, FIRST_AID, shipped);
addHero(own, { ...GEM, specializationName: 'Field Surgery' });
const ownFiles = buildCreatureMod(own, dataReader(dataRoot)).files;
check("a hero's own words win over the specialization's",
  ownFiles.find((f) => f.path === p.specName)!.data.toString('utf16le').slice(1) === 'Field Surgery');

check('the mod carries types.xml, which a heroes-only one does not', paths.includes('types.xml'));
check('...and nothing else of the game\'s', (() => {
  const shippedFiles = paths.filter((f) => existsSync(join(dataRoot, f)));
  return shippedFiles.length === 1 && shippedFiles[0] === 'types.xml';
})(), paths.filter((f) => existsSync(join(dataRoot, f))).join(', '));

// ---- 5. removal -------------------------------------------------------------

console.log('\ntaking one away');

check('one a hero still holds is refused', (() => {
  try { removeSpecialization(mod, FIRST_AID.id); return false; } catch { return true; }
})());
check('...and the message names him', (() => {
  try { removeSpecialization(mod, FIRST_AID.id); return false; } catch (e) { return String(e).includes('H3Gem'); }
})());
const free = newCreatureMod();
addSpecialization(free, FIRST_AID, shipped);
addSpecialization(free, { ...FIRST_AID, id: 'HERO_SPEC_H3_LOGISTICS', name: 'Logistics' }, shipped);
removeSpecialization(free, FIRST_AID.id);
check('one nobody holds goes, and the values close up behind it',
  free.specializations!.length === 1 && free.specializations![0]!.number === SHIPPED_SPECIALIZATIONS,
  String(free.specializations![0]!.number));

// ---- 6. the term the extension reads ----------------------------------------

console.log('\nthe term');

const rows = specializationRowsOf([ours]);
check('a specialization with an effect makes one row',
  rows.length === 1 && rows[0]!.specialization === ours.number && rows[0]!.percentPerLevel === 5);
check('one without an effect makes none — words and a picture are a real thing to want',
  specializationRowsOf([{ id: 'HERO_SPEC_X', number: 90 }]).length === 0);

const text = writeEffects([{ stat: 'necromancy', artifacts: [97], threshold: 1, amount: 30 }], rows);
check('the file says it in the grammar the extension parses',
  /^tent specialization 84 5(\s|$)/m.test(text), text.split('\r\n').find((l) => l.startsWith('tent')));
check('it reads back', (() => {
  const back = readSpecializations(text);
  return back.length === 1 && back[0]!.stat === 'tent' && back[0]!.specialization === 84
    && back[0]!.percentPerLevel === 5;
})());
// Two grammars in one file, and each reader has to leave the other's lines
// alone — the artifact reader seeing a specialization row as an artifact one is
// how a bonus lands on the wrong thing.
check('the artifact reader ignores it', readEffects(text).length === 1);
check('and the specialization reader ignores artifact rows',
  readSpecializations(writeEffects([{ stat: 'energy', artifacts: [97, 98], threshold: 2, amount: 150 }])).length === 0);

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);

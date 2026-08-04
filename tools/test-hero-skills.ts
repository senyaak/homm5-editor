// Validates a skill of our own — a racial and the perks of its branch.
//
// Measured against the shipped table throughout: a racial has the Avenger's
// shape, the first perk of a branch has Multishot's — narrowed to one class by
// the `HeroClass` field, asking for nothing else — and a perk further along has
// the plague tent's, with a class and the perks it wants before it. The count
// the code believes in is counted rather than trusted.
//
//   node tools/test-hero-skills.ts [dataRoot]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHIPPED_SKILLS, SKILL_TABLE, patchSkillTable, patchSkillTypes, skillProblems, skillTexts, takenSkills,
} from '../src/mods/hero-skills.ts';
import type { ModHeroSkill } from '../src/mods/hero-skills.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const REPO = join(import.meta.dirname, '..');
const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = (rel: string): string => readFileSync(join(dataRoot, rel), 'latin1');
const types = read('types.xml');
const table = read(SKILL_TABLE);

/** Gem's racial: the tent, and one more use of it per level of mastery. */
const TENT: ModHeroSkill = {
  id: 'HERO_SKILL_TENT_MASTER',
  number: SHIPPED_SKILLS,
  kind: 'racial',
  heroClass: 'HERO_CLASS_WITCH',
  name: 'Мастер палатки',
  names: ['Мастер палатки', 'Опытный мастер палатки', 'Искусный мастер палатки', 'Великий мастер палатки'],
  description: 'Палатка первой помощи может быть использована на один раз больше.',
  descriptions: [1, 2, 3, 4].map((n) => `Палатка первой помощи может быть использована на ${n} раз(а) больше.`),
  commonDescription: 'Каждый уровень мастерства добавляет палатке первой помощи одно использование.',
  aiRace: 'Sylvan',
};

/** The first perk of that branch: holding the branch is all it asks. */
const CLEANSE: ModHeroSkill = {
  id: 'HERO_SKILL_TENT_CLEANSING',
  number: SHIPPED_SKILLS + 1,
  kind: 'perk',
  heroClass: 'HERO_CLASS_WITCH',
  basicSkill: TENT.id,
  name: 'Целебные травы',
  description: 'Палатка первой помощи снимает с отряда отрицательные эффекты.',
};

/** And one further along, which does name a perk before it. */
const BREW: ModHeroSkill = {
  ...CLEANSE,
  id: 'HERO_SKILL_TENT_BREW',
  number: SHIPPED_SKILLS + 2,
  prerequisites: [CLEANSE.id],
  name: 'Целебный настой',
};

// --- what the shipped table says -----------------------------------------------

{
  const ids = [...table.matchAll(/<ID>(HERO_SKILL_\w+)<\/ID>/g)].map((m) => m[1]!);
  check('the table holds the count the code expects', ids.length === SHIPPED_SKILLS, `${ids.length}`);
  check('and types.xml declares as many', takenSkills(types).size === SHIPPED_SKILLS, `${takenSkills(types).size}`);
  check('ours are not among them', !takenSkills(types).has(TENT.id) && !takenSkills(types).has(CLEANSE.id));

  // Eight racials, each naming its class — the only place that binding exists.
  const racials = [...table.matchAll(/<SkillType>SKILLTYPE_SKILL<\/SkillType>\s*<HeroClass>(HERO_CLASS_\w+)</g)]
    .map((m) => m[1]!).filter((c) => c !== 'HERO_CLASS_NONE');
  check('the game binds exactly eight racials to a class', racials.length === 8, `${racials.length}`);
}

// --- refusals -------------------------------------------------------------------

{
  check('the tent master is well formed', skillProblems(TENT).length === 0, skillProblems(TENT).join('; '));
  check('and so is its perk', skillProblems(CLEANSE).length === 0, skillProblems(CLEANSE).join('; '));
  check('a perk with no branch is refused',
    skillProblems({ ...CLEANSE, basicSkill: undefined }).some((p) => p.includes('branch')));
  check('a racial with three icons is refused',
    skillProblems({ ...TENT, icons: ['a', 'b', 'c'] }).some((p) => p.includes('4 icons')));
  check('a name that is not an identifier is refused',
    skillProblems({ ...TENT, id: 'TENT_MASTER' }).some((p) => p.includes('identifier')));
}

// --- types.xml -------------------------------------------------------------------

{
  const t = patchSkillTypes(types, [TENT, CLEANSE, BREW]);
  check('the enum gains both', t.includes(`<Item>${TENT.id}</Item>`) && t.includes(`<Item>${CLEANSE.id}</Item>`));
  check('numbered after the shipped ones',
    new RegExp(`<Name>${TENT.id}</Name>\\s*<Value>${SHIPPED_SKILLS}</Value>`).test(t));
  const at = t.indexOf('<TypeName>Table_HeroSkill_SkillID</TypeName>');
  const decl = t.slice(at, at + 4000);
  check('and the table is declared three longer', decl.includes('<Data>224</Data>')
    && decl.includes('<MinElements>224</MinElements>') && decl.includes('<MaxElements>224</MaxElements>'));
}

// --- the table --------------------------------------------------------------------

{
  const t = patchSkillTable(table, [TENT, CLEANSE, BREW]);
  const ids = [...t.matchAll(/<ID>(HERO_SKILL_\w+)<\/ID>/g)].map((m) => m[1]!);
  check('the table gains exactly three', ids.length === SHIPPED_SKILLS + 3, `${ids.length}`);

  const ours = fieldsOf(entryOf(t, TENT.id));
  const avenger = fieldsOf(entryOf(table, 'HERO_SKILL_AVENGER'));
  check('a racial of ours has the Avenger\'s fields, in order', ours.join(',') === avenger.join(','),
    ours.join(',') === avenger.join(',') ? '' : `${ours.join(',')} vs ${avenger.join(',')}`);

  // Multishot: the first perk of a racial branch, narrowed to one class by the
  // `HeroClass` field and asking for nothing else.
  const perk = fieldsOf(entryOf(t, CLEANSE.id));
  const multishot = fieldsOf(entryOf(table, 'HERO_SKILL_MULTISHOT'));
  check('a first perk of ours has Multishot\'s fields, in order', perk.join(',') === multishot.join(','),
    perk.join(',') === multishot.join(',') ? '' : `${perk.join(',')} vs ${multishot.join(',')}`);
  check('and asks for nothing beyond the branch', entryOf(t, CLEANSE.id).includes('<SkillPrerequisites/>'));

  // And one that does ask, in the plague tent's shape: a class, and perks under it.
  const later = fieldsOf(entryOf(t, BREW.id));
  const plague = fieldsOf(entryOf(table, 'HERO_SKILL_LAST_AID'));
  // It lists four classes and ours lists one, so the repeated pair is folded.
  const gate = (f: string[]): string => f.join(',').replace(/(Class,dependenciesIDs,)+/, '$1');
  check('a later perk has the plague tent\'s fields, in order',
    gate(later) === gate(plague), gate(later) === gate(plague) ? '' : `${gate(later)} vs ${gate(plague)}`);
  check('with its own class in the gate',
    new RegExp(`<Class>${BREW.heroClass}</Class>\\s*<dependenciesIDs>\\s*<Item>${CLEANSE.id}</Item>`)
      .test(entryOf(t, BREW.id)));
  check('and the branch itself is refused as a prerequisite',
    skillProblems({ ...BREW, prerequisites: [TENT.id] }).some((p) => p.includes('the branch itself')));

  const tent = entryOf(t, TENT.id);
  check('the racial names its class', tent.includes(`<HeroClass>${TENT.heroClass}</HeroClass>`));
  check('and is a SKILLTYPE_SKILL with no branch above it',
    tent.includes('<SkillType>SKILLTYPE_SKILL</SkillType>')
    && tent.includes('<BasicSkillID>HERO_SKILL_NONE</BasicSkillID>'));
  // Five icon slots for four levels: the first is MASTERY_NONE, exactly as the
  // shipped racials carry it.
  const slots = (tent.match(/<Item(\s+href="[^"]*")?\/>/g) ?? []).length;
  check('five icon slots, the first empty', tent.includes('<Item/>')
    && (entryOf(t, TENT.id).match(/<Texture>([\s\S]*?)<\/Texture>/)![1]!.match(/<Item/g) ?? []).length === 5,
    `${slots}`);
  check('four names and four descriptions',
    (tent.match(/<NameFileRef>([\s\S]*?)<\/NameFileRef>/)![1]!.match(/<Item/g) ?? []).length === 4);

  const cleanse = entryOf(t, CLEANSE.id);
  check('the perk hangs off the racial', cleanse.includes(`<BasicSkillID>${TENT.id}</BasicSkillID>`));
  check('and is narrowed to our class by the field the shipped ones use',
    cleanse.includes('<HeroClass>HERO_CLASS_WITCH</HeroClass>'));

  let refused = false;
  try { patchSkillTable(t, [TENT]); } catch { refused = true; }
  check('patching an already-patched table is refused', refused);
}

// --- the words --------------------------------------------------------------------

{
  const texts = skillTexts(TENT);
  check('a racial writes four names, four descriptions and the common one', texts.length === 9, `${texts.length}`);
  const names = texts.filter((f) => f.path.endsWith('Name.txt')).map((f) => f.text);
  check('and the four names differ', new Set(names).size === 4, names.join(' / '));
  const auto = skillTexts({ ...TENT, names: undefined }).filter((f) => f.path.endsWith('Name.txt')).map((f) => f.text);
  check('even when only one name was given', new Set(auto).size === 4, auto.join(' / '));
  check('a perk writes one of each', skillTexts(CLEANSE).length === 2);
}

/** One skill's `<Item>`, from `<Item>` to the end of its `</obj>`. */
function entryOf(text: string, id: string): string {
  const at = text.indexOf(`<ID>${id}</ID>`);
  const start = text.lastIndexOf('<Item>', at);
  const end = text.indexOf('</obj>', at);
  return text.slice(start, end);
}

/** The record's own field names, in the order they are written. */
function fieldsOf(entry: string): string[] {
  const obj = entry.slice(entry.indexOf('<obj>'));
  return [...obj.matchAll(/^\t*<(\w+)[ />]/gm)].map((m) => m[1]!).filter((n) => n !== 'Item');
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);

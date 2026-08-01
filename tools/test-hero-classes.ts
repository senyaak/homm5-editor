// Validates a hero class of our own, against the game's own nine.
//
// A class is a reference table entry with a declared size, so what can go wrong
// is not "does it look right" but "did every declaration of the size move
// together". The checks are measured against the SHIPPED data throughout: the
// regularity the nine classes hold to (thirteen weights summing to a hundred,
// four attributes summing to a hundred) is the specification, and the perk gate
// is read out of the shipped `HERO_SKILL_LAST_AID` rather than described here.
//
//   node tools/test-hero-classes.ts [dataRoot]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLASS_TABLE, SHIPPED_CLASSES, SKILL_TABLE, TOTAL, classNameFile, classProblems,
  defaultDependencies, patchClassTable, patchClassTypes, patchSkillPrerequisites, takenClasses,
} from '../src/mods/hero-classes.ts';
import type { ModHeroClass } from '../src/mods/hero-classes.ts';

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
const read = (rel: string): string => readFileSync(join(dataRoot, rel), 'latin1');
const types = read('types.xml');
const table = read(CLASS_TABLE);
const skills = read(SKILL_TABLE);

/** The Witch: Gem's class in Heroes III, and the reason this exists. */
const WITCH: ModHeroClass = {
  id: 'HERO_CLASS_WITCH',
  name: 'Колдунья',
  number: SHIPPED_CLASSES,
  attributes: { offence: 10, defence: 25, spellpower: 35, knowledge: 30 },
  skills: [
    { skill: 'HERO_SKILL_TENT_MASTER', prob: 10 },
    { skill: 'HERO_SKILL_WAR_MACHINES', prob: 15 },
    { skill: 'HERO_SKILL_LIGHT_MAGIC', prob: 12 },
    { skill: 'HERO_SKILL_LEARNING', prob: 12 },
    { skill: 'HERO_SKILL_LUCK', prob: 10 },
    { skill: 'HERO_SKILL_LOGISTICS', prob: 8 },
    { skill: 'HERO_SKILL_SUMMONING_MAGIC', prob: 8 },
    { skill: 'HERO_SKILL_SORCERY', prob: 8 },
    { skill: 'HERO_SKILL_LEADERSHIP', prob: 6 },
    { skill: 'HERO_SKILL_DEFENCE', prob: 5 },
    { skill: 'HERO_SKILL_DESTRUCTIVE_MAGIC', prob: 3 },
    { skill: 'HERO_SKILL_DARK_MAGIC', prob: 2 },
    { skill: 'HERO_SKILL_OFFENCE', prob: 1 },
  ],
  preferredSpells: ['SPELL_RESURRECT', 'SPELL_REGENERATION'],
  // The perk the Ranger cannot have: «Чумная палатка», open to four classes and
  // now to a fifth.
  allowedPerks: [{ perk: 'HERO_SKILL_LAST_AID', dependencies: ['HERO_SKILL_FIRST_AID'] }],
};

// --- what the shipped nine agree on -------------------------------------------

{
  const ids = [...table.matchAll(/<ID>(HERO_CLASS_\w+)<\/ID>/g)].map((m) => m[1]!);
  check('the table holds the nine the code expects', ids.length === SHIPPED_CLASSES, `${ids.length}`);
  check('and types.xml declares the same names', takenClasses(types).size === SHIPPED_CLASSES,
    `${takenClasses(types).size}`);
  check('ours is not among them', !takenClasses(types).has(WITCH.id));

  // The regularity the form will hold authors to, checked against the source of
  // it rather than asserted: every class but NONE sums to a hundred, twice.
  let regular = 0;
  for (const block of table.split('<ID>').slice(1)) {
    const id = block.slice(0, block.indexOf('<'));
    if (id === 'HERO_CLASS_NONE') continue;
    const probs = [...block.matchAll(/<Prob>(\d+)<\/Prob>/g)].map((m) => +m[1]!);
    const a = /<OffenceProb>(\d+)[\s\S]*?<DefenceProb>(\d+)[\s\S]*?<SpellpowerProb>(\d+)[\s\S]*?<KnowledgeProb>(\d+)/
      .exec(block)!;
    const attrs = [+a[1]!, +a[2]!, +a[3]!, +a[4]!].reduce((x, y) => x + y, 0);
    if (probs.length === 13 && probs.reduce((x, y) => x + y, 0) === TOTAL && attrs === TOTAL) regular++;
  }
  check('all eight real classes are thirteen weights of a hundred, and a hundred of attributes',
    regular === SHIPPED_CLASSES - 1, `${regular} of ${SHIPPED_CLASSES - 1}`);
}

// --- what the class of ours must satisfy ---------------------------------------

{
  check('the Witch is well formed', classProblems(WITCH).length === 0, classProblems(WITCH).join('; '));
  const short = classProblems({ ...WITCH, skills: WITCH.skills.slice(1) });
  check('weights that miss a hundred are refused', short.some((p) => p.includes('add up to 90')), short.join('; '));
  const attrs = classProblems({ ...WITCH, attributes: { offence: 1, defence: 1, spellpower: 1, knowledge: 1 } });
  check('and so are attributes that do', attrs.some((p) => p.includes('add up to 4')), attrs.join('; '));
  const twice = classProblems({ ...WITCH, skills: [...WITCH.skills, { skill: 'HERO_SKILL_LUCK', prob: 0 }] });
  check('a skill weighted twice is caught', twice.some((p) => p.includes('twice')));
}

// --- types.xml -----------------------------------------------------------------

{
  const t = patchClassTypes(types, [WITCH]);
  check('the enum list gains it', t.includes(`<Item>${WITCH.id}</Item>`));
  check('the name→number map gains it', /<Name>HERO_CLASS_WITCH<\/Name>\s*<Value>9<\/Value>/.test(t));
  // Inside the enum, not merely somewhere in a forty-thousand-line file.
  const at = t.indexOf('<TypeName>HeroClass</TypeName>');
  const named = t.indexOf(`<Name>${WITCH.id}</Name>`, at);
  check('and inside the HeroClass enum', named > at && named < t.indexOf('</Entries>', at));

  const tableAt = t.indexOf('<TypeName>Table_HeroClassDesc_HeroClass</TypeName>');
  const decl = t.slice(tableAt, tableAt + 4000);
  check('ref_table_num_objs is retuned', decl.includes('<Data>10</Data>'));
  check('MinElements and MaxElements too',
    decl.includes('<MinElements>10</MinElements>') && decl.includes('<MaxElements>10</MaxElements>'));
  check('and nothing else in the file moved',
    t.length > types.length && t.replace(/HERO_CLASS_WITCH/g, '').length > types.length - 200);
}

// --- the table itself -----------------------------------------------------------

{
  const t = patchClassTable(table, [WITCH]);
  const ids = [...t.matchAll(/<ID>(HERO_CLASS_\w+)<\/ID>/g)].map((m) => m[1]!);
  check('the table gains exactly one entry', ids.length === SHIPPED_CLASSES + 1, `${ids.length}`);
  check('and it is last', ids[ids.length - 1] === WITCH.id);

  const block = t.slice(t.indexOf(`<ID>${WITCH.id}</ID>`));
  check('it points at its own name file', block.includes(`href="${classNameFile(WITCH).href}"`));
  check('the name file is beside the shipped ones',
    existsSync(join(dataRoot, 'GameMechanics/RefTables/HeroClass/HeroClassRanger.txt'))
    && classNameFile(WITCH).path === 'GameMechanics/RefTables/HeroClass/HeroClassWitch.txt',
    classNameFile(WITCH).path);
  const probs = [...block.matchAll(/<Prob>(\d+)<\/Prob>/g)].map((m) => +m[1]!);
  check('every weight is written', probs.length === WITCH.skills.length, `${probs.length}`);
  check('War Machines is the heavy one', /HERO_SKILL_WAR_MACHINES<\/SkillID>\s*<Prob>15</.test(block));
  check('the attributes are written in the shipped order',
    /<OffenceProb>10<[\s\S]*?<DefenceProb>25<[\s\S]*?<SpellpowerProb>35<[\s\S]*?<KnowledgeProb>30</.test(block));
  check('and the preferred spells', block.includes('<Item>SPELL_RESURRECT</Item>'));

  // The shape is the shipped shape: same fields, same order, nothing else.
  const ours = fieldsOf(block);
  const ranger = fieldsOf(table.slice(table.indexOf('<ID>HERO_CLASS_RANGER</ID>')));
  const same = ours.join(',') === ranger.join(',');
  check('the record carries the fields a shipped one does, in order',
    same, same ? '' : `${ours.join(',')} vs ${ranger.join(',')}`);

  let refused = false;
  try { patchClassTable(t, [WITCH]); } catch { refused = true; }
  check('patching an already-patched table is refused', refused);
}

/** The record's own field names, in the order they are written. */
function fieldsOf(block: string): string[] {
  const obj = block.slice(block.indexOf('<obj>'), block.indexOf('</obj>'));
  return [...obj.matchAll(/^\t*<(\w+)[ />]/gm)].map((m) => m[1]!).filter((n) => n !== 'Item');
}

// --- the perk gate ---------------------------------------------------------------

{
  check('the shipped plague tent asks for first aid',
    defaultDependencies(skills, 'HERO_SKILL_LAST_AID').join() === 'HERO_SKILL_FIRST_AID',
    defaultDependencies(skills, 'HERO_SKILL_LAST_AID').join());
  // The commonest list, not the first: the demon lord asks for one more.
  check('and the triple ballista asks for the ballista',
    defaultDependencies(skills, 'HERO_SKILL_TRIPLE_BALLISTA').join() === 'HERO_SKILL_BALLISTA',
    defaultDependencies(skills, 'HERO_SKILL_TRIPLE_BALLISTA').join());

  const before = /<Class>HERO_CLASS_\w+<\/Class>/g;
  const lastAidBefore = entryOf(skills, 'HERO_SKILL_LAST_AID').match(before)?.length ?? 0;
  const s = patchSkillPrerequisites(skills, [WITCH]);
  const lastAid = entryOf(s, 'HERO_SKILL_LAST_AID');
  check('the Witch is added to the plague tent', lastAid.includes(`<Class>${WITCH.id}</Class>`));
  check('beside the four who already had it, not instead of them',
    (lastAid.match(before)?.length ?? 0) === lastAidBefore + 1);
  check('with the dependency it was given',
    /<Class>HERO_CLASS_WITCH<\/Class>\s*<dependenciesIDs>\s*<Item>HERO_SKILL_FIRST_AID<\/Item>/.test(lastAid));
  check('and no other perk was touched',
    entryOf(s, 'HERO_SKILL_TRIPLE_BALLISTA') === entryOf(skills, 'HERO_SKILL_TRIPLE_BALLISTA'));

  // A perk whose prerequisites are the shipped empty form: `<SkillPrerequisites/>`
  // has to be opened out before anything can go inside it.
  const empty = { ...WITCH, allowedPerks: [{ perk: 'HERO_SKILL_MULTISHOT', dependencies: [] }] };
  const opened = entryOf(patchSkillPrerequisites(skills, [empty]), 'HERO_SKILL_MULTISHOT');
  check('an empty prerequisite list is opened out, not written past',
    opened.includes('<SkillPrerequisites>') && opened.includes(`<Class>${WITCH.id}</Class>`)
    && opened.includes('</SkillPrerequisites>') && !opened.includes('<SkillPrerequisites/>'));

  let refused = false;
  try { patchSkillPrerequisites(skills, [{ ...WITCH, allowedPerks: [{ perk: 'HERO_SKILL_NOPE', dependencies: [] }] }]); }
  catch { refused = true; }
  check('a perk the game does not have is refused', refused);
}

/** One skill's `<Item>` out of the table, for comparing before and after. */
function entryOf(skills_: string, id: string): string {
  const at = skills_.indexOf(`<ID>${id}</ID>`);
  const start = skills_.lastIndexOf('<Item>', at);
  const end = skills_.indexOf('</Item>', skills_.indexOf('</obj>', at));
  return skills_.slice(start, end);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);

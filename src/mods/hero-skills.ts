// A skill of our own — a racial one, and the perks of its branch.
//
// WHERE A SKILL LIVES. One entry in `GameMechanics/RefTables/Skills.xdb`, which
// holds all 221 of them: the twelve common skills, the eight racials, and 186
// perks. The table declares its size in types.xml and once more in the
// executable, exactly as the hero class table does — so a skill of ours costs
// the same three declarations plus the ceiling (src/exe/table-limit.ts).
//
// THE FOUR SHAPES A SKILL COMES IN, and the two we write:
//
//   SKILLTYPE_SKILL        a skill proper: twelve common ones with
//                          `HERO_CLASS_NONE`, and eight racials each naming its
//                          class. FOUR levels — the fourth is
//                          MASTERY_EXTRA_EXPERT, the one an artifact grants —
//                          so its name, its description and its icon are four
//                          each, and the icon list carries a fifth, empty slot
//                          in front for MASTERY_NONE.
//   SKILLTYPE_CLASS_PERK   a perk of a racial branch. One name, one
//                          description, two icons (grey and lit).
//
// The other two, SKILLTYPE_STANDART_PERK and SKILLTYPE_SPECIAL_PERK, are the
// common branches' perks; nothing stops us writing one, and there is no reason
// to — a perk of ours belongs to a branch of ours.
//
// WHAT A RACIAL IS BOUND BY. Its `<HeroClass>`, and nothing else: there is no
// table of racials and no field on the class naming its own. Eight of the 27
// SKILLTYPE_SKILL entries carry a class, the other nineteen carry
// HERO_CLASS_NONE, and that is the whole of the binding. A hero then holds it in
// his `PrimarySkill` — which he need not, since the shipped Erasial is a Demon
// Lord holding Logistics there.
//
// WHAT A SKILL DOES is not here and cannot be. Every shipped skill's arithmetic
// is compiled against its own enum value; a value the executable has never heard
// of has a name, an icon, a place in the tree and no effect whatsoever — the
// same bargain a specialization makes (docs/engineInternals/SPECIALIZATIONS.md).
// So a skill of ours is authored here and taught to do something in the native
// extension, and the two halves are built together or the skill is decoration.
//
// ICONS COME THREE WAYS, and the order is what a skill wants said first: a
// PICTURE of its own, built into the game's texture the way a hero's portrait
// and a specialization's icon are; or HREFS at textures that already exist, for
// a skill content to look like the branch it belongs to; or nothing, and it
// borrows the War Machines set, which is honest for a branch about a tent and
// visible from the first launch. One picture serves all four levels: the game
// tells them apart by their names, and four drawings of the same tent is work
// nobody asked for.

import { count, insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';
import type { EffectStat } from './artifact-effects.ts';

/** How many the game ships. Ours are appended after. */
export const SHIPPED_SKILLS = 221;

/** The reference table, and its type as types.xml declares it. */
export const SKILL_TABLE = 'GameMechanics/RefTables/Skills.xdb';
export const SKILL_TABLE_TYPE = 'Table_HeroSkill_SkillID';
/**
 * The ENUM's name, which is not the type's.
 *
 * types.xml carries a `HeroSkill` too and it is a different thing — the class
 * that points at the table's path. The list of names lives under `SkillID`, and
 * reading the wrong one comes back empty rather than wrong, which is how it was
 * found. The hero class side has no such trap: there both are `HeroClass`.
 */
export const SKILL_TYPE = 'SkillID';

/** The last entry of the shipped enum, which ours follow. */
export const LAST_SHIPPED_SKILL = 'HERO_SKILL_SHATTER_SUMMONING_MAGIC';

/** Where our skills' words go. */
export const SKILL_TEXT_DIR = 'Text/Game/Skills/Ours';

/**
 * What a skill with no icons of its own borrows.
 *
 * The War Machines set, because the first branch we are writing is a tent —
 * and because a skill drawn as nothing at all is a hole in the hero screen.
 */
// The fourth repeats the third, and it has to: War Machines is a COMMON skill,
// which has three levels, so the game ships no fourth icon for it. Only the
// eight racials are drawn four times. A skill of ours that cares gives its own.
const DEFAULT_SKILL_ICONS = [
  '/Textures/HeroScreen/Skills/WarMachines_1.xdb#xpointer(/Texture)',
  '/Textures/HeroScreen/Skills/WarMachines_2.xdb#xpointer(/Texture)',
  '/Textures/HeroScreen/Skills/WarMachines_3.xdb#xpointer(/Texture)',
  '/Textures/HeroScreen/Skills/WarMachines_3.xdb#xpointer(/Texture)',
];
const DEFAULT_PERK_ICONS = [
  '/Textures/HeroScreen/Perks/WarMachines_FirstAid_grey.xdb#xpointer(/Texture)',
  '/Textures/HeroScreen/Perks/WarMachines_FirstAid.xdb#xpointer(/Texture)',
];

/** The four levels a racial skill is held at — the fourth needs an artifact. */
export const MASTERIES = ['MASTERY_BASIC', 'MASTERY_ADVANCED', 'MASTERY_EXPERT', 'MASTERY_EXTRA_EXPERT'] as const;

/** A skill to add to the mod. */
export interface HeroSkillSpec {
  /** `HERO_SKILL_…`, ours. */
  id: string;
  /**
   * A racial skill of a class, or a perk in a racial branch.
   *
   * `racial` writes SKILLTYPE_SKILL with four levels; `perk` writes
   * SKILLTYPE_CLASS_PERK with one.
   */
  kind: 'racial' | 'perk';
  /** `HERO_CLASS_…` — the class this belongs to. A racial IS that class's. */
  heroClass: string;
  /**
   * What the hero screen calls it.
   *
   * A racial is named four times, once per level, because the shipped ones are
   * («Мщение» is four different names) — one string given, the level is appended
   * so the four are distinguishable rather than silently identical.
   */
  name: string;
  /** The same, per level, when the four are not variations on one name. */
  names?: string[];
  description: string;
  /** Per level, when the levels do different amounts. */
  descriptions?: string[];
  /** What the four levels share — a racial's `CommonDescriptionFileRef`. */
  commonDescription?: string;
  /** Icons, as hrefs: four for a racial, two (grey, lit) for a perk. */
  icons?: string[];
  /**
   * A drawing to build its icon from — a path on disk, as `assets/` keeps them.
   *
   * Wins over `icons`: a skill with a picture of its own has said what it wants
   * to look like. Re-read on every build, so editing the drawing and rebuilding
   * is the whole loop. Either format the editor reads — PNG or GIF.
   */
  picture?: string;
  /**
   * One drawing per level, where the levels really look different.
   *
   * Heroes III drew first aid three times and Heroes V draws its racials four,
   * so a racial ported from one to the other has three pictures and a fourth
   * level to fill: the last one given is repeated rather than left blank, which
   * is what the shipped War Machines icons do too (a common skill has three
   * levels and the fourth entry repeats the third).
   */
  pictures?: string[];
  /** For a perk: the skill its branch hangs off — a racial of ours. */
  basicSkill?: string;
  /** For a perk: what the class must already hold. */
  prerequisites?: string[];
  /**
   * Which race's AI should want it, if any.
   *
   * The numbers written are the Avenger's own (1000/100/1000): a racial is what
   * its class takes, and the AI values are how strongly. Omitted, every race
   * scores it zero — which is right for a skill only a scripted hero will hold.
   */
  aiRace?: string;
  /**
   * What it adds to a sum the executable computes, per level of mastery.
   *
   * The record above gives a skill a name, an icon and a place in the tree and
   * nothing else — every shipped skill's arithmetic is compiled against its own
   * enum value, so a value of ours does nothing on its own. These are the sums
   * the extension can append to; the hero is asked for his mastery of the skill
   * (0…4) and the amount is multiplied by it. See src/mods/artifact-effects.ts.
   */
  effects?: Partial<Record<EffectStat, number>>;
  /**
   * Lua that runs on every adventure map, for what a sum cannot express.
   *
   * `effects` above reaches numbers the engine computes; this reaches MOMENTS —
   * "after a battle", "at the start of a day" — which the engine already hands
   * to Lua and which no arithmetic can stand in for. The head naming this
   * skill's id is generated; everything else is the author's.
   */
  script?: string;
  /**
   * The same, inside a battle: another context, another function table.
   *
   * A battle's Lua cannot see the adventure map's calls or the other way round;
   * what crosses is `SetGameVar`/`GetGameVar`, which both contexts register over
   * one store. So the pair is how a perk asks a battle something and answers on
   * the map — see src/mods/skill-scripts.ts.
   */
  combatScript?: string;
}

/** One in a mod: a skill plus the enum value it holds. */
export interface ModHeroSkill extends HeroSkillSpec {
  number: number;
}

/** The eight races the AI values are keyed by, in the shipped order. */
const AI_RACES = ['Haven', 'Sylvan', 'Academy', 'Dungeon', 'Necropolis', 'Inferno', 'Fortress', 'Stronghold'];

/**
 * Where a skill's own icon is built, and the href the record points at it by.
 *
 * `level` is 1…4 for a racial drawn per level; without one there is a single
 * texture and every level points at it.
 */
export function skillIconFile(skill: HeroSkillSpec, level?: number): {
  dds: string; xdb: string; href: string;
} {
  const stem = skill.id.replace(/^HERO_SKILL_/, '');
  const dir = `Textures/HeroScreen/Ours/${stem}`;
  const name = level ? `${stem}_${level}` : stem;
  return { dds: `${dir}/${name}.dds`, xdb: `${dir}/${name}.xdb`, href: `/${dir}/${name}.xdb#xpointer(/Texture)` };
}

/**
 * The pictures a skill is drawn from, one per texture it needs.
 *
 * Four for a racial, two for a perk (grey and lit), and the last picture given
 * fills whatever is left — three drawings for four levels is the ordinary case
 * when a Heroes III skill is being ported.
 */
export function skillPictures(skill: HeroSkillSpec): { picture: string; file: ReturnType<typeof skillIconFile> }[] {
  const want = skill.kind === 'racial' ? 4 : 2;
  const given = skill.pictures?.length ? skill.pictures : skill.picture ? [skill.picture] : [];
  if (!given.length) return [];
  // One picture and no list means one texture for all of them: naming it per
  // level would write the same bytes four times.
  if (given.length === 1) return [{ picture: given[0]!, file: skillIconFile(skill) }];
  return Array.from({ length: want }, (_, i) => ({
    picture: given[Math.min(i, given.length - 1)]!,
    file: skillIconFile(skill, i + 1),
  }));
}

/** Where one of its texts goes, and the href pointing at it. */
export function skillTextFile(skill: HeroSkillSpec, what: 'Name' | 'Description', level?: number): {
  path: string; href: string;
} {
  const stem = skill.id.replace(/^HERO_SKILL_/, '');
  const dir = level ? `${SKILL_TEXT_DIR}/${stem}/${level}` : `${SKILL_TEXT_DIR}/${stem}`;
  return { path: `${dir}/${what}.txt`, href: `/${dir}/${what}.txt` };
}

/** What a skill must satisfy to be written. */
export function skillProblems(skill: HeroSkillSpec): string[] {
  const out: string[] = [];
  if (!/^HERO_SKILL_[A-Z0-9_]+$/.test(skill.id)) out.push(`${skill.id} is not a HERO_SKILL_… identifier`);
  if (!skill.name.trim()) out.push('the skill has no name');
  if (!/^HERO_CLASS_[A-Z0-9_]+$/.test(skill.heroClass)) out.push(`${skill.heroClass} is not a HERO_CLASS_…`);
  if (skill.kind === 'perk' && !skill.basicSkill) out.push('a perk needs the skill its branch hangs off');
  // Holding the branch is what `BasicSkillID` already says; a dependency names a
  // perk that has to come first, and in the shipped table it always does.
  if (skill.basicSkill && skill.prerequisites?.includes(skill.basicSkill)) {
    out.push(`${skill.basicSkill} is the branch itself, not a perk to ask for first`);
  }
  const want = skill.kind === 'racial' ? 4 : 2;
  if (skill.icons && skill.icons.length !== want) {
    out.push(`${skill.kind === 'racial' ? 'a racial' : 'a perk'} takes ${want} icons, not ${skill.icons.length}`);
  }
  if (skill.names && skill.names.length !== 4 && skill.kind === 'racial') {
    out.push(`a racial is named at four levels, not ${skill.names.length}`);
  }
  return out;
}

/** Every skill the game already answers to, read off types.xml. */
export function takenSkills(types: string): Set<string> {
  const at = types.indexOf(`<TypeName>${SKILL_TYPE}</TypeName>`);
  if (at < 0) return new Set();
  const end = types.indexOf('</Entries>', at);
  const body = types.slice(at, end < 0 ? undefined : end);
  return new Set([...body.matchAll(/<Name>(HERO_SKILL_\w+)<\/Name>/g)].map((m) => m[1]!));
}

/** types.xml: the enum in both shapes, and the table's declared size. */
export function patchSkillTypes(types: string, skills: readonly ModHeroSkill[]): string {
  if (!skills.length) return types;
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED_SKILL}</Item>`, 'types.xml skill enum');
  t = insertAfterLine(t, enumAt, skills.map((s) => `<Item>${s.id}</Item>`));

  const mapAt = once(t, `<Name>${LAST_SHIPPED_SKILL}</Name>`, 'types.xml skill name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml skill map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, skills.flatMap((s) => [
    '<Item>', `\t<Name>${s.id}</Name>`, `\t<Value>${s.number}</Value>`, '</Item>',
  ]));

  const table = once(t, `<TypeName>${SKILL_TABLE_TYPE}</TypeName>`, 'types.xml skill table');
  const to = SHIPPED_SKILLS + skills.length;
  t = retune(t, table, 'Data', SHIPPED_SKILLS, to, 'types.xml skill ref_table_num_objs');
  t = retune(t, table, 'MaxElements', SHIPPED_SKILLS, to, 'types.xml skill MaxElements');
  return retune(t, table, 'MinElements', SHIPPED_SKILLS, to, 'types.xml skill MinElements');
}

/** Skills.xdb: one `<Item>` per skill of ours, in the shipped shape. */
export function patchSkillTable(table: string, skills: readonly ModHeroSkill[]): string {
  if (!skills.length) return table;
  const had = count(table, /<ID>HERO_SKILL_\w+<\/ID>/g);
  if (had !== SHIPPED_SKILLS) throw new Error(`${SKILL_TABLE}: ${had} entries, expected ${SHIPPED_SKILLS}`);
  const close = once(table, '</objects>', `${SKILL_TABLE} objects`);
  return insertBeforeLine(table, close, skills.flatMap((s) => {
    const problems = skillProblems(s);
    if (problems.length) throw new Error(`${s.id}: ${problems.join('; ')}`);
    const racial = s.kind === 'racial';
    // Its own drawings first, then hrefs it named, then the borrowed set.
    const drawn = skillPictures(s);
    const icons = drawn.length
      ? (drawn.length === 1
        ? new Array(racial ? 4 : 2).fill(drawn[0]!.file.href) as string[]
        : drawn.map((d) => d.file.href))
      : (s.icons ?? (racial ? DEFAULT_SKILL_ICONS : DEFAULT_PERK_ICONS));
    const levels = racial ? [1, 2, 3, 4] : [undefined];
    return [
      '<Item>',
      `\t<ID>${s.id}</ID>`,
      '\t<obj>',
      '\t\t<Texture>',
      // The empty first slot is MASTERY_NONE, and only a racial has one: the
      // shipped Avenger carries five entries for its four levels.
      ...(racial ? ['\t\t\t<Item/>'] : []),
      ...icons.map((href) => `\t\t\t<Item href="${href}"/>`),
      '\t\t</Texture>',
      '\t\t<CommonTexture/>',
      '\t\t<NameFileRef>',
      ...levels.map((l) => `\t\t\t<Item href="${skillTextFile(s, 'Name', l).href}"/>`),
      '\t\t</NameFileRef>',
      '\t\t<CommonNameFileRef href=""/>',
      '\t\t<DescriptionFileRef>',
      ...levels.map((l) => `\t\t\t<Item href="${skillTextFile(s, 'Description', l).href}"/>`),
      '\t\t</DescriptionFileRef>',
      ...(racial && s.commonDescription
        ? [`\t\t<CommonDescriptionFileRef href="${skillTextFile(s, 'Description').href}"/>`]
        : ['\t\t<CommonDescriptionFileRef href=""/>']),
      `\t\t<SkillType>${racial ? 'SKILLTYPE_SKILL' : 'SKILLTYPE_CLASS_PERK'}</SkillType>`,
      `\t\t<HeroClass>${s.heroClass}</HeroClass>`,
      '\t\t<spellBuffs/>',
      `\t\t<BasicSkillID>${racial ? 'HERO_SKILL_NONE' : s.basicSkill}</BasicSkillID>`,
      // THE FIRST PERK OF A BRANCH ASKS FOR NOTHING, which is Multishot's shape
      // and every other first perk's: holding the branch is the requirement, and
      // `BasicSkillID` above already says which branch. `<HeroClass>` is what
      // narrows a SKILLTYPE_CLASS_PERK to one class, and it is plain data, so
      // our tenth class works there like any other.
      //
      // A LIST HERE IS FOR PERKS THAT COME LATER, and only for perks: across the
      // shipped table every id that appears in a `dependenciesIDs` is itself a
      // perk — 119 of them, not one base skill. Writing the branch's own skill
      // into the list, which is what this used to do, asks the game a question it
      // is never asked anywhere else. That was not what kept ours hidden either
      // (the skill count in the executable was — see src/exe/table-limit.ts), so
      // the shipped shape is what stands. See docs/HERO_CLASSES.md.
      ...(!racial && s.prerequisites?.length ? [
        '\t\t<SkillPrerequisites>',
        '\t\t\t<Item>',
        `\t\t\t\t<Class>${s.heroClass}</Class>`,
        '\t\t\t\t<dependenciesIDs>',
        ...s.prerequisites.map((d) => `\t\t\t\t\t<Item>${d}</Item>`),
        '\t\t\t\t</dependenciesIDs>',
        '\t\t\t</Item>',
        '\t\t</SkillPrerequisites>',
      ] : ['\t\t<SkillPrerequisites/>']),
      '\t\t<AIRacesValues>',
      ...AI_RACES.flatMap((race) => {
        const wanted = race === s.aiRace;
        return [
          `\t\t\t<${race}>`,
          `\t\t\t\t<CommanderValue>${wanted ? 1000 : 0}</CommanderValue>`,
          `\t\t\t\t<CollectorSupplierValue>${wanted ? 100 : 0}</CollectorSupplierValue>`,
          `\t\t\t\t<FreelancerValue>${wanted ? 1000 : 0}</FreelancerValue>`,
          `\t\t\t</${race}>`,
        ];
      }),
      '\t\t</AIRacesValues>',
      '\t\t<PresetPrice>0</PresetPrice>',
      '\t</obj>',
      '</Item>',
    ];
  }));
}

/** Every text file a skill contributes, with what goes in it. */
export function skillTexts(skill: HeroSkillSpec): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  if (skill.kind === 'perk') {
    out.push({ path: skillTextFile(skill, 'Name').path, text: skill.name });
    out.push({ path: skillTextFile(skill, 'Description').path, text: skill.description });
    return out;
  }
  for (let i = 0; i < 4; i++) {
    const level = i + 1;
    // Four names, and they must differ: the hero screen prints one per level,
    // and four identical ones read as a skill that never advanced.
    out.push({
      path: skillTextFile(skill, 'Name', level).path,
      text: skill.names?.[i] ?? `${skill.name} ${'I'.repeat(level).replace('IIII', 'IV')}`,
    });
    out.push({
      path: skillTextFile(skill, 'Description', level).path,
      text: skill.descriptions?.[i] ?? skill.description,
    });
  }
  if (skill.commonDescription) {
    out.push({ path: skillTextFile(skill, 'Description').path, text: skill.commonDescription });
  }
  return out;
}

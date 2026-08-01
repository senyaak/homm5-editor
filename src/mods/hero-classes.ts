// A hero class of our own — the tenth, where the game ships nine.
//
// WHAT A CLASS IS, IN THE DATA. Four fields in one record of
// `GameMechanics/RefTables/HeroClass.xdb`, and that is the whole of it:
//
//   NameFileRef                   what the hero screen calls him.
//   SkillsProbs                   how often each skill is offered at a level up.
//   AttributeProbs                how often each of the four attributes grows.
//   PreferredSpellsFromSpellShop  what the class would rather buy.
//
// Morale is NOT among them, and neither is anything else people expect a class
// to decide: the penalty for a mixed army is computed by the executable from the
// stacks' own factions and the class does not enter it.
//
// THE REGULARITY IS THE SPEC. All nine shipped classes carry exactly thirteen
// skills whose weights sum to exactly 100, and four attribute weights that sum
// to exactly 100. Thirteen is not a coincidence either: it is the twelve common
// skills EVERY class lists — no class is denied one — plus that class's own
// racial. So a class does not choose WHICH skills exist for it; it chooses how
// often each is offered, and a weight of zero is how "never" is spelled.
//
// WHAT A CLASS DOES NOT DECIDE is which PERKS may be taken. That gate is on the
// perk, as a list of classes with the dependencies each of them needs:
//
//   <SkillPrerequisites>
//     <Item><Class>HERO_CLASS_NECROMANCER</Class>
//           <dependenciesIDs><Item>HERO_SKILL_FIRST_AID</Item></dependenciesIDs></Item>
//     …
//
// A class absent from that list cannot take the perk at any weight — which is
// why the Ranger has no «Чумная палатка» (`HERO_SKILL_LAST_AID` lists the demon
// lord, the necromancer, the warlock and the barbarian, and nobody else). So a
// class of ours reaches a shipped perk by being ADDED to that perk's list, which
// is what `allowedPerks` below is, and 37 of the 115 perks that carry
// prerequisites ask different classes for different things — hence a dependency
// list per entry rather than one for all.
//
// The `<HeroClass>` field ON a perk is NOT that gate and must not be mistaken
// for it: `HERO_SKILL_TRIPLE_BALLISTA` carries `HERO_CLASS_KNIGHT` and is
// available to all eight. It marks whose branch the perk is drawn in.
//
// THE RACIAL SKILL IS BOUND THE SAME WAY, from the skill's side: of the 27
// `SKILLTYPE_SKILL` entries exactly eight carry a class in `<HeroClass>` —
// Training/Knight, Gating/Demon Lord, Necromancy/Necromancer, Avenger/Ranger,
// Artificier/Wizard, Invocation/Warlock, Runelore/Runemage, Demonic
// Rage/Barbarian — and the other nineteen are `HERO_CLASS_NONE`. There is no
// table of racials and no field on the class saying which is his: the skill
// names the class, and that is the only place it is written down. A racial of
// ours is therefore a skill of ours carrying our class — see hero-skills.ts.
//
// WHAT IT COSTS THE GAME. A reference table with a declared size, so all three
// declarations move together: the enum in types.xml (twice — the entry list and
// the name→number map), the table's `ref_table_num_objs` and its
// `MinElements`/`MaxElements`, and the count compiled into the executable
// (src/exe/table-limit.ts). Any one of them left behind is a game that either
// stops at startup or reads a class it will not use.

import { EOL, count, indentOf, insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';

/** How many the game ships — and so the value the tenth class takes. */
export const SHIPPED_CLASSES = 9;

/** The last entry of the shipped enum, which ours are appended after. */
export const LAST_SHIPPED_CLASS = 'HERO_CLASS_BARBARIAN';

/** The enum's name in types.xml, and the table's type. */
export const CLASS_TYPE = 'HeroClass';
export const CLASS_TABLE_TYPE = 'Table_HeroClassDesc_HeroClass';

/** The reference table itself. */
export const CLASS_TABLE = 'GameMechanics/RefTables/HeroClass.xdb';

/** Where the class name texts live, beside the table. `href` is relative to it. */
export const CLASS_TEXT_DIR = 'GameMechanics/RefTables/HeroClass';

/** The skill table, whose perks are what `allowedPerks` opens. */
export const SKILL_TABLE = 'GameMechanics/RefTables/Skills.xdb';

/** What every class's weights must add up to — the shipped nine all do. */
export const TOTAL = 100;

/** How often one skill is offered when a level up asks. */
export interface SkillWeight {
  /** `HERO_SKILL_…`, ours or the game's. */
  skill: string;
  /** Its share of the hundred. Zero is how "never offer this" is written. */
  prob: number;
}

/** How often each attribute grows. Four numbers, and they sum to a hundred. */
export interface AttributeWeights {
  offence: number;
  defence: number;
  spellpower: number;
  knowledge: number;
}

/** A shipped perk opened to this class, with what it asks of him. */
export interface AllowedPerk {
  /** `HERO_SKILL_…` — the perk being opened. */
  perk: string;
  /**
   * What he must already hold. Usually the same list the other classes need
   * (`defaultDependencies` reads it off the perk), but a third of the perks ask
   * different classes for different things, so it is per entry.
   */
  dependencies: string[];
}

/** A class to add to the mod. */
export interface HeroClassSpec {
  /** `HERO_CLASS_…`, ours. Appended after the game's nine and never renumbered. */
  id: string;
  /** What the hero screen prints. */
  name: string;
  /** Thirteen weights in the shipped data; any list summing to a hundred here. */
  skills: SkillWeight[];
  attributes: AttributeWeights;
  /** What the class prefers in the magic shop. Optional — the game allows none. */
  preferredSpells?: string[];
  /** Shipped perks this class may take. Ours are declared on the skills instead. */
  allowedPerks?: AllowedPerk[];
}

/** One in a mod: a class plus the enum value it holds. */
export interface ModHeroClass extends HeroClassSpec {
  /** Assigned on the way in and never changed. */
  number: number;
}

/** The file its name goes in, and the href the record points at it by. */
export function classNameFile(spec: HeroClassSpec): { path: string; href: string } {
  // Named after the id rather than after the display name: the name is words in
  // some language and the id is the one thing that cannot change.
  const stem = spec.id.replace(/^HERO_CLASS_/, '').split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join('');
  return {
    path: `${CLASS_TEXT_DIR}/HeroClass${stem}.txt`,
    href: `HeroClass/HeroClass${stem}.txt`,
  };
}

/** Every class name the game already answers to, read off types.xml. */
export function takenClasses(types: string): Set<string> {
  const at = types.indexOf(`<TypeName>${CLASS_TYPE}</TypeName>`);
  if (at < 0) return new Set();
  const end = types.indexOf('</Entries>', at);
  const body = types.slice(at, end < 0 ? undefined : end);
  return new Set([...body.matchAll(/<Name>(HERO_CLASS_\w+)<\/Name>/g)].map((m) => m[1]!));
}

/**
 * What a class must satisfy to be worth writing, said in one place.
 *
 * Both sums are checked because both are distributions the engine walks: a total
 * under a hundred leaves a range that answers nothing, and one over it leaves
 * the tail of the list unreachable. The shipped nine are all exactly a hundred,
 * twice, which is as close to a stated rule as this data gets.
 */
export function classProblems(spec: HeroClassSpec): string[] {
  const out: string[] = [];
  if (!/^HERO_CLASS_[A-Z0-9_]+$/.test(spec.id)) out.push(`${spec.id} is not a HERO_CLASS_… identifier`);
  if (!spec.name.trim()) out.push('the class has no name');
  const skills = spec.skills.reduce((n, s) => n + s.prob, 0);
  if (skills !== TOTAL) out.push(`the skill weights add up to ${skills}, not ${TOTAL}`);
  const a = spec.attributes;
  const attrs = a.offence + a.defence + a.spellpower + a.knowledge;
  if (attrs !== TOTAL) out.push(`the attribute weights add up to ${attrs}, not ${TOTAL}`);
  const seen = new Set<string>();
  for (const s of spec.skills) {
    if (seen.has(s.skill)) out.push(`${s.skill} is weighted twice`);
    seen.add(s.skill);
    if (s.prob < 0) out.push(`${s.skill} has a negative weight`);
  }
  return out;
}

/**
 * types.xml: the enum in both of its shapes, and the table's declared size.
 *
 * Three edits, and forgetting any one of them is its own failure: the entry list
 * is what a document's `<Class>` is validated against, the name→number map is
 * what turns it into the number the executable compares, and the size is what
 * the loader reads the table with.
 */
export function patchClassTypes(types: string, classes: readonly ModHeroClass[]): string {
  if (!classes.length) return types;
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED_CLASS}</Item>`, 'types.xml hero class enum');
  t = insertAfterLine(t, enumAt, classes.map((c) => `<Item>${c.id}</Item>`));

  const mapAt = once(t, `<Name>${LAST_SHIPPED_CLASS}</Name>`, 'types.xml hero class name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml hero class map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, classes.flatMap((c) => [
    '<Item>', `\t<Name>${c.id}</Name>`, `\t<Value>${c.number}</Value>`, '</Item>',
  ]));

  const table = once(t, `<TypeName>${CLASS_TABLE_TYPE}</TypeName>`, 'types.xml hero class table');
  const to = SHIPPED_CLASSES + classes.length;
  t = retune(t, table, 'Data', SHIPPED_CLASSES, to, 'types.xml hero class ref_table_num_objs');
  t = retune(t, table, 'MaxElements', SHIPPED_CLASSES, to, 'types.xml hero class MaxElements');
  return retune(t, table, 'MinElements', SHIPPED_CLASSES, to, 'types.xml hero class MinElements');
}

/** HeroClass.xdb: one `<Item>` per class of ours, each carrying its record. */
export function patchClassTable(table: string, classes: readonly ModHeroClass[]): string {
  const had = count(table, /<ID>HERO_CLASS_\w+<\/ID>/g);
  if (had !== SHIPPED_CLASSES) throw new Error(`${CLASS_TABLE}: ${had} entries, expected ${SHIPPED_CLASSES}`);
  const close = once(table, '</objects>', `${CLASS_TABLE} objects`);
  return insertBeforeLine(table, close, classes.flatMap((c) => {
    const problems = classProblems(c);
    if (problems.length) throw new Error(`${c.id}: ${problems.join('; ')}`);
    return [
      '<Item>',
      `\t<ID>${c.id}</ID>`,
      '\t<obj>',
      `\t\t<NameFileRef href="${classNameFile(c).href}"/>`,
      ...(c.skills.length ? [
        '\t\t<SkillsProbs>',
        ...c.skills.flatMap((s) => [
          '\t\t\t<Item>',
          `\t\t\t\t<SkillID>${s.skill}</SkillID>`,
          `\t\t\t\t<Prob>${s.prob}</Prob>`,
          '\t\t\t</Item>',
        ]),
        '\t\t</SkillsProbs>',
      ] : ['\t\t<SkillsProbs/>']),
      '\t\t<AttributeProbs>',
      `\t\t\t<OffenceProb>${c.attributes.offence}</OffenceProb>`,
      `\t\t\t<DefenceProb>${c.attributes.defence}</DefenceProb>`,
      `\t\t\t<SpellpowerProb>${c.attributes.spellpower}</SpellpowerProb>`,
      `\t\t\t<KnowledgeProb>${c.attributes.knowledge}</KnowledgeProb>`,
      '\t\t</AttributeProbs>',
      ...(c.preferredSpells?.length ? [
        '\t\t<PreferredSpellsFromSpellShop>',
        ...c.preferredSpells.map((s) => `\t\t\t<Item>${s}</Item>`),
        '\t\t</PreferredSpellsFromSpellShop>',
      ] : ['\t\t<PreferredSpellsFromSpellShop/>']),
      '\t</obj>',
      '</Item>',
    ];
  }));
}

/**
 * What a perk asks of the classes that already have it.
 *
 * Offered as the default when a perk is opened to a class of ours, because two
 * thirds of them ask everybody the same thing — and the third that does not is
 * exactly why this returns the COMMONEST list rather than the first one.
 */
export function defaultDependencies(skills: string, perk: string): string[] {
  const entry = skillEntry(skills, perk);
  if (!entry) return [];
  const block = /<SkillPrerequisites>([\s\S]*?)<\/SkillPrerequisites>/.exec(entry);
  if (!block) return [];
  const counts = new Map<string, number>();
  for (const m of block[1]!.matchAll(/<dependenciesIDs>([\s\S]*?)<\/dependenciesIDs>/g)) {
    const list = [...m[1]!.matchAll(/<Item>(HERO_SKILL_\w+)<\/Item>/g)].map((x) => x[1]!).join(',');
    counts.set(list, (counts.get(list) ?? 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const [list, n] of counts) if (n > most) { best = list; most = n; }
  return best ? best.split(',') : [];
}

/** The text of one skill's `<Item>`, or null when the table has no such skill. */
function skillEntry(skills: string, id: string): string | null {
  const at = skills.indexOf(`<ID>${id}</ID>`);
  if (at < 0) return null;
  const start = skills.lastIndexOf('<Item>', at);
  const end = skills.indexOf('</Item>', skills.indexOf('</obj>', at));
  return start < 0 || end < 0 ? null : skills.slice(start, end + '</Item>'.length);
}

/**
 * Skills.xdb: add our classes to the prerequisites of the perks they may take.
 *
 * The empty case is a SELF-CLOSING tag in the shipped file — `<SkillPrerequisites/>`
 * — so a perk nobody could take yet has to be opened out before anything is put
 * inside it. Writing into the closing tag that is not there was the first way
 * this went wrong.
 */
export function patchSkillPrerequisites(skills: string, classes: readonly ModHeroClass[]): string {
  let t = skills;
  for (const c of classes) {
    for (const allowed of c.allowedPerks ?? []) {
      const at = t.indexOf(`<ID>${allowed.perk}</ID>`);
      if (at < 0) throw new Error(`${SKILL_TABLE} has no ${allowed.perk}, so ${c.id} cannot be given it`);
      const entryEnd = t.indexOf('</obj>', at);
      const empty = t.indexOf('<SkillPrerequisites/>', at);
      const open = t.indexOf('<SkillPrerequisites>', at);
      const lines = [
        '<Item>',
        `\t<Class>${c.id}</Class>`,
        ...(allowed.dependencies.length ? [
          '\t<dependenciesIDs>',
          ...allowed.dependencies.map((d) => `\t\t<Item>${d}</Item>`),
          '\t</dependenciesIDs>',
        ] : ['\t<dependenciesIDs/>']),
        '</Item>',
      ];
      if (empty >= 0 && empty < entryEnd && (open < 0 || open > entryEnd)) {
        // Open the tag out, then fill it — one edit, so the offsets below stay put.
        const indent = indentOf(t, empty);
        t = `${t.slice(0, empty)}<SkillPrerequisites>${EOL}`
          + `${lines.map((l) => `${indent}\t${l}`).join(EOL)}${EOL}`
          + `${indent}</SkillPrerequisites>${t.slice(empty + '<SkillPrerequisites/>'.length)}`;
        continue;
      }
      if (open < 0 || open > entryEnd) throw new Error(`${allowed.perk} has no SkillPrerequisites at all`);
      const close = t.indexOf('</SkillPrerequisites>', open);
      if (close < 0 || close > t.indexOf('</obj>', open)) {
        throw new Error(`${allowed.perk}: its SkillPrerequisites never closes`);
      }
      t = insertBeforeLine(t, close, lines);
    }
  }
  return t;
}

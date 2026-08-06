// Creature abilities of the editor's own — the files a mod ships for them.
//
// WHAT AN ABILITY IS, in this game. Almost none of them is code. A creature's
// `<Abilities>` is a list of ids in its record, and the engine asks "does this
// creature have that one" wherever it matters: `ABILITY_UNDEAD` is not a
// behaviour, it is a flag that resurrection, morale and the mind spells each
// look at. So an ability nothing in the engine asks about does NOTHING — which
// is exactly what a tag needs to be.
//
// WHAT IT COSTS. The same three global things an artifact costs, and no more:
// an entry in the `CombatAbilities` reference table, the enum in types.xml that
// names it, and the size that table is declared to hold. No executable is
// patched: the table is loaded by the generic loader from a descriptor of type
// name and path, and its size is `ref_table_num_objs` in types.xml — unlike
// creatures and artifacts, which the engine also counts for itself.
//
// WHY NOT A NAME THE GAME DOES NOT KNOW. Because the game DOES know names: the
// xdb loader resolves an enum item through the name→number map in types.xml,
// which is exactly how a creature of ours gets its number. (The executable also
// holds a compiled chain of ability names — and one for creature names beside
// it — but our creatures work, so that chain is not the loader's path.) A name
// that is only in the data is a name the game reads as nothing; a name in the
// map is an ability, with a number, a caption and a description, and a second
// tag is simply the next number.

import { DRAGON_TAG } from './creatures.ts';
import { utf16 } from './mod-files.ts';
import { insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';
import type { ModFile } from './mod-files.ts';

/** The reference table an ability lives in. */
export const ABILITY_TABLE = 'GameMechanics/RefTables/CombatAbilities.xdb';
/** Its type name in types.xml, where the declared size sits. */
const ABILITY_TABLE_TYPE = 'Table_CreatureAbility_CombatAbility';
/** The last one the game ships, in the enum and in the name→number map. */
const LAST_SHIPPED_ABILITY = 'ABILITY_DESTRUCTION_MAGIC_MAGNETISM';
/** How many the game ships — `ABILITY_NONE` is 0, the last one is 174. */
export const SHIPPED_ABILITIES = 175;
/** Where the two texts of an ability of ours go. */
const ABILITY_TEXT_DIR = 'Text/Game/Creatures/Creature_abilities/H5E';

/** One of ours: an id, the number it gets, and the two texts a player reads. */
export interface EditorAbility {
  id: string;
  /** Assigned by position below — the first is SHIPPED_ABILITIES. */
  number: number;
  file: string;
  name: string;
  description: string;
}

/**
 * The abilities the editor adds, in order, and the numbers they take.
 *
 * APPEND-ONLY, like every other id the editor hands out: the number is what a
 * creature's record stores, so moving one renames what an installed creature
 * carries. A new tag goes at the end and takes the next number.
 *
 * AND NOT DELETABLE. These are the editor's own, not a mod's: a rule of ours
 * asks about them by id (the Rune of the Dragon Form asks about this one), and
 * a creature already built names the number. So whatever authors abilities
 * later — the tab in ROADMAP — shows these and offers neither deletion nor
 * renumbering; what it adds goes after them. `tools/test-abilities.ts` pins the
 * numbers so that a later edit here fails a test instead of a saved mod.
 *
 * `ABILITY_DRAGON` is the first, and the shape of all of them: nothing in the
 * engine asks about it, so it does nothing at all — except where we ask. The
 * Rune of the Dragon Form is the asking (see docs/engineInternals/RULES_FIXES.md);
 * the twelve dragons the game ships need no tag, since the executable knows
 * them, and this is how the thirteenth says the same thing.
 */
export const EDITOR_ABILITIES: readonly EditorAbility[] = [
  {
    id: DRAGON_TAG,
    number: SHIPPED_ABILITIES,
    file: 'Dragon',
    name: 'Дракон',
    description: 'Существо принадлежит к драконьему роду. «Руна драконьего обличья»'
      + ' к драконам неприменима.',
  },
];

/** By id, for whoever has a name and wants the number. */
export const editorAbility = (id: string): EditorAbility | undefined =>
  EDITOR_ABILITIES.find((a) => a.id === id);

/**
 * types.xml: the enum, the name→number map, and the size the table declares.
 *
 * The size is `ref_table_num_objs` and it belongs to the ABILITY table, of
 * which there are dozens with the same key in this file — so it is found after
 * the table's own type name and nowhere else.
 */
export function patchAbilityTypes(types: string, abilities: readonly EditorAbility[]): string {
  if (!abilities.length) return types;
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED_ABILITY}</Item>`, 'types.xml ability enum');
  t = insertAfterLine(t, enumAt, abilities.map((a) => `<Item>${a.id}</Item>`));

  const mapAt = once(t, `<Name>${LAST_SHIPPED_ABILITY}</Name>`, 'types.xml ability name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml ability map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, abilities.flatMap((a) => [
    '<Item>', `\t<Name>${a.id}</Name>`, `\t<Value>${a.number}</Value>`, '</Item>',
  ]));

  // The count is `<Data>175</Data>` two lines under a `<Key>ref_table_num_objs</Key>`
  // that dozens of tables in this file also carry — so it is found from the
  // table's own type name first, and then from its own key.
  const table = once(t, `<TypeName>${ABILITY_TABLE_TYPE}</TypeName>`, 'types.xml ability table');
  const key = t.indexOf('<Key>ref_table_num_objs</Key>', table);
  if (key < 0) throw new Error('types.xml ability table declares no ref_table_num_objs');
  return retune(t, key, 'Data', SHIPPED_ABILITIES, SHIPPED_ABILITIES + abilities.length,
    'types.xml ability ref_table_num_objs');
}

/** The reference table itself: one object per ability of ours, appended. */
export function patchAbilityTable(table: string, abilities: readonly EditorAbility[]): string {
  if (!abilities.length) return table;
  const close = once(table, '</objects>', 'CombatAbilities objects');
  return insertBeforeLine(table, close, abilities.flatMap((a) => [
    '<Item>',
    `\t<ID>${a.id}</ID>`,
    '\t<obj>',
    '\t\t<CombatLogTexts/>',
    `\t\t<NameFileRef href="/${ABILITY_TEXT_DIR}/${a.file}_name.txt"/>`,
    `\t\t<DescriptionFileRef href="/${ABILITY_TEXT_DIR}/${a.file}_desc.txt"/>`,
    '\t\t<ActivatedSpell>SPELL_NONE</ActivatedSpell>',
    '\t</obj>',
    '</Item>',
  ]));
}

/** The enum that names an ability, and whose VALUE the executable knows it by. */
const ABILITY_TYPE = 'CombatAbility';

/**
 * Every ability the game answers to, by the number the executable holds.
 *
 * The NUMBER, not the name, because the readers are the executable's own: the
 * engine's per-creature question is `HasAbility(int)`, and everything the
 * extension asks about a creature's kind goes through it. types.xml carries the
 * map twice — a bare list of names in the enum's items, and the name→value pairs
 * this reads — and only the second says what a name is worth.
 */
export function abilityNumbers(types: string): Map<string, number> {
  const at = types.indexOf(`<TypeName>${ABILITY_TYPE}</TypeName>`);
  if (at < 0) return new Map();
  const end = types.indexOf('</Entries>', at);
  const body = types.slice(at, end < 0 ? undefined : end);
  return new Map([...body.matchAll(/<Name>(ABILITY_\w+)<\/Name>\s*<Value>(\d+)<\/Value>/g)]
    .map((m) => [m[1]!, Number(m[2])] as const));
}

/** The caption and the description, in the game's own UTF-16. */
export function abilityTexts(abilities: readonly EditorAbility[]): ModFile[] {
  return abilities.flatMap((a) => [
    { path: `${ABILITY_TEXT_DIR}/${a.file}_name.txt`, data: utf16(a.name) },
    { path: `${ABILITY_TEXT_DIR}/${a.file}_desc.txt`, data: utf16(a.description) },
  ]);
}


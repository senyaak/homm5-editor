// A spell of our own — the fourth thing in the archive that holds a NUMBER.
//
// WHERE A SPELL LIVES. One entry in `GameMechanics/RefTables/UndividedSpells.xdb`,
// which holds all 353 of them — the spells proper, the hero abilities, the
// creature abilities and the effects they leave behind, in one list. Unlike a
// creature the entry is a PATH rather than an inline object, so a spell of ours
// is a document the mod carries and one line pointing at it.
//
// WHAT IT COSTS, and it is the skill table's bargain exactly: the size is
// declared three times in types.xml (`ref_table_num_objs`, `MinElements`,
// `MaxElements` — the last two are EQUAL here, as with artifacts) and twice more
// in the executable, where the registration pushes the count AND a live accessor
// returns it (`src/exe/table-limit.ts`, SPELL_TABLE). Miss the accessor and the
// game loads a longer table and offers nothing past the shipped count — which is
// how the skill table silently lost its perks for a day.
//
// WHAT A SPELL DOES is not in its document. `Armageddon.xdb` carries the damage
// per mastery, the school, the level, the target kind and the visuals — and says
// nothing about hitting every stack on the field; its `IsAreaAttack` is even
// false. The behaviour is compiled against the enum VALUE, the way a
// specialization's and a skill's are, so a value the executable has never heard
// of gets a name, an icon, a page in the spellbook and no effect at all.
//
// Which is why a spell of ours is two halves. This one is the DECLARATION; the
// effect comes from the extension, where the cast is caught and handed to Lua —
// see docs/engineInternals/SPELLS.md. The split is deliberate and it is what the
// shipped `SPELL_ABILITY_CUSTOM1…4` do at four times the granularity: those are
// four ids hardcoded in one jump table (`0xc2a1f0`), and a fifth was never
// possible.

import { EOL, count, insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';

/** How many the game ships: `SPELL_NONE` = 0 … `SPELL_EFFECT_FIRST_AID_TENT_PLAGUE` = 352. */
export const SHIPPED_SPELLS = 353;

/** The reference table, its type as types.xml declares it, and the enum's name. */
export const SPELL_TABLE_FILE = 'GameMechanics/RefTables/UndividedSpells.xdb';
export const SPELL_TABLE_TYPE = 'Table_Spell_SpellID';
export const SPELL_TYPE = 'SpellID';

/** The last shipped entry — where ours are appended, in all three lists. */
export const LAST_SHIPPED_SPELL = 'SPELL_EFFECT_FIRST_AID_TENT_PLAGUE';

/** Where a spell of ours keeps its document and its words. */
export const SPELL_DIR = 'GameMechanics/Spell/Ours';
export const SPELL_TEXT_DIR = 'Text/Game/Spells/Ours';

/**
 * The four masteries a spell's numbers are given for, in the order the document
 * lists them — none, basic, advanced, expert.
 *
 * The engine reads `<damage>` positionally, so four entries are written whatever
 * the caller says; a spec that gives fewer repeats its last, which is what the
 * shipped documents do for a spell that does not grow with the school.
 */
export const SPELL_MASTERIES = 4;

/** One `<Item>` of `<damage>` or `<duration>`: a flat part and a per-power part. */
export interface SpellAmount {
  base: number;
  perPower: number;
}

/** A spell to add to the mod. */
export interface SpellSpec {
  /** `SPELL_…`, ours. What a hero's spellbook, a map and Lua store — as a NUMBER. */
  id: string;
  /** The stem of its document and its texts, and its folder in the mod. */
  file: string;
  /** What the spellbook prints. */
  name: string;
  /** And what its page says. */
  description: string;
  /**
   * 1…5, the spellbook's own rank — which decides the mana it costs and which
   * mastery of the school lets a hero learn it. Zero is what the hero-ability
   * spells use (`MAGIC_SCHOOL_SPECIAL`), and it is a real choice: a spell that
   * comes from a specialization rather than from a guild.
   */
  level: number;
  /** `MAGIC_SCHOOL_DARK`, `…_DESTRUCTIVE`, `…_ADVENTURE`, `…_SPECIAL`, … */
  school: string;
  /**
   * What a cast costs in MANA.
   *
   * The field is called `TrainedCost` in the document, which reads like a price
   * at a guild and is not one: Magic Arrow (level 1) has 4, Plague (level 2) 6,
   * Fireball (level 3) 10 — the mana every one of them costs. Left at zero, as
   * this was at first, the spellbook prints a spell that is free.
   */
  manaCost: number;
  /** `TARGET_HOSTILE` / `TARGET_FRIEND` / `TARGET_NEUTRAL` — who may be picked. */
  target: string;
  /** Whether the player picks a target at all, and whether it hits an area. */
  aimed?: boolean;
  areaAttack?: boolean;
  /** `ELEMENT_NONE`, `ELEMENT_FIRE`, … — what resistances answer it. */
  element?: string;
  /** Its numbers per mastery. Fewer than four repeats the last. */
  damage?: SpellAmount[];
  duration?: SpellAmount[];
  /**
   * What the cast SHOWS — hrefs at `SpellVisual` documents, in the engine's own
   * order: the spell itself first, the hit second where a spell has one.
   *
   * A shipped spell's list is written RELATIVE to its own folder
   * (`Armageddon.(SpellVisual).xdb#…`), and ours sits elsewhere, so these are
   * absolute. Empty is legal — `Custom1.xdb` and the Avatar of Death both ship
   * empty — but empty means the cast draws nothing, and "nothing to show" is a
   * live candidate for why a cast of ours is refused.
   */
  visuals?: string[];
  /** An icon that already exists, since a spell without one is a hole in the book. */
  icon?: string;
  /**
   * Or a drawing of its own — a path on disk, as `assets/` keeps them.
   *
   * Wins over `icon`, the way a skill's picture wins over its hrefs: a spell
   * with art of its own has said what it wants to look like. Built into the
   * game's own texture at 128×128, which is the size every shipped spell icon
   * is, and re-read on every build so editing the drawing is the whole loop.
   */
  picture?: string;
  /**
   * The creature KINDS its damage passes over, by ability name.
   *
   * WHY THIS IS NOT IN THE DOCUMENT and not in the script either. The engine
   * decides how much a spell does to one stack in one function, and that is
   * where resistance, anti-magic, protection from a school and the combat log
   * all live — so damage of ours has to come out of it, not beside it. That
   * function carries the shipped kind filters itself, keyed on the spell's
   * number: Unholy Word answers zero for `ABILITY_UNDEAD` and `ABILITY_DEMONIC`,
   * Holy Word answers zero for everything BUT those. A number it was never
   * compiled against has no such case, so the extension supplies ours — which
   * means this list has to reach the extension, and the config file is how
   * anything of ours reaches it.
   *
   * `NOT_LIVING` is the Death Ripple's own list, and it is written the way the
   * game asks the question: there is no "is it alive" flag to test, only the
   * three kinds whose absence the game prints as «Живое существо».
   */
  spares?: readonly string[];
  /**
   * The tiles it covers, as offsets from the point aimed at — `IsAreaAttack`
   * spells only.
   *
   * The document says a spell hits an AREA and never says which; there is no
   * field for it in twenty-two, because the engine picks the shape by a switch
   * on the spell's number, one case per spell, and the default it would give
   * ours covers nothing at all.
   *
   * It is not a menu, though. The engine builds the list by pushing one tile at
   * a time and every shape it has is a different loop around that call — so this
   * is our loop, and a spell of ours may cover any set of tiles.
   *
   * Plain (x, y) offsets, and (0, 0) is the tile aimed at. The combat grid is
   * SQUARE: the engine's own "adjacent tiles" table is the eight offsets of a
   * 3×3 block, which is also what makes a fireball a 3×3.
   */
  area?: readonly { x: number; y: number }[];
  /**
   * What the extension does when it is cast — the name of a Lua function.
   *
   * The document above cannot say it: the engine picks a behaviour by the enum
   * value it was compiled against. So the mod writes the pairing into the
   * extension's config, the extension catches the cast and calls this, and the
   * spell's actual content is a script. Absent, the spell is a page in the book
   * that does nothing, which is a real thing to want while the words and the
   * icon are being got right.
   */
  script?: string;
}

/** One in a mod: a spec plus the enum value it holds. */
export interface ModSpell extends SpellSpec {
  /** Assigned on the way in and never changed — the number is what saves store. */
  number: number;
}

/** The size every shipped spell icon is drawn at. */
export const SPELL_ICON_SIZE = 128;

/**
 * The three flags that make a creature NOT living, and the one that makes it
 * untouchable by magic.
 *
 * WHY THE LIVING ONE IS NOT IN THE LIST. `ABILITY_FLESH_AND_BLOOD` exists, has
 * a name and a description, and is carried by NONE of the 191 creatures — the
 * game prints «Живое существо» itself when none of the other three is there.
 * Senya's screenshots show the three as one line each and never together, so
 * the kind is one field with three values and the fourth is its absence.
 *
 * So a script of ours asks the same question the same way round: not "is it
 * flesh and blood" — nothing would ever answer yes — but "is it none of these".
 */
export const NOT_LIVING = ['ABILITY_UNDEAD', 'ABILITY_ELEMENTAL', 'ABILITY_MECHANICAL'] as const;
export const MAGIC_PROOF = 'ABILITY_IMMUNITY_TO_MAGIC';

/**
 * Lua lines declaring which creatures a battle script must skip — read out of
 * the game's own creature records at build time.
 *
 * GENERATED, NEVER TYPED. The lists are what the data says today, so a creature
 * the mod adds tomorrow is in them without anybody remembering to add it, and a
 * creature the game patches is too. A hand-written list is a list that is wrong
 * the first time anything changes.
 */
export function creatureKindLines(kinds: {
  notLiving: readonly string[]; magicProof: readonly string[];
}): string[] {
  const table = (name: string, ids: readonly string[]): string[] => [
    `${name} = {};`,
    ...ids.map((id) => `${name}[${id}] = 1;`),
  ];
  return [
    '-- Which creatures a spell of ours must skip. Generated from the game data',
    '-- when the mod was built: the id is the key, so a lookup is one index.',
    ...table('H5E_NOT_LIVING', kinds.notLiving),
    ...table('H5E_MAGIC_PROOF', kinds.magicProof),
    '',
    '-- «Живое существо» is not a flag any creature carries — the game prints it',
    '-- when none of the three kinds is there, so this asks it the same way.',
    'function H5EIsLiving(creature)',
    '\treturn H5E_NOT_LIVING[creature] == nil;',
    'end;',
    '',
    'function H5EIsMagicProof(creature)',
    '\treturn H5E_MAGIC_PROOF[creature] ~= nil;',
    'end;',
    '',
  ];
}

/** Where a spell's battle script sits — beside the skills', loaded the same way. */
export const spellScriptPath = (s: SpellSpec): string =>
  `scripts/homm5-editor/${s.file}-spell.lua`;

/** The scripts the combat runtime has to load, in the mod's own order. */
export const spellCombatScripts = (spells: readonly ModSpell[]): string[] =>
  spells.filter((s) => s.script?.trim()).map((s) => spellScriptPath(s));

/**
 * The file a spell's script becomes: a head saying what it is, then the author's
 * own lines.
 *
 * The head declares the spell's NUMBER as a name, because that is what the
 * runtime's `H5EOnSpellCast` is given and a script written against a bare 353
 * would go stale the moment the mod's order changed.
 */
export function spellScriptFile(s: ModSpell): { path: string; text: string } {
  const head = [
    `-- ${s.id} — the battle script of a spell of ours.`,
    '-- Generated head; everything below the line is the author\'s.',
    `${s.id} = ${s.number};`,
    '',
  ].join(EOL);
  return { path: spellScriptPath(s), text: head + (s.script ?? '').replace(/\r?\n/g, EOL) };
}

/** Where a spell's own files sit inside the mod. */
export function spellPaths(s: SpellSpec): {
  document: string; name: string; description: string; icon: string; iconDDS: string;
} {
  return {
    document: `${SPELL_DIR}/${s.file}.xdb`,
    name: `${SPELL_TEXT_DIR}/${s.file}_Name.txt`,
    description: `${SPELL_TEXT_DIR}/${s.file}_Desc.txt`,
    icon: `${SPELL_DIR}/${s.file}.(Texture).xdb`,
    iconDDS: `${SPELL_DIR}/${s.file}.(Texture).dds`,
  };
}

/** The href a spell's document points its `<Texture>` at, or none. */
export function spellIcon(s: SpellSpec): string {
  if (s.picture) return `/${spellPaths(s).icon}#xpointer(/Texture)`;
  return s.icon ?? '';
}

/** The four `<Item>` blocks of an amount list, padded from what was given. */
function amounts(tag: string, given: readonly SpellAmount[] | undefined): string[] {
  const zero: SpellAmount = { base: 0, perPower: 0 };
  const four = Array.from({ length: SPELL_MASTERIES },
    (_, i) => given?.[i] ?? given?.[given.length - 1] ?? zero);
  return [
    `<${tag}>`,
    ...four.flatMap((a) => [
      '\t<Item>',
      `\t\t<Base>${a.base}</Base>`,
      `\t\t<PerPower>${a.perPower}</PerPower>`,
      '\t</Item>',
    ]),
    `</${tag}>`,
  ];
}

/**
 * The `Spell` document itself — written out rather than copied from a shipped
 * one, because unlike a creature there is nothing in it we do not set.
 *
 * `<visuals>` is a list of `SpellVisual` documents — the animation the cast
 * plays, and the hit where a spell has one. Empty is legal in the data (the
 * shipped `Custom1.xdb` and the Avatar of Death both ship empty) and it was
 * empty here at first, which turned out to be a real suspect: a cast with
 * nothing to show may be a cast the engine declines to start. Ours borrow the
 * shipped ones until there is art of our own.
 */
export function spellDocument(s: SpellSpec): string {
  const p = spellPaths(s);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Spell>',
    `\t<NameFileRef href="/${p.name}"/>`,
    `\t<LongDescriptionFileRef href="/${p.description}"/>`,
    ...(spellIcon(s) ? [`\t<Texture href="${spellIcon(s)}"/>`] : ['\t<Texture/>']),
    '\t<EffectTexture/>',
    '\t<SpellBookPredictions/>',
    '\t<CombatLogTexts/>',
    `\t<Level>${s.level}</Level>`,
    `\t<MagicSchool>${s.school}</MagicSchool>`,
    '\t<RequiredHeroLevel>0</RequiredHeroLevel>',
    // The mana, under the game's own name for it — see SpellSpec.manaCost.
    `\t<TrainedCost>${s.manaCost}</TrainedCost>`,
    ...amounts('damage', s.damage).map((l) => `\t${l}`),
    ...amounts('duration', s.duration).map((l) => `\t${l}`),
    '\t<sSpellCost>',
    ...['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gem', 'Gold']
      .map((r) => `\t\t<${r}>0</${r}>`),
    '\t</sSpellCost>',
    `\t<IsAimed>${!!s.aimed}</IsAimed>`,
    `\t<IsAreaAttack>${!!s.areaAttack}</IsAreaAttack>`,
    '\t<CanSelectDead>false</CanSelectDead>',
    `\t<Target>${s.target}</Target>`,
    `\t<Element>${s.element ?? 'ELEMENT_NONE'}</Element>`,
    '\t<DamageIsElemental>true</DamageIsElemental>',
    ...(s.visuals?.length
      ? ['\t<visuals>', ...s.visuals.map((v) => `\t\t<Item href="${v}"/>`), '\t</visuals>']
      : ['\t<visuals/>']),
    '\t<PresetPrice>-1</PresetPrice>',
    '\t<AvailableForPresets>false</AvailableForPresets>',
    '</Spell>',
  ];
  return lines.join(EOL) + EOL;
}

/**
 * types.xml, the spell half: the enum list, the name→number map, and the size
 * the table declares — all three, and the last is really two numbers.
 *
 * `MinElements` EQUALS `MaxElements` here, as it does for artifacts and unlike
 * creatures, so both move. A mod that raised only the maximum would leave the
 * table declaring it holds exactly 353 while carrying more.
 */
export function patchSpellTypes(types: string, spells: readonly ModSpell[]): string {
  if (!spells.length) return types;
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED_SPELL}</Item>`, 'types.xml spell enum');
  t = insertAfterLine(t, enumAt, spells.map((s) => `<Item>${s.id}</Item>`));

  // The name→number map. The NUMBER is what a hero's spellbook, a map and a save
  // store, so this list is append-only: reordering it repoints every spell after
  // the change.
  const mapAt = once(t, `<Name>${LAST_SHIPPED_SPELL}</Name>`, 'types.xml spell name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml spell name→number map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, spells.flatMap((s) => [
    '<Item>', `\t<Name>${s.id}</Name>`, `\t<Value>${s.number}</Value>`, '</Item>',
  ]));

  const limit = SHIPPED_SPELLS + spells.length;
  const table = once(t, `<TypeName>${SPELL_TABLE_TYPE}</TypeName>`, 'types.xml spell table');
  const numObjs = t.indexOf('<Key>ref_table_num_objs</Key>', table);
  if (numObjs < 0) throw new Error('types.xml spell table: no ref_table_num_objs');
  t = retune(t, numObjs, 'Data', SHIPPED_SPELLS, limit, 'types.xml spell ref_table_num_objs');
  t = retune(t, table, 'MinElements', SHIPPED_SPELLS, limit, 'types.xml spell MinElements');
  return retune(t, table, 'MaxElements', SHIPPED_SPELLS, limit, 'types.xml spell MaxElements');
}

/** UndividedSpells.xdb: one entry per spell of ours, pointing at its document. */
export function patchSpellTable(table: string, spells: readonly ModSpell[]): string {
  if (!spells.length) return table;
  const had = count(table, /<ID>SPELL_\w+<\/ID>/g);
  if (had !== SHIPPED_SPELLS) {
    throw new Error(`${SPELL_TABLE_FILE}: ${had} entries, expected ${SHIPPED_SPELLS}`);
  }
  const close = once(table, '</objects>', `${SPELL_TABLE_FILE} objects`);
  return insertBeforeLine(table, close, spells.flatMap((s) => [
    '<Item>',
    `\t<ID>${s.id}</ID>`,
    `\t<Obj href="/${spellPaths(s).document}#xpointer(/Spell)"/>`,
    '</Item>',
  ]));
}

/** Every spell name the game already answers to, read off types.xml. */
export function takenSpells(types: string): Set<string> {
  const at = types.indexOf(`<TypeName>${SPELL_TYPE}</TypeName>`);
  if (at < 0) return new Set();
  const end = types.indexOf('</Entries>', at);
  const body = types.slice(at, end < 0 ? undefined : end);
  return new Set([...body.matchAll(/<Name>(SPELL_\w+)<\/Name>/g)].map((m) => m[1]!));
}

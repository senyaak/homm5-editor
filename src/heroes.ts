// A hero: the character a player commands, as a document of our own.
//
// Unlike a creature or an artifact, a hero costs the game NOTHING global. There
// is no hero reference table, no enum in types.xml and no compiled ceiling: the
// executable does not carry so much as a hero's name (`strings` over
// H5_Game.exe finds no Ossir, no Elleshar, no Nadaur). Everything that reaches
// a hero reaches him by PATH — a map's `AvailableHeroes`, the RMG's `HeroPool`,
// the random-hero groups under `MapObjects/_(AdvMapSharedGroup)/Heroes/`, and
// the `Shared` href of every hero standing on a map:
//
//   <Item href="/MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)"/>
//
// So a new hero is a new file at a path nobody owns, and nothing of the game's
// is overwritten. That is the whole mechanism.
//
// WHY A DONOR. The document has 43 fields of its own, and a third of them are
// art: Model, AnimSet, HeroCharacterArena/Adventure, CombatVisual, Selection,
// Trace, Decal, the sounds. Writing those from nothing means inventing a
// character; taking them from a shipped hero of the same faction means the new
// one walks, fights and leaves footprints from the first launch. So a hero is
// built by READING one and replacing what makes him himself — the same shape as
// a creature's donor, and for the same reason.
//
// The art is REFERENCED, not copied, which is where a hero differs from a
// creature. A creature copies its donor's whole art closure so that recolouring
// its texture cannot reach the original; a hero has no art of his own to edit
// yet, so pointing at the shipped model is honest and costs three kilobytes
// instead of two megabytes. The day a hero wants his own look, the copying is
// creature-mod's to do and this is where it would hook in.
//
// WHAT MAKES HIM HIMSELF. Four fields decide who he is, and none of them can be
// reached from a map (a placed hero's `Editable` covers stats, skills, spells,
// machines, name and biography — see AdvMapHero/OverrideMask, which is why THIS
// is the only way to author a new character):
//
//   Class          HERO_CLASS_*, one per faction. It picks the skills the level
//                  up offers, and it is what a racial skill is keyed to.
//   TownType       TOWN_*, the tavern he shows up in.
//   Specialization HERO_SPEC_*, with its own name, description and icon.
//   PrimarySkill   the racial slot: a skill and a mastery. It does NOT have to
//                  be the faction's racial skill — the shipped Erasial is a
//                  Demon Lord holding Logistics there instead of Gating, so a
//                  hero without his race's trademark is a configuration the
//                  game ships, not a hack.
//
// SCENARIO HEROES. `ScenarioHero` decides whether he is a person or a fixture:
// of the 118 shipped heroes the 64 with it FALSE are exactly the 64 a map lists
// when its hero roster is fully checked, and the 54 with it true are in no pool
// at all. So false means every tavern of his faction may offer him, and true
// means he exists only where he is placed by hand or by script.

import { childText, find, parse, serialize, setText } from './xml.ts';
import type { XmlElement, XmlNode } from './xml.ts';

/** The line ending every shipped document uses, and so does ours. */
const EOL = '\r\n';

/** The document's own type — the class every hero file declares. */
export const HERO_CLASS = 'AdvMapHeroShared';

/** Where a hero's own files live in the mod. */
export const HERO_DIR = 'Heroes';

/**
 * Where his palette entry goes.
 *
 * The Objects tab is built from `MapObjects/_(AdvMapObjectLink)/**` — one small
 * file per entry, pointing at a shared definition — and it is read through the
 * mounted chain, so a mod that drops one there gains a palette entry. Without
 * it a hero exists for taverns and for a map's roster, but cannot be PLACED,
 * which is how the shipped heroes are reached too: every one of them has a link
 * beside him under `Heroes/<faction>/`.
 */
export const LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Heroes/Ours';

/** One of the four masteries a skill is held at. */
export type Mastery = 'MASTERY_NONE' | 'MASTERY_BASIC' | 'MASTERY_ADVANCED' | 'MASTERY_EXPERT';

/** A skill at a mastery — what `skills` and `PrimarySkill` are made of. */
export interface SkillAt {
  /** `HERO_SKILL_…` */
  skill: string;
  mastery: Mastery;
}

/** The four numbers a hero starts with. Anything omitted keeps the donor's. */
export interface HeroStats {
  offence?: number;
  defence?: number;
  spellpower?: number;
  knowledge?: number;
}

/**
 * The art a hero wears — each an href, each optional.
 *
 * The counts are how many DISTINCT values the shipped 118 use, which is why
 * these are dropdowns and not free text: the choice is small and known.
 */
export interface HeroArt {
  /** The adventure-map model. 28 among the shipped heroes. */
  model?: string;
  /** Its animations. 29. */
  animSet?: string;
  /** The character that fights in the arena. 38. */
  arena?: string;
  /** Its melee variant, where one exists. 14. */
  arenaMelee?: string;
  /** The character that walks the adventure map. 37. */
  adventure?: string;
  /** What the combat screen draws him from. 14. */
  combatVisual?: string;
  /** The marker under a selected hero. 8. */
  selection?: string;
  /** The footprints he leaves. 8. */
  trace?: string;
  /** His own camera in the hero screen, where he has one. 5. */
  camera?: string;
  /** The 128x128 icon some heroes carry beside their portrait. 13. */
  icon128?: string;
  /** The music his presence brings. 20. */
  music?: string;
}

/** The war machines he brings. */
export interface HeroMachines {
  ballista?: boolean;
  firstAidTent?: boolean;
  ammoCart?: boolean;
}

/** A hero to add to the mod. */
export interface HeroSpec {
  /**
   * His unique identifier — one string, doing both jobs it has to do.
   *
   * It is the `<InternalName>` in his document, which is what a campaign
   * carries a levelled hero between missions by (docs/CAMPAIGNS.md) and what a
   * script names him with; and it is the stem of every file made for him. Those
   * were two fields for a while, and they were the same string in every case
   * anyone wrote — so it is one, and the one rule that matters holds for both:
   * no shipped hero and no hero of the mod may already answer to it.
   */
  id: string;
  name: string;
  biography: string;
  /**
   * The document his STRUCTURE is taken from, data-root-relative.
   *
   * Not a donor in the sense the creature side means it: everything a person
   * would ever choose is a field of its own below, and the form fills those
   * from a preset the moment one is picked. What this still supplies is the
   * seven fields that are the SAME in all 118 shipped heroes — the visibility
   * type, the flyby message, the race-trait text, WaterBased, TerrainAligned,
   * ArrowButtonState, RazedStatic — plus the shape and field order of the
   * document itself. Nobody needs to be asked about those.
   */
  basedOn: string;
  /**
   * What he looks like. Every one of these is an href into the game's data or
   * into the mod's own folder; anything omitted stays as `basedOn` has it.
   *
   * They are a group of their own because they are not gameplay: a hero is
   * authored by his faction, his specialization and his skills, and the model
   * he wears is a separate question that most heroes never ask.
   */
  art?: HeroArt;
  /** `TOWN_…` — whose tavern offers him. */
  town: string;
  /** `HERO_CLASS_…` — one per faction; it decides what a level up offers. */
  heroClass: string;
  /**
   * `HERO_SPEC_…`. Omitted, the donor's specialization and its texts stand.
   *
   * The value is an enum and nothing else: what it DOES is compiled into the
   * executable against that value, and no table binds one to a faction. So a
   * Sylvan hero may hold a Necropolis specialization and get its behaviour —
   * HERO_SPEC_EMPIRIC makes the first aid tent heal five more per level for
   * whoever carries it. What is not shared is the words: name, description and
   * icon are hrefs on the HERO, so a borrowed specialization shows the lender's
   * texts unless its own are given below.
   */
  specialization?: string;
  /** The specialization's name, as the hero screen prints it. */
  specializationName?: string;
  /** Its description — what the specialization does, in words. */
  specializationDescription?: string;
  /** href of its icon. Omitted, the donor's — which may be the wrong picture. */
  specializationIcon?: string;
  /**
   * The racial slot. Omitted, the donor's stands; a hero of the faction's own
   * racial skill is the ordinary case, and anything else is deliberate.
   */
  primarySkill?: SkillAt;
  /** Starting stats. Anything omitted keeps the donor's number. */
  stats?: HeroStats;
  /** Starting secondary skills, beyond the racial one. Given, it replaces the donor's. */
  skills?: SkillAt[];
  /** Starting perks. Given, it replaces the donor's. */
  perks?: string[];
  /** Starting spells. Given, it replaces the donor's. */
  spells?: string[];
  /** War machines. Anything omitted keeps the donor's answer. */
  machines?: HeroMachines;
  /**
   * True keeps him out of every tavern: he exists only where he is placed.
   * Defaults to false — a new hero is a person unless he is a fixture.
   */
  scenarioHero?: boolean;
  /**
   * Files of the author's own, to be copied into his folder when he is built.
   *
   * Keyed by the href they will be reachable at inside the mod, valued by where
   * the file sits now. Already in the game's format — this copies, it does not
   * convert — so what lands in the archive is the bytes that were chosen.
   */
  ownFiles?: Record<string, string>;
  /** href of a 128x128 portrait. Omitted, the donor's face is worn. */
  face?: string;
  /** href of the 64x64 portrait. Omitted, the donor's. */
  faceSmall?: string;
}

/** Every path a hero owns in the mod. */
export interface HeroPaths {
  dir: string;
  shared: string;
  /** His palette entry, so the editor's Objects tab can place him. */
  link: string;
  name: string;
  biography: string;
  /** Where his specialization's own texts go, when he does not borrow them. */
  specName: string;
  specDescription: string;
}

/** Where each of a hero's files goes. */
export function heroPaths(spec: Pick<HeroSpec, 'id'>): HeroPaths {
  const dir = `${HERO_DIR}/${spec.id}`;
  return {
    dir,
    shared: `${dir}/${spec.id}.(${HERO_CLASS}).xdb`,
    link: `${LINK_DIR}/${spec.id}.xdb`,
    name: `${dir}/${spec.id}_Name.txt`,
    biography: `${dir}/${spec.id}_Bio.txt`,
    specName: `${dir}/${spec.id}_SpecName.txt`,
    specDescription: `${dir}/${spec.id}_SpecDesc.txt`,
  };
}

/** The href a map, a pool or a group points at to reach this hero. */
export function heroHref(p: HeroPaths): string {
  return `/${p.shared}#xpointer(/${HERO_CLASS})`;
}

/** Set a child's text, making nothing up: a field the donor lacks is an error. */
function set(el: XmlElement, field: string, value: string | number): void {
  const child = find(el, field);
  if (!child) throw new Error(`the donor has no <${field}>`);
  setText(child, value);
}

/** Point a child href at a file, keeping the pointer the donor used. */
function point(el: XmlElement, field: string, href: string): void {
  const child = find(el, field);
  if (!child) throw new Error(`the donor has no <${field}>`);
  const was = child.attrs.href ?? '';
  const ptr = was.includes('#') ? was.slice(was.indexOf('#')) : '';
  child.attrs.href = href.includes('#') ? href : href + ptr;
  child._dirtyAttrs = true;
}

const element = (name: string, kids: XmlNode[]): XmlElement =>
  ({ type: 'element', name, rawAttrs: '', attrs: {}, children: kids, selfClose: false });
const textNode = (value: string): XmlNode => ({ type: 'text', text: value });

/**
 * The whitespace a list's items are laid out with, taken from the document.
 *
 * A shipped hero is written with tabs, one level per nesting, and a file that
 * reads like the ones beside it is worth the six lines it takes: `diff` on a
 * hero against its donor should show the values that changed and nothing else.
 * The indent of the list itself is what precedes it, so its items sit one tab
 * deeper and its closing tag lines up with its opening one.
 */
function indents(parent: XmlElement, list: XmlElement): { item: string; close: string } {
  const at = parent.children.indexOf(list);
  const before = parent.children[at - 1];
  const own = before && before.type === 'text' ? before.text.slice(before.text.lastIndexOf('\n') + 1) : '\t\t';
  return { item: `\n${own}\t`, close: `\n${own}` };
}

/** Replace a list's `<Item>`s, keeping the file's own indentation. */
function setList(parent: XmlElement, field: string, build: (indent: string) => XmlElement[]): void {
  const list = find(parent, field);
  if (!list) throw new Error(`the donor has no <${field}>`);
  const { item, close } = indents(parent, list);
  const items = build(item);
  list.selfClose = !items.length;
  list.children = [];
  for (const it of items) list.children.push(textNode(item), it);
  if (items.length) list.children.push(textNode(close));
}

/** Replace a list of plain `<Item>value</Item>` entries. */
function setItems(el: XmlElement, field: string, items: readonly string[]): void {
  setList(el, field, () => items.map((v) => element('Item', [textNode(v)])));
}

/** Replace a list of skill/mastery pairs, as `skills` and `PrimarySkill` hold them. */
function setSkillItems(el: XmlElement, field: string, items: readonly SkillAt[]): void {
  setList(el, field, (indent) => items.map((s) => element('Item', [
    textNode(`${indent}\t`), element('Mastery', [textNode(s.mastery)]),
    textNode(`${indent}\t`), element('SkillID', [textNode(s.skill)]),
    textNode(indent),
  ])));
}

/**
 * The hero's document: the donor's, with what makes him himself replaced.
 *
 * `donorXml` is the shipped hero's file, read whole. Fields the spec leaves out
 * are the donor's on purpose — that is what makes a hero three kilobytes and
 * not a character sheet nobody filled in.
 */
export function heroDoc(spec: HeroSpec, donorXml: string, p: HeroPaths = heroPaths(spec)): string {
  const doc = parse(donorXml);
  const root = doc.name === HERO_CLASS ? doc : find(doc, HERO_CLASS);
  if (!root) throw new Error(`the donor is no ${HERO_CLASS}`);

  set(root, 'InternalName', spec.id);
  set(root, 'Class', spec.heroClass);
  set(root, 'TownType', spec.town);
  set(root, 'ScenarioHero', String(!!spec.scenarioHero));

  if (spec.specialization) set(root, 'Specialization', spec.specialization);
  // A borrowed specialization keeps the lender's words unless ours are given,
  // which is how a Sylvan hero ends up described as a Necropolis embalmer.
  if (spec.specializationName) point(root, 'SpecializationNameFileRef', `/${p.specName}`);
  if (spec.specializationDescription) point(root, 'SpecializationDescFileRef', `/${p.specDescription}`);
  if (spec.specializationIcon) point(root, 'SpecializationIcon', spec.specializationIcon);
  if (spec.face) point(root, 'FaceTexture', spec.face);
  if (spec.faceSmall) point(root, 'FaceTextureSmall', spec.faceSmall);

  // What he looks like. Each is a plain href swap, and anything not chosen is
  // left as the document we started from has it.
  const art = spec.art ?? {};
  for (const [field, href] of [
    ['Model', art.model], ['AnimSet', art.animSet],
    ['HeroCharacterArena', art.arena], ['HeroCharacterArenaMelee', art.arenaMelee],
    ['HeroCharacterAdventure', art.adventure], ['CombatVisual', art.combatVisual],
    ['Selection', art.selection], ['Trace', art.trace],
    ['HeroIndividualCamera', art.camera], ['Icon128', art.icon128],
    ['AdventureMusic', art.music],
  ] as const) {
    if (href) point(root, field, href);
  }

  if (spec.primarySkill) {
    const slot = find(root, 'PrimarySkill');
    if (!slot) throw new Error('the donor has no <PrimarySkill>');
    set(slot, 'Mastery', spec.primarySkill.mastery);
    set(slot, 'SkillID', spec.primarySkill.skill);
  }

  const editable = find(root, 'Editable');
  if (!editable) throw new Error('the donor has no <Editable>');

  point(editable, 'NameFileRef', `/${p.name}`);
  point(editable, 'BiographyFileRef', `/${p.biography}`);

  const stats = spec.stats ?? {};
  if (stats.offence !== undefined) set(editable, 'Offence', stats.offence);
  if (stats.defence !== undefined) set(editable, 'Defence', stats.defence);
  if (stats.spellpower !== undefined) set(editable, 'Spellpower', stats.spellpower);
  if (stats.knowledge !== undefined) set(editable, 'Knowledge', stats.knowledge);

  if (spec.skills) setSkillItems(editable, 'skills', spec.skills);
  if (spec.perks) setItems(editable, 'perkIDs', spec.perks);
  if (spec.spells) setItems(editable, 'spellIDs', spec.spells);

  const m = spec.machines ?? {};
  if (m.ballista !== undefined) set(editable, 'Ballista', String(m.ballista));
  if (m.firstAidTent !== undefined) set(editable, 'FirstAidTent', String(m.firstAidTent));
  if (m.ammoCart !== undefined) set(editable, 'AmmoCart', String(m.ammoCart));

  return serialize(doc);
}

/** The palette entry: a link file pointing at our hero. */
export function heroLink(p: HeroPaths, icon = ''): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `	<Link href="${heroHref(p)}"/>`,
    '	<RndGroup/>',
    `	<IconFile>${icon}</IconFile>`,
    '	<HideInEditor>false</HideInEditor>',
    '</AdvMapObjectLink>',
  ].join(EOL) + EOL;
}

/** The `<InternalName>` of a hero document — what a campaign carries him under. */
export function heroInternalName(xml: string): string {
  const doc = parse(xml);
  const root = doc.name === HERO_CLASS ? doc : find(doc, HERO_CLASS);
  return root ? childText(root, 'InternalName') : '';
}

/**
 * Every identifier a hero already answers to, across the mounted chain.
 *
 * BOTH halves of it, because the one string does two jobs: the `InternalName`
 * inside each document — what a campaign and a script name him by — and the
 * file stem, which is what a path collision would be. A new hero must clash
 * with neither, and the shipped 118 are as much in the way as the mod's own.
 *
 * `heroes` is the roster (registry.heroes()); `read` turns one of its hrefs
 * into the document's text.
 */
export function takenHeroIds(
  heroes: readonly { id: string }[],
  read: (path: string) => string | null,
): Set<string> {
  const taken = new Set<string>();
  for (const h of heroes) {
    const path = h.id.split('#')[0]!.replace(/^\/+/, '');
    taken.add(path.split('/').pop()!.replace(/\.\([^)]*\)\.xdb$/i, '').replace(/\.xdb$/i, ''));
    const name = heroInternalName(read(path) ?? '');
    if (name) taken.add(name);
  }
  return taken;
}

/** Which document field each art slot lives in. */
export const ART_FIELDS: Readonly<Record<keyof HeroArt, string>> = {
  model: 'Model', animSet: 'AnimSet',
  arena: 'HeroCharacterArena', arenaMelee: 'HeroCharacterArenaMelee',
  adventure: 'HeroCharacterAdventure', combatVisual: 'CombatVisual',
  selection: 'Selection', trace: 'Trace', camera: 'HeroIndividualCamera',
  icon128: 'Icon128', music: 'AdventureMusic',
};

/** The portrait and icon slots, which are hrefs on the hero like the rest. */
export const FACE_FIELDS = {
  face: 'FaceTexture', faceSmall: 'FaceTextureSmall', specializationIcon: 'SpecializationIcon',
} as const;

/** Read one hero's art out of his document, slot by slot. */
export function artOf(xml: string): Record<string, string> {
  const doc = parse(xml);
  const root = doc.name === HERO_CLASS ? doc : find(doc, HERO_CLASS);
  const out: Record<string, string> = {};
  if (!root) return out;
  for (const [slot, field] of Object.entries({ ...ART_FIELDS, ...FACE_FIELDS })) {
    const href = find(root, field)?.attrs.href ?? '';
    if (href) out[slot] = href;
  }
  return out;
}

/**
 * Every value the shipped heroes use, per art slot — the dropdowns' universe.
 *
 * Gathered from the heroes themselves rather than by scanning the data tree:
 * `Textures/` alone holds thousands of files, while what heroes actually wear
 * is 28 models, 29 animation sets and 8 traces. A short list of things known to
 * work beats a long list of everything that exists.
 */
export function artChoices(
  heroes: readonly { id: string }[],
  read: (path: string) => string | null,
): Record<string, string[]> {
  const seen: Record<string, Set<string>> = {};
  for (const h of heroes) {
    const xml = read(h.id.split('#')[0]!.replace(/^\/+/, ''));
    if (!xml) continue;
    for (const [slot, href] of Object.entries(artOf(xml))) {
      (seen[slot] ??= new Set()).add(href);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [slot, set] of Object.entries(seen)) out[slot] = [...set].sort();
  return out;
}

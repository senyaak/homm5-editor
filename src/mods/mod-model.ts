// The mod as a document: what a creature, artifact, set, hero or dwelling is,
// and the edits the editor makes to a set of them.
//
// Everything here is plain data and plain edits — no reading, no building, no
// archive. The build (creature-mod.ts and the *-files modules beside it) turns
// this into the game's files; the manifest inside a built mod is this object
// serialised, which is how provenance survives a round trip.
//
// The one rule the edits share: ids are assigned once and never reused. A
// creature's id indexes the reference table the executable's ceiling counts,
// so renumbering a set after a removal would silently repoint every map that
// already placed one.



import { SHIPPED_CREATURES, blankStats } from './creatures.ts';
import { SHIPPED_ARTIFACTS } from './artifacts.ts';
import { ORIGINAL_ARTIFACTS } from '../exe/artifact-limit.ts';
import { MOD_STEM } from './mod-files.ts';
import type { CreatureStats } from './creatures.ts';
import type { ArtifactSpec } from './artifacts.ts';
import type { SetEffect } from './artifact-effects.ts';
import type { BuildingSpec } from './buildings.ts';
import type { DwellingSpec } from './dwellings.ts';
import type { HeroSpec } from './heroes.ts';
import type { RecolorOps } from '../format/recolor.ts';
import type { ArtSlot } from './mod-art.ts';

/** The last creature the shipped enum lists — our anchor for appending to it. */
export const LAST_SHIPPED = 'CREATURE_CYCLOP_BLOODEYED';

/**
 * Where our inline objects number from. Record ids look file-local for creatures
 * that ship as files (None is 2, the Skeleton 64), but every table that inlines
 * its objects numbers from 1000000 and the addon reaches 1000059. Starting at
 * 1001000 stays clear of both and marks the range as ours.
 */
export const FIRST_RECORD_ID = 1001000;

// --- what a creature is ------------------------------------------------------

/** A creature as the editor takes it in. */
export interface CreatureSpec {
  /** `CREATURE_…`. Its NUMBER is what maps and saves store — see addCreature. */
  id: string;
  /** The stem of every file generated for it, and of its folder in the mod. */
  file: string;
  name: string;
  description: string;
  /**
   * The ability line the hire dialog prints, in words rather than ids.
   *
   * Normally absent: it is BUILT from `stats.abilities` at build time, out of
   * the names the game itself prints (`CombatAbilities.xdb`). It used to be a
   * box beside the ability picker, and two places saying what a creature can do
   * meant the sentence went stale the moment an ability was added. Set it only
   * to say something else on purpose.
   */
  abilitiesText?: string;
  stats: CreatureStats;
  /** The shipped `CreatureVisual` this creature's own starts from. */
  visualSource: string;
  /** And the shipped `AdvMapMonsterShared` its map stack starts from. */
  monsterSource: string;
  /**
   * The shipped creature those two were resolved from, kept so that opening
   * this one for editing does not mean picking a preset again — which is what
   * a hero has recorded all along (`basedOn`). Absent on creatures made before
   * it was written down; the update path then keeps the sources it already has.
   */
  donor?: string;
  /**
   * Art to use instead of what those two point at. Anything omitted is taken
   * from the source documents, so a bare spec already works.
   */
  art?: Partial<Record<ArtSlot, string>>;
  /**
   * Paint the copied textures on the way in.
   *
   * DECLARATIVE, and it has to be: a build copies the art off the donor every
   * time, so paint applied to the archive's bytes afterwards is undone by the
   * next thing that touches the mod — add an artifact, and the creature is the
   * donor's colours again with nothing anywhere to say it ever was not. Kept
   * here, every build reapplies it and the manifest can say what a creature
   * looks like.
   */
  recolor?: RecolorOps;
}

/** One in a mod: a spec, plus the id number it holds and what it actually got. */
export interface ModCreature extends CreatureSpec {
  /** Its id number. Assigned on the way in and never changed — see addCreature. */
  number: number;
  /** The art each slot resolved to, in the game's data. Provenance. */
  from: Record<ArtSlot, string>;
}

/** The mod itself. */
export interface CreatureMod {
  /** Bumped only if the manifest's shape changes incompatibly. */
  version: 1;
  /** The archive's name stem. */
  stem: string;
  /** The id the mod's creatures start at — the shipped count when it was made. */
  first: number;
  creatures: ModCreature[];
  /**
   * Buildings that hire creatures. In the same mod because they are the same
   * delivery — one archive, one install — but they cost the game nothing global:
   * no reference table, no ceiling, no patched executable. A mod of nothing but
   * dwellings needs no patched game at all. See src/dwellings.ts.
   */
  dwellings: DwellingSpec[];
  /**
   * Everything else a hero walks up to — the sixteen classes of
   * docs/mapPlaceables/buildings/BUILDINGS.md, a dwelling among them.
   *
   * Like a dwelling it costs the game nothing global: no reference table, no
   * ceiling, no patched executable, just a document picking one of the 128
   * behaviours compiled into the game. Unlike the old dwellings it is
   * SELF-CONTAINED — art, sounds, effects and every line of text are its own
   * copies, so all of it can be edited. See src/mods/buildings.ts.
   */
  buildings: BuildingSpec[];
  /**
   * Things a hero wears. Like creatures they hold a NUMBER and extend a
   * reference table, so the list is append-only for the same reason — but
   * unlike creatures the table's size is declared only in types.xml and not in
   * the executable, so artifacts need no patched game either.
   */
  artifacts: ModArtifact[];
  /**
   * Artifact sets of our own. A set is pure data — an entry in the
   * `ArtifactSetEffect` enum and a row in `DefaultStats.xdb` — so the game
   * counts our worn pieces, names the set and draws its tooltip without any
   * code. What it will not do is give the set an EFFECT: every shipped set's
   * behaviour is compiled against its enum value, and ours is a value the
   * executable has never heard of. See docs/ENGINE_INTERNALS.md.
   */
  sets: ModArtifactSet[];
  /**
   * Heroes of our own — the cheapest thing in the archive.
   *
   * Cheaper even than a dwelling: a dwelling at least declares a BUILDING_ type,
   * while a hero has no enum, no reference table and no ceiling anywhere, and
   * the executable does not carry so much as a shipped hero's name. Everything
   * that reaches a hero reaches him by PATH, so a new one is a file nobody owns
   * and the game's own files stay untouched. See src/heroes.ts.
   */
  heroes: HeroSpec[];
}

/** One in a mod: a spec plus the id number it holds. */
export interface ModArtifact extends ArtifactSpec {
  /** Its id number, assigned on the way in and never changed. */
  number: number;
}

/** A set of artifacts that count together. */
export interface ArtifactSetSpec {
  /** Its enum name, ours, appended to `ArtifactSetEffect` — `ARTFSET_EFFECT_…`. */
  effect: string;
  /** Member artifact ids, shipped or ours. Two or more, or nothing combines. */
  artifacts: string[];
  /** File stem for the set's texts, under `GameMechanics/RPGStats/ArtifactSets/`. */
  file: string;
  name: string;
  description: string;
  /**
   * What the tooltip says at each number of worn pieces: `perCount[0]` is one
   * piece, `perCount[1]` is two, and so on, so the array is as long as
   * `artifacts`. The first entry is blank in every shipped set, because one
   * piece of a set is not a set — which is exactly why the array is indexed
   * from one piece and not from none.
   *
   * A bonus that persists is repeated rather than left blank: the Dragonish
   * set names its two-piece text at both two and three pieces, because the
   * game shows the entry for the count worn and nothing accumulates for it.
   */
  perCount?: string[];
  /**
   * What the set GIVES at a number of pieces worn — the part no data can hold.
   *
   * It goes to the file the native extension reads, not into `DefaultStats`:
   * the `<Effect>` there is one of the game's own eleven behaviours and ours is
   * a twelfth value the executable has never heard of. The extension counts the
   * worn members itself, so the threshold here is OUR number and not one of the
   * engine's compiled ones (which are 2, 3, or 2/4 depending on the set).
   * See src/artifact-effects.ts.
   */
  effects?: SetEffect[];
  /**
   * Lua the set carries — what it does on an EVENT rather than inside a sum.
   *
   * The extension adds numbers to calculations no script can reach; a day
   * starting, a building visited, a battle ending are things the engine already
   * hands to Lua, so they belong here. Written from a preset the author can
   * rewrite, generated head and all: src/artifact-scripts.ts.
   */
  script?: string;
}

/** One in a mod: a spec plus the enum value it holds. */
export interface ModArtifactSet extends ArtifactSetSpec {
  /** Its enum value, assigned on the way in and never changed. */
  number: number;
}

/** A fresh, empty mod. */
export function newCreatureMod(stem = MOD_STEM): CreatureMod {
  return {
    version: 1, stem, first: SHIPPED_CREATURES,
    creatures: [], dwellings: [], buildings: [], artifacts: [], sets: [], heroes: [],
  };
}

/**
 * Append a hero. Like a dwelling he holds no id, so order is cosmetic.
 *
 * The one thing that must not collide is his `InternalName`: a campaign carries
 * a levelled hero from mission to mission under it, so two heroes sharing one
 * would be one character as far as the carry is concerned.
 */
export function addHero(mod: CreatureMod, spec: HeroSpec, taken: ReadonlySet<string> = new Set()): HeroSpec {
  if (!mod.heroes) mod.heroes = [];
  const id = spec.id.trim();
  if (!id) throw new Error('a hero needs an identifier');
  // The game's own heroes are as much in the way as the mod's: the identifier
  // is the InternalName a campaign carries him by AND the stem of his files, so
  // a clash with a shipped hero is a hero who travels as somebody else.
  if (taken.has(id)) throw new Error(`"${id}" is a hero the game already has`);
  if (mod.heroes.some((h) => h.id === id)) throw new Error(`the mod already has a hero called "${id}"`);
  mod.heroes.push({ ...spec, id });
  return mod.heroes[mod.heroes.length - 1]!;
}

/**
 * Append an artifact and give it the next id number.
 *
 * APPEND-ONLY, exactly like creatures: the number is what a map, a save and a
 * script store — never the name — so inserting or reordering silently repoints
 * every artifact after it.
 */
export function addArtifact(mod: CreatureMod, spec: ArtifactSpec): ModArtifact {
  if (!mod.artifacts) mod.artifacts = [];
  if (mod.artifacts.some((a) => a.id === spec.id)) throw new Error(`${spec.id} is already in the mod`);
  if (!/^ARTIFACT_[A-Z0-9_]+$/.test(spec.id)) throw new Error(`${spec.id} is not a usable artifact id`);
  if (mod.artifacts.some((a) => a.file === spec.file)) throw new Error(`two artifacts cannot both be "${spec.file}"`);
  if (!spec.icon && !spec.picture) throw new Error(`${spec.id}: needs either an icon href or a picture to build one from`);
  const a: ModArtifact = { ...spec, number: SHIPPED_ARTIFACTS + mod.artifacts.length };
  mod.artifacts.push(a);
  return a;
}

/**
 * Append an artifact set and give it the next effect value.
 *
 * APPEND-ONLY for the same reason artifacts are: `<Effect>` is written by name
 * but stored as a number, so inserting ahead of a shipped set repoints every
 * set after it — including the Necromancer set the necromancy sum asks for by
 * the literal 5.
 */
export function addArtifactSet(mod: CreatureMod, spec: ArtifactSetSpec): ModArtifactSet {
  if (!mod.sets) mod.sets = [];
  if (!/^ARTFSET_EFFECT_[A-Z0-9_]+$/.test(spec.effect)) throw new Error(`${spec.effect} is not a usable set effect`);
  if (mod.sets.some((s) => s.effect === spec.effect)) throw new Error(`${spec.effect} is already in the mod`);
  if (SHIPPED_SET_EFFECTS_BY_NAME.includes(spec.effect)) throw new Error(`${spec.effect} is the game's own set`);
  if (mod.sets.some((s) => s.file === spec.file)) throw new Error(`two sets cannot both be "${spec.file}"`);
  if (spec.artifacts.length < 2) throw new Error(`${spec.effect}: a set of ${spec.artifacts.length} never combines`);
  const s: ModArtifactSet = { ...spec, number: SHIPPED_SET_EFFECTS + mod.sets.length };
  mod.sets.push(s);
  return s;
}

/**
 * Change an artifact already in the mod, keeping its number.
 *
 * Everything except `id` may move. The id may not: it is how a map, a script
 * and this manifest name the same thing, and renaming it here would leave every
 * reference pointing at nothing.
 */
export function updateArtifact(mod: CreatureMod, id: string, spec: ArtifactSpec): ModArtifact {
  const at = (mod.artifacts ?? []).findIndex((a) => a.id === id);
  if (at < 0) throw new Error(`${id} is not in the mod`);
  if (spec.id !== id) throw new Error(`an artifact cannot be renamed — ${id} is what maps and scripts store`);
  const kept = mod.artifacts[at]!;
  if (mod.artifacts.some((a, i) => i !== at && a.file === spec.file)) {
    throw new Error(`two artifacts cannot both be "${spec.file}"`);
  }
  const updated: ModArtifact = { ...spec, number: kept.number };
  mod.artifacts[at] = updated;
  return updated;
}

/**
 * Take an artifact out of the mod.
 *
 * A plain removal, and the numbers behind it close up. That is safe for MAPS,
 * which name an artifact by its enum name and never by its number — checked in
 * a shipped map rather than assumed, because the assumption ran the other way
 * for a while and produced a design that quietly broke the thing it protected.
 *
 * What removing one DOES break is any map that names it, and that is found
 * exactly by searching for the name — src/artifact-usage.ts, which the caller
 * is expected to run first so the person deciding can see the list.
 *
 * A saved game in progress stores numbers and will not survive the renumbering.
 * Nothing here can see inside one, so it is said rather than detected.
 */
export function removeArtifact(mod: CreatureMod, id: string): ModArtifact {
  const list = mod.artifacts ?? [];
  const at = list.findIndex((a) => a.id === id);
  if (at < 0) throw new Error(`${id} is not in the mod`);
  const removed = list.splice(at, 1)[0]!;
  // Close the gap. The numbers are ours and run from the shipped count.
  list.forEach((a, i) => { a.number = SHIPPED_ARTIFACTS + i; });
  return removed;
}

/**
 * Change a set already in the mod, keeping its effect value.
 *
 * The effect may not be renamed: `DefaultStats` names it, the enum in
 * types.xml holds it, and our effects file will one day too. Members, texts and
 * per-count lines are all free to move.
 */
export function updateArtifactSet(mod: CreatureMod, effect: string, spec: ArtifactSetSpec): ModArtifactSet {
  const at = (mod.sets ?? []).findIndex((s) => s.effect === effect);
  if (at < 0) throw new Error(`${effect} is not in the mod`);
  if (spec.effect !== effect) throw new Error(`a set effect cannot be renamed — ${effect} is what the data names`);
  if (spec.artifacts.length < 2) throw new Error(`${effect}: a set of ${spec.artifacts.length} never combines`);
  const updated: ModArtifactSet = { ...spec, number: mod.sets[at]!.number };
  mod.sets[at] = updated;
  return updated;
}

/**
 * Take a set out of the mod.
 *
 * Freer than an artifact: a set's effect value is named by `DefaultStats` and
 * by our effects file, and neither a map nor a save stores it — so removing one
 * from the middle costs nothing but the renumbering of our own later sets,
 * which the next build writes out anyway.
 */
export function removeArtifactSet(mod: CreatureMod, effect: string): ModArtifactSet {
  const list = mod.sets ?? [];
  const at = list.findIndex((s) => s.effect === effect);
  if (at < 0) throw new Error(`${effect} is not in the mod`);
  const gone = list.splice(at, 1)[0]!;
  // Close the gap: the values are ours and contiguous from the shipped count.
  list.forEach((s, i) => { s.number = SHIPPED_SET_EFFECTS + i; });
  return gone;
}

/**
 * Take a dwelling out of the mod, by its file stem.
 *
 * Nothing numbers a dwelling — it is an object with a document and a palette
 * entry, not a row in a reference table — so this is a plain removal with no
 * renumbering behind it. What it breaks is a map that has one placed: the
 * object's `Shared` href stops resolving, exactly as a deleted artifact breaks
 * a map that names it.
 */
/**
 * Drop a hero. Nothing renumbers: he holds no id, so removing one is removing
 * three files and the manifest entry that named them.
 */
/**
 * Change a hero already in the mod, keeping his identity.
 *
 * The identifier is fixed for the same reason an artifact's id is: a campaign
 * carries him by it and a map's roster names his path. Changing it would be a
 * different hero, so that is what removing and adding is for.
 */
export function updateHero(mod: CreatureMod, id: string, spec: HeroSpec): HeroSpec {
  const at = (mod.heroes ?? []).findIndex((h) => h.id === id);
  if (at < 0) throw new Error(`${id} is not in the mod`);
  mod.heroes[at] = { ...spec, id };
  return mod.heroes[at]!;
}

export function removeHero(mod: CreatureMod, id: string): HeroSpec {
  const at = (mod.heroes ?? []).findIndex((h) => h.id === id);
  if (at < 0) throw new Error(`${id} is not in the mod`);
  return mod.heroes.splice(at, 1)[0]!;
}

export function removeDwelling(mod: CreatureMod, file: string): DwellingSpec {
  const at = mod.dwellings.findIndex((d) => d.file === file);
  if (at < 0) throw new Error(`${file} is not in the mod`);
  return mod.dwellings.splice(at, 1)[0]!;
}

/**
 * Change a creature already in the mod, keeping its number.
 *
 * The id is fixed for the same reason an artifact's is: it names the same thing
 * in a map, a script and this manifest.
 */
export function updateCreature(mod: CreatureMod, id: string, spec: CreatureSpec): ModCreature {
  const at = mod.creatures.findIndex((c) => c.id === id);
  if (at < 0) throw new Error(`${id} is not in the mod`);
  if (spec.id !== id) throw new Error(`a creature cannot be renamed — ${id} is what maps and scripts store`);
  const kept = mod.creatures[at]!;
  const updated: ModCreature = { ...spec, number: kept.number, from: kept.from };
  mod.creatures[at] = updated;
  return updated;
}

/**
 * Take a creature out of the mod; the numbers behind it close up.
 *
 * Safe for maps, which name a creature rather than numbering it, and the
 * executable's ceiling comes down with it on the next install. What breaks is a
 * map that names THIS one — found by searching for it, the same way artifacts
 * are (src/artifact-usage.ts).
 */
export function removeCreature(mod: CreatureMod, id: string): ModCreature {
  const at = mod.creatures.findIndex((c) => c.id === id);
  if (at < 0) throw new Error(`${id} is not in the mod`);
  const removed = mod.creatures.splice(at, 1)[0]!;
  mod.creatures.forEach((c, i) => { c.number = mod.first + i; });
  return removed;
}

/**
 * Append a building. Like a dwelling it holds no id, so order is cosmetic; the
 * file stem is what has to be unique, since it names its folder in the mod.
 */
export function addBuilding(mod: CreatureMod, spec: BuildingSpec): BuildingSpec {
  if (!mod.buildings) mod.buildings = [];
  const file = spec.file.trim();
  if (!file) throw new Error('a building needs an identifier');
  if (mod.buildings.some((b) => b.file === file)) {
    throw new Error(`two buildings cannot both be "${file}"`);
  }
  mod.buildings.push(spec);
  return spec;
}

/** Change a building already in the mod, keeping its place in the list. */
export function updateBuilding(mod: CreatureMod, file: string, spec: BuildingSpec): BuildingSpec {
  const at = (mod.buildings ?? []).findIndex((b) => b.file === file);
  if (at < 0) throw new Error(`${file} is not in the mod`);
  if (spec.file !== file) throw new Error(`a building cannot be renamed — ${file} names its folder and its files`);
  mod.buildings[at] = spec;
  return spec;
}

export function removeBuilding(mod: CreatureMod, file: string): BuildingSpec {
  const at = (mod.buildings ?? []).findIndex((b) => b.file === file);
  if (at < 0) throw new Error(`${file} is not in the mod`);
  return mod.buildings.splice(at, 1)[0]!;
}

/** Append a dwelling. Unlike a creature it holds no id, so order is cosmetic. */
export function addDwelling(mod: CreatureMod, spec: DwellingSpec): DwellingSpec {
  if (!spec.creatures.length) throw new Error(`${spec.file}: a dwelling with no creatures hires nothing`);
  if (mod.dwellings.some((d) => d.file === spec.file)) {
    throw new Error(`two dwellings cannot both be "${spec.file}"`);
  }
  mod.dwellings.push(spec);
  return spec;
}

/**
 * What the executable's creature ceiling has to be patched to for this mod.
 *
 * The two must agree EXACTLY. Patch higher and the ids past the mod are empty,
 * which stops the game; patch lower and the mod's last creatures do not exist.
 */
export function creatureLimit(mod: CreatureMod): number {
  return mod.first + mod.creatures.length;
}

/**
 * Append a creature and give it the next id number.
 *
 * THE LIST IS APPEND-ONLY. A creature's number is what maps, saved games and Lua
 * store — never its name — so inserting or reordering silently repoints every
 * creature after it. To drop one, blank it rather than closing the gap up.
 */
export function addCreature(mod: CreatureMod, spec: CreatureSpec): ModCreature {
  if (mod.creatures.some((c) => c.id === spec.id)) throw new Error(`${spec.id} is already in the mod`);
  if (!/^CREATURE_[A-Z0-9_]+$/.test(spec.id)) throw new Error(`${spec.id} is not a usable creature id`);
  if (mod.creatures.some((c) => c.file === spec.file)) throw new Error(`two creatures cannot both be "${spec.file}"`);
  const c: ModCreature = {
    ...spec,
    stats: { ...blankStats(), ...spec.stats },
    number: mod.first + mod.creatures.length,
    from: {} as Record<ArtSlot, string>,
  };
  mod.creatures.push(c);
  return c;
}

/**
 * What the executable's artifact ceiling has to be for this mod.
 *
 * The same exact-agreement rule the creature ceiling follows: the number is how
 * many the game believes exist, and the table has to hold precisely that many.
 */
export function artifactLimit(mod: CreatureMod): number {
  return ORIGINAL_ARTIFACTS + (mod.artifacts?.length ?? 0);
}

export const SHIPPED_SET_EFFECTS = 11;
export const SHIPPED_SET_EFFECTS_BY_NAME = [
  'ARTFSET_EFFECT_CUSTOM', 'ARTFSET_EFFECT_DRAGONISH', 'ARTFSET_EFFECT_DWARVEN',
  'ARTFSET_EFFECT_LIONS', 'ARTFSET_EFFECT_MAGIS', 'ARTFSET_EFFECT_NECROMANCERS',
  'ARTFSET_EFFECT_EDUCATIONAL', 'ARTFSET_EFFECT_HUNTERS', 'ARTFSET_EFFECT_OGRES',
  'ARTFSET_EFFECT_RUNIC', 'ARTFSET_EFFECT_DEMONIC',
];

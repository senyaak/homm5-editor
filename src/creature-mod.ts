// The units mod — creatures the game does not ship with, as a project on disk.
//
// A creature added this way is a mod in `<game>/UserMODs/*.h5u`: the same ZIP
// container a pak is, applied after everything in `data/` including the addon's
// own `a2p1-*`. Nothing goes into `data/` and no `index.bin` is needed.
//
// `UserMODs/` is not the only place it can sit. A `.h5m` or a `.h5c` is mounted
// the same way and for the whole session, so these files can travel inside a
// campaign instead of beside it — see docs/ARCHIVES.md, which also covers why two
// maps that each carry a creature set collide exactly as two mods would.
//
// WHAT A MOD HAS TO CARRY. Three of the game's own files, edited:
//
//   types.xml                          the CREATURE_ enum, the name→number map,
//                                      and the ref table's declared size
//   GameMechanics/RefTables/Creatures.xdb   one entry per creature
//   UI/UIGameRoot.(UIGameRoot).xdb     a camera for the hire dialog
//
// and, per creature, five small files of its own plus its art. The `Creature`
// record itself is written INTO the ref table rather than shipped as a file:
// entries may carry their object inline under `href="#n:inline(Creature)"`, which
// is how the game's own WarMachines.xdb and MicroArtifactEffects.xdb are written.
// One camera entry covers every creature — its `<creatures>` is a list, and the
// game hangs Familiar, Imp and Quasit on one.
//
// What does NOT work, since it looks as though it should: pointing several ids at
// one *file*. The ids in WarMachines.xdb that appear to share a file share only
// the literal string `#n:inline(WarMachine)`, which is a marker and not a path.
// Every id needs its own object and its own ObjectRecordID.
//
// THE ART IS COPIED IN, NOT REFERENCED. A creature could point at the shipped
// model it borrows and be a few kilobytes; instead the whole reachable closure of
// that model — geometry, skeleton, animations, materials, textures, sounds and
// the binaries behind them, about 1.7 MB — is copied under the creature's own
// folder. That is the point: with the art inside, swapping a model or recolouring
// a texture is an edit to the mod and changes nothing else, and the mod stays
// self-contained wherever it goes. Copied geometry, skeletons and animations get
// a FRESH uid too, because their binaries are keyed by uid in `bin/…` and sharing
// one would mean editing our creature's mesh edited the original creature's.
//
// See docs/NEW_CREATURES.md in the port for how the ceiling was found and why the
// first several attempts at a mod were read and silently ignored.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, posix } from 'node:path';
import { SHIPPED_CREATURES, NULL_CREATURE, blankStats, creatureRoot, readStats, setCreatureRefs, writeStats } from './creatures.ts';
import type { CreatureStats } from './creatures.ts';
import { serialize, setAttr } from './xml.ts';
import { extract, readEntries, readEntryFrom, readIndex, writeArchive } from './pak.ts';
import type { ZipEntry, ZipIndexEntry } from './pak.ts';
import { MESSAGE_SLOTS, dwellingDoc, dwellingLink, dwellingPaths, footprintOf, isRef, refPath } from './dwellings.ts';
import { extractMeshesStructured, placeGeometry, positionsBox, wideBase } from './geometry.ts';
import type { BBox } from './geometry.ts';
import type { DwellingPaths, DwellingSpec, Footprint } from './dwellings.ts';
import { parseTypeSpec } from './typespec.ts';
import type { SpecType } from './typespec.ts';
import { setCreatureLimit } from './creature-limit.ts';
import { MOD_DIR, ensureModDir, modFile } from './mod-paths.ts';
import { ORIGINAL_ARTIFACTS, setArtifactLimit } from './artifact-limit.ts';
import type { ArtifactExeResult } from './artifact-limit.ts';
import type { ExeResult } from './creature-limit.ts';
import {
  ARTIFACT_CLASS, SHIPPED_ARTIFACTS, artifactLink, artifactPaths, artifactRecord, artifactSharedDoc,
  boardMaterial, boardModel,
} from './artifacts.ts';
import type { ArtifactSpec } from './artifacts.ts';
import type { SetEffect } from './artifact-effects.ts';
import { COMMON_SCRIPT, patchCommonScript, setScriptFiles } from './artifact-scripts.ts';
import { readGif } from './gif.ts';
import { decodeDDSBuffer } from './dds.ts';
import { isIdentity, recolorPixels } from './recolor.ts';
import type { RecolorOps } from './recolor.ts';
import { fitSquare, textureDoc, writeDDS } from './texture.ts';
import { heroDoc, heroLink, heroPaths } from './heroes.ts';
import type { HeroSpec } from './heroes.ts';

/**
 * The mod's file name stem — `homm5-editor.h5u` in UserMODs.
 *
 * Named after the editor, not after any one project, because there can only be
 * ONE of it: creatures and artifacts both extend reference tables declared in
 * `types.xml`, a mod replaces a file whole rather than merging it, and the
 * executable's ceilings count what that one copy holds. So this archive is
 * every global thing the editor adds, whatever the map or campaign it was added
 * for. A project's own content that costs the game nothing global — dwellings
 * and other plain objects — can and should ship in its own archive beside it.
 */
export const MOD_STEM = 'homm5-editor';

/**
 * Our own record of the mod, shipped inside it.
 *
 * The mod is readable without this — ids come out of types.xml's name→number map
 * and stats out of the inline objects — but provenance does not survive that trip.
 * Which shipped model a creature borrowed is the thing you need to re-copy its
 * art or swap it, and nothing in the game's own formats records it.
 */
export const MOD_MANIFEST = 'units.json';

/** The game's files a mod has to edit, all three of them. */
const TYPES = 'types.xml';
const REF_TABLE = 'GameMechanics/RefTables/Creatures.xdb';
const UI_ROOT = 'UI/UIGameRoot.(UIGameRoot).xdb';
/** And the two an artifact adds. */
const ARTIFACT_TABLE = 'GameMechanics/RefTables/Artifacts.xdb';
/**
 * The script the game loads on every adventure map, and where the `ARTIFACT_*`
 * numbers Lua addresses artifacts by are declared. A mod that adds an artifact
 * and not its constant leaves it unnameable from a script.
 */
const STARTUP_SCRIPT = 'scripts/advmap-startup.lua';

/** The last creature the shipped enum lists — our anchor for appending to it. */
const LAST_SHIPPED = 'CREATURE_CYCLOP_BLOODEYED';

/**
 * The same anchor for artifacts, and the two type names their table goes by.
 *
 * `ARTIFACT_PRINCESS` is number 96 and the enum runs straight on into
 * `ABILITY_NONE` — which looks alarming, because inserting into a POSITIONAL
 * enum would renumber every ability after it. It is not positional: both
 * `ARTIFACT_NONE` and `ABILITY_NONE` are 0 in the name→number map, so the list
 * is one set of allowed strings covering two independent numberings, and
 * inserting after the last artifact disturbs nothing.
 */
const LAST_SHIPPED_ARTIFACT = 'ARTIFACT_PRINCESS';
const ARTIFACT_TABLE_TYPE = 'Table_DBArtifact_ArtifactEffect';
const ARTIFACT_RECORD_TYPE = 'DBArtifact';
/** And the Lua constant that says how many there are. */
const ARTIFACT_COUNT_CONST = 'ARTIFACT_ARTIFACT_EFFECT_COUNT';

/**
 * Artifact sets: the file they live in, the enum they extend, and its last
 * shipped member.
 *
 * `ArtifactSetEffect` is an ordinary enum in types.xml — explicit `<Name>` and
 * `<Value>` pairs — so appending to it is as cheap as appending an artifact,
 * and it is why a set of ours can be OURS rather than a shipped one borrowed.
 * `ARTFSET_EFFECT_CUSTOM` (0) is the developers' own "no predefined effect"
 * slot; we leave it alone, along with everything else already there.
 */
const DEFAULT_STATS = 'GameMechanics/RPGStats/DefaultStats.xdb';
const SET_EFFECT_TYPE = 'ArtifactSetEffect';
const SET_TEXT_DIR = 'GameMechanics/RPGStats/ArtifactSets';
const SHIPPED_SET_EFFECTS = 11;
const SHIPPED_SET_EFFECTS_BY_NAME = [
  'ARTFSET_EFFECT_CUSTOM', 'ARTFSET_EFFECT_DRAGONISH', 'ARTFSET_EFFECT_DWARVEN',
  'ARTFSET_EFFECT_LIONS', 'ARTFSET_EFFECT_MAGIS', 'ARTFSET_EFFECT_NECROMANCERS',
  'ARTFSET_EFFECT_EDUCATIONAL', 'ARTFSET_EFFECT_HUNTERS', 'ARTFSET_EFFECT_OGRES',
  'ARTFSET_EFFECT_RUNIC', 'ARTFSET_EFFECT_DEMONIC',
];
const LAST_SHIPPED_SET_EFFECT = 'ARTFSET_EFFECT_DEMONIC';

/** The camera the hire dialog uses. CREATURE_UNKNOWN already sits on this one. */
const HIRE_CAMERA = '/Cameras/Interface/HireCreatures.(Camera).xdb#xpointer(/Camera)';

/**
 * Where our inline objects number from. Record ids look file-local for creatures
 * that ship as files (None is 2, the Skeleton 64), but every table that inlines
 * its objects numbers from 1000000 and the addon reaches 1000059. Starting at
 * 1001000 stays clear of both and marks the range as ours.
 */
const FIRST_RECORD_ID = 1001000;

/** The game's files are CRLF throughout; matching that keeps diffs readable. */
const EOL = '\r\n';

// --- the art a creature borrows ----------------------------------------------

/**
 * The four references that decide what a creature LOOKS like. Each is a document
 * in the game's data that we copy into the mod, so each can be swapped later
 * without the mod's shape changing.
 */
export type ArtSlot = 'character' | 'model' | 'animSet' | 'icon';

/** Which field of which of our two documents each slot fills. */
const ART_FIELD: Record<ArtSlot, { doc: 'visual' | 'monster'; field: string; type: string }> = {
  // What fights: a Character bundles the combat model with its arena animations.
  character: { doc: 'visual', field: 'AnimCharacter', type: 'Character' },
  // What stands on the adventure map. Usually the same model, separately named.
  model: { doc: 'monster', field: 'Model', type: 'Model' },
  animSet: { doc: 'monster', field: 'AnimSet', type: 'AnimSet' },
  // The hire and army icon. A creature without one stops the game at startup,
  // which is how we learned that None.xdb's empty icons are a privilege of id 0.
  icon: { doc: 'visual', field: 'Icon128', type: 'Texture' },
};

export const ART_SLOTS = Object.keys(ART_FIELD) as ArtSlot[];

/**
 * Where a copied `.xdb`'s binary lives, by the document's root element. These
 * are keyed by the uid inside the document, not by its path, which is why a copy
 * that keeps its uid would share one file with the creature it copied from.
 */
const UID_BINS: Record<string, string> = {
  Geometry: 'bin/Geometries',
  AIGeometry: 'bin/AIGeometries',
  Skeleton: 'bin/Skeletons',
  BasicSkelAnim: 'bin/animations',
  Sound: 'bin/Sounds',
  Effect: 'bin/effects',
  Light: 'bin/Lights',
};

// --- what a creature is ------------------------------------------------------

/** A creature as the editor takes it in. */
export interface CreatureSpec {
  /** `CREATURE_…`. Its NUMBER is what maps and saves store — see addCreature. */
  id: string;
  /** The stem of every file generated for it, and of its folder in the mod. */
  file: string;
  name: string;
  description: string;
  /** The ability line the hire dialog prints, in words rather than ids. */
  abilitiesText: string;
  stats: CreatureStats;
  /** The shipped `CreatureVisual` this creature's own starts from. */
  visualSource: string;
  /** And the shipped `AdvMapMonsterShared` its map stack starts from. */
  monsterSource: string;
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
  return { version: 1, stem, first: SHIPPED_CREATURES, creatures: [], dwellings: [], artifacts: [], sets: [], heroes: [] };
}

/**
 * Append a hero. Like a dwelling he holds no id, so order is cosmetic.
 *
 * The one thing that must not collide is his `InternalName`: a campaign carries
 * a levelled hero from mission to mission under it, so two heroes sharing one
 * would be one character as far as the carry is concerned.
 */
export function addHero(mod: CreatureMod, spec: HeroSpec): HeroSpec {
  if (!mod.heroes) mod.heroes = [];
  if (!spec.file.trim()) throw new Error('a hero needs a file stem');
  if (!spec.internalName.trim()) throw new Error(`${spec.file}: a hero needs an internal name to travel under`);
  if (mod.heroes.some((h) => h.file === spec.file)) {
    throw new Error(`two heroes cannot both be "${spec.file}"`);
  }
  if (mod.heroes.some((h) => h.internalName === spec.internalName)) {
    throw new Error(`two heroes cannot both be "${spec.internalName}" — a campaign carries them by that name`);
  }
  mod.heroes.push(spec);
  return spec;
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
export function removeHero(mod: CreatureMod, file: string): HeroSpec {
  const at = (mod.heroes ?? []).findIndex((h) => h.file === file);
  if (at < 0) throw new Error(`${file} is not in the mod`);
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
 * Where the editor's object palette looks for its entries.
 *
 * One tiny file per entry, and it ships in the paks — so a mod that drops one
 * here gains a palette entry, which is how the expansion added its own monsters.
 * Under `Monsters/` because the Filter dropdown's groups are folder prefixes read
 * from `Editor/MapFilters.xml`, a loose file no mod can add to: land outside a
 * known prefix and the entry is filed under "Other" instead of with the monsters.
 */
const LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Monsters/Units';

/** Where a creature's own files sit inside the mod. */
export function creaturePaths(c: CreatureSpec): {
  dir: string; art: string; link: string;
  visual: string; monster: string; name: string; description: string; abilities: string;
} {
  const dir = `Units/${c.file}`;
  return {
    dir,
    link: `${LINK_DIR}/${c.file}.xdb`,
    // The art keeps its original directory structure under here, so every
    // relative href inside it resolves exactly as it did in the game's data.
    art: `${dir}/art`,
    visual: `${dir}/${c.file}.(CreatureVisual).xdb`,
    monster: `${dir}/${c.file}.(AdvMapMonsterShared).xdb`,
    name: `${dir}/${c.file}_Name.txt`,
    description: `${dir}/${c.file}_Desc.txt`,
    abilities: `${dir}/${c.file}_Abils.txt`,
  };
}

// --- reading the game's data --------------------------------------------------

/** Raw bytes of a data path, or null when there is no such file. */
export type DataReader = (rel: string) => Buffer | null;

/** A reader over an unpacked data root. */
export function dataReader(root: string): DataReader {
  return (rel) => {
    const p = join(root, rel);
    try {
      return statSync(p).isFile() ? readFileSync(p) : null;
    } catch {
      return null;
    }
  };
}

// --- building the mod ---------------------------------------------------------

/** A file in the built mod. */
export interface ModFile {
  path: string;
  data: Buffer;
}

/** What a build produced, and what it had to leave out. */
export interface BuildReport {
  files: ModFile[];
  /** The ceiling the executable must be patched to. */
  limit: number;
  /** Art files copied, per creature. */
  art: Record<string, number>;
  /** References we could not resolve — authoring paths, mostly, and harmless. */
  missing: string[];
}

/**
 * Build the whole mod: the three edited game files, and each creature's own five
 * plus its art.
 *
 * Nothing here touches the filesystem — `read` supplies the game's data and the
 * result is a file set, so the same code serves a project folder, an archive and
 * a test.
 */
export function buildCreatureMod(mod: CreatureMod, read: DataReader): BuildReport {
  if (!mod.creatures.length && !mod.dwellings.length && !mod.artifacts?.length
    && !mod.sets?.length && !mod.heroes?.length) {
    throw new Error('the mod is empty');
  }
  const limit = creatureLimit(mod);
  const files: ModFile[] = [];
  const art: Record<string, number> = {};
  const missing: string[] = [];

  for (const c of mod.creatures) {
    const p = creaturePaths(c);
    let visual = mustRead(read, c.visualSource);
    let monster = mustRead(read, c.monsterSource);

    // Resolve each art slot: the spec's override, else whatever the source
    // document already points at. Recorded on the creature either way — the
    // manifest is where provenance lives.
    const sources: Partial<Record<ArtSlot, string>> = {};
    for (const slot of ART_SLOTS) {
      const at = ART_FIELD[slot];
      const found = c.art?.[slot] ?? hrefOf(at.doc === 'visual' ? visual : monster, at.field);
      if (found) sources[slot] = dataPath(found);
    }
    if (!sources.icon) throw new Error(`${c.id}: no icon — a creature without one stops the game at startup`);
    c.from = sources as Record<ArtSlot, string>;

    const copied = copyArt(Object.values(sources), p.art, read, c.id);
    // The paint, if this creature carries any. Applied to the COPIES, so the
    // game's own textures are untouched and a rebuild reproduces the same
    // creature — which is the whole reason it is written down rather than done
    // to the archive afterwards.
    if (c.recolor && !isIdentity(c.recolor)) repaint(copied.files, c.recolor);
    for (const [path, data] of copied.files) files.push({ path, data });
    missing.push(...copied.missing);
    art[c.id] = copied.files.size;

    // Point the two documents at our copies and at our texts.
    for (const slot of ART_SLOTS) {
      const src = sources[slot];
      if (!src) continue;
      const to = copied.at.get(src);
      if (!to) throw new Error(`${c.id}: ${slot} art ${src} is not in the game's data`);
      const at = ART_FIELD[slot];
      const value = `/${to}#xpointer(/${at.type})`;
      if (at.doc === 'visual') visual = setHref(visual, at.field, value, c.visualSource);
      else monster = setHref(monster, at.field, value, c.monsterSource);
    }

    files.push({ path: p.visual, data: Buffer.from(creatureVisual(visual, p, c.visualSource), 'latin1') });
    files.push({ path: p.monster, data: Buffer.from(monsterShared(monster, p, c), 'latin1') });
    // The palette entry. Its icon names the creature's own 128px texture, which
    // the art copy already put in the mod: the editor's thumbnail cache is keyed
    // by link path and a mod has no entry in it, so without this the tile is
    // blank among 185 that are not.
    files.push({ path: p.link, data: Buffer.from(objectLink(p, copied.at.get(sources.icon!) ?? ''), 'latin1') });
    files.push({ path: p.name, data: utf16(c.name) });
    files.push({ path: p.description, data: utf16(c.description) });
    files.push({ path: p.abilities, data: utf16(c.abilitiesText) });
  }

  files.push(...buildDwellings(mod.dwellings, read));
  files.push(...buildArtifacts(mod.artifacts ?? [], read));
  files.push(...buildArtifactSets(mod.sets ?? []));
  files.push(...buildHeroes(mod.heroes ?? [], read));

  // Only creatures need the game's own files touched: the enum and the id→number
  // map in types.xml, the reference table the ceiling indexes, and the hire
  // screen. A mod of nothing but dwellings edits nothing of the game's and needs
  // no patched executable — so it must not carry these at all.
  //
  // Artifacts extend a reference table too, so they touch types.xml as well —
  // but only the artifact half of it, and never the executable. The two patches
  // are applied to the SAME text, in one pass, because a mod that carried both
  // would otherwise ship two types.xml and the second would win whole.
  const artifacts = mod.artifacts ?? [];
  const sets = mod.sets ?? [];
  if (mod.creatures.length || artifacts.length || sets.length) {
    let types = mustRead(read, TYPES);
    if (mod.creatures.length) types = patchTypes(types, mod, limit);
    if (artifacts.length) types = patchArtifactTypes(types, artifacts);
    if (sets.length) types = patchSetTypes(types, sets);
    files.push({ path: TYPES, data: Buffer.from(types, 'latin1') });
  }
  if (mod.creatures.length) {
    files.push({ path: REF_TABLE, data: Buffer.from(patchRefTable(mustRead(read, REF_TABLE), mod, read), 'latin1') });
    files.push({ path: UI_ROOT, data: Buffer.from(patchUiRoot(mustRead(read, UI_ROOT), mod), 'latin1') });
  }
  if (artifacts.length) {
    const spec = parseTypeSpec(mustRead(read, TYPES));
    files.push({
      path: ARTIFACT_TABLE,
      data: Buffer.from(patchArtifactTable(mustRead(read, ARTIFACT_TABLE), artifacts, spec), 'latin1'),
    });
    files.push({
      path: STARTUP_SCRIPT,
      data: Buffer.from(patchStartupScript(mustRead(read, STARTUP_SCRIPT), artifacts), 'latin1'),
    });
  }
  if (sets.length) {
    files.push({
      path: DEFAULT_STATS,
      data: Buffer.from(patchDefaultStats(mustRead(read, DEFAULT_STATS), sets), 'latin1'),
    });
    // A set that carries Lua brings two more files: its own script, and the
    // game's global one with a line loading it. Both only when there is a
    // script — a mod that replaces advmap-common.lua for nothing is a mod that
    // can only break something.
    const scripts = setScriptFiles(sets);
    for (const f of scripts) files.push({ path: f.path, data: Buffer.from(f.text, 'latin1') });
    if (scripts.length) {
      files.push({
        path: COMMON_SCRIPT,
        data: Buffer.from(patchCommonScript(mustRead(read, COMMON_SCRIPT), sets), 'latin1'),
      });
    }
  }

  // Last, so it records the art each slot actually resolved to.
  files.unshift({ path: MOD_MANIFEST, data: Buffer.from(`${JSON.stringify(mod, null, 2)}\n`, 'utf8') });

  return { files, limit, art, missing };
}

/**
 * The geometry a board borrows: one of the game's developer posters.
 *
 * A poster is the only thing shipped that is a bare quad — `Size` 1.43 x 0 x
 * 1.43, one mesh, one material — so a board can reference it and carry nothing
 * of its own but a material and a texture. Which poster does not matter; this
 * one is a rectangle like the rest.
 */
const BOARD_GEOMETRY = '_(Model)/Buildings/Posters/Gudkov-geom.xdb';

/**
 * The files every artifact contributes.
 *
 * Four always — the map object, the palette entry and its two texts — plus the
 * icon when the mod builds one from a picture, plus a board when the artifact
 * has no model of its own.
 */
function buildArtifacts(artifacts: readonly ModArtifact[], read: DataReader): ModFile[] {
  if (!artifacts.length) return [];
  const files: ModFile[] = [];
  const types = parseTypeSpec(mustRead(read, TYPES));

  for (const a of artifacts) {
    const p = artifactPaths(a);

    // The icon first: a board is made OF it, so it has to exist by then.
    if (a.picture) {
      const source = readFileSync(a.picture);
      const image = fitSquare(readGif(source), 64);
      files.push({ path: p.iconDDS, data: writeDDS(image) });
      files.push({
        path: p.icon,
        data: Buffer.from(textureDoc({
          dds: basename(p.iconDDS),
          width: image.width,
          height: image.height,
          // The NAME of the picture, not the path to it. `SrcName` is where a
          // texture came from and nothing reads it at run time; writing the
          // author's own filesystem into a shipped file helps nobody, and the
          // manifest keeps the full path where it belongs.
          source: basename(a.picture),
        }), 'latin1'),
      });
    }

    if (!a.model) {
      const geometry = mustRead(read, BOARD_GEOMETRY);
      const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(geometry)?.[1];
      if (!uid) throw new Error(`${a.file}: ${BOARD_GEOMETRY} names no uid`);
      const bin = mustReadBytes(read, `bin/Geometries/${uid.toUpperCase()}`);

      // The poster hangs in the air where it stood on its post; an artifact lies
      // on the tile it is on. So the mesh is MOVED — its own centre to the
      // origin, its foot to the ground — and scaled to the width asked for.
      // A copy needs a fresh uid as well: the binaries are keyed by it, so a
      // copy that kept the poster's would edit the poster's mesh.
      const box = positionsBox(bin);
      if (!box) throw new Error(`${a.file}: cannot read the board geometry's extent`);
      const tiles = a.board?.tiles ?? 1;
      const scale = (tiles * 2) / Math.max(box.sx, box.sz, 1e-6);
      // The shift is in the SOURCE's units, not the result's: placeGeometry adds
      // it BEFORE scaling. Scaling it too puts the board a long way underground,
      // and further the bigger it is.
      const placed = placeGeometry(bin, {
        scale,
        shift: [-box.cx, -box.cy, -(box.cz - box.sz / 2)],
      });
      if (!placed) throw new Error(`${a.file}: the board geometry could not be moved`);

      const ownUid = uidFor(`board:${a.id}`);
      const doc = retuneBox(geometry, placed.bbox, { scale, shift: [0, 0, 0] })
        .replace(/<uid>[0-9A-Fa-f-]{36}<\/uid>/, `<uid>${ownUid}</uid>`)
        // The AI geometry describes where the walls are for pathing. A flat
        // board has none worth keeping, and a stale one would disagree with the
        // mesh we just moved.
        .replace(/<AIGeometry[^>]*\/>/, '<AIGeometry/>')
        .replace(/<AIGeometry[^>]*>[\s\S]*?<\/AIGeometry>/, '<AIGeometry/>');
      const geomPath = `${p.dir}/${a.file}_Board-geom.xdb`;
      files.push({ path: geomPath, data: Buffer.from(doc, 'latin1') });
      files.push({ path: `bin/Geometries/${ownUid}`, data: placed.data });
      files.push({
        path: p.boardMaterial,
        data: Buffer.from(boardMaterial(`/${a.icon ? refPath(a.icon) : p.icon}`), 'latin1'),
      });
      files.push({
        path: p.board,
        data: Buffer.from(boardModel(`/${p.boardMaterial}`, `/${geomPath}`), 'latin1'),
      });
    }

    files.push({ path: p.shared, data: Buffer.from(artifactSharedDoc(a, p, types), 'latin1') });
    files.push({ path: p.link, data: Buffer.from(artifactLink(p, `/${a.icon ? refPath(a.icon) : p.icon}`), 'latin1') });
    files.push({ path: p.name, data: utf16(a.name) });
    files.push({ path: p.description, data: utf16(a.description) });
  }
  return files;
}

/**
 * The texts a set names: its own, and one per number of worn pieces.
 *
 * Both go where the shipped sets keep theirs, because `NameFileRef` and the
 * rest are hrefs RELATIVE to `DefaultStats.xdb` — a mod that puts them under
 * its own folder writes a path the game resolves against `RPGStats/` and does
 * not find, and the tooltip comes out blank rather than wrong.
 */
function buildArtifactSets(sets: readonly ModArtifactSet[]): ModFile[] {
  const files: ModFile[] = [];
  for (const s of sets) {
    files.push({ path: `${SET_TEXT_DIR}/${s.file}_Name.txt`, data: utf16(s.name) });
    files.push({ path: `${SET_TEXT_DIR}/${s.file}_Desc.txt`, data: utf16(s.description) });
    s.artifacts.forEach((_, i) => {
      const text = s.perCount?.[i];
      if (text) files.push({ path: `${SET_TEXT_DIR}/${s.file}_Desc${i + 1}.txt`, data: utf16(text) });
    });
  }
  return files;
}

/** types.xml, the set half: one enum entry per set of ours, appended. */
function patchSetTypes(types: string, sets: readonly ModArtifactSet[]): string {
  const at = once(types, `<TypeName>${SET_EFFECT_TYPE}</TypeName>`, 'types.xml artifact-set enum');
  const last = types.indexOf(`<Name>${LAST_SHIPPED_SET_EFFECT}</Name>`, at);
  if (last < 0) throw new Error(`types.xml: ${SET_EFFECT_TYPE} does not end at ${LAST_SHIPPED_SET_EFFECT}`);
  const itemEnd = types.indexOf('</Item>', last);
  if (itemEnd < 0) throw new Error('types.xml artifact-set enum: the last entry has no </Item>');
  return insertAfterLine(types, itemEnd, sets.flatMap((s) => [
    '<Item>', `\t<Name>${s.effect}</Name>`, `\t<Value>${s.number}</Value>`, '</Item>',
  ]));
}

/**
 * DefaultStats.xdb: one `<Item>` per set, appended inside `<Sets>`.
 *
 * The per-count array is read POSITIONALLY and holds one entry per member,
 * indexed from ONE piece worn — not from none. Every shipped set leaves that
 * first entry blank, which makes it look like a "nothing worn" slot; it is not,
 * and reading it that way shifts every description one piece early, so a set
 * appears to combine sooner than it does.
 */
function patchDefaultStats(stats: string, sets: readonly ModArtifactSet[]): string {
  const had = count(stats, /<Effect>ARTFSET_EFFECT_\w+<\/Effect>/g);
  if (had !== SHIPPED_SET_EFFECTS - 1) {
    throw new Error(`${DEFAULT_STATS}: ${had} sets, expected ${SHIPPED_SET_EFFECTS - 1}`);
  }
  const close = once(stats, '</Sets>', `${DEFAULT_STATS} sets`);
  return insertBeforeLine(stats, close, sets.flatMap((s) => [
    '<Item>',
    `\t<Effect>${s.effect}</Effect>`,
    '\t<Artifacts>',
    ...s.artifacts.flatMap((id) => [
      '\t\t<Item>',
      `\t\t\t<Artifact>${id}</Artifact>`,
      '\t\t\t<CombinesAtPuton>true</CombinesAtPuton>',
      '\t\t\t<CombinesAtBackpack>false</CombinesAtBackpack>',
      '\t\t</Item>',
    ]),
    '\t</Artifacts>',
    `\t<NameFileRef href="ArtifactSets/${s.file}_Name.txt"/>`,
    `\t<DescriptionFileRef href="ArtifactSets/${s.file}_Desc.txt"/>`,
    '\t<CombinedDescriptionsFileRefs>',
    ...s.artifacts.map((_, i) => {
      const text = s.perCount?.[i];
      return `\t\t<Item href="${text ? `ArtifactSets/${s.file}_Desc${i + 1}.txt` : ''}"/>`;
    }),
    '\t</CombinedDescriptionsFileRefs>',
    '\t<CombinedHeroClassBonusesDescs/>',
    '\t<CombinedIcons/>',
    '</Item>',
  ]));
}

/**
 * types.xml, the artifact half: the enum, the name→number map, and the size the
 * table is declared to hold.
 *
 * The size is where artifacts differ from creatures, and the difference is easy
 * to carry over wrongly. A creature table declares `ref_table_num_objs` and a
 * `MaxElements`, with `MinElements` left alone because it is a floor the new
 * count clears. The artifact table declares no `ref_table_num_objs` at all, and
 * its `MinElements` EQUALS its `MaxElements` — so both have to move, and a mod
 * that raises only the maximum leaves the table declaring it holds exactly 97
 * while carrying 100.
 */
function patchArtifactTypes(types: string, artifacts: readonly ModArtifact[]): string {
  let t = types;
  const last = LAST_SHIPPED_ARTIFACT;

  const enumAt = once(t, `<Item>${last}</Item>`, 'types.xml artifact enum');
  t = insertAfterLine(t, enumAt, artifacts.map((a) => `<Item>${a.id}</Item>`));

  const mapAt = once(t, `<Name>${last}</Name>`, 'types.xml artifact name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml artifact map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, artifacts.flatMap((a) => [
    '<Item>', `\t<Name>${a.id}</Name>`, `\t<Value>${a.number}</Value>`, '</Item>',
  ]));

  const table = once(t, `<TypeName>${ARTIFACT_TABLE_TYPE}</TypeName>`, 'types.xml artifact table');
  const to = SHIPPED_ARTIFACTS + artifacts.length;
  t = retune(t, table, 'MaxElements', SHIPPED_ARTIFACTS, to, 'types.xml artifact MaxElements');
  return retune(t, table, 'MinElements', SHIPPED_ARTIFACTS, to, 'types.xml artifact MinElements');
}

/** Artifacts.xdb: one `<Item>` per artifact, each carrying its inline object. */
function patchArtifactTable(
  table: string, artifacts: readonly ModArtifact[], types: Map<string, SpecType>,
): string {
  const had = count(table, /<ID>\w+<\/ID>/g);
  if (had !== SHIPPED_ARTIFACTS) throw new Error(`${ARTIFACT_TABLE}: ${had} entries, expected ${SHIPPED_ARTIFACTS}`);
  const close = once(table, '</objects>', `${ARTIFACT_TABLE} objects`);
  return insertBeforeLine(table, close, artifacts.flatMap((a) => {
    const p = artifactPaths(a);
    return [
      '<Item>',
      `\t<ID>${a.id}</ID>`,
      // A BARE `<obj>`, which is what all 97 shipped entries are. The creature
      // table looks similar and is not: there the object is a reference, either
      // to a file or with `#n:inline(Creature)` as the marker for one written in
      // place. Carrying that marker over here gives an href the game cannot
      // resolve, and the record comes out EMPTY — the artifact exists by name,
      // has no data behind it, and the game says it cannot be picked up.
      '\t<obj>',
      ...artifactRecord(a, p, types).map((l) => `\t\t${l}`),
      '\t</obj>',
      '</Item>',
    ];
  }));
}

/**
 * The Lua constants a script names our artifacts by, and the count beside them.
 *
 * The count is not decoration: `ARTIFACT_ARTIFACT_EFFECT_COUNT` sits right
 * after the last artifact and is what a script loops to. Left at 97 it stops
 * one short of every artifact the mod added, which is the kind of miss that
 * shows up as "the set never completes" rather than as an error.
 */
function patchStartupScript(script: string, artifacts: readonly ModArtifact[]): string {
  const anchor = once(script, `${LAST_SHIPPED_ARTIFACT} = `, 'advmap-startup.lua artifact constants');
  const eol = script.indexOf('\n', anchor);
  if (eol < 0) throw new Error('advmap-startup.lua: the last artifact constant is on the last line');
  const indent = indentOf(script, anchor);
  const lines = artifacts.map((a) => `${indent}${a.id} = ${a.number}`);
  const withIds = `${script.slice(0, eol + 1)}${lines.join(EOL)}${EOL}${script.slice(eol + 1)}`;

  const countAt = once(withIds, `${ARTIFACT_COUNT_CONST} = `, 'advmap-startup.lua artifact count');
  const to = SHIPPED_ARTIFACTS + artifacts.length;
  const line = /^(.*=\s*)(\d+)(.*)$/m.exec(withIds.slice(countAt + ARTIFACT_COUNT_CONST.length));
  if (!line) throw new Error('advmap-startup.lua: the artifact count has no number');
  const from = countAt + ARTIFACT_COUNT_CONST.length;
  return withIds.slice(0, from) + withIds.slice(from).replace(
    new RegExp(`^(\\s*=\\s*)${SHIPPED_ARTIFACTS}\\b`), `$1${to}`,
  );
}

/**
 * The files every hero contributes: his document, his name and his biography.
 *
 * Three files and nothing else. His art is REFERENCED like a dwelling's model —
 * he is built by reading a shipped hero of his faction and replacing what makes
 * him himself, so the model, animations, arena character and trace stay the
 * donor's hrefs. Copying that closure would add two megabytes to buy an ability
 * to recolour nobody has asked for yet; the day a hero wants his own look, the
 * copying already exists for creatures and this is where it hooks in.
 */
function buildHeroes(heroes: readonly HeroSpec[], read: DataReader): ModFile[] {
  const files: ModFile[] = [];
  for (const h of heroes) {
    const p = heroPaths(h);
    files.push({ path: p.shared, data: Buffer.from(heroDoc(h, mustRead(read, h.donor), p), 'latin1') });
    // The palette entry, so he can be PLACED and not merely hired: the Objects
    // tab is built from these link files, read through the mounted chain.
    files.push({ path: p.link, data: Buffer.from(heroLink(p), 'latin1') });
    files.push({ path: p.name, data: utf16(h.name) });
    files.push({ path: p.biography, data: utf16(h.biography) });
    if (h.specializationName) files.push({ path: p.specName, data: utf16(h.specializationName) });
    if (h.specializationDescription) {
      files.push({ path: p.specDescription, data: utf16(h.specializationDescription) });
    }
  }
  return files;
}

/**
 * The files every dwelling in the mod contributes: its document, its palette
 * entry, and a text file for each message given as text rather than a reference.
 *
 * The model is REFERENCED, not copied — the opposite of a creature's art, and for
 * a reason: a creature's art is copied so the mod can recolour or replace it
 * without touching the original, while a dwelling stands on a shipped building
 * every install already has. Copying one would add megabytes for nothing. A
 * dwelling that wants art of its own can point at a model the mod carries; the
 * href is the href either way.
 */
function buildDwellings(dwellings: readonly DwellingSpec[], read: DataReader): ModFile[] {
  if (!dwellings.length) return [];
  const files: ModFile[] = [];
  // Once for all of them: the field order every document is written in.
  const types = parseTypeSpec(mustRead(read, TYPES));
  const text = (rel: string): string | null => {
    const b = read(rel);
    return b ? b.toString('latin1') : null;
  };
  // What earlier dwellings put in the mod. A second dwelling may point at a model
  // the first one baked — two buildings that look alike and hire differently — and
  // baking the same town art twice would double a megabyte for nothing.
  const produced = new Map<string, Buffer>();
  const readAny = (rel: string): string | null => {
    const mine = produced.get(rel);
    return mine ? mine.toString('latin1') : text(rel);
  };
  const emit = (path: string, data: Buffer): void => {
    files.push({ path, data });
    produced.set(path, data);
  };

  for (const d of dwellings) {
    const p = dwellingPaths(d);
    if (!readAny(refPath(d.model))) throw new Error(`${d.file}: no model at ${d.model}`);

    // A town building has to be copied and resized before it is a map object;
    // anything already at map scale is referenced where it lies.
    let model = d.model;
    let ground = d.ground;
    let baked: Footprint | null = null;
    if (d.bake) {
      const made = bakeModel(d, p, read);
      for (const f of made.files) emit(f.path, f.data);
      model = made.model;
      baked = made.visible;
      // Its pedestal is under the map; cutting a hole would show the hole.
      if (made.sunk && ground === undefined) ground = null;
    } else if (produced.has(refPath(model)) && ground === undefined) {
      // Pointing at a model another dwelling baked: its pedestal is under the map
      // too, so this one must not cut a hole either.
      ground = null;
    }
    // Measured off the art; the spec overrides either area if it wants to.
    const measured = d.footprint && ground ? ground : baked ?? footprintOf(model, readAny);
    if (!measured) {
      throw new Error(`${d.file}: cannot measure ${model} — give footprint and ground in the spec instead`);
    }
    emit(p.shared, Buffer.from(dwellingDoc({ ...d, model, ground }, p, types, measured), 'latin1'));
    // The palette tile. The editor's thumbnail cache is keyed by link path and
    // only the game's installer writes it, so the link names a texture instead —
    // the dwelling's own icon, which is a shipped one unless the mod says else.
    emit(p.link, Buffer.from(dwellingLink(p, refPath(d.icon ?? '')), 'latin1'));
    for (const slot of MESSAGE_SLOTS) {
      const message = d[slot];
      if (message && !isRef(message)) emit(p.text[slot], utf16(message));
    }
  }
  return files;
}

/**
 * Copy a town-screen building into the mod as an adventure-map model.
 *
 * Two things are wrong with a town building as it ships, and both are in the
 * geometry rather than in any field: it is 2 to 3 times map scale, and its
 * positions are where it stands in the town scene rather than around the origin.
 * So the whole art closure is copied (fresh uids, exactly as a creature's is) and
 * then the copied POSITIONS are moved to the origin and scaled — the only array
 * in the file that holds a coordinate, see placeGeometry.
 *
 * What follows the positions is the geometry document's own bounding box, which
 * the engine and the editor both take at face value, and the AI geometry beside
 * it, which is the same container and gets the same treatment.
 */
function bakeModel(d: DwellingSpec, p: DwellingPaths, read: DataReader): {
  files: ModFile[]; model: string; sunk: boolean; visible: Footprint;
} {
  let pedestalSunk = false;
  let visible: Footprint = { w: 1, h: 1 };
  const source = dataPath(d.model);
  const copied = copyArt([source], p.art, read, `dwelling:${d.file}`);
  const modelPath = copied.at.get(source);
  if (!modelPath) throw new Error(`${d.file}: ${d.model} is not in the game's data`);

  const tiles = d.bake!.tiles;
  if (!(tiles > 0)) throw new Error(`${d.file}: bake needs a size in tiles`);
  // The first geometry is the model's own; the AI geometry hanging off it follows
  // by the same transform so the two do not disagree about where the walls are.
  const target = tiles * 2;
  let placement: { scale: number; shift: [number, number, number] } | null = null;

  const geometryOf = (docPath: string): { path: string; text: string; uid: string; bin: string } | null => {
    const doc = copied.files.get(docPath)?.toString('latin1');
    if (!doc) return null;
    const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(doc)?.[1];
    if (!uid) return null;
    const bin = doc.startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n<AIGeometry')
      || /<AIGeometry\b/.test(doc.slice(0, 200))
      ? `bin/AIGeometries/${uid.toUpperCase()}`
      : `bin/Geometries/${uid.toUpperCase()}`;
    return { path: docPath, text: doc, uid, bin };
  };

  /** Every geometry document the copy holds, model's own first. */
  const geometries: string[] = [];
  const modelDoc = copied.files.get(modelPath)!.toString('latin1');
  const first = hrefOf(modelDoc, 'Geometry');
  if (!first) throw new Error(`${d.file}: ${d.model} names no geometry`);
  const at = resolve(modelPath, first);
  if (at) geometries.push(at);
  for (const g of [...geometries]) {
    const doc = copied.files.get(g)?.toString('latin1');
    const ai = doc ? hrefOf(doc, 'AIGeometry') : null;
    const aiAt = ai ? resolve(g, ai) : null;
    if (aiAt && copied.files.has(aiAt)) geometries.push(aiAt);
  }

  for (const [i, g] of geometries.entries()) {
    const geom = geometryOf(g);
    if (!geom) continue;
    const bytes = copied.files.get(geom.bin);
    if (!bytes) continue;
    if (!placement) {
      const box = positionsBox(bytes);
      if (!box) throw new Error(`${d.file}: cannot read the positions of ${geom.bin}`);
      const widest = Math.max(box.sx, box.sy);
      if (!(widest > 0)) throw new Error(`${d.file}: ${d.model} has no size`);
      // Where the ground is. A town building does not stand on its own base: the
      // Sylvan town is built up in terraces, so every one of its buildings sits
      // on a PEDESTAL — a column the town's landscape hides — and a model placed
      // by its lowest point is a building on a stalk. The pedestal mesh is named
      // in the geometry document (`…Pod_O`, the game's word for a base, the same
      // one its materials use), so the ground is the TOP of that column and the
      // column goes below the map. The terrain then hides it, which is why a baked
      // dwelling cuts no hole in the ground.
      const found = d.bake!.ground ?? groundLevel(geom.text, bytes) ?? wideBase(bytes);
      pedestalSunk = found !== null;
      const floor = found ?? box.cz - box.sz / 2;
      // Sized and centred on what will be ABOVE the ground, not on the whole
      // model: a town building's art keeps going below its terrace, and the
      // Necropolis Estate's buried rock makes the file half again as wide as the
      // manor on top of it. Scaling by that shrank the manor to a doormat.
      const seen = positionsBox(bytes, floor) ?? box;
      const across = Math.max(seen.sx, seen.sy);
      const scale = target / (across > 0 ? across : widest);
      placement = { scale, shift: [-seen.cx, -seen.cy, -floor] };
      // The footprint follows what will be SEEN, not the whole file: a buried base
      // is wider than the building on it often enough (the Hall of Darkness) that
      // measuring the finished bounding box asks for tiles nothing stands on.
      const tiles = (size: number): number => Math.max(1, Math.round((size * scale) / 2));
      visible = { w: tiles(seen.sx), h: tiles(seen.sy) };
    }
    const placed = placeGeometry(bytes, placement);
    if (placed) {
      copied.files.set(geom.bin, placed.data);
      copied.files.set(geom.path, Buffer.from(retuneBox(geom.text, placed.bbox, placement), 'latin1'));
      continue;
    }
    // The model's own geometry must be placeable — that is the mesh on screen.
    if (i === 0) throw new Error(`${d.file}: cannot place ${geom.bin}`);
    // The AI's copy of it is a different container, and a mesh the AI thinks is
    // three times the size is worse than none: 598 shipped models carry no AI
    // geometry at all, so the reference goes and its files with it.
    copied.files.delete(geom.path);
    copied.files.delete(geom.bin);
    const owner = geometries[i - 1]!;
    const doc = copied.files.get(owner)?.toString('latin1');
    if (doc) copied.files.set(owner, Buffer.from(doc.replace(/<AIGeometry href="[^"]*"\s*\/>/, '<AIGeometry/>'), 'latin1'));
  }

  return {
    files: [...copied.files].map(([path, data]) => ({ path, data })),
    model: `/${modelPath}#xpointer(/Model)`,
    sunk: pedestalSunk,
    visible,
  };
}

/**
 * Where the GROUND is in a town building, in its own coordinates.
 *
 * A town is built in terraces and every building stands on one, on a column of
 * rock the town's own landscape hides. Place such a model by its lowest point and
 * you get a building on a stalk. So the terrace has to be found, and the model
 * says where it is if you ask the right mesh: **the decoration stands on it**. No
 * modeller hangs grass off the underside of a cliff, so the lowest leaf, plant or
 * tree in the file is the ground — and across the four Sylvan tier-4-to-7
 * buildings that agrees with the top of the pedestal mesh where there is one
 * (the Unicorn Glade: pedestal ends at 41.6, its trees start at 41.5).
 *
 * Asking the pedestal directly is the fallback rather than the rule because the
 * naming does not hold: the Unicorn Glade and the Forest Nest have a `…Pod_O`,
 * while Stonehenge's column is part of its main mesh and the Treant Arches' is
 * too. Nothing to key on there — but all four have decoration.
 *
 * The geometry document names its meshes and says how many material groups each
 * splits into; the decoder returns those groups in the same order, so a group
 * belongs to whichever mesh's run it falls in.
 */
function groundLevel(doc: string, bin: Buffer): number | null {
  const list = (tag: string): string[] => {
    const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(doc)?.[1] ?? '';
    return [...body.matchAll(/<Item>([^<]*)<\/Item>/g)].map((m) => m[1]!);
  };
  const names = list('MeshNames');
  const quantities = list('MaterialQuantities').map(Number);
  if (!names.length || names.length !== quantities.length) return null;
  const groups = extractMeshesStructured(bin);
  if (!groups) return null;

  const zRange = (from: number, runs: number): { lo: number; hi: number } | null => {
    let lo = Infinity, hi = -Infinity;
    for (const g of groups.slice(from, from + runs)) {
      for (let v = 2; v < g.positions.length; v += 3) {
        const z = g.positions[v]!;
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
    return lo === Infinity ? null : { lo, hi };
  };

  let decoration: number | null = null;
  let pedestal: number | null = null;
  let at = 0;
  for (let i = 0; i < names.length; i++) {
    const runs = quantities[i]! || 1;
    const z = zRange(at, runs);
    at += runs;
    if (!z) continue;
    if (/plant|tree|grass|flower|leaf|bush/i.test(names[i]!)) {
      if (decoration === null || z.lo < decoration) decoration = z.lo;
    } else if (/pod/i.test(names[i]!)) {
      if (pedestal === null || z.hi > pedestal) pedestal = z.hi;
    }
  }
  return decoration ?? pedestal;
}

/** Rewrite a geometry document's box and its best-fit point to match the mesh. */
function retuneBox(doc: string, box: BBox, p: { scale: number; shift: [number, number, number] }): string {
  const vec = (tag: string, x: number, y: number, z: number): [RegExp, string] => [
    new RegExp(`(<${tag}>\\s*<x>)[^<]*(</x>\\s*<y>)[^<]*(</y>\\s*<z>)[^<]*(</z>)`),
    `$1${x.toFixed(4)}$2${y.toFixed(4)}$3${z.toFixed(4)}$4`,
  ];
  let out = doc;
  for (const [re, to] of [
    vec('Size', box.sx, box.sy, box.sz),
    vec('Center', box.cx, box.cy, box.cz),
  ]) out = out.replace(re, to);
  // The best-fit point is a position too — where the object's label and its
  // selection marker hang — so it follows the same transform rather than a box.
  const fit = /(<BestFitPoint>\s*<x>)([^<]*)(<\/x>\s*<y>)([^<]*)(<\/y>\s*<z>)([^<]*)(<\/z>)/.exec(out);
  if (fit) {
    const moved = [Number(fit[2]), Number(fit[4]), Number(fit[6])]
      .map((v, i) => (v + p.shift[i]!) * p.scale);
    out = out.replace(fit[0], `${fit[1]}${moved[0]!.toFixed(4)}${fit[3]}${moved[1]!.toFixed(4)}${fit[5]}${moved[2]!.toFixed(4)}${fit[7]}`);
  }
  return out;
}

/** Write a built mod out as a project folder — the editable form. */
export function writeCreatureMod(dir: string, report: BuildReport): void {
  rmSync(dir, { recursive: true, force: true });
  for (const f of report.files) {
    const path = join(dir, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.data);
  }
}

/**
 * Pack one into a `.h5u`.
 *
 * The archive members MUST carry a real modification time. Given one path in
 * several mounted archives the game takes the newest member, so a mod stamped
 * with the ZIP epoch loses every file to the game's own 2007 copies and is read
 * and then silently ignored. writeArchive defaults to now; this only says so.
 */
export function packCreatureMod(report: BuildReport, when = new Date()): Buffer {
  const entries: ZipEntry[] = report.files.map((f) => ({ name: f.path.replace(/\\/g, '/'), data: f.data }));
  return writeArchive(entries, { mtime: when });
}

/** Where an installed mod went, and what the executable now says. */
export interface Installed {
  archive: string;
  /**
   * The ceiling that was set — or null when the mod adds no creature and the
   * executable is none of its business. Dwellings and other objects are data.
   */
  exe: ExeResult | null;
  /**
   * And the artifact ceiling, which is also in the executable — a thing the
   * format gives every appearance of deciding by itself and does not.
   */
  artifacts: ArtifactExeResult | null;
}

/**
 * Install a built mod: the archive into our folder, and the ceiling into the
 * executable, as ONE action.
 *
 * They cannot be separate. A mod whose creatures sit above the ceiling is read
 * and silently ignored, and a ceiling above the mod's last creature stops the
 * game at launch, so an install that writes one and forgets the other leaves the
 * game in one of those two states. Adding or removing a creature therefore
 * re-patches by itself; nothing has to be remembered.
 *
 * Throws with the reason if the ceiling cannot be set — and then the archive is
 * NOT installed either, because a mod the game will ignore is worse than no mod:
 * it looks installed.
 */
export function installCreatureMod(gameRoot: string, mod: CreatureMod, archive: Buffer): Installed {
  const exe = mod.creatures.length ? setCreatureLimit(gameRoot, creatureLimit(mod)) : null;
  // Artifacts have a ceiling in the executable too, and finding that out cost
  // three wrong answers: raising the table's declared size in types.xml is
  // enough for the game to READ a hundred artifacts and not enough for it to use
  // the ones past 97. See src/artifact-limit.ts.
  const artifacts = mod.artifacts?.length
    ? setArtifactLimit(gameRoot, artifactLimit(mod))
    : null;
  ensureModDir(gameRoot);
  const target = modFile(gameRoot, 'mod', mod.stem);
  writeFileSync(target, archive);
  return { archive: target, exe, artifacts };
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

// --- reading a built mod back -------------------------------------------------

/** A mod read back off disk. */
export interface FoundMod {
  path: string;
  mod: CreatureMod;
  /** The ceiling the executable needs for it. */
  limit: number;
  /**
   * Set when the archive carried no manifest of ours and the registry had to be
   * reconstructed — so names, texts and art provenance are missing.
   */
  reconstructed?: true;
}

/**
 * Read the creature registry out of an archive.
 *
 * Prefers our manifest, which is exact. Falls back to reconstructing from the
 * game's own formats — ids and numbers from types.xml's name→number map, stats
 * from the inline objects in the ref table — which is enough to say what a mod
 * adds and what ceiling it needs, and is how a mod built by somebody else reads.
 * Returns null for an archive that says nothing about creatures.
 *
 * Members are fetched one at a time rather than by inflating the whole archive:
 * a stock install has a 284 MB mod sitting next to ours, and this runs over every
 * file in the folder.
 */
export function readCreatureMod(archivePath: string): FoundMod | null {
  const fd = openSync(archivePath, 'r');
  try {
    const index = new Map<string, ZipIndexEntry>();
    for (const e of readIndex(fd, statSync(archivePath).size)) index.set(e.name.replace(/\\/g, '/'), e);
    const member = (name: string): Buffer | null => {
      const e = index.get(name);
      return e ? readEntryFrom(fd, e) : null;
    };

    const manifest = member(MOD_MANIFEST);
    if (manifest) {
      const mod = readManifest(manifest);
      if (mod) return { path: archivePath, mod, limit: creatureLimit(mod) };
    }

    // No manifest — but a creature mod is recognisable from what it must carry.
    // A dwelling leaves no such trace: it edits nothing of the game's, so an
    // archive without a manifest is only ever read for its creatures.
    const types = member(TYPES);
    const table = member(REF_TABLE);
    if (!types || !table) return null;
    const mod = reconstruct(types.toString('latin1'), table.toString('latin1'));
    if (!mod.creatures.length) return null;
    return { path: archivePath, mod, limit: creatureLimit(mod), reconstructed: true };
  } finally {
    closeSync(fd);
  }
}

/** The same, from bytes already in hand. Used by the tests. */
export function readCreatureModBuffer(archive: Buffer): CreatureMod | null {
  const members = new Map<string, Buffer>();
  for (const e of readEntries(archive)) members.set(e.name.replace(/\\/g, '/'), e.data);
  const manifest = members.get(MOD_MANIFEST);
  if (manifest) return readManifest(manifest);
  const types = members.get(TYPES);
  const table = members.get(REF_TABLE);
  if (!types || !table) return null;
  return reconstruct(types.toString('latin1'), table.toString('latin1'));
}

/**
 * Our manifest, or null when the bytes are not one.
 *
 * `dwellings` is filled in when it is absent: every mod built before dwellings
 * existed has a manifest without it, and the rest of the code reads the field.
 */
function readManifest(bytes: Buffer): CreatureMod | null {
  let mod: CreatureMod;
  try {
    mod = JSON.parse(bytes.toString('utf8')) as CreatureMod;
  } catch {
    return null;
  }
  if (mod.version !== 1 || !Array.isArray(mod.creatures)) return null;
  if (!Array.isArray(mod.dwellings)) mod.dwellings = [];
  return mod;
}

/**
 * Every mod in our folder that adds creatures.
 *
 * Our folder and not `UserMODs`, because that is the one our build reads: the
 * patched executable scans `H5E/` alone, so a mod anywhere else is not installed
 * as far as the game is concerned (src/mod-paths.ts).
 *
 * More than one is a conflict, not a set: creature ids are global and each mod
 * carries its own whole copy of types.xml and the ref table, so the last one the
 * game reads wins outright and the others' creatures do not exist. The editor
 * reports them all and leaves the merge to a decision, since which registry to
 * keep is not ours to guess.
 */
export function findCreatureMods(gameRoot: string): FoundMod[] {
  const dir = join(gameRoot, MOD_DIR);
  if (!existsSync(dir)) return [];
  const out: FoundMod[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(h5u|pak)$/i.test(name)) continue;
    try {
      const found = readCreatureMod(join(dir, name));
      if (found) out.push(found);
    } catch {
      // Not a readable archive. Not our business to complain about it here.
    }
  }
  return out;
}

/** An installed mod, unpacked so the editor can read it like any other root. */
export interface MountedMod extends FoundMod {
  /** The folder its members were extracted to — an asset root to layer on. */
  root: string;
}

/**
 * Unpack the installed creature mods so the editor resolves what the GAME will.
 *
 * Without this the editor reads only the unpacked data and a creature a mod adds
 * does not exist for it: the army picker offers the shipped 180, and a map that
 * places one of ours drops the object from the scene because its
 * `AdvMapMonsterShared` is in the mod and nowhere else.
 *
 * Only mods that add creatures are unpacked. Mounting everything in `UserMODs`
 * would be closer to the game still, but a stock install has a 284 MB cutscene
 * archive in there and no reason to pay for it — a mod that only replaces a
 * texture changes nothing the editor has to resolve.
 *
 * Extraction is cached per archive: re-run after a rebuild and only what changed
 * is unpacked again. Returns the roots most-specific-first, ready to hand to
 * `assets()` ahead of the data root.
 */
export function mountCreatureMods(gameRoot: string, cacheDir: string): MountedMod[] {
  const out: MountedMod[] = [];
  for (const found of findCreatureMods(gameRoot)) {
    const stem = basename(found.path).replace(/\.[^.]+$/, '');
    const root = join(cacheDir, stem);
    const stamp = join(cacheDir, `${stem}.mounted.json`);
    const now = statSync(found.path);
    const want = `${now.size}:${Math.round(now.mtimeMs)}`;
    let have = '';
    try {
      have = (JSON.parse(readFileSync(stamp, 'utf8')) as { of: string }).of;
    } catch { /* never unpacked, or the stamp is unreadable */ }
    if (have !== want) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      extract(found.path, root);
      writeFileSync(stamp, `${JSON.stringify({ of: want, from: found.path }, null, 2)}\n`);
    }
    out.push({ ...found, root });
  }
  return out;
}

/**
 * Rebuild a mod's registry from the game's own formats.
 *
 * WHICH CREATURES ARE ADDED IS READABLE FROM THE TABLE, without knowing what the
 * game shipped: all 180 of its own entries point at a FILE, and an added one
 * carries its object inline. So the inline entries are the mod's, whatever its
 * ceiling, and the number each holds comes from types.xml's name→number map.
 *
 * What cannot be recovered is where the art came from — nothing in the game's
 * formats records it — so `from` is left empty and the source fields name the
 * mod's own files rather than the shipped ones they were copied from. That is
 * what our manifest is for.
 */
function reconstruct(types: string, table: string): CreatureMod {
  const numbers = new Map<string, number>();
  for (const m of types.matchAll(/<Name>(CREATURE_[A-Z0-9_]+)<\/Name>\s*<Value>(\d+)<\/Value>/g)) {
    numbers.set(m[1]!, Number(m[2]));
  }

  const creatures: ModCreature[] = [];
  for (const [id, body] of inlineObjects(table)) {
    const number = numbers.get(id);
    if (number === undefined) continue; // in the table but not in the enum: not usable
    const creature = creatureRoot(body);
    creatures.push({
      id, number, file: id.replace(/^CREATURE_/, ''),
      name: id, description: '', abilitiesText: '',
      stats: readStats(creature),
      visualSource: hrefOf(body, 'Visual') ?? '',
      monsterSource: hrefOf(body, 'MonsterShared') ?? '',
      from: {} as Record<ArtSlot, string>,
    });
  }
  creatures.sort((a, b) => a.number - b.number);
  return {
    version: 1, stem: MOD_STEM,
    first: creatures[0]?.number ?? SHIPPED_CREATURES,
    creatures,
    // Nothing to reconstruct them from: a dwelling is an ordinary object file
    // among a mod's other files, with no registry to enumerate. An artifact
    // could be read back out of the table it extends, but only its numbers —
    // which picture it was built from is in the manifest or nowhere. A set is
    // the same: its members survive in DefaultStats, its texts do not. A hero
    // is the extreme case: he extends nothing at all, so the only trace of him
    // is his own file, and which donor he was built from is the manifest's to
    // remember.
    dwellings: [],
    artifacts: [],
    sets: [],
    heroes: [],
  };
}

/**
 * The ref table's entries that carry their object inline, by creature id.
 *
 * Entries are sliced between consecutive `<ID>` elements, which is sound because
 * a `Creature` record has no `<ID>` of its own — the inline wrapper's identifier
 * is an attribute.
 */
function inlineObjects(table: string): Array<[string, string]> {
  const ids = [...table.matchAll(/<ID>(CREATURE_[A-Z0-9_]+)<\/ID>/g)];
  const out: Array<[string, string]> = [];
  for (const [i, m] of ids.entries()) {
    const until = ids[i + 1]?.index ?? table.length;
    const entry = table.slice(m.index, until);
    const open = entry.indexOf('<Creature ');
    const end = entry.lastIndexOf('</Creature>');
    if (open < 0 || end < 0) continue; // points at a file — one the game shipped
    out.push([m[1]!, entry.slice(open, end + '</Creature>'.length)]);
  }
  return out;
}

// --- copying art -------------------------------------------------------------

/** What a copy produced: the files, where each source landed, what was absent. */
/**
 * Paint every texture in a copied art tree, and correct the documents that
 * describe them.
 *
 * The bytes come out uncompressed 32-bit with one surface, so the paired `.xdb`
 * has to say so — a `.dds` its document misdescribes is present and invisible,
 * which looks exactly like a texture that failed to copy.
 */
function repaint(files: Map<string, Buffer>, ops: RecolorOps): void {
  for (const [path, data] of files) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.dds')) {
      const img = decodeDDSBuffer(data);
      recolorPixels(img.rgba, ops);
      files.set(path, writeDDS(img));
    } else if (lower.endsWith('.(texture).xdb')) {
      files.set(path, Buffer.from(data.toString('latin1')
        .replace(/<Format>[^<]*<\/Format>/, '<Format>TF_8888</Format>')
        .replace(/<IsDXT>[^<]*<\/IsDXT>/, '<IsDXT>false</IsDXT>')
        .replace(/<NMips>[^<]*<\/NMips>/, '<NMips>1</NMips>')
        .replace(/<UseS3TC>[^<]*<\/UseS3TC>/, '<UseS3TC>false</UseS3TC>'), 'latin1'));
    }
  }
}

interface ArtCopy {
  files: Map<string, Buffer>;
  /** Source data path → its path inside the mod. */
  at: Map<string, string>;
  missing: string[];
}

/**
 * Copy the whole closure of documents reachable from `seeds` into `dest`.
 *
 * The structure is preserved under `dest`, which is what makes this simple: a
 * relative href inside a copied file resolves to the copy of what it named
 * before, with no rewriting at all. Absolute hrefs are repointed at our copies —
 * but only when we actually copied the target, since plenty of them name
 * authoring sources (`/H5A2/…/model.mb`) that were never shipped.
 *
 * Documents whose data sits in `bin/…` keyed by uid get a fresh uid and their
 * binary copied under it. Sharing the original uid would work, right up to the
 * first time somebody edited the mesh and found they had edited the shipped
 * creature's too.
 */
function copyArt(seeds: string[], dest: string, read: DataReader, salt: string): ArtCopy {
  const found = new Map<string, Buffer>();
  const missing: string[] = [];
  const queue = seeds.map(normalize);

  // Pass one: what is reachable.
  while (queue.length) {
    const rel = queue.shift()!;
    if (found.has(rel) || missing.includes(rel)) continue;
    const data = read(rel);
    if (!data) { missing.push(rel); continue; }
    found.set(rel, data);
    if (!rel.toLowerCase().endsWith('.xdb')) continue;
    for (const href of hrefs(data.toString('latin1'))) {
      const to = resolve(rel, href);
      if (to) queue.push(to);
    }
  }

  // Pass two: place everything, then rewrite what points inside the set.
  const at = new Map<string, string>();
  for (const rel of found.keys()) at.set(rel, `${dest}/${rel}`);

  const files = new Map<string, Buffer>();
  for (const [rel, data] of found) {
    if (!rel.toLowerCase().endsWith('.xdb')) { files.set(at.get(rel)!, data); continue; }
    let text = data.toString('latin1');

    // Its binary, under a uid of ours.
    const kind = rootName(text);
    const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(text);
    const bin = kind ? UID_BINS[kind] : undefined;
    if (bin && uid) {
      const blob = read(`${bin}/${uid[1]}`);
      if (blob) {
        const fresh = uidFor(`${salt}:${rel}`);
        files.set(`${bin}/${fresh}`, blob);
        text = text.replace(uid[0], `<uid>${fresh}</uid>`);
      }
    }

    // Absolute hrefs into the copied set. Relative ones already resolve.
    text = text.replace(/href="([^"]*)"/g, (whole, href: string) => {
      if (!isAbsolute(href)) return whole;
      const [path, fragment] = split(href);
      const to = at.get(normalize(path));
      return to ? `href="/${to}${fragment}"` : whole;
    });

    files.set(at.get(rel)!, Buffer.from(text, 'latin1'));
  }
  return { files, at, missing };
}

/** Every href in a document, as written. */
function hrefs(text: string): string[] {
  return [...text.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!).filter(Boolean);
}

/** A data path as the archive holds it: forward slashes, no leading one. */
function normalize(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^\/+/, '');
}

/** Strip the `#xpointer(…)` from an href. */
function split(href: string): [string, string] {
  const hash = href.indexOf('#');
  return hash < 0 ? [href, ''] : [href.slice(0, hash), href.slice(hash)];
}

/** The data path an href names, without its fragment. */
export function dataPath(href: string): string {
  return normalize(split(href)[0]);
}

function isAbsolute(href: string): boolean {
  return href.startsWith('/') || href.startsWith('\\');
}

/** What an href in `from` points at, or null when it names nothing we can fetch. */
function resolve(from: string, href: string): string | null {
  const [path] = split(href);
  // A Windows path is an authoring leftover — `/H:/Tools/…` and the like.
  if (!path || /^\/?[A-Za-z]:/.test(path)) return null;
  return isAbsolute(path) ? normalize(path) : normalize(posix.join(posix.dirname(from), path));
}

/** A document's root element name, past the XML declaration. */
function rootName(text: string): string | null {
  return /<([A-Za-z_][\w.-]*)[\s>/]/.exec(text.replace(/<\?[\s\S]*?\?>/g, ''))?.[1] ?? null;
}

/**
 * A stable uid for a copied document. Derived from what it is rather than drawn
 * at random, so rebuilding a mod produces the same bytes.
 *
 * The salt below is FROZEN at the old mod name and is not `MOD_STEM`: it names
 * nothing, it only keeps this hash away from other hashes. Change it and every
 * copied geometry, skeleton and animation lands under a different uid — which
 * is a new `bin/…` file for each, and the byte-identical rebuild this exists
 * for stops being identical to anything built before.
 */
function uidFor(of: string): string {
  const h = createHash('sha1').update(`homm5-units:uid:${of}`).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// --- the creature's own two documents ----------------------------------------

/** Our copy of a shipped `CreatureVisual`: same art, our name and description. */
function creatureVisual(visual: string, p: ReturnType<typeof creaturePaths>, source: string): string {
  let t = visual;
  for (const [field, path] of [
    ['CreatureNameFileRef', p.name],
    ['CreatureAbilitiesFileRef', p.abilities],
    ['DescriptionFileRef', p.description],
  ] as Array<[string, string]>) {
    t = setHref(t, field, `/${path}`, source);
  }
  return t;
}

/**
 * The palette entry: a link file pointing at our map-stack definition.
 *
 * `IconFile` is where this departs from the shipped links. Theirs name a `.tga`
 * under an authoring tree that was never shipped — that file BUILT
 * `Editor/IconCache`, and the editor reads the cache, keyed by link path. A mod
 * cannot add to the cache, so ours names the creature's own 128px texture, which
 * the art copy already placed in the mod, and the icon handler falls back to it.
 */
function objectLink(p: ReturnType<typeof creaturePaths>, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.monster}#xpointer(/AdvMapMonsterShared)"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
    '</AdvMapObjectLink>',
  ].join(EOL) + EOL;
}

/**
 * Our copy of a shipped `AdvMapMonsterShared` — and the one line that matters.
 *
 * `<Creature>` at the end of the file is the ONLY thing deciding which creature a
 * stack on the map is: an `AdvMapMonster` object carries no creature field of its
 * own, just a reference to one of these. Copy one without changing that line and
 * the map places the creature you copied from, with its stats and its name,
 * however new everything else about the definition is.
 */
function monsterShared(monster: string, p: ReturnType<typeof creaturePaths>, c: ModCreature): string {
  let t = monster;
  const messages = /<messagesFileRef>[\s\S]*?<\/messagesFileRef>/;
  if (!messages.test(t)) throw new Error(`${c.monsterSource}: no <messagesFileRef>`);
  t = t.replace(messages, `<messagesFileRef>${EOL}\t\t<Item href="/${p.name}"/>${EOL}\t</messagesFileRef>`);

  const creature = /<Creature>CREATURE_[A-Z0-9_]+<\/Creature>/;
  if (!creature.test(t)) throw new Error(`${c.monsterSource}: no <Creature> naming the stack's creature`);
  return t.replace(creature, `<Creature>${c.id}</Creature>`);
}

// --- the game's three files ---------------------------------------------------

/** types.xml: the enum, the name→number map, and the ref table's declared size. */
function patchTypes(types: string, mod: CreatureMod, limit: number): string {
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED}</Item>`, 'types.xml enum');
  t = insertAfterLine(t, enumAt, mod.creatures.map((c) => `<Item>${c.id}</Item>`));

  // The name→number map. Numbers are what maps and saves store, so this is the
  // part that must never be reshuffled — see addCreature.
  const mapAt = once(t, `<Name>${LAST_SHIPPED}</Name>`, 'types.xml name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml name→number map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, mod.creatures.flatMap((c) => [
    '<Item>', `\t<Name>${c.id}</Name>`, `\t<Value>${c.number}</Value>`, '</Item>',
  ]));

  // How many objects the table is declared to hold. MinElements stays where it
  // is: it is a floor, and the new count clears it.
  const table = once(t, '<TypeName>Table_Creature_CreatureType</TypeName>', 'types.xml creature table');
  const numObjs = t.indexOf('<Key>ref_table_num_objs</Key>', table);
  if (numObjs < 0) throw new Error('types.xml creature table: no ref_table_num_objs');
  t = retune(t, numObjs, 'Data', mod.first, limit, 'types.xml ref_table_num_objs');
  return retune(t, table, 'MaxElements', mod.first, limit, 'types.xml MaxElements');
}

/** Creatures.xdb: one entry per creature, each carrying its own inline object. */
function patchRefTable(table: string, mod: CreatureMod, read: DataReader): string {
  const had = count(table, /<ID>CREATURE_/g);
  if (had !== mod.first) throw new Error(`${REF_TABLE}: ${had} entries, expected ${mod.first}`);

  const nul = mustRead(read, NULL_CREATURE);
  const close = once(table, '</objects>', `${REF_TABLE} objects`);
  const t = insertBeforeLine(table, close, mod.creatures.flatMap((c, i) => {
    const p = creaturePaths(c);
    const creature = creatureRoot(nul);
    writeStats(creature, c.stats);
    setCreatureRefs(creature, `/${p.visual}`, `/${p.monster}`);
    setAttr(creature, 'ObjectRecordID', String(FIRST_RECORD_ID + i));
    return [
      '<Item>',
      `\t<ID>${c.id}</ID>`,
      // The id has to be unique across the table and nothing appears to read it,
      // so it is derived from the creature — which keeps a rebuild byte-identical.
      `\t<Obj href="#n:inline(Creature)" id="item_${uidFor(`obj:${c.id}`).toLowerCase()}">`,
      ...serialize(creature).split(/\r?\n/).map((l) => `\t\t${l}`),
      '\t</Obj>',
      '</Item>',
    ];
  }));

  const now = count(t, /<ID>CREATURE_/g);
  if (now !== creatureLimit(mod)) throw new Error(`${REF_TABLE}: ended with ${now} entries, expected ${creatureLimit(mod)}`);
  return t;
}

/** UIGameRoot: one camera entry, listing every creature we added. */
function patchUiRoot(ui: string, mod: CreatureMod): string {
  const close = once(ui, '</creaturesCameras>', `${UI_ROOT} cameras`);
  return insertBeforeLine(ui, close, [
    '<Item>',
    `\t<Camera href="${HIRE_CAMERA}"/>`,
    '\t<creatures>',
    ...mod.creatures.map((c) => `\t\t<Item>${c.id}</Item>`),
    '\t</creatures>',
    '</Item>',
  ]);
}

// --- text surgery -------------------------------------------------------------
//
// These documents are serialized structs whose field order is part of the format,
// and the game's own editor writes them with tabs and CRLF. Splicing lines keeps
// every byte we did not mean to touch, which a reserialize would not.

/** Locate `needle`, insisting it appears exactly once. An anchor that moved is a bug. */
function once(text: string, needle: string, what: string): number {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`${what}: anchor missing — ${needle}`);
  if (text.indexOf(needle, i + 1) >= 0) throw new Error(`${what}: anchor appears twice — ${needle}`);
  return i;
}

/** The whitespace the line containing `at` begins with. */
function indentOf(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at) + 1;
  return /^[\t ]*/.exec(text.slice(start, at))![0];
}

/** Insert `lines` after the line `at` falls on, indented to match it. */
function insertAfterLine(text: string, at: number, lines: string[]): string {
  const indent = indentOf(text, at);
  const eol = text.indexOf('\n', at);
  if (eol < 0) throw new Error('anchor is on the last line');
  return `${text.slice(0, eol + 1)}${lines.map((l) => indent + l).join(EOL)}${EOL}${text.slice(eol + 1)}`;
}

/** Insert `lines` before the line `at` falls on, indented one level deeper. */
function insertBeforeLine(text: string, at: number, lines: string[]): string {
  const start = text.lastIndexOf('\n', at) + 1;
  const indent = `${indentOf(text, at)}\t`;
  return `${text.slice(0, start)}${lines.map((l) => indent + l).join(EOL)}${EOL}${text.slice(start)}`;
}

/**
 * Retune a number, matching the whole element so its value is part of the anchor.
 * Both sites sit inside a nesting that repeats the tag — `ref_table_num_objs`
 * holds its number in a `<Data>` inside a `<Data>` — so "the next `<Data>`" is
 * the wrong thing to look for and "the next `<Data>180</Data>`" is the right one.
 */
function retune(text: string, from: number, tag: string, expect: number, to: number, what: string): string {
  const needle = `<${tag}>${expect}</${tag}>`;
  const i = text.indexOf(needle, from);
  if (i < 0) throw new Error(`${what}: no ${needle} after offset ${from}`);
  return `${text.slice(0, i)}<${tag}>${to}</${tag}>${text.slice(i + needle.length)}`;
}

/** An element's `href`, as written. */
function hrefOf(text: string, field: string): string | null {
  return new RegExp(`<${field}\\s+href="([^"]*)"`).exec(text)?.[1] ?? null;
}

/** Replace one, whether it was written with an href or as an empty element. */
function setHref(text: string, field: string, value: string, what: string): string {
  const re = new RegExp(`<${field}(?:\\s+[^>]*?)?/>`);
  if (!re.test(text)) throw new Error(`${what}: no <${field}/> to point at ${value}`);
  return text.replace(re, `<${field} href="${value}"/>`);
}

/** Read a data file that has to be there. */
function mustRead(read: DataReader, rel: string): string {
  return mustReadBytes(read, rel).toString('latin1');
}

/** The same, for the files that are not text — a geometry's binary. */
function mustReadBytes(read: DataReader, rel: string): Buffer {
  const data = read(rel);
  if (!data) throw new Error(`the game's data has no ${rel} — is the data root unpacked?`);
  return data;
}

/** The game's text files: UTF-16 LE with a byte-order mark and no trailing newline. */
function utf16(s: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
}

function count(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

// Shared ground for the mod specs — units, artifacts and recolour.
//
// Each of those specs owns its OWN game install: a temp folder with a copy of
// the unwrapped executable and an empty mod folder, handed to the app through
// HOMM5_ROOT. That is what lets them run alone, in any order, without the real
// install ever being touched — and why the setup lives here instead of being
// copied three times.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA, REPO_ROOT } from './launch.ts';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import {
  addArtifact, addArtifactSet, addBuilding, addCreature, addHero, addHeroClass, addHeroSkill,
  addSpecialization, addSpell, newCreatureMod, updateSpell,
  removeBuilding,
  updateArtifact, updateArtifactSet,
} from '../src/mods/mod-model.ts';
import { takenClasses } from '../src/mods/hero-classes.ts';
import { takenSkills } from '../src/mods/hero-skills.ts';
import type { BuildingSpec } from '../src/mods/buildings.ts';
import { installCreatureMod, packCreatureMod, readCreatureMod } from '../src/mods/mod-archive.ts';
import { MOD_STEM, dataReader } from '../src/mods/mod-files.ts';
import type { ArtifactSlot } from '../src/mods/artifacts.ts';
import type { CreatureMod } from '../src/mods/mod-model.ts';
import { creatureSources } from '../src/schema/registry.ts';
import { assets } from '../src/game/assets.ts';
import { blankStats } from '../src/mods/creatures.ts';
import { SHIPPED_EXE } from '../src/exe/creature-limit.ts';
import { firstRun } from '../src/game/first-run.ts';
import { readEntries } from '../src/format/pak.ts';
import { ensureModDir, modFile } from '../src/game/mod-paths.ts';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { writeEffectsFile } from '../src/mods/extension.ts';
import { effectsOf, skillRowsOf, specializationRowsOf } from '../src/mods/artifact-effects.ts';
import { takenSpecializations } from '../src/mods/specializations.ts';
import { takenSpells } from '../src/mods/spells.ts';

/**
 * `--noRemove`: do the work in the REAL install and leave it standing.
 *
 * Two modes, and the difference is only where the work lands:
 *
 *   default    each spec owns a throwaway install under `_tmp` — a game no mod
 *              has ever touched, reset before the run and deleted after it.
 *   noRemove   the install this checkout sits in, with nothing swept up: the
 *              patched executable, the mod archive and whatever a spec packed
 *              are all left where the game reads them. What comes out is what
 *              would have come out of clicking the same buttons by hand.
 *
 * `node tools/e2e-live.ts <spec…>` is the front door; the C1M1 capstone has had
 * the same switch for its map for a while (`--noRemoveMap`), and this is that
 * idea for everything a mod spec installs.
 *
 * A live run still starts from a known state: the installed mod is taken away
 * whole before the chain runs, so the specs author it from nothing the way they
 * do in a fresh install. A copy goes to MOD_BACKUP first — the install is this
 * checkout's own copy of the game, asked for by name, and one file-copy is the
 * whole of the way back.
 */
export const LIVE = !!process.env.HOMM5_NO_REMOVE;

/**
 * The install a spec works in: its own sandbox — or, live, the real one.
 *
 * ONE selector for every spec that can go live, so the flag means one thing
 * everywhere: live is the real install and nothing swept up, isolated is a
 * throwaway under `_tmp`. A spec whose SUBJECT is a bare world — the first-run
 * chain that wipes its whole folder, the settings panel asserting what an
 * unprepared install says — has no live target to offer and stays sandboxed;
 * for those, live only means the sandbox is left to look at.
 */
export function liveHome(sandbox: string): string {
  return LIVE ? REAL_GAME : join(REPO_ROOT, '_tmp', sandbox);
}

/**
 * The install every mod spec works in — ONE of them, either way.
 *
 * The stages are a chain: mod-001 authors the creature, mod-002 paints it,
 * mod-003 authors the artifacts, mod-004 builds a map out of all of it. That
 * only means something if they share an install, so isolated they share a
 * sandbox and live they share the game. It also makes the two modes the same
 * run — the only difference is which folder it happens in.
 *
 * A spec run ALONE still works: what it needs and nobody authored, the fixture
 * fills in (installMapFixture), so a single stage never depends on a stage that
 * did not run.
 */
export function modGameRoot(): string {
  return liveHome('e2e-mod-game');
}

/** Pictures and reference maps that travel with the checkout — assets/README.md. */
export const ASSETS = join(REPO_ROOT, 'assets');
const ART = join(ASSETS, 'artifacts');

/**
 * The install the executable is copied out of — the checkout's own, by default.
 *
 * `HOMM5_ROOT` FIRST, the same variable `E2E_GAME` already reads — that is the
 * live mode's meaning of it. `HOMM5_GAME` covers the worktree that wants its
 * sandboxes built FROM a real install without also playing IN it: the tools'
 * variable, the same answer. NEVER the checkout's parent: a worktree's parent
 * is wherever worktrees are kept, and the guess went looking for
 * `bin/H5_Game.exe` there, found none, prepared no install, and every mod
 * stage then failed inside the app with "no executable at …/e2e-mod-game/bin",
 * which names the copy rather than the missing original. Empty means nobody
 * said: every use already checks for the files it needs and says what is
 * missing, and an empty root fails those checks the honest way.
 */
export const REAL_GAME = process.env.HOMM5_ROOT || process.env.HOMM5_GAME || '';
/** The archive the dialogs always create: OUR mod, never a choice. */
export const MOD = MOD_STEM;

/** What the Units form is filled with — the SoD port's Sharpshooter. */
export const SHARPSHOOTER = {
  file: 'H3Sharpshooter',
  id: 'CREATURE_H3_SHARPSHOOTER', // fills itself from the file stem
  name: 'Снайперы',
  description: 'Стрелки-наёмники, чьё мастерство не знает ни укрытий, ни расстояний.',
  /**
   * What the hire dialog ends up printing — DERIVED, not typed.
   *
   * The mod builds this line out of the game's own ability names when it builds
   * the creature, so the fixture states what the game will say rather than a
   * translation of our own. It used to be the latter, and it read
   * «Без штрафа за дистанцию» where the game says «Стрельба без штрафа».
   */
  abilitiesLine: 'Усиленная стрела, Стрельба без штрафа',
  donor: 'CREATURE_SHARP_SHOOTER',
  /**
   * What necromancy raises them as — the donor's own answer.
   *
   * Not decoration: a creature outside the game's raise table cannot be raised
   * at all, and every shipped NEUTRAL is outside it. Ours is a neutral, so
   * without this it fell and yielded nothing, which reads in game as necromancy
   * being broken rather than as a creature missing from a table.
   */
  raisedAs: 'CREATURE_SKELETON_ARCHER',
  stats: {
    'um-attack': '12', 'um-defence': '10', 'um-mindmg': '8', 'um-maxdmg': '10',
    'um-health': '15', 'um-speed': '9', 'um-init': '12', 'um-shots': '32',
    'um-range': '-1', 'um-growth': '4', 'um-gold': '400', 'um-tier': '4',
    'um-exp': '82', 'um-power': '940', 'um-size': '1',
  } as Record<string, string>,
  /**
   * The same creature as numbers, for the fixture that builds without the form.
   *
   * These are Heroes III's own, not a conversion of them, and two of them look
   * wrong on Heroes V's scale until you know why: speed 9 is dragon territory
   * here and was ordinary for the unit there, and initiative has no Heroes III
   * counterpart at all — 12 is ours, chosen so they shoot early without acting
   * twice as often as a Grand Elf.
   */
  numbers: {
    attack: 12, defence: 10, minDamage: 8, maxDamage: 10, health: 15,
    speed: 9, initiative: 12, shots: 32,
    range: -1,          // as the shipped Sharp Shooter: no obstacle penalty
    weeklyGrowth: 4, gold: 400, tier: 4, town: 'TOWN_NO_TYPE',
    // The shipped Sharp Shooter is 39/447 at 190 gold; this one costs 2.1 times that.
    exp: 82, power: 940,
    abilities: ['ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW'],
  },
};

/**
 * And the Artifacts form — the port's Undertaker's Amulet, on a shipped
 * neck-piece.
 *
 * THE DESCRIPTION NAMES WHAT THE FORM ENTERS, down to the number, the way every
 * shipped artifact's does. The wording is the game's own for a necromancy
 * bonus — the Necropolis town building says «Добавляет 10% к навыку
 * «Некромантия» и 150 очков темной энергии…», so a piece that raises the same
 * skill says it the same way. And it says nothing else, because it gives
 * nothing else: no stat, as in Heroes III.
 */
export const AMULET = {
  file: 'H3UndertakersAmulet',
  id: 'ARTIFACT_H3_UNDERTAKERS_AMULET',
  name: 'Амулет гробовщика',
  description: 'Добавляет 5% к навыку «Некромантия».',
  necromancy: 5,
  donor: 'ARTIFACT_NECROMANCER_PENDANT',
  picture: 'amulet_grob.gif',
};

/**
 * The second piece, so there is a set to build. Same donor: only the slot
 * differs — and this one carries an effect, so its text says so.
 */
export const CLOAK = {
  file: 'H3VampiresCloak',
  id: 'ARTIFACT_H3_VAMPIRES_CLOAK',
  name: 'Плащ вампира',
  description: 'Добавляет 10% к навыку «Некромантия».',
  necromancy: 10,
  donor: 'ARTIFACT_NECROMANCER_PENDANT',
  slot: 'SHOULDERS',
  picture: 'mantia_vamp.gif',
};

/** The third piece. Only the map fixture builds this one; the dialog specs stop at two. */
export const BOOTS = {
  file: 'H3DeadMansBoots',
  id: 'ARTIFACT_H3_DEAD_MANS_BOOTS',
  name: 'Сапоги мертвеца',
  // Plural in Russian, and the verbs follow the name the way the shipped
  // «Сапоги странника» do — «Добавляют», not «Добавляет».
  description: 'Добавляют 15% к навыку «Некромантия».',
  necromancy: 15,
  donor: 'ARTIFACT_NECROMANCER_PENDANT',
  slot: 'FEET',
  picture: 'sapogi_mertv.gif',
};

/**
 * The dwelling that hires the Sharpshooter.
 *
 * A dwelling for a creature the game does not ship is a feature of OURS. The
 * Dwelling tab of the Buildings window authors it now (mod-006); this fixture is
 * the same thing built through the same core, so a spec that starts at the map
 * has it without running that stage. The tier 4–7 dwellings that used to sit
 * beside it are content and belong to whoever is porting a campaign.
 *
 * The model is the elves' own tier-3 dwelling — the High Cabins the game sells
 * archers from, and adventure-map art already: it stands at map scale and
 * around its own origin, so nothing has to be baked. It used to be the TOWN
 * building of the same name (`Arenas/Town/Rampart/HighCabins_u2r0.xdb`, six
 * tiles wide with its ground at 41.2), which needed baking for both reasons and
 * put its pedestal under the map.
 *
 * Its animation and its effect come along, so the copy is as alive as the
 * original — and the recolour is what makes it a different building rather than
 * the shipped one under another name.
 */
export const PALACE = {
  file: 'SharpshooterPalace',
  creatures: [SHARPSHOOTER.id],
  model: '/_(Model)/Buildings/Dwelings/Rampart/High Cabins.(Model).xdb',
  animSet: '/_(AnimSet)/Buildings/Dwellings/Rampart/High_Cabins.(AnimSet).xdb',
  effect: '/Effects/_(Effect)/Buildings/Dwellings/Rampart/High_Cabins.(Effect).xdb',
  icon: '/UI/H5A1/Icons/Buildings/Adventures_Buildings/128x128/Hunters_Cabin.(Texture).xdb',
  /** Sharpshooters are not elves in green: the copy is repainted to say so. */
  recolor: { hue: 150, saturation: 0, lightness: 0, tint: { r: 0, g: 0, b: 0, strength: 0 } },
  type: 'BUILDING_PRESERVE_MILITARY_POST',
  name: 'Дом снайперов',
  description: 'Дом снайперов позволяет вам нанимать снайперов.',
  firstVisit: 'Вы захватили дом снайперов. Вы хотите нанять снайперов?',
  secondVisit: 'Вы хотите нанять снайперов?',
  firstVisitNoHire: 'Вы захватили дом снайперов, но снайперов здесь нет.',
  secondVisitNoHire: 'Здесь нет снайперов.',
};

/** Where the palace's definition lives, which is what a map records. */
export const PALACE_SHARED = `/Buildings/${PALACE.file}/${PALACE.file}.(AdvMapDwellingShared).xdb`;

/** The same palace as the core takes it — what the form ends up sending. */
export function palaceSpec(): BuildingSpec {
  return {
    file: PALACE.file,
    className: 'AdvMapDwellingShared',
    type: PALACE.type,
    model: PALACE.model,
    animSet: PALACE.animSet,
    effect: PALACE.effect,
    icon: PALACE.icon,
    recolor: PALACE.recolor,
    fields: { creatures: [...PALACE.creatures] },
    messages: {
      name: PALACE.name,
      description: PALACE.description,
      firstVisit: PALACE.firstVisit,
      secondVisit: PALACE.secondVisit,
      firstVisitNoHire: PALACE.firstVisitNoHire,
      secondVisitNoHire: PALACE.secondVisitNoHire,
    },
  };
}

/**
 * The three as one list, with the fields a build needs spelled out.
 *
 * The dialog specs fill a FORM from the constants above, so those carry what a
 * person types; this carries the same artifacts as a builder takes them — the
 * slot the amulet leaves at its default, and the picture as a path. Both the map
 * fixture and tools/install-fixture.ts read this, so a game and the suite cannot
 * end up with different artifacts under the same names.
 */
export const PIECES = [
  { ...AMULET, slot: 'NECK' as ArtifactSlot, picturePath: join(ART, AMULET.picture) },
  { ...CLOAK, slot: CLOAK.slot as ArtifactSlot, picturePath: join(ART, CLOAK.picture) },
  { ...BOOTS, slot: BOOTS.slot as ArtifactSlot, picturePath: join(ART, BOOTS.picture) },
];

/** The set they make — the port's, and ours: a twelfth effect, never one of theirs. */
export const UNDEAD_KING = {
  file: 'H3UndeadKing',
  effect: 'ARTFSET_EFFECT_H3_UNDEAD_KING',
  name: 'Плащ короля нежити',
  description: 'Амулет гробовщика, плащ вампира и сапоги мертвеца, надетые вместе.',
  /**
   * What the full set does on an event, as an author would write it: the numbers
   * are the extension's, but WHEN is the engine's own trigger.
   */
  script: [
    'function H3UndeadKing_NewDay()',
    '	for player = 1, 8 do',
    '		local hero = EditorHeroWearing(player, H3UndeadKing_MEMBERS, 3);',
    '		if hero then RestoreDarkEnergy(player); end;',
    '	end;',
    'end;',
    '',
    'Trigger(NEW_DAY_TRIGGER, "H3UndeadKing_NewDay");',
  ].join('\r\n'),
  /**
   * Index 0 is one piece worn, which is not a set — hence blank.
   *
   * Two and three carry the SAME sentence, and it names the EFFECT rather than
   * the count: that is how the game writes its own (the Amplifier's "150 очков
   * темной энергии" is where the wording comes from), the count is drawn beside
   * it already, and nothing accumulates across entries — the Dragonish set
   * repeats its two-piece text at three for exactly this reason.
   */
  perCount: [
    '',
    'Добавляет игроку 150 очков темной энергии.',
    'Добавляет игроку 150 очков темной энергии.',
  ],
  /**
   * What it gives at two pieces: a bigger dark energy pool.
   *
   * Two of three, which no shipped set effect can express — the engine compiles
   * a threshold into each of its eleven. The extension counts the worn members
   * itself, so this number is ours.
   */
  energy: { worn: 2, amount: 150 },
};

/**
 * A game install of our own, as a game no mod has ever touched.
 *
 * BUILT THE WAY A PERSON'S IS. It used to be assembled here by hand — copy the
 * real install's already-unwrapped executable, undo both ceilings in it, and
 * bring the artifact-sites note along because a patched executable can no longer
 * find its own sites by search. Three pieces of knowledge about what a prepared
 * install looks like, kept in the test suite, beside the same knowledge in
 * `src/first-run.ts` where the editor keeps it. So the specs never once ran
 * through the code that prepares an install; they ran on a hand-made imitation
 * of its output.
 *
 * Now the input is what a person's install starts from — the shipped, DRM-wrapped
 * `H5_Game.exe`, copied in and nothing else — and the first run does the rest:
 * unwraps it, puts our extension in it, points it at our folder. Nothing needs
 * undoing afterwards, because a freshly unwrapped executable HAS the shipped
 * ceilings and its accessor bytes are still findable, so the note writes itself
 * the first time a mod is installed.
 *
 * The data step is not among them: the sandbox has no archives of its own and
 * needs none — every spec reads assets from the real unpacked tree (DATA).
 */
export async function prepareGameRoot(dir: string): Promise<void> {
  // It DELETES what it is given, so it may only ever be given a throwaway. A
  // real install handed to it — by a spec reaching for HOMM5_ROOT, say — would
  // erase the game, and the mistake is one word long. The same rule the suite's
  // own cleanup follows (e2e/build.ts).
  if (!dir.startsWith(join(REPO_ROOT, '_tmp'))) {
    throw new Error(`prepareGameRoot wipes what it prepares — ${dir} is not under _tmp`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(join(REAL_GAME, SHIPPED_EXE), join(dir, SHIPPED_EXE));
  await firstRun(
    { gameRoot: dir, dataRoot: DATA, editorRoot: REPO_ROOT },
    { only: ['exe', 'extension', 'paths'] },
  );
}

/**
 * Open the install a spec is about to work in.
 *
 * Isolated, that means resetting it to a game no mod has touched. Live, it
 * means taking OUR things back out of the installed mod — the same starting
 * point, without destroying the install to get there.
 */
/**
 * Put the run's install into its starting state — ONCE per run, from the global
 * setup, never from a spec.
 *
 * Isolated that is a sandbox reset to a game no mod has touched; live it is the
 * game with our own things taken back out of it. Doing it per spec would undo
 * the stage before: they share one install and one archive.
 */
export async function openModGameRoot(): Promise<void> {
  if (LIVE) { clearInstalledMod(REAL_GAME); return; }
  // A machine with no game cannot have one prepared. That is not a failure to
  // report: the data-free half of the suite (`--grep @nodata`, which is what
  // GitHub runs) touches no mod install at all, and the stages that DO need one
  // skip themselves for want of the data anyway. Setting up unconditionally
  // meant the global setup threw before a single test started, and the whole
  // run failed on a copyfile of an executable nobody had.
  if (!existsSync(join(REAL_GAME, SHIPPED_EXE))) {
    console.warn(`[e2e] no ${SHIPPED_EXE} under ${REAL_GAME} — no mod install to prepare.`
      + ' The data-free specs do not need one; the mod stages will skip.');
    return;
  }
  await prepareGameRoot(modGameRoot());
}

/**
 * Take away a map a spec is about to build — its working tree AND its archive.
 *
 * Both, because a map is a FILE now and New Map refuses to write over one: the
 * packed map left by the last run stops the next one before it starts, with
 * "already exists" out of the main process. Isolated that never showed, since
 * the archive sat inside the throwaway install and went with it.
 */
export function clearMap(gameRoot: string, dataRoot: string, name: string): void {
  for (const p of [modFile(gameRoot, 'map', name), join(dataRoot, 'Maps', 'SingleMissions', name)]) {
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
}

/** Take the whole install away again — never the real one. */
export function removeGameRoot(dir: string): void {
  if (LIVE) return;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** The file stem mod-004 gives Gem; hers to author, so hers to clear. */
export const GEM_FILE = 'H3Gem';

/**
 * The specialization mod-004 authors and gives her — Heroes III's own.
 *
 * The game's nearest equivalent is HERO_SPEC_EMPIRIC, which adds a flat five
 * per hero level to the first aid tent; hers adds five PERCENT of it, which is
 * the same thing at expert War Machines and less at every mastery below. That
 * difference is the whole reason a specialization of our own exists, and the
 * percentage is what the native extension is told through its config file.
 */
export const GEM_SPEC = {
  id: 'HERO_SPEC_H3_FIRST_AID',
  name: 'First Aid',
  description: 'The first aid tent grows five percent stronger with every level of the hero.',
  picture: join(ASSETS, 'specializations', 'first_aid.gif'),
  effect: { stat: 'tent' as const, percentPerLevel: 5 },
};

/**
 * The class mod-004 authors and builds her as — Heroes III's own.
 *
 * Gem had a class nobody else in that game had: the Witch, a Druid by every
 * number and a different word on the screen. Here it is the tenth entry in a
 * table the game sizes at nine, and the numbers are hers rather than the
 * Ranger's — a medic who casts, with the war machines that carry her tent at
 * the top of what a level up offers.
 *
 * These weights are the FINAL ones, her own racial included. mod-004 authors
 * the class before the skill exists (nothing can weight a skill that is not
 * there yet) and comes back to it afterwards; this fixture writes the end state
 * in one go, because it is not testing the order — it is making the hero the
 * map spec places.
 */
export const WITCH = {
  id: 'HERO_CLASS_WITCH',
  name: 'Колдунья',
  attributes: { offence: 10, defence: 25, spellpower: 35, knowledge: 30 },
  weights: {
    HERO_SKILL_TENT_MASTER: 10,
    HERO_SKILL_WAR_MACHINES: 15,
    HERO_SKILL_LIGHT_MAGIC: 12,
    HERO_SKILL_LEARNING: 12,
    HERO_SKILL_LUCK: 10,
    HERO_SKILL_LOGISTICS: 8,
    HERO_SKILL_SUMMONING_MAGIC: 8,
    HERO_SKILL_SORCERY: 8,
    HERO_SKILL_LEADERSHIP: 6,
    HERO_SKILL_DEFENCE: 5,
    HERO_SKILL_DESTRUCTIVE_MAGIC: 3,
    HERO_SKILL_DARK_MAGIC: 2,
    HERO_SKILL_OFFENCE: 1,
    HERO_SKILL_AVENGER: 0,
  } as Record<string, number>,
  /** «Чумная палатка», which the Ranger cannot have and she can. */
  perk: 'HERO_SKILL_LAST_AID',
};

/**
 * Her racial: the tent, which is what she is in both games.
 *
 * Named and described four times, because the shipped racials are and because
 * the hero screen prints one per level — four identical lines read as a skill
 * that never advanced. What it will DO is one more use of the first aid tent
 * per level of the skill, which is the extension's half and not written yet;
 * the words say what it is for, not what it currently manages.
 */
export const TENT_MASTER = {
  id: 'HERO_SKILL_TENT_MASTER',
  name: 'Мастер палатки',
  names: [
    'Мастер палатки (новичок)',
    'Обученный мастер палатки',
    'Искусный мастер палатки',
    'Непревзойдённый мастер палатки',
  ],
  description: 'Палатка первой помощи получает дополнительные использования.',
  descriptions: [
    'Уникальный навык колдуньи. Палатка первой помощи получает +1 использование в бою.',
    'Уникальный навык колдуньи. Палатка первой помощи получает +2 использования в бою.',
    'Уникальный навык колдуньи. Палатка первой помощи получает +3 использования в бою.',
    'Уникальный навык колдуньи. Палатка первой помощи получает +4 использования в бою.',
  ],
  commonDescription: 'Уникальный навык колдуньи. Палатка первой помощи получает одно дополнительное '
    + 'использование в бою за каждый уровень навыка — до четырёх на высшем уровне мастерства.',
  /**
   * Heroes III's own first aid, one drawing per level.
   *
   * Three, because that game had three levels of it; Heroes V draws a racial
   * four times and the fourth repeats the third, which is what the shipped War
   * Machines icons do for the same reason.
   */
  pictures: [
    join(ASSETS, 'skills', 'h3_first_aid_1.png'),
    join(ASSETS, 'skills', 'h3_first_aid_2.png'),
    join(ASSETS, 'skills', 'h3_first_aid_3.png'),
  ],
  /**
   * And what it DOES: one more use of the tent for each level of mastery.
   *
   * The words above promised this before anything could deliver it. The
   * extension adds the term where the engine fills the machine's charges, and
   * multiplies by the mastery the hero holds — so the four descriptions are
   * literally the four values of one row.
   */
  effects: { tent_charges: 1 },
};

/**
 * The four perks of her branch — what a level up offers once she has the
 * racial.
 *
 * A branch with no perks is a branch that never grows, which is what the first
 * launch showed. Each hangs off the racial and asks for nothing else, exactly as
 * the shipped Multishot hangs off Avenger: the branch IS the gate, because no
 * other class has it.
 *
 * THESE ARE THE SECOND SET. The first three were designed before anybody read
 * what the engine already does with a first aid tent, and two of them asked for
 * what it does by itself: «Запасной комплект» (a destroyed tent is rebuilt) IS
 * the shipped «Первая помощь», and cleansing is something the tent already does
 * up to a level the engine decides. The Lua both halves were built in is not
 * thrown away — a skill can still carry a map script and a battle script, and
 * `tools/test-skill-scripts.ts` keeps that honest — but nothing in this mod uses
 * it, because every one of the four below is a NUMBER the engine computes and
 * the extension appends to. See SLICE_tent_branch.md.
 *
 * Each row's `effects` is the whole of what it does: a config line for the
 * native extension, keyed on the skill's own enum value, multiplied by the
 * mastery the hero holds — which for a perk is one.
 *
 * They are written down here because deciding what a branch offers is a design
 * decision and belongs where the class is described.
 */
export const TENT_PERKS = [
  {
    id: 'HERO_SKILL_STURDY_TENT',
    name: 'Крепкая палатка',
    description: 'Палатка первой помощи вдвое прочнее.',
    label: 'fix',
    // Percent of the hit points the engine arrives at, which already carry the
    // owner's War Machines mastery and the shipped perk's own doubling.
    effects: { tent_health: 100 },
  },
  {
    id: 'HERO_SKILL_HEALING_BREW',
    name: 'Целебный настой',
    description: 'Палатка первой помощи восстанавливает на 50 единиц здоровья больше.',
    label: 'buff',
    effects: { tent_healing: 50 },
  },
  {
    id: 'HERO_SKILL_CLEAN_BANDAGE',
    name: 'Чистая повязка',
    description: 'Палатка первой помощи снимает с вылеченного отряда заклинания на два уровня '
      + 'сильнее обычного — вплоть до пятого при высшем мастерстве машин.',
    label: 'clean',
    // The engine's own threshold is {0,0,1,3} by mastery, so two more is 5 at
    // expert and nothing a war machine could otherwise touch.
    effects: { tent_cleanse: 2 },
  },
  {
    id: 'HERO_SKILL_FIELD_HOSPITAL',
    name: 'Полевой госпиталь',
    description: 'За каждые 50 единиц маны, потраченной в бою, палатка первой помощи получает '
      + 'дополнительное использование.',
    label: 'field',
    // Two charges per hundred points spent is one per fifty; the rate is per
    // hundred so that a level of mastery can be worth a fraction of a charge.
    effects: { tent_mana: 2 },
  },
].map((p) => ({
  ...p,
  // DRAFTS: the game's own tent with the word stamped on it, grey and lit, made
  // by tools/label-icon.ts. Three drawings that differ only in what they mean is
  // not something anybody wants to draw twice before the effects even exist.
  pictures: [
    join(ASSETS, 'skills', `perk_${p.label}_grey.png`),
    join(ASSETS, 'skills', `perk_${p.label}.png`),
  ],
}));

/**
 * **Death Ripple**, Heroes III's — the first spell of our own.
 *
 * WHY IT IS THE ONE TO PORT FIRST. It has no target to pick, no animation to
 * miss and one sentence of rules ("every living stack takes the damage, the
 * undead do not"), so what a run of it answers is the question underneath: does
 * the engine carry a spell it was never compiled against — into the book, onto
 * the page, through the click — and what does it do when the cast arrives.
 *
 * The numbers are OURS, not Heroes III's transcribed: that game's ripple deals
 * a flat amount plus spell power, on a scale where a hero has 10 power and a
 * peasant 1 hit point. These follow the shape Heroes V uses for a damage spell
 * — base and per-power, once per mastery of the school — with Armageddon's
 * (9/12/15/30) as the reference for what a level-5 spell is worth, scaled down
 * for a level 2. They will want a pass once the damage is really landing.
 *
 * The icon is the shipped Plague's, borrowed: a spell with no texture is a hole
 * in the spellbook, and a hole is indistinguishable from the spell not being
 * there at all — which is the very thing the first run has to tell apart.
 */
export const DEATH_RIPPLE = {
  id: 'SPELL_H3_DEATH_RIPPLE',
  file: 'H3DeathRipple',
  name: 'Волна смерти',
  description: 'Волна смерти проходит по полю боя и ранит всё живое. Нежить она не трогает.',
  level: 2,
  school: 'MAGIC_SCHOOL_DARK',
  // As Armageddon has it: everyone on the field is fair game, so there is
  // nobody to pick and no side to check.
  target: 'TARGET_NEUTRAL',
  aimed: false,
  areaAttack: false,
  damage: [
    { base: 10, perPower: 10 },
    { base: 15, perPower: 15 },
    { base: 20, perPower: 20 },
    { base: 25, perPower: 25 },
  ],
  icon: '/Textures/SpellBook______2618/Spells/Spell_Plague.xdb#xpointer(/Texture)',
};

/**
 * Where the mod archive is kept before a run takes it away.
 *
 * ONE slot, overwritten each time: an undo for the clear that just happened,
 * not a history. The clear itself is wholesale — see below — so this copy is
 * the only way back to what was installed a minute ago.
 */
export const MOD_BACKUP = join(REPO_ROOT, '_tmp', 'mod-backup', `${MOD_STEM}.before-clear.h5u`);

/**
 * Take the installed mod away, whole, so the chain starts where a fresh one does.
 *
 * WHOLESALE, not piece by piece. This used to take out exactly the fixtures and
 * write the rest back, on the theory that the archive may carry things no dialog
 * can author again and the install is somebody else's. It is not somebody
 * else's: a live run happens in the copy of the game this checkout sits in, and
 * it is asked for by name. What the careful version cost was a list of every kind
 * of content, to be kept up to date forever — and the run that showed this up
 * failed BECAUSE the reset never ran at all. Skipped beats blunt in no direction.
 *
 * A copy goes to MOD_BACKUP first, so the archive is one file-copy from back. The
 * effects file goes with it: it names artifacts and specializations that are no
 * longer installed.
 */
export function clearInstalledMod(gameRoot: string): void {
  const archive = modFile(gameRoot, 'mod', MOD);
  if (!existsSync(archive)) return;
  // Before the delete, not after — a copy made afterwards copies nothing.
  mkdirSync(dirname(MOD_BACKUP), { recursive: true });
  copyFileSync(archive, MOD_BACKUP);
  rmSync(archive, { force: true });
  writeEffectsFile(gameRoot, [], []);
}

/**
 * Install the Sharpshooter into `gameRoot` WITHOUT the window.
 *
 * A prerequisite, not a test: the recolour spec needs a creature with textures
 * to repaint, and authoring one through the form is units-create's subject. Runs
 * the same functions the dialog's channel does, so what it leaves behind is what
 * the dialog would have.
 */
export function installCreatureHeadless(gameRoot: string): CreatureMod {
  // Live, the creature is already there — mod-001 authored it through the
  // dialog. Taking it out and putting it back would undo that spec's work for
  // nothing: this is a prerequisite, not the thing under test.
  const installed = existsSync(modFile(gameRoot, 'mod', MOD)) ? readCreatureMod(modFile(gameRoot, 'mod', MOD)) : null;
  if (installed?.mod.creatures.some((c) => c.id === SHARPSHOOTER.id)) return installed.mod;
  const mod = newCreatureMod(MOD);
  const sources = creatureSources(assets([DATA]), SHARPSHOOTER.donor);
  if (!sources) throw new Error(`cannot resolve the donor ${SHARPSHOOTER.donor} — is the data root unpacked?`);
  addCreature(mod, {
    id: SHARPSHOOTER.id, file: SHARPSHOOTER.file,
    name: SHARPSHOOTER.name, description: SHARPSHOOTER.description,
    stats: { ...blankStats(), attack: 12, shots: 32, range: -1, tier: 4, gold: 400 },
    visualSource: sources.visual, monsterSource: sources.monster,
  });
  const report = buildCreatureMod(mod, dataReader(DATA));
  installCreatureMod(gameRoot, mod, packCreatureMod(report));
  return mod;
}

/**
 * The whole fixture the map spec is made of, built into `gameRoot` WITHOUT the
 * window: the Sharpshooter, its palace, the three artifacts and the set.
 *
 * BUILT, not copied off the real install. A test that borrows the mod somebody
 * built earlier passes or fails on the state of that person's game, and says
 * nothing about the code under test — and it cannot run at all on a machine
 * where nobody has pressed the buttons. Everything here goes through the same
 * functions the dialogs' channels call, so what it leaves behind is what the
 * dialogs would have left.
 *
 * The artifacts are built from the pictures in `assets/artifacts/`, which is
 * what the dialog does with a file somebody points it at.
 */
export function installMapFixture(gameRoot: string): CreatureMod {
  // Room for all four kinds first — live, another spec may have authored some of
  // On top of what is installed, not instead of it: the archive holds dwellings
  // nothing can author again, and in a live run it holds what the specs before
  // this one authored — the creature from mod-001, the artifacts from mod-003.
  // Every piece below is ADDED when missing and UPDATED when it is already
  // there, so this is the same fixture either way and running it twice changes
  // nothing.
  const archive = modFile(gameRoot, 'mod', MOD);
  const mod = (existsSync(archive) ? readCreatureMod(archive)?.mod : null) ?? newCreatureMod(MOD);
  const sources = creatureSources(assets([DATA]), SHARPSHOOTER.donor);
  if (!sources) throw new Error(`cannot resolve the donor ${SHARPSHOOTER.donor} — is the data root unpacked?`);
  const creature = {
    id: SHARPSHOOTER.id, file: SHARPSHOOTER.file,
    name: SHARPSHOOTER.name, description: SHARPSHOOTER.description,
    stats: { ...blankStats(), ...SHARPSHOOTER.numbers },
    raisedAs: SHARPSHOOTER.raisedAs,
    visualSource: sources.visual, monsterSource: sources.monster,
  };
  // ADDED when missing, and LEFT ALONE when it is there. Not updated: a rebuild
  // copies the art fresh off the donor, and a recolour lives nowhere but in the
  // archive's own bytes — so updating a creature that mod-002 has just repainted
  // paints it back to the donor's colours, quietly, one stage later.
  if (!mod.creatures.some((c) => c.id === SHARPSHOOTER.id)) addCreature(mod, creature);
  // The palace is a BUILDING of the dwelling class now, and it carries its own
  // art rather than pointing at the town's. Replaced rather than updated: it is
  // a document and a palette entry, not a numbered row.
  if ((mod.buildings ?? []).some((b) => b.file === PALACE.file)) removeBuilding(mod, PALACE.file);
  addBuilding(mod, palaceSpec());
  for (const a of PIECES) {
    const spec = {
      id: a.id, file: a.file, name: a.name, description: a.description,
      slot: a.slot,
      rank: 'ARTF_CLASS_MINOR' as const, cost: 5000,
      // A piece of the Cloak gives NECROMANCY AND NOTHING ELSE — no stat, the
      // way Heroes III had it. Which means all it gives is the one thing an
      // artifact record cannot hold, so the whole artifact is that one row in
      // the file the extension reads.
      effects: { necromancy: a.necromancy },
      // Its own picture, not a shipped artifact's icon: the file is in the
      // checkout, so the mod builds the game's texture from it the way the
      // dialog does — and the gif reader and the texture writer are exercised
      // by every run instead of only by hand.
      picture: a.picturePath,
      board: { tiles: 1 },
    };
    if ((mod.artifacts ?? []).some((x) => x.id === a.id)) updateArtifact(mod, a.id, spec);
    else addArtifact(mod, spec);
  }
  // Gem, so the map spec can PLACE her when it runs alone. The dialog authors
  // her in mod-004; this is the same hero built the same way, for a run that
  // starts at the map. Added when missing and left alone when she is there,
  // like the creature above.
  // Her specialization first: a hero naming one the enum does not declare is a
  // parse error rather than a hero without a specialization.
  if (!(mod.specializations ?? []).some((s) => s.id === GEM_SPEC.id)) {
    addSpecialization(mod, GEM_SPEC, takenSpecializations(readFileSync(join(DATA, 'types.xml'), 'latin1')));
  }
  ensureWitch(mod);
  if (!(mod.heroes ?? []).some((h) => h.id === GEM_FILE)) {
    addHero(mod, {
      id: GEM_FILE,
      name: 'Gem',
      biography: 'A sorceress of Enroth, newly come to AvLee and its druids.',
      basedOn: 'MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb',
      town: 'TOWN_PRESERVE',
      heroClass: WITCH.id,
      // Ours, and with NO words of her own: a specialization of the mod carries
      // the name and the text it wants its heroes to use, and the build writes
      // them onto every hero holding it. The dialog's Gem overrides them in
      // mod-004, which is the other half of the same rule.
      specialization: GEM_SPEC.id,
      primarySkill: { skill: TENT_MASTER.id, mastery: 'MASTERY_BASIC' },
      stats: { offence: 0, defence: 1, spellpower: 2, knowledge: 2 },
      skills: [{ skill: 'HERO_SKILL_WAR_MACHINES', mastery: 'MASTERY_BASIC' }],
      perks: ['HERO_SKILL_FIRST_AID'],
      machines: { firstAidTent: true },
      // Her own face and icon, exactly as the dialog gives them. Left out, a run
      // that authored her through the form and then reached the map spec ends
      // with a Gem wearing Ossir's face: this fixture would not have rebuilt
      // them, and nothing else would have said so.
      portrait: join(ASSETS, 'heroes', 'gem.gif'),
    });
  }

  const set = {
    effect: UNDEAD_KING.effect, file: UNDEAD_KING.file,
    name: UNDEAD_KING.name, description: UNDEAD_KING.description,
    artifacts: [AMULET.id, CLOAK.id, BOOTS.id],
    perCount: UNDEAD_KING.perCount,
    // What the set gives, as the dialog would write it. Left out, this fixture
    // reinstalls the set over one the dialog authored and quietly drops the
    // bonus — the boots' mistake again, a rung higher.
    effects: [{
      stat: 'energy' as const,
      threshold: UNDEAD_KING.energy.worn,
      amount: UNDEAD_KING.energy.amount,
    }],
    // And the script, for the same reason: this fixture reinstalls the set over
    // one the dialog authored, and what it leaves out it silently removes.
    script: UNDEAD_KING.script,
  };
  if ((mod.sets ?? []).some((s) => s.effect === UNDEAD_KING.effect)) {
    updateArtifactSet(mod, UNDEAD_KING.effect, set);
  } else addArtifactSet(mod, set);

  const report = buildCreatureMod(mod, dataReader(DATA));
  installCreatureMod(gameRoot, mod, packCreatureMod(report));
  // And the file the extension reads. The archive cannot hold a percentage on a
  // skill, so an artifact installed without its row exists in the game and
  // grants nothing — which is what happened to the boots: the dialog writes this
  // file, a fixture that skipped it left one piece of the set inert while its
  // own description promised 15%.
  writeEffectsFile(gameRoot, effectsOf(mod.artifacts ?? [], mod.sets ?? []),
    specializationRowsOf(mod.specializations ?? []), skillRowsOf(mod.skills ?? []));
  return mod;
}

/**
 * Put the spells of ours into the installed mod, and nothing else.
 *
 * Its own entry point because the rules map wants them without wanting the
 * creature, the palace, the artifacts or Gem: that map is a stand for watching
 * BEHAVIOUR, and every fixture it does not need is a way for it to differ from
 * the map somebody plays. Added when missing and updated when there, so running
 * it twice changes nothing.
 *
 * The spell must exist in the install BEFORE the map is built: a hero's
 * `Editable/spells` names it by id, and an id types.xml does not declare is a
 * map the game refuses rather than a hero without a spell.
 */
export function installSpellFixture(gameRoot: string): CreatureMod {
  const archive = modFile(gameRoot, 'mod', MOD);
  const mod = (existsSync(archive) ? readCreatureMod(archive)?.mod : null) ?? newCreatureMod(MOD);
  const spec = { ...DEATH_RIPPLE };
  if ((mod.spells ?? []).some((s) => s.id === DEATH_RIPPLE.id)) {
    updateSpell(mod, DEATH_RIPPLE.id, spec);
  } else {
    addSpell(mod, spec, takenSpells(readFileSync(join(DATA, 'types.xml'), 'latin1')));
  }
  const report = buildCreatureMod(mod, dataReader(DATA));
  installCreatureMod(gameRoot, mod, packCreatureMod(report));
  return mod;
}

/**
 * Her class and her racial, added to `mod` when they are not in it.
 *
 * Before the hero, always: a hero naming a class or a skill the enum does not
 * declare is a parse error, not a hero without one — the same rule the
 * specialization follows. The class before the skill, for the same reason one
 * step down: a racial belongs to a class.
 *
 * Its own function because two callers want it and neither is the other's:
 * the map fixture builds the whole mod headless, and the heroes spec needs the
 * two to exist before it can select them in the form when it runs on its own.
 */
export function ensureWitch(mod: CreatureMod): void {
  const types = readFileSync(join(DATA, 'types.xml'), 'latin1');
  if (!(mod.classes ?? []).some((c) => c.id === WITCH.id)) {
    addHeroClass(mod, {
      id: WITCH.id,
      name: WITCH.name,
      attributes: WITCH.attributes,
      skills: Object.entries(WITCH.weights).map(([skill, prob]) => ({ skill, prob })),
      allowedPerks: [{ perk: WITCH.perk, dependencies: ['HERO_SKILL_FIRST_AID'] }],
    }, takenClasses(types));
  }
  if (!(mod.skills ?? []).some((s) => s.id === TENT_MASTER.id)) {
    addHeroSkill(mod, {
      ...TENT_MASTER,
      kind: 'racial',
      heroClass: WITCH.id,
      aiRace: 'Sylvan',
    }, takenSkills(types));
  }
  // And the branch's perks, after the racial they hang off.
  for (const perk of TENT_PERKS) {
    if ((mod.skills ?? []).some((s) => s.id === perk.id)) continue;
    addHeroSkill(mod, {
      id: perk.id,
      name: perk.name,
      description: perk.description,
      pictures: perk.pictures,
      kind: 'perk',
      heroClass: WITCH.id,
      basicSkill: TENT_MASTER.id,
      // What it DOES, which for all four is a term the extension adds to a sum
      // the engine computes. Without this the perk is a name and a drawing.
      effects: perk.effects,
    }, takenSkills(types));
  }
}

/**
 * The same two, built into an install that has none — the heroes spec's
 * prerequisite when it runs alone.
 *
 * A prerequisite, not a test: authoring them through the forms is the class
 * spec's subject, and it runs first when the whole chain runs. Left out, a
 * heroes run on its own has no class to make Gem, which reads as the form being
 * broken rather than as a spec run out of order.
 */
export function installWitchFixture(gameRoot: string): void {
  const archive = modFile(gameRoot, 'mod', MOD);
  const found = existsSync(archive) ? readCreatureMod(archive) : null;
  const mod = found?.mod ?? newCreatureMod(MOD);
  if ((mod.classes ?? []).some((c) => c.id === WITCH.id)
    && (mod.skills ?? []).some((s) => s.id === TENT_MASTER.id)) return;
  ensureWitch(mod);
  const report = buildCreatureMod(mod, dataReader(DATA));
  installCreatureMod(gameRoot, mod, packCreatureMod(report));
}

/** Our mod, read back off the install. */

export function readInstalledMod(gameRoot: string): CreatureMod {
  const found = readCreatureMod(modFile(gameRoot, 'mod', MOD));
  if (!found) throw new Error(`no mod at ${modFile(gameRoot, 'mod', MOD)}`);
  return found.mod;
}

/** Every texture the creature carries in the installed mod, decoded. */
export function creatureTextures(gameRoot: string, fileStem = SHARPSHOOTER.file): { name: string; rgba: Uint8Array }[] {
  const out: { name: string; rgba: Uint8Array }[] = [];
  for (const e of readEntries(readFileSync(modFile(gameRoot, 'mod', MOD)))) {
    const name = e.name.split('\\').join('/');
    if (name.startsWith(`Units/${fileStem}/`) && name.toLowerCase().endsWith('.dds')) {
      out.push({ name, rgba: decodeDDSBuffer(e.data).rgba });
    }
  }
  return out;
}

/** Distance between two hues on the circle, in degrees. */
export const hueDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

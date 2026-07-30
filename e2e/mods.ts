// Shared ground for the mod specs — units, artifacts and recolour.
//
// Each of those specs owns its OWN game install: a temp folder with a copy of
// the unwrapped executable and an empty mod folder, handed to the app through
// HOMM5_ROOT. That is what lets them run alone, in any order, without the real
// install ever being touched — and why the setup lives here instead of being
// copied three times.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, REPO_ROOT } from './launch.ts';
import {
  addArtifact, addArtifactSet, addCreature, addDwelling, buildCreatureMod, dataReader,
  installCreatureMod, MOD_STEM, newCreatureMod, packCreatureMod, readCreatureMod,
  removeArtifact, removeArtifactSet, removeCreature, removeDwelling, removeHero,
  updateArtifact, updateArtifactSet,
} from '../src/creature-mod.ts';
import type { ArtifactSlot } from '../src/artifacts.ts';
import type { CreatureMod } from '../src/creature-mod.ts';
import { creatureSources } from '../src/registry.ts';
import { assets } from '../src/assets.ts';
import { blankStats } from '../src/creatures.ts';
import { SHIPPED_EXE } from '../src/creature-limit.ts';
import { firstRun } from '../src/first-run.ts';
import { readEntries } from '../src/pak.ts';
import { ensureModDir, modFile } from '../src/mod-paths.ts';
import { decodeDDSBuffer } from '../src/dds.ts';
import { writeEffectsFile } from '../src/extension.ts';
import { effectsOf } from '../src/artifact-effects.ts';

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
 * A live run still starts from a known state: OUR things are taken out of the
 * installed mod first, so the spec authors them from nothing the way it does in
 * a fresh install. Everything else in the archive is left alone — dwellings the
 * editor cannot yet author would be gone for good.
 */
export const LIVE = !!process.env.HOMM5_NO_REMOVE;

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
  return LIVE ? REAL_GAME : join(REPO_ROOT, '_tmp', 'e2e-mod-game');
}

/** Pictures and reference maps that travel with the checkout — assets/README.md. */
export const ASSETS = join(REPO_ROOT, 'assets');
const ART = join(ASSETS, 'artifacts');

/** The real install the checkout sits in — where the executable comes from. */
export const REAL_GAME = join(REPO_ROOT, '..');
/** The archive the dialogs always create: OUR mod, never a choice. */
export const MOD = MOD_STEM;

/** What the Units form is filled with — the SoD port's Sharpshooter. */
export const SHARPSHOOTER = {
  file: 'H3Sharpshooter',
  id: 'CREATURE_H3_SHARPSHOOTER', // fills itself from the file stem
  name: 'Снайперы',
  description: 'Стрелки-наёмники, чьё мастерство не знает ни укрытий, ни расстояний.',
  abilitiesText: 'Стрелок, Без штрафа за дистанцию, Пробивающая стрела',
  donor: 'CREATURE_SHARP_SHOOTER',
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
 * A dwelling for a creature the game does not ship is a feature of OURS, which
 * is why it is a fixture here: `addDwelling` is the only thing that can make
 * one, and no dialog does it yet. The tier 4–7 dwellings that used to sit
 * beside it are content and belong to whoever is porting a campaign.
 *
 * The model is the elves' upgraded town building, which is where the game sells
 * its own Sharp Shooter. `bake` gives the ground and the width by hand: the
 * houses ARE the trees and start at 41.2, so the usual "ground is where the
 * decoration begins" reading cuts four units off their bottoms; six tiles
 * rather than four because the upgraded model carries the basic one's meshes
 * beside its own and spreads 34 units wide.
 */
export const PALACE = {
  file: 'SharpshooterPalace',
  creatures: [SHARPSHOOTER.id],
  model: '/Arenas/Town/Rampart/HighCabins_u2r0.xdb',
  bake: { tiles: 6, ground: 41.2 },
  icon: '/UI/TownHall/preserve/128/d3u.xdb',
  type: 'BUILDING_PRESERVE_MILITARY_POST',
  name: 'Дом снайперов',
  description: 'Дом снайперов позволяет вам нанимать снайперов.',
  firstVisit: 'Вы захватили дом снайперов. Вы хотите нанять снайперов?',
  secondVisit: 'Вы хотите нанять снайперов?',
  firstVisitNoHire: 'Вы захватили дом снайперов, но снайперов здесь нет.',
  secondVisitNoHire: 'Здесь нет снайперов.',
};

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
  if (LIVE) { clearFixture(REAL_GAME); return; }
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

/** Everything the fixtures author, so a live run can start where a fresh one does. */
const OURS = {
  creatures: [SHARPSHOOTER.id],
  dwellings: [PALACE.file],
  artifacts: [AMULET.id, CLOAK.id, BOOTS.id],
  sets: [UNDEAD_KING.effect],
  // The hero mod-004 authors. Without him here a second live run met his own
  // leftovers and the dialog refused the name — which is exactly what the
  // clearing is for.
  heroes: [GEM_FILE],
};

/**
 * Take the fixtures out of an installed mod, leaving the rest of it alone.
 *
 * The rest matters: the archive in a real game also carries dwellings authored
 * before the editor became the mod's only writer, and no dialog can make them
 * again. Rebuilding it from the fixture alone would delete them without a word.
 */
export function clearFixture(gameRoot: string): void {
  const archive = modFile(gameRoot, 'mod', MOD);
  const found = existsSync(archive) ? readCreatureMod(archive) : null;
  if (!found) return;
  const mod = found.mod;
  let touched = false;
  // The set first: it names the artifacts, and a set whose members are gone is
  // a tooltip pointing at nothing.
  for (const effect of OURS.sets) {
    if ((mod.sets ?? []).some((s) => s.effect === effect)) { removeArtifactSet(mod, effect); touched = true; }
  }
  for (const id of OURS.artifacts) {
    if ((mod.artifacts ?? []).some((a) => a.id === id)) { removeArtifact(mod, id); touched = true; }
  }
  for (const file of OURS.dwellings) {
    if (mod.dwellings.some((d) => d.file === file)) { removeDwelling(mod, file); touched = true; }
  }
  for (const id of OURS.creatures) {
    if (mod.creatures.some((c) => c.id === id)) { removeCreature(mod, id); touched = true; }
  }
  for (const file of OURS.heroes) {
    if ((mod.heroes ?? []).some((h) => h.file === file)) { removeHero(mod, file); touched = true; }
  }
  if (!touched) return;
  // Nothing left but the manifest: an archive of nothing is not a mod, and
  // building one throws. This is the ordinary case in a throwaway install,
  // where the fixtures ARE the whole mod — and it stayed hidden until a spec
  // ran live against an install holding nothing else.
  const empty = !mod.creatures.length && !mod.dwellings.length
    && !(mod.artifacts ?? []).length && !(mod.sets ?? []).length && !(mod.heroes ?? []).length;
  if (empty) {
    rmSync(archive, { force: true });
    writeEffectsFile(gameRoot, []);
    return;
  }
  const report = buildCreatureMod(mod, dataReader(DATA));
  installCreatureMod(gameRoot, mod, packCreatureMod(report));
  // An artifact taken out has to stop granting its bonus: the file is written
  // from what is LEFT, never appended to.
  writeEffectsFile(gameRoot, effectsOf(mod.artifacts ?? [], mod.sets ?? []));
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
    abilitiesText: SHARPSHOOTER.abilitiesText,
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
    abilitiesText: SHARPSHOOTER.abilitiesText,
    stats: { ...blankStats(), ...SHARPSHOOTER.numbers },
    visualSource: sources.visual, monsterSource: sources.monster,
  };
  // ADDED when missing, and LEFT ALONE when it is there. Not updated: a rebuild
  // copies the art fresh off the donor, and a recolour lives nowhere but in the
  // archive's own bytes — so updating a creature that mod-002 has just repainted
  // paints it back to the donor's colours, quietly, one stage later.
  if (!mod.creatures.some((c) => c.id === SHARPSHOOTER.id)) addCreature(mod, creature);
  // A dwelling has no update of its own — it is a document and a palette entry,
  // not a numbered row — so replacing it means taking it out and putting it back.
  if (mod.dwellings.some((d) => d.file === PALACE.file)) removeDwelling(mod, PALACE.file);
  addDwelling(mod, PALACE);
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
  writeEffectsFile(gameRoot, effectsOf(mod.artifacts ?? [], mod.sets ?? []));
  return mod;
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

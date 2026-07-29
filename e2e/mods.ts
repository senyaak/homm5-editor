// Shared ground for the mod specs — units, artifacts and recolour.
//
// Each of those specs owns its OWN game install: a temp folder with a copy of
// the unwrapped executable and an empty mod folder, handed to the app through
// HOMM5_ROOT. That is what lets them run alone, in any order, without the real
// install ever being touched — and why the setup lives here instead of being
// copied three times.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './launch.ts';
import { addArtifact, addArtifactSet, addCreature, addDwelling, buildCreatureMod, dataReader, installCreatureMod, MOD_STEM, newCreatureMod, packCreatureMod, readCreatureMod } from '../src/creature-mod.ts';
import type { ArtifactSlot } from '../src/artifacts.ts';
import type { CreatureMod } from '../src/creature-mod.ts';
import { creatureSources } from '../src/registry.ts';
import { assets } from '../src/assets.ts';
import { blankStats } from '../src/creatures.ts';
import { ORIGINAL_LIMIT, patchExe } from '../src/creature-limit.ts';
import { ORIGINAL_ARTIFACTS, patchArtifactLimit, SITES_FILE } from '../src/artifact-limit.ts';
import type { Site } from '../src/artifact-limit.ts';
import { readEntries } from '../src/pak.ts';
import { ensureModDir, modFile } from '../src/mod-paths.ts';
import { decodeDDSBuffer } from '../src/dds.ts';

/** Pictures and reference maps that travel with the checkout — assets/README.md. */
export const ASSETS = join(REPO_ROOT, 'assets');
const ART = join(ASSETS, 'artifacts');

/** The unpacked data root the app reads (never written by these specs). */
export const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
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
  description: 'Амулет гробовщика и плащ вампира, надетые вместе.',
  /** Index 0 is one piece worn, which is not a set — hence blank. */
  perCount: ['', 'Надето два предмета.'],
};

/**
 * A game install of our own, as a game no mod has ever touched.
 *
 * The shipped `H5_Game.exe` is wrapped in Steam's DRM and cannot be read, so the
 * unwrapped `H5_Game_H5E.exe` beside it is the source — with BOTH ceilings put
 * back to their shipped values. The artifact sites note travels with it: once
 * the count is a round number its accessor bytes are no longer unique, so an
 * already-patched executable can no longer find its own sites by search.
 */
export function prepareGameRoot(dir: string): void {
  // It DELETES what it is given, so it may only ever be given a throwaway. A
  // real install handed to it — by a spec reaching for HOMM5_ROOT, say — would
  // erase the game, and the mistake is one word long. The same rule the suite's
  // own cleanup follows (e2e/build.ts).
  if (!dir.startsWith(join(REPO_ROOT, '_tmp'))) {
    throw new Error(`prepareGameRoot wipes what it prepares — ${dir} is not under _tmp`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  ensureModDir(dir);
  const real = readFileSync(join(REAL_GAME, 'bin', 'H5_Game_H5E.exe'));
  const noted = JSON.parse(readFileSync(join(REAL_GAME, SITES_FILE), 'utf8')) as Site[];
  writeFileSync(join(dir, 'bin', 'H5_Game_H5E.exe'),
    patchArtifactLimit(patchExe(real, ORIGINAL_LIMIT).data, ORIGINAL_ARTIFACTS, noted).data);
  writeFileSync(join(dir, SITES_FILE), `${JSON.stringify(noted, null, 2)}\n`);
}

/** Take the whole install away again. */
export function removeGameRoot(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
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
  const mod = newCreatureMod(MOD);
  const sources = creatureSources(assets([DATA]), SHARPSHOOTER.donor);
  if (!sources) throw new Error(`cannot resolve the donor ${SHARPSHOOTER.donor} — is the data root unpacked?`);
  addCreature(mod, {
    id: SHARPSHOOTER.id, file: SHARPSHOOTER.file,
    name: SHARPSHOOTER.name, description: SHARPSHOOTER.description,
    abilitiesText: SHARPSHOOTER.abilitiesText,
    stats: { ...blankStats(), ...SHARPSHOOTER.numbers },
    visualSource: sources.visual, monsterSource: sources.monster,
  });
  addDwelling(mod, PALACE);
  for (const a of PIECES) {
    addArtifact(mod, {
      id: a.id, file: a.file, name: a.name, description: a.description,
      slot: a.slot,
      rank: 'ARTF_CLASS_MINOR', cost: 5000,
      // A piece of the Cloak gives NECROMANCY AND NOTHING ELSE — no stat, the
      // way Heroes III had it. Which means all it gives is the one thing an
      // artifact record cannot hold, so the whole artifact is that one row in
      // the file the extension reads.
      effects: { necromancy: a.necromancy },
      // Its own picture, not a shipped artifact's icon: the file is in the
      // checkout, so the mod builds the game's texture from it the way the
      // dialog does — and the gif reader and the texture writer are exercised
      // by every run instead of only by hand.
      picture: join(ART, a.picture),
      board: { tiles: 1 },
    });
  }
  addArtifactSet(mod, {
    effect: UNDEAD_KING.effect, file: UNDEAD_KING.file,
    name: UNDEAD_KING.name, description: UNDEAD_KING.description,
    artifacts: [AMULET.id, CLOAK.id, BOOTS.id],
    perCount: ['', 'Надето два предмета из трёх.', 'Набор собран полностью.'],
  });
  const report = buildCreatureMod(mod, dataReader(DATA));
  installCreatureMod(gameRoot, mod, packCreatureMod(report));
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

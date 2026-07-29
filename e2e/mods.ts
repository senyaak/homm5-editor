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
import { addCreature, buildCreatureMod, dataReader, installCreatureMod, MOD_STEM, newCreatureMod, packCreatureMod, readCreatureMod } from '../src/creature-mod.ts';
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
};

/**
 * And the Artifacts form — the port's Undertaker's Amulet, on a shipped
 * neck-piece.
 *
 * THE DESCRIPTION NAMES WHAT THE FORM ENTERS, and that is not decoration: every
 * shipped artifact's description says what it gives down to the number, ours are
 * written the same way, and this one is filled in beside a Knowledge of 2 and no
 * effect at all. Give it the cloak's text and it promises a necromancy bonus the
 * artifact does not have.
 */
export const AMULET = {
  file: 'H3UndertakersAmulet',
  id: 'ARTIFACT_H3_UNDERTAKERS_AMULET',
  name: 'Амулет гробовщика',
  description: 'Увеличивает «Знание» героя на +2.',
  donor: 'ARTIFACT_NECROMANCER_PENDANT',
};

/**
 * The second piece, so there is a set to build. Same donor: only the slot
 * differs — and this one carries an effect, so its text says so.
 */
export const CLOAK = {
  file: 'H3VampiresCloak',
  id: 'ARTIFACT_H3_VAMPIRES_CLOAK',
  name: 'Плащ вампира',
  description: 'Увеличивает «Знание» героя на +2 и добавляет 10% к навыку «Некромантия».',
  donor: 'ARTIFACT_NECROMANCER_PENDANT',
  slot: 'SHOULDERS',
};

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

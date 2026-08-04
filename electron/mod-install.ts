// What every mod channel does around its own edit.
//
// A creature mod is one archive in our folder plus a ceiling in the executable,
// and it is game-global: none of this touches the open map, which is why the
// dialogs work with no map loaded. Adding an artifact, changing a hero and
// removing a creature all end the same way — rebuild the whole manifest, pack
// it, install it — so that tail lives here rather than in each handler.

import type { ModsInstallSetPayload } from '#electron/ipc.ts';
import { gameData } from '#electron/paths.ts';
import { rmSync } from 'node:fs';
import { basename } from 'node:path';
import { EFFECT_STATS, effectsOf, skillRowsOf, specializationRowsOf } from '#src/mods/artifact-effects.ts';
import type { EffectRow, EffectStat, SetEffect } from '#src/mods/artifact-effects.ts';
import type { ArtifactExeResult } from '#src/exe/artifact-limit.ts';
import { artifactNumbers } from '#src/mods/artifacts.ts';
import type { ExeResult } from '#src/exe/creature-limit.ts';
import { buildCreatureMod } from '#src/mods/creature-mod.ts';
import { DRAGON_TAG } from '#src/mods/creatures.ts';
import { findCreatureMods, installCreatureMod, packCreatureMod } from '#src/mods/mod-archive.ts';
// The emptiness test lives with the model, beside the things it counts: it was
// written out twice and the second copy went stale the moment a new kind
// arrived — installing the first class of a mod deleted the archive and
// reported success.
import { modIsEmpty, newCreatureMod } from '#src/mods/mod-model.ts';
import { MOD_STEM, dataReader } from '#src/mods/mod-files.ts';
import type { CreatureMod } from '#src/mods/mod-model.ts';
import type { Installed } from '#src/mods/mod-archive.ts';
import type { BuildReport } from '#src/mods/mod-files.ts';
import { writeEffectsFile } from '#src/mods/extension.ts';
import { MOD_DIR, modFile } from '#src/game/mod-paths.ts';

/**
 * OUR mod: the one manifest-carrying archive in our folder, or a fresh one under
 * the default stem. The dialog never picks the archive — two creature mods
 * conflict outright, so the only sane target is the one that exists.
 */
export function ourMod(g: string): CreatureMod {
  const ours = findCreatureMods(g).filter((f) => !f.reconstructed);
  if (ours.length > 1) {
    throw new Error(`more than one creature mod in ${MOD_DIR} (${ours.map((f) => basename(f.path)).join(', ')}) — they conflict; remove one first`);
  }
  return ours[0]?.mod ?? newCreatureMod(MOD_STEM);
}

/**
 * The extension's rows for the whole mod — its artifacts and its sets.
 *
 * A set names its members by id, and the extension counts them by number, so a
 * member the mod does not own is looked up in the game's own `types.xml`.
 */
function modEffects(mod: CreatureMod): EffectRow[] {
  let shipped: Map<string, number> | undefined;
  return effectsOf(mod.artifacts ?? [], mod.sets ?? [], (id) => {
    shipped ??= artifactNumbers(dataReader(gameData())('types.xml')?.toString('latin1') ?? '');
    return shipped.get(id);
  });
}

/**
 * The mod's creatures that call themselves dragons, by the number a battle
 * knows them under.
 *
 * The tag is an `<Item>` in the creature's own `<Abilities>` (DRAGON_TAG), so
 * it travels with the record and survives reopening the mod; here it becomes
 * the one line of the config the extension reads when a rune asks whether the
 * stack in front of it is a dragon.
 */
function modDragons(mod: CreatureMod): number[] {
  return mod.creatures.filter((c) => c.stats.abilities.includes(DRAGON_TAG)).map((c) => c.number);
}

/**
 * Build the mod, pack it, install it — the shared tail of both installs.
 *
 * The effects file is rewritten here, from the WHOLE mod, rather than beside
 * each caller: it is derived from the manifest, so anything that changes the
 * manifest changes it. Written per caller, a set installed through one handler
 * and an artifact removed through another drift apart, and the file keeps
 * granting what the mod no longer carries.
 */
export function buildAndInstall(g: string, mod: CreatureMod): { installed: Installed; report: BuildReport } {
  // Removing the LAST thing in the mod leaves nothing to build, and building
  // nothing throws — so the archive goes instead. Reached by removing the last
  // hero, the last artifact or the last creature alike; it was the hero that
  // found it, because a hero is the one kind you might install on its own.
  if (modIsEmpty(mod)) {
    const archive = modFile(g, 'mod', mod.stem);
    rmSync(archive, { force: true });
    writeEffectsFile(g, [], []);
    return {
      installed: { archive, exe: null, artifacts: null, tables: [] },
      report: { files: [], limit: 0, art: {}, missing: [] },
    };
  }
  const report = buildCreatureMod(mod, dataReader(gameData()));
  const archive = packCreatureMod(report);
  const installed = installCreatureMod(g, mod, archive);
  writeEffectsFile(
    g, modEffects(mod), specializationRowsOf(mod.specializations ?? []), skillRowsOf(mod.skills ?? []),
    modDragons(mod),
  );
  return { installed, report };
}

export const exeWords = (r: ExeResult | ArtifactExeResult | null): string =>
  r ? `${basename(r.path)} → ceiling ${r.to}${'build' in r ? ` (${r.build})` : ''}` : 'executable not touched';

/** Only the stats the extension knows, and only when they are not zero. */
export function effectsFrom(raw: Record<string, number> | undefined): Partial<Record<EffectStat, number>> | null {
  if (!raw) return null;
  const out: Partial<Record<EffectStat, number>> = {};
  for (const stat of EFFECT_STATS) {
    const v = Number(raw[stat] ?? 0);
    if (v) out[stat] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The same, for a set: a stat, how many pieces it takes, and how much.
 *
 * A threshold below one is raised to one rather than refused — "worn zero
 * pieces" is a bonus the player has for free, which is never what was meant.
 */
export function setEffectsFrom(raw: ModsInstallSetPayload['effects']): SetEffect[] | null {
  const out: SetEffect[] = [];
  for (const e of raw ?? []) {
    const stat = e.stat as EffectStat;
    const amount = Number(e.amount) || 0;
    if (!amount || !EFFECT_STATS.includes(stat)) continue;
    out.push({ stat, threshold: Math.max(1, Number(e.threshold) || 1), amount });
  }
  return out.length ? out : null;
}

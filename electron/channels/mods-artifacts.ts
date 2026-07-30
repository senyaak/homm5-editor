// Artifacts and the sets they combine into.
//
// An artifact costs the executable a table slot, so installing or removing one
// moves a ceiling with it; a set costs it nothing — nothing is indexed by a
// set — and rides along in the same archive because a mod replaces types.xml
// whole rather than merging it.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ModsInstallArtifactPayload, ModsInstallArtifactResult, ModsInstallSetPayload, ModsInstallSetResult, ModsRemovePayload, ModsRemoveResult, ModsUsesResult } from '#electron/ipc.ts';
import { buildAndInstall, effectsFrom, exeWords, ourMod, setEffectsFrom } from '#electron/channels/mods-shared.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { join } from 'node:path';
import { describeUses, findArtifactUses } from '#src/artifact-usage.ts';
import type { ArtifactRank, ArtifactSlot, ArtifactSpec, HeroStats } from '#src/artifacts.ts';
import { addArtifact, addArtifactSet, artifactLimit, removeArtifact, removeArtifactSet, updateArtifact, updateArtifactSet } from '#src/creature-mod.ts';
import { Registry } from '#src/registry.ts';

/** The spec an artifact payload describes, shared by install and update. */
function artifactSpecOf(p: ModsInstallArtifactPayload): ArtifactSpec {
  const stats: Partial<HeroStats> = {};
  for (const k of ['Attack', 'Defence', 'Knowledge', 'SpellPower', 'Morale', 'Luck'] as const) {
    const v = Number(p.stats?.[k] ?? 0);
    if (v) stats[k] = v;
  }
  const effects = effectsFrom(p.effects);
  return {
    id: p.id.trim(), file: p.file.trim(),
    name: p.name, description: p.description,
    slot: p.slot as ArtifactSlot, rank: p.rank as ArtifactRank,
    cost: Number(p.cost) || 0, aiValue: Number(p.aiValue) || 0,
    canBeGeneratedToSell: !!p.canBeGeneratedToSell,
    ...(Object.keys(stats).length ? { stats } : {}),
    ...(effects ? { effects } : {}),
    icon: p.icon.trim(),
    ...(p.model?.trim() ? { model: p.model.trim() } : { board: { tiles: p.boardTiles || 1 } }),
  };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModArtifacts(): void {
  ipcMain.handle('mods:install-artifact', async (_e: IpcMainInvokeEvent, p: ModsInstallArtifactPayload): Promise<ModsInstallArtifactResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into and the executable');
    if (!isConfigured()) throw new Error('no data root configured');
    if (!p.file.trim()) throw new Error('the file stem is required');
    if (!p.icon.trim()) throw new Error('an icon href is required — take the donor\'s');

    const mod = ourMod(g);
    const stats: Partial<HeroStats> = {};
    for (const k of ['Attack', 'Defence', 'Knowledge', 'SpellPower', 'Morale', 'Luck'] as const) {
      const v = Number(p.stats?.[k] ?? 0);
      if (v) stats[k] = v;
    }
    addArtifact(mod, {
      id: p.id.trim(), file: p.file.trim(),
      name: p.name, description: p.description,
      slot: p.slot as ArtifactSlot, rank: p.rank as ArtifactRank,
      cost: Number(p.cost) || 0, aiValue: Number(p.aiValue) || 0,
      canBeGeneratedToSell: !!p.canBeGeneratedToSell,
      ...(Object.keys(stats).length ? { stats } : {}),
      ...(effectsFrom(p.effects) ? { effects: effectsFrom(p.effects)! } : {}),
      icon: p.icon.trim(),
      // No model → a flat board of the artifact's own icon stands on the map.
      ...(p.model?.trim() ? { model: p.model.trim() } : { board: { tiles: p.boardTiles || 1 } }),
    });

    const { installed } = buildAndInstall(g, mod);
    return {
      archive: installed.archive,
      limit: artifactLimit(mod),
      exe: exeWords(installed.artifacts),
    };
  });

  ipcMain.handle('mods:update-artifact', async (_e: IpcMainInvokeEvent, p: ModsInstallArtifactPayload): Promise<ModsInstallArtifactResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    updateArtifact(mod, p.id.trim(), artifactSpecOf(p));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, limit: artifactLimit(mod), exe: exeWords(installed.artifacts) };
  });

  ipcMain.handle('mods:remove-artifact', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const gone = removeArtifact(mod, id);
    // Rebuilt and reinstalled, ceiling and all: the executable's artifact count
    // has to come back down with it or the game reads a table shorter than it
    // was told to expect.
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });

  // Looked up BEFORE anything is removed, so the person deciding sees the list.
  // A map names an artifact by name, so this is exact rather than a guess.
  ipcMain.handle('mods:artifact-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
    const uses = findArtifactUses(join(gameData(), 'Maps'), [id]).get(id) ?? [];
    return { uses: describeUses(uses) };
  });

  ipcMain.handle('mods:remove-set', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const gone = removeArtifactSet(mod, id);
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.effect };
  });

  ipcMain.handle('mods:update-set', async (_e: IpcMainInvokeEvent, p: ModsInstallSetPayload): Promise<ModsInstallSetResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const set = updateArtifactSet(mod, p.effect.trim(), {
      effect: p.effect.trim(),
      artifacts: p.artifacts.map((a) => a.trim()).filter(Boolean),
      file: p.file.trim(),
      name: p.name,
      description: p.description,
      ...(p.perCount?.length ? { perCount: p.perCount } : {}),
      ...(setEffectsFrom(p.effects) ? { effects: setEffectsFrom(p.effects)! } : {}),
      ...(p.script?.trim() ? { script: p.script } : {}),
    });
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: set.number };
  });

  // A set costs the executable nothing — no table is indexed by it, no ceiling
  // counts it. It rides in the same archive as everything else because a mod
  // replaces `types.xml` whole rather than merging it, which is also why members
  // may name the mod's own artifacts: by then they are in the same file.
  ipcMain.handle('mods:install-set', async (_e: IpcMainInvokeEvent, p: ModsInstallSetPayload): Promise<ModsInstallSetResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into and the executable');
    if (!isConfigured()) throw new Error('no data root configured');
    if (!p.file.trim()) throw new Error('the file stem is required');

    const mod = ourMod(g);
    const known = new Set([
      ...(mod.artifacts ?? []).map((a) => a.id),
      ...new Registry(gameData()).artifacts().map((a) => a.id),
    ]);
    const members = p.artifacts.map((id) => id.trim()).filter(Boolean);
    // Caught here rather than at build time: a misspelt member produces a set
    // that installs cleanly and never combines, which is the worst kind of quiet.
    const unknown = members.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`no such artifact: ${unknown.join(', ')}`);

    const set = addArtifactSet(mod, {
      effect: p.effect.trim(),
      artifacts: members,
      file: p.file.trim(),
      name: p.name,
      description: p.description,
      ...(p.perCount?.length ? { perCount: p.perCount } : {}),
      ...(setEffectsFrom(p.effects) ? { effects: setEffectsFrom(p.effects)! } : {}),
      ...(p.script?.trim() ? { script: p.script } : {}),
    });

    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: set.number };
  });
}

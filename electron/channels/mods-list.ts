// What the mod dialogs are filled from: what is installed, and what can be
// picked. The building blocks are the same ones tools/units-mod.ts uses.
//
// Rosters and presets come from the plain data root, not the mounted
// chain — install resolves a donor's documents there, so offering a mod's own
// creature as a donor would offer a choice that then fails.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ArtifactPresetDTO, CreaturePresetDTO, ExtensionStatus, ModsFormDataResult, ModsListResult, ModsPresetPayload } from '#electron/ipc.ts';
import { enumValues } from '#electron/spec.ts';
import { APP_ROOT, gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { EFFECT_STATS } from '#src/mods/artifact-effects.ts';
import { SPECIALIZATION_STATS } from '#src/mods/specializations.ts';
import { HERO_STAT_NAMES } from '#src/mods/artifacts.ts';
import { assets } from '#src/game/assets.ts';
import { findCreatureMods } from '#src/mods/mod-archive.ts';
import { builtDll, extensionState, installExtension } from '#src/mods/extension.ts';
import { HERO_CLASS, artChoices } from '#src/mods/heroes.ts';
import { Registry, artifactPreset, creatureAbilities, creatureAbilityNames, creaturePreset } from '#src/schema/registry.ts';

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModsList(): void {
  ipcMain.handle('mods:list', async (): Promise<ModsListResult> => {
    const g = gameRoot();
    if (!g) return { gameRoot: null, mods: [] };
    const mods = findCreatureMods(g).map((f) => ({
      path: f.path,
      stem: basename(f.path).replace(/\.[^.]+$/, ''),
      limit: f.limit,
      reconstructed: !!f.reconstructed,
      // The whole creature: this list is what the form is filled from, and a
      // summary is how a creature loses its description on the way through.
      creatures: f.mod.creatures.map((c) => ({
        id: c.id, number: c.number, name: c.name, tier: c.stats.tier, gold: c.stats.gold,
        file: c.file, description: c.description,
        ...(c.abilitiesText ? { abilitiesText: c.abilitiesText } : {}),
        stats: c.stats,
        ...(c.from ? { from: c.from as Record<string, string> } : {}),
        ...(c.donor ? { donor: c.donor } : {}),
        ...(c.raisedAs ? { raisedAs: c.raisedAs } : {}),
      })),
      // The effects ride along: the dialog fills its rows from this list, and an
      // artifact opened for editing without them saves none — so changing a price
      // took the bonus away. The DTO always declared the field; this is what
      // finally fills it.
      // The whole hero: this list is where editing starts, and a summary would
      // mean a form that silently forgets whatever it did not carry. `art` is
      // flattened to plain strings — the renderer keys it by slot name and has no
      // business importing the type.
      heroes: (f.mod.heroes ?? []).map((h) => ({
        ...h,
        art: Object.fromEntries(Object.entries(h.art ?? {}).filter(([, v]) => !!v)) as Record<string, string>,
      })),
      // `?? []` for the same reason the sets have it: a mod installed before
      // buildings existed has a manifest without the field, and it stays listable.
      buildings: (f.mod.buildings ?? []).map((b) => ({ ...b })),
      specializations: (f.mod.specializations ?? []).map((s) => ({ ...s })),
      classes: (f.mod.classes ?? []).map((c) => ({ ...c })),
      skills: (f.mod.skills ?? []).map((s) => ({ ...s })),
      // Whole, and `?? []` for the reason the sets have it: a mod installed
      // before spells existed has a manifest without the field, and it stays
      // listable. The `spares` and the tiles come along because they are what
      // the form is refilled from — neither is in the spell's document, so the
      // manifest is the only place they exist.
      spells: (f.mod.spells ?? []).map(({ spares, area, ...rest }) => ({
        ...rest,
        ...(spares ? { spares: [...spares] } : {}),
        ...(area ? { area: area.map((t) => ({ x: t.x, y: t.y })) } : {}),
      })),
      artifacts: (f.mod.artifacts ?? []).map((a) => ({
        id: a.id, number: a.number, name: a.name, description: a.description,
        slot: a.slot, rank: a.rank, cost: a.cost, aiValue: a.aiValue,
        canBeGeneratedToSell: a.canBeGeneratedToSell,
        ...(a.stats ? { stats: a.stats } : {}),
        ...(a.effects ? { effects: a.effects } : {}),
        ...(a.icon ? { icon: a.icon } : {}),
        ...(a.model ? { model: a.model } : {}),
        ...(a.board ? { board: a.board } : {}),
      })),
      // `?? []` and not a plain read: a mod installed before sets existed has a
      // manifest without the field, and it stays listable.
      sets: (f.mod.sets ?? []).map((s) => ({
        effect: s.effect, number: s.number, file: s.file, name: s.name, description: s.description,
        artifacts: s.artifacts,
        ...(s.perCount?.length ? { perCount: s.perCount } : {}),
        ...(s.effects?.length ? { effects: s.effects } : {}),
        ...(s.script ? { script: s.script } : {}),
      })),
    }));
    return { gameRoot: g, mods };
  });

  ipcMain.handle('mods:form-data', async (): Promise<ModsFormDataResult> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const r = new Registry(gameData());
    return {
      donors: r.creatures(),
      artifactDonors: r.artifacts(),
      effectStats: [...EFFECT_STATS],
      specializationStats: [...SPECIALIZATION_STATS],
      heroStats: [...HERO_STAT_NAMES],
      abilities: creatureAbilities(assets([gameData()])),
      abilityNames: creatureAbilityNames(assets([gameData()])),
      towns: r.races(),
      heroDonors: r.heroes(),
      skills: r.skills(),
      spells: r.spells(),
      // Straight from the spec, not through valuesFor(): that answers for the
      // fields OUR schema knows, and the schema knows AdvMapHero — the thing on
      // a map — not AdvMapHeroShared, the character behind it. These three are
      // exactly what a map cannot reach and a new hero exists to set.
      heroEnums: enumValues(HERO_CLASS, ['TownType', 'Class', 'Specialization']),
      heroArt: artChoices(r.heroes(), (rel) => assets([gameData()]).text(rel)),
    };
  });

  ipcMain.handle('mods:preset', async (_e: IpcMainInvokeEvent, { donor }: ModsPresetPayload): Promise<CreaturePresetDTO> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const preset = creaturePreset(assets([gameData()]), donor);
    if (!preset) throw new Error(`cannot read the donor ${donor || '(none)'}`);
    return preset;
  });

  ipcMain.handle('mods:artifact-preset', async (_e: IpcMainInvokeEvent, { donor }: ModsPresetPayload): Promise<ArtifactPresetDTO> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const preset = artifactPreset(assets([gameData()]), donor);
    if (!preset) throw new Error(`cannot read the donor ${donor || '(none)'}`);
    return preset;
  });

  ipcMain.handle('mods:extension-status', async (): Promise<ExtensionStatus> => {
    const g = gameRoot();
    if (!g) return { present: false, imported: false, installed: false };
    return { ...extensionState(g), ...(existsSync(builtDll(APP_ROOT)) ? {} : { unbuilt: true }) };
  });

  ipcMain.handle('mods:install-extension', async (): Promise<ExtensionStatus> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    return installExtension(g, APP_ROOT);
  });
}

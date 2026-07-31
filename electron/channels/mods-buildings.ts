// Buildings: the classes, adding one, changing one, taking one out.
//
// A building holds no number and extends no table — it is a document picking
// one of the behaviours the executable already has — so nothing here moves an
// id or a ceiling. What it does do is carry ART: a build copies the whole
// closure behind the model into the mod, which is why installing one is slower
// than installing a hero and why changing one is a rebuild rather than a patch.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  BuildingClassDTO, BuildingPresetDTO, ModsBuildingDataResult, ModsBuildingPayload,
  ModsBuildingPresetPayload, ModsBuildingResult, ModsRemoveBuildingPayload,
} from '#electron/ipc.ts';
import { buildAndInstall, ourMod } from '#electron/mod-install.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { assets } from '#src/game/assets.ts';
import {
  BUILDING_CLASSES, extraFields, listFields, messageSlots, requiredFields, takesType,
} from '#src/mods/buildings.ts';
import type { BuildingSpec } from '#src/mods/buildings.ts';
import { buildingPreset, listBuildingDonors } from '#src/mods/building-presets.ts';
import { addBuilding, removeBuilding, updateBuilding } from '#src/mods/mod-model.ts';
import { Registry } from '#src/schema/registry.ts';
import { enumValues } from '#electron/spec.ts';
import { readTypeSpec, typesXmlPath } from '#src/schema/typespec.ts';
import type { SpecType } from '#src/schema/typespec.ts';

/** The game's spec, read once per call — it is 2.5 MB of XML. */
function spec(): Map<string, SpecType> {
  const path = typesXmlPath(gameData());
  if (!path) throw new Error('the data root has no types.xml');
  return readTypeSpec(path);
}

/** One payload, one spec — shared by adding a building and by changing one. */
function buildingSpecOf(p: ModsBuildingPayload): BuildingSpec {
  const file = p.file.trim();
  if (!file) throw new Error('the identifier is required');
  if (!p.className) throw new Error('a building needs a class');
  if (!p.model?.trim()) throw new Error('a building needs a model');
  const art = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);
  return {
    file,
    className: p.className,
    ...(p.type ? { type: p.type } : {}),
    model: p.model.trim(),
    ...(art(p.animSet) ? { animSet: art(p.animSet) } : {}),
    ...(art(p.effect) ? { effect: art(p.effect) } : {}),
    ...(art(p.effectWhenOwned) ? { effectWhenOwned: art(p.effectWhenOwned) } : {}),
    ...(art(p.sound) ? { sound: art(p.sound) } : {}),
    ...(art(p.icon) ? { icon: art(p.icon) } : {}),
    messages: p.messages ?? {},
    ...(p.fields && Object.keys(p.fields).length ? { fields: p.fields } : {}),
    ...(p.footprint ? { footprint: p.footprint } : {}),
    ...(p.bake?.tiles ? { bake: p.bake } : {}),
    ...(p.recolor ? { recolor: p.recolor } : {}),
  };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModBuildings(): void {
  // Everything a form needs to exist: the classes with their own fields, the
  // shipped definitions to start from, and the value lists those fields take.
  ipcMain.handle('mods:building-data', async (): Promise<ModsBuildingDataResult> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const types = spec();
    const data = assets([gameData()]);
    const classes: BuildingClassDTO[] = BUILDING_CLASSES.map((c) => ({
      ...c,
      takesType: takesType(types, c.shared),
      // Type is offered as its own control, so it is not repeated in the list
      // of the class's own fields.
      fields: extraFields(types, c.shared).filter((f) => f !== 'Type'),
      lists: listFields(types, c.shared),
      required: [...requiredFields(c.shared)],
      slots: [...messageSlots(c.shared)],
    }));
    const r = new Registry(gameData());
    return {
      classes,
      donors: listBuildingDonors(data),
      // The 128 behaviours, and the value lists the class fields take. Straight
      // from the spec: our own schema knows AdvMapBuilding — the thing on a map
      // — not AdvMapBuildingShared, the definition behind it.
      types: enumValues('AdvMapBuildingShared', ['Type']).Type ?? [],
      enums: {
        ...enumValues('AdvMapDwellingShared', ['RandomType']),
        ...enumValues('AdvMapTentShared', ['Color']),
        ...enumValues('AdvMapShrineShared', ['RunicMagic']),
      },
      creatures: r.creatures(),
    };
  });

  ipcMain.handle('mods:building-preset', async (_e: IpcMainInvokeEvent, { donor }: ModsBuildingPresetPayload): Promise<BuildingPresetDTO> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const preset = buildingPreset(assets([gameData()]), donor, spec());
    if (!preset) throw new Error(`cannot read the donor ${donor || '(none)'}`);
    return preset;
  });

  ipcMain.handle('mods:install-building', async (_e: IpcMainInvokeEvent, p: ModsBuildingPayload): Promise<ModsBuildingResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const added = addBuilding(mod, buildingSpecOf(p));
    const { installed, report } = buildAndInstall(g, mod);
    return { archive: installed.archive, file: added.file, art: artCount(report.files, added.file) };
  });

  ipcMain.handle('mods:update-building', async (_e: IpcMainInvokeEvent, p: ModsBuildingPayload): Promise<ModsBuildingResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const changed = updateBuilding(mod, p.file.trim(), buildingSpecOf(p));
    const { installed, report } = buildAndInstall(g, mod);
    return { archive: installed.archive, file: changed.file, art: artCount(report.files, changed.file) };
  });

  ipcMain.handle('mods:remove-building', async (_e: IpcMainInvokeEvent, { file }: ModsRemoveBuildingPayload): Promise<ModsBuildingResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const gone = removeBuilding(mod, file);
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, file: gone.file, art: 0 };
  });
}

/** How many files the building's own folder ended up with — its art, mostly. */
function artCount(files: readonly { path: string }[], file: string): number {
  const prefix = `Buildings/${file}/`;
  return files.filter((f) => f.path.replace(/\\/g, '/').startsWith(prefix)).length;
}

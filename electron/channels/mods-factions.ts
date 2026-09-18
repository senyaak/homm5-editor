// Factions: the donors, a donor's tree, adding one, changing one, taking one out.
//
// A faction holds a NUMBER — a twelfth town type — and extends three reference
// tables, so installing one moves four numbers in the executable
// (src/exe/faction-limit.ts) beside the archive; every handler ends in the
// same rebuild-pack-install tail the other kinds use (mod-install.ts), and
// the tail sets the numbers from the whole mod.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  FactionDonorDTO, FactionTreeDTO, ModsFactionDataResult, ModsFactionPayload, ModsFactionResult,
  ModsFactionTreePayload, ModsRemoveFactionPayload,
} from '#electron/ipc.ts';
import { buildAndInstall, ourMod } from '#electron/mod-install.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { state } from '#electron/state.ts';
import { enumValues } from '#electron/spec.ts';
import { dataReader } from '#src/mods/mod-files.ts';
import { addFaction, removeFaction, updateFaction } from '#src/mods/mod-model.ts';
import { townTypeFor } from '#src/mods/factions.ts';
import type { FactionSpec } from '#src/mods/factions.ts';
import { EXTERIOR_STAGES, SHIPPED_TOWN_ORDINALS } from '#src/mods/town-files.ts';
import { readTownTree } from '#src/mods/town-tree.ts';
import { TOWN_BUILDINGS } from '#src/mods/town-button.ts';
import { Registry } from '#src/schema/registry.ts';
import type { ModFaction } from '#src/mods/factions.ts';
import type { Installed } from '#src/mods/mod-archive.ts';

/** What a player calls each shipped town. */
const DONOR_LABELS: Readonly<Record<string, string>> = {
  TOWN_HEAVEN: 'Haven', TOWN_PRESERVE: 'Sylvan', TOWN_ACADEMY: 'Academy', TOWN_DUNGEON: 'Dungeon',
  TOWN_NECROMANCY: 'Necropolis', TOWN_INFERNO: 'Inferno', TOWN_FORTRESS: 'Fortress', TOWN_STRONGHOLD: 'Stronghold',
};

/** The eight, in the ordinals' order. */
export function factionDonors(): FactionDonorDTO[] {
  return Object.entries(SHIPPED_TOWN_ORDINALS)
    .sort((a, b) => a[1] - b[1])
    .map(([type, ordinal]) => ({ type, label: DONOR_LABELS[type] ?? type, ordinal }));
}

/**
 * One payload, one spec — shared by adding and changing. The type is the
 * identifier's, always: the form never types it. Blanks are dropped so the
 * manifest says only what was said.
 */
function factionSpecOf(p: ModsFactionPayload): FactionSpec {
  const file = (p.file ?? '').trim();
  if (!file) throw new Error('the identifier is required');
  const spec: FactionSpec = {
    file,
    type: townTypeFor(file),
    donor: p.donor,
    name: (p.name ?? '').trim(),
    towns: (p.towns ?? []).map((t) => ({
      file: t.file.trim(), name: t.name.trim(), biography: t.biography ?? '', bonus: t.bonus || 'TOWN_NO_BONUS',
      ...(t.bonusText?.trim() ? { bonusText: t.bonusText.trim() } : {}),
      ...(t.scripted ? { scripted: true } : {}),
    })),
  };
  if (p.race) spec.race = p.race;
  if (p.magic) spec.magic = p.magic;
  if (p.magicSchools) spec.magicSchools = p.magicSchools;
  if (p.dwellings && Object.keys(p.dwellings).length) spec.dwellings = p.dwellings;
  if (p.siege) spec.siege = p.siege;
  if (p.exterior) spec.exterior = p.exterior;
  if (p.shooter) spec.shooter = p.shooter;
  if (p.siegeShooter) spec.siegeShooter = p.siegeShooter;
  if (p.icons) spec.icons = p.icons;
  if (p.pictures && Object.keys(p.pictures).length) spec.pictures = p.pictures;
  if (p.buildings && Object.keys(p.buildings).length) spec.buildings = p.buildings;
  if (p.script?.trim()) spec.script = p.script;
  return spec;
}

/** What the executable's four numbers were set to, for the note under the list. */
function exeWords(installed: Installed): string {
  const f = installed.factions;
  if (!f) return 'executable not touched';
  return `town types ${f.towns.to}, named towns ${f.specs.to}, generator rows ${f.presets.to}, picker clamp ${f.clamp.to}`;
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModFactions(): void {
  ipcMain.handle('mods:faction-data', async (): Promise<ModsFactionDataResult> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const r = new Registry(gameData());
    const g = gameRoot();
    const mod = g ? ourMod(g) : null;
    return {
      donors: factionDonors(),
      buildingTypes: [...TOWN_BUILDINGS],
      bonuses: enumValues('TownSpecialization', ['Bonus']).Bonus ?? ['TOWN_NO_BONUS'],
      // The four a race can be native to; the catapult is nobody's.
      warMachines: ['WAR_MACHINE_NONE', 'WAR_MACHINE_BALLISTA', 'WAR_MACHINE_FIRST_AID_TENT', 'WAR_MACHINE_AMMO_CART'],
      spells: r.spells(),
      masteries: ['MASTERY_NONE', 'MASTERY_BASIC', 'MASTERY_ADVANCED', 'MASTERY_EXPERT'],
      creatures: (mod?.creatures ?? []).map((c) => ({ id: c.id, name: c.name })),
      exteriorStages: [...EXTERIOR_STAGES],
    };
  });

  // A file of our own, kept as a PATH: a Model document's folder is read as a
  // data root of its own when the faction is built (src/mods/own-files.ts), a
  // picture is read and fitted then — so a cancelled form leaves nothing
  // behind and the file can be edited in place until the next build.
  ipcMain.handle('mods:pick-faction-file', async (_e: IpcMainInvokeEvent, { kind }: { kind: 'model' | 'picture' }): Promise<string> => {
    const opts = kind === 'model' ? {
      title: 'Choose a Model document of your own',
      properties: ['openFile' as const],
      filters: [{ name: 'Model documents', extensions: ['xdb'] }, { name: 'All files', extensions: ['*'] }],
    } : {
      title: 'Choose a picture',
      properties: ['openFile' as const],
      filters: [{ name: 'Pictures', extensions: ['png', 'gif'] }, { name: 'All files', extensions: ['*'] }],
    };
    const w = state.win;
    const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts));
    return r.canceled ? '' : r.filePaths[0] ?? '';
  });

  ipcMain.handle('mods:faction-tree', async (_e: IpcMainInvokeEvent, { donor }: ModsFactionTreePayload): Promise<FactionTreeDTO> => {
    if (!isConfigured()) throw new Error('no data root configured');
    return readTownTree(donor, dataReader(gameData()));
  });

  const done = (installed: Installed, f: ModFaction): ModsFactionResult =>
    ({ archive: installed.archive, file: f.file, type: f.type, number: f.number, exe: exeWords(installed) });

  ipcMain.handle('mods:install-faction', async (_e: IpcMainInvokeEvent, p: ModsFactionPayload): Promise<ModsFactionResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const taken = new Set(Object.keys(SHIPPED_TOWN_ORDINALS));
    const added = addFaction(mod, factionSpecOf(p), taken);
    const { installed } = buildAndInstall(g, mod);
    return done(installed, added);
  });

  ipcMain.handle('mods:update-faction', async (_e: IpcMainInvokeEvent, p: ModsFactionPayload): Promise<ModsFactionResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const changed = updateFaction(mod, (p.file ?? '').trim(), factionSpecOf(p));
    const { installed } = buildAndInstall(g, mod);
    return done(installed, changed);
  });

  ipcMain.handle('mods:remove-faction', async (_e: IpcMainInvokeEvent, { file }: ModsRemoveFactionPayload): Promise<ModsFactionResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const gone = removeFaction(mod, file);
    const { installed } = buildAndInstall(g, mod);
    return done(installed, gone);
  });
}

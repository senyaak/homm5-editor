// Creatures: adding one, changing one, taking one out.
//
// A creature's NUMBER never moves once it is assigned — that number is what
// maps, saved games and Lua store, so a creature that renumbered itself on an
// edit would repoint every army holding it.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ModsInstallPayload, ModsInstallResult, ModsRemovePayload, ModsRemoveResult, ModsUsesResult } from '#electron/ipc.ts';
import { buildAndInstall, exeWords, ourMod } from '#electron/channels/mods-shared.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { join } from 'node:path';
import { describeUses, findCreatureUses } from '#src/artifact-usage.ts';
import { assets } from '#src/assets.ts';
import { addCreature, removeCreature, updateCreature } from '#src/creature-mod.ts';
import type { CreatureSpec } from '#src/creature-mod.ts';
import { blankStats } from '#src/creatures.ts';
import { creatureSources } from '#src/registry.ts';

/**
 * One payload, one spec — shared by adding a creature and by changing one.
 *
 * Same reason as the hero side: they differ in one thing (whether the id is
 * expected to be free or expected to be its own), and two copies of a dozen
 * fields is two copies that drift.
 */
function creatureSpecOf(p: ModsInstallPayload): CreatureSpec {
  const sources = creatureSources(assets([gameData()]), p.donor);
  if (!sources) throw new Error(`cannot resolve the donor ${p.donor || '(none)'}`);
  // Art overrides: only the slots the form actually changed away from empty.
  const art: Partial<Record<'character' | 'model' | 'animSet' | 'icon', string>> = {};
  for (const [slot, href] of Object.entries(p.art ?? {})) {
    if (href && href.trim()) art[slot as keyof typeof art] = href.trim();
  }
  return {
    id: p.id.trim(), file: p.file.trim(),
    name: p.name, description: p.description,
    // Absent by default: the line is derived from the abilities at build time.
    ...(p.abilitiesText ? { abilitiesText: p.abilitiesText } : {}),
    stats: { ...blankStats(), ...p.stats },
    visualSource: sources.visual, monsterSource: sources.monster,
    ...(Object.keys(art).length ? { art } : {}),
  };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModCreatures(): void {
  ipcMain.handle('mods:install', async (_e: IpcMainInvokeEvent, p: ModsInstallPayload): Promise<ModsInstallResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into and the executable');
    if (!isConfigured()) throw new Error('no data root configured');
    if (!p.file.trim()) throw new Error('the file stem is required');

    const mod = ourMod(g);
    addCreature(mod, creatureSpecOf(p));

    const { installed, report } = buildAndInstall(g, mod);
    const added = mod.creatures[mod.creatures.length - 1]!;
    return { archive: installed.archive, limit: report.limit, exe: exeWords(installed.exe), art: report.art[added.id] ?? 0 };
  });

  /**
   * Change a creature already in the mod.
   *
   * Its NUMBER does not move, which is the whole point: that number is what maps,
   * saved games and Lua store, so a creature that renumbered itself on an edit
   * would repoint every army that holds it. The id is fixed for the same reason.
   *
   * The core has had updateCreature for a while; nothing reached it, so the
   * dialog's pencil opened a form whose Save tried to ADD the creature again and
   * was told it already existed.
   */
  ipcMain.handle('mods:update', async (_e: IpcMainInvokeEvent, p: ModsInstallPayload): Promise<ModsInstallResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');

    const mod = ourMod(g);
    const changed = updateCreature(mod, p.id.trim(), creatureSpecOf(p));
    const { installed, report } = buildAndInstall(g, mod);
    return { archive: installed.archive, limit: report.limit, exe: exeWords(installed.exe), art: report.art[changed.id] ?? 0 };
  });

  ipcMain.handle('mods:creature-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
    const uses = findCreatureUses(join(gameData(), 'Maps'), [id]).get(id) ?? [];
    return { uses: describeUses(uses) };
  });

  ipcMain.handle('mods:remove-creature', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const gone = removeCreature(mod, id);
    // The ceiling comes down with it: an executable told to expect more creatures
    // than the mod carries reads past the end of the table.
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });
}

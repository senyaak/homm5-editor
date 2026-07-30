// Heroes: a character, not a map object.
//
// He is built from the shape of a shipped one and carries his own art, and his
// identifier has to be free of all 118 the game already ships — one string
// names him in a campaign, in a script and on disk.

// Rosters and presets come from the plain data root, not the mounted chain:
// install resolves the donor's documents there, so offering a mod's own
// creature would offer a choice that then fails.
import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ModsInstallHeroPayload, ModsInstallHeroResult, ModsRemovePayload, ModsRemoveResult, ModsUsesResult } from '#electron/ipc.ts';
import { buildAndInstall, ourMod } from '#electron/channels/mods-shared.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { state } from '#electron/state.ts';
import { enumValues } from '#electron/spec.ts';
import { basename, join } from 'node:path';
import { describeUses, findHeroUses } from '#src/artifact-usage.ts';
import { assets } from '#src/assets.ts';
import { addHero, removeHero, updateHero } from '#src/creature-mod.ts';
import { refPath } from '#src/dwellings.ts';
import { HERO_CLASS, HERO_DIR, artOf, heroHref, heroPaths, takenHeroIds } from '#src/heroes.ts';
import type { HeroSpec, Mastery } from '#src/heroes.ts';
import { Registry } from '#src/registry.ts';

/**
 * The enums a hero picks from, read straight out of the type spec.
 *
 * Not through valuesFor(): that answers for the fields OUR schema knows, and it
 * knows AdvMapHero — the thing on a map — not AdvMapHeroShared, the character
 * behind it. These three are exactly what a map cannot reach and a new hero
 * exists to set.
 */
export function heroEnumValues(): Record<string, string[]> {
  return enumValues(HERO_CLASS, ['TownType', 'Class', 'Specialization']);
}

/**
 * One payload, one spec — shared by adding a hero and by changing one.
 *
 * They differ in exactly one thing (whether the identifier must be free), so
 * everything else lives here: two copies of thirty fields is two copies that
 * drift, and the field that stops being carried is always the one nobody
 * remembers to check.
 */
function heroSpecOf(p: ModsInstallHeroPayload): HeroSpec {
  const stats: HeroSpec['stats'] = {};
  for (const [field, key] of [['Offence', 'offence'], ['Defence', 'defence'],
    ['Spellpower', 'spellpower'], ['Knowledge', 'knowledge']] as const) {
    const v = p.stats?.[field];
    if (v !== undefined && v !== null) stats[key] = Number(v) || 0;
  }
  return {
    id: p.id.trim(),
    name: p.name,
    biography: p.biography,
    // The window offers heroes as the roster lists them, which is the HREF a
    // map would store; the builder reads the file, so it wants the path. One
    // normalisation here rather than every caller getting it right.
    basedOn: refPath(p.basedOn.trim()),
    ...(p.art && Object.values(p.art).some(Boolean) ? { art: p.art } : {}),
    ...(p.ownFiles && Object.keys(p.ownFiles).length ? { ownFiles: p.ownFiles } : {}),
    town: p.town,
    heroClass: p.heroClass,
    ...(p.specialization ? { specialization: p.specialization } : {}),
    ...(p.specializationName ? { specializationName: p.specializationName } : {}),
    ...(p.specializationDescription ? { specializationDescription: p.specializationDescription } : {}),
    ...(p.specializationIcon ? { specializationIcon: p.specializationIcon } : {}),
    ...(p.primarySkill?.skill ? { primarySkill: {
      skill: p.primarySkill.skill, mastery: (p.primarySkill.mastery || 'MASTERY_BASIC') as Mastery,
    } } : {}),
    ...(Object.keys(stats).length ? { stats } : {}),
    ...(p.skills ? { skills: p.skills.filter((s) => s.skill).map((s) => ({
      skill: s.skill, mastery: (s.mastery || 'MASTERY_BASIC') as Mastery,
    })) } : {}),
    ...(p.perks ? { perks: p.perks.filter(Boolean) } : {}),
    ...(p.spells ? { spells: p.spells.filter(Boolean) } : {}),
    ...(p.machines ? { machines: p.machines } : {}),
    ...(p.scenarioHero !== undefined ? { scenarioHero: !!p.scenarioHero } : {}),
    ...(p.face ? { face: p.face } : {}),
    ...(p.faceSmall ? { faceSmall: p.faceSmall } : {}),
  };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModHeroes(): void {
  // What a shipped hero wears — the preset, read on demand rather than shipped
  // with the form data: one document, and only when a preset is actually picked.
  ipcMain.handle('mods:hero-art', async (_e: IpcMainInvokeEvent, { hero }: { hero: string }): Promise<Record<string, string>> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const xml = assets([gameData()]).text(refPath(hero));
    return xml ? artOf(xml) : {};
  });

  // Pick a file of the author's own for one appearance slot.
  //
  // It is copied when the hero is BUILT, not here: a form that is cancelled must
  // leave nothing behind, and until then the mod has no folder for him anyway.
  // The file is expected to be in the game's format already — this is a choice of
  // bytes, not a conversion.
  ipcMain.handle('mods:pick-hero-file', async (_e: IpcMainInvokeEvent, { id, slot }: { id: string; slot: string }): Promise<{ href: string; from: string }> => {
    const opts = {
      title: `Choose a file for ${slot}`,
      properties: ['openFile' as const],
      filters: [{ name: 'Game files', extensions: ['xdb', 'dds', 'gr2', 'bin'] }, { name: 'All files', extensions: ['*'] }],
    };
    const w = state.win;
    const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts));
    const from = r.canceled ? undefined : r.filePaths[0];
    if (!from) return { href: '', from: '' };
    // Inside his own folder, under the name it came with: everything of his in
    // one place is the point of giving him a folder at all.
    return { href: `/${HERO_DIR}/${id || 'hero'}/${basename(from)}`, from };
  });

  // Adding and changing are the same form and the same fields; what differs is
  // whether the identifier is expected to be free or expected to be his.
  ipcMain.handle('mods:update-hero', async (_e: IpcMainInvokeEvent, p: ModsInstallHeroPayload): Promise<ModsInstallHeroResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const spec = updateHero(mod, p.id.trim(), heroSpecOf(p));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, href: heroHref(heroPaths(spec)) };
  });

  ipcMain.handle('mods:install-hero', async (_e: IpcMainInvokeEvent, p: ModsInstallHeroPayload): Promise<ModsInstallHeroResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into');
    if (!isConfigured()) throw new Error('no data root configured');
    if (!p.id.trim()) throw new Error('the hero needs an identifier');
    if (!p.basedOn.trim()) throw new Error('a preset is required — a new hero starts from the shape of a shipped one');

    const mod = ourMod(g);
    // Every identifier already spoken for, the game's 118 included: one string
    // names him in a campaign, in a script and on disk, so it has to be his.
    const data = assets([gameData()]);
    const taken = takenHeroIds(new Registry(gameData()).heroes(), (rel) => data.text(rel));
    const spec = addHero(mod, heroSpecOf(p), taken);

    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, href: heroHref(heroPaths(spec)) };
  });

  ipcMain.handle('mods:remove-hero', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const gone = removeHero(mod, id);
    // No ceiling to bring back down and no table to shorten — a hero was never
    // counted anywhere. Rebuilding is only so his files leave the archive.
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });

  // Which maps reach this hero — asked BEFORE he is removed, and exact: a map
  // points at his document by href, either in its roster or under a placed hero.
  ipcMain.handle('mods:hero-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
    const href = heroHref(heroPaths({ id }));
    const uses = findHeroUses(join(gameData(), 'Maps'), [href.split('#')[0]!]).get(href.split('#')[0]!) ?? [];
    return { uses: describeUses(uses) };
  });
}

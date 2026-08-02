// Heroes: a character, not a map object.
//
// He is built from the shape of a shipped one and carries his own art, and his
// identifier has to be free of all 118 the game already ships — one string
// names him in a campaign, in a script and on disk.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  ModsClassDataResult, ModsInstallClassPayload, ModsInstallClassResult,
  ModsInstallHeroPayload, ModsInstallHeroResult, ModsInstallSkillPayload, ModsInstallSkillResult,
  ModsInstallSpecPayload, ModsInstallSpecResult,
  ModsRemovePayload, ModsRemoveResult, ModsUsesResult,
} from '#electron/ipc.ts';
import { buildAndInstall, effectsFrom, ourMod } from '#electron/mod-install.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { state } from '#electron/state.ts';
import { basename, join } from 'node:path';
import { describeUses, findHeroUses } from '#src/mods/artifact-usage.ts';
import { assets } from '#src/game/assets.ts';
import {
  addHero, addHeroClass, addHeroSkill, removeHero, removeHeroClass, removeHeroSkill,
  removeSpecialization, addSpecialization, updateHero, updateHeroClass, updateHeroSkill,
  updateSpecialization,
} from '#src/mods/mod-model.ts';
import {
  CLASS_TABLE, SKILL_TABLE, readClasses, readPerks, takenClasses,
} from '#src/mods/hero-classes.ts';
import type { HeroClassSpec } from '#src/mods/hero-classes.ts';
import { takenSkills } from '#src/mods/hero-skills.ts';
import type { HeroSkillSpec } from '#src/mods/hero-skills.ts';
import { takenSpecializations } from '#src/mods/specializations.ts';
import type { SpecializationSpec, SpecializationStat } from '#src/mods/specializations.ts';
import { TYPES } from '#src/mods/mod-files.ts';
import { refPath } from '#src/mods/dwellings.ts';
import { HERO_DIR, artOf, heroHref, heroPaths, takenHeroIds } from '#src/mods/heroes.ts';
import type { HeroSpec, Mastery } from '#src/mods/heroes.ts';
import { Registry } from '#src/schema/registry.ts';

// Rosters and presets come from the plain data root, not the mounted chain:
// install resolves the donor's documents there, so offering a mod's own
// creature would offer a choice that then fails.
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
    // Pictures, not hrefs: the mod builds the textures and points him at them.
    ...(p.portrait?.trim() ? { portrait: p.portrait.trim() } : {}),
    ...(p.specializationPicture?.trim() ? { specializationPicture: p.specializationPicture.trim() } : {}),
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

/**
 * One payload, one spec — the same shape the hero side has, and for the reason.
 *
 * A percentage of zero is no effect at all, and a row that adds nothing is
 * indistinguishable in game from a row that was never written, so it is dropped
 * here rather than carried into the config file as a lie.
 */
function specOf(p: ModsInstallSpecPayload): SpecializationSpec {
  const percent = Number(p.effect?.percentPerLevel) || 0;
  return {
    id: p.id.trim(),
    name: p.name.trim(),
    description: p.description,
    ...(p.picture?.trim() ? { picture: p.picture.trim() } : {}),
    ...(p.icon?.trim() ? { icon: p.icon.trim() } : {}),
    ...(p.effect?.stat && percent
      ? { effect: { stat: p.effect.stat as SpecializationStat, percentPerLevel: percent } }
      : {}),
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

  // A drawing, kept as a PATH. Nothing is copied and no texture is written
  // here: the pair the game reads is built when the hero is, which is why the
  // same picture can be edited and the mod rebuilt without touching the form.
  ipcMain.handle('mods:pick-picture', async (): Promise<string> => {
    const opts = {
      title: 'Choose a picture',
      properties: ['openFile' as const],
      filters: [{ name: 'Pictures', extensions: ['gif'] }, { name: 'All files', extensions: ['*'] }],
    };
    const w = state.win;
    const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts));
    return r.canceled ? '' : r.filePaths[0] ?? '';
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

  // Specializations. They live in this file because they are a hero's, and
  // because nothing else in the editor can hold one: the value is written into
  // a hero's document and into the file the extension reads, and both of those
  // are here already.
  ipcMain.handle('mods:install-specialization', async (_e: IpcMainInvokeEvent, p: ModsInstallSpecPayload): Promise<ModsInstallSpecResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    // Every name the game's own enum holds, so ours cannot shadow one: a
    // duplicate entry is not an error the game reports, it is a value that
    // resolves to whichever the parser saw first.
    const types = assets([gameData()]).text(TYPES) ?? '';
    const spec = addSpecialization(mod, specOf(p), takenSpecializations(types));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:update-specialization', async (_e: IpcMainInvokeEvent, p: ModsInstallSpecPayload): Promise<ModsInstallSpecResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    const spec = updateSpecialization(mod, p.id.trim(), specOf(p));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:remove-specialization', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    const mod = ourMod(g);
    // Refused while a hero of the mod holds it — see removeSpecialization. A
    // hero left naming a value the enum no longer declares is a parse error and
    // not "no specialization", so this is the one place to catch it.
    const gone = removeSpecialization(mod, id);
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });


  // Classes and skills. In this file for the reason specializations are: both
  // are a HERO's, both are named by his document, and the mod they go into is
  // already open here.
  //
  // One payload, one spec, as the hero side does it — the field that stops being
  // carried is always the one nobody remembers to check.
  const classSpecOf = (p: ModsInstallClassPayload): HeroClassSpec => ({
    id: p.id.trim(),
    name: p.name,
    skills: p.skills.map((w) => ({ skill: w.skill, prob: Number(w.prob) || 0 })),
    attributes: {
      offence: Number(p.attributes.offence) || 0,
      defence: Number(p.attributes.defence) || 0,
      spellpower: Number(p.attributes.spellpower) || 0,
      knowledge: Number(p.attributes.knowledge) || 0,
    },
    ...(p.preferredSpells?.length ? { preferredSpells: p.preferredSpells } : {}),
    ...(p.allowedPerks?.length ? { allowedPerks: p.allowedPerks } : {}),
  });

  const skillSpecOf = (p: ModsInstallSkillPayload): HeroSkillSpec => ({
    id: p.id.trim(),
    kind: p.kind,
    heroClass: p.heroClass,
    name: p.name,
    ...(p.names?.length ? { names: p.names } : {}),
    description: p.description,
    ...(p.descriptions?.length ? { descriptions: p.descriptions } : {}),
    ...(p.commonDescription ? { commonDescription: p.commonDescription } : {}),
    ...(p.icons?.length ? { icons: p.icons } : {}),
    ...(p.picture?.trim() ? { picture: p.picture.trim() } : {}),
    ...(p.pictures?.length ? { pictures: p.pictures.filter((x) => x.trim()) } : {}),
    ...(p.basicSkill ? { basicSkill: p.basicSkill } : {}),
    ...(p.prerequisites?.length ? { prerequisites: p.prerequisites } : {}),
    ...(p.aiRace ? { aiRace: p.aiRace } : {}),
    // Only the stats the extension knows, and only when they are not zero —
    // the same filter an artifact's effects go through, and for the same
    // reason: a zero row is a row that lies about being in effect.
    ...(effectsFrom(p.effects) ? { effects: effectsFrom(p.effects)! } : {}),
    // Blank is absent, on both sides: a skill carrying an empty script would
    // have the mod replace one of the game's two global Lua files to load a
    // file with nothing in it.
    ...(p.script?.trim() ? { script: p.script } : {}),
    ...(p.combatScript?.trim() ? { combatScript: p.combatScript } : {}),
  });

  /** The mod, or a refusal saying which of the two configurations is missing. */
  const openMod = (): { g: string; mod: ReturnType<typeof ourMod> } => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into');
    if (!isConfigured()) throw new Error('no data root configured');
    return { g, mod: ourMod(g) };
  };

  ipcMain.handle('mods:install-class', async (_e: IpcMainInvokeEvent, p: ModsInstallClassPayload): Promise<ModsInstallClassResult> => {
    const { g, mod } = openMod();
    const types = assets([gameData()]).text(TYPES) ?? '';
    const spec = addHeroClass(mod, classSpecOf(p), takenClasses(types));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:update-class', async (_e: IpcMainInvokeEvent, p: ModsInstallClassPayload): Promise<ModsInstallClassResult> => {
    const { g, mod } = openMod();
    const spec = updateHeroClass(mod, p.id.trim(), classSpecOf(p));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:remove-class', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const { g, mod } = openMod();
    const gone = removeHeroClass(mod, id);
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });

  ipcMain.handle('mods:install-skill', async (_e: IpcMainInvokeEvent, p: ModsInstallSkillPayload): Promise<ModsInstallSkillResult> => {
    const { g, mod } = openMod();
    const types = assets([gameData()]).text(TYPES) ?? '';
    const spec = addHeroSkill(mod, skillSpecOf(p), takenSkills(types));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:update-skill', async (_e: IpcMainInvokeEvent, p: ModsInstallSkillPayload): Promise<ModsInstallSkillResult> => {
    const { g, mod } = openMod();
    const spec = updateHeroSkill(mod, p.id.trim(), skillSpecOf(p));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:remove-skill', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const { g, mod } = openMod();
    const gone = removeHeroSkill(mod, id);
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });

  // What the class form is built from. Read off the game's own two tables rather
  // than described here: the weights a donor copies, the perks and the gate on
  // each of them are facts about the install, and a list kept in the renderer
  // would be a second copy of them to drift.
  ipcMain.handle('mods:class-data', async (): Promise<ModsClassDataResult> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const data = assets([gameData()]);
    const classTable = data.text(CLASS_TABLE) ?? '';
    const skillTable = data.text(SKILL_TABLE) ?? '';
    const registry = new Registry(gameData());
    const named = new Map(registry.skills().map((s) => [s.id, s.name || s.id]));
    const perks = readPerks(skillTable);
    const perkIds = new Set(perks.map((p) => p.id));
    // The mod's own skills, which the game's data root knows nothing about: a
    // racial of ours exists only inside the archive, and a class that could not
    // weight it could not offer it at a level up either.
    const g = gameRoot();
    const ourSkills = g ? (ourMod(g).skills ?? []) : [];
    return {
      // A class weights SKILLS, not perks — the thirteen rows of the shipped
      // classes are the twelve common skills and one racial, and no perk is
      // among them.
      skills: [
        ...registry.skills().filter((s) => !perkIds.has(s.id))
          .map((s) => ({ id: s.id, ...(s.name ? { name: s.name } : {}) })),
        ...ourSkills.filter((s) => s.kind === 'racial')
          .map((s) => ({ id: s.id, name: `${s.name || s.id} (ours)` })),
      ],
      perks: perks.map((p) => ({ ...p, name: named.get(p.id) ?? p.id })),
      donors: readClasses(classTable).map((c) => ({
        id: c.id,
        // The record's href is relative to the table it sits beside, which is
        // why this is not a data path until the table's folder is put in front.
        name: c.nameRef ? (data.text(`GameMechanics/RefTables/${c.nameRef}`) ?? c.id) : c.id,
        skills: c.skills,
        attributes: c.attributes,
        preferredSpells: c.preferredSpells,
        perks: perks.filter((p) => p.classes.includes(c.id))
          .map((p) => ({ perk: p.id, dependencies: p.dependencies })),
      })),
    };
  });

  // Which maps reach this hero — asked BEFORE he is removed, and exact: a map
  // points at his document by href, either in its roster or under a placed hero.
  ipcMain.handle('mods:hero-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
    const href = heroHref(heroPaths({ id }));
    const uses = findHeroUses(join(gameData(), 'Maps'), [href.split('#')[0]!]).get(href.split('#')[0]!) ?? [];
    return { uses: describeUses(uses) };
  });
}

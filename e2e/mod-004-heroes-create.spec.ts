// Adding a HERO to the game through the window, end to end.
//
// The cheapest install this editor has, and the spec is here to hold that
// claim: a creature moves a ceiling in the executable and an artifact extends a
// reference table, while a hero extends NOTHING. No enum, no table, no number,
// no patched game — three files at a path nobody owns. So this run must leave
// the executable exactly as it found it, and the archive must gain no file of
// the game's.
//
// What gets built is Gem, the pilot of the Heroes III port. Two things about
// her are the point of the feature rather than decoration:
//
//   she is an ELF of a faction whose donor she borrows her body from, which is
//   the only way to author a character at all — Class, TownType,
//   Specialization and the racial slot cannot be reached from a map (see
//   AdvMapHero/OverrideMask, which covers stats, skills, spells and machines
//   and stops there);
//
//   her specialization is OURS. The game's nearest is HERO_SPEC_EMPIRIC, the
//   Necropolis embalmer whose first aid tent heals five more per hero level;
//   Heroes III's Gem gets five PERCENT more per level, which is the same thing
//   at expert War Machines and less at every mastery below it. So the run
//   authors the specialization first — one entry appended to an enum, plus a
//   row in the file the native extension reads, because the executable does
//   nothing at all with a value it has never heard of.
//
// The two are in one spec because they are one window and one story: a
// specialization exists to be given to a hero, and the thing worth checking is
// that the value the enum gained is the value his document names.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor, REPO_ROOT } from './launch.ts';
import { settled } from './trace.ts';
import type { Launched } from './launch.ts';
import { GEM_SPEC, modGameRoot, readInstalledMod } from './mods.ts';
import { EFFECTS_FILE, readSpecializations } from '../src/mods/artifact-effects.ts';
import { SHIPPED_SPECIALIZATIONS } from '../src/mods/specializations.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { heroPaths } from '../src/mods/heroes.ts';
import { readEntries } from '../src/format/pak.ts';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { PATCHED_EXE, readExe } from '../src/exe/creature-limit.ts';

let ed: Launched;
const GAME = modGameRoot();

/** Gem, as the form is filled in. */
const GEM = {
  /** His unique identifier: InternalName in the document, stem of his files. */
  id: 'H3Gem',
  /** As the roster offers him: the href a map would store. */
  donor: '/MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)',
  /** The same, as the manifest records it and the builder reads it. */
  donorPath: 'MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb',
  name: 'Gem',
  biography: 'A sorceress of Enroth, newly come to AvLee and its druids.',
  town: 'TOWN_PRESERVE',
  heroClass: 'HERO_CLASS_RANGER',
  /** Ours, authored by the test below: the tent grows 5% per hero level. */
  spec: GEM_SPEC.id,
  specName: 'Field Medic',
  specText: 'With every level the first aid tent heals 5 more points of damage.',
  /**
   * Her own face and her own icon, as DRAWINGS — the mod builds the textures.
   *
   * This is the difference between a hero who looks like himself and one who
   * looks like his preset: art is copied from the donor into his folder, so a
   * portrait painted over that copy comes back as Ossir's the next time the mod
   * is built. A picture is re-read on every build, and lives in `assets/` where
   * the checkout carries it.
   */
  portrait: join(REPO_ROOT, 'assets', 'heroes', 'gem.gif'),
  specPicture: join(REPO_ROOT, 'assets', 'specializations', 'first_aid.gif'),
};

/** What the executable's creature ceiling was before this spec ran. */
let ceilingBefore: number | null = null;

test.beforeAll(async () => {
  const exe = join(GAME, PATCHED_EXE);
  ceilingBefore = existsSync(exe) ? readExe(readFileSync(exe)).limit : null;
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

/**
 * Open the Heroes window on one of its tabs.
 *
 * The window holds several lists and shows one at a time, so the tab has to be
 * chosen before anything in it can be clicked — a pane that is not open is not
 * visible, and Playwright will not click what nobody can see.
 */
async function openHeroes(page: Launched['page'], tab: 'Heroes' | 'Specializations'): Promise<void> {
  if (!(await page.locator('#heroesmod').isVisible())) await page.locator('#heroesbtn').click();
  await expect(page.locator('#heroesmod')).toBeVisible();
  await page.locator('#hm-tabs button', { hasText: tab }).click();
  await expect(page.locator('#hm-legend')).toContainText(tab);
}

/** Open Heroes… and the form on top of it, with the donor chosen. */
async function openWithDonor(page: Launched['page']): Promise<void> {
  await openHeroes(page, 'Heroes');
  if (!(await page.locator('#heroedit').isVisible())) await page.locator('#hm-new').click();
  // The preset is a BUTTON: press it, pick from the list it opens. It is an
  // action done once, not a field the hero carries.
  await page.locator('#he-preset-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('Ossir');
  await page.locator('#pp-list button', { hasText: 'Ossir' }).first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(page.locator('#he-preset-name')).toContainText('Ossir');
  // The preset fills the appearance fields; the model settling is the signal
  // that it has, since everything else can be set before it arrives.
  await expect(page.locator('#he-model')).not.toHaveValue('', { timeout: 30_000 });
}

test('the dialog opens, and the donor decides the faction', async () => {
  const { page } = ed;
  await openHeroes(page, 'Heroes');
  await expect(page.locator('#hm-list')).toContainText(/No heroes installed|Gem/);

  await openWithDonor(page);
  // One class per faction: choosing where he comes from chooses what he is.
  await expect(page.locator('#he-town')).toHaveValue(GEM.town);
  await expect(page.locator('#he-class')).toHaveValue(GEM.heroClass);

  // The preset seeded her looks, and they are the shipped hero's own — under
  // the fold, where appearance belongs: a hero is authored by his faction and
  // his skills, not by which model he wears.
  await expect(page.locator('#he-model')).toHaveValue(/Ranger_LOD/);
  await expect(page.locator('#he-trace')).toHaveValue(/Rampart/);

  // Any faction's specialization is on offer, because the effect is keyed to
  // the value and not to the race — that is what lets an elf be an embalmer.
  await expect(page.locator('#he-spec option[value="HERO_SPEC_EMPIRIC"]')).toHaveCount(1);
  // And the racial slot offers every skill, not just this faction's racial one:
  // the shipped Erasial is a Demon Lord holding Logistics there.
  await expect(page.locator('#he-primary option[value="HERO_SKILL_LOGISTICS"]')).toHaveCount(1);
});

/** The hero form's own refusal — the pair main names in as many words. */
test('it will not build a hero who is missing what he needs', async () => {
  const { page } = ed;
  // Same as the other two: the form is modal over the list that holds New.
  if (await page.locator('#heroedit').isVisible()) await page.locator('#heroedit-cancel').click();
  await openHeroes(page, 'Heroes');
  await page.locator('#hm-new').click();
  await expect(page.locator('#heroedit')).toBeVisible();

  await expect(page.locator('#he-ok')).toBeDisabled();
  await expect(page.locator('#he-missing')).toHaveText(/identifier.*name.*preset/);
  await expect(page.locator('#heroedit .req')).toHaveCount(3);

  await page.locator('#he-id').fill('E2eRefused');
  await page.locator('#he-name').fill('Отказник');
  await expect(page.locator('#he-ok'), 'a hero is made from the shape of one').toBeDisabled();
  await expect(page.locator('#he-missing')).toHaveText(/preset/);

  await page.locator('#he-preset-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('Ossir');
  await page.locator('#pp-list button', { hasText: 'Ossir' }).first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(page.locator('#he-ok')).toBeEnabled();
  await expect(page.locator('#he-missing')).toHaveText('');

  await page.locator('#heroedit-cancel').click();
  await expect(page.locator('#heroedit')).toBeHidden();
});

/** The specialization form's own refusal — what addSpecialization throws for. */
test('it will not build a specialization missing what it needs', async () => {
  const { page } = ed;
  await openHeroes(page, 'Specializations');
  await page.locator('#hs-new').click();
  await expect(page.locator('#specedit')).toBeVisible();

  await expect(page.locator('#hs-ok')).toBeDisabled();
  await expect(page.locator('#hs-missing')).toHaveText(/identifier.*name/);
  await expect(page.locator('#specedit .req')).toHaveCount(2);

  await page.locator('#hs-id').fill('HERO_SPEC_E2E_REFUSED');
  await expect(page.locator('#hs-ok')).toBeDisabled();
  await page.locator('#hs-name').fill('Отказник');
  await expect(page.locator('#hs-ok')).toBeEnabled();
  await expect(page.locator('#hs-missing')).toHaveText('');

  await page.locator('#specedit-cancel').click();
  await expect(page.locator('#specedit')).toBeHidden();
});

test('authors the specialization Gem will hold', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openHeroes(page, 'Specializations');
  await page.locator('#hs-new').click();
  await expect(page.locator('#specedit')).toBeVisible();

  await page.locator('#hs-id').fill(GEM_SPEC.id);
  await page.locator('#hs-name').fill(GEM_SPEC.name);
  await page.locator('#hs-desc').fill(GEM_SPEC.description);
  // Typed rather than chosen: the button beside it opens the system's file
  // dialog, which a spec cannot drive, and this field is what it writes into.
  await page.locator('#hs-pic').fill(GEM_SPEC.picture);
  // What it GIVES, and the only place in the whole editor that can say it: no
  // arrangement of the game's data expresses a specialization's effect.
  await page.locator('#hs-stat').selectOption(GEM_SPEC.effect.stat);
  await page.locator('#hs-percent').fill(String(GEM_SPEC.effect.percentPerLevel));

  const note = await settled(page, 'installing the specialization', '#hm-note', '#hs-err',
    () => page.locator('#hs-ok').click());
  expect(note).toContain('Installed');
  // The VALUE is the useful half: it is what the extension's config names it
  // by, and the first one after the 84 the game ships.
  expect(note).toContain(`value ${SHIPPED_SPECIALIZATIONS}`);
  await expect(page.locator('#hs-list')).toContainText(GEM_SPEC.name);
  await expect(page.locator('#hs-list')).toContainText('tent +5% per level');

  // The manifest, the enum entry in the archive's types.xml, and the row beside
  // the executable — the three halves of one specialization, and any two of
  // them without the third is a specialization that does nothing.
  const mod = readInstalledMod(GAME);
  const ours = (mod.specializations ?? [])[0];
  expect(ours, 'the manifest remembers it').toBeTruthy();
  expect(ours!.number).toBe(SHIPPED_SPECIALIZATIONS);
  expect(ours!.effect).toEqual(GEM_SPEC.effect);

  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const types = entries.find((e) => e.name.replace(/\\/g, '/') === 'types.xml');
  expect(types, 'the archive carries the patched types.xml').toBeTruthy();
  const xml = types!.data.toString('latin1');
  expect(xml).toContain(`<Name>${GEM_SPEC.id}</Name>`);
  expect(xml).toContain(`<Value>${SHIPPED_SPECIALIZATIONS}</Value>`);
  // And it is inside the specialization enum, not merely somewhere in the file.
  const at = xml.indexOf('<TypeName>HeroSpecialization</TypeName>');
  expect(xml.indexOf(`<Name>${GEM_SPEC.id}</Name>`)).toBeGreaterThan(at);
  expect(xml.indexOf(`<Name>${GEM_SPEC.id}</Name>`)).toBeLessThan(xml.indexOf('</Entries>', at));

  const rows = readSpecializations(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'));
  expect(rows, 'the extension is told, or the value does nothing at all').toEqual([
    { stat: 'tent', specialization: SHIPPED_SPECIALIZATIONS, percentPerLevel: 5 },
  ]);
});

test('authors Gem and installs her', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  await page.locator('#he-id').fill(GEM.id);
  await page.locator('#he-name').fill(GEM.name);
  await page.locator('#he-bio').fill(GEM.biography);

  // OURS, offered beside the game's own 84 and marked as ours — without this
  // the form could install a specialization nobody could ever be given.
  await expect(page.locator(`#he-spec option[value="${GEM.spec}"]`)).toHaveText(/ours/);
  await page.locator('#he-spec').selectOption(GEM.spec);
  // Words of her own on top of the specialization's: a specialization carries
  // what its heroes SHOULD say, and a hero may still say something else.
  await page.locator('#he-spec-name').fill(GEM.specName);
  await page.locator('#he-spec-desc').fill(GEM.specText);
  // Her own icon, beside the words it belongs to. Typed as a path rather than
  // chosen through the button next to it: the button opens the system's file
  // dialog, which a spec cannot drive, and the field is what it writes into.
  await page.locator('#he-spec-pic').fill(GEM.specPicture);
  // Her face lives under the fold with the rest of the appearance, so the fold
  // has to be opened first — the same click a person makes.
  await page.locator('#heroedit details.he-art summary').click();
  await page.locator('#he-portrait-pic').fill(GEM.portrait);

  // Her Heroes III kit, as near as Heroes V has it: the tent she is specialised
  // in, the War Machines that carry it, and First Aid on top.
  await page.locator('#he-primary').selectOption('HERO_SKILL_AVENGER');
  await page.locator('#he-skill').selectOption('HERO_SKILL_WAR_MACHINES');
  await page.locator('#he-perk').selectOption('HERO_SKILL_FIRST_AID');
  await page.locator('#he-tent').check();
  await page.locator('#he-off').fill('0');
  await page.locator('#he-def').fill('1');
  await page.locator('#he-sp').fill('2');
  await page.locator('#he-kn').fill('2');

  // Watch BOTH boxes: the form reports a refusal in #he-err, and waiting only
  // on the note spends two minutes discovering what the window said at once.
  const note = await settled(page, 'installing Gem', '#hm-note', '#he-err',
    () => page.locator('#he-ok').click());
  expect(note).toContain('Installed');
  // The href is the useful half of the result: it is what a map's roster, a
  // pool or a placed hero points at, and nothing else in the window reveals it.
  expect(note, 'the href a map, a pool or a placed hero points at').toContain('Heroes/H3Gem/H3Gem.(AdvMapHeroShared).xdb');
  await expect(page.locator('#hm-list')).toContainText('Gem');
  // Not a scenario hero, so the taverns of her faction may offer her.
  await expect(page.locator('#hm-list')).toContainText('offered by taverns');
});

test('the archive holds her, and nothing of the game\'s', async () => {
  const mod = readInstalledMod(GAME);
  const gem = (mod.heroes ?? [])[0];
  expect(gem, 'the manifest remembers her').toBeTruthy();
  expect(gem!.id).toBe(GEM.id);
  expect(gem!.town).toBe(GEM.town);
  expect(gem!.heroClass).toBe(GEM.heroClass);
  expect(gem!.specialization).toBe(GEM.spec);
  expect(gem!.basedOn).toBe(GEM.donorPath);

  const p = heroPaths(gem!);
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const names = entries.map((e) => e.name);
  for (const f of [p.shared, p.name, p.biography, p.specName, p.specDescription]) {
    expect(names, `${f} is in the archive`).toContain(f);
  }

  // Nothing of the game's: the whole reason a hero needs no patched executable
  // and no edited types.xml. Anything the archive carries that also exists in
  // the data root would be an override, and a hero must not have one.
  const dataRoot = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
  const overrides = names.filter((n) => n.startsWith('Heroes/') && existsSync(join(dataRoot, n)));
  expect(overrides, 'a hero overrides no shipped file').toEqual([]);

  // The document itself: what makes her herself, and what stayed the donor's.
  const xml = entries.find((e) => e.name === p.shared)!.data.toString('latin1');
  expect(xml).toContain('<InternalName>H3Gem</InternalName>');
  expect(xml).toContain(`<Specialization>${GEM.spec}</Specialization>`);
  expect(xml).toContain('<ScenarioHero>false</ScenarioHero>');
  expect(xml).toContain('<SkillID>HERO_SKILL_AVENGER</SkillID>');
  // The appearance the preset seeded was WRITTEN, not merely displayed.
  expect(xml).toMatch(/<Model href="[^"]*Ranger_LOD/);
  // COPIED, not referenced: her body is Ossir's model, but the archive carries
  // its own copy of it and she points at that. It is what lets her be recoloured
  // or re-modelled later without Ossir changing too.
  const modelOf = (s: string): string => /<Model href="([^"]+)"/.exec(s)?.[1] ?? '';
  expect(modelOf(xml)).toContain(`/${p.dir}/art/`);
  const donorModel = modelOf(readFileSync(join(dataRoot, GEM.donorPath), 'utf8'));
  expect(modelOf(xml), 'the same model, at her own path')
    .toBe(`/${p.dir}/art${donorModel}`);
  // HER FACE, and not the donor's. The art walk copies Ossir's portrait into
  // her folder like the rest of his looks; a picture of her own overrules it,
  // and the document has to name what was BUILT rather than what was copied —
  // otherwise every rebuild quietly restores his face over hers.
  for (const f of [p.faceDDS, p.faceXDB, p.faceSmallDDS, p.faceSmallXDB, p.specIconDDS, p.specIconXDB]) {
    expect(names, `${f} is in the archive`).toContain(f);
  }
  const hrefOf = (field: string): string =>
    new RegExp(`<${field} href="([^"]+)"`).exec(xml)?.[1] ?? '';
  expect(hrefOf('FaceTexture')).toBe(`/${p.faceXDB}#xpointer(/Texture)`);
  expect(hrefOf('FaceTextureSmall')).toBe(`/${p.faceSmallXDB}#xpointer(/Texture)`);
  expect(hrefOf('SpecializationIcon')).toBe(`/${p.specIconXDB}#xpointer(/Texture)`);
  // And the sizes the hero screen asks for. 128 is the one worth checking: the
  // drawing is 58x64, so it had to be enlarged, and `fitSquare` alone would
  // have left it a small picture in the middle of a large black square.
  const dds = (path: string) => decodeDDSBuffer(entries.find((e) => e.name === path)!.data);
  expect(dds(p.faceDDS).width, 'the portrait fills the frame').toBe(128);
  expect(dds(p.faceSmallDDS).width).toBe(64);
  expect(dds(p.specIconDDS).width).toBe(64);

  // And the copy is really in the archive, with its binary under a uid of ours.
  expect(names).toContain(`${p.dir}/art/Characters/Heroes/Ranger_LOD.xdb`);
  const bins = names.filter((n) => n.startsWith('bin/'));
  expect(bins.length, 'binaries copied under fresh uids').toBeGreaterThan(0);
  expect(bins.filter((n) => existsSync(join(dataRoot, n))), 'and none overwrites a shipped one').toEqual([]);
});

test('an installed hero opens for editing, whole', async () => {
  const { page } = ed;
  await openHeroes(page, 'Heroes');
  // The list is where editing starts: one row per hero, with the two things
  // that can be done to him.
  const row = page.locator('#hm-list .um-item', { hasText: 'Gem' }).first();
  await expect(row).toBeVisible();
  await row.locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#heroedit')).toBeVisible();
  // The form has to KNOW it is editing: same fields, different verb, and the
  // difference decides whether saving adds a second hero or changes this one.
  await expect(page.locator('#heroedit-title')).toHaveText(/Edit/);

  // Whole: the fields a summary would have dropped are the ones checked here.
  await expect(page.locator('#he-id')).toHaveValue(GEM.id);
  await expect(page.locator('#he-id')).toBeDisabled(); // it is what he IS
  await expect(page.locator('#he-spec')).toHaveValue(GEM.spec);
  await expect(page.locator('#he-spec-name')).toHaveValue(GEM.specName);
  await expect(page.locator('#he-bio')).toHaveValue(GEM.biography);
  await expect(page.locator('#he-perk')).toHaveValue('HERO_SKILL_FIRST_AID');
  await expect(page.locator('#he-tent')).toBeChecked();
  await expect(page.locator('#he-model')).toHaveValue(/Ranger_LOD/);
  // The pictures too. A field the form does not carry back is written as
  // whatever the box holds, and for these that means a hero who loses his face
  // by having his Knowledge corrected.
  await expect(page.locator('#he-portrait-pic')).toHaveValue(GEM.portrait);
  await expect(page.locator('#he-spec-pic')).toHaveValue(GEM.specPicture);

  // Change one thing and save: the rest must survive the round trip.
  await page.locator('#he-kn').fill('4');
  const note = await settled(page, 'updating Gem', '#hm-note', '#he-err',
    () => page.locator('#he-ok').click());
  expect(note).toContain('Updated');

  const gem = (readInstalledMod(GAME).heroes ?? [])[0]!;
  expect(gem.stats?.knowledge).toBe(4);
  expect(gem.specializationName, 'the words a summary would have lost').toBe(GEM.specName);
  expect(gem.perks).toEqual(['HERO_SKILL_FIRST_AID']);
  expect(gem.portrait, 'and the face she was built with').toBe(GEM.portrait);
  expect(gem.specializationPicture).toBe(GEM.specPicture);
});

test('a specialization a hero still holds cannot be taken away', async () => {
  const { page } = ed;
  await openHeroes(page, 'Specializations');
  const row = page.locator('#hs-list .um-item', { hasText: GEM_SPEC.name }).first();
  await expect(row).toBeVisible();
  await row.locator('button', { hasText: '×' }).click();
  await page.locator('#ask button', { hasText: 'Remove' }).click();

  // Refused, and the refusal names WHO is holding it — a hero left naming a
  // value the enum no longer declares is a parse error, not a hero without a
  // specialization, so this is caught rather than repaired afterwards.
  await expect(page.locator('#hm-err')).toContainText(GEM.id);
  expect((readInstalledMod(GAME).specializations ?? []).length, 'and it is still there').toBe(1);
});

test('removing says what would break, and Cancel means no', async () => {
  const { page } = ed;
  await openHeroes(page, 'Heroes');
  const row = page.locator('#hm-list .um-item', { hasText: 'Gem' }).first();
  await row.locator('button', { hasText: '×' }).click();

  // Asked in a dialog of ours, and the question names what reaches him: a map
  // points at a hero by href, in its roster or under a placed hero, so this can
  // be exact instead of a warning in general terms.
  const dialog = page.locator('#ask');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Remove Gem|reached by/);
  await dialog.locator('button', { hasText: /cancel/i }).click();
  await expect(dialog).toBeHidden();
  expect((readInstalledMod(GAME).heroes ?? []).length, 'Cancel removed nothing').toBe(1);
});

test('and removing for real takes his files with him', async () => {
  const { page } = ed;
  const row = page.locator('#hm-list .um-item', { hasText: 'Gem' }).first();
  // Through settled(), like every other install: the note still holds the last
  // message, and a plain wait-for-text reads THAT and either passes wrongly or
  // sits out its timeout. Clearing first is the whole point of the helper.
  const note = await settled(page, 'removing Gem', '#hm-note', '#hm-err', async () => {
    await row.locator('button', { hasText: '×' }).click();
    await page.locator('#ask button', { hasText: 'Remove' }).click();
  });
  expect(note).toContain('removed');

  // His folder and his palette entry go with him, or a map would still find a
  // hero the mod no longer knows about.
  //
  // Run alone, Gem is the only thing in the mod, so the ARCHIVE goes with her:
  // an archive of nothing is not a mod, and building one throws. Run after the
  // other stages, the creature and the artifacts are still in it and it stays —
  // both are correct, and which one happened is what existsSync answers.
  const archive = modFile(GAME, 'mod', MOD_STEM);
  if (!existsSync(archive)) return;
  expect(readInstalledMod(GAME).heroes ?? [], 'he is out of the manifest').toEqual([]);
  const names = readEntries(readFileSync(archive)).map((e) => e.name.replace(/\\/g, '/'));
  expect(names.filter((n) => n.includes('H3Gem'))).toEqual([]);
});

test('the executable is untouched — a hero moves no ceiling', async () => {
  const exe = join(GAME, PATCHED_EXE);
  if (!existsSync(exe)) return; // nothing was patched, which is the same claim
  expect(readExe(readFileSync(exe)).limit).toBe(ceilingBefore);
});

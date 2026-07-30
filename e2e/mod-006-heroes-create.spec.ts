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
//   her specialization is HERO_SPEC_EMPIRIC — the Necropolis embalmer, whose
//   first aid tent heals five more per hero level. A specialization's effect is
//   compiled against its enum VALUE and bound to no faction, so a Sylvan hero
//   gets the Necropolis behaviour; what does not come with it are the words,
//   which is why the form has its own name and text for one. It is also the
//   closest thing Heroes V has to Gem's own Heroes III specialty, First Aid.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { modGameRoot, readInstalledMod } from './mods.ts';
import { modFile } from '../src/mod-paths.ts';
import { MOD_STEM } from '../src/creature-mod.ts';
import { heroPaths } from '../src/heroes.ts';
import { readEntries } from '../src/pak.ts';
import { PATCHED_EXE, readExe } from '../src/creature-limit.ts';

let ed: Launched;
const GAME = modGameRoot();

/** Gem, as the form is filled in. */
const GEM = {
  /** As the roster offers him: the href a map would store. */
  donor: '/MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)',
  /** The same, as the manifest records it and the builder reads it. */
  donorPath: 'MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb',
  file: 'H3Gem',
  name: 'Gem',
  biography: 'A sorceress of Enroth, newly come to AvLee and its druids.',
  town: 'TOWN_PRESERVE',
  heroClass: 'HERO_CLASS_RANGER',
  /** The Necropolis embalmer: the tent heals five more per level. */
  spec: 'HERO_SPEC_EMPIRIC',
  specName: 'Field Medic',
  specText: 'With every level the first aid tent heals 5 more points of damage.',
};

/** What the executable's creature ceiling was before this spec ran. */
let ceilingBefore: number | null = null;

test.beforeAll(async () => {
  const exe = join(GAME, PATCHED_EXE);
  ceilingBefore = existsSync(exe) ? readExe(readFileSync(exe)).limit : null;
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

/** Open Heroes… and the form on top of it, with the donor chosen. */
async function openWithDonor(page: Launched['page']): Promise<void> {
  if (!(await page.locator('#heroesmod').isVisible())) await page.locator('#heroesbtn').click();
  if (!(await page.locator('#heroedit').isVisible())) await page.locator('#hm-new').click();
  await expect(page.locator(`#he-donor option[value="${GEM.donor}"]`)).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#he-donor').selectOption(GEM.donor);
}

test('the dialog opens, and the donor decides the faction', async () => {
  const { page } = ed;
  await page.locator('#heroesbtn').click();
  await expect(page.locator('#heroesmod')).toBeVisible();
  await expect(page.locator('#hm-list')).toContainText(/No heroes installed|Gem/);

  await openWithDonor(page);
  // One class per faction: choosing where he comes from chooses what he is.
  await expect(page.locator('#he-town')).toHaveValue(GEM.town);
  await expect(page.locator('#he-class')).toHaveValue(GEM.heroClass);

  // Any faction's specialization is on offer, because the effect is keyed to
  // the value and not to the race — that is what lets an elf be an embalmer.
  await expect(page.locator(`#he-spec option[value="${GEM.spec}"]`)).toHaveCount(1);
  // And the racial slot offers every skill, not just this faction's racial one:
  // the shipped Erasial is a Demon Lord holding Logistics there.
  await expect(page.locator('#he-primary option[value="HERO_SKILL_LOGISTICS"]')).toHaveCount(1);
});

test('authors Gem and installs her', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  await page.locator('#he-file').fill(GEM.file);
  // The name a campaign carries her by follows the stem until it is typed into.
  await expect(page.locator('#he-internal')).toHaveValue(GEM.file);
  await page.locator('#he-name').fill(GEM.name);
  await page.locator('#he-bio').fill(GEM.biography);

  // The borrowed specialization, and the words it does not bring with it.
  await page.locator('#he-spec').selectOption(GEM.spec);
  await page.locator('#he-spec-name').fill(GEM.specName);
  await page.locator('#he-spec-desc').fill(GEM.specText);

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

  await page.locator('#he-ok').click();
  await expect(page.locator('#hm-note')).toContainText('Installed into', { timeout: 120_000 });
  // The href is the useful half of the result: it is what a map's roster, a
  // pool or a placed hero points at, and nothing else in the window reveals it.
  await expect(page.locator('#hm-note')).toContainText('Heroes/H3Gem/H3Gem.(AdvMapHeroShared).xdb');
  await expect(page.locator('#hm-list')).toContainText('Gem');
  // Not a scenario hero, so the taverns of her faction may offer her.
  await expect(page.locator('#hm-list')).toContainText('offered by taverns');
});

test('the archive holds her, and nothing of the game\'s', async () => {
  const mod = readInstalledMod(GAME);
  const gem = (mod.heroes ?? [])[0];
  expect(gem, 'the manifest remembers her').toBeTruthy();
  expect(gem!.internalName).toBe(GEM.file);
  expect(gem!.town).toBe(GEM.town);
  expect(gem!.heroClass).toBe(GEM.heroClass);
  expect(gem!.specialization).toBe(GEM.spec);
  expect(gem!.donor).toBe(GEM.donorPath);

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
  // Referenced, not copied: her body is still Ossir's, by href.
  const donorXml = readFileSync(join(dataRoot, GEM.donorPath), 'utf8');
  const modelOf = (s: string): string => /<Model href="([^"]+)"/.exec(s)?.[1] ?? '';
  expect(modelOf(xml)).toBe(modelOf(donorXml));
  expect(modelOf(xml)).toBeTruthy();
});

test('the executable is untouched — a hero moves no ceiling', async () => {
  const exe = join(GAME, PATCHED_EXE);
  if (!existsSync(exe)) return; // nothing was patched, which is the same claim
  expect(readExe(readFileSync(exe)).limit).toBe(ceilingBefore);
});

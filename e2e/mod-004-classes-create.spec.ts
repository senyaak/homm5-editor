// Adding a hero CLASS and a SKILL through the window, end to end.
//
// The dearest thing the editor adds after a creature, and the spec is here to
// hold that: a class is a reference table with its size declared three times in
// types.xml and once in the executable, and any one of them left behind is a
// game that either ignores the class or refuses to start. So the run checks all
// four, and the perk gate besides.
//
// What gets built is the Witch — Gem had a class nobody else in Heroes III had,
// a Druid by every number and a different word on the screen. Hers are not the
// Ranger's: she starts from his and then says something else with them, which is
// what the donor button is for.
//
// THE ORDER IS THE POINT of the second test. A skill belongs to a class and a
// class weights skills, so neither can name the other before it exists: the
// class is authored first with its racial's ten points parked on the war
// machines, the skill second, and the class is opened again to move them. That
// is not a workaround — it is what anybody authoring both would have to do, and
// it is the only thing here that could quietly stop working when the form's
// data is cached a launch too long.
//
// Gem herself is mod-004-heroes-create's subject; this spec stops at what she
// will be made of.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import { settled } from './trace.ts';
import type { Launched } from './launch.ts';
import { TENT_MASTER as TENT, TENT_PERKS, WITCH, modGameRoot, readInstalledMod } from './mods.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { readEntries } from '../src/format/pak.ts';
import { PATCHED_EXE } from '../src/exe/creature-limit.ts';
import { HERO_CLASS_TABLE, HERO_SKILL_TABLE, readTableLimit } from '../src/exe/table-limit.ts';
import { CLASS_TABLE, SHIPPED_CLASSES } from '../src/mods/hero-classes.ts';
import { SHIPPED_SKILLS, SKILL_TABLE } from '../src/mods/hero-skills.ts';

let ed: Launched;
const GAME = modGameRoot();

/**
 * What the form is filled with BEFORE her racial exists.
 *
 * The end state lives in e2e/mods.ts, where the map fixture builds the same
 * class headless; this is that state minus the racial, its ten points left on
 * the war machines until there is something to move them to. Derived rather
 * than typed twice, so the two cannot drift.
 */
const WEIGHTS_BEFORE: Record<string, number> = (() => {
  const { [TENT.id]: racial = 0, ...rest } = WITCH.weights;
  return { ...rest, HERO_SKILL_WAR_MACHINES: (rest.HERO_SKILL_WAR_MACHINES ?? 0) + racial };
})();

/** The four attributes, as the form's inputs are named. */
const ATTRS: Record<string, number> = {
  'hc-off': WITCH.attributes.offence, 'hc-def': WITCH.attributes.defence,
  'hc-sp': WITCH.attributes.spellpower, 'hc-kn': WITCH.attributes.knowledge,
};

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

/** Open the Heroes window on one of its tabs. */
async function openHeroes(page: Launched['page'], tab: 'Classes' | 'Skills'): Promise<void> {
  if (!(await page.locator('#heroesmod').isVisible())) await page.locator('#heroesbtn').click();
  await expect(page.locator('#heroesmod')).toBeVisible();
  await page.locator('#hm-tabs button', { hasText: tab }).click();
  await expect(page.locator('#hm-legend')).toContainText(tab);
}

test('authors the class Gem will be', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openHeroes(page, 'Classes');
  await page.locator('#hc-new').click();
  await expect(page.locator('#classedit')).toBeVisible();

  // A class of ours is not a copy — but it starts from one, exactly as a hero
  // starts from a donor: thirteen weights and four attributes are a lot to type
  // when eight sensible sets of them ship with the game.
  await page.locator('#hc-donor-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('RANGER');
  await page.locator('#pp-list button', { hasText: 'RANGER' }).first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  // The donor's numbers arrived, both sums intact.
  await expect(page.locator('#hc-skill-total')).toHaveText(/100/);
  await expect(page.locator('#hc-attr-total')).toHaveText(/100/);
  await expect(page.locator('#hc-skills input[data-skill="HERO_SKILL_AVENGER"]')).toHaveValue('10');

  await page.locator('#hc-id').fill(WITCH.id);
  await page.locator('#hc-name').fill(WITCH.name);

  // Her own priorities, over the donor's. The Ranger's racial goes to nothing —
  // she is not an Avenger — and the ten points it held go where she lives: the
  // war machines that carry the tent.
  for (const [skill, prob] of Object.entries(WEIGHTS_BEFORE)) {
    await page.locator(`#hc-skills input[data-skill="${skill}"]`).fill(String(prob));
  }
  for (const [id, value] of Object.entries(ATTRS)) await page.locator(`#${id}`).fill(String(value));
  await expect(page.locator('#hc-skill-total')).toHaveText('100 ✓');
  await expect(page.locator('#hc-attr-total')).toHaveText('100 ✓');

  // The plague tent: four classes may pitch one and the Ranger is not among
  // them, which is the whole reason the availability section exists. One move
  // is the difference, and the dependency it will ask for comes with it.
  await expect(page.locator(`#hc-allowed option[value="${WITCH.perk}"]`)).toHaveCount(0);
  await page.locator('#hc-denied').selectOption(WITCH.perk);
  await page.locator('#hc-allow').click();
  await expect(page.locator(`#hc-allowed option[value="${WITCH.perk}"]`)).toHaveCount(1);
  await expect(page.locator(`#hc-allowed option[value="${WITCH.perk}"]`)).toHaveAttribute('title', /FIRST_AID/);

  const note = await settled(page, 'installing the class', '#hm-note', '#hc-err',
    () => page.locator('#hc-ok').click());
  expect(note).toContain('Installed');
  // The VALUE is what a hero's document resolves to and what the ceiling covers.
  expect(note).toContain(`value ${SHIPPED_CLASSES}`);
  await expect(page.locator('#hc-list')).toContainText(WITCH.name);

  // The four halves of one class, and any three without the fourth is a game
  // that either ignores it or refuses to start.
  const mod = readInstalledMod(GAME);
  const ours = (mod.classes ?? [])[0];
  expect(ours, 'the manifest remembers it').toBeTruthy();
  expect(ours!.number).toBe(SHIPPED_CLASSES);
  expect(ours!.allowedPerks?.map((p) => p.perk)).toContain(WITCH.perk);

  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const at = (name: string): string =>
    entries.find((e) => e.name.replace(/\\/g, '/') === name)!.data.toString('latin1');
  const types = at('types.xml');
  expect(types, 'the enum gained it').toContain(`<Item>${WITCH.id}</Item>`);
  expect(types, 'and so did the name→number map').toMatch(
    new RegExp(`<Name>${WITCH.id}</Name>\\s*<Value>${SHIPPED_CLASSES}</Value>`));
  const table = at(CLASS_TABLE);
  expect([...table.matchAll(/<ID>HERO_CLASS_\w+<\/ID>/g)], 'ten entries where the game ships nine')
    .toHaveLength(SHIPPED_CLASSES + 1);
  const skills = at(SKILL_TABLE);
  const plague = skills.slice(skills.indexOf('<ID>HERO_SKILL_LAST_AID</ID>'));
  expect(plague.slice(0, plague.indexOf('</obj>')), 'the perk lets her in')
    .toContain(`<Class>${WITCH.id}</Class>`);

  // And the executable, which is the half no archive can carry: a table read
  // past the compiled count is a table the game ignores.
  const exe = readFileSync(join(GAME, PATCHED_EXE));
  expect(readTableLimit(exe, HERO_CLASS_TABLE).limit, 'our copy of the game counts to ten')
    .toBe(SHIPPED_CLASSES + 1);
});

test('authors her racial skill, and gives it its weight', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openHeroes(page, 'Skills');
  await page.locator('#hk-new').click();
  await expect(page.locator('#skilledit')).toBeVisible();

  await page.locator('#hk-id').fill(TENT.id);
  await page.locator('#hk-kind').selectOption('racial');
  // It belongs to a class of OURS — the only kind a racial of ours can belong
  // to, since the binding is the skill naming the class.
  await page.locator('#hk-class').selectOption(WITCH.id);
  await page.locator('#hk-name').fill(TENT.name);
  await page.locator('#hk-desc').fill(TENT.description);
  // A drawing per level, which is what a racial ported out of Heroes III has:
  // that game drew first aid three times, this one draws a racial four, and the
  // last picture given fills the fourth. Typed rather than chosen — the button
  // beside each row opens the system's file dialog, which a spec cannot drive.
  for (let i = 0; i < TENT.pictures.length; i++) {
    await page.locator(`#hk-pic-${i + 1}`).fill(TENT.pictures[i]!);
  }

  const note = await settled(page, 'installing the skill', '#hm-note', '#hk-err',
    () => page.locator('#hk-ok').click());
  expect(note).toContain('Installed');
  expect(note).toContain(`value ${SHIPPED_SKILLS}`);
  await expect(page.locator('#hk-list')).toContainText(TENT.name);

  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const at = (name: string): string =>
    entries.find((e) => e.name.replace(/\\/g, '/') === name)!.data.toString('latin1');
  expect(at('types.xml')).toMatch(new RegExp(`<Name>${TENT.id}</Name>\\s*<Value>${SHIPPED_SKILLS}</Value>`));
  const table = at(SKILL_TABLE);
  expect(table).toContain(`<ID>${TENT.id}</ID>`);
  // A racial names its class, and that is the entire binding — there is no
  // table of racials anywhere in the game's data.
  const entry = table.slice(table.indexOf(`<ID>${TENT.id}</ID>`));
  expect(entry.slice(0, entry.indexOf('</obj>'))).toContain(`<HeroClass>${WITCH.id}</HeroClass>`);
  const exe = readFileSync(join(GAME, PATCHED_EXE));
  expect(readTableLimit(exe, HERO_SKILL_TABLE).limit).toBe(SHIPPED_SKILLS + 1);

  // The branch's perks, which is what a level up offers once she has the racial.
  // A branch with no perks never grows, and each of these hangs off the racial
  // and asks for nothing else — the branch IS the gate, since no other class has
  // it (the shipped Multishot sits under Avenger exactly so).
  for (const perk of TENT_PERKS) {
    await page.locator('#hk-new').click();
    await expect(page.locator('#skilledit')).toBeVisible();
    await page.locator('#hk-id').fill(perk.id);
    await page.locator('#hk-kind').selectOption('perk');
    await page.locator('#hk-class').selectOption(WITCH.id);
    await page.locator('#hk-branch').selectOption(TENT.id);
    await page.locator('#hk-name').fill(perk.name);
    await page.locator('#hk-desc').fill(perk.description);
    // Grey and lit, in that order: the game draws the first when the perk is
    // out of reach and the second once it is taken.
    await page.locator('#hk-pic-1').fill(perk.pictures[0]!);
    await page.locator('#hk-pic-2').fill(perk.pictures[1]!);
    const said = await settled(page, `installing ${perk.name}`, '#hm-note', '#hk-err',
      () => page.locator('#hk-ok').click());
    expect(said).toContain('Installed');
  }
  await expect(page.locator('#hk-list')).toContainText(TENT_PERKS[0]!.name);
  {
    const branch = (readInstalledMod(GAME).skills ?? []).filter((s) => s.kind === 'perk');
    expect(branch.map((s) => s.id).sort()).toEqual(TENT_PERKS.map((p) => p.id).sort());
    expect(branch.every((s) => s.basicSkill === TENT.id), 'all three hang off the racial').toBe(true);
  }

  // Now it can be weighted, which it could not be a minute ago: the class form
  // offers the skills the two tables hold, and it was in neither.
  await openHeroes(page, 'Classes');
  await page.locator('#hc-list .um-item', { hasText: WITCH.name }).first()
    .locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#classedit')).toBeVisible();
  const racial = page.locator(`#hc-skills input[data-skill="${TENT.id}"]`);
  await expect(racial, 'a skill of ours is one a class may weight').toHaveCount(1);
  await racial.fill('10');
  await page.locator('#hc-skills input[data-skill="HERO_SKILL_WAR_MACHINES"]').fill('15');
  await expect(page.locator('#hc-skill-total')).toHaveText('100 ✓');

  const updated = await settled(page, 'reweighting the class', '#hm-note', '#hc-err',
    () => page.locator('#hc-ok').click());
  expect(updated).toContain('Updated');
  const weights = (readInstalledMod(GAME).classes ?? [])[0]!.skills;
  expect(weights.find((w) => w.skill === TENT.id)?.prob, 'her own skill is offered').toBe(10);
  expect(weights.reduce((n, w) => n + w.prob, 0)).toBe(100);
});

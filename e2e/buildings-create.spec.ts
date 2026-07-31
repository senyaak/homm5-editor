// Making a building through the window, end to end.
//
// The window is the sixteen CLASSES: a tab each, a list holding one class, and
// New opening the form that class needs (docs/mapPlaceables/buildings/). What
// this proves is the whole chain — the tabs come from the game's spec, a preset
// fills the form from a shipped object, and Save builds a building that carries
// its own art into the mod.
//
// Its own game install (HOMM5_ROOT, e2e/mods.ts), so the real one is untouched.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { modGameRoot } from './mods.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';

let ed: Launched;
const GAME = modGameRoot();

/** What the spec builds: a bank on the id nothing shipped uses. */
const FILE = 'E2eNagaTemple';

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

test('the window is the classes, and each list holds one of them', async () => {
  const { page } = ed;
  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();

  // Sixteen tabs, read from types.xml through mods:building-data — not a list
  // written in the renderer.
  await expect(page.locator('#bld-tabs .mp-tab')).toHaveCount(16);
  await expect(page.locator('#bld-tabs .mp-tab').first()).toHaveText('Building');
  await expect(page.locator('#bld-legend')).toHaveText('Installed — Building');
  await expect(page.locator('#bld-new')).toHaveText('New building…');

  // Switching tab switches the list AND what New would make.
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await expect(page.locator('#bld-legend')).toHaveText('Installed — Dwelling');
  await expect(page.locator('#bld-new')).toHaveText('New dwelling…');
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Building' }).first().click();
});

test('the form is built for its class, and a preset fills it', async () => {
  const { page } = ed;
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();

  // The plain class picks a behaviour, so the form offers one; the classes that
  // ARE a behaviour hide the row (checked below on the Prison tab).
  await expect(page.locator('#bld-typerow')).toBeVisible();
  await expect(page.locator('#bld-type option')).toHaveCount(128);
  // Its lines, one box per slot the class shows.
  await expect(page.locator('#bld-texts .bld-text')).toHaveCount(4);

  // The preset is an action: pick a shipped object of this class and every field
  // below is filled from it — art as paths to copy FROM, texts as our own words.
  await page.locator('#bld-donor-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('MagiVault');
  await page.locator('#pp-list button').first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(page.locator('#bld-model')).toHaveValue(/Magi_Vault\.\(Model\)\.xdb/);
  await expect(page.locator('#bld-type')).toHaveValue('BUILDING_NAGA_BANK');
  await expect(page.locator('#bld-texts .bld-text').first()).toHaveValue(/.+/);
});

test('saving builds a building that carries its own art', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  await page.locator('#bld-file').fill(FILE);
  // The id no shipped document declares — live behaviour, measured in the game
  // (BUILDINGS.md §5). A mod may have it outright.
  await page.locator('#bld-type').selectOption('BUILDING_NAGA_TEMPLE');
  await page.locator('#bld-texts .bld-text').first().fill('Наш храм наг');
  await page.locator('#bld-ok').click();

  await expect(page.locator('#bldedit')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#bld-note')).toContainText(`under Buildings/${FILE}/`);
  // And it is in the list of its class, under the name we gave it.
  await expect(page.locator('#bld-list')).toContainText('Наш храм наг');

  // In the archive: the document, the palette entry, our text, and the art —
  // model, textures and the mesh binary. Nothing of this is a reference to the
  // game's own files, which is the whole point of the feature.
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .map((e) => e.name.replace(/\\/g, '/'));
  expect(entries).toContain(`Buildings/${FILE}/${FILE}.(AdvMapBuildingShared).xdb`);
  expect(entries.some((n) => n.startsWith(`Buildings/${FILE}/art/`) && n.endsWith('.dds')),
    'its textures are its own copies').toBe(true);
  expect(entries.some((n) => /^bin\/Geometries\//.test(n)), 'and the mesh behind them').toBe(true);
  expect(entries.some((n) => n.startsWith(`Buildings/${FILE}/`) && n.endsWith('.txt')),
    'its words are its own files').toBe(true);

  const doc = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .find((e) => e.name.replace(/\\/g, '/').endsWith(`${FILE}.(AdvMapBuildingShared).xdb`))!
    .data.toString('latin1');
  expect(doc).toContain('<Type>BUILDING_NAGA_TEMPLE</Type>');
  expect(doc, 'the model it names is the copy, not the game\'s')
    .toContain(`href="/Buildings/${FILE}/art/`);
});

test('a class that IS a behaviour offers no behaviour to pick', async () => {
  const { page } = ed;
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Prison' }).first().click();
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();
  // AdvMapPrisonShared has no <Type> field at all: the class is the behaviour,
  // and a Type on the generic class does not run it (measured in the game).
  await expect(page.locator('#bld-typerow')).toBeHidden();
  // Five lines, not four: a prison says different things.
  await expect(page.locator('#bld-texts .bld-text')).toHaveCount(5);
  await page.locator('#bld-form-cancel').click();
});

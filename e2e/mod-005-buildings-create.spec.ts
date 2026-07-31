// One building of every class, authored through the window.
//
// A building is one of SIXTEEN classes, and the class is what the form is built
// from: whether a behaviour is picked or the class is one, which fields the
// document adds, how many lines it shows. Sixteen forms is sixteen chances for
// one of them to be wrong in a way no single example would catch — a class whose
// donor list is empty, a field the spec declares and the form cannot fill, a
// message slot off by one — so every one of them is made here, in its own tab.
//
// What comes out is also the CONTENT the map stage places: mod-008 stands all of
// them on a map, and mod-009 reads back what landed on disk.
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

/** What every building this spec makes is called: `E2eBuilding`, `E2eMine`… */
export const stemFor = (label: string): string => `E2e${label.replace(/[^A-Za-z]+/g, '')}`;

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

test('the window is the classes, and the tab decides what New makes', async () => {
  const { page } = ed;
  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();
  // Sixteen, read from types.xml through mods:building-data — not a list
  // written into the renderer.
  await expect(page.locator('#bld-tabs .mp-tab')).toHaveCount(16);
  await expect(page.locator('#bld-new')).toHaveText('New building…');
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await expect(page.locator('#bld-legend')).toHaveText('Installed — Dwelling');
  await expect(page.locator('#bld-new')).toHaveText('New dwelling…');
});

test('the form asks for a behaviour only where the class takes one', async () => {
  const { page } = ed;
  // The plain class picks one of the 128 compiled behaviours.
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Building' }).first().click();
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();
  await expect(page.locator('#bld-typerow')).toBeVisible();
  await expect(page.locator('#bld-type option')).toHaveCount(128);
  await expect(page.locator('#bld-texts .bld-text')).toHaveCount(4);
  await page.locator('#bld-form-cancel').click();

  // A prison IS its behaviour: AdvMapPrisonShared has no <Type> field at all,
  // and the same value on the generic class does not run it — measured in the
  // game, see docs/mapPlaceables/buildings/BUILDINGS.md §2.
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Prison' }).first().click();
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();
  await expect(page.locator('#bld-typerow')).toBeHidden();
  // Five lines, not four: a prison says different things.
  await expect(page.locator('#bld-texts .bld-text')).toHaveCount(5);
  await page.locator('#bld-form-cancel').click();
});

test('one of every class, each from a shipped object of that class', async () => {
  // Sixteen builds, each copying an art closure and repacking the archive.
  test.setTimeout(20 * 60_000);
  const { page } = ed;

  const labels = await page.locator('#bld-tabs .mp-tab').allTextContents();
  expect(labels).toHaveLength(16);

  for (const label of labels) {
    await test.step(label, async () => {
      await page.locator('#bld-tabs .mp-tab', { hasText: label }).first().click();
      await expect(page.locator('#bld-legend')).toHaveText(`Installed — ${label}`);
      await page.locator('#bld-new').click();
      await expect(page.locator('#bldedit')).toBeVisible();

      // The preset is where the art comes from: every class has at least one
      // shipped object, and the picker offers only that class's own.
      await page.locator('#bld-donor-pick').click();
      await expect(page.locator('#presetpick')).toBeVisible();
      const first = page.locator('#pp-list button').first();
      await expect(first, `${label} has a shipped object to start from`).toBeVisible();
      await first.click();
      await expect(page.locator('#presetpick')).toBeHidden();
      await expect(page.locator('#bld-model'), 'the preset filled the art').toHaveValue(/\.xdb/);

      // The behaviour row is the class's own answer to "does a Type pick this".
      const takesType = await page.locator('#bld-typerow').isVisible();
      const lines = await page.locator('#bld-texts .bld-text').count();
      expect(lines, `${label} shows at least a name and a description`).toBeGreaterThanOrEqual(2);

      const stem = stemFor(label);
      await page.locator('#bld-file').fill(stem);
      // A line of our own, so the list can be checked by what it says rather
      // than by the file stem the form already knows.
      await page.locator('#bld-texts .bld-text').first().fill(`${stem} name`);
      await page.locator('#bld-ok').click();

      await expect(page.locator('#bldedit'), `${label} built`).toBeHidden({ timeout: 240_000 });
      await expect(page.locator('#bld-note')).toContainText(`under Buildings/${stem}/`);
      await expect(page.locator('#bld-list')).toContainText(`${stem} name`);
      void takesType;
    });
  }
});

test('the archive carries all sixteen, each owning its own art', async () => {
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .map((e) => e.name.replace(/\\/g, '/'));
  const { page } = ed;
  const labels = await page.locator('#bld-tabs .mp-tab').allTextContents();

  const missing: string[] = [];
  const artless: string[] = [];
  for (const label of labels) {
    const stem = stemFor(label);
    if (!entries.some((n) => n.startsWith(`Buildings/${stem}/`) && n.endsWith('.xdb'))) missing.push(stem);
    // Its own art, not a reference to the game's: the promise the whole feature
    // rests on, checked per class rather than once.
    if (!entries.some((n) => n.startsWith(`Buildings/${stem}/art/`))) artless.push(stem);
  }
  expect(missing, 'classes whose building is not in the archive').toEqual([]);
  expect(artless, 'classes whose building borrowed its art').toEqual([]);

  // And every one of them is offered by the palette, which is what mod-008 needs.
  const links = entries.filter((n) => n.startsWith('MapObjects/_(AdvMapObjectLink)/'));
  expect(links.length, 'a palette entry each').toBeGreaterThanOrEqual(labels.length);
});

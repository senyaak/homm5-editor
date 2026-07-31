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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { modGameRoot, readInstalledMod } from './mods.ts';
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

/**
 * And every one of them is REPAINTED, each a different colour.
 *
 * A building started from a preset and saved is the shipped one under another
 * name: same art, same words, indistinguishable on a map. That makes a poor
 * check of a feature whose whole claim is that the art is OURS — so each is
 * given a hue of its own here, which both makes it its own building and is the
 * only test the building side of the recolour has.
 */
test('each is repainted, so none of them is the shipped one under a new name', async () => {
  test.setTimeout(20 * 60_000);
  const { page } = ed;
  const labels = await page.locator('#bld-tabs .mp-tab').allTextContents();

  for (const [i, label] of labels.entries()) {
    await test.step(label, async () => {
      await page.locator('#bld-tabs .mp-tab', { hasText: label }).first().click();
      // The brush on the row, where a person would reach for it.
      await page.locator('#bld-list .um-paint').first().click();
      await expect(page.locator('#recolor')).toBeVisible();
      // Spread around the wheel: 16 buildings, each a step apart, so two of them
      // side by side on a map are plainly two different buildings.
      const hue = -180 + Math.round((360 / labels.length) * i);
      await page.locator('#rc-hue').fill(String(hue || 30));
      await page.locator('#rc-ok').click();
      await expect(page.locator('#rc-note')).toContainText(/repainted \d+ texture/, { timeout: 240_000 });
      await page.locator('#rc-close').click();
      await expect(page.locator('#recolor')).toBeHidden();
    });
  }

  // The paint is RECORDED on each building, not left in the archive's bytes: a
  // build copies the art off the game's data every time, so a recolour that
  // lived only in the file would be gone the next time anything touched the mod
  // — and nothing anywhere would say the building had ever been repainted.
  const mod = readInstalledMod(GAME);
  const unpainted = (mod.buildings ?? []).filter((b) => !b.recolor).map((b) => b.file);
  expect(unpainted, 'buildings still wearing the donor\'s colours').toEqual([]);
  // No two the same, which is what makes them tell apart on a map.
  const hues = new Set((mod.buildings ?? []).map((b) => b.recolor?.hue));
  expect(hues.size, 'each building got a hue of its own').toBe((mod.buildings ?? []).length);
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

  // The paint is really ON the texture, not merely recorded beside it. Each
  // copy sits at the game's own path under the building's art folder, so the
  // file it was copied from is the same path in the data root — and after a
  // repaint the two must not be the same bytes.
  const members = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const painted = members.find((e) => {
    const n = e.name.replace(/\\/g, '/');
    return n.startsWith(`Buildings/${stemFor(labels[0]!)}/art/`) && n.toLowerCase().endsWith('.dds');
  });
  expect(painted, 'the first building carries a texture of its own').toBeTruthy();
  const source = join(DATA, painted!.name.replace(/\\/g, '/').split('/art/')[1]!);
  expect(existsSync(source), `its source ${source} is in the data root`).toBe(true);
  expect(painted!.data.equals(readFileSync(source)),
    'the copy is byte-identical to the game\'s — the repaint did not land').toBe(false);
});

// One building of every class, authored through the window.
//
// A building is one of a fixed set of CLASSES, and the class is what the form is
// built from: whether a behaviour is picked or the class is one, which fields the
// document adds, how many lines it shows. Every class is a chance for one of them
// to be wrong in a way no single example would catch — a class whose donor list
// is empty, a field the spec declares and the form cannot fill, a message slot
// off by one — so one of each is made here, in its own tab.
//
// How many there are is the editor's answer, not this spec's: the game declares
// sixteen and one of them (the Stand, a script's prop) is deliberately not
// offered, so the count comes from the window rather than from a number here.
//
// What comes out is also the CONTENT the map stage places: mod-007 stands all of
// them on its map, and mod-008 reads back what landed on disk.
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

/**
 * The donor's name, written LiKe ThIs.
 *
 * A building made from a preset carries the shipped one's words as well as its
 * art, and two objects with the same name on one map are one object as far as
 * anybody reading the screen is concerned. Alternating the case keeps the name
 * recognisable — it is still the Windmill — while making it unmistakably the
 * copy, in the flyover, in the palette and in the visit dialog alike.
 *
 * Case is flipped per LETTER rather than per character, so spaces and
 * punctuation do not shift the rhythm.
 */
/** A map text as the game writes it: UTF-16 LE with a byte-order mark. */
const decodeUtf16 = (buf: Buffer): string =>
  (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le', 2) : buf.toString('utf8'))
    .replace(/\0+$/, '').trim();

export function mockCase(name: string): string {
  let letters = 0;
  return [...name].map((ch) => {
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    if (upper === lower) return ch;                 // not a letter: no case to alternate
    return (letters++ % 2 === 0 ? upper : lower);
  }).join('');
}

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

test('the window is the classes, and the tab decides what New makes', async () => {
  const { page } = ed;
  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();
  // The classes the editor offers, each with fields read from types.xml through
  // mods:building-data — not a list written into the renderer.
  await expect(page.locator('#bld-tabs .mp-tab')).toHaveCount(15);
  // And the one it does not: a Stand is a prop a campaign script drives, and
  // what it is wanted for is a building plus a Lua trigger.
  await expect(page.locator('#bld-tabs .mp-tab', { hasText: 'Stand' })).toHaveCount(0);
  await expect(page.locator('#bld-new')).toHaveText('New building…');
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await expect(page.locator('#bld-legend')).toHaveText('Installed — Dwelling');
  await expect(page.locator('#bld-new')).toHaveText('New dwelling…');
});

test('it will not save a building that is missing what it needs', async () => {
  const { page } = ed;
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();

  // Blank: nothing to name it, nothing to stand on, nothing to say, and — for
  // this class — nothing to hire. Save is not a thing that can be pressed, and
  // what is missing is named rather than left to be guessed at.
  await expect(page.locator('#bld-ok')).toBeDisabled();
  await expect(page.locator('#bld-missing')).toHaveText(/identifier.*model.*name.*creatures/);
  // Every one of those is marked in the form itself.
  await expect(page.locator('#bldedit .req')).toHaveCount(4);

  // Filled one at a time, the list shortens and the button stays down until the
  // last of them is in.
  await page.locator('#bld-file').fill('E2eRefused');
  await expect(page.locator('#bld-missing')).toHaveText(/model.*name.*creatures/);
  await page.locator('#bld-model').fill('/_(Model)/Buildings/Windmill.(Model).xdb');
  await page.locator('#bld-texts .bld-text').first().fill('unnamed no more');
  await expect(page.locator('#bld-ok'), 'a dwelling still hires nobody').toBeDisabled();
  await expect(page.locator('#bld-missing')).toHaveText(/creatures/);

  await page.locator('.bld-field[data-field="creatures"]').fill('CREATURE_PEASANT');
  await expect(page.locator('#bld-ok')).toBeEnabled();
  await expect(page.locator('#bld-missing')).toHaveText('');

  // Nothing was built: this test is about the refusal, not about the building.
  await page.locator('#bld-form-cancel').click();
  await expect(page.locator('#bldedit')).toBeHidden();
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
  expect(labels.length, 'every class the window offers').toBeGreaterThan(10);

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
      // The donor's own name, WrItTeN lIkE tHiS — the preset brought the shipped
      // object's words along with its art, and two things called the Windmill on
      // one map are one thing to whoever is reading the screen.
      const nameBox = page.locator('#bld-texts .bld-text').first();
      // Some shipped objects have no words at all — Tieru's Hut, the one object
      // of the Stand class, is a script's prop and names itself nowhere. Then
      // the class is the name there is.
      const donorName = (await nameBox.inputValue()) || label;
      await nameBox.fill(mockCase(donorName));
      await page.locator('#bld-ok').click();

      await expect(page.locator('#bldedit'), `${label} built`).toBeHidden({ timeout: 240_000 });
      await expect(page.locator('#bld-note')).toContainText(`under Buildings/${stem}/`);
      await expect(page.locator('#bld-list')).toContainText(mockCase(donorName));
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

test('the archive carries one of each, every one owning its own art', async () => {
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

  // Its NAME is its own too, and shipped as our own UTF-16 text file rather than
  // as a reference to the game's. mockCase is idempotent, so a name still in the
  // donor's spelling fails this and a re-cased one passes.
  const members = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const named: string[] = [];
  for (const label of labels) {
    const stem = stemFor(label);
    const file = members.find((e) => e.name.replace(/\\/g, '/') === `Buildings/${stem}/${stem}_Name.txt`);
    if (!file) { named.push(`${stem}: no name file`); continue; }
    const text = decodeUtf16(file.data);
    if (text !== mockCase(text)) named.push(`${stem}: ${text}`);
  }
  expect(named, 'buildings still wearing the donor\'s name').toEqual([]);

  // And every one of them is offered by the palette, which is what mod-007 needs.
  const links = entries.filter((n) => n.startsWith('MapObjects/_(AdvMapObjectLink)/'));
  expect(links.length, 'a palette entry each').toBeGreaterThanOrEqual(labels.length);

  // The paint is really ON the textures, not merely recorded beside them. Each
  // copy sits at the game's own path under the building's art folder, so the
  // file it was copied from is the same path in the data root.
  //
  // At least ONE has to differ, not all of them and not the first: a hue turn
  // moves nothing on a grey texture, and a copy carries several — terrain, a
  // spark, a glow — with no colour to turn.
  const textures = members.filter((e) => {
    const n = e.name.replace(/\\/g, '/');
    return n.startsWith(`Buildings/${stemFor(labels[0]!)}/art/`) && n.toLowerCase().endsWith('.dds');
  });
  expect(textures.length, 'the first building carries textures of its own').toBeGreaterThan(0);
  const repainted = textures.filter((t) => {
    const source = join(DATA, t.name.replace(/\\/g, '/').split('/art/')[1]!);
    return existsSync(source) && !t.data.equals(readFileSync(source));
  });
  expect(repainted.length, 'no texture came out different — the repaint did not land')
    .toBeGreaterThan(0);
});

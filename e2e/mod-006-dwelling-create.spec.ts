// The Sharpshooter's palace, authored through the window.
//
// This is the dwelling the map stage places, and it was the one thing in the
// mod with no form to make it: every dwelling that existed was authored by
// writing a spec in a file, which is why the port's tier 4-7 buildings are still
// data in the maps repo with nothing to install them. The window's Dwelling tab
// is that form, and this spec is what it was missing.
//
// It is also the only stage that exercises BAKE. The per-tier dwellings live on
// the town screen and have no adventure-map art at all: their models are two to
// three times map scale and stand where they sit in the town scene, so one
// dropped on the map is both giant and nowhere near the tile that placed it.
// Baking copies it, moves it to the origin and scales it, and the footprint
// follows what will be seen (src/mods/bake-model.ts).
//
// Runs after mod-001 in the chain, whose creature it hires; alone, it still
// builds — the id it names is simply one the install does not have.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { PALACE, modGameRoot } from './mods.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';

let ed: Launched;
const GAME = modGameRoot();

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

test('a dwelling for a creature the game does not ship', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await expect(page.locator('#bld-new')).toHaveText('New dwelling…');
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();

  // No preset: this one is not a variation on a shipped dwelling. Its art is a
  // TOWN building, which nothing on the adventure map uses.
  await page.locator('#bld-file').fill(PALACE.file);
  await page.locator('#bld-type').selectOption(PALACE.type);
  await page.locator('#bld-model').fill(PALACE.model);
  await page.locator('#bld-icon').fill(PALACE.icon);
  await page.locator('#bld-bake').fill(String(PALACE.bake.tiles));
  await page.locator('#bld-bake-ground').fill(String(PALACE.bake.ground));

  // What it hires — the field only this class has.
  const creatures = page.locator('.bld-field[data-field="creatures"]');
  await expect(creatures, 'the Dwelling form asks what it hires').toBeVisible();
  await creatures.fill(PALACE.creatures.join(', '));

  // Its six lines, in the order the engine reads them.
  const lines = [
    PALACE.name, PALACE.description, PALACE.firstVisit,
    PALACE.secondVisit, PALACE.firstVisitNoHire, PALACE.secondVisitNoHire,
  ];
  await expect(page.locator('#bld-texts .bld-text'), 'a dwelling says six things').toHaveCount(6);
  for (const [i, line] of lines.entries()) {
    await page.locator('#bld-texts .bld-text').nth(i).fill(line);
  }

  await page.locator('#bld-ok').click();
  await expect(page.locator('#bldedit')).toBeHidden({ timeout: 240_000 });
  await expect(page.locator('#bld-note')).toContainText(`under Buildings/${PALACE.file}/`);
  await expect(page.locator('#bld-list')).toContainText(PALACE.name);
});

test('it hires the creature, and its town art came down to map scale', async () => {
  const members = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const names = members.map((e) => e.name.replace(/\\/g, '/'));
  const doc = members
    .find((e) => e.name.replace(/\\/g, '/').endsWith(`${PALACE.file}.(AdvMapDwellingShared).xdb`))!
    .data.toString('latin1');

  expect(doc, 'the class is the dwelling one').toContain('<AdvMapDwellingShared>');
  expect(doc).toContain(`<Item>${PALACE.creatures[0]}</Item>`);
  expect(doc).toContain(`<Type>${PALACE.type}</Type>`);
  // The art is the mod's own copy of the TOWN model, not a reference to it.
  expect(doc).toContain(`href="/Buildings/${PALACE.file}/art/`);
  expect(names.some((n) => n.startsWith(`Buildings/${PALACE.file}/art/Arenas/Town/`)),
    'the town building was copied in').toBe(true);

  // Baked: more than one tile, and no bigger than the six it was asked for. One
  // tile means the model was not measured at all, and the building would be
  // placed inside its neighbour instead of failing.
  const tiles = [...doc.matchAll(/<x>(-?\d+)<\/x>/g)].map((m) => Number(m[1]));
  const span = Math.max(...tiles) - Math.min(...tiles) + 1;
  expect(span, 'its footprint is the size it was baked to').toBeGreaterThan(1);
  expect(span).toBeLessThanOrEqual(PALACE.bake.tiles);
  // Its pedestal is under the map, so it cuts no hole in the terrain — the hole
  // would show the column the town's landscape used to hide.
  expect(doc).toContain('<holeTiles/>');
});

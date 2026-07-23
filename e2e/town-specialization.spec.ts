// Create a map-local town specialization and link it.
//
// A specialization is a named town bonus. The shipped ones live in the game's
// GameMechanics/, but a map can carry its own — packed beside map.xdb and
// referenced by a relative href, the way scripts and texts are. This drives the
// panel's Specialization control: New → pick a bonus → the file is written into
// the map, and the town points at it by HREF (not text, which the game would not
// read), surviving a save.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { DATA } from './c1m1/shared.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;
const NAME = 'e2e town spec';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('create a map-local specialization and link a town to it by href', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  await newMap(page, NAME, '72');
  await openObjectPalette(page);

  const shared = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapTown')?.shared ?? '';
  });
  expect(shared, 'a town entry exists').not.toBe('');
  await pickObject(page, shared);
  await placeAtTile(page, 10, 10);
  await page.evaluate(() => { const o = window.view.objects()[0]; if (o) window.view.select(o.id); });

  // The Specialization row's New button opens the create dialog.
  const specRow = page.locator('#p-props .pf', { has: page.locator('label[data-field="Specialization"]') });
  await expect(specRow, 'the panel shows Specialization').toBeVisible();
  await specRow.locator('button', { hasText: 'New' }).click();

  await expect(page.locator('#specnew')).toBeVisible();
  await page.locator('#sn-name').fill('Golden');
  await page.locator('#sn-bonus').selectOption('TOWN_BONUS_250_GOLD');
  await page.locator('#sn-faction').selectOption('TOWN_HEAVEN');
  await page.locator('#sn-ok').click();
  await expect(page.locator('#specnew')).toBeHidden();

  // The row now shows the ref, relative to the map.
  await expect(specRow.locator('.rv')).toContainText('Golden.xdb#xpointer(/TownSpecialization)');

  // The specialization file is written into the map, with the chosen bonus.
  await expect(async () => {
    expect(existsSync(join(MAP_DIR, 'Golden.xdb')), 'the spec file exists').toBe(true);
  }).toPass({ timeout: 10_000 });
  const specXml = readFileSync(join(MAP_DIR, 'Golden.xdb'), 'utf8');
  expect(specXml).toContain('<TownSpecialization>');
  expect(specXml).toContain('<Bonus>TOWN_BONUS_250_GOLD</Bonus>');
  expect(specXml).toContain('<TownType>TOWN_HEAVEN</TownType>');

  // Save, then the town references it as an HREF attribute, not element text.
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 60_000 });
  const mapXml = readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8');
  expect(mapXml, 'the town points at the spec by href').toMatch(
    /<Specialization href="Golden\.xdb#xpointer\(\/TownSpecialization\)"\s*\/>/,
  );
  expect(mapXml, 'and not as element text').not.toContain('>Golden.xdb#xpointer');
});

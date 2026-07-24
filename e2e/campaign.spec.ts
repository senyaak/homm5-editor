// Assemble a one-mission campaign through the app, and pack it.
//
// This is the campaign counterpart of the map reconstruction: everything is
// done the way a user does it — the Campaigns list, the Campaign dialog, the
// Mission dialog — and the check is on what lands on disk. The .h5c must come
// out in the shape the game loads (UserCampaigns/<name>/campaign.xdb, texts
// flat beside it, no map bundled), because that shape is the whole feature.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { readEntries } from '../src/pak.ts';
import { buildNewMapProject } from '../src/new-map.ts';

let ed: Launched;

const DATA = join(REPO_ROOT, 'data-unpacked');
const NAME = 'e2e Campaign';
const MAP = 'e2e Campaign Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', MAP);
const CAMP_DIR = join(DATA, 'Campaigns', NAME);
const OUT = join(REPO_ROOT, 'test-results', `${NAME}.h5c`);

test.beforeAll(async () => {
  // A campaign needs a map to point at. Build a blank one rather than leaning on
  // the reconstruction, so this test stands on its own.
  if (!existsSync(join(MAP_DIR, 'map.xdb'))) {
    mkdirSync(MAP_DIR, { recursive: true });
    for (const f of buildNewMapProject({ name: MAP, tiles: 96, twoLevel: false, spells: ['SPELL_NONE'], artifacts: ['ARTIFACT_NONE'] })) {
      writeFileSync(join(MAP_DIR, f.path), f.data);
    }
  }
  rmSync(CAMP_DIR, { recursive: true, force: true });
  rmSync(OUT, { force: true });
  ed = await launchEditor();
});
test.afterAll(async () => { await ed?.app.close(); });

test('a one-mission campaign, built in the app and packed to .h5c', async () => {
  const { page } = ed;
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, OUT);

  // Create it.
  await page.locator('#campaignbtn').click();
  await expect(page.locator('#camplist')).toBeVisible();
  await page.locator('#cl-name').fill(NAME);
  await page.locator('#cl-new').click();
  await expect(page.locator('#campaign')).toBeVisible();
  await expect(page.locator('#cp-title')).toContainText(NAME);

  await page.locator('#cp-summary').fill('a campaign built by the e2e suite');
  await page.locator('#cp-description').fill('One mission, pointing at a blank map.');

  // Add a mission and give it the map.
  await page.locator('#cp-add').click();
  await expect(page.locator('#mission')).toBeVisible();
  await page.locator('#ms-map').selectOption(`SingleMissions/${MAP}`);
  await page.locator('#ms-name').fill('The First Step');
  await page.locator('#ms-description').fill('Where it begins.');
  await page.locator('#ms-ok').click();
  await expect(page.locator('#mission')).toBeHidden();

  // The mission shows up, named for its map rather than flagged as mapless.
  await expect(page.locator('#cp-rows tr')).toHaveCount(1);
  await expect(page.locator('#cp-rows tr td').nth(1)).toHaveText(MAP);

  // Pack, then read the archive back.
  await page.locator('#cp-pack').click();
  await expect.poll(() => existsSync(OUT), { timeout: 30_000 }).toBe(true);

  const names = readEntries(readFileSync(OUT)).map((e) => e.name).sort();
  expect(names, 'every entry sits under UserCampaigns/<name>/')
    .toEqual(names.filter((n) => n.startsWith(`UserCampaigns/${NAME}/`)));
  expect(names, 'the descriptor is named campaign.xdb').toContain(`UserCampaigns/${NAME}/campaign.xdb`);
  expect(names.some((n) => /map\.xdb|GroundTerrain/i.test(n)), 'no map is bundled').toBe(false);

  const xdb = readEntries(readFileSync(OUT))
    .find((e) => e.name.endsWith('campaign.xdb'))!.data.toString('latin1');
  expect(xdb, 'the mission names its map by an absolute data-root path')
    .toContain(`<MissionTag href="/Maps/SingleMissions/${MAP}/map-tag.xdb#xpointer(/AdvMapDescTag)"/>`);
  expect(xdb, 'and it is a user campaign, or the game will not list it')
    .toContain('<UserCampaign>true</UserCampaign>');

  // Reopening it shows what was saved — the original editor cannot do this.
  await page.locator('#cp-cancel').click();
  await page.locator('#campaignbtn').click();
  await page.locator('#cl-list .cl-row', { hasText: NAME }).click();
  await expect(page.locator('#campaign')).toBeVisible();
  await expect(page.locator('#cp-summary')).toHaveValue('a campaign built by the e2e suite');
  await expect(page.locator('#cp-rows tr')).toHaveCount(1);
});

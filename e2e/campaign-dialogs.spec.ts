// The campaign dialogs must survive being used, without throwing.
//
// A handler that throws leaves a <dialog> open and dead — it is still on
// screen, and nothing in it responds. That is indistinguishable from a hang, so
// this drives the dialogs the way a person does (add a mission, change the hero
// count, walk the bonus kinds) and fails on the first uncaught error or console
// error rather than on a visible symptom.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { buildNewMapProject } from '../src/new-map.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const CAMP = 'e2e Dialogs';
const MAP = 'e2e Dialogs Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', MAP);

test.beforeAll(async () => {
  if (!existsSync(join(MAP_DIR, 'map.xdb'))) {
    mkdirSync(MAP_DIR, { recursive: true });
    for (const f of buildNewMapProject({ name: MAP, tiles: 72, twoLevel: false, spells: ['SPELL_NONE'], artifacts: ['ARTIFACT_NONE'] })) {
      writeFileSync(join(MAP_DIR, f.path), f.data);
    }
  }
  rmSync(join(DATA, 'Campaigns', CAMP), { recursive: true, force: true });
  ed = await launchEditor();
});
test.afterAll(async () => { await ed?.app.close(); });

test('the campaign dialogs stay alive through a normal edit', async () => {
  test.setTimeout(300_000);
  const { page } = ed;

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.locator('#campaignbtn').click();
  await page.locator('#cl-name').fill(CAMP);
  await page.locator('#cl-new').click();
  await expect(page.locator('#campaign')).toBeVisible();

  await page.locator('#cp-add').click();
  await expect(page.locator('#mission')).toBeVisible();
  await page.locator('#ms-map').selectOption(`SingleMissions/${MAP}`);

  // The hero count drives one render; every bonus kind drives another, and the
  // kinds are what pull the big rosters in.
  await page.locator('#ms-hcount').fill('4');
  await page.locator('#ms-hcount').dispatchEvent('change');
  await expect(page.locator('#ms-heroes select')).toHaveCount(4);

  const kind = page.locator('#ms-bonuses .ms-bonus select').first();
  for (const type of ['E_BONUS_ARTIFACT', 'E_BONUS_CREATURE', 'E_BONUS_SPELL', 'E_BONUS_RESOURCE', 'E_BONUS_BUILDING', 'E_BONUS_NONE']) {
    await kind.selectOption(type);
    // The row is rebuilt on each change, so wait for the new one to settle.
    await expect(page.locator('#ms-bonuses .ms-bonus')).toHaveCount(3);
  }

  await page.locator('#ms-ok').click();
  await expect(page.locator('#mission')).toBeHidden();
  await expect(page.locator('#cp-rows tr')).toHaveCount(1);

  // And it can be reopened and closed again — a dead dialog fails right here.
  await page.locator('#cp-rows tr').first().dblclick();
  await expect(page.locator('#mission')).toBeVisible();
  await page.locator('#ms-cancel').click();
  await expect(page.locator('#mission')).toBeHidden();

  expect(errors, 'the dialogs raised nothing').toEqual([]);
});

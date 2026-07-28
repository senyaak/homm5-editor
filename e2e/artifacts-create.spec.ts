// Adding an artifact to the game through the window, end to end.
//
// Runs alone, on its own game install (e2e/mods.ts) — and needs no creature:
// an artifact costs the mod no creature ceiling, only its own. What it does
// need is the artifact sites note beside the executable, which prepareGameRoot
// copies along, because a patched executable can no longer find those sites by
// search.
//
// What gets built is the SoD port's Undertaker's Amulet, on a shipped
// neck-piece's preset.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { AMULET, prepareGameRoot, readInstalledMod, removeGameRoot } from './mods.ts';
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/artifact-limit.ts';
import type { Site } from '../src/artifact-limit.ts';

let ed: Launched;

const GAME = join(REPO_ROOT, '_tmp', 'e2e-arts-game');

test.beforeAll(async () => {
  prepareGameRoot(GAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); removeGameRoot(GAME); });

/** Open Artifacts… with the donor loaded. */
async function openWithDonor(page: Launched['page']): Promise<void> {
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  await expect(page.locator(`#am-donor option[value="${AMULET.donor}"]`)).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#am-donor').selectOption(AMULET.donor);
  await expect(page.locator('#am-cost')).toHaveValue('7000'); // the preset settled
}

test('the dialog opens clean, and the donor loads as a preset', async () => {
  const { page } = ed;
  await page.locator('#artsbtn').click();
  await expect(page.locator('#artsmod')).toBeVisible();
  await expect(page.locator('#am-list')).toContainText('none — the game holds its shipped artifacts only');

  // The artifact table keeps everything inline, so one lookup fills the form.
  await openWithDonor(page);
  await expect(page.locator('#am-name')).toHaveValue('Амулет некроманта');
  await expect(page.locator('#am-slot')).toHaveValue('NECK');
  await expect(page.locator('#am-rank')).toHaveValue('ARTF_CLASS_RELIC');
  await expect(page.locator('#am-icon')).toHaveValue(/Necromancer_Pendant/);
});

test('edits the difference and installs the artifact', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  await page.locator('#am-file').fill(AMULET.file);
  await expect(page.locator('#am-id')).toHaveValue(AMULET.id);
  await page.locator('#am-name').fill(AMULET.name);
  await page.locator('#am-desc').fill(AMULET.description);
  // The port's amulet is a cheaper minor piece that moves Knowledge.
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  await page.locator('#am-cost').fill('5000');
  await page.locator('#am-ai').fill('700');
  await page.locator('#am-knowledge').fill('2');

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#am-note')).toContainText(`ceiling ${ORIGINAL_ARTIFACTS + 1}`);
  await expect(page.locator('#am-list')).toContainText('Амулет гробовщика (NECK)');

  // On disk: the archive carries it, with the fields we authored and the ones
  // the preset supplied.
  const mod = readInstalledMod(GAME);
  const a = mod.artifacts[0]!;
  expect(a.id).toBe(AMULET.id);
  expect(a.number).toBe(ORIGINAL_ARTIFACTS);
  expect(a.slot).toBe('NECK');
  expect(a.rank).toBe('ARTF_CLASS_MINOR');
  expect(a.cost).toBe(5000);
  expect(a.stats).toEqual({ Knowledge: 2 });
  expect(a.icon).toContain('Necromancer_Pendant');
  // No map model was given, so it stands as a flat board of its own icon.
  expect(a.board).toEqual({ tiles: 1 });
  // An artifact needs no creature, and the mod has none.
  expect(mod.creatures).toHaveLength(0);

  // And the executable's ARTIFACT ceiling agrees.
  const noted = JSON.parse(readFileSync(join(GAME, SITES_FILE), 'utf8')) as Site[];
  const reading = readArtifactLimit(readFileSync(join(GAME, 'bin', 'H5_Game_NCF.exe')), noted);
  expect(reading.limit).toBe(ORIGINAL_ARTIFACTS + 1);

  await page.locator('#am-cancel').click();
  await expect(page.locator('#artsmod')).toBeHidden();
});

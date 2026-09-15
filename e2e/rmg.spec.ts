// Random Map, end to end: click through the real dialog, and check what the
// game's generator — ours, ported — left on disk and on screen.
//
// What it proves is the wiring, the way new-map.spec does for New Map: that the
// dialog's lists come from the install, that the template list narrows with
// the size the way the game's does, that an order reaches the generator in a
// child process and comes back as a map the app opens. Whether the map is the
// ENGINE's map is the unit suites' and the corpus's question (docs/RMG.md), not
// this one's — here a tiny map is enough.
//
// The generator reads the game's executable, so the sandbox install needs a
// readable copy of it: the shipped one from the real game, unwrapped the way
// the first run does it. No extension, no mods — the generator needs neither.

import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_EXE, SHIPPED_EXE, ensureCleanExe } from '../src/exe/exe-unwrap.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { DATA, REPO_ROOT, closeEditor, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { REAL_GAME } from './mods.ts';
import { MADE } from './artifacts.ts';

let ed: Launched;

const NAME = MADE.RANDOM_MAP;
/** A throwaway install of its own: the generator wants an executable, the suite's default has none. */
const GAME = join(REPO_ROOT, '_tmp', 'e2e-rmg');
/** Where the generated map's folder lands — `Maps/RMG/<guid>` under the unpack root, like the game's own. */
const RMG_DIR = join(DATA, 'Maps', 'RMG');

/** The folders under Maps/RMG holding a map of THIS name — the guid is drawn, so they are found by content. */
function ourFolders(): string[] {
  if (!existsSync(RMG_DIR)) return [];
  return readdirSync(RMG_DIR)
    .map((d) => join(RMG_DIR, d))
    .filter((d) => existsSync(join(d, 'map.xdb')) && readFileSync(join(d, 'map.xdb'), 'latin1').includes(`<MapName>${NAME}</MapName>`));
}

function cleanup(): void {
  const archive = modFile(GAME, 'map', NAME);
  if (existsSync(archive)) rmSync(archive, { force: true });
  for (const d of ourFolders()) rmSync(d, { recursive: true, force: true });
}

test.beforeAll(async () => {
  test.skip(!existsSync(join(DATA, 'RMG', 'Templates')), 'needs the game data (RMG/Templates)');
  test.skip(!REAL_GAME || !existsSync(join(REAL_GAME, SHIPPED_EXE)), 'needs a real game to take the executable from (HOMM5_ROOT)');
  mkdirSync(join(GAME, 'bin'), { recursive: true });
  if (!existsSync(join(GAME, CLEAN_EXE))) {
    copyFileSync(join(REAL_GAME, SHIPPED_EXE), join(GAME, SHIPPED_EXE));
    await ensureCleanExe(GAME, { editorRoot: REPO_ROOT });
  }
  cleanup();
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { if (ed) await closeEditor(ed); cleanup(); });

test('generates a tiny map through the dialog and opens it', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  await bar(page, '#rmgbtn');
  await expect(page.locator('#rmg')).toBeVisible();

  // The lists are the install's, each with Random in front: seven sizes with
  // their tile counts, five monster levels, and a template list that narrows
  // with the size.
  await expect(page.locator('#rmg-size option')).toHaveCount(8);
  await expect(page.locator('#rmg-size option').first()).toHaveText('Random');
  await expect(page.locator('#rmg-size option').nth(1)).toHaveText(/Tiny \(72×72\)/);
  await expect(page.locator('#rmg-monsters option')).toHaveCount(6);
  await page.locator('#rmg-size').selectOption('0');
  await expect(page.locator('#rmg-template-note')).toContainText('fit this size');
  const tiny = await page.locator('#rmg-template option').count();
  await page.locator('#rmg-size').selectOption('5'); // Huge
  await expect(page.locator('#rmg-template-note')).toContainText('fit this size');
  const huge = await page.locator('#rmg-template option').count();
  expect(tiny).toBeGreaterThan(huge);
  // With an underground the list changes again — twice the units to fit — and
  // with the size left to chance every template is on offer.
  await page.locator('#rmg-two').selectOption('1');
  await expect(page.locator('#rmg-template-note')).toContainText('with an underground');
  await page.locator('#rmg-size').selectOption('random');
  await expect(page.locator('#rmg-template-note')).toContainText('any template');
  await expect(page.locator('#rmg-template option')).toHaveCount(24); // 22 shipped + Jebus Cross (ours) + Random
  await page.locator('#rmg-two').selectOption('0');

  // A tiny map on the reference template, with a seed, so the run is short and
  // the map it makes is a known one (S1P2Z2M1 fits Tiny).
  await page.locator('#rmg-size').selectOption('0');
  await page.locator('#rmg-template').selectOption('S1P2Z2M1');
  // Two players: the template's range, so Random and 2.
  await expect(page.locator('#rmg-players option')).toHaveCount(2);
  await page.locator('#rmg-players').selectOption('2');
  await page.locator('#rmg-name').fill(NAME);
  await page.locator('#rmg-seed').fill('1785351845');
  await expect(page.locator('#rmg-where')).toContainText(`${NAME}.h5m`);
  await page.locator('#rmg-ok').click();

  // The dialog closes only on success; an error would leave it open with a
  // message, so this also asserts the generation did not fail.
  await expect(page.locator('#rmg')).toBeHidden({ timeout: 4 * 60_000 });
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 60_000 });
  await expect(page.locator('#pack')).toBeEnabled();
  // And it ran where it was meant to: in a child of its own, not in main.
  const line = ed.log.find((l) => l.includes('[rmg] ') && l.includes(`${NAME}.h5m`));
  expect(line, ed.log.filter((l) => l.includes('[rmg')).join(' | ')).toBeDefined();
  expect(line).toContain('in the child');

  // On disk: the archive in the sandbox's H5E, and the folder it was packed
  // from, holding what the generator writes — map.xdb with the order in its
  // sRMGProps, both terrains absent but the ground, the texts, the minimap.
  expect(existsSync(modFile(GAME, 'map', NAME))).toBeTruthy();
  const folders = ourFolders();
  expect(folders).toHaveLength(1);
  const files = readdirSync(folders[0]!);
  expect(files).toContain('map.xdb');
  expect(files).toContain('GroundTerrain.bin');
  expect(files).toContain('minimap_floor_01.dds');
  const xdb = readFileSync(join(folders[0]!, 'map.xdb'), 'latin1');
  expect(xdb).toContain('<RMGstartseed>1785351845</RMGstartseed>');
  expect(xdb).toContain('<Template href="/RMG/Templates/S1P2Z2M1.xdb');
  expect(xdb).toContain('<MapSize>MAP_SIZE_TINY</MapSize>');
  expect(xdb).toContain('<TileX>72</TileX>');
});

test('a name already taken is refused and the dialog stays open', async () => {
  const { page } = ed;
  await bar(page, '#rmgbtn');
  await page.locator('#rmg-size').selectOption('0');
  await page.locator('#rmg-name').fill(NAME);
  await page.locator('#rmg-ok').click();
  await expect(page.locator('#rmg-err')).toContainText('already exists', { timeout: 30_000 });
  await expect(page.locator('#rmg')).toBeVisible();
  await page.locator('#rmg-cancel').click();
  await expect(page.locator('#rmg')).toBeHidden();
});

test('a fixed template with everything else random draws a size it fits', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  cleanup();
  await bar(page, '#rmgbtn');
  await page.locator('#rmg-random').click();
  await expect(page.locator('#rmg-template')).toHaveValue('random');
  await expect(page.locator('#rmg-players')).toHaveValue('random');
  // The tiny reference template again, so the drawn size is Tiny or Small and
  // the run stays short — `S1P2Z2M1` fits 5..14 units: Tiny, Small, and either
  // with two levels only Tiny (2×5 = 10).
  await page.locator('#rmg-template').selectOption('S1P2Z2M1');
  await page.locator('#rmg-name').fill(NAME);
  await page.locator('#rmg-ok').click();
  await expect(page.locator('#rmg')).toBeHidden({ timeout: 4 * 60_000 });
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 60_000 });
  const line = ed.log.filter((l) => l.includes('[rmg] ') && l.includes(`${NAME}.h5m`)).pop();
  expect(line).toBeDefined();
  expect(line).toMatch(/S1P2Z2M1 (72×72|96×96)/);
  const xdb = readFileSync(join(ourFolders()[0]!, 'map.xdb'), 'latin1');
  expect(xdb).toMatch(/<MapSize>MAP_SIZE_(TINY|SMALL)<\/MapSize>/);
  expect(xdb).toContain('<Players>2</Players>');
});

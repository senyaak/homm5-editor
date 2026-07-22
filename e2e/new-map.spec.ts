// New Map, end to end: click through the real dialog and check what landed on
// disk and on screen.
//
// This is the first test that drives the whole stack — renderer → preload → IPC
// → main → the generators in src/ — rather than calling the generators directly
// the way the unit suites do. What it proves is the wiring: that the dialog's
// fields reach buildNewMapProject, that the folder is written where the game
// looks for maps, and that the app can open what it just wrote.
//
// The map is created under the data root's Maps folder (the default is the
// gitignored data-unpacked tree) and removed afterwards, so a run leaves nothing
// behind.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

let ed: Launched;

// A name no real map would have, so the cleanup can never hit a user's map.
const NAME = 'e2e New Map';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
// Where the original editor keeps single-scenario maps — and where a map's
// path under the data root becomes its path inside the .h5m.
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('creates a blank map through the dialog and opens it', async () => {
  const { page } = ed;

  await page.locator('#newmapbtn').click();
  await expect(page.locator('#newmap')).toBeVisible();

  await page.locator('#nm-name').fill(NAME);
  await page.locator('#nm-size').selectOption('72'); // Tiny — the fastest to build
  await page.locator('#nm-two').check();
  // The dialog says where it will land before you commit to it.
  await expect(page.locator('#nm-where')).toContainText(`Maps/SingleMissions/${NAME}`);

  await page.locator('#nm-ok').click();

  // The dialog closes only on success; an error would leave it open with a
  // message, so this also asserts the create didn't fail.
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 30_000 });

  // The map the app now has open is the one we asked for.
  await expect(page.locator('#title')).toHaveText(`homm5-editor — ${NAME} (72×72)`, { timeout: 60_000 });
  await expect(page.locator('#pack')).toBeEnabled();
  await expect(page.locator('#viewbtn')).toBeVisible();

  // And on disk it is a complete project, not a stub: both terrains (we asked
  // for two levels) plus the 20 sibling text files.
  const files = readdirSync(MAP_DIR);
  expect(files).toContain('map.xdb');
  expect(files).toContain('GroundTerrain.bin');
  expect(files).toContain('UndergroundTerrain.bin');
  expect(files.filter((f) => f.endsWith('.txt'))).toHaveLength(20);

  const xdb = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xdb).toContain('<TileX>72</TileX>');
  expect(xdb).toContain('<HasUnderground>true</HasUnderground>');
  // name.txt is UTF-16-LE with a BOM, and carries the name we typed.
  const name = readFileSync(join(MAP_DIR, 'name.txt'));
  expect(name.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
  expect(name.toString('utf16le', 2)).toBe(NAME);
});

test('refuses to overwrite a map that already exists', async () => {
  const { page } = ed;
  await page.locator('#newmapbtn').click();
  await page.locator('#nm-name').fill(NAME); // still on disk from the test above
  await page.locator('#nm-ok').click();
  // The dialog stays up with the reason, rather than clobbering the folder.
  await expect(page.locator('#nm-err')).toContainText('already exists');
  await expect(page.locator('#newmap')).toBeVisible();
  await page.locator('#nm-cancel').click();
});

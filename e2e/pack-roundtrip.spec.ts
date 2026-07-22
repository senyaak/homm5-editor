// The round trip, end to end: create → pack → open the archive → compare.
//
// This is the loop a mapmaker actually lives in. Pack writes a .h5m for the
// game; opening that .h5m unpacks it back into an editable folder. If the two
// halves disagree by a single byte, a map edited, packed and reopened is not the
// map that was packed — so the check here is not "it ran", it is that every file
// that comes back out is byte-identical to what went in.
//
// The OS save/open dialogs are the one thing Playwright cannot click: they are
// native windows, not page content. They are stubbed in the MAIN process, so
// everything on this side of them — the button, the IPC, the packing, the
// unpacking, the reload — is the real thing.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

let ed: Launched;

const NAME = 'e2e Pack';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'samples', 'paks', 'data');
const MAPS = join(DATA, 'Maps');
const MAP_DIR = join(MAPS, NAME);
const ARCHIVE = join(MAPS, `${NAME}.h5m`);
// Where map:open-archive puts the unpacked copy: the archive's own name, made
// free — the folder it was packed from is still sitting there.
const REOPENED = join(MAPS, `${NAME} (2)`);

function cleanup(): void {
  for (const p of [MAP_DIR, ARCHIVE, REOPENED]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('packs a new map, opens the .h5m back, and gets the same bytes', async () => {
  const { app, page } = ed;

  // --- create -----------------------------------------------------------
  await page.locator('#newmapbtn').click();
  await page.locator('#nm-name').fill(NAME);
  await page.locator('#nm-size').selectOption('72');
  await page.locator('#nm-ok').click();
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#title')).toHaveText(`homm5-editor — ${NAME} (72×72)`, { timeout: 60_000 });

  // --- pack -------------------------------------------------------------
  // Answer the native save dialog with the path it would have suggested, which
  // is what a user pressing Save without retyping anything gets.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, ARCHIVE);

  await page.locator('#pack').click();
  await expect(page.locator('#hud')).toContainText('packed →', { timeout: 30_000 });
  expect(existsSync(ARCHIVE)).toBe(true);
  // A zip, by its local-file-header signature — the game will not read anything else.
  expect(readFileSync(ARCHIVE).subarray(0, 4)).toEqual(Buffer.from('PK\x03\x04', 'latin1'));

  // The working folder's files, before anything reopens them.
  const before = readdirSync(MAP_DIR).filter((f) => f !== 'project.json').sort();
  // Named, so an empty comparison below can never read as a pass.
  expect(before).toHaveLength(22); // map.xdb + GroundTerrain.bin + 20 text files

  // --- open the archive back --------------------------------------------
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, [ARCHIVE]);

  await page.locator('#open').click();
  await expect(page.locator('#hud')).toContainText('unpacked', { timeout: 60_000 });
  // The map on screen is the unpacked copy, not the folder we started from.
  await expect(page.locator('#title')).toHaveText(`homm5-editor — ${NAME} (2) (72×72)`, { timeout: 60_000 });

  // --- compare ----------------------------------------------------------
  // project.json is editor metadata: it is deliberately kept out of the archive,
  // and the unpacked copy gets a fresh one.
  const after = readdirSync(REOPENED).filter((f) => f !== 'project.json').sort();
  expect(after).toEqual(before);
  for (const f of after) {
    expect(readFileSync(join(REOPENED, f)).equals(readFileSync(join(MAP_DIR, f))),
      `${f} survived the round trip`).toBe(true);
  }
});

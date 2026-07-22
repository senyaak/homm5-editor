// The round trip, end to end: create → pack → open the archive → edit → save.
//
// This is the loop a mapmaker actually lives in, and every step of it is a
// claim worth checking:
//
//   * what comes back out of the archive is byte-identical to what went in,
//   * the archive is unpacked into a workspace of ours, not beside itself,
//   * reopening the same archive returns to that same workspace rather than
//     making another copy, and
//   * Save puts the work back into the .h5m it came from — which is the only
//     copy that matters, since the working folder is one the user never chose.
//
// The OS save/open dialogs are the one thing Playwright cannot click: they are
// native windows, not page content. They are stubbed in the MAIN process, so
// everything on this side of them — the button, the IPC, the packing, the
// unpacking, the reload — is the real thing.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readEntries } from '../src/pak.ts';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

let ed: Launched;

const NAME = 'e2e Pack';
const EDITED = 'e2e Pack, edited';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'samples', 'paks', 'data');
const MAPS = join(DATA, 'Maps');
// A map's path under the data root is also its path inside the archive.
const PREFIX = `Maps/SingleMissions/${NAME}`;
const MAP_DIR = join(MAPS, 'SingleMissions', NAME);
const ARCHIVE = join(MAPS, 'SingleMissions', `${NAME}.h5m`);

/** Workspaces live under the app's own data dir; collected as the test learns them. */
const workspaces = new Set<string>();

function cleanup(): void {
  for (const p of [MAP_DIR, ARCHIVE, ...workspaces]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

/** The folder the app says it unpacked into, from the status line. */
function unpackedDir(hud: string): string {
  const m = hud.match(/unpacked \d+ files → (.+)$/);
  if (!m) throw new Error(`status line does not name a folder: ${hud}`);
  return m[1]!;
}

test.beforeAll(async () => {
  cleanup();
  ed = await launchEditor();
  // Both OS dialogs are answered for the whole session, before anything else
  // runs. Patching them mid-test raced with the app's own start-up work in the
  // main process often enough to fail one run in three, and there is nothing to
  // gain from the later timing: the answers are fixed either way.
  await ed.app.evaluate(({ dialog }, { save, open }) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [open] })) as typeof dialog.showOpenDialog;
  }, { save: ARCHIVE, open: ARCHIVE });
});
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('packs a new map, opens the .h5m back, and gets the same bytes', async () => {
  const { page } = ed;

  // --- create -----------------------------------------------------------
  await page.locator('#newmapbtn').click();
  await page.locator('#nm-name').fill(NAME);
  await page.locator('#nm-size').selectOption('72');
  await page.locator('#nm-ok').click();
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#title')).toHaveText(`homm5-editor — ${NAME} (72×72)`, { timeout: 60_000 });

  // --- pack -------------------------------------------------------------
  // The stubbed save dialog answers with the path it would have suggested,
  // which is what a user pressing Save without retyping anything gets.
  await page.locator('#pack').click();
  await expect(page.locator('#hud')).toContainText('packed →', { timeout: 30_000 });
  expect(existsSync(ARCHIVE)).toBe(true);
  // A zip, by its local-file-header signature — the game will not read anything else.
  expect(readFileSync(ARCHIVE).subarray(0, 4)).toEqual(Buffer.from('PK\x03\x04', 'latin1'));

  // And the map sits at its in-game path inside the archive, not at the root.
  // The game addresses archive members by their path under its data root, so
  // this is the difference between a map it loads and one it cannot see at all.
  const names = readEntries(readFileSync(ARCHIVE)).map((e) => e.name);
  expect(names).toContain(`${PREFIX}/map.xdb`);
  expect(names.every((n) => n.startsWith(`${PREFIX}/`))).toBe(true);

  // The working folder's files, before anything reopens them.
  const before = readdirSync(MAP_DIR).filter((f) => f !== 'project.json').sort();
  // Named, so an empty comparison below can never read as a pass.
  expect(before).toHaveLength(22); // map.xdb + GroundTerrain.bin + 20 text files

  // --- open the archive back --------------------------------------------
  await page.locator('#open').click();
  await expect(page.locator('#hud')).toContainText('unpacked', { timeout: 60_000 });
  const reopened = unpackedDir((await page.locator('#hud').textContent()) ?? '');
  workspaces.add(reopened);
  await expect(page.locator('#title')).toHaveText(`homm5-editor — ${NAME} (72×72)`, { timeout: 60_000 });

  // Unpacked into a workspace of ours, NOT beside the archive: the archive sits
  // in the game's Maps folder, and a copy dropped next to it is a folder the
  // game would try to read as a second map.
  expect(reopened.startsWith(MAPS)).toBe(false);
  expect(existsSync(join(MAPS, 'SingleMissions', `${NAME} (2)`))).toBe(false);

  // --- compare ----------------------------------------------------------
  // project.json is editor metadata: it is deliberately kept out of the archive,
  // and the unpacked copy gets a fresh one.
  const after = readdirSync(reopened).filter((f) => f !== 'project.json').sort();
  expect(after).toEqual(before);
  for (const f of after) {
    expect(readFileSync(join(reopened, f)).equals(readFileSync(join(MAP_DIR, f))),
      `${f} survived the round trip`).toBe(true);
  }
});

test('Save writes the work back into the .h5m it came from', async () => {
  const { page } = ed;
  const packedBefore = readFileSync(ARCHIVE);

  // An edit through the UI: the map's visible name, which lives in name.txt.
  await page.locator('#mapbtn').click();
  await expect(page.locator('#mapprops')).toBeVisible();
  await page.locator('#mapprops .mp-name-edit').fill(EDITED);
  await page.locator('#mapprops .mp-name-edit').press('Enter');
  await expect(page.locator('#save')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#mp-close').click();

  await page.locator('#save').click();
  // Saving an archive-backed map says where the work went, and it is the .h5m.
  await expect(page.locator('#hud')).toContainText(`saved → ${ARCHIVE}`, { timeout: 60_000 });
  await expect(page.locator('#save')).toBeDisabled();

  // The archive really moved, and it carries the edit.
  const packedAfter = readFileSync(ARCHIVE);
  expect(packedAfter.equals(packedBefore)).toBe(false);
  const name = readEntries(packedAfter).find((e) => e.name === `${PREFIX}/name.txt`);
  expect(name, 'name.txt is in the archive').toBeTruthy();
  expect(name!.data.toString('utf16le', 2)).toBe(EDITED);
});

test('reopening the same archive returns to the same workspace', async () => {
  const { page } = ed;
  const first = [...workspaces][0]!;

  await page.locator('#open').click();
  await expect(page.locator('#hud')).toContainText('unpacked', { timeout: 60_000 });
  const again = unpackedDir((await page.locator('#hud').textContent()) ?? '');
  workspaces.add(again);

  // Same folder, not a second copy — which is what keeps the undo history and
  // any unsaved work attached to the map rather than to one particular open.
  expect(again).toBe(first);
  // And it holds the saved edit, since Save put it into the archive first.
  expect(readFileSync(join(again, 'name.txt')).toString('utf16le', 2)).toBe(EDITED);
});

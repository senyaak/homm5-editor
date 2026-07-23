// Writing a map's texts through the editor.
//
// A map's visible strings — its name, its description, an objective's caption, a
// sign's message — are sibling UTF-16LE text files a ref points at. The other
// specs create those files (empty, to prove the ref lands); this one WRITES them:
// open the text in the editor, type, save, and check the bytes on disk are the
// text, in the encoding the game reads. Both paths — editing a file that exists
// (name/description) and creating one with "New" (a custom goal) — are covered.
//
// A plain text, not a script: the editor opens in text mode (no Lua highlighting,
// no linter, no language tabs while localization is off) and Save closes it.
//
// On its own throwaway map, cleaned up after.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { DATA } from './c1m1/shared.ts';
import { openTree, reveal, treeValue } from './tree.ts';

let ed: Launched;
const NAME = 'e2e Text';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A map text is UTF-16LE with a BOM (what the game writes); decode it. */
function readTxt(rel: string): string {
  const buf = readFileSync(join(MAP_DIR, rel));
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  return buf.toString('utf8');
}

/** Replace the editor's whole contents with `text`. */
async function typeDoc(page: Page, text: string): Promise<void> {
  const content = page.locator('#de-text .cm-content');
  await content.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
}

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('write a map\'s texts through the editor: name, description, a new custom goal', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  await newMap(page, NAME, '72');
  await openTree(page);

  const doc = page.locator('#docedit');

  // --- edit an existing text: the map name -----------------------------------
  const nameRow = await reveal(page, ['NameFileRef']);
  await nameRow.locator('.mt-ref button', { hasText: '✎' }).first().click();
  await expect(doc).toBeVisible();
  // A plain text, not a script: no language tabs (localization is off), no linter,
  // and the card is the narrow one (wide is for code).
  await expect(page.locator('#de-langs')).toBeHidden();
  await expect(page.locator('#de-lint')).toHaveText('');
  await expect(page.locator('#docedit .de-card')).not.toHaveClass(/wide/);

  await typeDoc(page, 'The Siege of Whitecap');
  await page.locator('#de-save').click();
  await expect(doc, 'a text closes the editor on save').toBeHidden();
  await expect(async () => expect(readTxt('name.txt')).toContain('The Siege of Whitecap')).toPass({ timeout: 10_000 });

  // --- edit another existing text: the description ---------------------------
  const descRow = await reveal(page, ['DescriptionFileRef']);
  await descRow.locator('.mt-ref button', { hasText: '✎' }).first().click();
  await expect(doc).toBeVisible();
  await typeDoc(page, 'Hold the pass until the reinforcements arrive.');
  await page.locator('#de-save').click();
  await expect(doc).toBeHidden();
  await expect(async () => expect(readTxt('description.txt')).toContain('reinforcements')).toPass({ timeout: 10_000 });

  // --- create a text with "New" and write it: a custom goal ------------------
  const goalRow = await reveal(page, ['CustomGoal']);
  await goalRow.locator('.mt-ref button', { hasText: 'New' }).first().click();
  await expect(page.locator('#objnew')).toBeVisible();
  await page.locator('#on-name').fill('customgoal');
  await page.locator('#on-ok').click();
  // "New" creates the file and opens it for content straight away.
  await expect(doc).toBeVisible();
  await typeDoc(page, 'Defeat the enemy hero before winter.');
  await page.locator('#de-save').click();
  await expect(doc).toBeHidden();

  // The file holds the text, and the ref points at it.
  await expect(async () => {
    expect(existsSync(join(MAP_DIR, 'customgoal.txt')), 'the new text file exists').toBe(true);
    expect(readTxt('customgoal.txt')).toContain('before winter');
  }).toPass({ timeout: 10_000 });
  expect(await treeValue(page, ['CustomGoal']), 'the ref points at the new file').toBe('customgoal.txt');

  // --- re-open the name and confirm it round-trips ---------------------------
  const nameRow2 = await reveal(page, ['NameFileRef']);
  await nameRow2.locator('.mt-ref button', { hasText: '✎' }).first().click();
  await expect(page.locator('#de-text .cm-content')).toContainText('The Siege of Whitecap');
  await page.locator('#de-close').click();
});

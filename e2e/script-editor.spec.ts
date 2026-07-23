// The script editor: highlighting, completion from the map, and saving.
//
// The point of the completion is not convenience. Every name a map script
// passes to the engine — an object, a region, an objective — is a plain string,
// and a wrong one fails inside the game with no message at all. So the editor
// offers the names THIS map defines, and that is what is checked here: that the
// regions the reconstruction carries turn up inside a string literal, and the
// engine's own functions turn up outside one.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { MAP_DIR, NEED_FIXTURE, hasFixture, openMap } from './c1m1.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** A scratch script, written through the app's own file API and removed after. */
const FILE = 'e2e-editor-scratch.lua';
const SEED = 'function onStart()\n\t-- a comment\n\tlocal n = 1\nend\n';

test('the Lua editor highlights, completes from the map, and saves', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  await openMap(page);
  await page.evaluate(([href, text]) => window.editor.writeFile({ href: href!, text: text! }), [FILE, SEED]);

  // --- the map's scripts are reachable at all ---
  await page.locator('#scriptbtn').click();
  const row = page.locator(`#sp-list button[data-file="${FILE}"]`);
  await expect(row, 'the scratch script is listed').toBeVisible();
  await row.click();
  await expect(page.locator('#docedit')).toBeVisible();

  const content = page.locator('#de-text .cm-content');
  await expect(content).toContainText('function onStart()');
  // A wide card for a script: a file of code is read whole, not through a slot.
  await expect(page.locator('#docedit .de-card')).toHaveClass(/wide/);

  // --- highlighting ---
  // Asserted as "the text is broken into tokens with their own colours", which
  // is what a stream mode produces; the exact class names are CodeMirror's own
  // generated ones and say nothing.
  const colours = await content.evaluate((el) => {
    const seen = new Set<string>();
    for (const s of el.querySelectorAll('span')) seen.add(getComputedStyle(s).color);
    return [...seen];
  });
  expect(colours.length, `distinct token colours (${colours.join(', ')})`).toBeGreaterThan(1);

  // --- what the editor knows ---
  await expect(page.locator('#de-info')).toContainText('engine fns');
  await expect(page.locator('#de-info')).toContainText('regions');

  // --- completing an engine call ---
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nGetObjectPos');
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup, 'the completion popup').toBeVisible({ timeout: 15_000 });
  await expect(popup).toContainText('GetObjectPosition');
  // Its parameters are shown beside it — the reason the manual was parsed.
  await expect(popup).toContainText('objectName');
  // Taken with the mouse rather than with Enter: the key is bound (and works),
  // but "was the popup still recomputing when the key arrived" is a race this
  // test has no way to settle, and clicking the entry is what it is checking —
  // that the right entry is there and that taking it writes the call.
  await popup.locator('li', { hasText: 'GetObjectPosition' }).first().click();
  await expect(content).toContainText('GetObjectPosition(');

  // --- completing a name defined in THIS map ---
  const regions: string[] = await page.evaluate(() => window.view.regions().map((r) => r.name));
  expect(regions.length, 'the map has regions to complete from').toBeGreaterThan(0);
  const region = regions[0]!;
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`
local r = "${region.slice(0, 2)}`);
  await expect(popup, 'names offered inside a string').toBeVisible({ timeout: 15_000 });
  await expect(popup).toContainText(region);
  await expect(popup, 'and tagged with what defines them').toContainText('region');
  await popup.locator('li', { hasText: region }).first().click();
  await expect(content).toContainText(`"${region}`);

  // --- saving --- (Save keeps the editor open; the file lands on disk)
  await page.locator('#de-save').click();
  await expect(async () => {
    const onDisk = readFileSync(join(MAP_DIR, FILE), 'utf8');
    expect(onDisk, 'what landed in the file').toContain('GetObjectPosition(');
    expect(onDisk, 'the text it was opened with is still there').toContain('function onStart()');
  }).toPass({ timeout: 10_000 });
  await page.locator('#de-close').click();
  await expect(page.locator('#docedit')).toBeHidden();
});

test.afterAll(() => {
  const f = join(MAP_DIR, FILE);
  if (existsSync(f)) rmSync(f);
});

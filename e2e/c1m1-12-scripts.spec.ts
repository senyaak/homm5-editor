// C1M1 stage 12 — the Lua, and the linter that guards it.
//
// The last thing the mission needs and the last difference `diff-map` reports:
// its `MapScript`. This stage does three things, all through the app:
//
//   1. BIND the map script — the tree's script control creates the wrapper +
//      the .lua and points `MapScript` at it. That closes `diff-map`.
//   2. WRITE the mission's four scripts (their text is the original's, the way
//      every other stage takes its content from the reference).
//   3. LINT — the point of the whole editor. A map script is never compiled
//      where we can see it: a missing `end` or an unterminated string is a chunk
//      the engine silently refuses to load, and the editor is the only place
//      that ever says so. So this seeds those two mistakes ON PURPOSE, checks the
//      editor shows them, then fixes them and checks it goes quiet — because a
//      linter is only worth having if it both catches a real error AND clears
//      when the error is gone.
//
// Idempotent: binding adopts a wrapper that already exists, the files are written
// whole, and the seeded mistakes are appended and then removed, so the map is
// left with correct scripts whether this runs once or ten times.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { MAP_DIR, FIXTURE, NEED_FIXTURE, hasFixture, openMap } from './c1m1.ts';
import { openTree, reveal, treeValue } from './tree.ts';
import { loadMap } from '../src/map.ts';
import { readTree } from '../src/tree.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** The mission's scripts, beside the terrain fixture. */
const SCRIPTS_DIR = join(FIXTURE, '..');
const SCRIPTS = ['MapScript.lua', 'IsabellScript.lua', 'C1M1-CombatScript.lua'];
const fixtureScript = (name: string): string => readFileSync(join(SCRIPTS_DIR, name), 'utf8');

/** A ref compared the way the engine reads it — case and a leading slash folded. */
const norm = (v: string): string => v.trim().toLowerCase().replace(/^\/+/, '');

/** How many error markers the lint gutter is showing. */
const errorMarkers = (page: import('@playwright/test').Page) =>
  page.locator('#docedit .cm-lint-marker-error');

test('C1M1 scripts: bind the map script, write the Lua, and the linter catches a broken one', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  // Accept any "unsaved changes?" prompt — a close in this test is always meant.
  page.on('dialog', (d) => void d.accept());

  await openMap(page);

  // --- 1. bind MapScript through the tree's script control -------------------
  await openTree(page);
  const row = await reveal(page, ['MapScript']);
  // "New" on a script row makes the wrapper + an empty .lua and binds the ref —
  // a script is two files, and the ref points at the wrapper, never the .lua.
  await row.locator('.mt-ref button', { hasText: 'New' }).first().click();
  await expect(page.locator('#objnew')).toBeVisible();
  await page.locator('#on-name').fill('MapScript');
  await page.locator('#on-ok').click();
  await expect(page.locator('#objnew')).toBeHidden();
  // Creating a script opens it for editing straight away; close it, the content
  // is written below.
  const doc = page.locator('#docedit');
  if (await doc.isVisible()) await page.locator('#de-close').click();
  expect(norm(await treeValue(page, ['MapScript'])), 'MapScript now points at the wrapper')
    .toBe('mapscript.xdb#xpointer(/script)');

  // --- 2. write the mission's four scripts + their wrappers ------------------
  // The three the map needs beside MapScript: the combat scripts a hero and the
  // dialog call into. Each is a wrapper (created here, adopting the .lua) plus
  // the .lua's real text.
  await page.evaluate(() => window.editor.newScript({ base: 'IsabellScript' }));
  await page.evaluate(() => window.editor.newScript({ base: 'C1M1-CombatScript' }));
  for (const name of SCRIPTS) {
    const text = fixtureScript(name);
    await page.evaluate(([href, t]) => window.editor.writeFile({ href: href!, text: t! }), [name, text]);
  }

  // Save the map so the binding lands in map.xdb.
  await settle(page);
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  // The files are on disk, and the wrapper names the script.
  for (const name of [...SCRIPTS, 'MapScript.xdb', 'IsabellScript.xdb', 'C1M1-CombatScript.xdb']) {
    expect(existsSync(join(MAP_DIR, name)), `${name} written`).toBe(true);
  }
  // The map's own record: MapScript resolved, matching the original (folded).
  const built = readTree(loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8')).desc) as Record<string, string>;
  expect(norm(built.MapScript ?? ''), 'map.xdb MapScript ref').toBe('mapscript.xdb#xpointer(/script)');

  // --- 3. the linter: open the real script, break it, watch it complain ------
  await page.locator('#scriptbtn').click();
  await page.locator('#sp-list button[data-file="MapScript.lua"]').click();
  await expect(doc).toBeVisible();
  const content = page.locator('#de-text .cm-content');
  await expect(content).toContainText('function messages');

  // The real 500-line script is clean — the load-bearing claim, since a linter
  // that flags working code is worse than none (see src/lua-lint.ts).
  await expect(page.locator('#de-lint'), 'the shipped script lints clean').toHaveText('✓ no errors');
  await expect(errorMarkers(page)).toHaveCount(0);

  // Seed two mistakes ON PURPOSE, appended so the real functions are untouched:
  // an unterminated string, and a function with no `end`. Both are chunks the
  // engine would refuse to load.
  const broken = fixtureScript('MapScript.lua')
    + '\n-- seeded on purpose (test)\nfunction seeded_bad_string()\n\tlocal s = "no closing quote\nend\n'
    + '\nfunction seeded_missing_end()\n\tprint( 1 )\n';
  await page.evaluate((t) => window.editor.writeFile({ href: 'MapScript.lua', text: t }), broken);
  // Re-open to load the broken text through the app the way a person would.
  await page.locator('#de-close').click();
  await page.locator('#scriptbtn').click();
  await page.locator('#sp-list button[data-file="MapScript.lua"]').click();
  await expect(doc).toBeVisible();

  // The editor SHOWS the errors — a count beside the name and markers in the
  // gutter. This is the whole question the user asked: are compile errors shown?
  // The count is exact and viewport-independent; the gutter renders only the
  // lines on screen, so scroll to the seeded lines (they are at the end) first.
  await expect(page.locator('#de-lint')).toContainText('2 errors');
  await expect(page.locator('#de-lint')).toHaveClass(/err/);
  await content.click();
  await page.keyboard.press('Control+End');
  await expect(errorMarkers(page), 'markers in the gutter for the broken lines').not.toHaveCount(0);

  // --- and it clears when the mistakes are fixed -----------------------------
  await page.evaluate((t) => window.editor.writeFile({ href: 'MapScript.lua', text: t }), fixtureScript('MapScript.lua'));
  await page.locator('#de-close').click();
  await page.locator('#scriptbtn').click();
  await page.locator('#sp-list button[data-file="MapScript.lua"]').click();
  await expect(doc).toBeVisible();
  await expect(page.locator('#de-lint'), 'the linter clears once the script is valid').toHaveText('✓ no errors');
  await expect(errorMarkers(page)).toHaveCount(0);

  // --- live: a mistake typed into the editor surfaces as you type ------------
  // `end` needs no bracket or quote, so the auto-closing brackets do not get in
  // the way — a clean way to prove the linter runs on every keystroke, not only
  // on open.
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nend');
  await expect(page.locator('#de-lint')).toHaveClass(/err/);
  await expect(errorMarkers(page)).not.toHaveCount(0);
  // Take it back out — the linter goes quiet again.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#de-lint')).toHaveText('✓ no errors');
  await expect(errorMarkers(page)).toHaveCount(0);

  // Leave the real script on disk, unbroken.
  await page.evaluate((t) => window.editor.writeFile({ href: 'MapScript.lua', text: t }), fixtureScript('MapScript.lua'));
  await page.locator('#de-close').click();
});

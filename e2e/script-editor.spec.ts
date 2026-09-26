// The script editor: highlighting, completion from the map, and saving.
//
// The point of the completion is not convenience. Every name a map script
// passes to the engine — an object, a region, an objective — is a plain string,
// and a wrong one fails inside the game with no message at all. So the editor
// offers the names THIS map defines, and that is what is checked here: that a
// region of the map's own turns up inside a string literal, and the engine's own
// functions turn up outside one.
//
// IT BRINGS ITS OWN MAP. This used to borrow the C1M1 reconstruction and
// complete from the regions that exercise happens to carry, which coupled a spec
// about an editor panel to a campaign rebuild it has nothing to do with — and
// duly broke, in the least useful way, the moment something left that map blank:
// "the map has no regions" rather than "the map is not the one I meant". So it
// makes a blank fixture and draws the one region it needs, which is also the
// honest setup: what is under test is completing from a name the map defines,
// and defining it here is one drag.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { buildMapFixture } from './map-fixture.ts';
import { drawRegion, openRegions, setRegionName } from './regions.ts';
import { bar } from './bar.ts';

let ed: Launched;

/** Our own map, and the region a script will address by name. */
const NAME = 'e2e Script Editor';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const REGION = { name: 'e2eScriptRegion', x1: 6, y1: 6, x2: 12, y2: 12, color: [1, 0, 0] as [number, number, number] };

/** A scratch script, written through the app's own file API and removed after. */
const FILE = 'e2e-editor-scratch.lua';
const SEED = 'function onStart()\n\t-- a comment\n\tlocal n = 1\nend\n';

test.beforeAll(async () => {
  buildMapFixture(MAP_DIR, NAME);
  ed = await launchEditor();
});
test.afterAll(async () => { await ed?.app.close(); });

test('the Lua editor highlights, completes from the map, and saves', { tag: '@nodata' }, async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  await page.evaluate((p) => window.view.open(p), join(MAP_DIR, 'map.xdb'));
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
  await page.evaluate(() => { window.view.plan(true); window.view.fit(); });

  // The name the completion will offer — defined here, on this map, so the spec
  // owns both halves of what it is checking.
  await openRegions(page);
  await drawRegion(page, REGION);
  await setRegionName(page, 0, REGION.name);
  await bar(page, '#regionbtn');

  await page.evaluate(([href, text]) => window.editor.writeFile({ href: href!, text: text! }), [FILE, SEED]);

  // --- the map's scripts are reachable at all ---
  await bar(page, '#scriptbtn');
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
  expect(regions, 'the region drawn above is what the map defines').toContain(REGION.name);
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`
local r = "${REGION.name.slice(0, 4)}`);
  await expect(popup, 'names offered inside a string').toBeVisible({ timeout: 15_000 });
  await expect(popup).toContainText(REGION.name);
  await expect(popup, 'and tagged with what defines them').toContainText('region');
  await popup.locator('li', { hasText: REGION.name }).first().click();
  await expect(content).toContainText(`"${REGION.name}`);

  // --- saving --- (a script closes the editor on save)
  await page.locator('#de-save').click();
  await expect(page.locator('#docedit')).toBeHidden();
  const onDisk = readFileSync(join(MAP_DIR, FILE), 'utf8');
  expect(onDisk, 'what landed in the file').toContain('GetObjectPosition(');
  expect(onDisk, 'the text it was opened with is still there').toContain('function onStart()');
});

/** A second scratch script: a constant the game never declared, then the one it did. */
const LINT_FILE = 'e2e-editor-lint.lua';
const WRONG = 'local level = GetTownBuildingLevel("Town1", TB_SPECIAL_1)\n';
const RIGHT = 'local level = GetTownBuildingLevel("Town1", TOWN_BUILDING_SPECIAL_1)\n';

// The one vocabulary check the linter makes, through the app. `TB_SPECIAL_1` is
// how the DATA names the building and `TOWN_BUILDING_SPECIAL_1` how the game's
// Lua does; the first passed every structural rule and read as nil once per
// click in game (docs/FACTION_PLAN.md §2b). The second half is the load-bearing
// one: the right name is known only if the editor's vocabulary reached the
// renderer with `advmap-startup.lua`'s declarations in it — which are indented,
// and which a pattern anchored at the column had skipped for months.
test('and warns on a constant the game never declared', { tag: '@data' }, async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  await page.evaluate((p) => window.view.open(p), join(MAP_DIR, 'map.xdb'));
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
  await page.evaluate(([href, text]) => window.editor.writeFile({ href: href!, text: text! }), [LINT_FILE, WRONG]);

  await bar(page, '#scriptbtn');
  const row = page.locator(`#sp-list button[data-file="${LINT_FILE}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('#docedit')).toBeVisible();
  await expect(page.locator('#de-text .cm-content')).toContainText('TB_SPECIAL_1');

  const lint = page.locator('#de-lint');
  await expect(lint, "the data's spelling of a building is flagged").toContainText('1 warning');
  await expect(lint, 'as a warning, not an error — the vocabulary is the install\'s').toHaveClass(/warn/);
  await expect(page.locator('#docedit .cm-lint-marker-warning'), 'and marked in the gutter').toHaveCount(1);

  // The name the game's Lua knows — quiet. Written whole and reopened, the way a
  // person would fix a file, rather than typed (the auto-closing brackets and
  // quotes would double every one typed).
  await page.locator('#de-close').click();
  await page.evaluate(([href, text]) => window.editor.writeFile({ href: href!, text: text! }), [LINT_FILE, RIGHT]);
  await bar(page, '#scriptbtn');
  await row.click();
  await expect(page.locator('#docedit')).toBeVisible();
  await expect(page.locator('#de-text .cm-content')).toContainText('TOWN_BUILDING_SPECIAL_1');
  await expect(lint, "the Lua's spelling is a name the editor knows").toHaveText('✓ no errors');
  await expect(page.locator('#docedit .cm-lint-marker-warning')).toHaveCount(0);
  await page.locator('#de-close').click();
});

test.afterAll(() => {
  for (const name of [FILE, LINT_FILE]) {
    const f = join(MAP_DIR, name);
    if (existsSync(f)) rmSync(f);
  }
});

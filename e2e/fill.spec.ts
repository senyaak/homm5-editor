// The fill tool in the real app: paint an area, plant a preset over it.
//
// Everything here goes through the window — the Fills panel, the brush buttons,
// a drag on the map, the Fill button, Undo — because the planner already has a
// unit suite (tools/test-fill.ts) and what this adds is the rest of the stack:
// the presets are found on this machine, the painted area reaches the main
// process, the objects come back with meshes and land on the live scene, the
// whole fill is ONE undo step, and what was planted survives a save.
//
// Needs the game data: the presets name objects in it, and nothing can be
// planted without a model to decode.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closeEditor, launchEditor, hudSays, E2E_GAME, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { dragTiles, newMap, settle } from './tiles.ts';
import { loadMap } from '../src/map/map.ts';
import { bar } from './bar.ts';

let ed: Launched;

const NAME = 'e2e Fill';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** The rectangle every check below is about: 8x8 tiles, well inside the map. */
const AREA = { x0: 20, y0: 20, x1: 27, y1: 27 };
const TILES = (AREA.x1 - AREA.x0 + 1) * (AREA.y1 - AREA.y0 + 1);

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

/**
 * Show the Fills panel if it is not already up.
 *
 * The bar button TOGGLES, and these tests share one editor: clicking it blind
 * closes the panel the test before left open, and every locator below then
 * waits on something hidden.
 */
async function openFills(page: Launched['page']): Promise<void> {
  if (!(await page.locator('#fillpal').isVisible())) await page.locator('#fillbtn').click();
  await expect(page.locator('#fillpal')).toBeVisible();
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await closeEditor(ed); cleanup(); });

test('an area painted with the fill brush becomes a wood, in one undo step', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(300_000);
  const { page } = ed;

  await newMap(page, NAME, '96');

  // --- the panel finds the presets on this machine ---
  await openFills(page);
  await expect(page.locator('#fill-list option').first()).toBeAttached({ timeout: 30_000 });
  const found = await page.evaluate(() => window.view.fill().presets);
  expect(found, 'presets were read from a file').toBeGreaterThan(0);
  await page.locator('#fill-list').selectOption({ label: 'Birch Wood' });
  await expect(page.locator('#fill-detail .layer')).toHaveCount(4);
  // The panel says what the preset does before it is run — the layers, and any
  // candidate this installation has no file for.
  await expect(page.locator('#fill-detail .layer .gone')).toHaveCount(0);

  // Nothing is painted yet, so there is nothing to fill.
  await expect(page.locator('#fill-apply')).toBeDisabled();
  expect(await page.evaluate(() => window.view.objects().length), 'the map starts empty').toBe(0);

  // --- paint the area ---
  await page.locator('.fill-sizes button[data-size="rect"]').click();
  // Choosing a brush arms the tool: the button says so, and a drag now paints
  // instead of orbiting.
  await expect(page.locator('#fill-draw')).toHaveText('draw: on');
  await dragTiles(page, [AREA.x0, AREA.y0], [AREA.x1, AREA.y1]);

  const painted = await page.evaluate(() => window.view.fill());
  expect(painted.cells, 'the drag painted the whole rectangle').toBe(TILES);
  expect(painted.preset).toBe('Birch Wood');
  // The outline is the only thing on screen that says where the fill will go,
  // and the area never reaches the map — so a silent overlay would be the tool
  // looking broken while working, or working while looking fine.
  expect(await page.evaluate(() => window.view.fillOutline()),
    'the painted area is outlined on the ground').toBeGreaterThan(0);
  await expect(page.locator('#fill-count')).toHaveText(`${TILES} tile(s) painted`);

  // --- plant it ---
  await page.locator('#fill-apply').click();
  const said = await hudSays(page, /planted \d+ object/, 240_000);
  const planted = Number(/planted (\d+)/.exec(said)?.[1] ?? 0);
  console.log(`  Birch Wood over ${TILES} tiles planted ${planted} objects`);
  expect(planted, 'a wood is more than a handful of trees').toBeGreaterThan(20);

  const objects = await page.evaluate(() => window.view.objects());
  expect(objects.length, 'every planted object is on the live scene').toBe(planted);
  const strays = objects.filter((o) => o.x < AREA.x0 || o.x > AREA.x1 + 1 || o.y < AREA.y0 || o.y > AREA.y1 + 1);
  expect(strays, 'nothing landed outside the painted rectangle').toEqual([]);
  // Trees, not the same tree: the preset draws from four birches and a handful
  // of undergrowth, and a plan that resolved one candidate for the whole run
  // would look identical in every other check here.
  expect(new Set(objects.map((o) => o.shared)).size, 'several definitions were used').toBeGreaterThan(2);

  // The paint is consumed by the fill, so a second click cannot plant the same
  // wood twice on top of itself.
  expect(await page.evaluate(() => window.view.fill().cells)).toBe(0);
  await expect(page.locator('#fill-apply')).toBeDisabled();

  // --- one undo takes the whole wood back ---
  await page.locator('#undobtn').click();
  await expect.poll(() => page.evaluate(() => window.view.objects().length),
    { message: 'one undo step, however many trees', timeout: 60_000 }).toBe(0);
  await page.locator('#redobtn').click();
  await expect.poll(() => page.evaluate(() => window.view.objects().length),
    { message: 'and redo puts them all back', timeout: 60_000 }).toBe(planted);

  // --- and it survives a save ---
  await settle(page);
  await bar(page, '#save');
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  const saved = loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1'));
  expect(saved.objects.length, 'the file holds the wood').toBe(planted);
  const statics = saved.objects.filter((o) => o.type === 'AdvMapStatic');
  expect(statics.length, 'all of them are statics').toBe(planted);
  for (const o of saved.objects) {
    expect(o.pos!.x).toBeGreaterThanOrEqual(AREA.x0);
    expect(o.pos!.x).toBeLessThanOrEqual(AREA.x1 + 1);
    expect(o.shared, 'each points at a definition the preset named').toMatch(/MapObjects\/Grass\//);
  }
  // Facings come out of the plan in sixteen steps of 22.5°, so every saved
  // angle is one of them — the original can only produce fifteen.
  const STEP = Math.PI / 8;
  const offGrid = saved.objects.filter((o) => Math.abs((o.rot ?? 0) - Math.round((o.rot ?? 0) / STEP) * STEP) > 1e-3);
  expect(offGrid.map((o) => o.rot), 'every facing is a multiple of 22.5°').toEqual([]);
  expect(new Set(saved.objects.map((o) => Math.round((o.rot ?? 0) / STEP))).size,
    'and the whole turn is used').toBeGreaterThan(8);
});

test('a preset of your own is made in the window, kept in H5E, and plants what it names', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(240_000);
  const { page } = ed;

  // The rock this preset will be made of, chosen here so the check knows what
  // to look for on the map. Any catalogue entry would do — that is the point.
  const ROCK = 'Rock1x1_1';
  const MINE = 'e2e Own Rocks';

  await openFills(page);

  // The shipped presets cannot be edited or deleted — they are files we do not
  // own — so the buttons that would say otherwise are off.
  await page.locator('#fill-list').selectOption({ label: 'Birch Wood' });
  await expect(page.locator('#fill-edit')).toBeDisabled();
  await expect(page.locator('#fill-del')).toBeDisabled();
  await expect(page.locator('#fill-copy')).toBeEnabled();

  await page.locator('#fill-new').click();
  await expect(page.locator('#fillpreset')).toBeVisible();
  await page.locator('#fp-name').fill(MINE);

  // One layer, one object, chosen from the catalogue the way a person would.
  const layer = page.locator('.fp-layer[data-layer="0"]');
  await layer.locator('input[data-field="dispersion"]').fill('1');
  await layer.locator('input[data-field="dispersion"]').dispatchEvent('change');
  await layer.locator('.fp-add').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill(ROCK);
  await page.locator('#pp-list button').first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(layer.locator('.obj')).toHaveCount(1);

  await layer.locator('.obj input[data-field="probability"]').fill('1');
  await layer.locator('.obj input[data-field="probability"]').dispatchEvent('change');
  await layer.locator('.obj input[data-field="size"]').fill('0');
  await layer.locator('.obj input[data-field="size"]').dispatchEvent('change');
  // The footer runs the real planner over a scratch patch, so the numbers are
  // answerable before anything is saved: certain, one per tile, 8x8 = 64.
  await expect(page.locator('#fp-preview')).toHaveText('on an 8×8 patch: 64 object(s)');

  await page.locator('#fp-save').click();
  await expect(page.locator('#fillpreset')).toBeHidden();

  // It is in the list, chosen, and now editable — which the shipped ones are not.
  await expect.poll(() => page.evaluate(() => window.view.fill().preset), { timeout: 30_000 }).toBe(MINE);
  await expect(page.locator('#fill-edit')).toBeEnabled();
  await expect(page.locator('#fill-del')).toBeEnabled();

  // And on disk, in our own mod folder rather than in the game's Editor.
  const file = join(E2E_GAME, 'H5E', 'FillPresets.xml');
  expect(existsSync(file), `${file} was written`).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain(MINE);

  // Now plant it: three by three tiles of certain, one-per-tile rock.
  const before = await page.evaluate(() => window.view.objects().length);
  await page.locator('.fill-sizes button[data-size="rect"]').click();
  await dragTiles(page, [60, 20], [62, 22]);
  expect(await page.evaluate(() => window.view.fill().cells)).toBe(9);
  await page.locator('#fill-apply').click();
  const said = await hudSays(page, /planted \d+ object/, 120_000);
  expect(Number(/planted (\d+)/.exec(said)?.[1] ?? 0), 'one per tile, as the preset says').toBe(9);

  const fresh = (await page.evaluate(() => window.view.objects())).slice(before);
  expect(fresh, 'nine new objects').toHaveLength(9);
  expect(fresh.every((o) => o.shared.includes(ROCK)),
    `all of them are the ${ROCK} the preset names`).toBe(true);

  // Deleting takes it out of the list and out of the file; what it planted stays.
  page.once('dialog', () => { /* the app never uses a native dialog — see core/dialog.ts */ });
  await page.locator('#fill-del').click();
  await page.locator('#ask-yes').click();
  await expect.poll(() => page.evaluate(() => window.view.fill().preset), { timeout: 30_000 }).not.toBe(MINE);
  expect(readFileSync(file, 'utf8')).not.toContain(MINE);
  expect(await page.evaluate(() => window.view.objects().length),
    'the rocks it planted are objects now, and stay').toBe(before + 9);
});

test('the brush adds and Shift takes away, without touching the map', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(180_000);
  const { page } = ed;

  // The map from the first test is still open, and it already has a wood on
  // it — which is the point: painting an area must not change the map at all.
  const before = await page.evaluate(() => window.view.objects().length);

  await openFills(page);
  await page.locator('.fill-sizes button[data-size="5"]').click();
  await expect(page.locator('#fill-draw')).toHaveText('draw: on');
  await dragTiles(page, [40, 40], [50, 40]);
  const wide = await page.evaluate(() => window.view.fill().cells);
  // An x5 brush dragged across eleven tiles covers a band five tiles deep.
  expect(wide, 'the square brush painted a band').toBeGreaterThan(40);

  // Shift rubs out, the same gesture the original uses — and the same drag
  // held with Shift takes back exactly what it put down.
  await page.keyboard.down('Shift');
  await dragTiles(page, [40, 40], [50, 40]);
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.view.fill().cells),
    'Shift over the same drag rubs all of it out').toBe(0);

  // Clear drops whatever is painted, and the outline goes with it.
  await dragTiles(page, [60, 60], [62, 60]);
  expect(await page.evaluate(() => window.view.fill().cells)).toBeGreaterThan(0);
  await page.locator('#fill-clear').click();
  expect(await page.evaluate(() => window.view.fill().cells)).toBe(0);
  expect(await page.evaluate(() => window.view.fillOutline())).toBe(0);
  await expect(page.locator('#fill-count')).toHaveText('nothing painted');

  expect(await page.evaluate(() => window.view.objects().length),
    'painting an area changes nothing on the map').toBe(before);

  // Esc puts the tool down without dropping what was painted.
  await dragTiles(page, [40, 40], [42, 40]);
  const kept = await page.evaluate(() => window.view.fill().cells);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fill-draw')).toHaveText('draw: off');
  expect(await page.evaluate(() => window.view.fill().cells), 'Esc keeps the paint').toBe(kept);

  // Closing the panel does drop it — an invisible selection is one the next
  // Fill would use without anybody seeing it.
  await page.locator('#fill-close').click();
  await expect(page.locator('#fillpal')).toBeHidden();
  expect(await page.evaluate(() => window.view.fill().cells)).toBe(0);
});

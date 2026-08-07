// Ctrl+Z, through the app.
//
// The patch layer has a unit suite of its own (tools/test-history.ts) and it is
// a thorough one — real map bytes, real terrain, byte-for-byte round trips. What
// it cannot see is the half that lives in the running editor: whether the step
// reaches the documents the session actually holds, whether the renderer takes
// delivery of what came back, and above all whether anything ELSE in the app
// moves a document behind the stack's back. It does not take much: a patch is
// bound to the exact bytes it was taken from, so one unrecorded edit anywhere
// turns every remaining Ctrl+Z into "patch does not fit" — which is what Save
// used to do to a map after an undone layer, and how this file came to exist.
//
// One map for all of it, and each test works on its own corner of it.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launchEditor, closeEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap, planView, armBrush, clickTile, settle, pickTile, setTileStrength } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;
const NAME = 'e2e Undo';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await closeEditor(ed); cleanup(); });

/** Every object on the open floor, by id. */
const ids = (): Promise<string[]> =>
  ed.page.evaluate(() => window.view.objects().map((o) => o.id));

/** The first catalogue entry that places a plain static. */
const someStatic = (): Promise<string> => ed.page.evaluate(async () => {
  const { objects } = await window.editor.listObjects();
  return objects.find((o) => o.type === 'AdvMapStatic' && !o.hidden && !o.random)?.shared ?? '';
});

/**
 * The map, made once for the whole file — in the tests rather than in
 * `beforeAll`, which Playwright runs again after a failure, and New Map refuses
 * to write over a map that is already there.
 */
let made = false;
async function ensureMap(): Promise<void> {
  if (made) return;
  cleanup();
  await newMap(ed.page, NAME, '72');
  await openObjectPalette(ed.page);
  made = true;
}

test('an object comes off the map and goes back on', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await ensureMap();

  const shared = await someStatic();
  expect(shared, 'a static entry exists').not.toBe('');

  const before = await ids();
  await pickObject(page, shared);
  await placeAtTile(page, 10, 10);
  const placed = (await ids()).filter((id) => !before.includes(id));
  expect(placed, 'one object was placed').toHaveLength(1);

  await expect(page.locator('#undobtn')).toBeEnabled();
  await page.locator('#undobtn').click();
  await expect(page.locator('#hud')).toContainText('undid', { timeout: 30_000 });
  expect(await ids(), 'the object is gone after undo').not.toContain(placed[0]);

  await page.locator('#redobtn').click();
  await expect(page.locator('#hud')).toContainText('redid', { timeout: 30_000 });
  expect(await ids(), 'the object is back after redo').toHaveLength(before.length + 1);

  // The editor still EDITS afterwards — the step re-parses the map in the main
  // process, so what the renderer holds and what the session holds could quietly
  // part company here and nothing above would notice.
  await page.locator('#undobtn').click();
  await expect(page.locator('#hud')).toContainText('undid', { timeout: 30_000 });
  const mid = await ids();
  await pickObject(page, shared);
  await placeAtTile(page, 20, 20);
  expect((await ids()).filter((id) => !mid.includes(id)),
    'an object can still be placed after an undo').toHaveLength(1);

  const saved = await page.evaluate(() => window.editor.save());
  expect(saved.status, 'and the map still saves').toBeTruthy();
  expect(ed.errors, 'the renderer threw nothing').toEqual([]);
});

test('the ground goes back where it was', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await ensureMap();
  await planView(page);

  const before = await page.evaluate(() => window.view.heights());
  await armBrush(page, 'raise', '3');
  await clickTile(page, 30, 30);
  await settle(page);
  const raised = await page.evaluate(() => window.view.heights());
  expect(raised, 'the stroke moved the ground').not.toEqual(before);

  // Heights, not just the status line: terrain comes back as planes plus a
  // rebuilt splat, and a step that reached the document without reaching the
  // screen would say "undid sculpt terrain" over an unchanged view.
  await page.locator('#undobtn').click();
  await expect(page.locator('#hud')).toContainText('undid', { timeout: 30_000 });
  expect(await page.evaluate(() => window.view.heights()), 'the ground is back').toEqual(before);

  await page.locator('#redobtn').click();
  await expect(page.locator('#hud')).toContainText('redid', { timeout: 30_000 });
  expect(await page.evaluate(() => window.view.heights()), 'and forward again').toEqual(raised);
  expect(ed.errors, 'the renderer threw nothing').toEqual([]);
});

test('a paint stroke comes back', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await ensureMap();
  await planView(page);

  const path = await page.evaluate(async () => {
    const { tiles } = await window.editor.listTiles();
    return tiles.find((t) => /Snow/i.test(t.name))?.path ?? tiles[0]?.path ?? '';
  });
  expect(path, 'a tile exists').not.toBe('');
  await pickTile(page, path);
  await armBrush(page, 'paint', '3');
  await setTileStrength(page, 255, false);
  await clickTile(page, 40, 40);
  await settle(page);

  await page.locator('#undobtn').click();
  await expect(page.locator('#hud')).toContainText('undid', { timeout: 30_000 });
  await page.locator('#redobtn').click();
  await expect(page.locator('#hud')).toContainText('redid', { timeout: 30_000 });
  expect(ed.errors, 'the renderer threw nothing').toEqual([]);
});

// What undo puts back has to be the same PICTURE, not merely the same objects.
//
// The step is applied in the main process and the renderer rebuilds the floor
// from the instance list that comes back — and rebuilding is where a floor loses
// everything that was done to it AFTER its objects were first made. The shadow
// roles are handed out once, when the floor is built, so fresh instanced meshes
// neither cast nor receive: the objects come back drawn, in the right place,
// with the right material, standing in flat sun. The effects are worse than
// lost: a system is bound to the instance it was built for, so the ones from
// before the step keep burning for objects that no longer exist, while the
// objects that came back stand cold.
//
// One object with both — a fountain, whose spray is a particle system and whose
// body casts — undone and redone.
test('the picture comes back with the objects: effects and shadows', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await ensureMap();

  const FOUNTAIN = '/MapObjects/Fountain_Of_Fortune.(AdvMapBuildingShared).xdb';
  /** The fountain's own particle systems, by name, so no other object counts. */
  const spray = (): Promise<number> => page.evaluate((href) =>
    window.view.fxSystems().filter((s) => s.shared === href).length, FOUNTAIN);

  await pickObject(page, FOUNTAIN);
  await placeAtTile(page, 60, 12);
  // Effects arrive over an IPC of their own, so the object is on the map before
  // they are.
  await expect.poll(spray, { timeout: 60_000 }).toBeGreaterThan(0);

  const systems = await spray();
  const before = await page.evaluate(() => window.view.shadowCasters());
  expect(before.drawn, 'something is drawing the objects').toBeGreaterThan(0);
  expect(before.casting, `all of it is in the shadow map: ${before.missing.join('; ')}`).toBe(before.drawn);

  await page.locator('#undobtn').click();
  await expect(page.locator('#hud')).toContainText('undid', { timeout: 30_000 });
  // Nothing left spraying over the grass the fountain no longer stands on.
  await expect.poll(spray, { timeout: 30_000 }).toBe(0);
  const undone = await page.evaluate(() => window.view.shadowCasters());
  expect(undone.casting, 'what is still drawn still casts').toBe(undone.drawn);

  await page.locator('#redobtn').click();
  await expect(page.locator('#hud')).toContainText('redid', { timeout: 30_000 });
  await expect.poll(spray, { timeout: 60_000 }).toBe(systems);

  const after = await page.evaluate(() => window.view.shadowCasters());
  expect(after.drawn, 'the objects are drawn again').toBe(before.drawn);
  expect(after.casting, 'and they are back in the shadow map').toBe(after.drawn);
  expect(ed.errors, 'the renderer threw nothing').toEqual([]);
});

// The regression this file was written for.
//
// Save used to name the terrain's tiles in the map's own <tiles> list on its way
// out — an add-only tidy-up of derived data, and an edit the history knew
// nothing about. Eighty bytes appeared in a document every patch on the stack
// had been taken from, and the next Ctrl+Z answered "patch does not fit:
// document is 49636 bytes, patch expects 49556". Nothing recovered from it: the
// cursor had already moved, so the press after that reached for a patch
// belonging to a state the map had never been in.
//
// Reached through an undone layer, because that is what makes the tidy-up find
// something to do: adding a layer names its tile, undoing takes the name back
// out, and the session's list of layers does not walk back with it.
test('a save does not break the undo stack', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await ensureMap();
  await planView(page);

  const path = await page.evaluate(async () => {
    const { tiles, inMap } = await window.editor.listTiles();
    const have = inMap.map((p) => p.toLowerCase());
    return tiles.find((t) => !have.includes(t.path.toLowerCase()))?.path ?? '';
  });
  expect(path, 'a tile this map has no layer for').not.toBe('');

  // The map edit that has to survive all this.
  const before = await ids();
  await pickObject(page, await someStatic());
  await placeAtTile(page, 50, 50);
  const placed = (await ids()).filter((id) => !before.includes(id));
  expect(placed, 'one object was placed').toHaveLength(1);

  // Picking a tile the map has no layer for adds one — both documents in one
  // step — and undoing takes the <tiles> entry away again.
  await pickTile(page, path);
  await settle(page);
  await page.locator('#undobtn').click();
  await expect(page.locator('#hud')).toContainText('undid', { timeout: 30_000 });

  await page.evaluate(() => window.editor.save());

  // And now the step before it, which is the one that used to be unreachable.
  await page.locator('#undobtn').click();
  await expect.poll(() => ids().then((list) => list.includes(placed[0]!)), { timeout: 30_000 })
    .toBe(false);
  expect(await page.locator('#hud').textContent(), 'the status line reports no failure')
    .not.toContain('failed');
  expect(ed.errors, 'the renderer threw nothing').toEqual([]);
});

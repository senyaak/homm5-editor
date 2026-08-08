// The Reach button in the real app: walk the map from the player's hero.
//
// The walk itself has a unit suite (tools/test-reach.ts) with boards worked out
// by hand. What this adds is the rest of the stack, and every part of it has
// been wrong at least once in this editor: the open map reaches the main
// process, the footprints resolve against the mounted data, the terrain planes
// are read from the documents the brush has been editing, and the answer comes
// back to a wash that shows the right tiles.
//
// The gestures are the ones a person makes — the palette, a click on the map,
// the mask brush, the button — because the point is the button working, not the
// function it calls.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closeEditor, launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, dragTiles, newMap, settle } from './tiles.ts';
import { pickObject, placeAtTile } from './objects.ts';
import { bar } from './bar.ts';

let ed: Launched;

const NAME = 'e2e Reach';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

const HERO = '/MapObjects/Haven/Isabell.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';
const FOUNTAIN = '/MapObjects/Fountain_Of_Fortune.(AdvMapBuildingShared).xdb';

/** Where each of them stands: the hero low on the map, the fountain high up. */
const HERO_AT = { x: 20, y: 20 };
const FAR_AT = { x: 60, y: 70 };
/** The row the wall is drawn along — between the two, right across the map. */
const WALL_Y = 45;

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

/** Place one object through the palette and the map, as a person does. */
async function place(page: Launched['page'], shared: string, x: number, y: number): Promise<string> {
  let added: { id: string }[] = [];
  // Up to three clicks: placeAtTile can land on nothing when the camera is
  // still moving, and it says nothing when it does — a click on bare ground is
  // not an error. Three misses in a row is a real failure.
  for (let attempt = 1; attempt <= 3 && added.length !== 1; attempt++) {
    await pickObject(page, shared);
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    await placeAtTile(page, x, y);
    added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
    expect(added.length, `one click on ${x},${y} put down ${added.length} objects`).toBeLessThan(2);
  }
  expect(added, `placing ${shared} at ${x},${y}`).toHaveLength(1);
  return added[0]!.id;
}

/**
 * Set one simple field of an object, the way the properties panel does.
 *
 * `setObjectProp` and not `setObjectPath`: only the panel's route turns the
 * owner's slot on with him, and a hero belonging to a slot nobody activated is
 * a hero nobody plays.
 */
const setProp = (page: Launched['page'], id: string, name: string, value: string) =>
  page.evaluate((p) => window.editor.setObjectProp({ id: p.id, name: p.name, value: p.value }),
    { id, name, value });

const hud = (page: Launched['page']): Promise<string> =>
  page.locator('#hud').textContent().then((t) => t ?? '');

/** Press Reach and wait for the answer to land in the HUD. */
async function reach(page: Launched['page']): Promise<string> {
  // Through the View menu it lives under: a button inside a closed popover has
  // no box on screen, and clicking it blind waits forever.
  await bar(page, '#reachbtn');
  await expect(page.locator('#hud')).not.toHaveText('walking the map…', { timeout: 60_000 });
  return hud(page);
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await closeEditor(ed); cleanup(); });

test('the walk finds what the wall shut out, and says so again when it is gone', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(600_000);
  const { page } = ed;

  await newMap(page, NAME, '96');

  // --- a map with nobody on it cannot be walked, and says which half is missing
  const empty = await reach(page);
  expect(empty, 'a map with no hero says so rather than reporting success')
    .toMatch(/no hero|no slot/i);

  // --- with a hero and something to visit, everything is reachable ------------
  const hero = await place(page, HERO, HERO_AT.x, HERO_AT.y);
  await place(page, FOUNTAIN, FAR_AT.x, FAR_AT.y);
  // A hero belonging to nobody is not the player's hero: giving him an owner is
  // what turns that slot on, and the walk starts from the slot a person plays.
  await setProp(page, hero, 'PlayerID', 'PLAYER_1');
  await settle(page);

  const open = await reach(page);
  expect(open, 'flat empty ground: the hero reaches everything').toMatch(/can reach all/i);

  // --- a wall of masked ground across the map ---------------------------------
  //
  // Drawn with the mask brush in Rect mode, the way it is drawn by hand, so what
  // the check reads is what the brush wrote.
  await armBrush(page, 'mask', 'rect');
  await dragTiles(page, [0, WALL_Y], [95, WALL_Y]);
  await settle(page);

  const shut = await reach(page);
  expect(shut, 'the fountain is on the far side of the wall now').toMatch(/1 not:/);
  expect(shut, 'and it is named').toContain('Fountain');

  // The wash is what a person actually looks at: ground he may stand on and can
  // never get to. It is only an answer if it covers the far side of the wall.
  const cut = await page.evaluate(() => {
    const r = window.view.reach();
    if (!r) return null;
    const size = Math.round(Math.sqrt(r.walkable[0]!.length));
    let fenced = 0;
    for (let i = 0; i < r.walkable[0]!.length; i++) if (r.walkable[0]![i] && !r.seen[0]![i]) fenced++;
    return { fenced, size };
  });
  expect(cut, 'the check left its answer for the wash to draw').not.toBeNull();
  // The far side is about half a 96² map; a wash of a handful of tiles would
  // mean the flood leaked round the wall.
  expect(cut!.fenced, 'the whole far side is washed, not a few tiles').toBeGreaterThan(1000);

  // --- and undoing the wall gives the map back --------------------------------
  await page.keyboard.press('Control+z');
  await settle(page);
  const again = await reach(page);
  expect(again, 'with the wall gone the fountain is reachable again').toMatch(/can reach all/i);
});

// An object can be put exactly where a shipped mission puts it.
//
// Three claims, each a gap C1M1 opened:
//
//   * a shared definition NO object link points at can still be placed — 559 of
//     the 1634 shipped definitions are like that, including every named hero
//     and 24 of the definitions C1M1 uses (713 of its 2645 objects);
//   * a position can be a fraction of a tile — 218 of C1M1's objects are, and
//     not one of them on a half tile, so no finer grid would do;
//   * a facing can be any angle — C1M1 holds 80 distinct ones across 368
//     objects, where the editor used to turn in 90° steps only.
//
// All of it through the palette and the panel, and checked in the file that
// lands on disk rather than in the app's own state.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap, settle } from './tiles.ts';
import { catalogEntry, degOf, pickObject, placeAtTile, setPlacement, sharedKey } from './objects.ts';
import { loadMap } from '../src/map.ts';

let ed: Launched;

const NAME = 'e2e Place Precisely';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A fence C1M1 uses 62 times, reachable only as a bare shared definition. */
const FENCE = '/MapObjects/Grass/Misc/Fence_03.(AdvMapStaticShared).xdb#xpointer(/AdvMapStaticShared)';
/** One of C1M1's own placements of it: off the grid, at an angle. */
const AT = { x: 42.494, y: 61.885, rotDeg: +degOf(4.5232).toFixed(3) };

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('an object lands at an exact fraction of a tile, at an exact angle', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(300_000);
  const { page } = ed;

  await newMap(page, NAME, '96');

  // The catalogue reaches it at all — the claim the palette used to fail.
  const entry = await catalogEntry(page, FENCE);
  expect(entry, 'a definition with no object link is still in the catalogue').toBeTruthy();
  expect(entry!.type).toBe('AdvMapStatic');

  await pickObject(page, FENCE);
  await placeAtTile(page, Math.floor(AT.x), Math.floor(AT.y));
  // Placing selects nothing by itself, so the object is picked up by clicking
  // it — the same way a person would go on to adjust it.
  await page.locator('#ex-list .exrow').first().click();
  await expect(page.locator('#panel')).toBeVisible();

  await setPlacement(page, AT);
  await settle(page);
  await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  const map = loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8'));
  const objs = map.objects;
  expect(objs.length, 'exactly one object was placed').toBe(1);
  const o = objs[0]!;
  expect(sharedKey(o.shared ?? ''), 'the shared definition it points at').toBe(sharedKey(FENCE));
  expect(o.pos!.x, 'x survived as a fraction').toBeCloseTo(AT.x, 3);
  expect(o.pos!.y, 'y survived as a fraction').toBeCloseTo(AT.y, 3);
  expect(o.rot, 'the free angle survived, in radians').toBeCloseTo(4.5232, 3);
});

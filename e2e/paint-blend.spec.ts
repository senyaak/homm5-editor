// Painting a tile at a chosen weight, without wiping the layers under it.
//
// A stroke used to mean "this tile here, the others gone" at full strength. Real
// ground is a blend — C1M1 holds several layers at one vertex and their weights
// sum past 255 — so the brush has a weight and a blend toggle, and this checks
// both reach the file.
//
// Also covers adding a layer for a tile the map does not carry, which is what
// picking it in the palette does, and which is the only structural terrain edit
// the editor makes.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, clickVertex, newMap, pickTile, planView, setTileStrength } from './tiles.ts';
import { parseTerrain, readTextureLayers, readMask } from '../src/terrain.ts';

let ed: Launched;

const NAME = 'e2e Paint Blend';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A blank map carries this one layer, at full weight everywhere. */
const GRASS = '/MapObjects/_(AdvMapTile)/Grass/Grass.xdb';
/** A tile the blank has no layer for, so picking it has to add one. */
const FLOWERS = '/MapObjects/_(AdvMapTile)/Grass/Flowers.xdb';

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('a blended stroke sets its own weight and leaves the layer under it', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(300_000);
  const { page } = ed;

  await newMap(page, NAME, '72');
  await planView(page);

  await pickTile(page, FLOWERS);
  await expect.poll(() => page.evaluate(() => window.view.paintReady()), { timeout: 120_000 }).toBe(true);
  await armBrush(page, 'paint', 'vertex');
  await setTileStrength(page, 96, true);
  for (const [x, y] of [[10, 10], [11, 10]] as const) await clickVertex(page, x, y);

  await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });
  expect(await page.locator('#hud').textContent()).not.toContain('failed');

  const t = parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin')));
  const layers = readTextureLayers(t);
  const find = (p: string) => layers.find((l) => (l.path ?? '').toLowerCase() === p.toLowerCase());
  const flowers = find(FLOWERS), grass = find(GRASS);
  expect(flowers, 'picking a tile the map lacks adds a layer for it').toBeTruthy();
  expect(grass).toBeTruthy();

  const fm = readMask(t, flowers!), gm = readMask(t, grass!);
  const V = t.V;
  for (const [x, y] of [[10, 10], [11, 10]] as const) {
    expect(fm[y * V + x], `flowers weight at ${x},${y}`).toBe(96);
    expect(gm[y * V + x], `grass under it at ${x},${y}`).toBe(255);
  }
  // Untouched ground keeps the blank's single layer.
  expect(fm[0]).toBe(0);
  expect(gm[0]).toBe(255);
});

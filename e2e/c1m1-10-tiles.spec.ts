// C1M1 stage 10 — the map's tile set.
//
// Not a stage anybody performs: `<tiles>` names the AdvMapTile documents the
// terrain paints with, and it is DERIVED — the same twelve tiles the ground
// layers use, pointed at from the map instead of from the terrain. The original
// editor keeps the two in step; ours did not, and the reconstruction reached
// twelve layers with an empty list, which no shipped map has.
//
// So this stage does nothing but open the map and save it. The repair happens on
// open (`syncMapTiles`), which is also what makes it visible: the document
// changed, so the map is dirty and Save is live. What is checked is that the
// list that lands in the file names exactly the tiles the terrain paints with —
// and that it is the same set the original carries, whatever order either editor
// happened to write them in.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { MAP_DIR, FIXTURE, openMap, requireFixture } from './c1m1.ts';
import { loadMap } from '../src/map.ts';
import { readTree } from '../src/tree.ts';
import type { TreeData } from '../src/tree.ts';
import { parseTerrain, readTextureLayers } from '../src/terrain.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** A reference as the engine reads it: case and a leading slash mean nothing. */
const norm = (v: string): string => v.trim().toLowerCase().replace(/^\/+/, '').split('#')[0]!;

const tilesOf = (xdb: string): string[] => {
  const tree = readTree(loadMap(readFileSync(xdb, 'utf8')).desc) as Record<string, TreeData>;
  return (Array.isArray(tree.tiles) ? tree.tiles : []).filter((v): v is string => typeof v === 'string');
};

test('the map names every ground tile its terrain paints with', async () => {
  requireFixture();
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  await openMap(page);
  await settle(page);
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  // What the terrain actually paints with — the list's only source of truth.
  const layers = readTextureLayers(parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin'))))
    .map((l) => l.path).filter((p): p is string => !!p).map(norm).sort();
  const listed = tilesOf(join(MAP_DIR, 'map.xdb')).map(norm).sort();
  expect(listed, 'the map lists exactly the tiles its terrain has layers for').toEqual(layers);

  // …and every entry points INTO the tile document, the way the original's do.
  const raw = tilesOf(join(MAP_DIR, 'map.xdb'));
  expect(raw.filter((r) => !r.endsWith('#xpointer(/AdvMapTile)')),
    'entries that are not references into an AdvMapTile').toEqual([]);

  // The same set the original carries. Order is not compared: the original's is
  // neither its terrain's layer order nor ours, so it is editor history.
  const want = tilesOf(join(FIXTURE, '..', 'C1M1.xdb')).map(norm).sort();
  expect(listed, 'the same tile set as the original').toEqual(want);
});

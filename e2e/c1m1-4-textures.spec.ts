// C1M1 stage 4 — the ground textures: twelve layers and their weights.
//
// Picking a tile the map has no layer for adds one, which is the editor's only
// structural terrain edit and how this stage gets its layers. Painting is
// blended, so a layer does not wipe the ones under it: a shipped map keeps
// several at one vertex and C1M1's weights sum to 510 there as often as not.
//
// Per layer, the value most of the map shares goes on as one rectangle and the
// rest vertex by vertex — the same shape as the tiers, for the same reason.

import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, dragTiles, openBrushPanel, pickTile, setTileStrength } from './tiles.ts';
import {
  NEED_FIXTURE, clickAt, fixture, hasFixture, mismatches, openMap, saveTerrain, vertexPixels,
} from './c1m1.ts';
import { readHeights, readMask, readTextureLayers } from '../src/terrain.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('C1M1 ground textures, layer by layer', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const fx = fixture();
  const want = readTextureLayers(fx).map((l) => ({ path: l.path!, mask: Array.from(readMask(fx, l)) }));

  const V = await openMap(page);
  // The ground before this stage: painting water must not carve it.
  const heightsBefore = await page.evaluate(() => window.view.heights());
  const pixels = await vertexPixels(page, V);

  // Painting a Water tile carves its bed and marks the river plane; both are
  // already authored, and the ground is at its final height. The toggle lives in
  // the brush panel, which is opened first because whether it was left open is a
  // persisted preference.
  await openBrushPanel(page);
  await page.locator('#rivercarve').setChecked(false);

  let writes = 0;
  for (const layer of want) {
    // Picking the tile also arms the paint brush, and adds the layer if this map
    // has none — the editor refuses to arm paint with no tile chosen.
    await pickTile(page, layer.path);
    await expect.poll(() => page.evaluate(() => window.view.paintReady()), { timeout: 120_000 }).toBe(true);

    const byValue = new Map<number, number[]>();
    for (let i = 0; i < layer.mask.length; i++) {
      const v = layer.mask[i]!;
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v)!.push(i);
    }
    const groups = [...byValue].sort((a, b) => b[1].length - a[1].length);
    const [wholeValue, wholeVerts] = groups[0]!;

    await setTileStrength(page, wholeValue, true);
    await armBrush(page, 'paint', 'rect');
    await dragTiles(page, [0, 0], [V - 2, V - 2], 12);
    writes += wholeVerts.length;

    await armBrush(page, 'paint', 'vertex');
    for (const [value, verts] of groups.slice(1)) {
      await setTileStrength(page, value, true);
      for (const v of verts) { await clickAt(page, pixels[v]!); writes++; }
    }
    console.log(`  ${layer.path.replace('/mapobjects/_(advmaptile)/', '')}: rect at ${wholeValue}`
      + ` (${wholeVerts.length}) + ${layer.mask.length - wholeVerts.length} vertices`);
  }
  console.log(`textures: ${want.length} layers, ${writes} vertex writes`);

  const built = await saveTerrain(page);
  const builtLayers = readTextureLayers(built);
  const wrong: string[] = [];
  for (const layer of want) {
    // Matched case-insensitively: the original spells tile paths lowercase and
    // the editor writes the asset's own spelling. The engine takes either, and
    // it is not something a map author chooses — see docs/E2E_RECONSTRUCTION.md.
    const mate = builtLayers.find((l) => (l.path ?? '').toLowerCase() === layer.path.toLowerCase());
    if (!mate) { wrong.push(`no layer for ${layer.path}`); continue; }
    wrong.push(...mismatches(readMask(built, mate), layer.mask, V, layer.path, 3));
  }
  expect(wrong, 'texture weights that differ').toEqual([]);
  expect(mismatches(readHeights(built), heightsBefore, V, 'height'), 'heights the texture pass moved').toEqual([]);
});

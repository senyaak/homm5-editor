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
import { launchEditor } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { armBrush, dragTiles, openBrushPanel, pickTile, setTileStrength } from '../tiles.ts';
import { clickVertex } from '../pointer.ts';
import { fixture, mismatches, openMap, requireFixture, saveTerrain } from './shared.ts';
import { readHeights, readMask, readTextureLayers } from '../../src/terrain/terrain.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('C1M1 ground textures, layer by layer', async () => {
  requireFixture();
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const fx = fixture();
  const want = readTextureLayers(fx).map((l) => ({ path: l.path!, mask: Array.from(readMask(fx, l)) }));

  const V = await openMap(page);
  // The ground before this stage: painting water must not carve it.
  const heightsBefore = await page.evaluate(() => window.view.heights());
  // The whole map on screen; each click maps its vertex when the mouse moves —
  // so neither the camera nor the window moving mid-pass can re-aim a stroke,
  // which is what the view-watch this stage used to carry was guarding against.
  await page.evaluate(() => window.view.fit());

  // Painting a Water tile carves its bed and marks the river plane; both are
  // already authored, and the ground is at its final height. The toggle lives in
  // the brush panel, which is opened first because whether it was left open is a
  // persisted preference.
  await openBrushPanel(page);
  await page.locator('#rivercarve').setChecked(false);

  let writes = 0;
  // Vertices the brush should have painted, counted the way the brush counts:
  // a rectangle stamps the whole grid, a click one vertex.
  let asked = 0;
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
    asked += V * V;

    await armBrush(page, 'paint', 'vertex');
    for (const [value, verts] of groups.slice(1)) {
      await setTileStrength(page, value, true);
      for (const v of verts) { await clickVertex(page, v % V, (v / V) | 0); writes++; asked++; }
    }
    // What the brush says it did, against what this layer asked for. A stroke
    // that reached the brush and painted nothing, or a vertex painted but never
    // handed over, is invisible in the file until it is compared with the
    // fixture — and by then it is 9409 numbers with no clue which layer moved.
    const st = await page.evaluate(() => window.view.strokes());
    console.log(`  ${layer.path.replace('/mapobjects/_(advmaptile)/', '')}: rect at ${wholeValue}`
      + ` (${wholeVerts.length}) + ${layer.mask.length - wholeVerts.length} vertices`
      + ` | asked ${asked} painted ${st.painted} sent ${st.sent} refused ${st.refused}`);
    expect(st.refused, `strokes ${layer.path} dropped`).toBe(0);
  }
  console.log(`textures: ${want.length} layers, ${writes} vertex writes`);

  // Rounds, as a guard: over forty thousand strokes a dense UI can lose one
  // (the last full run lost exactly one), and painting is idempotent — so what
  // differs after a pass is simply painted again, and a difference that is not
  // shrinking by round four is a bug the loop must not hide.
  let built = await saveTerrain(page);
  for (let round = 2; round <= 4; round++) {
    const layersNow = readTextureLayers(built);
    const redo: { layer: (typeof want)[number]; byValue: Map<number, number[]> }[] = [];
    for (const layer of want) {
      const mate = layersNow.find((l) => (l.path ?? '').toLowerCase() === layer.path.toLowerCase());
      if (!mate) continue; // the check below will name it
      const mask = readMask(built, mate);
      const byValue = new Map<number, number[]>();
      for (let i = 0; i < layer.mask.length; i++) {
        if (mask[i] === layer.mask[i]) continue;
        const v = layer.mask[i]!;
        if (!byValue.has(v)) byValue.set(v, []);
        byValue.get(v)!.push(i);
      }
      if (byValue.size) redo.push({ layer, byValue });
    }
    if (!redo.length) break;
    const count = redo.reduce((n, r) => n + [...r.byValue.values()].reduce((m, a) => m + a.length, 0), 0);
    console.log(`  round ${round}: ${count} vertices differ, repainting`);
    for (const { layer, byValue } of redo) {
      await pickTile(page, layer.path);
      await expect.poll(() => page.evaluate(() => window.view.paintReady()), { timeout: 120_000 }).toBe(true);
      await armBrush(page, 'paint', 'vertex');
      for (const [value, verts] of byValue) {
        await setTileStrength(page, value, true);
        for (const v of verts) { await clickVertex(page, v % V, (v / V) | 0); writes++; }
      }
    }
    built = await saveTerrain(page);
  }

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

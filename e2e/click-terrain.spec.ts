// Sculpt the terrain with real mouse clicks, and check the saved file.
//
// The first test of the reconstruction harness (docs/E2E_RECONSTRUCTION.md): a
// blank map through the dialog, the plan view, the Raise brush armed from the
// toolbar, and then tiles edited by clicking the pixel `window.view` says that
// tile is at. What lands in GroundTerrain.bin is read back and compared vertex
// by vertex.
//
// Two claims, and both matter for everything built on top:
//
//   * the tile → pixel mapping is exact — every tile in a sample across the map,
//     at two zoom levels, is picked as itself;
//   * a click edits the tile it was aimed at, all the way to the file — the
//     right vertices moved, and NOTHING else did.
//
// The second is why the check is "exactly these vertices": a brush that also
// nudged a neighbour would still look right on screen and would quietly make
// every reconstruction wrong.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, clickTile, mapSize, newMap, planView, setBrushForce } from './tiles.ts';
import { parseTerrain, readHeights, readGroundFlags, tierOf } from '../src/terrain.ts';

let ed: Launched;

const NAME = 'e2e Click Terrain';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A blank map is flat at this height on tier 1 — see docs/TERRAIN_FORMAT.md. */
const FLAT = 2.0;

/** Tiles to raise: near a corner, mid-map, and far enough apart to need scrolling. */
const RAISED: [number, number][] = [[3, 3], [20, 14], [55, 60]];

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('a tile maps to the pixel that picks it', async () => {
  const { page } = ed;
  test.setTimeout(180_000);

  await newMap(page, NAME, '72');
  await planView(page);
  const tiles = await mapSize(page);
  expect(tiles).toBe(72);

  // Fitted, the whole map is on screen: every tile must round-trip.
  const sample: [number, number][] = [];
  for (let i = 0; i < tiles; i += 7) for (let j = 0; j < tiles; j += 7) sample.push([i, j]);
  sample.push([0, 0], [tiles - 1, tiles - 1], [0, tiles - 1], [tiles - 1, 0]);

  const missed = await page.evaluate((pts) => {
    const bad: string[] = [];
    for (const [x, y] of pts as [number, number][]) {
      const at = window.view.tileToScreen(x, y);
      const hit = at.onScreen ? window.view.tileAt(at.x, at.y) : null;
      if (!hit || hit.x !== x || hit.y !== y) bad.push(`(${x},${y}) -> ${hit ? `(${hit.x},${hit.y})` : 'nothing'}`);
    }
    return bad;
  }, sample);
  expect(missed, 'tiles that did not pick as themselves when fitted').toEqual([]);

  // Zoomed in, only part of the map is on screen — what IS on screen must still
  // round-trip, and the harness is what scrolls to the rest.
  const missedZoomed = await page.evaluate((pts) => {
    window.view.zoom(12);
    window.view.focus(20, 20);
    const bad: string[] = [];
    for (const [x, y] of pts as [number, number][]) {
      const at = window.view.tileToScreen(x, y);
      if (!at.onScreen) continue;
      const hit = window.view.tileAt(at.x, at.y);
      if (!hit || hit.x !== x || hit.y !== y) bad.push(`(${x},${y}) -> ${hit ? `(${hit.x},${hit.y})` : 'nothing'}`);
    }
    return bad;
  }, sample);
  expect(missedZoomed, 'tiles that did not pick as themselves when zoomed in').toEqual([]);
});

test('clicking with the Raise brush moves exactly those vertices, into the file', async () => {
  const { page } = ed;
  test.setTimeout(180_000);

  await planView(page);
  await page.evaluate(() => window.view.fit());
  await armBrush(page, 'raise', '1');

  for (const [x, y] of RAISED) await clickTile(page, x, y);

  await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 60_000 });

  const t = parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin')));
  const heights = readHeights(t), flags = readGroundFlags(t)!;
  const V = t.V;

  // Raise is the plateau tool: it lifts the four corners of the tile a whole
  // step and moves them to the tier above, so a 1x1 click owns 4 vertices.
  const expected = new Set<number>();
  for (const [x, y] of RAISED) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expected.add((y + dy!) * V + (x + dx!));
  }

  const moved = new Set<number>();
  for (let i = 0; i < heights.length; i++) if (heights[i] !== FLAT) moved.add(i);

  expect([...moved].sort((a, b) => a - b), 'vertices whose height changed')
    .toEqual([...expected].sort((a, b) => a - b));
  for (const v of expected) {
    expect(heights[v], `height at vertex ${v % V},${(v / V) | 0}`).toBeGreaterThan(FLAT);
    expect(tierOf(flags[v]!), `tier at vertex ${v % V},${(v / V) | 0}`).toBeGreaterThan(1);
  }
});

test('the brush force is the height one stroke adds, exactly', async () => {
  const { page } = ed;
  test.setTimeout(180_000);

  // The point of the control: a chosen height, not a fixed step. Values off any
  // step grid on purpose — that is what a real map is made of, and what the
  // brush could not reach before.
  const strokes: { tile: [number, number]; force: number }[] = [
    { tile: [8, 40], force: 1.234 },
    { tile: [12, 44], force: 0.05 },
    { tile: [16, 48], force: 4.367 },
  ];

  await planView(page);
  await page.evaluate(() => window.view.fit());
  await armBrush(page, 'bulk', '1');

  for (const s of strokes) {
    await setBrushForce(page, s.force);
    await clickTile(page, s.tile[0], s.tile[1]);
  }

  await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 60_000 });

  const t = parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin')));
  const heights = readHeights(t), V = t.V;
  for (const { tile: [x, y], force } of strokes) {
    // A 1x1 stroke is a flat stamp over the tile's four corners, so every one
    // moved by the full force. Rounded through float32, which is how the file
    // stores it — comparing against the double would fail on the last bits.
    const want = Math.fround(FLAT + force);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const v = (y + dy!) * V + (x + dx!);
      expect(heights[v], `force ${force} at vertex ${x + dx!},${y + dy!}`).toBeCloseTo(want, 5);
    }
  }
});

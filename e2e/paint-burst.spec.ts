// Painting right after picking a tile: nothing may be dropped between the two.
//
// The C1M1 texture stage lost three whole layers this way. Picking a tile the
// map has no layer for adds one in the BACKGROUND, and until that round trip
// lands there is nothing for a stroke to paint into — the brush used to drop
// those strokes in silence, and `paintReady` said yes regardless, because it
// only asked whether some splat was decoded, not whether THIS tile was in it.
// On a small map the layer always won the race; on a real one, with a busy main
// process, it did not, and a whole layer stayed zero with nothing to show for
// it. See docs/E2E_RECONSTRUCTION.md.
//
// Two claims here. The gate is honest — checked in the same turn as the click,
// so the layer cannot have arrived yet. And a burst of clicks at the fitted
// zoom, where the vertices sit a handful of pixels apart, all reach the file.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, newMap, openBrushPanel, planView, setTileStrength } from './tiles.ts';
import { parseTerrain, readTextureLayers, readMask } from '../src/terrain.ts';
import { bar } from './bar.ts';

let ed: Launched;

const NAME = 'e2e Paint Burst';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A tile the blank map has no layer for, so the whole plane starts at zero. */
const FLOWERS = '/MapObjects/_(AdvMapTile)/Grass/Flowers.xdb';

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('every vertex of a fast burst lands', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(600_000);
  const { page } = ed;

  await newMap(page, NAME, '96');
  await planView(page);

  await openBrushPanel(page);
  const info = await page.evaluate(async (want) => {
    const { tiles } = await window.editor.listTiles();
    const t = tiles.find((x) => x.path.toLowerCase() === want.toLowerCase());
    return t ? { name: t.name, category: t.category } : null;
  }, FLOWERS);
  expect(info, 'the tile is in the catalogue').toBeTruthy();
  await page.locator('#pal-cat').selectOption({ value: info!.category });

  // The swatch is clicked and the answer read in the same turn, so the layer
  // this map lacks cannot have been added yet: the brush must say it is not
  // ready. Answering yes here is the bug, and it costs a whole layer.
  const readyAtOnce = await page.evaluate((name) => {
    const swatch = [...document.querySelectorAll<HTMLElement>('#pal-grid .tile')]
      .find((el) => el.querySelector('.nm')?.textContent === name);
    if (!swatch) return 'no swatch';
    swatch.click();
    return window.view.paintReady();
  }, info!.name);
  expect(readyAtOnce, 'the brush claims to be ready before the layer exists').toBe(false);

  await expect.poll(() => page.evaluate(() => window.view.paintReady()), { timeout: 120_000 }).toBe(true);
  await armBrush(page, 'paint', 'vertex');
  await setTileStrength(page, 96, true);

  const V = (await page.evaluate(() => window.view.size())) + 1;
  // A block of neighbouring vertices, which is how the stage paints: consecutive
  // clicks land a few pixels apart, and the ones that go missing go missing
  // there rather than on a scattered grid.
  const want: number[] = [];
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) want.push(y * V + x);

  const pixels = await page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.vertexToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, V);

  for (const v of want) {
    const at = pixels[v]!;
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.up();
  }

  await expect.poll(() => page.evaluate(() => window.view.pending()), { timeout: 300_000 }).toBe(0);
  await bar(page, '#save');
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  const t = parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin')));
  const layer = readTextureLayers(t).find((l) => (l.path ?? '').toLowerCase() === FLOWERS.toLowerCase());
  expect(layer, 'the picked tile got a layer').toBeTruthy();
  const mask = readMask(t, layer!);

  // The brush's own count of what it did. A stroke that reached the brush and
  // painted nothing is the failure this test exists for, and it is cheaper to
  // read here than to infer from a plane full of zeroes.
  const st = await page.evaluate(() => window.view.strokes());
  expect(st.refused, 'strokes the brush dropped').toBe(0);
  expect(st.sent, 'vertices handed to the main process').toBe(st.painted);

  const asked = new Set(want);
  const missing = want.filter((v) => mask[v] !== 96);
  const stray: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] && !asked.has(i)) stray.push(i);
  const say = (list: number[]) => list.slice(0, 5).map((v) => `(${v % V},${(v / V) | 0})=${mask[v]}`).join(' ');
  expect(missing.length, `vertices that never arrived: ${say(missing)}`).toBe(0);
  expect(stray.length, `vertices painted that were not clicked: ${say(stray)}`).toBe(0);
});

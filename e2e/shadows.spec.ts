// The sun's shadows in the real app.
//
// The pass has no state to read back that would prove it did anything: a
// `shadowState().on` of true is equally true when the map is drawn without a
// shadow anywhere in it. So the picture is the measurement — the same frame
// with the pass on and off differs ONLY where a shadow was drawn — and the
// question asked of it is the one that a wrong sign would answer differently:
// WHICH WAY the shadows fall.
//
// That question is not answerable by eye. Reading the top-down frame by hand
// got the direction backwards twice in one sitting, because the objects casting
// are dark themselves and the ground has its own light and shade. Here the
// objects' world positions are known exactly (the plan camera is orthographic
// and centred on a named target), so a disc mask of them is slid over the
// darkened mask and the offset that overlaps best is taken: that offset IS the
// direction, in pixels. Checked by sabotage — flipping the sign of the shadow
// direction in shadows.ts moves the agreement below from +0.995 to −0.945.
//
// Needs the game data (the preset carries the sun), so it skips itself without.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPng } from '../src/format/png.ts';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');
/** Half-height of the plan frustum, in tiles — close enough that a shadow is many pixels long. */
const ZOOM = 14;
/** A2C1M1's preset: Pitch 35 / Yaw 40, pointing AT the light — south-west (§3). */
const SUN = [-0.439, -0.369];

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('objects cast shadows, and they fall away from the preset\'s sun', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;

  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 180_000 });
  // Both toggles persist in the profile: left on "flat" there is no preset and
  // so no shadow at all, and left on the passability grid the frame is a wall
  // of red squares over the ground the shadows land on.
  await page.evaluate(() => {
    const light = document.getElementById('lightbtn');
    if (light?.textContent?.includes('flat')) (light as HTMLButtonElement).click();
    const grid = document.getElementById('blockbtn');
    if (grid?.classList.contains('on')) (grid as HTMLButtonElement).click();
  });

  const state = await page.evaluate(() => window.view.shadowState());
  expect(state.on).toBe(true);
  // The shadow direction is the sun's on this map (ShadowPitch 100 = "follow
  // the sun"), and it points AT the light.
  expect(state.dir[0]).toBeCloseTo(SUN[0]!, 2);
  expect(state.dir[1]).toBeCloseTo(SUN[1]!, 2);

  // Somewhere with things standing on it: the densest 8x8 block of objects.
  const at = await page.evaluate(() => {
    const bins = new Map<string, { n: number; x: number; y: number }>();
    for (const o of window.view.objects()) {
      const k = `${o.x >> 3}|${o.y >> 3}`;
      const b = bins.get(k) ?? { n: 0, x: 0, y: 0 };
      b.n++; b.x += o.x; b.y += o.y;
      bins.set(k, b);
    }
    let best = { n: 0, x: 0, y: 0 };
    for (const b of bins.values()) if (b.n > best.n) best = b;
    return { x: Math.round(best.x / best.n), y: Math.round(best.y / best.n) };
  });
  await page.evaluate(({ x, y, zoom }) => {
    window.view.plan(true);
    window.view.focus(x, y);
    window.view.zoom(zoom);
  }, { ...at, zoom: ZOOM });
  // The ground textures stream in after the map; shot too early the frame is
  // the flat colour blend, which shadows still darken but only just.
  await page.waitForTimeout(9000);

  const shot = async (on: boolean): Promise<{ w: number; h: number; rgba: Uint8Array }> => {
    await page.evaluate((v) => window.view.shadows(v), on);
    await page.waitForTimeout(400);
    const url = await page.evaluate(() => window.view.snapshot());
    const img = readPng(Buffer.from(url.split(',')[1]!, 'base64'));
    return { w: img.width, h: img.height, rgba: img.rgba };
  };
  const lit = await shot(true);
  const flat = await shot(false);
  await page.evaluate(() => window.view.shadows(true));

  const W = lit.w, H = lit.h;
  const dark = new Uint8Array(W * H);
  let darkCount = 0;
  for (let i = 0; i < W * H; i++) {
    const a = lit.rgba[i * 4]! + lit.rgba[i * 4 + 1]! + lit.rgba[i * 4 + 2]!;
    const b = flat.rgba[i * 4]! + flat.rgba[i * 4 + 1]! + flat.rgba[i * 4 + 2]!;
    if (b - a > 12) { dark[i] = 1; darkCount++; }
  }
  // A few percent of a busy frame. Zero is "the pass drew nothing"; most of the
  // frame would be "the whole picture went dark", which is what a broken
  // projection or a shadow camera pointing into the ground produces.
  const share = darkCount / (W * H);
  expect(share).toBeGreaterThan(0.01);
  expect(share).toBeLessThan(0.5);

  // World -> pixel, from the plan camera's own numbers (stage.ts: world +Y is
  // screen up, +X screen right; the frustum is `half` tall about the target).
  const U = 2, half = ZOOM * U;
  const perUnit = (H / 2) / half;
  const seeds: Array<[number, number]> = [];
  for (const [tx, ty] of await page.evaluate(() => window.view.objects().map((o) => [o.x, o.y] as [number, number]))) {
    const px = ((tx + 0.5) * U - (at.x + 0.5) * U) * perUnit + W / 2;
    const py = H / 2 - ((ty + 0.5) * U - (at.y + 0.5) * U) * perUnit;
    if (px > -perUnit && px < W + perUnit && py > -perUnit && py < H + perUnit) seeds.push([px, py]);
  }
  expect(seeds.length).toBeGreaterThan(20);

  const R = Math.max(2, Math.round(perUnit * 2)); // an object's own footprint
  const SEARCH = Math.round(perUnit * 8);
  let best = { dx: 0, dy: 0, score: -1 };
  for (let dy = -SEARCH; dy <= SEARCH; dy += 2) {
    for (let dx = -SEARCH; dx <= SEARCH; dx += 2) {
      if (dx * dx + dy * dy < R * R) continue; // under the caster: dark either way
      let score = 0;
      for (const [px, py] of seeds) {
        const x = Math.round(px + dx), y = Math.round(py + dy);
        if (x >= 0 && y >= 0 && x < W && y < H) score += dark[y * W + x]!;
      }
      if (score > best.score) best = { dx, dy, score };
    }
  }

  const len = Math.hypot(best.dx, best.dy) || 1;
  const fall = [best.dx / len, -best.dy / len];        // screen y is down, world y is up
  const awayLen = Math.hypot(SUN[0]!, SUN[1]!);
  const cos = -(fall[0]! * SUN[0]! + fall[1]! * SUN[1]!) / awayLen;
  expect(cos, `shadows fall toward (${fall[0]!.toFixed(2)}, ${fall[1]!.toFixed(2)})`).toBeGreaterThan(0.8);

  expect(errors).toEqual([]);
});

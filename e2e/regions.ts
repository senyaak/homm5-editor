// Driving the region tool — the one map structure that is drawn rather than
// typed.
//
// A region is a named rectangle of tiles with two script hooks. Its fields are
// schema-typed like everything else and the tree can author every one of them,
// but the rectangle itself is dragged out on the map: four numbers describing a
// box you are looking at is not how a person draws a box.
//
// The panel is addressed by INDEX (`data-region`), which is the region's own
// place in `<regions>` — the same path an edit is written through, and the same
// index `npm run diff-map` reports a difference at.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dragAt } from './c1m1/shared.ts';

/** A region as the original keeps it — inclusive tile bounds. */
export interface RegionSpec {
  name: string;
  x1: number; y1: number; x2: number; y2: number;
  /** 0..1 per channel, as the file writes it. */
  color: [number, number, number];
}

/** Open the regions panel, with the drawing tool armed. */
export async function openRegions(page: Page, draw = true): Promise<void> {
  if (!(await page.locator('#regions').isVisible())) await page.locator('#regionbtn').click();
  await expect(page.locator('#regions')).toBeVisible();
  const on = (await page.locator('#rg-draw').textContent())?.includes('on');
  if (on !== draw) await page.locator('#rg-draw').click();
  await expect(page.locator('#rg-draw')).toHaveText(draw ? 'draw: on' : 'draw: off');
}

/** The regions the app currently holds, in file order. */
export async function currentRegions(page: Page): Promise<
  { i: number; name: string; floor: number; x1: number; y1: number; x2: number; y2: number }[]
> {
  return page.evaluate(() => window.view.regions());
}

/**
 * Drag a region's rectangle out on the map.
 *
 * The view is moved to the region first: both corners have to be on screen, and
 * at the fitted zoom of a 96-tile map a tile is a few pixels wide — close enough
 * to its neighbour that a one-tile region would be a coin toss.
 */
export async function drawRegion(page: Page, r: RegionSpec): Promise<void> {
  const cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2;
  const half = Math.max(r.x2 - r.x1, r.y2 - r.y1) / 2 + 6;
  await page.evaluate(({ x, y, h }) => { window.view.focus(x, y); window.view.zoom(h); },
    { x: cx, y: cy, h: half });
  const [a, b] = await page.evaluate(([x1, y1, x2, y2]) =>
    [window.view.tileToScreen(x1!, y1!), window.view.tileToScreen(x2!, y2!)],
  [r.x1, r.y1, r.x2, r.y2]);
  await dragAt(page, [a!.x, a!.y], [b!.x, b!.y]);
}

/** The panel row for a region, by its index in `<regions>`. */
const row = (page: Page, i: number) => page.locator(`#rg-list .rg[data-region="${i}"]`);

/** Rename a region, in the panel — the name is what a script addresses it by. */
export async function setRegionName(page: Page, i: number, name: string): Promise<void> {
  const input = row(page, i).locator('input[type=text]');
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.dispatchEvent('change');
  await expect(input).toHaveValue(name);
}

/** Recolour a region, in the panel. The picker is 8-bit, and so is the file's. */
export async function setRegionColour(page: Page, i: number, c: [number, number, number]): Promise<void> {
  const hex = '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const input = row(page, i).locator('input[type=color]');
  await expect(input).toBeVisible();
  await input.fill(hex);
  await input.dispatchEvent('change');
}

/**
 * Delete a region — how a misdrawn rectangle is taken back.
 *
 * Waited on by the COUNT rather than by the row disappearing: removing an item
 * renumbers every one after it, so the row at this index exists again a moment
 * later holding a different region.
 */
export async function removeRegion(page: Page, i: number): Promise<void> {
  const before = (await currentRegions(page)).length;
  await row(page, i).locator('button.danger').click();
  await expect.poll(async () => (await currentRegions(page)).length, { timeout: 15_000 })
    .toBe(before - 1);
}

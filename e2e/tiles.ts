// Clicking the map by tile — the harness every reconstruction test builds on.
//
// The editor publishes `window.view` (renderer/app.ts, "automation hook"): under
// the plan camera a tile maps to a pixel exactly, so a test can say "click tile
// (18, 45)" and mean it. This wraps that in the Playwright-side moves — switch
// to the plan view, scroll the map so the tile is in the viewport, then use the
// real mouse.
//
// Everything here goes through the mouse and the toolbar on purpose. Calling the
// IPC directly would test the writers; the claim being tested is that the
// EDITOR can build a map, so the clicks have to be real.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** How many tiles the plan view spans from centre to top edge while editing. */
const ZOOM_HALF_TILES = 24;

/** Put the map in plan view, fitted, with the brush toolbar reachable. */
export async function planView(page: Page): Promise<void> {
  await page.evaluate(() => { window.view.plan(true); window.view.fit(); });
}

/** Tiles per side of the open map. */
export async function mapSize(page: Page): Promise<number> {
  return page.evaluate(() => window.view.size());
}

/**
 * Scroll the plan view so `(x, y)` is comfortably inside the viewport, and
 * return the pixel to click.
 *
 * Centring on every tile would be simplest but re-renders the whole view per
 * click; the view is only moved when the tile is not already on screen, which is
 * what makes a 2600-object mission take minutes rather than hours.
 */
export async function screenOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(([tx, ty, zoom]) => {
    let at = window.view.tileToScreen(tx!, ty!);
    if (!at.onScreen) {
      window.view.zoom(zoom!);
      window.view.focus(tx!, ty!);
      at = window.view.tileToScreen(tx!, ty!);
    }
    return at;
  }, [x, y, ZOOM_HALF_TILES]);
  return { x: p.x, y: p.y };
}

/**
 * Click a tile, and verify the app picked the tile we meant.
 *
 * The check is not paranoia: the mapping is arithmetic but the picking is a
 * raycast against the terrain mesh, and a click that silently lands one tile
 * over would show up much later as a map that is subtly wrong everywhere. This
 * turns that into a failure at the click.
 */
export async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const at = await screenOf(page, x, y);
  const hit = await page.evaluate(([px, py]) => window.view.tileAt(px!, py!), [at.x, at.y]);
  expect(hit, `tile (${x},${y}) is not pickable at ${Math.round(at.x)},${Math.round(at.y)}`).toEqual({ x, y });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** Drag from one tile to another — one continuous brush stroke. */
export async function dragTiles(page: Page, from: [number, number], to: [number, number], steps = 8): Promise<void> {
  const a = await screenOf(page, from[0], from[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Intermediate moves matter: the brush acts per pointermove, so a jump from
  // one end to the other paints the ends and nothing between them.
  const b = await screenOf(page, to[0], to[1]);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  }
  await page.mouse.up();
}

/** Arm the terrain brush in a given mode and size, through the toolbar. */
export async function armBrush(page: Page, mode: string, size: '1' | '3' | '5' | '7' | 'rect' = '1'): Promise<void> {
  await page.locator('#brushmode').selectOption(mode);
  await page.locator('#brushsizesel').selectOption(size);
  const btn = page.locator('#brushbtn');
  if ((await btn.textContent())?.includes('off')) await btn.click();
  await expect(btn).toHaveText('Brush: on');
}

/** Create a blank map through the New Map dialog, as a person would. */
export async function newMap(page: Page, name: string, size: string): Promise<void> {
  await page.locator('#newmapbtn').click();
  await page.locator('#nm-name').fill(name);
  await page.locator('#nm-size').selectOption(size);
  await page.locator('#nm-ok').click();
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#title')).toContainText(name, { timeout: 60_000 });
}

export { ZOOM_HALF_TILES };

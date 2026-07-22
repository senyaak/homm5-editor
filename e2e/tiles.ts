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

/**
 * Click a grid VERTEX — what the brush's Vertex size addresses.
 *
 * Heights live on vertices, and there is one more of them per side than there
 * are tiles, so this is the only way to reach the outer row and column.
 */
export async function clickVertex(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(([vx, vy, zoom]) => {
    let at = window.view.vertexToScreen(vx!, vy!);
    if (!at.onScreen) {
      window.view.zoom(zoom!);
      window.view.focus(vx!, vy!);
      at = window.view.vertexToScreen(vx!, vy!);
    }
    return at;
  }, [x, y, ZOOM_HALF_TILES]);
  await page.mouse.move(p.x, p.y);
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
export async function armBrush(page: Page, mode: string, size: '1' | '3' | '5' | '7' | 'vertex' | 'rect' = '1'): Promise<void> {
  await page.locator('#brushmode').selectOption(mode);
  await page.locator('#brushsizesel').selectOption(size);
  const btn = page.locator('#brushbtn');
  if ((await btn.textContent())?.includes('off')) await btn.click();
  await expect(btn).toHaveText('Brush: on');
}

/**
 * Set how far one Bulk/Dig stroke moves the ground, and how much of that
 * reaches the vertices around it.
 *
 * `tension: 0` makes the footprint move as one, which is what a reconstruction
 * wants: the stroke then lands on a value it can predict exactly instead of a
 * taper spread over neighbours.
 */
export async function setBrushForce(page: Page, force: number, tension = 0): Promise<void> {
  await page.locator('#brushforce').fill(String(force));
  await page.locator('#brushforce').dispatchEvent('input');
  await page.locator('#brushtension').fill(String(tension));
  await page.locator('#brushtension').dispatchEvent('input');
}

/**
 * Choose what the Ground-kind brush paints: the tier, and whether it is a ramp.
 */
export async function setGroundKind(page: Page, tier: number, ramp = false): Promise<void> {
  await page.locator('#kindtier').selectOption(String(tier));
  await page.locator('#kindramp').setChecked(ramp);
}

/** Set what the River-plane brush writes: 0..255, where 0 erases. */
export async function setRiverStrength(page: Page, value: number, carve = false): Promise<void> {
  await page.locator('#riverstrength').fill(String(value));
  await page.locator('#riverstrength').dispatchEvent('input');
  await page.locator('#rivercarve').setChecked(carve);
}

/** Click one cell of the river plane — the half-tile grid. */
export async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(([cx, cy, zoom]) => {
    let at = window.view.cellToScreen(cx!, cy!);
    if (!at.onScreen) {
      window.view.zoom(zoom!);
      window.view.focus(cx! / 2, cy! / 2);
      at = window.view.cellToScreen(cx!, cy!);
    }
    return at;
  }, [x, y, ZOOM_HALF_TILES]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** Set what the tile brush writes: a weight, and whether it blends or replaces. */
export async function setTileStrength(page: Page, value: number, blend = true): Promise<void> {
  await page.locator('#tilestrength').fill(String(value));
  await page.locator('#tilestrength').dispatchEvent('input');
  await page.locator('#tilesolo').setChecked(blend);
}

/**
 * Pick a ground tile in the palette, by its (AdvMapTile) path.
 *
 * Selecting a tile the map has no layer for adds one on the spot, which is how
 * the editor exposes the only structural terrain edit there is — so this is also
 * how a reconstruction gets its layers. The catalogue is consulted to learn
 * which category the tile lives in and what it is called; the clicking is real.
 */
export async function pickTile(page: Page, path: string): Promise<void> {
  const info = await page.evaluate(async (want) => {
    const { tiles } = await window.editor.listTiles();
    const t = tiles.find((x) => x.path.toLowerCase() === want.toLowerCase());
    return t ? { name: t.name, category: t.category } : null;
  }, path);
  if (!info) throw new Error(`no tile in the catalogue for ${path}`);

  if (!(await page.locator('#palette').isVisible())) await page.locator('#palbtn').click();
  await expect(page.locator('#palette')).toBeVisible();
  await page.locator('#pal-cat').selectOption({ value: info.category });
  // Exact text, not a substring: "Ground" is inside "DarkGround" and "Grass"
  // inside "Dark_Grass", so a loose match silently picks a neighbouring tile and
  // every later layer lands in the wrong plane.
  const swatch = page.locator('#pal-grid .tile')
    .filter({ has: page.getByText(info.name, { exact: true }) })
    .first();
  await swatch.click();
  // The readout is "<name> · priority N", so the name must be its first field —
  // "contains" would accept the neighbour this whole dance exists to avoid.
  await expect
    .poll(() => page.locator('#pal-sel').textContent(), { timeout: 30_000 })
    .toMatch(new RegExp('^' + info.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · '));
}

/**
 * Wait until every stroke has reached the main process.
 *
 * Strokes hand their edit over without waiting, so the file lags the screen. At
 * a few clicks that is invisible; at a hundred thousand the backlog outlives a
 * Save, which then runs against a map that is dirtied again a moment later.
 */
export async function settle(page: Page, timeout = 300_000): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.view.pending()), { timeout }).toBe(0);
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

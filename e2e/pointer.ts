// Driving the map with the mouse: where a vertex, tile or river cell is on
// screen, and how to click or drag one.
//
// Nothing here knows what is being built. It lived in `c1m1/shared.ts` because
// the reconstruction was the first thing to need it, and everything else that
// wanted a click on the map reached into that folder for it — a spec about the
// script editor importing from the campaign reconstruction, and the regions
// helper too. The dependency now runs the other way: this is the ground floor,
// and `c1m1` is one of its callers.
//
// The precomputed pixel arrays are not premature: at the fitted zoom the whole
// map is on screen, so one round trip replaces one per click, which over 9409
// vertices is the difference between minutes and hours.

import type { Page } from '@playwright/test';

/** Screen positions of every vertex, computed once. */
export async function vertexPixels(page: Page, V: number): Promise<[number, number][]> {
  return page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.vertexToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, V);
}

/** The same for tile centres — what the mask brush addresses. */
export async function tilePixels(page: Page, T: number): Promise<[number, number][]> {
  return page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.tileToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, T);
}

/** The same for the half-tile river grid. */
export async function cellPixels(page: Page, W: number): Promise<[number, number][]> {
  return page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.cellToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, W);
}

/** Click a precomputed pixel. The brush must already be armed. */
export async function clickAt(page: Page, at: [number, number]): Promise<void> {
  await page.mouse.move(at[0], at[1]);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Drag between two precomputed pixels — one continuous stroke.
 *
 * The intermediate moves are not decoration: a rect stroke reads the tile under
 * the cursor on press and on release, and a brush that acts per move would
 * otherwise paint the ends and nothing between them.
 */
export async function dragAt(
  page: Page, from: [number, number], to: [number, number], steps = 4,
): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  }
  await page.mouse.up();
}

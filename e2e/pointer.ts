// Driving the map with the mouse: click a MAP coordinate, not a pixel.
//
// Nothing here knows what is being built. It lived in `c1m1/shared.ts` because
// the reconstruction was the first thing to need it, and everything else that
// wanted a click on the map reached into that folder for it — a spec about the
// script editor importing from the campaign reconstruction, and the regions
// helper too. The dependency now runs the other way: this is the ground floor,
// and `c1m1` is one of its callers.
//
// THE PIXEL IS WORKED OUT AT THE MOMENT OF THE GESTURE, one evaluate per click.
// There used to be precomputed pixel arrays here — one round trip for all 9409
// vertices — and they were a standing bet that nothing moves between the
// computation and the last click of a pass. Everything lost that bet in turn:
// the heights pass moves the very ground the pixels were projected off, a drag
// used to refocus the camera mid-gesture, and the suite's parked window turned
// out to change size minutes into a run — each time the symptom was hundreds of
// clicks landing one vertex off, which in the file reads as paint lost here and
// gained there. A pixel resolved when the mouse is already moving cannot go
// stale; what it costs is one evaluate per click, about a quarter of the
// click's own round trips.
//
// The pixel-level `clickAt`/`dragAt` remain for callers that frame a gesture
// themselves and map both ends in one evaluate — `regions.ts` is the shape to
// copy: focus, map, drag, nothing cached across gestures.

import type { Page } from '@playwright/test';

/** Click a vertex, wherever it is on screen right now. The brush must be armed. */
export async function clickVertex(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(([vx, vy]) => window.view.vertexToScreen(vx!, vy!), [x, y]);
  await clickAt(page, [p.x, p.y]);
}

/** The same for a tile centre — what the mask brush addresses. */
export async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(([tx, ty]) => window.view.tileToScreen(tx!, ty!), [x, y]);
  await clickAt(page, [p.x, p.y]);
}

/** The same for a cell of the half-tile river grid. */
export async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(([cx, cy]) => window.view.cellToScreen(cx!, cy!), [x, y]);
  await clickAt(page, [p.x, p.y]);
}

/** Click a pixel. For callers that just mapped it themselves — never cache these. */
export async function clickAt(page: Page, at: [number, number]): Promise<void> {
  await page.mouse.move(at[0], at[1]);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Drag between two pixels — one continuous stroke.
 *
 * The intermediate moves are not decoration: a rect stroke reads the tile under
 * the cursor on press and on release, and a brush that acts per move would
 * otherwise paint the ends and nothing between them.
 *
 * Both ends must come out of ONE mapping under ONE camera — see `drawRegion`
 * for the shape, and `dragTiles` in tiles.ts for the whole-map case.
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

// Placing objects through the app's own palette — the harness the object stage
// of a reconstruction is built on.
//
// The same rule as the terrain harness (e2e/tiles.ts): everything goes through
// the palette, the map and the panel, because the claim being tested is that
// the EDITOR can build a mission, not that the writers work.
//
// A reconstruction addresses objects by their SHARED definition — that is what
// the original file records and what identifies the thing being placed. The
// catalogue is consulted to turn that into the entry a person would click.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Compare shared references by what they point at; case and slash vary. */
export const sharedKey = (href: string): string =>
  href.toLowerCase().replace(/^\/+/, '').split('#')[0]!;

/** Open the object palette if it is closed. */
export async function openObjectPalette(page: Page): Promise<void> {
  if (!(await page.locator('#objpal').isVisible())) await page.locator('#objpalbtn').click();
  await expect(page.locator('#objpal')).toBeVisible();
}

/** The catalogue entry for a shared definition, as the palette knows it. */
export async function catalogEntry(page: Page, shared: string): Promise<{
  name: string; label: string; group: string; type: string; hidden: boolean;
} | null> {
  return page.evaluate(async (want) => {
    const { objects } = await window.editor.listObjects();
    const key = (h: string): string => h.toLowerCase().replace(/^\/+/, '').split('#')[0]!;
    const hit = objects.find((o) => key(o.shared) === want);
    return hit
      ? { name: hit.name, label: hit.label, group: hit.group, type: hit.type, hidden: hit.hidden }
      : null;
  }, sharedKey(shared));
}

/**
 * Arm the palette with the entry that places `shared`.
 *
 * Found by searching, which is how a person finds one among 2026 entries — and
 * the search box matches the file name, so that is what is typed. Hidden
 * entries need their checkbox first or the grid will not show them.
 */
export async function pickObject(page: Page, shared: string): Promise<void> {
  const entry = await catalogEntry(page, shared);
  if (!entry) throw new Error(`no catalogue entry places ${shared}`);
  await openObjectPalette(page);
  if (entry.hidden) await page.locator('#obj-hidden').setChecked(true);
  await page.locator('#obj-cat').selectOption({ value: entry.group });
  await page.locator('#obj-search').fill(entry.name);
  const swatch = page.locator('#obj-grid .obj')
    .filter({ has: page.getByText(entry.label, { exact: true }) }).first();
  await swatch.click();
  // The readout is "placing: <label> · <type>"; anything else means the click
  // landed on a neighbour, which would put the wrong object on the map.
  await expect(page.locator('#obj-sel')).toHaveText(`placing: ${entry.label} · ${entry.type}`);
}

/** Click the map at tile (x, y) to place the armed object. */
export async function placeAtTile(page: Page, x: number, y: number): Promise<void> {
  const at = await page.evaluate(([tx, ty]) => window.view.tileToScreen(tx!, ty!), [x, y]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** The object the app currently has selected, as the panel shows it. */
export async function selection(page: Page): Promise<{ x: number; y: number; rot: number } | null> {
  const vis = await page.locator('#panel').isVisible();
  if (!vis) return null;
  return {
    x: +(await page.locator('#p-x').inputValue()),
    y: +(await page.locator('#p-y').inputValue()),
    rot: +(await page.locator('#p-rot').inputValue()),
  };
}

/**
 * Set the selected object's exact position and facing, through the panel.
 *
 * Dragging lands on the tile grid and the buttons turn in quarter steps, which
 * is how a map is laid out by hand — and not how a shipped one is: C1M1 puts
 * 218 of its objects at a fraction of a tile and 368 at one of 80 free angles.
 * The boxes are the way to say the exact value, for a person and for this.
 */
export async function setPlacement(
  page: Page, at: { x?: number; y?: number; rotDeg?: number },
): Promise<void> {
  if (at.x !== undefined) {
    await page.locator('#p-x').fill(String(at.x));
    await page.locator('#p-x').dispatchEvent('change');
  }
  if (at.y !== undefined) {
    await page.locator('#p-y').fill(String(at.y));
    await page.locator('#p-y').dispatchEvent('change');
  }
  if (at.rotDeg !== undefined) {
    await page.locator('#p-rot').fill(String(at.rotDeg));
    await page.locator('#p-rot').dispatchEvent('change');
  }
}

/** Radians as the degrees the panel takes. */
export const degOf = (rad: number): number => ((rad * 180 / Math.PI) % 360 + 360) % 360;

/**
 * How far apart two facings are, in radians, the short way round.
 *
 * Rotation is an angle, so 0 and 6.28319 are the same way up — and the original
 * writes both: C1M1 stores a full turn on two of its objects where the editor
 * normalises to zero. Comparing the raw numbers calls that a difference, and a
 * pass that tries to "fix" it never converges.
 */
export function rotDelta(a: number, b: number): number {
  const TAU = Math.PI * 2;
  return Math.abs((((a - b) % TAU) + TAU + Math.PI) % TAU - Math.PI);
}

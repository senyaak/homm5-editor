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
import { step } from './trace.ts';
import { screenOf } from './tiles.ts';
import { closeDoc, writeDoc } from './text-doc.ts';

/** Compare shared references by what they point at; case and slash vary. */
export const sharedKey = (href: string): string =>
  href.toLowerCase().replace(/^\/+/, '').split('#')[0]!;

/** Open the object palette if it is closed. */
export async function openObjectPalette(page: Page): Promise<void> {
  if (!(await page.locator('#objpal').isVisible())) await page.locator('#objpalbtn').click();
  await expect(page.locator('#objpal')).toBeVisible();
}

/** One palette entry, as much of it as placing one needs. */
export interface CatalogEntry {
  name: string; label: string; group: string; type: string; hidden: boolean; path: string;
  shared: string;
}

/** The catalogue entry for a shared definition, as the palette knows it. */
export async function catalogEntry(page: Page, shared: string): Promise<CatalogEntry | null> {
  return page.evaluate(async (want) => {
    const { objects } = await window.editor.listObjects();
    const key = (h: string): string => h.toLowerCase().replace(/^\/+/, '').split('#')[0]!;
    const hit = objects.find((o) => key(o.shared) === want);
    return hit
      ? { name: hit.name, label: hit.label, group: hit.group, type: hit.type, hidden: hit.hidden,
        path: hit.path, shared: hit.shared }
      : null;
  }, sharedKey(shared));
}

/**
 * The catalogue entry AT a palette path — the swatch itself rather than what it
 * places.
 *
 * Two entries can place the same definition: a generic hero and the named one
 * it resolves to are the same `AdvMapHeroShared` reached from two folders, and
 * asking by shared answers with whichever the catalogue lists first. When the
 * point is which SWATCH is clicked, the path is the only thing that says it.
 */
export async function paletteEntry(page: Page, path: string): Promise<CatalogEntry | null> {
  return page.evaluate(async (want) => {
    const { objects } = await window.editor.listObjects();
    const hit = objects.find((o) => o.path.toLowerCase() === want);
    return hit
      ? { name: hit.name, label: hit.label, group: hit.group, type: hit.type, hidden: hit.hidden,
        path: hit.path, shared: hit.shared }
      : null;
  }, path.toLowerCase());
}

/**
 * Arm the palette with the entry that places `shared`.
 *
 * Found by searching, which is how a person finds one among 2026 entries — and
 * the search box matches the file name, so that is what is typed. Hidden
 * entries need their checkbox first or the grid will not show them.
 */
export async function pickObject(page: Page, shared: string): Promise<void> {
  return step(`arm ${shared.split('/').pop()}`, async () => {
    const entry = await catalogEntry(page, shared);
    if (!entry) throw new Error(`no catalogue entry places ${shared}`);
    await armEntry(page, entry);
  });
}

/** Arm the palette with the entry at a palette path. */
export async function pickEntry(page: Page, path: string): Promise<void> {
  return step(`arm ${path.split('/').pop()}`, async () => {
    const entry = await paletteEntry(page, path);
    if (!entry) throw new Error(`the palette has no entry at ${path}`);
    await armEntry(page, entry);
  });
}

async function armEntry(page: Page, entry: CatalogEntry): Promise<void> {
  const armed = `placing: ${entry.label} · ${entry.type}`;
  // A swatch TOGGLES: the app says so ("click it again to stop"), so arming what
  // is already armed puts it down. Placing two of the same object in a row —
  // two Peasant stacks, say — otherwise placed one and then clicked bare
  // terrain with nothing in hand.
  if ((await page.locator('#obj-sel').textContent()) === armed) return;
  await openObjectPalette(page);
  if (entry.hidden) await page.locator('#obj-hidden').setChecked(true);
  await page.locator('#obj-cat').selectOption({ value: entry.group });
  await page.locator('#obj-search').fill(entry.name);
  // ADDRESSED BY ITS PATH, which is the only unique thing about a swatch.
  //
  // Labels collide — two entries are called "Chest", a treasure and the glow
  // static beside it — and matching the tooltip's `<name> · <type>` instead
  // fixed that while opening a worse hole: the tooltip is matched by SUBSTRING,
  // and `Disease_Zombie · AdvMapMonster` ends in `Zombie · AdvMapMonster`. So
  // asking for the plain zombie armed the alt-upgrade standing before it, and
  // the map came out carrying a monster nobody asked for. The palette now
  // stamps each swatch with its entry's path; the two older ways stay as the
  // fallback for a build without it.
  const byPath = page.locator(`#obj-grid .obj[data-path="${entry.path}"]`);
  const byLabel = page.locator('#obj-grid .obj')
    .filter({ has: page.getByText(entry.label, { exact: true }) });
  const exact = page.locator(`#obj-grid .obj[title*="${entry.name} · ${entry.type}"]`);
  const swatch = (await byPath.count()) ? byPath.first()
    : (await exact.count()) ? exact.first() : byLabel.first();
  await swatch.click();
  // The readout is "placing: <label> · <type>"; anything else means the click
  // landed on a neighbour, which would put the wrong object on the map.
  await expect(page.locator('#obj-sel')).toHaveText(armed);
}

/** Click the map at tile (x, y) to place the armed object. */
export async function placeAtTile(page: Page, x: number, y: number): Promise<void> {
  return step(`place at ${x},${y}`, async () => {
    // Through screenOf, which scrolls the view when the tile is not on it. A
    // 72x72 map does not fit the viewport, and clicking the raw projection of a
    // tile that is off screen lands outside the canvas and places NOTHING —
    // silently, since a click on nothing is not an error. That showed up as
    // "placing … added one object: received []" the first time an object was
    // asked for past the right edge, and it would have been every map wide
    // enough to scroll.
    // Where the tile is, and whether the CLICK can reach it.
    //
    // Two ways it cannot, and both place nothing at all — silently, because a
    // click that lands on something else is not an error:
    //
    //   the tile is off screen. `screenOf` handles that by scrolling, which is
    //     why this goes through it rather than through tileToScreen directly.
    //   the pixel is COVERED by a panel. The object palette is open while
    //     objects are being placed and the properties panel opens beside it, so
    //     a tile toward the edge projects to a pixel that belongs to a div. The
    //     picking ray does not care — it is arithmetic on the canvas — so the
    //     tile looks perfectly pickable right up until the click goes to the
    //     palette instead. Centring the view moves the tile out from under it.
    let at = await screenOf(page, x, y);
    const covering = async (): Promise<string> => page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px!, py!);
      return el instanceof HTMLCanvasElement ? '' : (el?.id || el?.tagName || 'nothing');
    }, [at.x, at.y]);
    if (await covering()) {
      await page.evaluate(([tx, ty]) => window.view.focus(tx!, ty!), [x, y]);
      at = await screenOf(page, x, y);
    }
    const over = await covering();
    expect(over, `(${x},${y}) projects onto #${over}, not the map — the click would go there`).toBe('');
    // AND THE PIXEL HAS TO PICK THE TILE IT CAME FROM. Projecting a tile and
    // picking a pixel are two different pieces of arithmetic in the editor, and
    // when they disagree the click goes somewhere else — or nowhere, if it lands
    // past the terrain, which places nothing and says nothing. That is how a
    // green spec started failing with "received []" and no other clue. Asked
    // here, the answer names the tile the click would really have hit.
    const picked = await page.evaluate(([px, py]) => {
      const t = window.view.tileAt(px!, py!);
      return t ? `${t.x},${t.y}` : 'no tile at all';
    }, [at.x, at.y]);
    // WHEN THEY DISAGREE, SAY BY HOW MUCH. Projection and picking are both
    // orthographic and neither looks at a height, so a disagreement is the two
    // reading different cameras rather than terrain — and the shape of the gap
    // tells which: the same pixel offset everywhere is a camera that moved
    // between the two calls, a growing one is a different zoom. Gathered here
    // because this runs 2645 times in the reconstruction and the failure that
    // matters is the one that costs twenty minutes to reach again.
    if (picked !== `${x},${y}`) {
      const [tx, ty] = picked.split(',').map(Number);
      const where = await page.evaluate(([px, py, ax, ay]) => ({
        back: window.view.tileToScreen(ax!, ay!),
        mid: window.view.tileAt(innerWidth / 2, innerHeight / 2),
        px, py, w: innerWidth, h: innerHeight,
      }), [at.x, at.y, tx ?? -1, ty ?? -1]);
      console.log(`[pick] wanted ${x},${y} at ${Math.round(at.x)},${Math.round(at.y)}`
        + ` — picked ${picked}, whose own pixel is`
        + ` ${Math.round(where.back.x)},${Math.round(where.back.y)};`
        + ` the middle of the screen (${where.w}x${where.h}) picks`
        + ` ${where.mid ? `${where.mid.x},${where.mid.y}` : 'nothing'}`);
    }
    expect(picked, `(${x},${y}) projects onto a pixel that picks ${picked}`).toBe(`${x},${y}`);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
  });
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

/**
 * Set one of the selected object's simple fields, in the property panel.
 *
 * The row is found by the field's own name — the label carries it as its title,
 * whatever the curated label says — and the control is whatever the schema chose
 * for it: a dropdown for an enum or a registry, a checkbox for a boolean, a box
 * for the rest. So this drives exactly what a person clicks, and it keeps
 * working when a field's control changes, because it never assumes one.
 */
export async function setObjectProp(page: Page, name: string, value: string): Promise<void> {
  return step(`set ${name} = ${value}`, () => writeObjectProp(page, name, value));
}

async function writeObjectProp(page: Page, name: string, value: string): Promise<void> {
  const row = page.locator('#p-props .pf').filter({ has: page.locator(`label[data-field="${name}"]`) }).first();
  await expect(row, `the panel offers ${name}`).toBeVisible();
  const control = row.locator('select, input[type=text], input[type=number], input[type=checkbox]').first();
  const kind = await control.evaluate((el) => `${el.tagName}:${(el as HTMLInputElement).type ?? ''}`);
  if (kind.startsWith('SELECT')) { await control.selectOption(value); return; }
  if (kind === 'INPUT:checkbox') { await control.setChecked(value === 'true'); return; }
  await control.fill(value);
  await control.dispatchEvent('change');
}

/** The simple fields the panel currently shows, by name. */
export async function objectPropValues(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const row of document.querySelectorAll('#p-props .pf')) {
      const label = row.querySelector('label');
      const c = row.querySelector('select, input') as HTMLInputElement | HTMLSelectElement | null;
      const name = label?.dataset.field;
      if (!name || !c) continue;
      out[name] = c instanceof HTMLInputElement && c.type === 'checkbox' ? String(c.checked) : c.value;
    }
    return out;
  });
}

/**
 * Point a text-file reference (a sign's message, a biography) at a file of this
 * name, creating it — the panel's "New" button and the dialog it opens.
 *
 * A campaign mission's texts live in the campaign's own text archive, not beside
 * the map, so what a reconstruction reproduces is the REFERENCE; the file it
 * creates here is the local, empty counterpart the archive supplies at runtime.
 * With `text`, the file is filled in too — which is what a sign on a map of our
 * own needs, since a reference to an empty file reads as no message at all.
 */
export async function setTextRef(page: Page, field: string, name: string, text?: string): Promise<void> {
  const row = page.locator('#p-props .pf').filter({ has: page.locator(`label[data-field="${field}"]`) }).first();
  await expect(row, `the panel offers ${field}`).toBeVisible();
  await row.locator('button', { hasText: 'New' }).first().click();
  await expect(page.locator('#objnew')).toBeVisible();
  await page.locator('#on-name').fill(name);
  await page.locator('#on-ok').click();
  await expect(page.locator('#objnew')).toBeHidden();
  // Creating one opens its text editor.
  if (text === undefined) await closeDoc(page); else await writeDoc(page, text);
}

/**
 * Open a structured field in the tree — the "Edit…" button the panel puts on a
 * row it cannot hold flat (an army, a quest, a ship tile).
 */
export async function editStruct(page: Page, field: string): Promise<void> {
  const row = page.locator('#p-props .pf').filter({ has: page.locator(`label[data-field="${field}"]`) }).first();
  await expect(row, `the panel offers ${field}`).toBeVisible();
  await row.locator('button.struct-edit').first().click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  // The deep structures are hidden until asked for, and these are deep ones.
  await page.locator('#mt-adv').setChecked(true);
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

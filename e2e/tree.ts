// Driving the schema-typed tree — the map's own settings, and an object's.
//
// The tree is the one editor that reaches everything: it walks the schema and
// the data together, so a field exists in it whether or not a curated tab shows
// it. That makes it the reconstruction's way into map settings, and it addresses
// by PATH, which is also how `npm run diff-map` reports a difference — so a gap
// report line translates into an edit without a lookup table.
//
// Every node carries its path (`data-path`, space-separated like the renderer's
// own key), so nothing here has to match on English.

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** The DOM key for a path — JSON, exactly as the renderer writes data-path. */
const key = (path: (string | number)[]): string => JSON.stringify(path);

/** Open the map-settings tree, with the advanced fields shown. */
export async function openTree(page: Page, advanced = true): Promise<void> {
  if (!(await page.locator('#maptree').isVisible())) await page.locator('#maptreebtn').click();
  await expect(page.locator('#maptree')).toBeVisible();
  await expect(page.locator('#mt-title')).toHaveText('Map tree');
  // Rare and deep structures — the RMG block, the moon calendar, the scenario
  // information — are hidden until asked for, and a mission uses them.
  await page.locator('#mt-adv').setChecked(advanced);
}

/** Expand a group if it is collapsed; its twisty says which. */
async function expand(grp: Locator): Promise<void> {
  const tw = grp.locator('> .mt-ghead > .tw').first();
  await expect(tw).toBeVisible();
  if ((await tw.textContent())?.trim() === '▸') await grp.locator('> .mt-ghead').first().click();
  await expect(tw).toHaveText('▾');
}

/**
 * Expand every group along a path, so the node at its end is on screen.
 *
 * Groups fill when they open, so this cannot be one selector: each step has to
 * exist before the next one can be found.
 */
export async function reveal(page: Page, path: (string | number)[]): Promise<Locator> {
  let at = page.locator('#maptree-body');
  for (let i = 1; i <= path.length; i++) {
    const sel = `[data-path='${key(path.slice(0, i))}']`;
    const node = at.locator(sel).first();
    await expect(node, `tree node ${key(path.slice(0, i))}`).toBeVisible();
    if (i < path.length) { await expand(node); at = node; }
    else return node;
  }
  return at;
}

/** Set a leaf value in the tree, by its path. */
export async function setTreeValue(page: Page, path: (string | number)[], value: string): Promise<void> {
  const row = await reveal(page, path);
  const control = row.locator('select, input[type=text], input[type=number], input[type=checkbox]').first();
  const kind = await control.evaluate((el) => `${el.tagName}:${(el as HTMLInputElement).type ?? ''}`);
  if (kind.startsWith('SELECT')) {
    // A dropdown of references holds the href the file will carry, and the case
    // and leading slash of one vary between editor versions — so the option is
    // matched the way the engine reads it rather than character for character.
    const exact = await control.evaluate((el, want) => {
      const norm = (v: string): string => v.toLowerCase().replace(/^\/+/, '');
      const opt = [...(el as HTMLSelectElement).options].find((o) => norm(o.value) === norm(want));
      return opt?.value ?? null;
    }, value);
    await control.selectOption(exact ?? value);
    return;
  }
  if (kind === 'INPUT:checkbox') { await control.setChecked(value === 'true'); return; }
  await control.fill(value);
  await control.dispatchEvent('change');
}

/**
 * Point a reference row at an entity, through the picker.
 *
 * A ref to a whole document — the map's ambient light, its prelight, its splash
 * picture — is not typed in: the row offers "…", which opens the list of every
 * entity of that class the installation and the map carry. That is what a person
 * uses, and it is the only control the row has.
 */
export async function pickEntityRef(page: Page, path: (string | number)[], href: string): Promise<void> {
  const row = await reveal(page, path);
  await row.locator('.mt-ref button', { hasText: '…' }).first().click();
  await expect(page.locator('#objpick')).toBeVisible();
  // The list is keyed by the href it will write, and every entry carries it as
  // its tooltip. Narrowing by the file's own name first keeps the click off a
  // list of three hundred, and the search box is what a person would use.
  const leaf = href.split('/').pop()!.replace(/\.xdb.*$/, '');
  await page.locator('#op-search').fill(leaf);
  // Matched on the tooltip rather than through a selector, so a name full of
  // brackets — RP_Prelight02(EugeneTest)_(2) — needs no quoting.
  const opts = page.locator('#op-list .op-opt');
  const has = async (): Promise<boolean> =>
    opts.evaluateAll((els, want) => els.some((e) => (e as HTMLElement).title === want), href);
  try {
    await expect.poll(has, { timeout: 30_000 }).toBe(true);
  } catch (e) {
    const sample = await opts.evaluateAll((els) => els.slice(0, 5).map((x) => (x as HTMLElement).title));
    throw new Error(`no picker entry for ${href}; ${await opts.count()} shown, e.g. ${sample.join(', ')}`);
  }
  const index = await opts.evaluateAll((els, want) =>
    els.findIndex((e) => (e as HTMLElement).title === want), href);
  await opts.nth(index).click();
  await page.locator('#op-ok').click();
  await expect(page.locator('#objpick')).toBeHidden();
}

/**
 * Point a text-file reference at a file of this name, through the row's "New".
 *
 * The dialog adopts a file that already exists rather than emptying it, so this
 * is also how an existing text — the map's own name.txt — gets referenced.
 */
export async function setTreeTextRef(page: Page, path: (string | number)[], name: string): Promise<void> {
  const row = await reveal(page, path);
  await row.locator('.mt-ref button', { hasText: 'New' }).first().click();
  await expect(page.locator('#objnew')).toBeVisible();
  await page.locator('#on-name').fill(name);
  await page.locator('#on-ok').click();
  await expect(page.locator('#objnew')).toBeHidden();
  const doc = page.locator('#docedit');
  if (await doc.isVisible()) await page.locator('#de-close').click();
}

/** The value a tree row currently shows. */
export async function treeValue(page: Page, path: (string | number)[]): Promise<string> {
  const row = await reveal(page, path);
  return row.evaluate((el) => {
    const c = el.querySelector('select, input') as HTMLInputElement | HTMLSelectElement | null;
    if (c instanceof HTMLInputElement && c.type === 'checkbox') return String(c.checked);
    if (c) return c.value;
    const ref = el.querySelector('.rv') as HTMLElement | null;
    return ref?.title ?? '';
  });
}

/** How many items a list in the tree holds. */
export async function listLength(page: Page, path: (string | number)[]): Promise<number> {
  const grp = await reveal(page, path);
  await expand(grp);
  return grp.locator('> .mt-kids > .mt-grp, > .mt-kids > .mt-item').count();
}

/**
 * Add one item to a list of STRUCTURES, through its "+ add" row.
 *
 * The item is built from the schema with its declared defaults, so this is the
 * whole of adding an objective, a player or a rumour — what follows is editing
 * the fields that differ from a fresh one.
 */
export async function addItem(page: Page, path: (string | number)[]): Promise<void> {
  const grp = await reveal(page, path);
  await expand(grp);
  const before = await listLength(page, path);
  await grp.locator('> .mt-kids > .mt-add > button').first().click();
  await expect.poll(async () => listLength(page, path), { timeout: 20_000 }).toBe(before + 1);
}

/**
 * Add one item to a list of plain VALUES, through its add row.
 *
 * The row is a text box (or a roster dropdown) and a button, because a value
 * item has nothing to build from a schema — the value IS the item.
 */
export async function addValueItem(page: Page, path: (string | number)[], value: string): Promise<void> {
  const grp = await reveal(page, path);
  await expand(grp);
  const before = await listLength(page, path);
  const add = grp.locator('> .mt-kids > .mt-add').first();
  const box = add.locator('input, select').first();
  if ((await box.evaluate((el) => el.tagName)) === 'SELECT') await box.selectOption(value);
  else await box.fill(value);
  await add.locator('button').first().click();
  await expect.poll(async () => listLength(page, path), { timeout: 20_000 }).toBe(before + 1);
}

/** The values a plain-value list currently holds. */
export async function listValues(page: Page, path: (string | number)[]): Promise<string[]> {
  const grp = await reveal(page, path);
  await expand(grp);
  return grp.locator('> .mt-kids > .mt-item > .iv').allTextContents();
}

/** Remove one item from a list, by index. */
export async function removeItem(page: Page, path: (string | number)[], index: number): Promise<void> {
  const grp = await reveal(page, path);
  await expand(grp);
  const item = grp.locator('> .mt-kids > .mt-grp, > .mt-kids > .mt-item').nth(index);
  await item.locator('.mt-x').first().click();
}

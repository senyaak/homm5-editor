// Editing a placed object: the panel, the tree, and the two fields that are not
// a text box.
//
// FIVE SPECS AND FIVE MAPS became this one. Each of them made a 72×72 of its
// own, placed one object on it and asked one question — is Amount greyed out
// until Custom is on, does the panel list a structured field, does the tree pop
// out into a window and dock back, can an army be built from the schema, can a
// town be given a specialization the map carries itself. That is one subject
// (what you can do to an object once it is on the map) and one map does for all
// of it: the objects stand well apart and every test works on its OWN.
//
// SELECTING ITS OWN is the whole care this takes. Each of the five used to reach
// for `window.view.objects()[0]`, which was right when the map held exactly one
// thing and would silently be somebody else's object here. `place()` below hands
// back the id it created, and nothing selects anything it did not place.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap, settle } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';
import { loadMap } from '../src/map/map.ts';
import { find, children, text } from '../src/format/xml.ts';
import { bar } from './bar.ts';

let ed: Launched;
const NAME = 'e2e Object Editing';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A named hero, reachable only as a bare shared definition. */
const HERO = '/MapObjects/Haven/Isabell.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

/**
 * The map, made once for the whole file.
 *
 * In the tests rather than in `beforeAll`, because Playwright restarts the
 * worker after a failed test and runs `beforeAll` again — and New Map refuses to
 * write over a map that is already there.
 */
let made = false;
async function ensureMap(): Promise<void> {
  if (made) return;
  cleanup();
  await newMap(ed.page, NAME, '72');
  await openObjectPalette(ed.page);
  made = true;
}

/** Place one object and hand back ITS id, selected and ready to edit. */
async function place(shared: string, x: number, y: number): Promise<string> {
  const { page } = ed;
  const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
  await pickObject(page, shared);
  await placeAtTile(page, x, y);
  const added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
  expect(added, `placing ${shared} added one object`).toHaveLength(1);
  const id = added[0]!.id;
  await page.evaluate((oid) => window.view.select(oid), id);
  await expect(page.locator('#panel')).toBeVisible();
  return id;
}

/** The catalogue's first entry of this engine class. */
const sharedOf = (type: string): Promise<string> => ed.page.evaluate(async (t) => {
  const { objects } = await window.editor.listObjects();
  return objects.find((o) => o.type === t)?.shared ?? '';
}, type);

/** The tree group with this name, expanded. */
async function openGroup(title: string): Promise<void> {
  const head = ed.page.locator('#maptree .mt-ghead').filter({ hasText: title }).first();
  await expect(head).toBeVisible();
  await head.click();
}

/**
 * Where each object stands. Far apart, because a town is six tiles across and
 * the editor refuses a placement that would land on something already there —
 * which would read as "the palette could not place it".
 */
const AT = {
  monster: { x: 10, y: 10 },
  garrison: { x: 22, y: 10 },
  hero: { x: 34, y: 10 },
  town: { x: 50, y: 40 },
};

// Without Custom the stack size is chosen by the map's difficulty, so the
// original greys the Amount box out; ours does the same, driven by the schema's
// x-enabledBy.
test('a monster\'s Amount is disabled until Custom is on', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await ensureMap();
  const shared = await sharedOf('AdvMapMonster');
  expect(shared, 'a monster entry exists').not.toBe('');
  await place(shared, AT.monster.x, AT.monster.y);

  const custom = page.locator('#p-props .pf', { has: page.locator('label[data-field="Custom"]') }).locator('input[type=checkbox]');
  const amount = page.locator('#p-props .pf', { has: page.locator('label[data-field="Amount"]') }).locator('input');
  await expect(custom).toBeVisible();
  await expect(amount).toBeVisible();

  // Default: Custom off → Amount disabled.
  await expect(custom).not.toBeChecked();
  await expect(amount).toBeDisabled();

  // Turn Custom on → Amount becomes editable.
  await custom.check();
  await expect(amount).toBeEnabled();

  // And off again → disabled.
  await custom.uncheck();
  await expect(amount).toBeDisabled();
});

// A garrison's army, a town's buildings, a monster's extra stacks are lists and
// sub-objects the flat panel cannot hold, so they used to appear only behind the
// "Tree…" button — which is why a garrison's army looked missing. Now the panel
// lists each structured field under a "structures" heading with a count and an
// Edit button that opens the (expandable) tree.
test('the panel shows an object\'s structured fields with Edit → tree', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await ensureMap();
  const shared = await sharedOf('AdvMapGarrison');
  expect(shared, 'a garrison entry exists').not.toBe('');
  await place(shared, AT.garrison.x, AT.garrison.y);

  // The Army row is in the panel now, under "structures", empty and editable.
  const army = page.locator('#p-props .pf', { has: page.locator('label', { hasText: /^Army$/ }) });
  await expect(army, 'the panel lists Army as a structured field').toBeVisible();
  await expect(army.locator('.rov')).toHaveText('empty');
  const edit = army.locator('button.struct-edit');
  await expect(edit).toBeVisible();

  // Edit opens the tree, expanded into the dialog, on the object's Army.
  await edit.click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  await expect(page.locator('#mt-dialog #maptree-body .mt-grp').filter({ hasText: 'Army' }).first()).toBeVisible();
  // Docked again for whoever comes next: the dialog holds #maptree itself, and
  // a test that found it in there would be reading a window nobody opened.
  await page.locator('#mt-expand').click();
  await expect(page.locator('#mt-dialog')).toBeHidden();
});

// The tree docks left at 360px; expand moves the whole #maptree element into a
// modal <dialog> for room, and collapse (or Esc) docks it back. The point of
// moving the SAME element — rather than a second copy — is that every selector
// the other tests use keeps working.
test('the object tree expands into a dialog and docks back', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await ensureMap();
  // The garrison from the test above is standing there and will do — this is
  // about the tree's window, not about what is in it.
  const id = await page.evaluate(() => window.view.objects()[0]?.id ?? '');
  expect(id, 'something is on the map to select').not.toBe('');
  await page.evaluate((oid) => window.view.select(oid), id);
  await page.locator('#p-tree').click();
  await expect(page.locator('#maptree')).toBeVisible();

  // Docked: #maptree is not inside the dialog, and the dialog is closed.
  expect(await page.locator('#mt-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  expect(await page.locator('#mt-dialog #maptree').count()).toBe(0);

  // Expand: the dialog opens and now hosts #maptree, still with its groups.
  await page.locator('#mt-expand').click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  expect(await page.locator('#mt-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
  await expect(page.locator('#mt-dialog #maptree')).toBeVisible();
  await expect(page.locator('#mt-dialog #maptree-body .mt-grp').first()).toBeVisible();

  // Collapse via the same button: docked again, dialog closed, tree still open.
  await page.locator('#mt-expand').click();
  expect(await page.locator('#mt-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  expect(await page.locator('#mt-dialog #maptree').count()).toBe(0);
  await expect(page.locator('#maptree')).toBeVisible();
});

// The property panel edits what a text box can hold. An army, a capture trigger,
// a monster's reward resources have children, and the editor for those is not a
// hand-written hero panel — it is the same schema-typed tree the map's own
// settings use, pointed at one object. The fields come from
// `src/objects.schema.json`, where `ArmySlot`, `Resources` and `Trigger` are
// declared once in `$defs` and reused by every type that has them, so what this
// really checks is that the schema drives the UI.
test('a hero army is built through the object tree, from the schema', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(300_000);
  const { page } = ed;
  await ensureMap();
  await place(HERO, AT.hero.x, AT.hero.y);

  // The tree opens on THIS object, and says so.
  await page.locator('#p-tree').click();
  await expect(page.locator('#maptree')).toBeVisible();
  await expect(page.locator('#mt-title')).toContainText('AdvMapHero');

  // Army: a list of ArmySlot, declared once in $defs and shared with the
  // garrison. Adding an item builds it from that schema.
  await openGroup('Army');
  await page.locator('#maptree .mt-add button', { hasText: 'add' }).first().click();
  // The item's own head is titled from the schema — "Army stack", the $def's
  // title — not by its index.
  await expect(page.locator('#maptree .mt-ghead').filter({ hasText: 'Army' }).first()).toContainText('(1)');
  await openGroup('Army stack');
  const slot = page.locator('#maptree .mt-grp').filter({ hasText: 'Army stack' }).first();
  // Creature is an x-registry dropdown: the roster comes from the installation,
  // not from a list in our code.
  const creature = slot.locator('select').first();
  await expect(creature).toBeEnabled({ timeout: 30_000 });
  await creature.selectOption('CREATURE_FOOTMAN');
  const count = slot.locator('input[type=number]').first();
  await count.fill('7');
  await count.dispatchEvent('change');

  await settle(page);
  await bar(page, '#save');
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  const map = loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8'));
  const hero = map.objects.find((o) => o.type === 'AdvMapHero');
  expect(hero, 'the hero is in the saved map').toBeTruthy();
  const slots = find(hero!.el, 'armySlots');
  expect(slots, 'the army list exists in the file').toBeTruthy();
  const items = children(slots!).filter((c) => c.name === 'Item');
  expect(items.length, 'one stack was added').toBe(1);
  expect(text(find(items[0]!, 'Creature')!).trim()).toBe('CREATURE_FOOTMAN');
  expect(text(find(items[0]!, 'Count')!).trim()).toBe('7');
});

// A specialization is a named town bonus. The shipped ones live in the game's
// GameMechanics/, but a map can carry its own — packed beside map.xdb and
// referenced by a relative href, the way scripts and texts are. This drives the
// panel's Specialization control: New → pick a bonus → the file is written into
// the map, and the town points at it by HREF (not text, which the game would not
// read), surviving a save.
test('create a map-local specialization and link a town to it by href', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await ensureMap();
  const shared = await sharedOf('AdvMapTown');
  expect(shared, 'a town entry exists').not.toBe('');
  await place(shared, AT.town.x, AT.town.y);

  // The Specialization row's New button opens the create dialog.
  const specRow = page.locator('#p-props .pf', { has: page.locator('label[data-field="Specialization"]') });
  await expect(specRow, 'the panel shows Specialization').toBeVisible();
  await specRow.locator('button', { hasText: 'New' }).click();

  await expect(page.locator('#specnew')).toBeVisible();
  await page.locator('#sn-name').fill('Golden');
  await page.locator('#sn-bonus').selectOption('TOWN_BONUS_250_GOLD');
  await page.locator('#sn-faction').selectOption('TOWN_HEAVEN');
  await page.locator('#sn-ok').click();
  await expect(page.locator('#specnew')).toBeHidden();

  // The row now shows the ref, relative to the map.
  await expect(specRow.locator('.rv')).toContainText('Golden.xdb#xpointer(/TownSpecialization)');

  // The specialization file is written into the map, with the chosen bonus.
  await expect(async () => {
    expect(existsSync(join(MAP_DIR, 'Golden.xdb')), 'the spec file exists').toBe(true);
  }).toPass({ timeout: 10_000 });
  const specXml = readFileSync(join(MAP_DIR, 'Golden.xdb'), 'utf8');
  expect(specXml).toContain('<TownSpecialization>');
  expect(specXml).toContain('<Bonus>TOWN_BONUS_250_GOLD</Bonus>');
  expect(specXml).toContain('<TownType>TOWN_HEAVEN</TownType>');

  // Save, then the town references it as an HREF attribute, not element text.
  if (await page.locator('#save').isEnabled()) await bar(page, '#save');
  await expect(page.locator('#save')).toBeDisabled({ timeout: 60_000 });
  const mapXml = readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8');
  expect(mapXml, 'the town points at the spec by href').toMatch(
    /<Specialization href="Golden\.xdb#xpointer\(\/TownSpecialization\)"\s*\/>/,
  );
  expect(mapXml, 'and not as element text').not.toContain('>Golden.xdb#xpointer');
});

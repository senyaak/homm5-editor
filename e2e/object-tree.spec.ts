// An object's structures are editable, through the schema.
//
// The property panel edits what a text box can hold. An army, a capture trigger,
// a monster's reward resources have children, and C1M1 needs two of them: its
// hero and its garrison each carry an army the reconstruction has to reproduce.
//
// The editor for those is not a hand-written hero panel — it is the same
// schema-typed tree the map's own settings use, pointed at one object. The
// fields come from `src/objects.schema.json`, where `ArmySlot`, `Resources` and
// `Trigger` are declared once in `$defs` and reused by every type that has them,
// so what this test really checks is that the schema drives the UI.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap, settle } from './tiles.ts';
import { pickObject, placeAtTile } from './objects.ts';
import { loadMap } from '../src/map.ts';
import { find, children, text } from '../src/xml.ts';

let ed: Launched;

const NAME = 'e2e Object Tree';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A named hero, reachable only as a bare shared definition. */
const HERO = '/MapObjects/Haven/Isabell.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

/** The tree group with this name, expanded. */
async function openGroup(page: import('@playwright/test').Page, title: string): Promise<void> {
  const head = page.locator('#maptree .mt-ghead').filter({ hasText: title }).first();
  await expect(head).toBeVisible();
  await head.click();
}

test('a hero army is built through the object tree, from the schema', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(300_000);
  const { page } = ed;

  await newMap(page, NAME, '72');
  await pickObject(page, HERO);
  await placeAtTile(page, 10, 10);
  await page.locator('#ex-list .exrow').first().click();
  await expect(page.locator('#panel')).toBeVisible();

  // The tree opens on THIS object, and says so.
  await page.locator('#p-tree').click();
  await expect(page.locator('#maptree')).toBeVisible();
  await expect(page.locator('#mt-title')).toContainText('AdvMapHero');

  // Army: a list of ArmySlot, declared once in $defs and shared with the
  // garrison. Adding an item builds it from that schema.
  await openGroup(page, 'Army');
  await page.locator('#maptree .mt-add button', { hasText: 'add' }).first().click();
  // The item's own head is titled from the schema — "Army stack", the $def's
  // title — not by its index.
  await expect(page.locator('#maptree .mt-ghead').filter({ hasText: 'Army' }).first()).toContainText('(1)');
  await openGroup(page, 'Army stack');
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
  await page.locator('#save').click();
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

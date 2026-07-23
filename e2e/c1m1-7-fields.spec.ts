// C1M1 stage 7 — what the placed objects actually are.
//
// Placement said where things stand; this says what they hold: how many peasants
// guard the bridge, whether they will join you, which sign carries which text,
// what the hero's army is. 42 of the 2645 objects carry a value that differs
// from the default their type is placed with — the forest does not.
//
// Every field goes in through the property panel, and the panel's controls come
// from the schema (`src/objects.schema.json`): an enum becomes a dropdown of the
// values the game's own spec allows, a boolean a checkbox, a registry field a
// roster picker. Structures — the hero's and the garrison's armies — have no
// honest text box, so they go through the object tree, which is the same
// renderer reading the same schema, where `ArmySlot` is declared once in `$defs`
// and shared by both types.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { setObjectProp, setTextRef, sharedKey } from './objects.ts';
import { MAP_DIR, FIXTURE, openMap, requireFixture } from './c1m1.ts';
import { loadMap } from '../src/map.ts';
import type { MapObject } from '../src/map.ts';
import { children, find, text } from '../src/xml.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** Fields whose value is placement, identity or ours by design. */
const NOT_A_FIELD = new Set(['Pos', 'Rot', 'Floor', 'Shared']);

/** Where the original is silent and our donor is newer — see the doc. */
const DONOR_EXTRA = new Set(['TerrainAligned', 'ScalePercent', 'PresetPrice', 'TownType',
  'DoesNotDependOnDifficulty', 'SingleMonsterNameFileRef', 'MultipleMonstersNameFileRef',
  'RacesRandomGroupID']);

/** An object's simple fields as a plain map. */
const propsOf = (o: MapObject): Map<string, string> =>
  new Map(o.props().filter((p) => !NOT_A_FIELD.has(p.name)).map((p) => [p.name, p.value]));

/** The army stacks an object carries, as [creature, count] pairs. */
function armyOf(o: MapObject): [string, string][] {
  const slots = find(o.el, 'armySlots');
  if (!slots) return [];
  return children(slots).filter((c) => c.name === 'Item').map((it) => [
    text(find(it, 'Creature') ?? it).trim(),
    text(find(it, 'Count') ?? it).trim(),
  ]);
}

test('C1M1 object fields, set in the panel and the object tree', async () => {
  requireFixture();
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const original = loadMap(readFileSync(join(FIXTURE, '..', 'C1M1.xdb'), 'utf8'));
  await openMap(page);

  // Match the original's objects to the ones on the map, the way diff-objects
  // does: by what they are and where they stand. Placement (stage 6) has already
  // made that exact, so nearest-of-its-kind is unambiguous here.
  const live = await page.evaluate(() => window.view.objects());
  const pool = new Map<string, typeof live>();
  for (const o of live) {
    const k = sharedKey(o.shared);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(o);
  }
  const pairs: { id: string; want: MapObject }[] = [];
  for (const t of original.objects) {
    const cands = pool.get(sharedKey(t.shared ?? '')) ?? [];
    let best = -1, bestD = Infinity;
    cands.forEach((c, i) => {
      const d = Math.hypot(c.x - t.pos!.x, c.y - t.pos!.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > 0.01) continue;
    pairs.push({ id: cands.splice(best, 1)[0]!.id, want: t });
  }
  expect(pairs.length, 'every object of the original was found on the map').toBe(original.objects.length);

  // --- the simple fields ---
  let touched = 0, setCount = 0;
  const started = Date.now();
  for (const { id, want } of pairs) {
    await page.evaluate((i) => window.view.select(i), id);
    await expect(page.locator('#panel')).toBeVisible();
    // The panel loads its fields asynchronously; without waiting for the object
    // it is showing, the first row read could belong to the previous selection.
    await expect(page.locator('#p-id')).toHaveText(id.replace('item_', '').slice(0, 8));
    // The rows arrive after their own round trip (the field list AND the game's
    // allowed values for its enums). Reading before they land looks exactly like
    // an object whose fields are all already right, and silently skips it — 9 of
    // 42 objects on the first run.
    await expect(page.locator('#p-props .pf').first()).toBeVisible();
    const values = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const row of document.querySelectorAll('#p-props .pf')) {
        const label = row.querySelector('label');
        // The field's own name — the tooltip also carries its description.
        const name = (label as HTMLLabelElement | null)?.dataset.field;
        if (!name) continue;
        const c = row.querySelector('select, input') as HTMLInputElement | HTMLSelectElement | null;
        if (!c) {
          // A reference row has no input: it shows the file it points at.
          const ref = row.querySelector('.rv') as HTMLElement | null;
          if (ref) out[name] = ref.title;
          continue;
        }
        out[name] = c instanceof HTMLInputElement && c.type === 'checkbox' ? String(c.checked) : c.value;
      }
      return out;
    });
    let did = false;
    // A text-file reference is not a value the panel types: it names a file, so
    // it gets created and referenced rather than filled in.
    for (const [name, value] of propsOf(want)) {
      if (!/FileRef$/.test(name) || !value) continue;
      if (values[name] === value) continue;
      await setTextRef(page, name, value);
      setCount++; did = true;
    }
    for (const [name, value] of propsOf(want)) {
      if (/FileRef$/.test(name)) continue;
      if (DONOR_EXTRA.has(name)) continue;
      // The original leaves 2640 of its objects nameless; ours name themselves,
      // deliberately (a nameless object is one no script can address). Clearing
      // that would be reproducing an absence we chose not to have.
      if (name === 'Name' && !value) continue;
      if (values[name] === undefined) continue; // a field the panel cannot offer
      if (values[name] === value) continue;
      await setObjectProp(page, name, value);
      setCount++; did = true;
    }
    if (did) touched++;
  }
  console.log(`fields: ${setCount} values set on ${touched} of ${pairs.length} objects`
    + ` in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  // --- the armies, through the object tree ---
  //
  // A hero and a garrison, four stacks between them. The tree builds each item
  // from the ArmySlot $def, so what is typed here is a creature and a count.
  /** Expand a tree group if it is collapsed — its twisty says which. */
  const expand = async (grp: import('@playwright/test').Locator): Promise<void> => {
    const tw = grp.locator('.mt-ghead .tw').first();
    await expect(tw).toBeVisible();
    if ((await tw.textContent())?.trim() === '▸') await grp.locator('.mt-ghead').first().click();
    await expect(tw).toHaveText('▾');
  };

  let stacks = 0;
  for (const { id, want } of pairs) {
    const army = armyOf(want);
    if (!army.length) continue;
    await page.evaluate((i) => window.view.select(i), id);
    await page.locator('#p-tree').click();
    await expect(page.locator('#maptree')).toBeVisible();
    const list = page.locator('#maptree > #maptree-body > .mt-grp').filter({ hasText: 'Army' }).first();
    await expand(list);
    // Add the stacks that are missing; a re-run finds them already there.
    const slots = list.locator('> .mt-kids > .mt-grp');
    for (let have = await slots.count(); have < army.length; have++) {
      await list.locator('.mt-add button').first().click();
      await expand(list);
    }
    for (let i = 0; i < army.length; i++) {
      const slot = slots.nth(i);
      await expand(slot);
      const creature = slot.locator('select').first();
      await expect(creature).toBeEnabled({ timeout: 30_000 });
      await creature.selectOption(army[i]![0]);
      const count = slot.locator('input[type=number]').first();
      await count.fill(army[i]![1]);
      await count.dispatchEvent('change');
      stacks++;
    }
    await page.locator('#mt-close').click();
  }
  console.log(`  ${stacks} army stack(s) set through the tree`);

  // --- what landed in the file ---
  await settle(page);
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 300_000 });

  const built = loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8'));
  const mine = new Map<string, MapObject[]>();
  for (const o of built.objects) {
    const k = sharedKey(o.shared ?? '');
    if (!mine.has(k)) mine.set(k, []);
    mine.get(k)!.push(o);
  }
  const wrong: string[] = [];
  for (const t of original.objects) {
    const cands = mine.get(sharedKey(t.shared ?? '')) ?? [];
    let best = -1, bestD = Infinity;
    cands.forEach((c, i) => {
      const d = Math.hypot(c.pos!.x - t.pos!.x, c.pos!.y - t.pos!.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) { wrong.push(`${t.type} at (${t.pos!.x}, ${t.pos!.y}) is missing`); continue; }
    const got = cands.splice(best, 1)[0]!;
    const gv = propsOf(got);
    for (const [name, value] of propsOf(t)) {
      if (DONOR_EXTRA.has(name)) continue;
      if (name === 'Name' && !value) continue; // ours by design, see above
      const ours = gv.get(name);
      if (ours === undefined) { wrong.push(`${t.type}.${name} is absent (wanted "${value}")`); continue; }
      // Case and leading slash of a reference vary; the target does not.
      const same = /ref$/i.test(name) ? ours.toLowerCase().endsWith(value.toLowerCase()) : ours === value;
      if (!same) wrong.push(`${t.type} at (${t.pos!.x}, ${t.pos!.y}): ${name} is "${ours}", wanted "${value}"`);
    }
    const wantArmy = armyOf(t), gotArmy = armyOf(got);
    if (JSON.stringify(wantArmy) !== JSON.stringify(gotArmy)) {
      wrong.push(`${t.type} army is ${JSON.stringify(gotArmy)}, wanted ${JSON.stringify(wantArmy)}`);
    }
  }
  expect(wrong.slice(0, 12), `fields that differ (${wrong.length})`).toEqual([]);
});

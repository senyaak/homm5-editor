// Every building the mod carries, in the corner nothing else uses.
//
// Placing one is the other half of making one: the palette has to offer it, its
// footprint has to be a real size, and a row of them has to lay out without
// landing on each other. One of every class is the widest sweep of the placement
// path there is.
//
// On THIS map and not one of their own, because a map is only a test if it can
// be walked into: a blank map with buildings and no player the game will not
// even load. Here there is a town, three heroes and an opponent, and the bottom-
// left corner is empty — everything the map is made of sits between rows 37 and
// 47. Eight tiles apart is wider than anything placed here, so each keeps clear
// ground and an entrance a hero can reach.
//
// Standing there is not the same as WORKING, and the difference is the
// placement: the shrine teaches the spell its placement names, the sign shows
// the file its placement points at, the seer hut asks the errand its placement
// carries, and the shipyard launches into the tile its placement offsets to.
// Walked around in the game, all four were silent — three of them because those
// fields were empty and one because the map had no water in it at all. So this
// fills them in and digs a bay, and then reads the map back to see it.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hudSays } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { armBrush, clickTile, planView } from '../tiles.ts';
import { pickObject, setObjectProp, sharedKey } from '../objects.ts';
import { parseTerrain, readGroundFlags, tierOf } from '../../src/terrain/terrain.ts';
import { readEntries } from '../../src/format/pak.ts';
import { readInstalledMod } from '../mods.ts';
import { bar } from '../bar.ts';
import {
  ARCHIVE, BASIN, GAME, MAP_DIR, NAME, NEEDS, QUEST, SHIPYARD_AT, SHIPYARD_CLASS,
  SHIP_OFFSET, SIGN_TEXT, blockOf, cleanup, decode, fillPlacement, openSharp,
  placeOne, startSharp,
} from './shared.ts';

let ed: Launched;

test.beforeAll(async () => {
  ed = await startSharp();
  await openSharp(ed);
});
test.afterAll(async () => { await ed?.app.close(); });

test('every building the mod carries stands in its empty corner', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  // The buildings come from mod-005; the fixture this stage installs on its own
  // carries only the palace. Run alone, there is nothing here to place — and
  // saying so is better than failing a map spec over a stage that did not run.
  const buildings = readInstalledMod(GAME).buildings ?? [];
  test.skip(buildings.length < 2, 'no buildings installed — run mod-005 first');

  // What the map already has — the palace among it, placed by 001. Placing a
  // second one would be a duplicate rather than a check.
  const already = new Set((await page.evaluate(() => window.view.objects()))
    .map((o) => (o.shared ? sharedKey(o.shared) : ''))
    .filter(Boolean));
  const todo = buildings.filter((b) => !already.has(sharedKey(`/Buildings/${b.file}/${b.file}.(${b.className}).xdb`)));
  expect(todo.length, 'something left to place').toBeGreaterThan(0);

  // The sea first: the shipyard is placed against it, and digging under a
  // building that is already there would leave it standing on a cliff.
  await test.step('a bay for the shipyard', async () => {
    await planView(page);
    await armBrush(page, 'lower', '7');
    for (const [x, y] of BASIN) await clickTile(page, x, y);
    await page.locator('#brushbtn').click(); // clicks belong to objects again
    await expect(page.locator('#brushbtn')).toHaveText('off');
  });

  const STEP = 8, COLUMNS = 5, FIRST = { x: 6, y: 48 };
  const placed: string[] = [];
  let slot = 0;
  for (const b of todo) {
    const at = b.className === SHIPYARD_CLASS
      ? SHIPYARD_AT
      : { x: FIRST.x + (slot % COLUMNS) * STEP, y: FIRST.y + Math.floor(slot++ / COLUMNS) * STEP };
    await test.step(`${b.file} at ${at.x}:${at.y}`, async () => {
      const shared = `/Buildings/${b.file}/${b.file}.(${b.className}).xdb`;
      // A building the palette cannot find is one nobody can place, however well
      // it was built — so this arms it the way a person would.
      await pickObject(page, shared);
      // placeOne fails when nothing went down, and the editor refuses a
      // placement that would land on something already there — so a refusal
      // here IS the overlap check.
      await placeOne(page, shared, at.x, at.y);
      // What the CLASS needs from its placement. A shrine teaches the spell its
      // placement names and a sign shows the text its placement points at, so
      // one left at SPELL_NONE or at no file is a building that stands there and
      // does nothing — measured in the game, see BUILDINGS.md §3. The map is
      // meant to be walked around, so they are filled in.
      for (const [field, value] of Object.entries(NEEDS[b.className] ?? {})) {
        await setObjectProp(page, field, value);
      }
      await fillPlacement(page, b.className);
      placed.push(b.file);
    });
  }
  expect(placed).toHaveLength(todo.length);

  await bar(page, '#save');
  await hudSays(page, /saved/i, 60_000);
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(placed.filter((file) => !xml.includes(`/Buildings/${file}/`)),
    'buildings the saved map does not name').toEqual([]);

  // --- and the three whose behaviour lives on the placement --------------
  //
  // Checked in the file the game reads, not in the panel that wrote it: all
  // three came out silent the first time this map was walked around, and each
  // was silent for its own reason (BUILDINGS.md §3).
  await test.step('the sign has words', () => {
    const href = /<MessageFileRef href="([^"]+)"\/>/.exec(blockOf(xml, 'AdvMapSign'))?.[1];
    expect(href, 'the sign points at a text file').toBeTruthy();
    // Map-relative, like every message the shipped maps carry.
    expect(decode(readFileSync(join(MAP_DIR, href!)))).toBe(SIGN_TEXT);
  });

  await test.step('the seer hut has an errand', () => {
    const quest = blockOf(xml, 'AdvMapSeerHut');
    expect(quest).toContain(`<Name>${QUEST.name}</Name>`);
    expect(quest).toContain(`<Kind>${QUEST.kind}</Kind>`);
    // A resource index and an amount, in that order — the Kind's own reading.
    for (const p of QUEST.parameters) expect(quest).toContain(`<Item>${p}</Item>`);
    expect(quest, 'an award that is not AWARD_NONE').toContain(`<Type>${QUEST.award}</Type>`);
    expect(quest).toContain(`<Experience>${QUEST.experience}</Experience>`);
    for (const ref of ['CaptionFileRef', 'DescriptionFileRef']) {
      const href = new RegExp(`<${ref} href="([^"]*)"`).exec(quest)?.[1];
      expect(href, `the quest's ${ref}`).toBeTruthy();
      expect(existsSync(join(MAP_DIR, href!)), `${href} is beside the map`).toBe(true);
    }
  });

  await test.step('the shipyard has water to launch into', () => {
    const yard = blockOf(xml, 'AdvMapShipyard');
    const ship = /<ShipTile>\s*<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/.exec(yard);
    expect(ship, 'the shipyard names a ship tile').toBeTruthy();
    expect([+ship![1]!, +ship![2]!]).toEqual([SHIP_OFFSET.x, SHIP_OFFSET.y]);
    // The offset is only half of it: the tile it lands on has to BE water, and
    // a tile is water when all four of its corners are.
    const t = parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin')));
    const flags = readGroundFlags(t);
    expect(flags, 'the map carries a ground-kind plane').toBeTruthy();
    const at = { x: SHIPYARD_AT.x + SHIP_OFFSET.x, y: SHIPYARD_AT.y + SHIP_OFFSET.y };
    const dry: string[] = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = (at.y + dy!) * t.V + (at.x + dx!);
      if (tierOf(flags![i]!) !== 0) dry.push(`${at.x + dx!},${at.y + dy!}`);
    }
    expect(dry, `corners of ${at.x},${at.y} the Lower brush left dry`).toEqual([]);
  });

  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  const names = readEntries(readFileSync(ARCHIVE)).map((e) => e.name.replace(/\\/g, '/'));
  // The lobby indexes tags, so a map without one is packed and not on the menu.
  expect(names.some((n) => n.endsWith(`Maps/SingleMissions/${NAME}/map-tag.xdb`))).toBe(true);

  // The whole stage converged — leave nothing behind.
  cleanup();
});

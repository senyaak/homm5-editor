// The additions that turn the rebuilt map into a proving ground.
//
// The map has held against the original by 001, so what follows is ADDED to it
// on purpose: a hero the game does not ship, standing on a map through the
// same palette every other object came from, and the stones and stacks that
// make the map a test bed for anything that depends on a hero's LEVEL or on
// his army taking damage (see shared.ts on why they are generated rather than
// added by hand). A hero authored by mod-004 is an object like any other from
// here on — the palette finds him because a mod is a mounted root the way the
// data folder is.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hudSays } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { planView } from '../tiles.ts';
import { pickObject, setObjectProp } from '../objects.ts';
import { addItem, setTreeValue } from '../tree.ts';
import { readEntries } from '../../src/format/pak.ts';
import { bar } from '../bar.ts';
import {
  ARCHIVE, FOES, GEM, GEM_ARMY, GEM_AT, MAP_DIR, SHARPSHOOTER, STONE, STONES,
  openSharp, placeOne, startSharp,
} from './shared.ts';

let ed: Launched;

test.beforeAll(async () => {
  ed = await startSharp();
  await openSharp(ed);
});
test.afterAll(async () => { await ed?.app.close(); });

test('Gem stands on it, in red', async () => {
  test.setTimeout(2 * 60_000);
  const { page } = ed;

  await pickObject(page, GEM);
  const id = await placeOne(page, GEM, GEM_AT.x, GEM_AT.y);
  await setObjectProp(page, 'PlayerID', 'PLAYER_1');
  void id;

  // And an army, through the same structured Army row the other three heroes
  // use. Not decoration: a hero with a first aid tent and nothing to heal
  // cannot answer any question this map exists to ask, and the stacks the next
  // test puts along the bottom are there to be fought.
  const army = page.locator('#p-props .pf', { has: page.locator('label', { hasText: /^Army$/ }) });
  await army.locator('button.struct-edit').click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  for (let slot = 0; slot < GEM_ARMY.length; slot++) {
    await addItem(page, ['armySlots']);
    await setTreeValue(page, ['armySlots', slot, 'Creature'], SHARPSHOOTER);
    await setTreeValue(page, ['armySlots', slot, 'Count'], String(GEM_ARMY[slot]));
  }
  await page.locator('#mt-close').click();
  await expect(page.locator('#mt-dialog')).toBeHidden();

  await bar(page, '#save');
  await hudSays(page, /saved/i, 60_000);

  // On disk, in the map the game will read: our hero, owned by red.
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xml, 'the map references the hero the mod installed').toContain(GEM);
  // Her own <AdvMapHero> block and nobody else's: split on the element, keep
  // the piece that names her. A regex spanning "…H3Gem…</AdvMapHero>" would
  // happily start at the hero before her and still match.
  const gem = xml.split('<AdvMapHero>').find((part) => part.includes('H3Gem')) ?? '';
  expect(gem, 'the placed hero is red').toContain('<PlayerID>PLAYER_1</PlayerID>');
  expect((gem.match(new RegExp(`<Creature>${SHARPSHOOTER}</Creature>`, 'g')) ?? []).length,
    'and she has an army to lose').toBe(GEM_ARMY.length);

  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  const packed = readEntries(readFileSync(ARCHIVE))
    .find((e) => e.name.replace(/\\/g, '/').endsWith('map.xdb'))!;
  expect(packed.data.toString('latin1'), 'the packed map carries her too').toContain('H3Gem');
});

test('and a proving ground for her: stones to level on, enemies to fight', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  // Plan view for the same reason the passability stroke uses it: at oblique
  // angles the projection and the picking ray can disagree by a tile, and
  // clickTile rightly refuses a click that would land on the wrong one.
  await planView(page);

  for (const [x, y] of STONES) {
    await pickObject(page, STONE);
    await placeOne(page, STONE, x, y);
  }

  for (const f of FOES) {
    await pickObject(page, f.shared);
    await placeOne(page, f.shared, f.x, f.y);
    // The same four the original's own stacks carry: a fixed count that does
    // not grow week to week, and a stack that never offers to join — a test bed
    // whose numbers drift is a test bed that answers a different question every
    // time it is walked into.
    await setObjectProp(page, 'Custom', 'true');
    await setObjectProp(page, 'Amount', String(f.amount));
    await setObjectProp(page, 'DoesNotGrow', 'true');
    await setObjectProp(page, 'Courage', 'MONSTER_COURAGE_ALWAYS_FIGHT');
  }

  await bar(page, '#save');
  await hudSays(page, /saved/i, 60_000);

  // Read back off the file the game reads, not off the panel that wrote it.
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  const stones = (xml.match(/Learning_Stone/g) ?? []).length;
  expect(stones, 'every stone is in the saved map').toBe(STONES.length);
  // Each stack by its own definition: ten stacks of one creature would place
  // and save just as happily, and prove nothing about the ladder.
  const missing = FOES.filter((f) => !xml.includes(f.shared)).map((f) => f.shared);
  expect(missing, 'stacks the saved map does not name').toEqual([]);
  // And the amounts really landed — `Custom` false would leave the game to roll
  // its own number, which is the quiet way a fixed test bed stops being one.
  //
  // Asked as "SOME block carries both", not "the block naming this creature":
  // the map already has two Peasant stacks of the original's, so the first
  // block naming a Peasant is one of THEIRS, at their count. That read as our
  // stack having the wrong amount.
  const blocks = xml.split('<AdvMapMonster>');
  for (const f of FOES) {
    const ours = blocks.some((b) => b.includes(f.shared)
      && b.includes('<Custom>true</Custom>')
      && b.includes(`<Amount>${f.amount}</Amount>`));
    expect(ours, `a custom stack of ${f.amount} × ${f.shared}`).toBe(true);
  }

  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  const packed = readEntries(readFileSync(ARCHIVE))
    .find((e) => e.name.replace(/\\/g, '/').endsWith('map.xdb'))!;
  expect((packed.data.toString('latin1').match(/Learning_Stone/g) ?? []).length,
    'and the packed map carries them too').toBe(STONES.length);
});

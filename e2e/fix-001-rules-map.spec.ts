// Stage 001 of the rules chain: build the Rules Test map, with every fix OFF.
//
// The map is the CONSTANT of a two-run experiment — see e2e/fixes.ts for why it
// is two runs, and docs/FIX_TEST_MAP.md for what to do with each hero once the
// game is open. What this stage guarantees is that the map exists in the
// install, that every hero really carries the kit the plan gives him, and that
// the extension is loaded with no fix turned on. Play it and every bug below is
// the shipped game's own.
//
// Built through the app, not by writing XML: the map has to be one the editor
// itself produces, or the next run of this stage against a changed editor would
// not be the same map.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { closeEditor, hudSays, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { pickObject, placeAtTile } from './objects.ts';
import { mapComplaints } from './map-checks.ts';
import { readEntries } from '../src/format/pak.ts';
import {
  DEATH_RIPPLE, LIVE, MOD, OUR_SPELL_FIXTURES, TEST_ARMAGEDDON, TEST_ARMAGEDDON_AREA,
  TEST_ARMAGEDDON_TARGET, clearMap, installSpellFixture, prepareGameRoot,
} from './mods.ts';
import { EFFECTS_FILE, readSpellRows } from '../src/mods/artifact-effects.ts';
import { SHIPPED_SPELLS, spellPaths } from '../src/mods/spells.ts';
import { modFile } from '../src/game/mod-paths.ts';
import {
  ARCHIVE, DATA, FIXES_UNDER_TEST, GAME, HEROES, MAP_DIR, NAME, OPPONENT, OVERRIDE_ALL, PLAYERS,
  TILES,
} from './fixes.ts';
import type { Kit } from './fixes.ts';

let ed: Launched;

test.beforeAll(async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  // A map is a file in an install, so there has to be one to pack into.
  //
  // ISOLATED, that install is built from nothing. LIVE, it is the real one and
  // is left alone: `prepareGameRoot` DELETES what it prepares and refuses
  // anything outside `_tmp` for exactly that reason, so live only checks that
  // there is a game there — the extension is refreshed by the panel's Apply at
  // the end of this test, which is the door a person uses anyway.
  if (LIVE) {
    expect(existsSync(join(GAME, 'bin', 'H5_Game.exe')), `no game at ${GAME}`).toBeTruthy();
  } else {
    await prepareGameRoot(GAME);
  }
  // The spells of ours, INTO THE INSTALL FIRST. A hero's `Editable/spells` names
  // one by id, and an id types.xml does not declare is a map the game refuses
  // to load — not a hero missing a spell. So the mod that declares them is
  // installed before anything is built, and it adds to whatever the archive
  // already holds rather than replacing it.
  installSpellFixture(GAME);
  // Both halves: New Map refuses to write over a packed map that is already
  // there, so a second run would stop before it started.
  clearMap(GAME, DATA, NAME);
  rmSync(MAP_DIR, { recursive: true, force: true });
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { if (ed) await closeEditor(ed); });

/**
 * Place one object THROUGH THE PALETTE, and hand back the id the map gave it.
 *
 * Arm a swatch, click the map — which is the only way that proves anything.
 * Calling `addObject` with a path typed out here builds a map by a route no
 * person takes, and the first attempt did exactly that: every `Shared` href
 * went in without its `#xpointer(/…Shared)` fragment, the game could resolve
 * none of the records, and both players owned nothing. The palette's own hrefs
 * carry the fragment, so armed from the catalogue it cannot be got wrong.
 */
async function place(page: Launched['page'], shared: string, x: number, y: number): Promise<string> {
  // Clicked up to three times, because the click sometimes lands on nothing.
  // `placeAtTile` projects the tile and, when a panel covers the pixel, centres
  // the view and projects again — and the projection is read in the same breath
  // as the camera is moved, so a camera that has not finished moving yields a
  // pixel that belongs to another tile. It places nothing and says nothing,
  // since a click on empty ground is not an error. It showed up as one run in
  // three failing on a stack that had gone down a hundred times before.
  //
  // A bounded retry, not a loop: three misses in a row is a real failure and is
  // reported as one, and two objects appearing from one click would be caught
  // here too rather than quietly making a map nobody asked for.
  let added: { id: string }[] = [];
  for (let attempt = 1; attempt <= 3 && added.length !== 1; attempt++) {
    await pickObject(page, shared);
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    await placeAtTile(page, x, y);
    added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
    // Two from one click is a fault, not something to try again past.
    expect(added.length, `one click on ${x},${y} put down ${added.length} objects`).toBeLessThan(2);
  }
  expect(added, `placing ${shared} at ${x},${y} put down one object, in three tries`)
    .toHaveLength(1);
  const id = added[0]!.id;
  await page.evaluate((oid) => window.view.select(oid), id);
  return id;
}

const setPath = (page: Launched['page'], id: string, path: (string | number)[], value: string) =>
  page.evaluate((p) => window.editor.setObjectPath({ id: p.id, path: p.path, value: p.value }),
    { id, path, value });

const addItem = (page: Launched['page'], id: string, path: (string | number)[], value?: string) =>
  page.evaluate((p) => window.editor.addObjectItem({ id: p.id, path: p.path, value: p.value }),
    { id, path, value });

/** A hero, his kit, and the stack he is standing in front of. */
async function placeHero(page: Launched['page'], kit: Kit, player: string): Promise<string> {
  const id = await place(page, kit.shared, kit.at.x, kit.at.y);
  await setPath(page, id, ['PlayerID'], player);
  // Named, so a script or a later stage can address him, and so the checklist
  // and the map agree on what to call him.
  await setPath(page, id, ['Name'], kit.key);
  // Without the mask the game reads the shared hero and none of this.
  await setPath(page, id, ['OverrideMask'], String(OVERRIDE_ALL));

  for (const [i, s] of (kit.skills ?? []).entries()) {
    await addItem(page, id, ['Editable', 'skills']);
    await setPath(page, id, ['Editable', 'skills', i, 'SkillID'], s.id);
    await setPath(page, id, ['Editable', 'skills', i, 'Mastery'], s.mastery);
  }
  for (const perk of kit.perks ?? []) await addItem(page, id, ['Editable', 'perkIDs'], perk);
  for (const spell of kit.spells ?? []) await addItem(page, id, ['Editable', 'spellIDs'], spell);
  for (const [i, stack] of kit.army.entries()) {
    await addItem(page, id, ['armySlots']);
    await setPath(page, id, ['armySlots', i, 'Creature'], stack.creature);
    await setPath(page, id, ['armySlots', i, 'Count'], String(stack.count));
  }
  const st = kit.stats ?? {};
  if (st.offence !== undefined) await setPath(page, id, ['Editable', 'Offence'], String(st.offence));
  if (st.defence !== undefined) await setPath(page, id, ['Editable', 'Defence'], String(st.defence));
  if (st.spellpower !== undefined) await setPath(page, id, ['Editable', 'Spellpower'], String(st.spellpower));
  if (st.knowledge !== undefined) await setPath(page, id, ['Editable', 'Knowledge'], String(st.knowledge));
  if (kit.ballista) await setPath(page, id, ['Editable', 'Ballista'], 'true');

  if (kit.foe) {
    const foe = await place(page, kit.foe.shared, kit.foe.at.x, kit.foe.at.y);
    // A stack is written `Custom false` and the game rolls its own number for
    // it. That is fine for something to hit and no good when the stack has to
    // SURVIVE a spell and be read afterwards — so a kit that names a count
    // says so, and both halves have to be set for either to mean anything.
    if (kit.foe.count) {
      await setPath(page, foe, ['Custom'], 'true');
      await setPath(page, foe, ['Amount'], String(kit.foe.count));
    }
  }
  if (kit.artifact) await place(page, kit.artifact.shared, kit.artifact.at.x, kit.artifact.at.y);
  for (const b of kit.nearby ?? []) await place(page, b.shared, b.at.x, b.at.y);
  return id;
}

/**
 * The player's starting position, as the shipped maps write it.
 *
 * `MainHero` points INTO the map — at the `<Item id="item_…">` wrapping a hero
 * that is standing on it — not at a hero file. Across the shipped missions the
 * first player always has one of these or a `MainTown`, and the others often
 * have neither, which is what "Start player does not exist on map" is about: the
 * player the map starts as has nowhere to start.
 */
const mainHeroRef = (id: string): string => `#xpointer(id(${id})/AdvMapHero)`;

// NOT `@nodata`, though it was tagged that way for a while and should not have
// been: it reads the game's own skill and creature tables and its MapObjects,
// and this file's `beforeAll` copies an executable before any of it runs. The
// data-free door to these questions is `npm run test-fix-map`, which needs no
// install and no fixture; this one is the gate in front of the build.
test('the map spec is one the game can build', () => {
  // The last gate before an evening is spent on it. Every failure this catches
  // is SILENT — a perk the hero does not qualify for is dropped without a word,
  // the map is written, it loads, and the hero simply does not have it. That is
  // what happened: the warlock was given Payback with no Dark Magic to hang it
  // on, and it cost a whole play-through to notice.
  //
  // The questions live in `map-checks.ts` and are asked in `npm test` too,
  // where they cost a second and need neither an install nor this fixture. This
  // is the second door, not the only one.
  expect(mapComplaints(DATA), 'the game\'s own files say otherwise').toEqual([]);
});

// The one part of a spell of ours that does NOT travel in the archive, asserted
// where it lands. `installSpellFixture` above writes it; without the row the
// ripple is cast, the engine deals its damage, and the undead take it too —
// which reads as the spell being wrong rather than as a line that was not
// written. Checked in the install, by the number, because that is what both the
// engine and the extension go by.
test('the spells of ours carry their row into the install', () => {
  const rows = readSpellRows(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'));
  const ripple = rows.find((f) => f.spell === SHIPPED_SPELLS);
  expect(ripple, `${DEATH_RIPPLE.id} has a row in ${EFFECTS_FILE}`).toBeTruthy();
  expect(ripple!.spares, 'and it spares the undead, the elemental and the mechanical')
    .toEqual([10, 12, 9]);
  // And the other half of the same row: what the area one covers. Its shape has
  // nowhere else to live — the document says a spell hits an AREA and never
  // which, and the shape a number of ours would fall to covers nothing at all.
  const area = rows.find((f) => f.spell === SHIPPED_SPELLS + 2);
  expect(area, `${TEST_ARMAGEDDON_AREA.id} has a row too`).toBeTruthy();
  expect(area!.area, 'and it is the cross the fixture drew')
    .toEqual(TEST_ARMAGEDDON_AREA.area);
});

// AND THE SHAPE, WHICH IS THE OTHER THING THE DOCUMENT DECIDES.
//
// The extension picks which of the engine's three damage branches a cast of ours
// jumps into from these two flags and nothing else — so a document that writes
// them wrong is a spell of the wrong shape, and it is wrong SILENTLY: the cast
// goes through, something is damaged, and only what got hit says which branch
// ran. Asserted in the archive the game reads, not in the fixture that wrote it.
test('each spell of ours carries the two flags that pick its shape', () => {
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD)));
  for (const spec of OUR_SPELL_FIXTURES) {
    const want = spellPaths(spec).document.replace(/\\/g, '/');
    const entry = entries.find((e) => e.name.replace(/\\/g, '/') === want);
    expect(entry, `the archive carries ${want}`).toBeTruthy();
    const doc = entry!.data.toString('latin1');
    expect(doc, `${spec.id} is aimed: ${!!spec.aimed}`)
      .toContain(`<IsAimed>${!!spec.aimed}</IsAimed>`);
    expect(doc, `${spec.id} hits an area: ${!!spec.areaAttack}`)
      .toContain(`<IsAreaAttack>${!!spec.areaAttack}</IsAreaAttack>`);
  }
  // And the three Armageddons really are one spell three ways — if they differed
  // in anything else, a battle would not be telling us about the shape.
  const [area, target] = [TEST_ARMAGEDDON_AREA, TEST_ARMAGEDDON_TARGET];
  for (const twin of [area, target]) {
    for (const field of ['level', 'manaCost', 'school', 'element', 'damage', 'visuals', 'icon'] as const) {
      expect(JSON.stringify(twin[field]), `${twin.id} keeps Armageddon's ${field}`)
        .toBe(JSON.stringify(TEST_ARMAGEDDON[field]));
    }
  }
});

test('the Rules Test map is built and packed, with every fix off', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  // --- a new map, through its own dialog ---
  await bar(page, '#newmapbtn');
  await page.locator('#nm-name').fill(NAME);
  // A Multiplayer Arena: the type IS the folder the map is packed into, and the
  // game only offers a map for hotseat from under Maps/Multiplayer. It still
  // plays single-player against the computer for the rest of the list.
  await page.locator('#nm-type').selectOption('multi');
  await page.locator('#nm-size').selectOption(String(TILES));
  await page.locator('#nm-ok').click();
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });

  // --- the players the map is for ---
  //
  // A new map's eight slots are all off, and a hero owned by PLAYER_1 does not
  // turn one on: the object says who owns it, the slot says whether that owner
  // exists. Without this the game offers nothing to start the map as.
  for (const p of PLAYERS) {
    await page.evaluate(async (q) => {
      await window.editor.setMapPath({ path: ['players', q.slot, 'ActivePlayer'], value: 'true' });
      await window.editor.setMapPath({ path: ['players', q.slot, 'Colour'], value: q.colour });
    }, p);
  }

  // --- the row of heroes, each with his bug in front of him ---
  const placed: string[] = [];
  for (const kit of HEROES) {
    placed.push(await placeHero(page, kit, 'PLAYER_1'));
    console.log(`  ${kit.key} — ${kit.fixes.join(', ')}`);
  }
  const opponentId = await placeHero(page, OPPONENT, 'PLAYER_2');
  console.log(`  ${OPPONENT.key} — ${OPPONENT.fixes.join(', ')}`);

  // --- where each side starts ---
  //
  // Without this the map loads and dies with "Start player does not exist": an
  // active slot is a player who exists, and a main hero is where that player
  // begins. The first of the row for red, the opponent for blue.
  for (const [i, id] of [placed[0]!, opponentId].entries()) {
    await page.evaluate(async (q) => {
      await window.editor.setMapPath({ path: ['players', q.slot, 'MainHero'], value: q.href });
    }, { slot: PLAYERS[i]!.slot, href: mainHeroRef(id) });
  }

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  // --- what landed on disk, since a field that did not reach the file is a
  // hero who plays as the shipped game's own and a run that proves nothing ---
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  // A map whose slots are all off loads and offers nobody to play it, which is
  // a failure with no error in it — so it is asserted rather than assumed.
  expect((xml.match(/<ActivePlayer>true<\/ActivePlayer>/g) ?? []).length,
    'the map has players at all').toBe(PLAYERS.length);
  // And each of them starts somewhere that is actually on the map — a MainHero
  // written as TEXT rather than as an href reads as blank to the game and looks
  // filled in here, which is the failure this asserts against.
  // Every shared record resolvable — the whole map is objects pointing at
  // records, and a bare path is an object the game does not have.
  const bare = [...xml.matchAll(/<Shared href="([^"]*)"/g)].map((m) => m[1]!)
    .filter((h) => !h.includes('#xpointer('));
  expect(bare, 'every Shared href names what it points at').toEqual([]);

  const starts = [...xml.matchAll(/<MainHero href="#xpointer\(id\((item_[^)]+)\)/g)].map((m) => m[1]!);
  expect(starts, 'both sides have a starting hero').toHaveLength(PLAYERS.length);
  for (const id of starts) {
    expect(xml, `${id} is an object on the map`).toContain(`id="${id}"`);
  }

  const blocks = xml.split('<AdvMapHero>').slice(1)
    .map((part) => part.slice(0, part.indexOf('</AdvMapHero>')));
  expect(blocks, 'every hero of the plan is in the file').toHaveLength(HEROES.length + 1);

  for (const kit of [...HEROES, OPPONENT]) {
    const body = blocks.find((b) => b.includes(`<Name>${kit.key}</Name>`));
    expect(body, `${kit.key} is on the map`).toBeTruthy();
    expect(body, `${kit.key} reads his Editable block`)
      .toContain(`<OverrideMask>${OVERRIDE_ALL}</OverrideMask>`);
    for (const perk of kit.perks ?? []) {
      expect(body, `${kit.key} carries ${perk}`).toContain(`<Item>${perk}</Item>`);
    }
    for (const spell of kit.spells ?? []) {
      expect(body, `${kit.key} knows ${spell}`).toContain(`<Item>${spell}</Item>`);
    }
    for (const stack of kit.army) {
      expect(body, `${kit.key} brought ${stack.creature}`)
        .toContain(`<Creature>${stack.creature}</Creature>`);
    }
    if (kit.ballista) expect(body, `${kit.key} has a ballista`).toContain('<Ballista>true</Ballista>');
  }
  expect(xml, 'the computer has a hero of its own').toContain('<PlayerID>PLAYER_2</PlayerID>');

  // --- into the install, where the game reads a map from ---
  //
  // Pack asks WHERE through a native save dialog, which no test can reach — so
  // the main process is told the answer first, the way every other packing spec
  // does it. The path is the one the install expects; nothing else about the
  // command changes.
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, ARCHIVE);
  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 120_000);
  const packed = readEntries(readFileSync(ARCHIVE))
    .find((e) => e.name.replace(/\\/g, '/').endsWith('map.xdb'));
  expect(packed, 'the archive holds the map').toBeTruthy();
  expect(packed!.data.toString('latin1'), 'and the heroes with it').toContain('<Name>wizard</Name>');

  // --- the extension in, and not one fix on ---
  //
  // Both halves matter. Without the extension nothing the second stage turns on
  // can take; with a fix already on, this run would not be showing the shipped
  // game's behaviour, which is the only thing it exists to show.
  await page.locator('#qolbtn').click();
  await expect(page.locator('#qolcfg')).toBeVisible();
  await page.locator('#qol-tab-fixes').click();
  // TURNED off, not merely expected to be. The panel shows what the install
  // says, and live that is whatever was left on last time — a fix already on
  // would make this run show the fixed behaviour, which is the one thing it
  // must not show. The preferences on the other tab are left exactly as they
  // are: they are the player's, and none of them is under test here.
  for (const flag of FIXES_UNDER_TEST) {
    await page.locator(`#qol-${flag}`).uncheck();
    await expect(page.locator(`#qol-${flag}`), `${flag} is off`).not.toBeChecked();
  }
  await page.locator('#qol-apply').click();
  await expect(page.locator('#qol-msg')).toContainText(/settings written|installed/i, { timeout: 60_000 });

  const written = readFileSync(join(GAME, 'bin', 'homm5-editor-qol.txt'), 'utf8');
  for (const flag of FIXES_UNDER_TEST) {
    expect(written, `${flag} is written down as off`).toMatch(new RegExp(`^${flag} 0$`, 'm'));
  }
  console.log(`\n  ${ARCHIVE}\n  every fix off — play it, then run fix-002.`);
});

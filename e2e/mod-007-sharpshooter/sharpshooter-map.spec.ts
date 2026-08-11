// Recreating Maps/Sharpshooter Test.h5m through the window, end to end.
//
// The test builds the same map from a blank New Map with the gestures a person
// makes — place, type the exact tile, set the fields, edit armies in the tree,
// author the texts — and then holds the result against the original with the
// same gap reports the C1M1 reconstruction used (diff-objects, diff-map,
// diff-terrain, texts, pack). See shared.ts for the plan of the map and where
// the reference comes from.
//
// The map keeps the original's own name: it is created under the data root's
// Maps tree (the checkout's data-unpacked), where that name is free — the
// original lives packed in the game's Maps folder — and sharing the name makes
// every text and archive path comparable rather than off by a rename.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { hudSays } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { armBrush, clickTile, newMap, planView } from '../tiles.ts';
import { openObjectPalette, pickObject, setObjectProp, sharedKey } from '../objects.ts';
import { addItem, addValueItem, openTree, setTreeValue } from '../tree.ts';
import { parseTerrain, readGroundFlags, tierOf } from '../../src/terrain/terrain.ts';
import { readEntries } from '../../src/format/pak.ts';
import { readInstalledMod } from '../mods.ts';
import { bar } from '../bar.ts';
import {
  ARCHIVE, BASIN, FOES, GAME, GELU, GELU_ARMY, GELU_AT, GEM, GEM_ARMY, GEM_AT, MAP_DIR, NAME, NEEDS, ORIGINAL,
  PLACES, QUEST, REF, SHARPSHOOTER, SHIPYARD_AT, SHIPYARD_CLASS, SHIP_OFFSET, SIGN_TEXT,
  STONE, STONES, blockOf, cleanup, decode, fillPlacement, gaps, openSharp, placeOne,
  startSharp, unpackReference,
} from './shared.ts';

let ed: Launched;

/**
 * The map's OWN checklist — the one AFTER `</objects>`.
 *
 * A town carries a `spellIDs` of its own (its guild's list), and it comes first
 * in the file, so a search from the top reads the wrong list and answers 99
 * where the map's own says 353.
 */
function rootList(xdb: string, name: string): string[] {
  const text = readFileSync(xdb, 'latin1');
  const after = text.indexOf('</objects>');
  const block = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)
    .exec(text.slice(after < 0 ? 0 : after));
  return [...(block?.[1] ?? '').matchAll(/<Item>([^<]*)<\/Item>/g)].map((m) => m[1]!);
}

// Playwright RESTARTS the worker after any failed test, and the restart runs
// beforeAll again — so beforeAll only ENSURES the fixtures (idempotent, and it
// never deletes the map under reconstruction). The clean slate belongs to the
// build test itself; the sweep to the last file's last test.
// AND IT USED TO DELETE IT ANYWAY. A `clearMap` stood here for the live case —
// the copy the last run packed is in the way, since New Map refuses to write
// over a map that exists — and it takes the working folder with the archive. So
// the first failed test restarted the worker, this ran again, and the map the
// remaining tests were about was gone: they all reported "the rebuilt map is on
// disk — false" and hid the one real difference behind three that were not.
// The build test below already clears BOTH halves before it starts, which is
// where the comment above always said the clean slate belongs.
test.beforeAll(async () => {
  unpackReference();
  ed = await startSharp();
});
test.afterAll(async () => { await ed?.app.close(); });

test('the map, built the way a person would', async () => {
  test.setTimeout(15 * 60_000);
  const { page } = ed;

  // The clean slate: this test owns the rebuild from nothing — the working
  // folder AND the archive. A map is a file now, and New Map refuses to write
  // over one, so a run that left its archive behind (a failure, a kill) would
  // stop the next one dead in the dialog.
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  rmSync(ARCHIVE, { force: true });
  await newMap(page, NAME, '72');
  await openObjectPalette(page);

  // --- the town, red's --------------------------------------------------
  await pickObject(page, PLACES.town.shared);
  await placeOne(page, PLACES.town.shared, PLACES.town.x, PLACES.town.y);
  await setObjectProp(page, 'PlayerID', 'PLAYER_1');

  // --- three heroes, each with a sharpshooter stack ---------------------
  for (const h of PLACES.heroes) {
    await pickObject(page, h.shared);
    await placeOne(page, h.shared, h.x, h.y);
    await setObjectProp(page, 'PlayerID', h.player);
    // The army lives behind the structured Army row — the object's tree.
    const army = page.locator('#p-props .pf', { has: page.locator('label', { hasText: /^Army$/ }) });
    await army.locator('button.struct-edit').click();
    await expect(page.locator('#mt-dialog')).toBeVisible();
    await addItem(page, ['armySlots']);
    await setTreeValue(page, ['armySlots', 0, 'Creature'], SHARPSHOOTER);
    await setTreeValue(page, ['armySlots', 0, 'Count'], String(h.count));
    // The original's heroes carry Basic mastery — the value the game's own
    // editor stamps on a placed hero.
    await setTreeValue(page, ['PrimarySkillMastery'], 'MASTERY_BASIC');
    for (const a of h.artifacts) await addValueItem(page, ['artifactIDs'], a);
    await page.locator('#mt-close').click();
    await expect(page.locator('#mt-dialog')).toBeHidden();
  }

  // --- the neutral stacks -----------------------------------------------
  for (const m of PLACES.monsters) {
    await pickObject(page, m.shared);
    await placeOne(page, m.shared, m.x, m.y);
    await setObjectProp(page, 'Custom', 'true');
    await setObjectProp(page, 'Amount', String(m.amount));
    await setObjectProp(page, 'DoesNotGrow', 'true');
    await setObjectProp(page, 'Courage', 'MONSTER_COURAGE_ALWAYS_FIGHT');
  }

  // --- the mod's dwelling and three artifacts ---------------------------
  // The original names each after its definition's file stem; ours suggests
  // DWELLING_001-style names, so the name is typed like everything else.
  const stem = (shared: string): string => shared.split('/').pop()!.replace(/\..*$/, '');
  for (const d of PLACES.dwellings) {
    await pickObject(page, d.shared);
    await placeOne(page, d.shared, d.x, d.y);
    await setObjectProp(page, 'Name', stem(d.shared));
  }
  for (const a of PLACES.artifacts) {
    await pickObject(page, a.shared);
    await placeOne(page, a.shared, a.x, a.y);
    await setObjectProp(page, 'Name', stem(a.shared));
  }

  // --- the passability plane --------------------------------------------
  // The original (born of an older template) carries the plane, all-walkable.
  // A blank map has only the empty slot; the FIRST mask stroke fills it in
  // (src/terrain-plane.ts) — so one blocked tile and its erase leave exactly
  // what the original holds: the plane, with nothing blocked.
  // In plan view: the 3D projection's tileToScreen and its picking ray can
  // disagree by tiles at oblique angles, and clickTile (rightly) refuses a
  // click that would land on the wrong tile. The flat view has no such gap.
  // Nothing after this section clicks the map, so the view can stay flat.
  await planView(page);
  await armBrush(page, 'mask');
  await clickTile(page, 35, 39);
  await armBrush(page, 'erase');
  await clickTile(page, 35, 39);
  await page.locator('#brushbtn').click(); // disarm — clicks belong to objects again
  await expect(page.locator('#brushbtn')).toHaveText('off');

  // --- players: red is the human, blue is the AI opponent ---------------
  await openTree(page);
  await setTreeValue(page, ['players', 0, 'ActivePlayer'], 'true');
  await setTreeValue(page, ['players', 0, 'CanBeComputerPlayer'], 'false');
  await setTreeValue(page, ['players', 0, 'CanChangeBonus'], 'false');
  await setTreeValue(page, ['players', 0, 'Colour'], 'PCOLOR_RED');
  await setTreeValue(page, ['players', 1, 'ActivePlayer'], 'true');
  await setTreeValue(page, ['players', 1, 'Team'], '1');
  await setTreeValue(page, ['players', 1, 'Colour'], 'PCOLOR_BLUE');
  // The blank map's "defeat all" objective was hand-tamed to a manual one.
  await setTreeValue(page, ['Objectives', 'Primary', 'Common', 'Objectives', 0, 'Kind'], 'OBJECTIVE_KIND_MANUAL');
  await page.locator('#mt-close').click();

  // --- every spell and artifact enabled, as the original lists them -----
  await bar(page, '#mapbtn');
  await expect(page.locator('#mapprops')).toBeVisible();
  for (const tab of ['Spells', 'Artifacts']) {
    await page.locator('.mp-tab', { hasText: tab }).click();
    // exact: "Uncheck all" contains "Check all" as a substring.
    await page.getByRole('button', { name: 'Check all', exact: true }).click();
  }
  await page.locator('#mp-close').click();

  // --- the texts, as the original wrote them ----------------------------
  // Authored through the app's file API — the write the text editor performs on
  // Save. The editor-typing path has its own spec (text-authoring.spec.ts).
  for (const f of readdirSync(REF).filter((n) => n.endsWith('.txt'))) {
    const text = decode(readFileSync(join(REF, f)));
    await page.evaluate(([href, t]) => window.editor.writeFile({ href: href!, text: t! }), [f, text]);
  }

  // Everything above edits the model; Save writes the map.xdb.
  // Whether Save is live can be read through the closed menu — being enabled is
  // not being visible — but pressing it needs the menu down, so that goes
  // through the bar helper.
  if (await page.locator('#save').isEnabled()) {
    await bar(page, '#save');
    await hudSays(page, /saved/i, 60_000);
  }
});

test('holds against the original: objects, settings, terrain, texts', async () => {
  test.setTimeout(5 * 60_000);
  // If the build test left no map behind, every report below would only
  // restate that — say it once, with the app's log for the why.
  expect(existsSync(join(MAP_DIR, 'map.xdb')),
    `the rebuilt map exists on disk (app log tail:\n${ed.log.slice(-15).join('\n')})`).toBe(true);
  const refXdb = join(REF, 'map.xdb');
  const ourXdb = join(MAP_DIR, 'map.xdb');
  // TWO differences are deliberate and stay. Everything else must be nothing.
  //
  // Diraya stands two tiles clear of the Stonehenge, where the original has her
  // inside its footprint (see PLACES). Ours refuses to put a building over a
  // hero, so the map cannot be reproduced there — and the report, which pairs
  // objects by position, shows that as one unmatched on each side.
  //
  // The palace's DEFINITION moved. It used to be a dwelling under `Dwellings/`
  // pointing at the town's art; it is a building of the dwelling class under
  // `Buildings/` now, carrying its own copy of that art (mod-006), and the hand-
  // made original predates the move. The placement is the same object on the
  // same tile — only the href it names is ours rather than the old one.
  const DELIBERATE = /diraya|sharpshooterpalace|no counterpart — 1\/(11|20)|never places — 1 of 10|the original does not — 1$/i;
  expect(gaps('diff-objects.ts', refXdb, ourXdb).filter((l) => !DELIBERATE.test(l)),
    'object differences beyond the one placement ours will not reproduce').toEqual([]);
  // And ONE deliberate setting difference: our map says where each player
  // begins and the hand-made original does not. The editor writes MainHero when
  // a hero is given an owner (src/map/players.ts) — an active player with no
  // main hero is what "start player does not exist" is made of, so the original
  // being empty here is the older, worse map, not the standard to match.
  const MAIN_HERO = /players\[\d+\]\.MainHero: ref "" vs ours "#xpointer\(/;
  // AND THE TWO ROSTERS, which are the INSTALLATION'S and not the map's idea.
  // "Check all" ticks every spell and every artifact the install knows, so the
  // lists grow whenever the mod does — and the hand-made original was made when
  // the mod had its artifacts and none of its spells. Live, where this stage and
  // the Rules Test share one install, ours therefore carries four spells the
  // original could not have: a length difference, which diff-map reports as one.
  //
  // Allowed, but not waved through. What ours adds must be exactly what the mod
  // added, and it must add nothing the original had — checked here by name,
  // because "the list is longer" is the shape of both a mod and a bug.
  // No archive at all is a legal state — nothing of ours is installed, so
  // nothing of ours may be in the lists, which is what an empty set says.
  const installed = (() => { try { return readInstalledMod(GAME); } catch { return null; } })();
  const ourIds = new Set([
    ...(installed?.spells ?? []).map((s) => s.id),
    ...(installed?.artifacts ?? []).map((a) => a.id),
  ]);
  for (const list of ['spellIDs', 'artifactIDs']) {
    const wanted = rootList(refXdb, list);
    const got = rootList(ourXdb, list);
    expect(wanted.filter((x) => !got.includes(x)),
      `${list}: enabled in the original and not in ours`).toEqual([]);
    expect(got.filter((x) => !wanted.includes(x) && !ourIds.has(x)),
      `${list}: enabled in ours, and neither in the original nor in the mod`).toEqual([]);
  }
  const ROSTERS = /DIFF\s+(spellIDs|artifactIDs)\b/;
  const settings = gaps('diff-map.ts', refXdb, ourXdb).filter((l) => !ROSTERS.test(l));
  // The block's own header goes only when EVERY player difference under it is
  // that one — otherwise a real difference would be hidden by the same filter.
  const onlyMainHero = settings.filter((l) => /players\[\d+\]\./.test(l)).every((l) => MAIN_HERO.test(l));
  expect(settings.filter((l) => !(onlyMainHero && (MAIN_HERO.test(l) || /DIFF\s+players\b/.test(l)))),
    'setting differences beyond the start each player now has').toEqual([]);
  // The terrain was never touched: the blank 72×72 the original started from.
  // Every DATA plane must match; the one allowed difference is the container's
  // byte length — the original's template carries trailer padding our splice
  // does not reproduce, and diff-terrain confirms all planes equal anyway.
  const terrain = gaps('diff-terrain.ts', join(REF, 'GroundTerrain.bin'), join(MAP_DIR, 'GroundTerrain.bin'))
    .filter((l) => !l.includes('file length'));
  expect(terrain, 'terrain differences').toEqual([]);

  // Every text matches, byte for byte, in the UTF-16LE the game reads.
  const wrong: string[] = [];
  for (const f of readdirSync(REF).filter((n) => n.endsWith('.txt'))) {
    const want = readFileSync(join(REF, f));
    const got = readFileSync(join(MAP_DIR, f));
    if (!got.equals(want)) wrong.push(`${f}: ${decode(got)} != ${decode(want)}`);
  }
  expect(wrong, 'texts that do not match').toEqual([]);
});

test('packs to a .h5m holding the same members', async () => {
  // The same door a later sitting enters through also recovers a renderer that
  // reloaded to the start screen mid-file.
  await openSharp(ed);
  const { page } = ed;
  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  expect(existsSync(ARCHIVE)).toBe(true);

  const ours = new Set(readEntries(readFileSync(ARCHIVE)).map((e) => e.name.replace(/\\/g, '/')));
  const theirs = readEntries(readFileSync(ORIGINAL)).map((e) => e.name.replace(/\\/g, '/'));
  const missing = theirs.filter((n) => !ours.has(n));
  expect(missing, 'members of the original our archive lacks').toEqual([]);
});

// --- and then what the original never had ------------------------------------
//
// Everything above holds the rebuild against the hand-made original. Everything
// below is ADDED to it on purpose, and it is in this file rather than in two
// more beside it because it is the same map, in the same sitting, in an order
// that cannot be shuffled: a hero the game does not ship, the stones and stacks
// that make the map a proving ground, and one building of every class the mod
// carries. Three files meant three editors started, three fixtures installed and
// the same map opened three times to add to it.
//
// `openSharp` still guards each of them — it returns at once when the map is
// already on screen, and picks it out of the picker when it is not, which is
// what makes any of these runnable on its own.

test('Gem stands on it, in red', async () => {
  test.setTimeout(2 * 60_000);
  await openSharp(ed);
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

  // And Gelu beside her, whose specialization is the one that GIVES something.
  // He is here so the stand can be played and not only built: what his
  // specialization promises is handed out on the map, at run time, so a hero who
  // exists in the mod and stands nowhere proves nothing.
  await pickObject(page, GELU);
  await placeOne(page, GELU, GELU_AT.x, GELU_AT.y);
  await setObjectProp(page, 'PlayerID', 'PLAYER_1');

  // And every shooter in the game, two hundred of each, IN THE MAP rather than
  // handed out by a script at run time: an army is what a hero is placed with,
  // and a stand assembled by a script is a stand that has to be assembled again
  // every time somebody wants to look at it. Six stacks, seventh slot left
  // empty — the training has to have somewhere to put what it makes.
  const geluArmy = page.locator('#p-props .pf', { has: page.locator('label', { hasText: /^Army$/ }) });
  await geluArmy.locator('button.struct-edit').click();
  await expect(page.locator('#mt-dialog')).toBeVisible();
  for (let slot = 0; slot < GELU_ARMY.length; slot++) {
    const [creature, count] = GELU_ARMY[slot]!;
    await addItem(page, ['armySlots']);
    await setTreeValue(page, ['armySlots', slot, 'Creature'], creature);
    await setTreeValue(page, ['armySlots', slot, 'Count'], String(count));
  }
  await page.locator('#mt-close').click();
  await expect(page.locator('#mt-dialog')).toBeHidden();

  await bar(page, '#save');
  await hudSays(page, /saved/i, 60_000);

  // On disk, in the map the game will read: our hero, owned by red.
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xml, 'the map references the hero the mod installed').toContain(GEM);
  expect(xml, 'and Gelu beside her').toContain(GELU);
  const gelu = xml.split('<AdvMapHero>').find((part) => part.includes('H3Gelu')) ?? '';
  expect(gelu, 'Gelu is red too — a hero nobody owns is never asked about')
    .toContain('<PlayerID>PLAYER_1</PlayerID>');
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
  await openSharp(ed);
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
  const packedStones = readEntries(readFileSync(ARCHIVE))
    .find((e) => e.name.replace(/\\/g, '/').endsWith('map.xdb'))!;
  expect((packedStones.data.toString('latin1').match(/Learning_Stone/g) ?? []).length,
    'and the packed map carries them too').toBe(STONES.length);
});

// Placing one building is the other half of MAKING one: the palette has to offer
// it, its footprint has to be a real size, and a row of them has to lay out
// without landing on each other. One of every class is the widest sweep of the
// placement path there is.
//
// On THIS map and not one of their own, because a map is only a test if it can
// be walked into: a blank map with buildings and no player the game will not
// even load. Here there is a town, three heroes and an opponent, and the
// bottom-left corner is empty.
//
// Standing there is not the same as WORKING, and the difference is the
// placement: the shrine teaches the spell its placement names, the sign shows
// the file its placement points at, the seer hut asks the errand its placement
// carries, and the shipyard launches into the tile its placement offsets to.
// Walked around in the game, all four were silent — three because those fields
// were empty and one because the map had no water in it at all. So this fills
// them in and digs a bay, and then reads the map back to see it.
test('every building the mod carries stands in its empty corner', async () => {
  test.setTimeout(10 * 60_000);
  await openSharp(ed);
  const { page } = ed;

  // The buildings come from mod-005; the fixture this stage installs on its own
  // carries only the palace. Run alone, there is nothing here to place — and
  // saying so is better than failing a map spec over a stage that did not run.
  const buildings = readInstalledMod(GAME).buildings ?? [];
  test.skip(buildings.length < 2, 'no buildings installed — run mod-005 first');

  // What the map already has — the palace among it, placed above. Placing a
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

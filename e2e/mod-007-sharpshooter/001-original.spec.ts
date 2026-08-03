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
import { openObjectPalette, pickObject, setObjectProp } from '../objects.ts';
import { addItem, addValueItem, openTree, setTreeValue } from '../tree.ts';
import { readEntries } from '../../src/format/pak.ts';
import { clearMap, LIVE } from '../mods.ts';
import { bar } from '../bar.ts';
import {
  ARCHIVE, DATA, GAME, MAP_DIR, NAME, ORIGINAL, PLACES, REF, SHARPSHOOTER,
  decode, gaps, openSharp, placeOne, startSharp, unpackReference,
} from './shared.ts';

let ed: Launched;

// Playwright RESTARTS the worker after any failed test, and the restart runs
// beforeAll again — so beforeAll only ENSURES the fixtures (idempotent, and it
// never deletes the map under reconstruction). The clean slate belongs to the
// build test itself; the sweep to the last file's last test.
test.beforeAll(async () => {
  unpackReference();
  // Live, the map is rebuilt into the game itself, and the copy the last run
  // packed is in the way — New Map refuses to write over a map that exists. The
  // reference was read above, out of assets/, so nothing needed is lost.
  if (LIVE) clearMap(GAME, DATA, NAME);
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
  expect(gaps('diff-map.ts', refXdb, ourXdb), 'setting differences').toEqual([]);
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

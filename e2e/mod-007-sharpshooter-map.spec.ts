// Recreating Maps/Sharpshooter Test.h5m through the window, end to end.
//
// The hand-made original is the REFERENCE: it is unpacked once into _tmp and
// nothing here ever writes to it. The test builds the same map from a blank
// New Map with the gestures a person makes — place, type the exact tile, set
// the fields, edit armies in the tree, author the texts — and then holds the
// result against the original with the same gap reports the C1M1
// reconstruction used (diff-objects, diff-map, diff-terrain, texts, pack).
//
// The mod the map is made of — the Sharpshooter, its palace, three artifacts —
// is BUILT into this run's own game root as a fixture (e2e/mods.ts), not copied
// off the real install: a spec that borrows whatever somebody happened to build
// passes or fails on their game rather than on the code, and cannot run at all
// where nobody has pressed the buttons. Adding units through the window is its
// own suite (mod-001-units-create.spec.ts); this one is about the map, and it must not
// depend on that dialog having run.
//
// The map keeps the original's own name: it is created under the data root's
// Maps tree (the checkout's data-unpacked), where that name is free — the
// original lives packed in the game's Maps folder — and sharing the name makes
// every text and archive path comparable rather than off by a rename.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchEditor, hudSays, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, clickTile, newMap, planView } from './tiles.ts';
import { editStruct, openObjectPalette, pickObject, placeAtTile, setObjectProp, setPlacement, setTextRef, sharedKey } from './objects.ts';
import { addItem, addValueItem, openTree, setTreeTextRef, setTreeValue } from './tree.ts';
import { parseTerrain, readGroundFlags, tierOf } from '../src/terrain/terrain.ts';
import { readEntries } from '../src/format/pak.ts';
import { MOD_EXT, modFile } from '../src/game/mod-paths.ts';
import { clearMap, installMapFixture, LIVE, modGameRoot, PALACE_SHARED, readInstalledMod } from './mods.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { bar } from './bar.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** This run's own game install: the fixture mod goes here, the archive comes out here. */
const GAME = modGameRoot();
/** The real install the checkout sits in — the source of the mod and the original. */
const REAL_GAME = join(REPO_ROOT, '..');
/**
 * The map this spec rebuilds.
 *
 * `assets/maps/` first — the checkout's own copy, which makes the run the same
 * on any machine. It is not in the repo and cannot be: the map was made by
 * editing one the stock editor produced (assets/README.md). Absent, the
 * installed one is used, under either the name our build writes or the old one.
 */
const ORIGINAL = [
  join(REPO_ROOT, 'assets', 'maps', 'Sharpshooter Test.h5m'),
  modFile(REAL_GAME, 'map', 'Sharpshooter Test'),
  join(REAL_GAME, 'Maps', 'Sharpshooter Test.h5m'),
].find((p) => existsSync(p)) ?? '';
/** The original, unpacked as the reference. Read-only after beforeAll. */
const REF_ROOT = join(REPO_ROOT, '_tmp', 'e2e-sharp-ref');
const REF = join(REF_ROOT, 'Maps', 'SingleMissions', 'Sharpshooter Test');

const NAME = 'Sharpshooter Test';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const ARCHIVE = modFile(GAME, 'map', NAME);

const SHARPSHOOTER = 'CREATURE_H3_SHARPSHOOTER';
/** The hero mod-004 installs, as the palette lists him and the map stores him. */
const GEM = '/Heroes/H3Gem/H3Gem.(AdvMapHeroShared).xdb';
/** Clear of the town, the three heroes and the neutral stacks. */
const GEM_AT = { x: 44, y: 40 };

/**
 * What a class needs from its PLACEMENT before it does anything.
 *
 * Not a nicety: a shrine with `SPELL_NONE` and a sign with no file are objects
 * that stand on the map and answer nothing at all, which is exactly how they
 * came out the first time this map was walked around (BUILDINGS.md §3).
 */
const NEEDS: Record<string, Record<string, string>> = {
  // Ours is the Magma Shrine — runic, circles 1 to 3 — so it teaches a rune.
  AdvMapShrineShared: { SpellID: 'SPELL_RUNE_OF_CHARGE' },
};

/** The sign's words. A reference to an empty file is the same empty box. */
const SIGN_TEXT = 'ЗдЕсЬ БыЛ ЗнАк: за ним — верфь, а перед ней хижина пророка.';

/**
 * The seer hut's errand.
 *
 * `COLLECT_RESOURCES` is the one kind that needs nothing else placed on the map:
 * its parameters are a resource index (wood 0 … gem 5, gold 6) and an amount, so
 * a hero who walks up with the gold completes it where it stands. Everything
 * else — the caption, the description, an award that is not `AWARD_NONE` — is
 * what turns the structure into an errand rather than a silent building.
 */
const QUEST = {
  name: 'E2E_SEER_QUEST',
  caption: 'ПрОсЬбА ПрОрОкА',
  description: 'Принеси мне 500 золота, и я открою тебе то, что стоит 5000 опыта.',
  kind: 'OBJECTIVE_KIND_COLLECT_RESOURCES',
  parameters: ['6', '500'],
  award: 'AWARD_EXPERIENCE',
  experience: '5000',
};

/**
 * The shipyard, and the water without which it is a hut that says nothing.
 *
 * `ShipTile` is an OFFSET from the object's own tile and it has to land on
 * water — true of 42 of the 46 shipyards the game ships. This map is flat grass
 * to its edges, so the water is dug first, with the Lower brush, which is the
 * tool that digs to exactly 0.0 and flags the bed as sea. The shipyard then
 * stands beside it rather than in the grid the others share: it is the one
 * building whose position is decided by the terrain.
 */
const SHIPYARD_CLASS = 'AdvMapShipyardShared';
const SHIPYARD_AT = { x: 46, y: 64 };
const SHIP_OFFSET = { x: 0, y: 4 };
/** Two 7×7 strokes, clear of the building above them and of the map's edge. */
const BASIN: readonly [number, number][] = [[44, 69], [48, 69]];

/** The original's placements — read off its map.xdb, kept literal so the spec
 *  reads like the plan of the map. */
const PLACES = {
  town: { shared: '/MapObjects/Academy.(AdvMapTownShared).xdb', x: 45, y: 47 },
  heroes: [
    { shared: '/MapObjects/Academy/Sufi.(AdvMapHeroShared).xdb', x: 34, y: 37, player: 'PLAYER_1', count: 12, artifacts: [] as string[] },
    // Back at 40. She was moved to 38 to get out of SylvanStonehenge's
    // footprint, and that building is no longer on this map.
    { shared: '/MapObjects/Preserve/Diraya.(AdvMapHeroShared).xdb', x: 40, y: 37, player: 'PLAYER_2', count: 8, artifacts: [] as string[] },
    {
      shared: '/MapObjects/Necropolis/Straker.(AdvMapHeroShared).xdb', x: 34, y: 40, player: 'PLAYER_1', count: 12,
      artifacts: ['ARTIFACT_TREEBORN_QUIVER', 'ARTIFACT_H3_UNDERTAKERS_AMULET', 'ARTIFACT_H3_VAMPIRES_CLOAK', 'ARTIFACT_H3_DEAD_MANS_BOOTS'],
    },
  ],
  // The neutral stacks: the mod's Sharpshooter between the heroes, and the two
  // Peasant stacks the original also has south of them.
  monsters: [
    { shared: '/Units/H3Sharpshooter/H3Sharpshooter.(AdvMapMonsterShared).xdb', x: 37, y: 40, amount: 6 },
    { shared: '/MapObjects/Haven/Peasant.(AdvMapMonsterShared).xdb', x: 36, y: 42, amount: 100 },
    { shared: '/MapObjects/Haven/Peasant.(AdvMapMonsterShared).xdb', x: 38, y: 42, amount: 100 },
  ],
  // ONE dwelling, and it is here to prove something: the Sharpshooter's palace
  // is a dwelling for a creature the game does not ship, which is the editor's
  // own feature. The eight tier 4–7 dwellings and the mummies' pyramid used to
  // stand here too and were taken off — they are the port's CONTENT, they
  // exercise nothing this spec is about, and a map that is mostly content takes
  // longer to rebuild for no answer.
  // It is authored as a BUILDING of the dwelling class now (mod-006), so it
  // lives under Buildings/ with the art it owns — the path is the fixture's to
  // say rather than this spec's to spell.
  dwellings: [
    { shared: PALACE_SHARED, x: 48, y: 37 },
  ],
  artifacts: [
    { shared: '/Artifacts/H3UndertakersAmulet/H3UndertakersAmulet.(AdvMapArtifactShared).xdb', x: 32, y: 39 },
    { shared: '/Artifacts/H3VampiresCloak/H3VampiresCloak.(AdvMapArtifactShared).xdb', x: 30, y: 39 },
    { shared: '/Artifacts/H3DeadMansBoots/H3DeadMansBoots.(AdvMapArtifactShared).xdb', x: 29, y: 39 },
  ],
};

function cleanup(): void {
  // Live, nothing is swept: the install is the game, the packed map is the
  // point, and the working tree beside it is what a person would have left.
  if (LIVE) return;
  // The INSTALL is not swept here even isolated — mod-008 reads it, being the
  // stage that asks what the run actually put on disk. It takes it away when it
  // is done.
  for (const p of [REF_ROOT, MAP_DIR]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

/** A map text is UTF-16LE with a BOM; decode it to compare content. */
function decode(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  return buf.toString('utf8');
}

// Playwright RESTARTS the worker after any failed test, and the restart runs
// beforeAll again — so beforeAll only ENSURES the fixtures (idempotent, and it
// never deletes the map under reconstruction). The clean slate belongs to the
// build test itself; the full sweep to afterAll.
test.beforeAll(async () => {
  // The reference: the hand-made archive, unpacked and never written again.
  if (existsSync(ORIGINAL) && !existsSync(join(REF, 'map.xdb'))) {
    for (const e of readEntries(readFileSync(ORIGINAL))) {
      const path = join(REF_ROOT, e.name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, e.data);
    }
  }

  // The fixture mod, BUILT into this run's own install rather than copied off
  // the real one: the map is made of a creature, a dwelling and three artifacts
  // the game does not ship, and borrowing them from whatever somebody happens to
  // have installed makes this spec pass or fail on their game instead of on the
  // FILLS THE GAPS, and usually there are none: run as the chain it belongs to,
  // mod-001 authored the creature and mod-003 the artifacts through the dialogs,
  // and all this adds is the palace — the one thing with no form to author it
  // in. Run alone, it supplies the lot, so this stage never depends on a stage
  // that did not run. Either way it adds what is missing and leaves what is
  // there, so it cannot repaint a creature mod-002 has just painted.
  installMapFixture(GAME);
  // Live, the map is rebuilt into the game itself, and the copy the last run
  // packed is in the way — New Map refuses to write over a map that exists. The
  // reference was read above, out of assets/, so nothing needed is lost.
  if (LIVE) clearMap(GAME, DATA, NAME);

  ed = await launchEditor({ HOMM5_ROOT: GAME });
  // The one thing Playwright cannot click is the OS save dialog; Pack's answer
  // is fixed to where the game would look, inside this run's install.
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, ARCHIVE);
});
// No cleanup here: afterAll ALSO runs when Playwright restarts the worker
// after a failed test, and sweeping then destroys the map the next test needs.
// The green path sweeps at the end of the last test; a red run leaves its
// artifacts for reading.
test.afterAll(async () => { await ed?.app.close(); });

/** Place one object and give it its exact tile; returns its id. */
async function placeOne(page: Launched['page'], shared: string, x: number, y: number): Promise<string> {
  const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
  await placeAtTile(page, Math.round(x), Math.round(y));
  const after = await page.evaluate(() => window.view.objects());
  const added = after.filter((o) => !before.has(o.id));
  expect(added, `placing ${shared} added one object`).toHaveLength(1);
  const id = added[0]!.id;
  await page.evaluate((oid) => window.view.select(oid), id);
  await setPlacement(page, { x, y });
  return id;
}

/**
 * The rest of what a placement needs, where a value in a box is not enough.
 *
 * `NEEDS` covers the classes whose field is a plain value. These three are not:
 * a sign's message is a REFERENCE to a text file that has to be made and
 * written, and a seer hut's quest and a shipyard's ship tile are STRUCTURES,
 * edited in the object's own tree behind the panel's "Edit…". Each is driven
 * here the way a person drives it, which is the point of doing it at all —
 * the map that comes out is only worth having if the window can make it.
 */
async function fillPlacement(page: Launched['page'], className: string): Promise<void> {
  if (className === 'AdvMapSignShared') {
    await setTextRef(page, 'MessageFileRef', 'sign-message', SIGN_TEXT);
    return;
  }
  if (className === 'AdvMapSeerHutShared') {
    await editStruct(page, 'Quest');
    await setTreeValue(page, ['Quest', 'Name'], QUEST.name);
    await setTreeTextRef(page, ['Quest', 'CaptionFileRef'], 'seer-caption', QUEST.caption);
    await setTreeTextRef(page, ['Quest', 'DescriptionFileRef'], 'seer-desc', QUEST.description);
    await setTreeValue(page, ['Quest', 'Kind'], QUEST.kind);
    for (const p of QUEST.parameters) await addValueItem(page, ['Quest', 'Parameters'], p);
    await setTreeValue(page, ['Quest', 'Award', 'Type'], QUEST.award);
    await setTreeValue(page, ['Quest', 'Award', 'Experience'], QUEST.experience);
    await closeTree(page);
    return;
  }
  if (className === SHIPYARD_CLASS) {
    await editStruct(page, 'ShipTile');
    await setTreeValue(page, ['ShipTile', 'x'], String(SHIP_OFFSET.x));
    await setTreeValue(page, ['ShipTile', 'y'], String(SHIP_OFFSET.y));
    await closeTree(page);
  }
}

/** Put the tree away — the panel is where the next object is selected. */
async function closeTree(page: Launched['page']): Promise<void> {
  await page.locator('#mt-close').click();
  await expect(page.locator('#mt-dialog')).toBeHidden();
}

/** One object's element out of the map, by class — one of each is placed here. */
const blockOf = (xml: string, tag: string): string =>
  xml.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0] ?? '';

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

/** Run a gap report; the tools exit 1 on differences, so catch and read. */
function gaps(tool: string, a: string, b: string): string[] {
  let out: string;
  try {
    out = execFileSync('node', [join('tools', tool), a, b], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    out = err.stdout ?? '';
    // Exit 1 with a report is "differences found"; anything else — no report,
    // exit 2, a missing input file — is the TOOL failing, and swallowing that
    // would read as "no differences". Fail loudly instead.
    if (!out.includes('DIFF') && !out.includes('difference')) {
      throw new Error(`${tool} did not produce a report (exit ${err.status}):\n${out}\n${err.stderr ?? ''}`);
    }
  }
  const diffs = out.split('\n').filter((l) => l.includes('DIFF'));
  // The summary lines name the field; the full report says which value — and
  // the next fix needs the value.
  if (diffs.length) console.log(`--- ${tool}\n${out}`);
  return diffs;
}

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
  const { page } = ed;
  // The map must still be open. If the renderer reloaded to the start screen,
  // the app's own log says why (main prints `[renderer gone] …` when the
  // renderer process died) — surface that instead of clicking at a dead page.
  if (!((await page.locator('#title').textContent()) ?? '').includes(NAME)) {
    console.log('map no longer open; app log tail:\n' + ed.log.slice(-25).join('\n'));
    expect(existsSync(join(MAP_DIR, 'map.xdb')), 'the rebuilt map is still on disk').toBe(true);
    // Reopen through the picker, the way a person would — and check every
    // step. The search filters WITHIN the active category chip, so pick All
    // first. What the picker lists is the packed map in our folder.
    await page.locator('#cats .chip', { hasText: 'All' }).click();
    await page.locator('#search').fill(NAME);
    const row = page.locator('#maplist .m', { hasText: `${NAME}.${MOD_EXT.map}` }).first();
    await expect(row, 'the picker lists the rebuilt map').toBeVisible();
    await row.click();
    await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
  }
  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  expect(existsSync(ARCHIVE)).toBe(true);

  const ours = new Set(readEntries(readFileSync(ARCHIVE)).map((e) => e.name.replace(/\\/g, '/')));
  const theirs = readEntries(readFileSync(ORIGINAL)).map((e) => e.name.replace(/\\/g, '/'));
  const missing = theirs.filter((n) => !ours.has(n));
  expect(missing, 'members of the original our archive lacks').toEqual([]);
});

// The map has held against the original by now, so what follows is ADDED to it
// on purpose: a hero the game does not ship, standing on a map through the same
// palette every other object came from. That is the point of the check — a
// hero authored by mod-004 is an object like any other from here on, and the
// palette finds him because a mod is a mounted root like the data folder is.
test('and Gem stands on it, in red', async () => {
  test.setTimeout(2 * 60_000);
  const { page } = ed;

  await pickObject(page, GEM);
  const id = await placeOne(page, GEM, GEM_AT.x, GEM_AT.y);
  await setObjectProp(page, 'PlayerID', 'PLAYER_1');
  void id;

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

  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  const packed = readEntries(readFileSync(ARCHIVE))
    .find((e) => e.name.replace(/\\/g, '/').endsWith('map.xdb'))!;
  expect(packed.data.toString('latin1'), 'the packed map carries her too').toContain('H3Gem');
});

/**
 * And every building the mod carries, in the corner nothing else uses.
 *
 * Placing one is the other half of making one: the palette has to offer it, its
 * footprint has to be a real size, and a row of them has to lay out without
 * landing on each other. One of every class is the widest sweep of the placement
 * path there is.
 *
 * On THIS map and not one of their own, because a map is only a test if it can
 * be walked into: a blank map with buildings and no player the game will not
 * even load. Here there is a town, three heroes and an opponent, and the bottom-
 * left corner is empty — everything the map is made of sits between rows 37 and
 * 47. Eight tiles apart is wider than anything placed here, so each keeps clear
 * ground and an entrance a hero can reach.
 *
 * Standing there is not the same as WORKING, and the difference is the
 * placement: the shrine teaches the spell its placement names, the sign shows
 * the file its placement points at, the seer hut asks the errand its placement
 * carries, and the shipyard launches into the tile its placement offsets to.
 * Walked around in the game, all four were silent — three of them because those
 * fields were empty and one because the map had no water in it at all. So this
 * fills them in and digs a bay, and then reads the map back to see it.
 */
test('and every building the mod carries stands in its empty corner', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  // The buildings come from mod-005; the fixture this spec installs on its own
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

  // The whole run converged — leave nothing behind.
  cleanup();
});

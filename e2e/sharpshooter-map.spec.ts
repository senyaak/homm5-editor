// Recreating Maps/Sharpshooter Test.h5m through the window, end to end.
//
// The hand-made original is the REFERENCE: it is unpacked once into _tmp and
// nothing here ever writes to it. The test builds the same map from a blank
// New Map with the gestures a person makes — place, type the exact tile, set
// the fields, edit armies in the tree, author the texts — and then holds the
// result against the original with the same gap reports the C1M1
// reconstruction used (diff-objects, diff-map, diff-terrain, texts, pack).
//
// The mod the map depends on (sod-creatures: the Sharpshooter, ten dwellings,
// three artifacts) is installed as a FIXTURE — copied into this run's own game
// root. Adding units through the window is its own suite (units-mod.spec.ts);
// this one is about the map, and it must not depend on that dialog having run.
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
import { openObjectPalette, pickObject, placeAtTile, setObjectProp, setPlacement } from './objects.ts';
import { addItem, addValueItem, openTree, setTreeValue } from './tree.ts';
import { readEntries } from '../src/pak.ts';
import { ensureModDir, modFile } from '../src/mod-paths.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** This run's own game install: the fixture mod goes here, the archive comes out here. */
const GAME = join(REPO_ROOT, '_tmp', 'e2e-sharp-game');
/** The real install the checkout sits in — the source of the mod and the original. */
const REAL_GAME = join(REPO_ROOT, '..');
/**
 * The hand-made map this spec rebuilds — in our folder, where our build reads
 * it. An install that still has it only under its old name is taken as it is:
 * the map is somebody's file, not a fixture in the repo.
 */
const ORIGINAL = existsSync(modFile(REAL_GAME, 'map', 'Sharpshooter Test'))
  ? modFile(REAL_GAME, 'map', 'Sharpshooter Test')
  : join(REAL_GAME, 'Maps', 'Sharpshooter Test.h5m');
/** The original, unpacked as the reference. Read-only after beforeAll. */
const REF_ROOT = join(REPO_ROOT, '_tmp', 'e2e-sharp-ref');
const REF = join(REF_ROOT, 'Maps', 'SingleMissions', 'Sharpshooter Test');

const NAME = 'Sharpshooter Test';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const ARCHIVE = modFile(GAME, 'map', NAME);

const SHARPSHOOTER = 'CREATURE_H3_SHARPSHOOTER';

/** The original's placements — read off its map.xdb, kept literal so the spec
 *  reads like the plan of the map. */
const PLACES = {
  town: { shared: '/MapObjects/Academy.(AdvMapTownShared).xdb', x: 45, y: 47 },
  heroes: [
    { shared: '/MapObjects/Academy/Sufi.(AdvMapHeroShared).xdb', x: 34, y: 37, player: 'PLAYER_1', count: 12, artifacts: [] as string[] },
    // At 38: two tiles clear of SylvanStonehenge's footprint (anchor 41,37) —
    // at the original 40 the hero stood inside the building.
    { shared: '/MapObjects/Preserve/Diraya.(AdvMapHeroShared).xdb', x: 38, y: 37, player: 'PLAYER_2', count: 8, artifacts: [] as string[] },
    {
      shared: '/MapObjects/Necropolis/Straker.(AdvMapHeroShared).xdb', x: 34, y: 40, player: 'PLAYER_1', count: 12,
      artifacts: ['ARTIFACT_TREEBORN_QUIVER', 'ARTIFACT_H3_UNDERTAKERS_AMULET', 'ARTIFACT_H3_VAMPIRES_CLOAK', 'ARTIFACT_H3_DEAD_MANS_BOOTS'],
    },
  ],
  monster: { shared: '/Units/H3Sharpshooter/H3Sharpshooter.(AdvMapMonsterShared).xdb', x: 37, y: 40 },
  dwellings: [
    { shared: '/Dwellings/SylvanStonehenge/SylvanStonehenge.(AdvMapDwellingShared).xdb', x: 41, y: 37 },
    { shared: '/Dwellings/SylvanUnicornGlade/SylvanUnicornGlade.(AdvMapDwellingShared).xdb', x: 35, y: 44 },
    { shared: '/Dwellings/SylvanTreantArches/SylvanTreantArches.(AdvMapDwellingShared).xdb', x: 27, y: 38 },
    { shared: '/Dwellings/SylvanDragonAltar/SylvanDragonAltar.(AdvMapDwellingShared).xdb', x: 33, y: 30 },
    { shared: '/Dwellings/NecropolisEstate/NecropolisEstate.(AdvMapDwellingShared).xdb', x: 28, y: 45 },
    { shared: '/Dwellings/NecropolisMausoleum/NecropolisMausoleum.(AdvMapDwellingShared).xdb', x: 26, y: 31 },
    { shared: '/Dwellings/NecropolisHallOfDarkness/NecropolisHallOfDarkness.(AdvMapDwellingShared).xdb', x: 40, y: 29 },
    { shared: '/Dwellings/NecropolisDragonGraveyard/NecropolisDragonGraveyard.(AdvMapDwellingShared).xdb', x: 42, y: 45 },
    { shared: '/Dwellings/SharpshooterPalace/SharpshooterPalace.(AdvMapDwellingShared).xdb', x: 48, y: 37 },
    { shared: '/Dwellings/MummyPyramid/MummyPyramid.(AdvMapDwellingShared).xdb', x: 20, y: 40 },
  ],
  artifacts: [
    { shared: '/Artifacts/H3UndertakersAmulet/H3UndertakersAmulet.(AdvMapArtifactShared).xdb', x: 32, y: 39 },
    { shared: '/Artifacts/H3VampiresCloak/H3VampiresCloak.(AdvMapArtifactShared).xdb', x: 30, y: 39 },
    { shared: '/Artifacts/H3DeadMansBoots/H3DeadMansBoots.(AdvMapArtifactShared).xdb', x: 29, y: 39 },
  ],
};

/** The creature mod this map needs, wherever the real install keeps it. */
function fixtureMod(): string {
  const ours = modFile(REAL_GAME, 'mod', 'sod-creatures');
  return existsSync(ours) ? ours : join(REAL_GAME, 'UserMODs', 'sod-creatures.h5u');
}

function cleanup(): void {
  for (const p of [GAME, REF_ROOT, MAP_DIR]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
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
  if (!existsSync(join(REF, 'map.xdb'))) {
    for (const e of readEntries(readFileSync(ORIGINAL))) {
      const path = join(REF_ROOT, e.name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, e.data);
    }
  }

  // The fixture mod, into this run's own install.
  ensureModDir(GAME);
  copyFileSync(fixtureMod(), modFile(GAME, 'mod', 'sod-creatures'));

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

test('the map, built the way a person would', async () => {
  test.setTimeout(15 * 60_000);
  const { page } = ed;

  // The clean slate: this test owns the rebuild from nothing.
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
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

  // --- the neutral stack between them -----------------------------------
  await pickObject(page, PLACES.monster.shared);
  await placeOne(page, PLACES.monster.shared, PLACES.monster.x, PLACES.monster.y);
  await setObjectProp(page, 'Custom', 'true');
  await setObjectProp(page, 'Amount', '6');
  await setObjectProp(page, 'DoesNotGrow', 'true');
  await setObjectProp(page, 'Courage', 'MONSTER_COURAGE_ALWAYS_FIGHT');

  // --- the mod's ten dwellings and three artifacts ----------------------
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
  await page.locator('#mapbtn').click();
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
  const save = page.locator('#save');
  if (await save.isEnabled()) {
    await save.click();
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
  expect(gaps('diff-objects.ts', refXdb, ourXdb), 'object differences').toEqual([]);
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
    const row = page.locator('#maplist .m', { hasText: `${NAME}.mod` }).first();
    await expect(row, 'the picker lists the rebuilt map').toBeVisible();
    await row.click();
    await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
  }
  await page.locator('#pack').click();
  await hudSays(page, /^packed → /, 60_000);
  expect(existsSync(ARCHIVE)).toBe(true);

  const ours = new Set(readEntries(readFileSync(ARCHIVE)).map((e) => e.name.replace(/\\/g, '/')));
  const theirs = readEntries(readFileSync(ORIGINAL)).map((e) => e.name.replace(/\\/g, '/'));
  const missing = theirs.filter((n) => !ours.has(n));
  expect(missing, 'members of the original our archive lacks').toEqual([]);

  // The whole run converged — leave nothing behind.
  cleanup();
});

// A faction, authored through the windows: the donor's tree on the grid, a
// building dropped, one renamed and given a button, a town without magic, a
// named town, a script — saved, read back off disk, edited. Then what a race
// is made of besides its town: a class of our own and a hero of it and of
// the race (Heroes window, found in the race's pool); a row of seven tiers,
// three creatures each, linked base to upgrades (Units window); the faction's
// dwellings hiring that row. Then everything taken apart again, in the order
// the refusals name, and the faction removed.
//
// What the probe (_tmp/town12-probe.ts) wrote by hand for the Bone Court,
// this makes through the palette; the archive, the extension's files and the
// executable's four numbers are then read back the way the game would read
// them. Standing alone: the faction needs nothing another stage authored.
//
// Every press goes through `press`, which asserts the renderer threw nothing
// and no error line lit up BEFORE the next expectation waits on anything:
// a handler that died leaves the form exactly as it was, and the next
// `toBeVisible` would then sit out its timeout over a message already on
// screen.
//
// Its own game install (HOMM5_ROOT, e2e/mods.ts), so the real one is untouched.

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, REPO_ROOT, closeEditor, hudSays, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { LIVE, REAL_GAME, clearMap, isModCopyOf, modGameRoot, readInstalledMod } from './mods.ts';
import { bar } from './bar.ts';
import { catalogEntry, pickObject, placeAtTile, setObjectProp, sharedKey } from './objects.ts';
import { newMap } from './tiles.ts';
import { creaturePaths } from '../src/mods/creature-mod.ts';
import { children, childText, find, parse } from '../src/format/xml.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { PATCHED_EXE } from '../src/exe/creature-limit.ts';
import { findClamp } from '../src/exe/faction-limit.ts';
import { TOWN_SPEC_TABLE, TOWN_TYPE_TABLE, readTableLimit } from '../src/exe/table-limit.ts';
import { RACES_FILE } from '../src/mods/race-order.ts';
import { BUILDINGS_FILE } from '../src/mods/town-button.ts';
import { pngDataUri } from '../src/format/png.ts';
import { heroHref, heroPaths } from '../src/mods/heroes.ts';
import { settled } from './trace.ts';
import { HERO_GROUP } from '../src/mods/shared-groups.ts';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { pictureIcon } from '../src/mods/faction-icons.ts';
import { resolve as resolveHref } from '../src/mods/mod-art.ts';

let ed: Launched;
const GAME = modGameRoot();
const FILE = 'E2eBone';
const TYPE = 'TOWN_E2E_BONE';

/**
 * A press that is checked at once: no renderer error, no error line in either
 * dialog — except a message the test expects to still be there (`allow`).
 */
async function press(page: Page, target: Locator, allow?: RegExp): Promise<void> {
  await expect(target).toBeVisible();
  await target.click();
  expect(ed.errors, 'the renderer threw nothing on that press').toEqual([]);
  for (const id of ['#fac-err', '#fac-form-err']) {
    const line = page.locator(id);
    if (!await line.isVisible()) continue;
    if (allow) await expect(line, `${id} says only what was expected`).toHaveText(allow);
    else await expect(line, `${id} stayed empty`).toHaveText('');
  }
}

/**
 * The Necropolis graves as a folder of our own under _tmp: the four documents
 * and the two binaries, laid out as a model of ours is authored. Returns the
 * Model document's path.
 */
function ownGraves(): string {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'graves');
  rmSync(join(dir, '..'), { recursive: true, force: true });
  mkdirSync(join(dir, 'bin', 'Geometries'), { recursive: true });
  mkdirSync(join(dir, 'bin', 'AIGeometries'), { recursive: true });
  const stem = 'UneartheGrave_u1r0';
  const src = join(DATA, 'Arenas', 'Town', 'Necropolis');
  for (const f of [`${stem}.xdb`, `${stem}-geom.xdb`, `${stem}-geom-AI.xdb`, `${stem}-UnearthedGraves_M.(Material).xdb`]) {
    writeFileSync(join(dir, f), readFileSync(join(src, f)));
  }
  const uidIn = (f: string): string => /<uid>([0-9A-F-]{36})<\/uid>/i.exec(readFileSync(join(src, f), 'latin1'))![1]!.toUpperCase();
  const geom = uidIn(`${stem}-geom.xdb`);
  writeFileSync(join(dir, 'bin', 'Geometries', geom), readFileSync(join(DATA, 'bin', 'Geometries', geom)));
  const ai = uidIn(`${stem}-geom-AI.xdb`);
  writeFileSync(join(dir, 'bin', 'AIGeometries', ai), readFileSync(join(DATA, 'bin', 'AIGeometries', ai)));
  return join(dir, `${stem}.xdb`);
}

/** Necropolis's first exterior stage as a folder of ours: the model, its geometry, hull and materials, the binaries under bin/. */
function ownNecroTown(): string {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'necro');
  mkdirSync(join(dir, 'bin', 'Geometries'), { recursive: true });
  mkdirSync(join(dir, 'bin', 'AIGeometries'), { recursive: true });
  const src = join(DATA, 'MapObjects');
  mkdirSync(join(dir, '_(AdvMapTownExterior)'), { recursive: true });
  for (const t of ['Necropolis', 'Necropolis_pod', 'Necropolis_stone']) {
    for (const ext of ['xdb', 'dds']) {
      const f = `_(AdvMapTownExterior)/Necropolis-town_mg_wall1-${t}.(Texture).${ext}`;
      writeFileSync(join(dir, f), readFileSync(join(src, f)));
    }
  }
  for (const f of ['Necromancy-town.xdb', 'Necromancy-town-geom.xdb', 'Necromancy-town_AI.xdb',
    'Necromancy-town-Podlojka1.(Material).xdb', 'Necromancy-town-lambert7.(Material).xdb', 'Necromancy-town-lambert8.(Material).xdb']) {
    writeFileSync(join(dir, f), readFileSync(join(src, f)));
  }
  const uidIn = (f: string): string => /<uid>([0-9A-F-]{36})<\/uid>/i.exec(readFileSync(join(src, f), 'latin1'))![1]!.toUpperCase();
  writeFileSync(join(dir, 'bin', 'Geometries', uidIn('Necromancy-town-geom.xdb')), readFileSync(join(DATA, 'bin', 'Geometries', uidIn('Necromancy-town-geom.xdb'))));
  writeFileSync(join(dir, 'bin', 'AIGeometries', uidIn('Necromancy-town_AI.xdb')), readFileSync(join(DATA, 'bin', 'AIGeometries', uidIn('Necromancy-town_AI.xdb'))));
  // And the gate's hull as a document of its own — Necropolis keeps it inline
  // in its town record (`Gate_AI`; `Necromancy-town_AI.xdb` is the whole
  // town's hull, which the gate was given until 09.10).
  const record = readFileSync(join(src, 'Necromancy.(AdvMapTownShared).xdb'), 'utf8');
  const gate = /<AIGeometry ObjectRecordID="\d+">[\s\S]*?<\/AIGeometry>/.exec(record.slice(record.indexOf('<Gates')))![0];
  expect(gate).toContain('<RootMesh>Gate_AI</RootMesh>');
  writeFileSync(join(dir, NECRO_GATE), `<?xml version="1.0" encoding="UTF-8"?>\n${gate.replace(/^\t{4}/gm, '')}\n`);
  const gateUid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(gate)![1]!.toUpperCase();
  writeFileSync(join(dir, 'bin', 'AIGeometries', gateUid), readFileSync(join(DATA, 'bin', 'AIGeometries', gateUid)));
  return join(dir, 'Necromancy-town.xdb');
}
const NECRO_GATE = 'Necromancy-Gate_AI.xdb';

/**
 * Necropolis's siege gate as a folder of ours: its three models (whole,
 * breached, razed) with their geometries, hulls, materials and texture, the
 * binaries under bin/, and the tower's texture one of its materials names
 * beside itself. What the skeletons and the materials named from the data
 * root reach stays the data's. The gate used to be the whole town's
 * model, and the siege stood a town where its gate is (Senya, 24.10).
 */
function ownNecroGate(): string[] {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'necro-gate');
  mkdirSync(join(dir, 'bin', 'Geometries'), { recursive: true });
  mkdirSync(join(dir, 'bin', 'AIGeometries'), { recursive: true });
  const src = join(DATA, 'Arenas', 'CombatArena', 'Necropolisarena');
  const files = readdirSync(src).filter((f) => f.startsWith('gate1_') || f.startsWith('siege_tower1_u1r1-Gates.(Texture)') || f === 'gater0_AI.xdb');
  for (const f of files) writeFileSync(join(dir, f), readFileSync(join(src, f)));
  for (const f of files.filter((n) => n.endsWith('.xdb'))) {
    for (const [, uid] of readFileSync(join(src, f), 'latin1').matchAll(/<uid>([0-9A-F-]{36})<\/uid>/gi)) {
      for (const kind of ['Geometries', 'AIGeometries']) {
        const bin = join(DATA, 'bin', kind, uid!.toUpperCase());
        if (existsSync(bin)) writeFileSync(join(dir, 'bin', kind, uid!.toUpperCase()), readFileSync(bin));
      }
    }
  }
  return ['gate1_u1r0.xdb', 'gate1_u1r1.xdb', 'gate1_u1r2.xdb'].map((f) => join(dir, f));
}
/** Necropolis's entrance tile, from the town's tile: the faction stands on its ground. */
const NECRO_ENTRANCE = [1, -5] as const;

/**
 * A picture of ours: one of the game's own textures as the PNG an author would
 * have made of it. A real picture, not a test pattern — the live run puts this
 * faction in the game, and a flat magenta square read there as "no icon"
 * (Senya, 10.10).
 */
function ownPicture(name: string, dds: string): string {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-own-model');
  mkdirSync(dir, { recursive: true });
  const img = decodeDDSBuffer(readFileSync(join(DATA, dds)));
  const path = join(dir, `${name}.png`);
  writeFileSync(path, Buffer.from(pngDataUri(img.width, img.height, img.rgba).split(',')[1]!, 'base64'));
  return path;
}
const PIT_PICTURE = 'UI/TownHall/necropolis/128/UnearthedGraves.dds';
const TOWER_PICTURE = 'Textures/Interface/CombatArena/Faces/Necropolis/ico_SceletonArcher_128.dds';
const SIGN_PICTURE = 'UI/TownHall/necropolis/128/s1.dds';

/** Is a DDS in the archive the picture of ours, as the mod fits it to `size`? Pixel for pixel. */
function isThePicture(entries: { name: string; data: Buffer }[], path: string, picture: string, size: number): boolean {
  const e = entries.find((x) => x.name.split(String.fromCharCode(92)).join('/') === path);
  if (!e) return false;
  const img = decodeDDSBuffer(e.data);
  const want = pictureIcon(picture, size);
  return img.width === want.width && img.height === want.height && Buffer.from(img.rgba).equals(Buffer.from(want.rgba));
}

const cell = (page: Page, x: number, y: number): Locator => page.locator(`#fac-grid .fc-cell[data-x="${x}"][data-y="${y}"]`);

/** Is `copy` the mod's copy of `original` — see isModCopyOf. */
const isCopyOf = (copy: string | undefined, original: string, model = false): boolean => isModCopyOf(GAME, copy, original, model);

/** The four numbers in the sandbox's executable. */
function exeNumbers(): { towns: number | null; specs: number | null; clamp: number } {
  const buf = readFileSync(join(GAME, PATCHED_EXE));
  return { towns: readTableLimit(buf, TOWN_TYPE_TABLE).limit, specs: readTableLimit(buf, TOWN_SPEC_TABLE).limit, clamp: buf[findClamp(buf)]! };
}

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => {
  await closeEditor(ed);
  rmSync(join(REPO_ROOT, '_tmp', 'e2e-own-model'), { recursive: true, force: true });
  rmSync(join(REPO_ROOT, '_tmp', 'e2e-own-icon'), { recursive: true, force: true });
  // The map that placed the town names a faction that is gone by now; live, it is left to look at.
  if (!LIVE) clearMap(GAME, DATA, MAP_NAME);
});

test('the window opens on what is installed, and a blank form says what it needs', { tag: '@game' }, async () => {
  const { page } = ed;
  await press(page, page.locator('#facbtn'));
  await expect(page.locator('#facmod')).toBeVisible();
  await expect(page.locator('#fac-list')).toContainText('none yet');

  await press(page, page.locator('#fac-new'));
  await expect(page.locator('#facedit')).toBeVisible();
  await expect(page.locator('#fac-ok')).toBeDisabled();
  await expect(page.locator('#fac-missing')).toHaveText(/identifier.*race.*town name.*named town/);
  // The eight bases, in the ordinals' order, Haven first; and the eight presets.
  await expect(page.locator('#fac-donor option')).toHaveCount(8);
  await expect(page.locator('#fac-donor option').first()).toHaveText('Haven');
  await expect(page.locator('#fac-preset option')).toHaveCount(8);
  // The tree starts EMPTY (Senya, 25.10): thirty cells, nothing in them.
  await expect(page.locator('#fac-grid .fc-cell')).toHaveCount(30);
  await expect(page.locator('#fac-grid .fc-cell.empty')).toHaveCount(30);
});

test('the identifier names the type; a preset fills the empty tree, every field said', { tag: '@game' }, async () => {
  const { page } = ed;
  await page.locator('#fac-file').fill(FILE);
  await expect(page.locator('#fac-type')).toHaveValue(TYPE);
  await page.locator('#fac-race-name').fill('Bone Court');
  await page.locator('#fac-name').fill('Ossuary Town');

  // An empty cell offers a building of any of the eight towns.
  await press(page, cell(page, 1, 1));
  await expect(page.locator('#fac-cell .fc-put-town option')).toHaveCount(8);
  await expect(page.locator('#fac-cell .fc-put option', { hasText: 'new: TB_TOWN_HALL' })).toHaveCount(1);
  // A PRESET puts a town's whole tree: Haven's, to make the Court of.
  await page.locator('#fac-preset').selectOption('TOWN_HEAVEN');
  await press(page, page.locator('#fac-fill'));
  await expect(page.locator('#fac-preset-note')).toContainText(/\d+ building records of TOWN_HEAVEN/);
  // Haven's grid, as shipped: the hall at 1,1 with its levels down the
  // column, the guild at 4,2 with five levels stacked, the shipyard at 5,5.
  await expect(cell(page, 1, 1)).toContainText('TOWN_HALL');
  await expect(cell(page, 1, 1).locator('.fc-levels i')).toHaveCount(1);
  await expect(cell(page, 4, 2)).toContainText('MAGIC_GUILD');
  await expect(cell(page, 4, 2).locator('.fc-levels i')).toHaveCount(5);
  await expect(cell(page, 5, 5)).toContainText('SHIPYARD');
  await expect(cell(page, 2, 6)).toContainText('GRAIL');
  await expect(page.locator('#fac-grid .fc-levels i.edited'), 'a preset put is no edit').toHaveCount(0);
  // And every field of a building SAYS what the preset's record says —
  // filled, not a grey hint (Senya, 25.10): Haven's training grounds.
  await press(page, cell(page, 5, 3));
  const editor = page.locator('#fac-cell');
  await expect(editor.locator('input[placeholder]').first()).toHaveValue('Тренировочные залы');
  await expect(editor.locator('textarea').first()).not.toHaveValue('');
  for (const input of await editor.locator('.fc-resources input').all()) await expect(input).not.toHaveValue('');
  await expect(editor.locator('.fc-dev-level')).toHaveValue('6');
  await expect(editor.locator('.fc-from')).toHaveValue('TOWN_HEAVEN');
  await expect(editor.locator('.fc-grants'), "and it does what Haven's does").toHaveValue('');
  // Still not enough: a named town.
  await expect(page.locator('#fac-ok')).toBeDisabled();
  await expect(page.locator('#fac-missing')).toHaveText(/named town/);
});

test('a building is dropped, another renamed, priced and given a button', { tag: '@game' }, async () => {
  const { page } = ed;
  // The shipyard goes.
  await press(page, cell(page, 5, 5));
  await expect(page.locator('#fac-cell')).toContainText('TB_SHIPYARD');
  await press(page, page.locator('#fac-cell button', { hasText: 'drop the building' }));
  await expect(cell(page, 5, 5)).toHaveClass(/dropped/);
  await expect(page.locator('#fac-cell')).toContainText('DROPPED');

  // Haven's training grounds become the Bone Pit: renamed, cheaper, earlier,
  // and the dial's centre button opens it through a Lua function.
  await press(page, cell(page, 5, 3));
  await expect(page.locator('#fac-cell')).toContainText('TB_SPECIAL_1');
  const editor = page.locator('#fac-cell');
  await editor.locator('input[placeholder]').first().fill('Bone Pit');   // Name
  await editor.locator('input[placeholder]').first().dispatchEvent('change');
  await expect(cell(page, 5, 3)).toContainText('Bone Pit');
  await expect(cell(page, 5, 3).locator('.fc-levels i.edited')).toHaveCount(1);
  const gold = editor.locator('.fc-resources input').last();
  await gold.fill('2000');
  await gold.dispatchEvent('change');
  // Town level 1 — any whole number, not only the shipped 0, 3 … 15 (Senya, 23.10).
  await editor.locator('.fc-dev-level').fill('1');
  const lua = editor.locator('input[placeholder="no button"]');
  await expect(editor.locator('.fc-camp'), 'no camp without a button').toBeDisabled();
  await lua.fill('BonePit');
  await lua.dispatchEvent('change');
  // And the button opens a refugee camp — the probe's Bone Pit: a week's roll
  // over every tier but the first (Senya, 19.10; the probe's was three to six,
  // the game's own camp's pool), sold through the hire screen. Its Lua is the
  // editor's to write.
  await expect(editor.locator('.fc-camp')).toBeEnabled();
  await editor.locator('.fc-camp').check();
  await editor.locator('.fc-camp-min').selectOption('2');
  await editor.locator('.fc-camp-max').selectOption('7');
  // The camp is all it does: the preset's effect — Haven's training grounds'
  // — is taken off.
  await editor.locator('.fc-grants').selectOption('none');
  // THREE LEVELS, which Haven's training grounds have not: how many is the
  // author's to say (Senya, 21.10 — another town is an example, not a
  // template). Each new level stands in the pit's cell, one up its stack,
  // and is named and priced on its own tab; the camp opens one more offer
  // per level.
  // Said in the Court's words, and drawn: before the levels, so they start as it.
  await editor.locator('textarea').first().fill(PIT_WORDS[0]);
  const pitIcon = ownPicture('pit', PIT_PICTURE);
  await editor.locator('.fc-file').first().fill(pitIcon);
  await editor.locator('.fc-levels-count').selectOption('3');
  await expect(cell(page, 5, 3).locator('.fc-levels i')).toHaveCount(3);
  for (const [level, name, price] of [[2, 'Bone Yard', '4000'], [3, 'Bone Market', '8000']] as const) {
    await press(page, editor.locator('.fc-level-tabs button', { hasText: `level ${level}` }));
    await expect(page.locator('#fac-cell')).toContainText(`TB_SPECIAL_1/${level}`);
    // A new level starts as the pit AS EDITED, every field filled where it is
    // seen — not as Haven's training grounds it is copied from.
    await expect(editor.locator('input[placeholder]').first(), `level ${level} starts with the pit's name`).toHaveValue('Bone Pit');
    await expect(editor.locator('textarea').first()).toHaveValue(PIT_WORDS[0]);
    await expect(editor.locator('.fc-resources input').last()).toHaveValue('2000');
    await expect(editor.locator('.fc-dev-level')).toHaveValue('1');
    await expect(editor.locator('.fc-file').first(), "and the pit's icon").toHaveValue(pitIcon);
    await editor.locator('input[placeholder]').first().fill(name);
    await editor.locator('textarea').first().fill(PIT_WORDS[level - 1]!);
    const levelGold = editor.locator('.fc-resources input').last();
    await levelGold.fill(price);
    await levelGold.dispatchEvent('change');
    // No town level asked: the level below standing is enough (Senya, 23.10 —
    // the copied record asked for 6, Haven's training grounds' own).
    await editor.locator('.fc-dev-level').fill('0');
  }
  await expect(cell(page, 5, 3).locator('.fc-levels i.edited')).toHaveCount(3);

  // Haven's Hall of Heroes stood under the pit, needing it — Haven's own
  // building, read as the pit's upgrade (Senya, 21.10). The dependency
  // picker offers the cell above in the same column; then it goes.
  await press(page, cell(page, 5, 4));
  await expect(page.locator('#fac-cell')).toContainText('TB_SPECIAL_2');
  await expect(editor.locator('select').first()).toHaveValue('TB_SPECIAL_1');
  await press(page, page.locator('#fac-cell button', { hasText: 'drop the building' }));
  await expect(cell(page, 5, 4)).toHaveClass(/dropped/);

  // The rest of the tree is the Court's too, not Haven's left standing (Senya,
  // 21.10 and 24.10): Haven's Stables and Farms go — the Knights' Arena needed
  // the Stables, so it is re-parented first, or the copy refuses — and every
  // dwelling and the grail are named and described in the Court's words.
  await press(page, cell(page, 3, 5));
  await expect(page.locator('#fac-cell')).toContainText('TB_DWELLING_6');
  await expect(editor.locator('select').first()).toHaveValue('TB_SPECIAL_4');
  await editor.locator('select').first().selectOption('');
  await expect(cell(page, 3, 5).locator('.fc-arrow')).toHaveCount(0);
  for (const [x, y, type] of [[3, 4, 'TB_SPECIAL_4'], [5, 2, 'TB_SPECIAL_5']] as const) {
    await press(page, cell(page, x, y));
    await expect(page.locator('#fac-cell')).toContainText(type);
    await press(page, page.locator('#fac-cell button', { hasText: 'drop the building' }));
    await expect(cell(page, x, y)).toHaveClass(/dropped/);
  }
  // No special building but the pit (Senya, 25.10): nothing that grows the
  // dwellings, nothing that raises the dead. A building of ANOTHER town is
  // put all the same, one that does nothing special: Haven's tavern taken
  // out, and Necropolis's put in its cell, every field its own record's.
  await press(page, cell(page, 2, 1));
  await expect(page.locator('#fac-cell')).toContainText('TB_TAVERN');
  await press(page, page.locator('#fac-cell button', { hasText: 'drop the building' }));
  await expect(cell(page, 2, 1)).toHaveClass(/dropped/);
  await editor.locator('.fc-put-town').selectOption('TOWN_NECROMANCY');
  await editor.locator('.fc-put').selectOption('new:TB_TAVERN');
  await expect(page.locator('#fac-cell')).toContainText("TB_TAVERN, TOWN_NECROMANCY's");
  await expect(cell(page, 2, 1)).not.toHaveClass(/dropped|empty/);
  await expect(editor.locator('.fc-from')).toHaveValue('TOWN_NECROMANCY');
  await expect(editor.locator('input[placeholder]').first()).not.toHaveValue('');
  for (const d of COURT_DWELLINGS) {
    await press(page, cell(page, d.x, d.y));
    await expect(page.locator('#fac-cell')).toContainText(`TB_DWELLING_${d.tier}`);
    for (const [level, name] of d.names.entries()) {
      if (level) await press(page, editor.locator('.fc-level-tabs button', { hasText: 'level 2' }));
      await expect(page.locator('#fac-cell')).toContainText(`TB_DWELLING_${d.tier}${level ? '/2' : ''}`);
      await editor.locator('input[placeholder]').first().fill(name);
      await editor.locator('textarea').first().fill(d.description(level));
    }
    await expect(cell(page, d.x, d.y)).toContainText(d.names[0]);
  }
  await press(page, cell(page, 2, 6));
  await expect(page.locator('#fac-cell')).toContainText('TB_GRAIL');
  await editor.locator('input[placeholder]').first().fill(COURT_GRAIL.name);
  await editor.locator('textarea').first().fill(COURT_GRAIL.description);
  await expect(cell(page, 2, 6)).toContainText(COURT_GRAIL.name);

  // Moved by DRAGGING, right in the tree (Senya, 25.10): the grail to the
  // corner. And a building may stand only under what it needs: the Altar
  // needs the Monastery two cells up its column; dragged under the Arena,
  // its cell says so, and dragged home it is right again.
  await cell(page, 2, 6).dragTo(cell(page, 5, 6));
  await expect(cell(page, 5, 6)).toContainText(COURT_GRAIL.name);
  await expect(cell(page, 2, 6)).toHaveClass(/empty/);
  await cell(page, 4, 6).dragTo(cell(page, 3, 6));
  await expect(cell(page, 3, 6)).toContainText(COURT_DWELLINGS[6]!.names[0]);
  await expect(cell(page, 3, 6)).toHaveClass(/warn/);
  await expect(cell(page, 3, 6)).toHaveAttribute('title', /needs TB_DWELLING_5/);
  await cell(page, 3, 6).dragTo(cell(page, 4, 6));
  await expect(cell(page, 4, 6)).not.toHaveClass(/warn/);
  await expect(cell(page, 3, 6)).toHaveClass(/empty/);
  // A cell that is taken refuses the drop, by name.
  await cell(page, 5, 6).dragTo(cell(page, 1, 1));
  await expect(page.locator('#fac-form-err')).toContainText('cell 1,1 holds TB_TOWN_HALL');
  await expect(cell(page, 5, 6)).toContainText(COURT_GRAIL.name);
  // A move that lands says nothing again; the grail stays in its corner.
  await cell(page, 5, 6).dragTo(cell(page, 3, 6));
  await cell(page, 3, 6).dragTo(cell(page, 5, 6));
  await expect(page.locator('#fac-form-err')).toHaveText('');
  await expect(cell(page, 5, 6)).toContainText(COURT_GRAIL.name);
  expect(ed.errors).toEqual([]);
});


/** What the pit's three levels say: its own words, not Haven's training grounds'. */
const PIT_WORDS = [
  'Яма, куда Двор сбрасывает кости павших. Раз в неделю из неё поднимаются мертвецы на продажу.',
  'Кладбище при яме: из него поднимается вдвое больше мертвецов.',
  'Костяной рынок: мертвецов здесь продают втрое больше.',
] as const;

/** The Court's dwellings, in Haven's cells: per tier its two levels' names, and what each says. */
const COURT_DWELLINGS = [
  { tier: 1, x: 5, y: 1, names: ['Костница', 'Большая костница'], kin: 'скелетов' },
  { tier: 2, x: 2, y: 2, names: ['Курган', 'Чумной курган'], kin: 'ходячих мертвецов' },
  { tier: 3, x: 3, y: 2, names: ['Склеп теней', 'Склеп стенаний'], kin: 'призраков' },
  { tier: 4, x: 3, y: 3, names: ['Кровавый особняк', 'Кровавый дворец'], kin: 'вампиров' },
  { tier: 5, x: 4, y: 4, names: ['Гробница магов', 'Гробница архимагов'], kin: 'личей' },
  { tier: 6, x: 3, y: 5, names: ['Могильник', 'Великий могильник'], kin: 'умертвий' },
  { tier: 7, x: 4, y: 6, names: ['Драконье кладбище', 'Кладбище теней'], kin: 'костяных драконов' },
].map((d) => ({
  ...d,
  description: (level: number): string => level
    ? `Перестроенное жилище ${d.tier}-го круга Двора: здесь нанимают улучшенных ${d.kin}, все — из кости.`
    : `Жилище ${d.tier}-го круга Двора: здесь поднимают ${d.kin}, все — из кости.`,
}));
const COURT_GRAIL = { name: 'Костяной трон', description: 'Святыня Двора, выстроенная вокруг Грааля.' };

test('a town without magic, a named town, a script — and it saves', { tag: '@game' }, async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await page.locator('#fac-magic').selectOption('none');
  await expect(page.locator('#fac-schools-row')).toBeHidden();
  // What the engine compiled per race: the side the morale reads, and whose
  // skill values the AI levels a hero of the race up by.
  await page.locator('#fac-alignment').selectOption('evil');
  await page.locator('#fac-ai-like').selectOption('TOWN_NECROMANCY');
  // The skill table: every skill listed, nothing said until filled; a fill
  // from Sylvan copies its column, and one cell is then said differently.
  const rows = page.locator('#fac-ai-table tbody tr');
  // Every skill: the game's 220 and, run in the chain, the ones 004 authored —
  // which carry values of their own for every town, so a fill says them too.
  const skills = await rows.count();
  expect(skills).toBeGreaterThanOrEqual(220);
  await expect(page.locator('#fac-ai-count')).toHaveText(`0 of ${skills} said`);
  await page.locator('#fac-ai-fill-from').selectOption('TOWN_PRESERVE');
  await press(page, page.locator('#fac-ai-fill'));
  await expect(page.locator('#fac-ai-count')).toHaveText(`${skills} of ${skills} said`);
  const archery = rows.filter({ has: page.locator('td.skill[title^="HERO_SKILL_ARCHERY "]') });
  await expect(archery).toHaveClass(/said/);
  await expect(archery.locator('input[data-role="commander"]')).toHaveValue('4000');
  await archery.locator('input[data-role="commander"]').fill('7500');
  await page.locator('#fac-ai-filter').fill('стрельб');
  await expect(archery).not.toHaveClass(/hidden/);
  await expect(rows.first()).toHaveClass(/hidden/);
  await page.locator('#fac-ai-filter').fill('');

  await press(page, page.locator('#fac-town-add'));
  await expect(page.locator('#fac-towns .fc-town-row')).toHaveCount(1);
  await page.locator('#fac-towns .town-file').fill('Ossuary');
  await page.locator('#fac-towns .town-name').fill('The Ossuary');
  await page.locator('#fac-towns .town-bio').fill('Where the bones are kept.');
  // The author's own Lua — the camp's is written after it. Defining BonePit
  // here as well is refused (tools/test-camp-script.ts).
  await page.locator('#fac-script').fill('-- The Bone Court\'s own words.\nBONE_COURT_MOTTO = "The dead keep their count.";');
  // The pit's button is drawn in the icon theme, so the theme is asked for.
  await expect(page.locator('#fac-missing')).toHaveText(/icon theme/);
  await page.locator('#fac-icons').check();
  await expect(page.locator('#fac-missing')).toHaveText('');
  await expect(page.locator('#fac-ok')).toBeEnabled();

  // Haven's Monastery needs the guild, and a town without magic never builds
  // one: the copier refuses, by name, and the form shows the refusal rather
  // than closing over it.
  await page.locator('#fac-ok').click();
  await expect(page.locator('#fac-form-err')).toContainText('TB_DWELLING_5 needs TB_MAGIC_GUILD', { timeout: 300_000 });
  await expect(page.locator('#facedit')).toBeVisible();
  expect(ed.errors).toEqual([]);
  // Re-parented to nothing — the column above it holds only the guild.
  await press(page, cell(page, 4, 4), /TB_DWELLING_5 needs TB_MAGIC_GUILD|^$/);
  await expect(page.locator('#fac-cell')).toContainText('TB_DWELLING_5');
  await page.locator('#fac-cell select').first().selectOption('');
  await expect(cell(page, 4, 4).locator('.fc-arrow')).toHaveCount(0);

  await press(page, page.locator('#fac-ok'), /TB_DWELLING_5 needs TB_MAGIC_GUILD|^$/);
  // The town copy is the donor's whole closure: a while.
  await expect(page.locator('#facedit')).toBeHidden({ timeout: 300_000 });
  await expect(page.locator('#fac-form-err')).toHaveText('');
  await expect(page.locator('#fac-note')).toContainText(`${TYPE} = 11`);
  await expect(page.locator('#fac-note')).toContainText('town types 12');
  await expect(page.locator('#fac-list')).toContainText('Bone Court');
  await expect(page.locator('#fac-list')).toContainText(TYPE);
  expect(ed.errors).toEqual([]);
});

test('what landed on disk is the faction as the form said it', { tag: '@game' }, async () => {
  const mod = readInstalledMod(GAME);
  const f = mod.factions?.[0];
  expect(f, 'the manifest carries the faction').toBeTruthy();
  expect(f!.type).toBe(TYPE);
  expect(f!.number).toBe(11);
  expect(f!.donor).toBe('TOWN_HEAVEN');
  expect(f!.magic).toBe('none');
  expect(f!.race?.name).toBe('Bone Court');
  expect(f!.towns).toEqual([{ file: 'Ossuary', name: 'The Ossuary', biography: 'Where the bones are kept.', bonus: 'TOWN_NO_BONUS' }]);
  // The tree started empty and holds what was put: Haven's, as the preset put
  // it, less what was taken out — which is simply not there.
  expect(f!.tree).toBe('empty');
  expect(f!.buildings?.TB_BLACKSMITH, 'a building put and not changed is its town alone').toEqual({ from: 'TOWN_HEAVEN' });
  // Necropolis's stands at 3,1 at home; here in Haven's tavern's cell.
  expect(f!.buildings?.TB_TAVERN, "the tavern is Necropolis's").toEqual({ from: 'TOWN_NECROMANCY', slot: { x: 2, y: 1 } });
  // No special building but the pit (Senya, 25.10).
  const specials = [...new Set(Object.keys(f!.buildings ?? {}).filter((k) => k.startsWith('TB_SPECIAL_') && f!.buildings![k] !== null).map((k) => k.split('/')[0]))];
  expect(specials, 'the pit is the one special building').toEqual(['TB_SPECIAL_1']);
  expect(f!.buildings?.TB_SHIPYARD).toBeUndefined();
  expect(f!.buildings?.TB_SPECIAL_1).toMatchObject({ from: 'TOWN_HEAVEN', grants: null, name: 'Bone Pit', description: PIT_WORDS[0], cost: { Gold: 2000 }, devLevel: 1, levels: 3, button: { lua: 'BonePit', camp: { minTier: 2, maxTier: 7 } } });
  expect(f!.buildings?.['TB_SPECIAL_1/2']).toMatchObject({ name: 'Bone Yard', description: PIT_WORDS[1], cost: { Gold: 4000 }, devLevel: 0 });
  expect(f!.buildings?.['TB_SPECIAL_1/3']).toMatchObject({ name: 'Bone Market', description: PIT_WORDS[2], cost: { Gold: 8000 }, devLevel: 0 });
  expect(f!.buildings?.TB_SPECIAL_2, "Haven's Hall of Heroes is gone").toBeUndefined();
  expect(f!.buildings?.TB_DWELLING_5).toMatchObject({ requires: [] });
  // Haven's Stables and Farms are gone, the Arena that needed them re-parented,
  // and every dwelling and the grail say the Court's words.
  expect(f!.buildings?.TB_SPECIAL_4, "Haven's Stables are gone").toBeUndefined();
  expect(f!.buildings?.TB_SPECIAL_5, "Haven's Farms are gone").toBeUndefined();
  expect(f!.buildings?.TB_DWELLING_6).toMatchObject({ requires: [] });
  expect(f!.buildings?.TB_DWELLING_7, 'the Altar, dragged away and home, stands where it stood').not.toHaveProperty('slot');
  expect(f!.buildings?.TB_GRAIL, 'the grail, dragged to the corner').toMatchObject({ slot: { x: 5, y: 6 } });
  for (const d of COURT_DWELLINGS) {
    for (const [level, name] of d.names.entries()) {
      const key = `TB_DWELLING_${d.tier}${level ? '/2' : ''}`;
      expect(f!.buildings?.[key], key).toMatchObject({ name, description: d.description(level) });
    }
  }
  expect(f!.buildings?.TB_GRAIL).toMatchObject(COURT_GRAIL);
  expect(f!.script).toContain('BONE_COURT_MOTTO');
  expect(f!.icons?.field).toEqual([58, 28, 66, 255]);
  expect(f!.alignment).toBe('evil');
  expect(f!.ai?.skillsLike).toBe('TOWN_NECROMANCY');
  // Every skill the table listed, said: 220 alone, more in the chain.
  const said = Object.keys(f!.ai?.skillValues ?? {}).length;
  expect(said).toBeGreaterThanOrEqual(220);
  expect(f!.ai?.skillValues?.[35]).toEqual({ commander: 7500, collectorSupplier: 1000, freelancer: 4000 });
  expect(f!.mapDwellings).toBeUndefined();

  const names = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM))).map((e) => e.name.split('\\').join('/'));
  const has = (p: string | RegExp): boolean => names.some((n) => (typeof p === 'string' ? n === p : p.test(n)));
  expect(has(`Factions/${FILE}/${FILE}.(AdvMapTownShared).xdb`), 'the town').toBe(true);
  expect(has(`Factions/${FILE}/race.txt`), 'the race name').toBe(true);
  expect(has(`Factions/${FILE}/towns/Ossuary.xdb`), 'the named town').toBe(true);
  expect(has(`scripts/homm5-editor/faction-${FILE}.lua`), 'the script').toBe(true);
  expect(has(`Factions/${FILE}/town/GameMechanics/TownBuildingSharedStats/Haven/Shipyard/Shipyard.xdb`), "the shipyard's record was never copied").toBe(false);
  expect(names.some((n) => /^Factions\/E2eBone\/town\/GameMechanics\/TownBuildingSharedStats\/Haven\/Special_1\//.test(n)), "the pit's record was").toBe(true);
  for (const level of [2, 3]) {
    expect(has(`Factions/${FILE}/town/GameMechanics/TownBuildingSharedStats/Haven/Special_1/Training_Grounds_L${level}.xdb`), `the pit's level ${level}`).toBe(true);
  }
  expect(names.some((n) => /TownBuildingSharedStats\/Haven\/Special_2\//.test(n)), "the Hall of Heroes' record was never copied").toBe(false);
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const text = (p: string): string => entries.find((e) => e.name.split('\\').join('/') === p)!.data.toString('latin1');
  // What the game shows: the names the town's records point at, as texts.
  const byPath = new Map(entries.map((e) => [e.name.split('\\').join('/').toLowerCase(), e.data]));
  const shownNames = new Set([...byPath].filter(([p, data]) => p.startsWith(`factions/${FILE.toLowerCase()}/`) && p.endsWith('.xdb') && data.includes('<NameFileRef'))
    .map(([p, data]) => {
      const href = /<NameFileRef href="([^"]+)"/.exec(data.toString('latin1'))?.[1];
      const at = href ? resolveHref(p, href) : null;
      return at ? byPath.get(at.toLowerCase())?.subarray(2).toString('utf16le').trim() : undefined;
    })
    .filter((n): n is string => !!n));
  for (const name of [...COURT_DWELLINGS.flatMap((d) => d.names), COURT_GRAIL.name]) expect(shownNames.has(name), `the town shows ${name}`).toBe(true);
  expect(names.some((n) => /^Factions\/E2eBone\/town\/GameMechanics\/TownBuildingSharedStats\/Necromancy\/Tavern\//.test(n)), "the tavern is Necropolis's record").toBe(true);
  expect(names.some((n) => /TownBuildingSharedStats\/Haven\/Tavern\//.test(n)), "and Haven's never copied").toBe(false);
  for (const haven of ['Крестьянские хижины', 'Рыцарская арена', 'Небесный алтарь', 'Часовой Эльрата', 'Конюшни', 'Фермы']) {
    expect(shownNames.has(haven), `no ${haven} of Haven's is left`).toBe(false);
  }
  expect(text(`Factions/${FILE}/town/GameMechanics/TownBuildingSharedStats/Haven/Special_1/Training_Grounds.xdb`),
    'the pit asks for town level 1').toContain('<DevLevelNeeded>1</DevLevelNeeded>');
  for (const level of [2, 3]) {
    expect(text(`Factions/${FILE}/town/GameMechanics/TownBuildingSharedStats/Haven/Special_1/Training_Grounds_L${level}.xdb`),
      `level ${level} asks for no town level`).toContain('<DevLevelNeeded>0</DevLevelNeeded>');
  }
  // The faction's Lua: the author's words, then the camp the button opens.
  const factionLua = text(`scripts/homm5-editor/faction-${FILE}.lua`);
  expect(factionLua).toContain('BONE_COURT_MOTTO');
  expect(factionLua).toContain('function BonePit(town)');
  expect(factionLua).toContain('BonePit_MIN_TIER = 2;');
  expect(factionLua).toContain('BonePit_MAX_TIER = 7;');
  expect(factionLua).toContain('H5EHireScreen("bought=BonePit_Bought"');
  expect(factionLua.indexOf('BONE_COURT_MOTTO')).toBeLessThan(factionLua.indexOf('function BonePit('));
  expect(text('types.xml')).toContain(`<Item>${TYPE}</Item>`);
  expect(text('types.xml')).toContain('<Item>RACE_E2E_BONE</Item>');
  expect(text('UI/UIGameRoot.(UIGameRoot).xdb')).toContain('<ID>town_buildings_8</ID>');
  expect(text('GameMechanics/RefTables/TownTypesInfo.xdb')).toContain(`<ID>${TYPE}</ID>`);

  // The extension's files beside the executable, and the executable itself.
  const races = readFileSync(join(GAME, RACES_FILE), 'latin1');
  expect(races.split('\n').filter((l) => l.startsWith('race ')).length).toBe(9);
  expect(races).toContain(`race 11 ${TYPE} race_e2ebone race_tooltip_e2ebone`);
  expect(races).toMatch(/^trait 11 alignment evil$/m);
  expect(races).toMatch(/^trait 11 ai-skills-like 7$/m);
  expect(races).not.toContain('trait 11 dwellings');
  // Every skill said: Sylvan's column, but the one cell edited (Archery is 35).
  expect(races.split('\n').filter((l) => l.startsWith('skillvalue 11 ')).length).toBe(said);
  expect(races).toMatch(/^skillvalue 11 35 7500 1000 4000$/m);
  expect(races).toMatch(/^skillvalue 11 1 3000 4000 3000$/m);
  const buildings = readFileSync(join(GAME, BUILDINGS_FILE), 'latin1');
  expect(buildings).toMatch(/^button 11 \d+ \d+ BonePit$/m);
  // What the buildings do: nothing special — the pit (our SPECIAL_1) only
  // its camp, and no other special building stands to grow a dwelling or
  // raise the dead (Senya, 25.10).
  expect(buildings, 'no compiled effect at all').not.toMatch(/^feature 11 /m);
  expect(exeNumbers()).toEqual({ towns: 12, specs: 256, clamp: 8 });
});

test('editing reloads the tree with the edits over it, and saving keeps the ordinal', { tag: '@game' }, async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#fac-list .um-item button[title*="change it"]').first());
  await expect(page.locator('#facedit')).toBeVisible();
  await expect(page.locator('#fac-file')).toHaveValue(FILE);
  await expect(page.locator('#fac-file')).toHaveAttribute('readonly', '');
  await expect(page.locator('#fac-editing')).toContainText('ordinal 11');
  await expect(page.locator('#fac-magic')).toHaveValue('none');
  await expect(page.locator('#fac-alignment')).toHaveValue('evil');
  await expect(page.locator('#fac-ai-like')).toHaveValue('TOWN_NECROMANCY');
  await expect(page.locator('#fac-ai-count')).toHaveText(/^(\d+) of \1 said$/);
  await expect(page.locator('#fac-ai-table tbody tr').filter({ has: page.locator('td.skill[title^="HERO_SKILL_ARCHERY "]') }).locator('input[data-role="commander"]')).toHaveValue('7500');
  // The tree as saved: what was taken out is not there at all — its cells empty.
  await expect(cell(page, 5, 5)).toHaveClass(/empty/);
  await expect(cell(page, 5, 3)).toContainText('Bone Pit');
  await expect(cell(page, 5, 3).locator('.fc-levels i'), 'the pit\'s three levels, back from the manifest').toHaveCount(3);
  await expect(cell(page, 5, 4)).toHaveClass(/empty/);
  await expect(cell(page, 3, 4)).toHaveClass(/empty/);
  await expect(cell(page, 2, 1)).toContainText('TAVERN');
  await expect(cell(page, 5, 6)).toContainText(COURT_GRAIL.name);
  await expect(page.locator('#fac-towns .town-name')).toHaveValue('The Ossuary');

  // A model of OUR OWN for the pit: the Necropolis graves as a folder on
  // disk — the documents beside each other, the binaries under bin/ as the
  // game keys them — named by its path in the same field a data path goes in,
  // and stood at a point of the scene.
  const own = ownGraves();
  await press(page, cell(page, 5, 3));
  await expect(page.locator('#fac-cell')).toContainText('TB_SPECIAL_1');
  await expect(page.locator('#fac-cell .fc-model-place')).toBeDisabled();
  await page.locator('#fac-cell .fc-model').fill(own);
  await expect(page.locator('#fac-cell .fc-model-place')).toBeEnabled();
  const at = page.locator('#fac-cell .fc-model-at');
  await at.nth(0).fill('250');
  await at.nth(1).fill('340');
  await at.nth(2).fill('10');
  // And a picture of ours for the pit's icon — the same field shape.
  const pitIcon = ownPicture('pit', PIT_PICTURE);
  await page.locator('#fac-cell .fc-file').first().fill(pitIcon);

  // A picture for the siege tower's portrait, a tooltip for the picker, the
  // first exterior stage as a model of ours, and a bonus said in words.
  const towerPic = ownPicture('tower', TOWER_PICTURE);
  await page.locator('#fac-pictures .fc-file').nth(3).fill(towerPic);
  await page.locator('#fac-race-tooltip').fill('The dead of the Bone Court');
  const necro = ownNecroTown();
  await press(page, page.locator('#facedit summary', { hasText: 'stage by stage' }));
  // The Exterior select is a preset: it SAYS the ten rows, the gate and the
  // ground, one town's all — a town has one ground plan for its ten stages
  // (Senya, 23.10). Back to the donor's, and the rows say nothing again.
  const stageRows = page.locator('#fac-stages .fc-stage');
  await expect(stageRows).toHaveCount(10);
  await page.locator('#fac-exterior').selectOption('TOWN_DUNGEON');
  for (const row of await stageRows.all()) await expect(row).toHaveValue('TOWN_DUNGEON');
  await expect(page.locator('#fac-exterior-gates')).toHaveValue('TOWN_DUNGEON');
  await expect(page.locator('#fac-exterior-ground')).toHaveValue('TOWN_DUNGEON');
  await page.locator('#fac-exterior').selectOption('');
  for (const row of await stageRows.all()) await expect(row).toHaveValue('');
  await expect(page.locator('#fac-exterior-ground')).toHaveValue('');
  // Then the mix this spec keeps on purpose — the first stage a model of ours,
  // the other nine the donor's, the ground Necropolis's: holes at the walled
  // stages, the case the preview of FACTION_PLAN 2f has to show.
  await page.locator('#fac-stages .fc-stage-file').first().fill(necro);
  await expect(page.locator('#fac-stages .fc-stage').first()).toBeDisabled();
  // The gate hull as an AIGeometry of ours (the same folder holds Necropolis's),
  // the ground the model stands on said — a gate of ours names no town — and
  // the capture sign and flag as pictures.
  await page.locator('#fac-exterior-gates-file').fill(join(necro, '..', NECRO_GATE));
  await expect(page.locator('#fac-exterior-gates')).toBeDisabled();
  await page.locator('#fac-exterior-ground').selectOption('TOWN_NECROMANCY');
  const signPic = ownPicture('sign', SIGN_PICTURE);
  await page.locator('#fac-pictures .fc-file').nth(11).fill(signPic);
  await page.locator('#fac-pictures .fc-file').nth(12).fill(signPic);
  // And the siege gate as models of ours — Necropolis's gate, whole, breached
  // and razed, standing where the donor's stands.
  const gateModels = ownNecroGate();
  await press(page, page.locator('#facedit summary', { hasText: 'Siege parts of your own' }));
  await page.locator('#fac-siege-own .fc-siege-gate-models').fill(gateModels[0]!);
  await page.locator('#fac-siege-own .fc-siege-gate-damaged').fill(gateModels[1]!);
  await page.locator('#fac-siege-own .fc-siege-gate-destroyed').fill(gateModels[2]!);
  // A town track of ours: the game plays music from loose files, so the
  // install copies it under Music/H5E/<faction>/ and the row points there.
  // Real ones, the game's own Necropolis theme and guild click: the live run
  // plays them in the game.
  const ogg = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'town.ogg');
  writeFileSync(ogg, readFileSync(join(REAL_GAME, 'Music', 'Town-Themes', 'Town-Necropolis.ogg')));
  await press(page, page.locator('#facedit summary', { hasText: 'Tracks and sounds of your own' }));
  await page.locator('#fac-tracks .fc-file').first().fill(ogg);
  // And the guild's click as a WAV of ours — a binary inside the mod, not a loose file.
  const wav = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'click.wav');
  writeFileSync(wav, readFileSync(join(DATA, 'bin', 'Sounds', 'DBF6AE46-D441-478F-A9C4-5C5819F02C77')));   // MageGuild.xdb's
  await page.locator('#fac-sounds .fc-file').nth(1).fill(wav);

  // One more named town, and the shipyard after all — put back in its empty
  // cell as Haven's, a building like any other.
  await press(page, page.locator('#fac-town-add'));
  await page.locator('#fac-towns .town-file').nth(1).fill('Charnel');
  await page.locator('#fac-towns .town-name').nth(1).fill('Charnel House');
  await page.locator('#fac-towns .town-bonus-text').nth(1).fill('A marketplace from the first day.');
  await press(page, cell(page, 5, 5));
  await page.locator('#fac-cell .fc-put-town').selectOption('TOWN_HEAVEN');
  await page.locator('#fac-cell .fc-put').selectOption('new:TB_SHIPYARD');
  await expect(cell(page, 5, 5)).toContainText('SHIPYARD');
  await expect(cell(page, 5, 5)).not.toHaveClass(/dropped|empty/);

  await press(page, page.locator('#fac-ok'));
  await expect(page.locator('#facedit')).toBeHidden({ timeout: 300_000 });
  await expect(page.locator('#fac-note')).toContainText(`${TYPE} = 11`);
  const f = readInstalledMod(GAME).factions?.[0];
  expect(f?.number).toBe(11);
  expect(f?.towns.length).toBe(2);
  expect(f?.buildings?.TB_SHIPYARD, "put back: Haven's, nothing changed").toEqual({ from: 'TOWN_HEAVEN' });
  // Every file of ours is the MOD'S copy now — taken in before the build,
  // and the manifest names the copy, never the place it was picked from.
  expect(isCopyOf(f?.buildings?.TB_SPECIAL_1?.model?.source, own, true), "the pit model is the mod's copy").toBe(true);
  expect(f?.buildings?.TB_SPECIAL_1?.model?.at).toEqual({ x: 250, y: 340, z: 10 });
  const names = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM))).map((e) => e.name.split(String.fromCharCode(92)).join('/'));
  expect(names).toContain(`Factions/${FILE}/buildings/${FILE}_special_1/own/graves/UneartheGrave_u1r0.xdb`);
  expect(names).toContain(`Factions/${FILE}/buildings/${FILE}_special_1/own/graves/UneartheGrave_u1r0-geom.xdb`);
  // The pictures, the stage, the words.
  expect(isCopyOf(f?.pictures?.buildings?.TB_SPECIAL_1, pitIcon)).toBe(true);
  expect(isCopyOf(f?.pictures?.tower, towerPic)).toBe(true);
  expect(isCopyOf(f?.pictures?.capture?.sign, signPic) && isCopyOf(f?.pictures?.capture?.flag, signPic)).toBe(true);
  expect(f?.race?.tooltip).toBe('The dead of the Bone Court');
  const ext = f?.exterior as { stages?: { town?: string }; gates?: string; ground?: string } | undefined;
  expect(isCopyOf(ext?.stages?.town, necro, true)).toBe(true);
  expect(isCopyOf(ext?.gates, join(necro, '..', NECRO_GATE), true)).toBe(true);
  expect(names).toContain(`Factions/${FILE}/town/own/necro/${NECRO_GATE}`);
  // The ground is Necropolis's: the tile a hero enters by is its (1,-5), not
  // Haven's (1,-6) a row past the model's gate.
  expect(ext?.ground).toBe('TOWN_NECROMANCY');
  const record = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .find((e) => e.name.split(String.fromCharCode(92)).join('/') === `Factions/${FILE}/${FILE}.(AdvMapTownShared).xdb`)!.data.toString('latin1');
  expect(/<activeTiles>\s*<Item>\s*<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/.exec(record)?.slice(1)).toEqual(NECRO_ENTRANCE.map(String));
  const siege = f?.siege as { arena?: string; gate?: { models?: string[]; damaged?: string[]; destroyed?: string[] } } | undefined;
  expect(siege?.arena).toBe('TOWN_HEAVEN');
  expect(siege?.gate?.models?.length === 1 && isCopyOf(siege.gate.models[0], gateModels[0]!, true), 'the whole gate').toBe(true);
  expect(isCopyOf(siege?.gate?.damaged?.[0], gateModels[1]!, true), 'the breached gate').toBe(true);
  expect(isCopyOf(siege?.gate?.destroyed?.[0], gateModels[2]!, true), 'the razed gate').toBe(true);
  expect(isCopyOf(f?.race?.tracks?.town, ogg)).toBe(true);
  expect(isCopyOf(f?.race?.sounds?.guild, wav)).toBe(true);
  expect(names).toContain(`Factions/${FILE}/sounds/guild.(Sound).xdb`);
  expect(names.some((n) => n.startsWith('bin/Sounds/')), 'the click is a binary of the mod').toBe(true);
  expect(existsSync(join(GAME, 'Music', 'H5E', FILE, 'town.ogg')), 'the track is copied loose under the game').toBe(true);
  expect(names).toContain(`Factions/${FILE}/music/town.(Music).xdb`);
  expect(names).toContain(`Factions/${FILE}/siege/gate_1/${FILE}_gate_1.(ArenaModObject).xdb`);
  // The gate's object names Necropolis's gate at each ruin level, not a town.
  const gateObject = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .find((e) => e.name.split(String.fromCharCode(92)).join('/') === `Factions/${FILE}/siege/gate_1/${FILE}_gate_1.(ArenaModObject).xdb`)!.data.toString('latin1');
  const ruinModels = [...gateObject.matchAll(/<Model href="\/([^"#]+)#/g)].map((m) => m[1]!.split('/').pop());
  expect(ruinModels, 'whole, breached, razed').toEqual(['gate1_u1r0.xdb', 'gate1_u1r1.xdb', 'gate1_u1r2.xdb']);
  expect(f?.towns[1]?.bonusText).toBe('A marketplace from the first day.');
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  expect(isThePicture(entries, `Factions/${FILE}/icons/special_1_1.dds`, pitIcon, 128), "the pit's icon is the picture").toBe(true);
  for (const level of [2, 3]) expect(isThePicture(entries, `Factions/${FILE}/icons/special_1_${level}.dds`, pitIcon, 128), `level ${level} has the pit's icon`).toBe(true);
  expect(isThePicture(entries, `Factions/${FILE}/icons/tower.dds`, towerPic, 128), "the tower's portrait is the picture").toBe(true);
  expect(isThePicture(entries, `Factions/${FILE}/capture/02Red/Flag.(Texture).dds`, signPic, 55), 'the flag is the picture, in every colour').toBe(true);
  expect(names).toContain(`Factions/${FILE}/town/own/necro/Necromancy-town.xdb`);
  expect(names).toContain(`Factions/${FILE}/towns/Charnel_Bonus.txt`);
  const tooltip = entries.find((e) => e.name.split(String.fromCharCode(92)).join('/') === 'UI/MPWait/PlayersList/Item/race_tooltip_e2ebone.txt')!;
  expect(tooltip.data.subarray(2).toString('utf16le')).toBe('The dead of the Bone Court');
  expect(exeNumbers()).toEqual({ towns: 12, specs: 257, clamp: 8 });
  expect(ed.errors).toEqual([]);
});

// The author moves or deletes the folder the files of theirs were picked from
// — here, the _tmp folder this spec authored them in. The mod took copies at
// install and works from those alone: saving the faction again rebuilds the
// whole mod, and it comes out with the same files. (Everything after this
// rebuilds it again — the class, the hero, twenty-one creatures — without
// the originals too.)
test("the author's own files can go: the mod works from its copies", { tag: '@game' }, async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  const ownOf = (): Map<string, Buffer> => new Map(readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .map((e) => [e.name.split(String.fromCharCode(92)).join('/'), e.data] as const)
    .filter(([n]) => n.startsWith(`Factions/${FILE}/`) && /\/own\/|\/icons\/|\/sounds\/|\/capture\//.test(n)));
  const before = ownOf();
  expect(before.size, 'the faction carries files of ours').toBeGreaterThan(0);

  const originals = join(REPO_ROOT, '_tmp', 'e2e-own-model');
  rmSync(originals, { recursive: true, force: true });
  expect(existsSync(originals), 'the originals are gone').toBe(false);

  await press(page, page.locator('#fac-list .um-item button[title*="change it"]').first());
  await expect(page.locator('#facedit')).toBeVisible();
  await expect(page.locator('#fac-exterior-ground'), 'the ground said is shown').toHaveValue('TOWN_NECROMANCY');
  await press(page, page.locator('#fac-ok'));
  await expect(page.locator('#facedit')).toBeHidden({ timeout: 300_000 });
  await expect(page.locator('#fac-note')).toContainText(`${TYPE} = 11`);

  const f = readInstalledMod(GAME).factions?.[0];
  expect(existsSync(f!.buildings!.TB_SPECIAL_1!.model!.source), 'the manifest names a copy that is there').toBe(true);
  expect((f!.exterior as { ground?: string }).ground, '...and kept').toBe('TOWN_NECROMANCY');
  expect(f!.buildings?.TB_SPECIAL_1?.button?.camp, 'the camp kept as well').toEqual({ minTier: 2, maxTier: 7 });
  const after = ownOf();
  expect([...after.keys()].sort(), 'the same files of ours').toEqual([...before.keys()].sort());
  for (const [name, data] of before) expect(after.get(name)!.equals(data), `${name} is the same bytes`).toBe(true);
  expect(ed.errors).toEqual([]);
});

/** The class of our own this spec makes, and the hero of it and of the race. */
const CLASS = { id: 'HERO_CLASS_E2E_REAPER', name: 'Reaper of the e2e' };
// Brem, as the probe's lord was (TestBrem, 'Брем Костяной') — not Ossir, a ranger of the
// elves, which is what the race's hero was until 23.10.
const HERO = { id: 'E2eBoneLord', name: 'Брем Костяной', preset: 'Brem' };

// A CLASS OF OUR OWN AND A HERO OF IT AND OF THE RACE. His race is his
// TownType — not his class: the class decides what a level-up offers, the
// TownType which taverns offer him and whether the faction's install lists
// him in the random hero pool, where a race's starting hero is drawn from
// (docs/engineInternals/FACTIONS.md: a race with nobody in the pool starts
// with no hero and is out before the first turn). So the two are chosen
// apart, and a faction of ours has both: a class made here, and the race.
test('a class of our own, and a hero of it and of the race, made in the Heroes window', { tag: '@game' }, async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#fac-close'));
  await expect(page.locator('#facmod')).toBeHidden();

  await press(page, page.locator('#heroesbtn'));
  await expect(page.locator('#heroesmod')).toBeVisible();
  await press(page, page.locator('#hm-tabs button', { hasText: 'Classes' }));
  await press(page, page.locator('#hc-new'));
  await expect(page.locator('#classedit')).toBeVisible();
  await press(page, page.locator('#hc-donor-pick'));
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('NECROMANCER');
  await press(page, page.locator('#pp-list button', { hasText: 'NECROMANCER' }).first());
  await expect(page.locator('#hc-skill-total')).toHaveText(/100/);
  await page.locator('#hc-id').fill(CLASS.id);
  await page.locator('#hc-name').fill(CLASS.name);
  const made = await settled(page, 'installing the class', '#hm-note', '#hc-err',
    () => page.locator('#hc-ok').click());
  expect(made).toContain('Installed');
  await expect(page.locator('#hc-list')).toContainText(CLASS.name);
  expect(ed.errors).toEqual([]);

  await press(page, page.locator('#hm-tabs button', { hasText: 'Heroes' }));
  await press(page, page.locator('#hm-new'));
  await expect(page.locator('#heroedit')).toBeVisible();
  await press(page, page.locator('#he-preset-pick'));
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill(HERO.preset);
  await press(page, page.locator('#pp-list button', { hasText: HERO.preset }).first());
  await expect(page.locator('#he-model')).not.toHaveValue('', { timeout: 30_000 });

  // The faction is offered beside the game's eight, marked as the mod's.
  const ours = page.locator(`#he-town option[value="${TYPE}"]`);
  await expect(ours, 'the faction is a town a hero can be of').toHaveCount(1);
  await expect(ours).toHaveText(/Bone Court.*ours/);
  const classBefore = await page.locator('#he-class').inputValue();
  await page.locator('#he-town').selectOption(TYPE);
  await expect(page.locator('#he-class'), 'a faction of ours names no class; the preset\'s stays').toHaveValue(classBefore);
  // ...and the class is chosen on its own: ours.
  await expect(page.locator(`#he-class option[value="${CLASS.id}"]`)).toHaveText(/Reaper of the e2e.*ours/);
  await page.locator('#he-class').selectOption(CLASS.id);
  await page.locator('#he-id').fill(HERO.id);
  await page.locator('#he-name').fill(HERO.name);
  await expect(page.locator('#he-ok')).toBeEnabled();
  // settled(): either the install note or the form's refusal, said as it is.
  const note = await settled(page, 'installing the hero of the race', '#hm-note', '#he-err',
    () => page.locator('#he-ok').click());
  expect(note).toContain('Installed');
  await expect(page.locator('#hm-list')).toContainText(HERO.name);
  expect(ed.errors).toEqual([]);

  // What landed: the manifest, his document, and the pool.
  const hero = (readInstalledMod(GAME).heroes ?? []).find((h) => h.id === HERO.id);
  expect(hero, 'the manifest holds him').toBeTruthy();
  expect(hero!.town).toBe(TYPE);
  expect(hero!.heroClass).toBe(CLASS.id);
  const doc = archiveText(heroPaths(hero!).shared);
  expect(doc, 'his document says his race').toContain(`<TownType>${TYPE}</TownType>`);
  expect(doc, '...and his class, ours').toContain(`<Class>${CLASS.id}</Class>`);
  expect(doc, 'and that the race may draw him').toContain('<ScenarioHero>false</ScenarioHero>');
  // Brem's face (shipped as Rutger's texture) and a knight's figure — no elf of the Preserve.
  expect(doc, "he wears Brem's face").toContain('Heaven_Rutger_128x128');
  expect(doc, '...and nothing of the Preserve').not.toContain('/Preserve/');
  expect(archiveText(HERO_GROUP), 'the random hero pool lists him').toContain(heroHref(heroPaths(hero!)));
  await press(page, page.locator('#hm-close'));
});

/** A file of the installed mod archive, as text — '' when it holds none. */
function archiveText(path: string): string {
  const e = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .find((x) => x.name.split(String.fromCharCode(92)).join('/') === path);
  return e ? e.data.toString('latin1') : '';
}

// A race with nobody of tiers 1–3 starts a game that crashes before the first
// turn: a hero starts with one base creature of each (0xC26FA0). The faction
// installs regardless — its creatures can only be made once it exists — so
// the window says so under its row until they do.
test('until it has creatures, the race says it cannot start a game', { tag: '@game' }, async () => {
  const { page } = ed;
  await press(page, page.locator('#facbtn'));
  await expect(page.locator('#facmod')).toBeVisible();
  const warning = page.locator('#fac-list .fac-start-warn');
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText('Bone Court: no base creature of tier 1, 2, 3');
  await press(page, page.locator('#fac-close'));
  expect(ed.errors).toEqual([]);
});

/**
 * THE BONE COURT'S ROW, as the probe made it (_tmp/town12-units.ts, Senya
 * 2026-09-18) and as Senya remembered it on 23.10, when this spec's row came
 * out as wood elves and the race's hero started with them: every warrior a
 * skeleton, with a Necropolis creature's numbers, name and words and its
 * undead nature; each tier painted its own colour, so the tiers tell apart.
 *
 * Per tier, the three Necropolis creatures whose numbers it takes (base,
 * upgrade, second upgrade) — and by position the skeleton it looks like.
 */
const NECRO_ROW: readonly (readonly [string, string, string])[] = [
  ['CREATURE_SKELETON', 'CREATURE_SKELETON_ARCHER', 'CREATURE_SKELETON_WARRIOR'],
  ['CREATURE_WALKING_DEAD', 'CREATURE_ZOMBIE', 'CREATURE_DISEASE_ZOMBIE'],
  ['CREATURE_MANES', 'CREATURE_GHOST', 'CREATURE_POLTERGEIST'],
  ['CREATURE_VAMPIRE', 'CREATURE_VAMPIRE_LORD', 'CREATURE_NOSFERATU'],
  ['CREATURE_LICH', 'CREATURE_DEMILICH', 'CREATURE_LICH_MASTER'],
  ['CREATURE_WIGHT', 'CREATURE_WRAITH', 'CREATURE_BANSHEE'],
  ['CREATURE_BONE_DRAGON', 'CREATURE_SHADOW_DRAGON', 'CREATURE_HORROR_DRAGON'],
];
const SKELETON_LOOKS = ['CREATURE_SKELETON', 'CREATURE_SKELETON_ARCHER', 'CREATURE_SKELETON_WARRIOR'] as const;
/** Each tier's paint, the probe's: hue turned (the window's −180…180), a tint at 75 %, saturation 150 %. */
const TIER_PAINT: readonly { hue: number; tint: string }[] = [
  { hue: 0, tint: '#ebe1c8' }, { hue: -120, tint: '#c82828' }, { hue: -80, tint: '#f0961e' },
  { hue: -60, tint: '#e6dc28' }, { hue: 0, tint: '#32be46' }, { hue: 100, tint: '#3c78e6' },
  { hue: 160, tint: '#aa3cd2' },
];

interface RowCreature { file: string; donor: string; look: string; name: string; id: string }
/** The row: per tier a base creature, its upgrade and the second upgrade — by file stem; names and ids filled as they are made. */
const ROW = [1, 2, 3, 4, 5, 6, 7].map((tier) => {
  const [base, up, alt] = NECRO_ROW[tier - 1]!;
  const one = (file: string, donor: string, k: number): RowCreature => ({ file, donor, look: SKELETON_LOOKS[k]!, name: '', id: '' });
  return { tier, base: one(`E2eBoneT${tier}`, base, 0), up: one(`E2eBoneT${tier}Up`, up, 1), alt: one(`E2eBoneT${tier}Alt`, alt, 2) };
});

/**
 * A creature's row in the Units list, by its id — the line ends "· <id>".
 * Not by name: "Зомби Двора" is inside "Чумные зомби Двора" to a search that
 * ignores case.
 */
const unitRow = (page: Page, c: { id: string }): Locator =>
  page.locator('#um-list .um-item').filter({ has: page.locator('.grow i', { hasText: new RegExp(`· ${c.id}$`) }) });

/** Pick a creature in the preset list by its id — the list searches ids too. */
async function pickCreature(page: Page, opener: Locator, id: string): Promise<void> {
  await press(page, opener);
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill(id);
  await press(page, page.locator(`#pp-list button[data-id="${id}"]`));
  await expect(page.locator('#presetpick')).toBeHidden();
}

/**
 * One creature, through the Units window, the probe's way: the Necropolis
 * creature's preset — numbers, name, words, abilities — then the LOOK of a
 * skeleton, which keeps them; what a skeleton cannot do goes (it has no
 * flying and no two-tile animations, and only the archer shoots); the second
 * tier is not undead (Senya, launch 41 — an undead stack's morale is always
 * 0, so the race's morale shows on that tier alone). Then its identity, the
 * race, the tier and the link to its base. Its id comes back off the manifest.
 */
async function makeCreature(page: Page, c: RowCreature, tier: number, base = '', ownIcon = ''): Promise<string> {
  await press(page, page.locator('#um-new'));
  await expect(page.locator('#unitedit')).toBeVisible();
  // A new form names no links: what the last creature linked is not this one's.
  await expect(page.locator('#um-base')).toHaveValue('');
  await expect(page.locator('#um-upgrade')).toHaveValue('');
  await pickCreature(page, page.locator('#um-donor-pick'), c.donor);
  await expect(page.locator('#um-name')).not.toHaveValue('');
  const stats = { attack: await page.locator('#um-attack').inputValue(), health: await page.locator('#um-health').inputValue() };
  const words = await page.locator('#um-desc').inputValue();
  // The look of a skeleton: its documents and art, and nothing else of it.
  await pickCreature(page, page.locator('#um-look-pick'), c.look);
  await expect(page.locator('#um-look-name')).not.toHaveText("the preset's");
  await expect(page.locator('#um-attack'), "the look keeps the Necropolis creature's numbers").toHaveValue(stats.attack);
  await expect(page.locator('#um-health')).toHaveValue(stats.health);
  await expect(page.locator('#um-desc'), '...and its words').toHaveValue(words);
  await page.locator('#um-fly').uncheck();
  await page.locator('#um-size').fill('1');
  if (c.look !== 'CREATURE_SKELETON_ARCHER') {
    await page.locator('#um-shots').fill('0');
    await page.locator('#um-range').fill('0');
  }
  if (tier === 2) {
    const undead = page.locator('#um-abilities label').filter({ has: page.locator('option[value="ABILITY_UNDEAD"]:checked') });
    if (await undead.count()) await press(page, undead.locator('button'));
    await expect(undead).toHaveCount(0);
  }
  c.name = `${await page.locator('#um-name').inputValue()} Двора`;
  await page.locator('#um-file').fill(c.file);
  await page.locator('#um-name').fill(c.name);
  await page.locator('#um-town').selectOption(TYPE);
  await page.locator('#um-tier').fill(String(tier));
  if (base) await page.locator('#um-base').selectOption(base);
  if (ownIcon) {
    // "File…" as the author presses it: the open dialog answers with the
    // file, and the slot holds THE FILE — the install copies it in.
    await ed.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    }, ownIcon);
    await press(page, page.locator('button.um-pick[data-for="um-art-icon"]'));
    await expect(page.locator('#um-art-icon')).toHaveValue(ownIcon);
  }
  const note = await settled(page, `installing ${c.file}`, '#um-note', '#ue-err', () => page.locator('#um-ok').click());
  expect(note).toContain('installed');
  expect(ed.errors).toEqual([]);
  const made = readInstalledMod(GAME).creatures.find((x) => x.file === c.file);
  expect(made, `${c.file} is in the manifest`).toBeTruthy();
  return made!.id;
}

/**
 * An icon of the author's own, on disk: the shipped skeleton's face copied
 * into a folder under _tmp, as a picture someone drew would sit. (A wood
 * elf's until 23.10 — and the race's first tier looked it.)
 */
const OWN_ICON = 'ico_Sceleton_128';
function ownIcon(): string {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-own-icon', 'boneicon');
  rmSync(join(dir, '..'), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const src = join(DATA, 'Textures', 'Interface', 'CombatArena', 'Faces', 'Necropolis');
  for (const f of [`${OWN_ICON}.xdb`, `${OWN_ICON}.dds`]) writeFileSync(join(dir, f), readFileSync(join(src, f)));
  return join(dir, `${OWN_ICON}.xdb`);
}

/**
 * A tier's paint, through the brush on the creature's row: every texture of
 * its copy — the icon the hire screen and the army show first — turned to
 * the tier's colour, so seven tiers of skeletons tell apart.
 */
async function paintCreature(page: Page, c: RowCreature, tier: number): Promise<void> {
  const paint = TIER_PAINT[tier - 1]!;
  await press(page, unitRow(page, c).locator('.um-paint'));
  await expect(page.locator('#recolor')).toBeVisible();
  await expect(page.locator('#rc-previews canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.locator('#rc-hue').fill(String(paint.hue));
  await page.locator('#rc-sat').fill('150');
  await page.locator('#rc-tint').fill(paint.tint);
  await page.locator('#rc-tintk').fill('75');
  await page.locator('#rc-ok').click();
  await expect(page.locator('#rc-note')).toContainText(/repainted \d+ texture/, { timeout: 120_000 });
  await expect(page.locator('#rc-err')).toHaveText('');
  await press(page, page.locator('#rc-close'));
  expect(readInstalledMod(GAME).creatures.find((x) => x.id === c.id)?.recolor, `${c.file} carries its tier's paint`)
    .toMatchObject({ hue: paint.hue, saturation: 1.5 });
  expect(ed.errors).toEqual([]);
}

/** A creature's own record out of the mod's creature table. */
function creatureRecord(id: string): string {
  const table = archiveText('GameMechanics/RefTables/Creatures.xdb');
  const from = table.indexOf(`<ID>${id}</ID>`);
  expect(from, `${id} has an entry in the table`).toBeGreaterThan(-1);
  const at = table.indexOf('<Creature ObjectRecordID=', from);
  return table.slice(at, table.indexOf('</Creature>', at));
}

// THE ROW, made the way an author makes it. Per tier: the base, then the
// upgrade and the second upgrade naming it as their base — each lists the
// creatures made before it — and the base opened again to name the two it
// becomes. The game reads both sides: the upgrade dialog by the base's
// Upgrades, the pairing by the upgrade's BaseCreature.
test('a row of seven tiers is made in the Units window, each base linked to its two upgrades', { tag: '@game' }, async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#unitsbtn'));
  await expect(page.locator('#unitsmod')).toBeVisible();
  const ourTown = page.locator(`#um-town option[value="${TYPE}"]`);
  await expect(ourTown, 'the faction is a town a creature can be of').toHaveCount(1);
  await expect(ourTown).toHaveText(/Bone Court.*ours/);

  const original = join(REPO_ROOT, '_tmp', 'e2e-own-icon', 'boneicon', `${OWN_ICON}.xdb`);
  for (const t of ROW) {
    t.base.id = await makeCreature(page, t.base, t.tier, '', t.tier === 1 ? ownIcon() : '');
    if (t.tier === 1) {
      // Tier 1's base wears an icon of the author's own: the manifest names
      // the mod's copy, the archive carries it under the creature — before
      // the tier's paint goes over it.
      const t1 = readInstalledMod(GAME).creatures.find((c) => c.id === t.base.id)!;
      expect(isCopyOf(t1.from?.icon, original, true), 'its icon is the mod\'s copy').toBe(true);
      const iconCopy = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
        .find((e) => e.name.split(String.fromCharCode(92)).join('/').endsWith(`/art/own/boneicon/${OWN_ICON}.dds`));
      expect(iconCopy?.data.equals(readFileSync(original.replace(/\.xdb$/, '.dds'))), 'the archive carries the picture').toBe(true);
    }
    t.up.id = await makeCreature(page, t.up, t.tier, t.base.id);
    t.alt.id = await makeCreature(page, t.alt, t.tier, t.base.id);
    await press(page, unitRow(page, t.base).locator('button', { hasText: '✎' }));
    await expect(page.locator('#unitedit')).toBeVisible();
    await expect(page.locator('#um-base')).toHaveValue('');
    await page.locator('#um-upgrade').selectOption(t.up.id);
    await page.locator('#um-upgrade2').selectOption(t.alt.id);
    const saved = await settled(page, `linking ${t.base.file}`, '#um-note', '#ue-err', () => page.locator('#um-ok').click());
    expect(saved).toContain('installed');
    expect(ed.errors).toEqual([]);
    for (const c of [t.base, t.up, t.alt]) await paintCreature(page, c, t.tier);
  }
  // The original icon goes now, so every build after this one does without it.
  rmSync(join(REPO_ROOT, '_tmp', 'e2e-own-icon'), { recursive: true, force: true });

  // What the row IS: a Necropolis creature's numbers on a skeleton, per tier.
  {
    const shipped = (await page.evaluate(async (ids) => Promise.all(ids.map((id) => window.editor.modPreset(id))),
      ROW.flatMap((t) => [t.base.donor, t.up.donor, t.alt.donor])));
    const made = readInstalledMod(GAME).creatures;
    for (const [i, c] of ROW.flatMap((t) => [t.base, t.up, t.alt]).entries()) {
      const m = made.find((x) => x.id === c.id)!;
      const from = shipped[i]!;
      expect(m.donor, `${c.file} looks like ${c.look}`).toBe(c.look);
      expect(m.stats, `${c.file} has ${c.donor}'s numbers`).toMatchObject({
        attack: from.stats.attack, defence: from.stats.defence, health: from.stats.health,
        speed: from.stats.speed, initiative: from.stats.initiative, flying: false, combatSize: 1,
      });
      expect(m.name).toBe(`${from.name} Двора`);
      expect(m.description).toBe(from.description);
      const tier = Number(/T(\d)/.exec(c.file)![1]);
      expect(m.stats.abilities.includes('ABILITY_UNDEAD'), `${c.file}: undead but on tier 2`).toBe(tier !== 2 && from.stats.abilities.includes('ABILITY_UNDEAD'));
    }
  }

  // The manifest, and the records the game reads.
  const creatures = readInstalledMod(GAME).creatures;
  for (const t of ROW) {
    const base = creatures.find((c) => c.id === t.base.id)!;
    expect(base.stats, `tier ${t.tier}'s base`).toMatchObject({ town: TYPE, tier: t.tier, upgrades: [t.up.id, t.alt.id] });
    expect(base.stats.base).toBeUndefined();
    for (const u of [t.up, t.alt]) {
      expect(creatures.find((c) => c.id === u.id)!.stats).toMatchObject({ town: TYPE, tier: t.tier, base: t.base.id });
    }
    const record = creatureRecord(t.base.id);
    expect(record).toContain(`<CreatureTown>${TYPE}</CreatureTown>`);
    expect(record, 'the base names its two upgrades').toMatch(new RegExp(`<Upgrades>\\s*<Item>${t.up.id}</Item>\\s*<Item>${t.alt.id}</Item>\\s*</Upgrades>`));
    expect(record, '...and pairs with the first').toContain(`<PairCreature>${t.up.id}</PairCreature>`);
    expect(record).toContain('<BaseCreature>CREATURE_UNKNOWN</BaseCreature>');
    const up = creatureRecord(t.up.id);
    expect(up, 'the upgrade names its base').toContain(`<BaseCreature>${t.base.id}</BaseCreature>`);
    expect(up).toContain(`<PairCreature>${t.base.id}</PairCreature>`);
  }

  // And the race can start a game now: tiers 1–3 have base creatures.
  await press(page, page.locator('#um-close'));
  await press(page, page.locator('#facbtn'));
  await expect(page.locator('#facmod')).toBeVisible();
  await expect(page.locator('#fac-list .um-item')).toHaveCount(1);
  await expect(page.locator('#fac-list .fac-start-warn'), 'the warning is gone').toHaveCount(0);
  expect(ed.errors).toEqual([]);
});

// The dwellings hire the row: seven tiers, three creatures each, chosen out of
// the mod's own in the faction's form.
test("the faction's dwellings hire the row", { tag: '@game' }, async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#fac-list .um-item button[title*="change it"]').first());
  await expect(page.locator('#facedit')).toBeVisible();
  // Only the base is chosen: it names its two upgrades (the links made in the
  // Units window), and the tier's other two follow it.
  const tierSelect = (tier: number, role: string): Locator =>
    page.locator(`#fac-dwellings .fc-dwelling[data-tier="${tier}"][data-role="${role}"]`);
  for (const t of ROW) {
    await tierSelect(t.tier, 'base').selectOption(t.base.id);
    await expect(tierSelect(t.tier, 'upgrade'), `tier ${t.tier}'s upgrade came with its base`).toHaveValue(t.up.id);
    await expect(tierSelect(t.tier, 'alternate')).toHaveValue(t.alt.id);
  }
  await press(page, page.locator('#fac-ok'));
  await expect(page.locator('#facedit')).toBeHidden({ timeout: 300_000 });
  await expect(page.locator('#fac-note')).toContainText(`${TYPE} = 11`);
  expect(ed.errors).toEqual([]);

  const f = readInstalledMod(GAME).factions?.[0];
  for (const t of ROW) {
    expect(f?.dwellings?.[t.tier], `tier ${t.tier}`).toEqual({ base: t.base.id, upgrade: t.up.id, alternate: t.alt.id });
  }
  // The town's dwelling records hire them: the base in the plain dwelling,
  // the upgrade and the second upgrade in the upgraded one.
  const town = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .filter((e) => e.name.split(String.fromCharCode(92)).join('/').startsWith(`Factions/${FILE}/town/`))
    .map((e) => e.data.toString('latin1')).join('\n');
  for (const t of ROW) {
    expect(town, `a dwelling hires tier ${t.tier}'s base`).toContain(`<Creature>${t.base.id}</Creature>`);
    expect(town, '...its upgrade').toContain(`<Creature>${t.up.id}</Creature>`);
    expect(town, '...and the second upgrade beside it').toContain(`<Creature2>${t.alt.id}</Creature2>`);
  }
});

/** The map this spec builds for the race: packed into the install, ready to start. */
const MAP_NAME = 'Bone Court Test';

/**
 * Put one object down through the palette and answer with its id — clicked
 * up to three times, as 012 does it: a camera that has not finished moving
 * turns a click into nothing, silently, and three misses is a real failure.
 */
async function placeFromPalette(page: Page, shared: string, x: number, y: number): Promise<string> {
  let added: { id: string }[] = [];
  for (let attempt = 1; attempt <= 3 && added.length !== 1; attempt++) {
    await pickObject(page, shared);
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    await placeAtTile(page, x, y);
    added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
    expect(added.length, `one click on ${x},${y} put down ${added.length} objects`).toBeLessThan(2);
  }
  expect(added, `placing ${shared} at ${x},${y} put down one object, in three tries`).toHaveLength(1);
  return added[0]!.id;
}

/** Give the selected object an owner, in the property panel. */
async function own(page: Page, id: string, player: string): Promise<void> {
  // What clicking its row in the object list does.
  await page.evaluate((oid) => window.view.select(oid), id);
  await setObjectProp(page, 'PlayerID', player);
}

/** One field of a player in Map Properties' Players tab, the way a person sets it. */
async function setPlayerField(page: Page, slot: number, field: string, value: string): Promise<void> {
  await page.locator('#mp-body .mp-picker select').selectOption(String(slot));
  const row = page.locator('#mp-body .mt-row').filter({ has: page.locator(`label[data-field="${field}"]`) }).first();
  const control = row.locator('select');
  await expect(control).toBeEnabled();
  await control.selectOption(value);
  await expect(page.locator('#mp-body .mt-row').filter({ has: page.locator(`label[data-field="${field}"]`) }).first().locator('select'))
    .toHaveValue(value);
}

// A MAP FOR THE RACE, built the way 012 builds the Sharpshooter's — every step
// through the editor's own windows: the palette places, the property panel
// gives owners, Map Properties says the players' colours and red's race, Save
// writes, Pack puts it in the install. Red is the race: a town of the faction
// and the hero made above, the town's dwellings hiring the row; blue is one of
// the game's own Necromancers. Two stacks of the row stand between them.
// Started in the game, red begins with the hero of the race and his army of
// tiers 1–3 — the thing a race of ours needs before its first turn.
test('a map for the race: its town and hero for red, packed into the install', { tag: '@game' }, async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#fac-close'));
  clearMap(GAME, DATA, MAP_NAME);
  await newMap(page, MAP_NAME, '72');

  // The palette's entry for the town: listed beside the shipped towns'.
  const town = await catalogEntry(page, `/Factions/${FILE}/${FILE}.(AdvMapTownShared).xdb`);
  expect(town, 'the palette lists the faction\'s town').toBeTruthy();
  expect(town!.type).toBe('AdvMapTown');
  expect(town!.hidden).toBe(false);
  const hero = (readInstalledMod(GAME).heroes ?? []).find((h) => h.id === HERO.id)!;
  const necro = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapHero' && !o.hidden && !o.random && o.shared.includes('/Necropolis/'))?.shared ?? '';
  });
  expect(necro, 'the catalogue offers a Necropolis hero').not.toBe('');
  const creatures = readInstalledMod(GAME).creatures;
  const stackOf = (id: string): string => `/${creaturePaths(creatures.find((c) => c.id === id)!).monster}`;

  // The hero at the town's gate, one tile out from the entrance — south, the
  // way an unturned town faces.
  const [tx, ty] = [16, 16];
  const townId = await placeFromPalette(page, town!.shared, tx, ty);
  await own(page, townId, 'PLAYER_1');
  const heroId = await placeFromPalette(page, `/${heroPaths(hero).shared}`, tx + NECRO_ENTRANCE[0], ty + NECRO_ENTRANCE[1] - 1);
  await own(page, heroId, 'PLAYER_1');
  const blueId = await placeFromPalette(page, necro, 54, 54);
  await own(page, blueId, 'PLAYER_2');
  // The row on the road between them: its first tier and its last.
  await placeFromPalette(page, stackOf(ROW[0]!.base.id), 28, 22);
  await placeFromPalette(page, stackOf(ROW[6]!.base.id), 40, 40);
  expect(ed.errors).toEqual([]);

  // The players: red is the race, blue the Necromancer's.
  await bar(page, '#mapbtn');
  await expect(page.locator('#mapprops')).toBeVisible();
  await page.locator('#mp-tabs .mp-tab', { hasText: 'Players' }).click();
  const ours = page.locator(`#mp-body .mt-row:has(label[data-field="Race"]) select option[value="${TYPE}"]`);
  await expect(ours, 'a player can be of the race').toHaveText(/Bone Court.*ours/);
  await setPlayerField(page, 0, 'Race', TYPE);
  await setPlayerField(page, 0, 'Colour', 'PCOLOR_RED');
  await setPlayerField(page, 1, 'Race', 'TOWN_NECROMANCY');
  await setPlayerField(page, 1, 'Colour', 'PCOLOR_BLUE');
  await page.locator('#mp-close').click();
  expect(ed.errors).toEqual([]);

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  // On disk: two players on, red of the race and starting with our hero, the
  // town his, the stacks of the row on the ground.
  const mapPath = join(DATA, 'Maps', 'SingleMissions', MAP_NAME, 'map.xdb');
  const xml = readFileSync(mapPath, 'latin1');
  const slots = children(find(parse(/<players>[\s\S]*?<\/players>/.exec(xml)![0]), 'players')!);
  expect(slots.filter((p) => childText(p, 'ActivePlayer') === 'true').length, 'two players on').toBe(2);
  const red = slots.find((p) => childText(p, 'Colour') === 'PCOLOR_RED');
  expect(red, 'red is on').toBeTruthy();
  expect(childText(red!, 'Race'), 'red is of the race').toBe(TYPE);
  expect(find(red!, 'MainHero')?.attrs.href ?? '', 'red starts with a hero of the map').toMatch(/^#xpointer\(id\(item_[^)]+\)\/AdvMapHero\)$/);
  const blocks = (tag: string): string[] => xml.split(`<${tag}>`).slice(1).map((b) => b.slice(0, b.indexOf(`</${tag}>`)));
  const townBlock = blocks('AdvMapTown').find((b) => b.includes(`/Factions/${FILE}/`));
  expect(townBlock, 'the town is on the map').toBeTruthy();
  expect(townBlock, '...and red\'s').toContain('<PlayerID>PLAYER_1</PlayerID>');
  const heroBlock = blocks('AdvMapHero').find((b) => b.includes(heroPaths(hero).shared));
  expect(heroBlock, 'our hero is red\'s').toContain('<PlayerID>PLAYER_1</PlayerID>');
  expect(/<Pos>\s*<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/.exec(heroBlock!)?.slice(1), '...at the gate')
    .toEqual([tx + NECRO_ENTRANCE[0], ty + NECRO_ENTRANCE[1] - 1].map(String));
  for (const t of [ROW[0]!, ROW[6]!]) {
    expect(xml, `a stack of ${t.base.id}`).toContain(creaturePaths(creatures.find((c) => c.id === t.base.id)!).monster);
  }

  // Into the install, where the game reads a map from.
  const archive = modFile(GAME, 'map', MAP_NAME);
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, archive);
  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 120_000);
  const names = readEntries(readFileSync(archive)).map((e) => e.name.split(String.fromCharCode(92)).join('/'));
  expect(names.some((n) => n.endsWith('map.xdb')), 'the archive holds the map').toBe(true);
  expect(names.some((n) => n.includes('map-tag')), 'and the tag the lobby lists').toBe(true);

  // Opened again: every object has its model.
  await page.evaluate((p) => window.view.open(p), mapPath);
  await expect(page.locator('#hud')).toContainText('placed 5');
  await expect(page.locator('#hud'), 'every model resolves').not.toContainText('no model for');
  expect((await page.evaluate(() => window.view.objects().map((o) => o.shared))).map(sharedKey))
    .toContain(sharedKey(town!.shared));
  // The mod windows are the launcher's: closed, the map gives them back.
  await bar(page, '#closemapbtn');
  await expect(page.locator('#empty')).toBeVisible();
  await press(page, page.locator('#facbtn'));
  await expect(page.locator('#facmod')).toBeVisible();
  expect(ed.errors).toEqual([]);
});

// Removing what the mod still names is refused, and the window says who —
// before it asks anything, since the answer is "not yet" whatever is chosen.
test('what the mod still names will not go — the window says who', { tag: '@game' }, async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  const [first] = ROW;
  // The faction: its hero, its class's hero, and every creature of its race.
  await press(page, page.locator('#fac-list .um-item button[title="remove it from the mod"]').first());
  await expect(page.locator('#ask')).toBeVisible();
  await page.locator('#ask-yes').click();
  await expect(page.locator('#fac-err'), 'refused, naming the hero').toContainText(HERO.id, { timeout: 60_000 });
  await expect(page.locator('#fac-err'), '...and the creatures').toContainText(first!.base.id);
  expect((readInstalledMod(GAME).factions ?? []).length, 'and the faction is still there').toBe(1);
  await press(page, page.locator('#fac-close'), /./);

  // A base: its two upgrades name it, and the faction's tier hires it.
  await press(page, page.locator('#unitsbtn'));
  await press(page, unitRow(page, first!.base).locator('button[title="remove it from the mod"]'));
  await expect(page.locator('#ask'), 'nothing is asked').toBeHidden();
  const why = page.locator('#um-err');
  await expect(why).toContainText(`creature ${first!.up.id} is its upgrade`);
  await expect(why).toContainText(`creature ${first!.alt.id} is its upgrade`);
  await expect(why).toContainText(`faction ${FILE}'s tier 1 hires it`);
  // An upgrade: the base upgrades into it.
  await press(page, unitRow(page, first!.up).locator('button[title="remove it from the mod"]'));
  await expect(page.locator('#ask')).toBeHidden();
  await expect(why).toContainText(`creature ${first!.base.id} upgrades into it`);
  expect(readInstalledMod(GAME).creatures.filter((c) => c.stats.town === TYPE)).toHaveLength(21);
  await press(page, page.locator('#um-close'));
  expect(ed.errors).toEqual([]);
});

// And then taken apart in the order the refusals ask for: the tiers off the
// faction, each base's links, the creatures, the hero, his class.
test('taken apart in the order the refusals ask for', { tag: '@game' }, async () => {
  // Live, the race stays in the game to be played — nothing is swept up.
  test.skip(LIVE, 'live run: the race is left in the game');
  test.setTimeout(15 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#facbtn'));
  await press(page, page.locator('#fac-list .um-item button[title*="change it"]').first());
  await expect(page.locator('#facedit')).toBeVisible();
  for (const sel of await page.locator('#fac-dwellings .fc-dwelling').all()) await sel.selectOption('');
  await press(page, page.locator('#fac-ok'));
  await expect(page.locator('#facedit')).toBeHidden({ timeout: 300_000 });
  expect(readInstalledMod(GAME).factions?.[0]?.dwellings, 'the tiers hire the donor\'s again').toBeUndefined();
  await press(page, page.locator('#fac-close'));

  await press(page, page.locator('#unitsbtn'));
  const remove = async (c: RowCreature): Promise<void> => {
    await press(page, unitRow(page, c).locator('button[title="remove it from the mod"]'));
    await expect(page.locator('#ask')).toBeVisible();
    await page.locator('#ask-yes').click();
    await expect(unitRow(page, c)).toHaveCount(0, { timeout: 120_000 });
    await expect(page.locator('#um-err')).toHaveText('');
    expect(readInstalledMod(GAME).creatures.some((x) => x.file === c.file), `${c.file} is out of the manifest`).toBe(false);
  };
  for (const t of ROW) {
    await press(page, unitRow(page, t.base).locator('button', { hasText: '✎' }));
    await page.locator('#um-upgrade').selectOption('');
    await page.locator('#um-upgrade2').selectOption('');
    const saved = await settled(page, `unlinking ${t.base.file}`, '#um-note', '#ue-err', () => page.locator('#um-ok').click());
    expect(saved).toContain('installed');
    await remove(t.up);
    await remove(t.alt);
    await remove(t.base);
  }
  expect(readInstalledMod(GAME).creatures.filter((c) => c.stats.town === TYPE)).toHaveLength(0);
  await press(page, page.locator('#um-close'));

  // Then the hero, and then his class.
  await press(page, page.locator('#heroesbtn'));
  await press(page, page.locator('#hm-tabs button', { hasText: 'Heroes' }));
  const row = page.locator('#hm-list .um-item', { hasText: HERO.name }).first();
  await press(page, row.locator('button', { hasText: '×' }));
  await page.locator('#ask button', { hasText: 'Remove' }).click();
  await expect(page.locator('#hm-list')).not.toContainText(HERO.name, { timeout: 120_000 });
  expect((readInstalledMod(GAME).heroes ?? []).some((h) => h.id === HERO.id), 'he is out of the manifest').toBe(false);
  await press(page, page.locator('#hm-tabs button', { hasText: 'Classes' }));
  const cls = page.locator('#hc-list .um-item', { hasText: CLASS.name }).first();
  await press(page, cls.locator('button', { hasText: '×' }));
  await page.locator('#ask button', { hasText: 'Remove' }).click();
  await expect(page.locator('#hc-list')).not.toContainText(CLASS.name, { timeout: 120_000 });
  expect((readInstalledMod(GAME).classes ?? []).some((c) => c.id === CLASS.id), 'the class is out of the manifest').toBe(false);
  await press(page, page.locator('#hm-close'));
  await press(page, page.locator('#facbtn'));
  await expect(page.locator('#facmod')).toBeVisible();
  expect(ed.errors).toEqual([]);
});

test('removing it puts the shipped numbers back', { tag: '@game' }, async () => {
  // Live, the race stays in the game to be played — nothing is swept up.
  test.skip(LIVE, 'live run: the race is left in the game');
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#fac-list .um-item button[title="remove it from the mod"]').first());
  await expect(page.locator('#ask')).toBeVisible();
  await press(page, page.locator('#ask-yes'));
  await expect(page.locator('#fac-list')).toContainText('none yet', { timeout: 120_000 });
  // The faction was the mod's only content when this spec runs alone, and a
  // mod of nothing is an archive removed; run after the other stages, the
  // archive stays and simply lists no faction.
  if (existsSync(modFile(GAME, 'mod', MOD_STEM))) expect(readInstalledMod(GAME).factions ?? []).toEqual([]);
  expect(existsSync(join(GAME, PATCHED_EXE))).toBe(true);
  expect(exeNumbers()).toEqual({ towns: 11, specs: 255, clamp: 7 });
  const races = readFileSync(join(GAME, RACES_FILE), 'latin1');
  expect(races.split('\n').filter((l) => l.startsWith('race ')).length).toBe(8);
  expect(existsSync(join(GAME, 'Music', 'H5E', FILE)), "the faction's music folder goes with it").toBe(false);
  expect(ed.errors).toEqual([]);
});

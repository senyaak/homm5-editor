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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, REPO_ROOT, closeEditor, hudSays, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { LIVE, clearMap, isModCopyOf, modGameRoot, readInstalledMod } from './mods.ts';
import { bar } from './bar.ts';
import { pickObject, placeAtTile, sharedKey } from './objects.ts';
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
  return join(dir, 'Necromancy-town.xdb');
}

/** A 16×16 magenta PNG of ours. */
function ownPicture(name: string): string {
  const dir = join(REPO_ROOT, '_tmp', 'e2e-own-model');
  mkdirSync(dir, { recursive: true });
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) { rgba[i * 4] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
  const path = join(dir, `${name}.png`);
  writeFileSync(path, Buffer.from(pngDataUri(16, 16, rgba).split(',')[1]!, 'base64'));
  return path;
}

/** The centre pixel of a DDS in the archive: magenta means the picture of ours. */
function centreIsMagenta(names: string[], entries: { name: string; data: Buffer }[], path: string): boolean {
  const e = entries.find((x) => x.name.split(String.fromCharCode(92)).join('/') === path);
  if (!e) return false;
  const img = decodeDDSBuffer(e.data);
  const at = ((img.height >> 1) * img.width + (img.width >> 1)) * 4;
  void names;
  return img.rgba[at] === 255 && img.rgba[at + 1] === 0 && img.rgba[at + 2] === 255;
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
  await expect(page.locator('#fac-missing')).toHaveText(/identifier.*race.*town name.*donor.*named town/);
  // The eight donors, in the ordinals' order, Haven first.
  await expect(page.locator('#fac-donor option')).toHaveCount(8);
  await expect(page.locator('#fac-donor option').first()).toHaveText('Haven');
  // The grid is drawn empty until the donor's tree is loaded.
  await expect(page.locator('#fac-grid .fc-cell')).toHaveCount(30);
  await expect(page.locator('#fac-grid .fc-cell.empty')).toHaveCount(30);
});

test('the identifier names the type; the donor fills the grid', { tag: '@game' }, async () => {
  const { page } = ed;
  await page.locator('#fac-file').fill(FILE);
  await expect(page.locator('#fac-type')).toHaveValue(TYPE);
  await page.locator('#fac-race-name').fill('Bone Court');
  await page.locator('#fac-name').fill('Ossuary Town');

  await press(page, page.locator('#fac-fill'));
  await expect(page.locator('#fac-donor-note')).toContainText(/\d+ building records of TOWN_HEAVEN/);
  // Haven's grid, as shipped: the hall at 1,1 with its levels down the
  // column, the guild at 4,2 with five levels stacked, the shipyard at 5,5.
  await expect(cell(page, 1, 1)).toContainText('TOWN_HALL');
  await expect(cell(page, 1, 1).locator('.fc-levels i')).toHaveCount(1);
  await expect(cell(page, 4, 2)).toContainText('MAGIC_GUILD');
  await expect(cell(page, 4, 2).locator('.fc-levels i')).toHaveCount(5);
  await expect(cell(page, 5, 5)).toContainText('SHIPYARD');
  await expect(cell(page, 2, 6)).toContainText('GRAIL');
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
  await editor.locator('select').nth(1).selectOption('3');               // Town level (after Needs)
  const lua = editor.locator('input[placeholder="no button"]');
  await lua.fill('BonePit');
  await lua.dispatchEvent('change');

  // The special beside it needs the pit (Haven's own tree): the dependency
  // picker offers the cell above in the same column.
  await press(page, cell(page, 5, 4));
  await expect(page.locator('#fac-cell')).toContainText('TB_SPECIAL_2');
  await expect(editor.locator('select').first()).toHaveValue('TB_SPECIAL_1');
  expect(ed.errors).toEqual([]);
});

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
  await page.locator('#fac-script').fill('function BonePit(town)\n  H5ELog(1);\nend;');
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
  expect(f!.buildings?.TB_SHIPYARD).toBeNull();
  expect(f!.buildings?.TB_SPECIAL_1).toMatchObject({ name: 'Bone Pit', cost: { Gold: 2000 }, devLevel: 3, button: { lua: 'BonePit' } });
  expect(f!.buildings?.TB_DWELLING_5).toEqual({ requires: [] });
  expect(f!.script).toContain('function BonePit');
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
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const text = (p: string): string => entries.find((e) => e.name.split('\\').join('/') === p)!.data.toString('latin1');
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
  await expect(page.locator('#fac-donor-note')).toContainText('building records of TOWN_HEAVEN');
  await expect(cell(page, 5, 5)).toHaveClass(/dropped/);
  await expect(cell(page, 5, 3)).toContainText('Bone Pit');
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
  const pitIcon = ownPicture('pit');
  await page.locator('#fac-cell .fc-file').first().fill(pitIcon);

  // A picture for the siege tower's portrait, a tooltip for the picker, the
  // first exterior stage as a model of ours, and a bonus said in words.
  const towerPic = ownPicture('tower');
  await page.locator('#fac-pictures .fc-file').nth(3).fill(towerPic);
  await page.locator('#fac-race-tooltip').fill('The dead of the Bone Court');
  const necro = ownNecroTown();
  await press(page, page.locator('#facedit summary', { hasText: 'stage by stage' }));
  await page.locator('#fac-stages .fc-stage-file').first().fill(necro);
  await expect(page.locator('#fac-stages .fc-stage').first()).toBeDisabled();
  // The gate hull as an AIGeometry of ours (the same folder holds Necropolis's),
  // and the capture sign and flag as pictures.
  await page.locator('#fac-exterior-gates-file').fill(join(necro, '..', 'Necromancy-town_AI.xdb'));
  await expect(page.locator('#fac-exterior-gates')).toBeDisabled();
  const signPic = ownPicture('sign');
  await page.locator('#fac-pictures .fc-file').nth(11).fill(signPic);
  await page.locator('#fac-pictures .fc-file').nth(12).fill(signPic);
  // And the siege gate as a model of ours — the same Necropolis model will
  // do: what is under test is the part standing where the donor's stands.
  await press(page, page.locator('#facedit summary', { hasText: 'Siege parts of your own' }));
  await page.locator('#fac-siege-own .fc-siege-gate-models').fill(necro);
  // A town track of ours: the game plays music from loose files, so the
  // install copies it under Music/H5E/<faction>/ and the row points there.
  const ogg = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'town.ogg');
  writeFileSync(ogg, 'OggS');
  await press(page, page.locator('#facedit summary', { hasText: 'Tracks and sounds of your own' }));
  await page.locator('#fac-tracks .fc-file').first().fill(ogg);
  // And the guild's click as a WAV of ours — a binary inside the mod, not a loose file.
  const wav = join(REPO_ROOT, '_tmp', 'e2e-own-model', 'click.wav');
  writeFileSync(wav, 'RIFF....WAVEfmt ');
  await page.locator('#fac-sounds .fc-file').nth(1).fill(wav);

  // One more named town, and the shipyard is kept after all.
  await press(page, page.locator('#fac-town-add'));
  await page.locator('#fac-towns .town-file').nth(1).fill('Charnel');
  await page.locator('#fac-towns .town-name').nth(1).fill('Charnel House');
  await page.locator('#fac-towns .town-bonus-text').nth(1).fill('A marketplace from the first day.');
  await press(page, cell(page, 5, 5));
  await press(page, page.locator('#fac-cell button', { hasText: 'keep it' }));
  await expect(cell(page, 5, 5)).not.toHaveClass(/dropped/);

  await press(page, page.locator('#fac-ok'));
  await expect(page.locator('#facedit')).toBeHidden({ timeout: 300_000 });
  await expect(page.locator('#fac-note')).toContainText(`${TYPE} = 11`);
  const f = readInstalledMod(GAME).factions?.[0];
  expect(f?.number).toBe(11);
  expect(f?.towns.length).toBe(2);
  expect(f?.buildings?.TB_SHIPYARD, 'kept: no edit at all').toBeUndefined();
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
  const ext = f?.exterior as { stages?: { town?: string }; gates?: string } | undefined;
  expect(isCopyOf(ext?.stages?.town, necro, true)).toBe(true);
  expect(isCopyOf(ext?.gates, join(necro, '..', 'Necromancy-town_AI.xdb'), true)).toBe(true);
  expect(names).toContain(`Factions/${FILE}/town/own/necro/Necromancy-town_AI.xdb`);
  const siege = f?.siege as { arena?: string; gate?: { models?: string[] } } | undefined;
  expect(siege?.arena).toBe('TOWN_HEAVEN');
  expect(siege?.gate?.models?.length === 1 && isCopyOf(siege.gate.models[0], necro, true)).toBe(true);
  expect(isCopyOf(f?.race?.tracks?.town, ogg)).toBe(true);
  expect(isCopyOf(f?.race?.sounds?.guild, wav)).toBe(true);
  expect(names).toContain(`Factions/${FILE}/sounds/guild.(Sound).xdb`);
  expect(names.some((n) => n.startsWith('bin/Sounds/')), 'the click is a binary of the mod').toBe(true);
  expect(existsSync(join(GAME, 'Music', 'H5E', FILE, 'town.ogg')), 'the track is copied loose under the game').toBe(true);
  expect(names).toContain(`Factions/${FILE}/music/town.(Music).xdb`);
  expect(names).toContain(`Factions/${FILE}/siege/gate_1/${FILE}_gate_1.(ArenaModObject).xdb`);
  expect(f?.towns[1]?.bonusText).toBe('A marketplace from the first day.');
  const entries = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  expect(centreIsMagenta(names, entries, `Factions/${FILE}/icons/special_1_1.dds`), "the pit's icon is the picture").toBe(true);
  expect(centreIsMagenta(names, entries, `Factions/${FILE}/icons/tower.dds`), "the tower's portrait is the picture").toBe(true);
  expect(centreIsMagenta(names, entries, `Factions/${FILE}/capture/02Red/Flag.(Texture).dds`), 'the flag is the picture, in every colour').toBe(true);
  expect(names).toContain(`Factions/${FILE}/town/own/necro/Necromancy-town.xdb`);
  expect(names).toContain(`Factions/${FILE}/towns/Charnel_Bonus.txt`);
  const tooltip = entries.find((e) => e.name.split(String.fromCharCode(92)).join('/') === 'UI/MPWait/PlayersList/Item/race_tooltip_e2ebone.txt')!;
  expect(tooltip.data.subarray(2).toString('utf16le')).toBe('The dead of the Bone Court');
  // And the originals go, NOW: everything after this rebuilds the whole mod
  // — the class, the hero, twenty-one creatures, the faction again — and
  // every one of those builds has to manage with the mod's copies alone.
  rmSync(join(REPO_ROOT, '_tmp', 'e2e-own-model'), { recursive: true, force: true });
  expect(exeNumbers()).toEqual({ towns: 12, specs: 257, clamp: 8 });
  expect(ed.errors).toEqual([]);
});

/** The class of our own this spec makes, and the hero of it and of the race. */
const CLASS = { id: 'HERO_CLASS_E2E_REAPER', name: 'Reaper of the e2e' };
const HERO = { id: 'E2eBoneLord', name: 'Bone Lord of the e2e' };

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
  await page.locator('#pp-search').fill('Ossir');
  await press(page, page.locator('#pp-list button', { hasText: 'Ossir' }).first());
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

/** The row: per tier a base creature, its upgrade and the second upgrade — by file stem, filled with ids as they are made. */
const ROW = [1, 2, 3, 4, 5, 6, 7].map((tier) => ({
  tier,
  base: { file: `E2eBoneT${tier}`, name: `T${tier} base of the e2e`, id: '' },
  up: { file: `E2eBoneT${tier}Up`, name: `T${tier} upgrade of the e2e`, id: '' },
  alt: { file: `E2eBoneT${tier}Alt`, name: `T${tier} second of the e2e`, id: '' },
}));

/** Press a row's button in the Units list, by the creature's name. */
const unitRow = (page: Page, name: string): Locator => page.locator('#um-list .um-item', { hasText: name }).first();

/**
 * One creature, through the Units window: a preset, its identity, the race
 * and the tier, and the link to its base. Its id comes back off the manifest.
 */
async function makeCreature(page: Page, c: { file: string; name: string }, tier: number, base = ''): Promise<string> {
  await press(page, page.locator('#um-new'));
  await expect(page.locator('#unitedit')).toBeVisible();
  // A new form names no links: what the last creature linked is not this one's.
  await expect(page.locator('#um-base')).toHaveValue('');
  await expect(page.locator('#um-upgrade')).toHaveValue('');
  await press(page, page.locator('#um-donor-pick'));
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('Лесные стрелки');
  await press(page, page.locator('#pp-list button').first());
  await expect(page.locator('#um-shots')).toHaveValue('16');
  await page.locator('#um-file').fill(c.file);
  await page.locator('#um-name').fill(c.name);
  await page.locator('#um-town').selectOption(TYPE);
  await page.locator('#um-tier').fill(String(tier));
  if (base) await page.locator('#um-base').selectOption(base);
  const note = await settled(page, `installing ${c.file}`, '#um-note', '#ue-err', () => page.locator('#um-ok').click());
  expect(note).toContain('installed');
  expect(ed.errors).toEqual([]);
  const made = readInstalledMod(GAME).creatures.find((x) => x.file === c.file);
  expect(made, `${c.file} is in the manifest`).toBeTruthy();
  return made!.id;
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

  for (const t of ROW) {
    t.base.id = await makeCreature(page, t.base, t.tier);
    t.up.id = await makeCreature(page, t.up, t.tier, t.base.id);
    t.alt.id = await makeCreature(page, t.alt, t.tier, t.base.id);
    await press(page, unitRow(page, t.base.name).locator('button', { hasText: '✎' }));
    await expect(page.locator('#unitedit')).toBeVisible();
    await expect(page.locator('#um-base')).toHaveValue('');
    await page.locator('#um-upgrade').selectOption(t.up.id);
    await page.locator('#um-upgrade2').selectOption(t.alt.id);
    const saved = await settled(page, `linking ${t.base.file}`, '#um-note', '#ue-err', () => page.locator('#um-ok').click());
    expect(saved).toContain('installed');
    expect(ed.errors).toEqual([]);
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

/** The map this spec puts a town of the faction on. */
const MAP_NAME = 'E2e Bone Map';

// A TOWN OF THE FACTION ON A MAP, the way any town is put there: the palette
// lists it (the faction writes its link file beside the shipped towns'), a
// click places it, the map is saved — and opened again, which is where an
// object whose model does not resolve is named on the status line.
test('a town of the faction is placed from the palette and the map keeps it', { tag: '@game' }, async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  await press(page, page.locator('#fac-close'));
  clearMap(GAME, DATA, MAP_NAME);
  await bar(page, '#newmapbtn');
  await page.locator('#nm-name').fill(MAP_NAME);
  await page.locator('#nm-size').selectOption('72');
  await page.locator('#nm-ok').click();
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#title')).toContainText(MAP_NAME, { timeout: 120_000 });

  // The palette's entry for it: a town, named by its link file.
  const entry = await page.evaluate(async (file) => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.shared.includes(`/Factions/${file}/`)) ?? null;
  }, FILE);
  expect(entry, 'the palette lists the faction\'s town').toBeTruthy();
  expect(entry!.type).toBe('AdvMapTown');
  expect(entry!.shared).toBe(`/Factions/${FILE}/${FILE}.(AdvMapTownShared).xdb#xpointer(/AdvMapTownShared)`);
  expect(entry!.hidden).toBe(false);

  let added: { id: string; type: string; shared: string }[] = [];
  for (let attempt = 1; attempt <= 3 && added.length !== 1; attempt++) {
    await pickObject(page, entry!.shared);
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    await placeAtTile(page, 30, 30);
    added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
  }
  expect(added, 'one click put down one town').toHaveLength(1);
  expect(added[0]!.type).toBe('AdvMapTown');
  expect(ed.errors).toEqual([]);

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);
  const mapPath = join(DATA, 'Maps', 'SingleMissions', MAP_NAME, 'map.xdb');
  const xml = readFileSync(mapPath, 'latin1');
  const town = xml.slice(xml.indexOf('<AdvMapTown'), xml.indexOf('</AdvMapTown>'));
  expect(town, 'the map holds the town').toContain(`<Shared href="${entry!.shared}"/>`);

  // Opened again: the town is there and has its model.
  await page.evaluate((p) => window.view.open(p), mapPath);
  await expect(page.locator('#hud')).toContainText('placed 1');
  await expect(page.locator('#hud'), 'its model resolves').not.toContainText('no model for');
  // By what it points at: an object read back from a file is listed without the fragment.
  expect((await page.evaluate(() => window.view.objects().map((o) => o.shared))).map(sharedKey)).toEqual([sharedKey(entry!.shared)]);
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
  await press(page, unitRow(page, first!.base.name).locator('button[title="remove it from the mod"]'));
  await expect(page.locator('#ask'), 'nothing is asked').toBeHidden();
  const why = page.locator('#um-err');
  await expect(why).toContainText(`creature ${first!.up.id} is its upgrade`);
  await expect(why).toContainText(`creature ${first!.alt.id} is its upgrade`);
  await expect(why).toContainText(`faction ${FILE}'s tier 1 hires it`);
  // An upgrade: the base upgrades into it.
  await press(page, unitRow(page, first!.up.name).locator('button[title="remove it from the mod"]'));
  await expect(page.locator('#ask')).toBeHidden();
  await expect(why).toContainText(`creature ${first!.base.id} upgrades into it`);
  expect(readInstalledMod(GAME).creatures.filter((c) => c.stats.town === TYPE)).toHaveLength(21);
  await press(page, page.locator('#um-close'));
  expect(ed.errors).toEqual([]);
});

// And then taken apart in the order the refusals ask for: the tiers off the
// faction, each base's links, the creatures, the hero, his class.
test('taken apart in the order the refusals ask for', { tag: '@game' }, async () => {
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
  const remove = async (c: { name: string; file: string }): Promise<void> => {
    await press(page, unitRow(page, c.name).locator('button[title="remove it from the mod"]'));
    await expect(page.locator('#ask')).toBeVisible();
    await page.locator('#ask-yes').click();
    await expect(page.locator('#um-list')).not.toContainText(c.name, { timeout: 120_000 });
    await expect(page.locator('#um-err')).toHaveText('');
    expect(readInstalledMod(GAME).creatures.some((x) => x.file === c.file), `${c.file} is out of the manifest`).toBe(false);
  };
  for (const t of ROW) {
    await press(page, unitRow(page, t.base.name).locator('button', { hasText: '✎' }));
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

// A faction, authored through the window: the donor's tree on the grid, a
// building dropped, one renamed and given a button, a town without magic, a
// named town, a script — saved, read back off disk, edited, removed.
//
// What the probe (_tmp/town12-probe.ts) wrote by hand for the Bone Court,
// this makes through the palette; the archive, the extension's files and the
// executable's four numbers are then read back the way the game would read
// them. Standing alone: the faction needs nothing another stage authored —
// every tier hires the donor's creature, the towers keep the donor's shooter.
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
import { DATA, REPO_ROOT, closeEditor, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { modGameRoot, readInstalledMod } from './mods.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { PATCHED_EXE } from '../src/exe/creature-limit.ts';
import { findClamp } from '../src/exe/faction-limit.ts';
import { TOWN_SPEC_TABLE, TOWN_TYPE_TABLE, readTableLimit } from '../src/exe/table-limit.ts';
import { RACES_FILE } from '../src/mods/race-order.ts';
import { BUILDINGS_FILE } from '../src/mods/town-button.ts';
import { pngDataUri } from '../src/format/png.ts';
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

/** The four numbers in the sandbox's executable. */
function exeNumbers(): { towns: number | null; specs: number | null; clamp: number } {
  const buf = readFileSync(join(GAME, PATCHED_EXE));
  return { towns: readTableLimit(buf, TOWN_TYPE_TABLE).limit, specs: readTableLimit(buf, TOWN_SPEC_TABLE).limit, clamp: buf[findClamp(buf)]! };
}

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await closeEditor(ed); });

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
  await press(page, page.locator('#facedit summary', { hasText: 'Tracks of your own' }));
  await page.locator('#fac-tracks .fc-file').first().fill(ogg);

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
  expect(f?.buildings?.TB_SPECIAL_1?.model).toEqual({ source: own, at: { x: 250, y: 340, z: 10 } });
  const names = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM))).map((e) => e.name.split(String.fromCharCode(92)).join('/'));
  expect(names).toContain(`Factions/${FILE}/buildings/${FILE}_special_1/own/graves/UneartheGrave_u1r0.xdb`);
  expect(names).toContain(`Factions/${FILE}/buildings/${FILE}_special_1/own/graves/UneartheGrave_u1r0-geom.xdb`);
  // The pictures, the stage, the words.
  expect(f?.pictures).toEqual({ buildings: { TB_SPECIAL_1: pitIcon }, tower: towerPic, capture: { sign: signPic, flag: signPic } });
  expect(f?.race?.tooltip).toBe('The dead of the Bone Court');
  expect(f?.exterior).toEqual({ stages: { town: necro }, gates: join(necro, '..', 'Necromancy-town_AI.xdb') });
  expect(names).toContain(`Factions/${FILE}/town/own/necro/Necromancy-town_AI.xdb`);
  expect(f?.siege).toEqual({ arena: 'TOWN_HEAVEN', gate: { models: [necro] } });
  expect(f?.race?.tracks).toEqual({ town: ogg });
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
  rmSync(join(REPO_ROOT, '_tmp', 'e2e-own-model'), { recursive: true, force: true });
  expect(exeNumbers()).toEqual({ towns: 12, specs: 257, clamp: 8 });
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

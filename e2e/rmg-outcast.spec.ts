// Jebus Outcast, drawn in the template editor — click by click, the way an
// author would, from HotA's `Jebus Outcast 3.01.h3t` (the [1 hero] variant):
// a rich middle, four weak start zones around it, two tiny "outcast"
// treasure zones hung off the middle. Every number the editor can take is
// HotA's — the base sizes 64 / 10 / 2, the treasure ranges with their
// counts, strong and weak as the guard multiplier, a Dragon Utopia in the
// middle — and the map is then generated from what was saved.
//
// What the editor CANNOT say yet, and the spec leaves out on purpose: the
// outcast zones are joined to the middle by TELEPORTS in HotA and held
// beside a start zone by FICTIVE connections (a spring, no passage), and a
// connection there has a type and a weight. Ours has none of the three
// (ROADMAP, "What mt_outcast needs of a connection"), so the outcast zones
// hang on roadless passages to the middle for now; when the fields come,
// two rows below change and nothing else.
//
// HotA's four passages between the middle and each start become what Jebus
// Cross has: a road at 25 and a back way at 35 without one. Its guard
// values (45000, 60000 — gold worth) are not the engine's units; the
// numbers here are Jebus Cross's, which were played.
//
// THE OBJECTS. A zone's `Objects` column in HotA is a list of
// `[+-]type subtype value frequency max min` — hundreds of lines a zone,
// most of them the frequencies that weight the draw. Ours (`<Objects>`) is
// the same idea with less in it: a floor (`Min`), a ceiling (`Max`, 0 to
// forbid) and an explicit guard; no value, no frequency. So what carries
// over is what HotA says OUTRIGHT — an explicit `min`, an explicit forbid —
// and only for objects the fifth game has as a building (a named object is
// placed as one; the shrines, an `AdvMapShrine`, come from `ShrinePoints`
// instead, so a forbidden shrine is that budget at 0). What HotA leaves to
// frequency stays with the engine's own budgets here, with one exception:
// a BANK the engine's pools never draw (the Utopia, the Dwarven Treasury)
// is forced once, or it would never appear. Ids by the classic table:
// 25 Dragon Utopia, 63 Pyramid, 109 Witch Hut, 55 Mystical Garden, 41
// Library, 104 Warrior's Tomb, 16/1 Dwarven Treasury, 95 Trading Post,
// 88–90 the shrines. HotA's own ids (142, 144–146, 212–213) and the banks
// the fifth game lacks (16/0 Cyclops Stockpile ×7 in every start, 16/2, 16/3,
// 16/4, 16/5) are left out. The guards on the banks are ours — HotA's come
// from the value, which we do not have.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_EXE, SHIPPED_EXE, ensureCleanExe } from '../src/exe/exe-unwrap.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { readTemplate } from '../src/rmg/template-files.ts';
import { userTemplateFile } from '../src/rmg/user-templates.ts';
import { DATA, REPO_ROOT, closeEditor, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { REAL_GAME } from './mods.ts';
import { MADE } from './artifacts.ts';

let ed: Launched;

const TEMPLATE = MADE.OUTCAST_TEMPLATE;
const MAP = MADE.OUTCAST_MAP;
/** A throwaway install of its own, like rmg.spec's: the generator wants an executable. */
const GAME = join(REPO_ROOT, '_tmp', 'e2e-rmg-outcast');
const RMG_DIR = join(DATA, 'Maps', 'RMG');

function ourFolders(): string[] {
  if (!existsSync(RMG_DIR)) return [];
  return readdirSync(RMG_DIR)
    .map((d) => join(RMG_DIR, d))
    .filter((d) => existsSync(join(d, 'map.xdb')) && readFileSync(join(d, 'map.xdb'), 'latin1').includes(`<MapName>${MAP}</MapName>`));
}

function cleanup(): void {
  const archive = modFile(GAME, 'map', MAP);
  if (existsSync(archive)) rmSync(archive, { force: true });
  for (const d of ourFolders()) rmSync(d, { recursive: true, force: true });
  rmSync(userTemplateFile(GAME, TEMPLATE), { force: true });
}

test.beforeAll(async () => {
  test.skip(!existsSync(join(DATA, 'RMG', 'Templates')), 'needs the game data (RMG/Templates)');
  test.skip(!REAL_GAME || !existsSync(join(REAL_GAME, SHIPPED_EXE)), 'needs a real game to take the executable from (HOMM5_ROOT)');
  mkdirSync(join(GAME, 'bin'), { recursive: true });
  if (!existsSync(join(GAME, CLEAN_EXE))) {
    copyFileSync(join(REAL_GAME, SHIPPED_EXE), join(GAME, SHIPPED_EXE));
    await ensureCleanExe(GAME, { editorRoot: REPO_ROOT });
  }
  cleanup();
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { if (ed) await closeEditor(ed); cleanup(); });

// ---------------------------------------------------------------------------
// The editor, as an author drives it
// ---------------------------------------------------------------------------

/** The panel row labelled with this tag. */
const field = (page: Page, tag: string) => page.locator(`#rte-panel .rte-row:has(> span:text-is("${tag}"))`);

/** Type a number into a row's box and leave it, so the change lands. */
async function setNumber(page: Page, tag: string, value: number): Promise<void> {
  const input = field(page, tag).locator('input');
  await input.fill(String(value));
  await input.press('Tab');
}

async function setSelect(page: Page, tag: string, value: string): Promise<void> {
  await field(page, tag).locator('select').selectOption(value);
}

/** The seven tier boxes of Mines or Dwellings. */
async function setTiers(page: Page, tag: string, counts: number[]): Promise<void> {
  const boxes = field(page, tag).locator('input');
  for (let i = 0; i < counts.length; i++) {
    await boxes.nth(i).fill(String(counts[i]));
    await boxes.nth(i).press('Tab');
  }
}

/** Click a zone's box — its header, which is never under a row. */
const zoneBox = (page: Page, index: number) => page.locator(`#rte-svg .rte-zone[data-index="${index}"] rect.head`);

async function selectZone(page: Page, index: number): Promise<void> {
  await zoneBox(page, index).click();
  await expect(page.locator('#rte-panel h3')).toHaveText(`Zone #${index}`);
}

/** A treasure range on the selected zone: the list under TreasureBlocks, boxes count × min – max. */
async function addRange(page: Page, count: number, min: number, max: number): Promise<void> {
  const list = page.locator('#rte-panel .rte-list').nth(0);
  const before = await list.locator('.rte-item').count();
  await page.locator('#rte-panel .rte-add').nth(0).click();
  const item = page.locator('#rte-panel .rte-list').nth(0).locator('.rte-item').nth(before);
  await expect(item).toBeVisible();
  for (const [k, v] of [[0, count], [1, min], [2, max]] as const) {
    await item.locator('input').nth(k).fill(String(v));
    await item.locator('input').nth(k).press('Tab');
  }
}

/** A named object on the selected zone, chosen through the picker: `search` typed into its filter, `name` the entry clicked. */
async function addObject(page: Page, search: string, name: RegExp, min: number, max: number | null, guard: number): Promise<void> {
  const list = page.locator('#rte-panel .rte-list').nth(1);
  const before = await list.locator('.rte-item').count();
  await page.locator('#rte-panel .rte-add').nth(1).click();
  const item = page.locator('#rte-panel .rte-list').nth(1).locator('.rte-item').nth(before);
  await item.locator('button', { hasText: '…' }).click();
  await expect(page.locator('#objpick')).toBeVisible();
  await page.locator('#op-search').fill(search);
  await page.locator('#op-list .op-opt', { hasText: name }).first().click();
  await page.locator('#op-ok').click();
  await expect(page.locator('#objpick')).toBeHidden();
  const numbers = page.locator('#rte-panel .rte-list').nth(1).locator('.rte-item').nth(before).locator('input.num');
  await numbers.nth(0).fill(String(min));
  await numbers.nth(0).press('Tab');
  await numbers.nth(1).fill(max === null ? '' : String(max));
  await numbers.nth(1).press('Tab');
  await numbers.nth(2).fill(String(guard));
  await numbers.nth(2).press('Tab');
}

/** Join two zones with Connect, then set the guard and whether it carries a road. */
async function connect(page: Page, a: number, b: number, guard: number, road: boolean): Promise<void> {
  await page.locator('#rte-connect').click();
  await zoneBox(page, a).click();
  await zoneBox(page, b).click();
  await expect(page.locator('#rte-panel h3')).toHaveText(`Connection ${a} — ${b}`);
  await setNumber(page, 'GuardStrenght', guard);
  await setSelect(page, 'Road', road ? 'true' : 'false');
}

test('Jebus Outcast, drawn click by click, saved, and generated from', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  cleanup();

  await bar(page, '#rmgbtn');
  await page.locator('#rmg-templates').click();
  await expect(page.locator('#rte')).toBeVisible();
  await page.locator('#rte-new').click();
  await expect(page.locator('#rte-svg .rte-zone')).toHaveCount(2);

  // The template's own: the players and sizes Jebus Cross takes, our
  // layout, no faction twice.
  await page.locator('#rte-svg').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#rte-panel h3')).toHaveText('Template');
  const name = field(page, 'Name').locator('input');
  await name.fill(TEMPLATE);
  await name.press('Tab');
  await setNumber(page, 'MinPlayers', 2);
  await setNumber(page, 'MaxPlayers', 4);
  await setNumber(page, 'MinMapSize', 18);
  await setNumber(page, 'MaxMapSize', 102);
  await setSelect(page, 'ZoneLayout', 'Voronoi');
  await setSelect(page, 'UniqueRaces', 'true');

  // Zone 1, the middle: HotA's base size 64, "strong", a town nobody
  // starts in, the relic ranges (30–40k ×2, 20–30k ×10, 10–20k ×10 in the
  // file; the counts trimmed to what a medium map seats), a guarded Utopia.
  await selectZone(page, 1);
  await setNumber(page, 'Size', 64);
  await setSelect(page, 'CanBePlayerStart', 'false');
  await setNumber(page, 'TownGuardStrenght', 3);
  await setNumber(page, 'GuardMultiplier', 2);
  await setTiers(page, 'Mines', [2, 1, 2, 1, 1, 1, 2]);
  await setTiers(page, 'Dwellings', [0, 0, 0, 1, 1, 1, 0]);
  await setNumber(page, 'TreasureDensity', 40);
  await addRange(page, 2, 30000, 39000);
  await addRange(page, 6, 20000, 30000);
  await addRange(page, 8, 10000, 20000);
  await addObject(page, 'Utopia', /^Dragon[ _]Utopia$/, 1, 1, 30);
  await addObject(page, 'Pyramid', /^Pyramid$/, 12, null, 20); // +63 0 20000 100 d 12
  await addObject(page, 'Trading', /Trading/, 0, 0, 0);          // the middle's list opens with -n: nothing unlisted, and 95 is unlisted
  await expect(page.locator('#rte-svg .rte-zone[data-index="1"] text', { hasText: 'Dragon_Utopia 1..1 ⚔30' })).toHaveCount(1);
  await expect(page.locator('#rte-svg .rte-zone[data-index="1"] text', { hasText: '2× 30k–39k' })).toHaveCount(1);

  // Zone 2, a start: HotA's base 10, "weak", its ranges (12–22k ×2,
  // 5–12k ×11, 0.1–5k ×7). Zones 3–5 are copies of it — "+ Zone" copies the
  // last zone with the next index — so they are set once here.
  await selectZone(page, 2);
  await setNumber(page, 'Size', 10);
  await setNumber(page, 'GuardMultiplier', 0.5);
  await setTiers(page, 'Mines', [1, 1, 1, 1, 1, 1, 1]);
  await setTiers(page, 'Dwellings', [1, 1, 0, 0, 0, 0, 0]);
  await addRange(page, 2, 12000, 22000);
  await addRange(page, 6, 5000, 12000);
  await addRange(page, 7, 100, 5000);
  // The start zone's objects, HotA's explicit floors and its one forbid:
  await addObject(page, 'Utopia', /^Dragon[ _]Utopia$/, 3, null, 30);   // +25 0 d d d 3
  await addObject(page, 'Witch', /^Witch[ _]Hut$/, 3, null, 0);           // +109 0 d 100 d 3
  await addObject(page, 'Mystical', /^Mystical[ _]Garden$/, 6, null, 0);  // +55 0 d d d 6
  await addObject(page, 'Library', /Library/, 3, null, 0);                // +41 0 10000 45 d 3
  await addObject(page, 'Tomb', /Tomb/, 2, null, 0);                      // +104 0 d 100 d 2
  await addObject(page, 'Dwarven', /Dwarven ?Treasur/, 1, null, 10);      // +16 1 1500 350 d d — a bank the pools never draw
  await addObject(page, 'Trading', /Trading/, 0, 0, 0);                   // -95 0
  await expect(page.locator('#rte-svg .rte-zone[data-index="2"] text', { hasText: 'Trading_Post 0..0' })).toHaveCount(1);
  for (const index of [3, 4, 5]) {
    await page.locator('#rte-add-zone').click();
    await expect(page.locator('#rte-panel h3')).toHaveText(`Zone #${index}`);
    await expect(field(page, 'Size').locator('input')).toHaveValue('10');
    await expect(page.locator('#rte-panel .rte-list').nth(0).locator('.rte-item')).toHaveCount(3);
    await expect(page.locator('#rte-panel .rte-list').nth(1).locator('.rte-item')).toHaveCount(7);
  }

  // Zones 6 and 7, the outcasts: base 2, no start, no town, "avg", the
  // small ranges (3–8k ×25, 0.1–3k ×50 in the file, trimmed). Zone 7 is a
  // copy of 6.
  await page.locator('#rte-add-zone').click();
  await expect(page.locator('#rte-panel h3')).toHaveText('Zone #6');
  await setNumber(page, 'Size', 2);
  await setSelect(page, 'CanBePlayerStart', 'false');
  await setSelect(page, 'Town', 'false');
  await setNumber(page, 'GuardMultiplier', 1);
  await setTiers(page, 'Mines', [0, 0, 0, 0, 0, 0, 1]);
  await setTiers(page, 'Dwellings', [0, 0, 0, 0, 0, 0, 0]);
  // The three ranges copied from the start zone go; the outcast's two come.
  for (let i = 0; i < 3; i++) await page.locator('#rte-panel .rte-list').nth(0).locator('.rte-item button').first().click();
  await addRange(page, 6, 3000, 8000);
  await addRange(page, 8, 100, 3000);
  // And the start zone's seven objects go; the outcast's are a treasury
  // and no trading post (-95 0), its shrines forbidden (-88 -89 -90) by the
  // budget that seats them.
  for (let i = 0; i < 7; i++) await page.locator('#rte-panel .rte-list').nth(1).locator('.rte-item button').last().click();
  await expect(page.locator('#rte-panel .rte-list').nth(1).locator('.rte-item')).toHaveCount(0);
  await addObject(page, 'Dwarven', /Dwarven ?Treasur/, 1, null, 10);
  await addObject(page, 'Trading', /Trading/, 0, 0, 0);
  await setNumber(page, 'ShrinePoints', 0);
  await page.locator('#rte-add-zone').click();
  await expect(page.locator('#rte-panel h3')).toHaveText('Zone #7');
  await expect(field(page, 'Size').locator('input')).toHaveValue('2');
  await expect(page.locator('#rte-svg .rte-zone')).toHaveCount(7);

  // Seven boxes, added one beside the other, pile up at the frame's edge:
  // Arrange lays them out from the graph before the connecting, so every
  // box is its own to click.
  await page.locator('#rte-arrange').click();

  // The connections. New gave 1—2; the rest of the cross, each start with
  // a road at 25 and a back way at 35; the outcasts on roadless passages
  // at 45 — HotA's teleports, until a connection of ours can say so.
  await page.locator('#rte-svg .rte-conn').first().click();
  await expect(page.locator('#rte-panel h3')).toHaveText('Connection 1 — 2');
  await setNumber(page, 'GuardStrenght', 25);
  await connect(page, 1, 2, 35, false);
  for (const start of [3, 4, 5]) {
    await connect(page, 1, start, 25, true);
    await connect(page, 1, start, 35, false);
  }
  await connect(page, 1, 6, 45, false);
  await connect(page, 1, 7, 45, false);
  await expect(page.locator('#rte-svg .rte-conn')).toHaveCount(10);
  await expect(page.locator('#rte-svg .rte-conn.roadless')).toHaveCount(6);
  await expect(page.locator('#rte-warn')).toBeEmpty();
  await page.locator('#rte .mp-card').screenshot({ path: join(REPO_ROOT, '_tmp', 'e2e-rmg-jebus-outcast.png') });

  // Save, and read the file back through the reader the generator uses.
  await page.locator('#rte-file').fill(TEMPLATE);
  await page.locator('#rte-save').click();
  await expect(page.locator('#rte-where')).toContainText('yours', { timeout: 30_000 });
  await expect(page.locator('#rte-err')).toBeEmpty();
  const saved = readTemplate(userTemplateFile(GAME, TEMPLATE));
  expect(saved.name).toBe(TEMPLATE);
  expect(saved.zoneLayout).toBe('Voronoi');
  expect(saved.uniqueRaces).toBe(true);
  expect([saved.minPlayers, saved.maxPlayers, saved.minMapSize, saved.maxMapSize]).toEqual([2, 4, 18, 102]);
  expect(saved.zones.map((z) => z.size)).toEqual([64, 10, 10, 10, 10, 2, 2]);
  expect(saved.zones.map((z) => z.canBePlayerStart)).toEqual([false, true, true, true, true, false, false]);
  expect(saved.zones.map((z) => z.town)).toEqual([true, true, true, true, true, false, false]);
  expect(saved.zones.map((z) => z.guardMultiplier)).toEqual([2, 0.5, 0.5, 0.5, 0.5, 1, 1]);
  expect(saved.zones[0]!.treasureBlocks).toEqual([{ min: 30000, max: 39000, count: 2 }, { min: 20000, max: 30000, count: 6 }, { min: 10000, max: 20000, count: 8 }]);
  expect(saved.zones[4]!.treasureBlocks).toEqual([{ min: 12000, max: 22000, count: 2 }, { min: 5000, max: 12000, count: 6 }, { min: 100, max: 5000, count: 7 }]);
  expect(saved.zones[6]!.treasureBlocks).toEqual([{ min: 3000, max: 8000, count: 6 }, { min: 100, max: 3000, count: 8 }]);
  const shared = (name: string): string => `/MapObjects/${name}.(AdvMapBuildingShared).xdb#xpointer(/AdvMapBuildingShared)`;
  expect(saved.zones[0]!.objects).toEqual([
    { href: shared('Dragon_Utopia'), min: 1, max: 1, guardStrenght: 30 },
    { href: shared('Pyramid'), min: 12, max: Number.POSITIVE_INFINITY, guardStrenght: 20 },
    { href: shared('Trading_Post'), min: 0, max: 0, guardStrenght: 0 },
  ]);
  const start = [
    { href: shared('Dragon_Utopia'), min: 3, max: Number.POSITIVE_INFINITY, guardStrenght: 30 },
    { href: shared('Witch_Hut'), min: 3, max: Number.POSITIVE_INFINITY, guardStrenght: 0 },
    { href: shared('Mystical_Garden'), min: 6, max: Number.POSITIVE_INFINITY, guardStrenght: 0 },
    { href: shared('LibraryOfEnlightenment'), min: 3, max: Number.POSITIVE_INFINITY, guardStrenght: 0 },
    { href: shared('TombOfTheWarrior'), min: 2, max: Number.POSITIVE_INFINITY, guardStrenght: 0 },
    { href: shared('DwarvenTreasury'), min: 1, max: Number.POSITIVE_INFINITY, guardStrenght: 10 },
    { href: shared('Trading_Post'), min: 0, max: 0, guardStrenght: 0 },
  ];
  for (const z of [1, 2, 3, 4]) expect(saved.zones[z]!.objects).toEqual(start);
  const outcast = [
    { href: shared('DwarvenTreasury'), min: 1, max: Number.POSITIVE_INFINITY, guardStrenght: 10 },
    { href: shared('Trading_Post'), min: 0, max: 0, guardStrenght: 0 },
  ];
  for (const z of [5, 6]) { expect(saved.zones[z]!.objects).toEqual(outcast); expect(saved.zones[z]!.shrinePoints).toBe(0); }
  expect(saved.zones[0]!.mines).toEqual([2, 1, 2, 1, 1, 1, 2]);
  expect(saved.zones[5]!.mines).toEqual([0, 0, 0, 0, 0, 0, 1]);
  const pairs = saved.connections.map((c) => `${c.sourceZoneIndex}-${c.destZoneIndex}:${c.guardStrenght}${c.road ? '' : '!'}`);
  expect(pairs.sort()).toEqual(['1-2:25', '1-2:35!', '1-3:25', '1-3:35!', '1-4:25', '1-4:35!', '1-5:25', '1-5:35!', '1-6:45!', '1-7:45!']);
  expect(saved.diagram).toHaveLength(7);

  // And a map out of it: four players on a medium map, the smallest the
  // template's 18 units allow. The template's own is what the map records.
  await page.locator('#rte-close').click();
  await expect(page.locator('#rte')).toBeHidden();
  await page.locator('#rmg-size').selectOption('2');
  await page.locator('#rmg-two').selectOption('0');
  await page.locator('#rmg-template').selectOption(TEMPLATE);
  await page.locator('#rmg-players').selectOption('4');
  await page.locator('#rmg-towns').selectOption('0');
  await page.locator('#rmg-name').fill(MAP);
  await page.locator('#rmg-seed').fill('202');
  await page.locator('#rmg-ok').click();
  await expect(page.locator('#rmg')).toBeHidden({ timeout: 8 * 60_000 });
  expect(ed.errors, ed.errors.join(' | ')).toHaveLength(0);
  await expect(page.locator('#title')).toContainText(MAP, { timeout: 60_000 });
  const xdb = readFileSync(join(ourFolders()[0]!, 'map.xdb'), 'latin1');
  expect(xdb).toContain(`<Template href="/RMG/Templates/${TEMPLATE}.h5et`);
  expect(xdb).toContain('<Players>4</Players>');
  // Five towns: the middle's and the four starts'; the outcasts have none.
  expect(xdb.match(/\(AdvMapTownShared\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  // The floors on the map: the middle's twelve Pyramids and each start's
  // three Utopias, six Gardens, three Huts — what fit, the rest a warning.
  const count = (name: string): number => xdb.match(new RegExp(`/MapObjects/${name}\\.\\(AdvMapBuildingShared\\)`, 'g'))?.length ?? 0;
  expect(count('Dragon_Utopia')).toBeGreaterThanOrEqual(1 + 4 * 3 - 4);
  expect(count('Pyramid')).toBeGreaterThanOrEqual(8);
  expect(count('Witch_Hut')).toBeGreaterThanOrEqual(8);
  expect(count('DwarvenTreasury')).toBeGreaterThanOrEqual(6);
  expect(count('Trading_Post')).toBe(0);
});

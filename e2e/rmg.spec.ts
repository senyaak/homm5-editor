// Random Map, end to end: click through the real dialog, and check what the
// game's generator — ours, ported — left on disk and on screen.
//
// What it proves is the wiring, the way new-map.spec does for New Map: that the
// dialog's lists come from the install, that the template list narrows with
// the size the way the game's does, that an order reaches the generator in a
// child process and comes back as a map the app opens. Whether the map is the
// ENGINE's map is the unit suites' and the corpus's question (docs/RMG.md), not
// this one's — here a tiny map is enough.
//
// And that the install is read OFF the main process, once: the first opening
// shows a spinner while the child reads, the window keeps answering under it,
// and the second opening reads nothing. THE METRIC IS CHECKED BY SABOTAGE in
// the last test: with HOMM5_RMG_INLINE=1 the same read happens in the main
// process, and the same measurement has to fail.
//
// The generator reads the game's executable, so the sandbox install needs a
// readable copy of it: the shipped one from the real game, unwrapped the way
// the first run does it. No extension, no mods — the generator needs neither.

import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_EXE, SHIPPED_EXE, ensureCleanExe } from '../src/exe/exe-unwrap.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { userTemplateFile } from '../src/rmg/user-templates.ts';
import { DATA, REPO_ROOT, closeEditor, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar, openBarMenu } from './bar.ts';
import { REAL_GAME } from './mods.ts';
import { MADE } from './artifacts.ts';

let ed: Launched;

const NAME = MADE.RANDOM_MAP;
/** The template the editor test writes, and the map generated from it. */
const TEMPLATE = MADE.RANDOM_TEMPLATE;
const NAME_FROM_TEMPLATE = MADE.RANDOM_MAP_FROM_TEMPLATE;
/** A throwaway install of its own: the generator wants an executable, the suite's default has none. */
const GAME = join(REPO_ROOT, '_tmp', 'e2e-rmg');
/** Where the generated map's folder lands — `Maps/RMG/<guid>` under the unpack root, like the game's own. */
const RMG_DIR = join(DATA, 'Maps', 'RMG');

/** The folders under Maps/RMG holding a map of THIS name — the guid is drawn, so they are found by content. */
function ourFolders(name: string = NAME): string[] {
  if (!existsSync(RMG_DIR)) return [];
  return readdirSync(RMG_DIR)
    .map((d) => join(RMG_DIR, d))
    .filter((d) => existsSync(join(d, 'map.xdb')) && readFileSync(join(d, 'map.xdb'), 'latin1').includes(`<MapName>${name}</MapName>`));
}

function cleanup(): void {
  for (const name of [NAME, NAME_FROM_TEMPLATE]) {
    const archive = modFile(GAME, 'map', name);
    if (existsSync(archive)) rmSync(archive, { force: true });
    for (const d of ourFolders(name)) rmSync(d, { recursive: true, force: true });
  }
  rmSync(userTemplateFile(GAME, TEMPLATE), { force: true });
}

/**
 * Wait for the dialog to close on success — or fail the moment it reports an
 * error or the renderer throws, instead of sitting out the whole allowance.
 */
async function untilGenerated(ed: Launched, timeoutMs: number): Promise<void> {
  const page = ed.page;
  const started = Date.now();
  for (;;) {
    const err = (await page.locator('#rmg-err').textContent())?.trim();
    if (err) throw new Error(`the dialog reports: ${err}`);
    if (ed.errors.length) throw new Error(`the renderer threw: ${ed.errors.join(' | ')}`);
    if (await page.locator('#rmg').isHidden()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`the dialog is still open after ${timeoutMs / 1000}s`);
    await page.waitForTimeout(500);
  }
}

/** How the main process behaved while the dialog's lists were read. */
interface Watch {
  /** Milliseconds from the click to the lists being filled. */
  total: number;
  /** Cheap main-process calls that came back during it. */
  answers: number;
  /** The longest the main process went without answering, in ms. */
  worstWait: number;
}

/**
 * Open the dialog while asking the main process something cheap over and
 * over, until its spinner goes. `maps:list` is the ping: cached per install,
 * so what it measures is whether the main process got round to answering.
 *
 * The click and the pinging are ONE evaluate: Playwright reaches the window
 * through the main process, and with the read happening there (the
 * sabotage) a second evaluate would only arrive once it was over.
 */
async function openWhilePinging(ed: Launched): Promise<Watch> {
  const { page } = ed;
  await openBarMenu(page, '#rmgbtn');
  return page.evaluate(async () => {
    (document.getElementById('rmgbtn') as HTMLButtonElement).click();
    const loading = document.getElementById('rmg-loading') as HTMLElement;
    let answers = 0, worstWait = 0;
    const t0 = performance.now();
    while (!loading.hidden) {
      const t = performance.now();
      await window.editor.listMaps();
      worstWait = Math.max(worstWait, performance.now() - t);
      answers++;
      const left = 200 - (performance.now() - t);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    }
    return { total: performance.now() - t0, answers, worstWait };
  });
}

/** How many times the install was mounted, by the log — the child's lines come through prefixed. */
const mounts = (ed: Launched): number => ed.log.filter((l) => l.includes('[rmg] install mounted')).length;

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

test('generates a tiny map through the dialog and opens it', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  // The first opening reads the install — in the child, with the window
  // answering throughout. Measured: ~7s of reading, one answer per 200ms;
  // the failure this guards against is ZERO answers for the length of it.
  // Meanwhile the dialog is up and COVERED: a loading overlay over the card,
  // not a half-filled form (the picture is in _tmp for the eye).
  const watching = openWhilePinging(ed);
  await expect(page.locator('#rmg')).toBeVisible();
  await expect(page.locator('#rmg-loading')).toBeVisible();
  await page.screenshot({ path: join(REPO_ROOT, '_tmp', 'e2e-rmg-loading.png') });
  const w = await watching;
  console.log(`[rmg-thread] read in ${w.total | 0}ms · ${w.answers} answers · worst wait ${w.worstWait | 0}ms`);
  await expect(page.locator('#rmg-loading')).toBeHidden();
  expect(w.total).toBeGreaterThan(1000);
  expect(w.answers).toBeGreaterThan(w.total / 400);
  expect(w.worstWait).toBeLessThan(1000);
  expect(mounts(ed)).toBe(1);

  // The lists are the install's, each with Random in front: seven sizes with
  // their tile counts, five monster levels, and a template list that narrows
  // with the size.
  await expect(page.locator('#rmg-size option')).toHaveCount(8);
  await expect(page.locator('#rmg-size option').first()).toHaveText('Random');
  await expect(page.locator('#rmg-size option').nth(1)).toHaveText(/Tiny \(72×72\)/);
  await expect(page.locator('#rmg-monsters option')).toHaveCount(6);
  await page.locator('#rmg-size').selectOption('0');
  await expect(page.locator('#rmg-template-note')).toContainText('fit this size');
  const tiny = await page.locator('#rmg-template option').count();
  await page.locator('#rmg-size').selectOption('5'); // Huge
  await expect(page.locator('#rmg-template-note')).toContainText('fit this size');
  const huge = await page.locator('#rmg-template option').count();
  expect(tiny).toBeGreaterThan(huge);
  // With an underground the list changes again — twice the units to fit — and
  // with the size left to chance every template is on offer.
  await page.locator('#rmg-two').selectOption('1');
  await expect(page.locator('#rmg-template-note')).toContainText('with an underground');
  await page.locator('#rmg-size').selectOption('random');
  await expect(page.locator('#rmg-template-note')).toContainText('any template');
  await expect(page.locator('#rmg-template option')).toHaveCount(24); // 22 shipped + Jebus Cross (ours) + Random
  await page.locator('#rmg-two').selectOption('0');

  // A tiny map on the reference template, with a seed, so the run is short and
  // the map it makes is a known one (S1P2Z2M1 fits Tiny).
  await page.locator('#rmg-size').selectOption('0');
  await page.locator('#rmg-template').selectOption('S1P2Z2M1');
  // Two players: the template's range, so Random and 2.
  await expect(page.locator('#rmg-players option')).toHaveCount(2);
  await page.locator('#rmg-players').selectOption('2');
  await page.locator('#rmg-name').fill(NAME);
  await page.locator('#rmg-seed').fill('1785351845');
  // The races: two slots shown for two players, the rest hidden; player 1
  // Haven, player 2 left to the engine. The heroes under the spoiler: Orrin
  // picked into the white list, one click; the map lists him and nobody else,
  // under the name the game shows — checked on the file below.
  await expect(page.locator('#rmg-race-2')).toBeVisible();
  await expect(page.locator('#rmg-race-3')).toBeHidden();
  await expect(page.locator('#rmg-race-1 option')).toHaveCount(9); // Random + the eight races
  await page.locator('#rmg-race-1').selectOption('TOWN_HEAVEN');
  const orrin = '/MapObjects/Haven/Orrin.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';
  // The picker shows the name the game shows — in the install's language,
  // which the file name is not (Orrin is Дугал on a Russian install).
  const orrinName = readFileSync(join(DATA, 'Text', 'Game', 'Heroes', 'Persons', 'Haven', 'Orrin', 'Name.txt')).toString('utf16le', 2).trim();
  await page.locator('#rmg-heroes summary').click();
  await page.locator('#rmg-white-add').click();
  await expect(page.locator('#rmg-pick')).toBeVisible();
  await page.locator('#rmg-pick-search').fill(orrinName);
  await expect(page.locator('#rmg-pick-list .rmg-pick-hero', { hasText: orrinName })).toHaveCount(1);
  await page.locator('#rmg-pick-list .rmg-pick-hero', { hasText: orrinName }).click();
  await expect(page.locator('#rmg-pick')).toBeHidden();
  await expect(page.locator('#rmg-white .rmg-hero')).toHaveCount(1);
  await expect(page.locator('#rmg-white .rmg-hero-name')).toHaveText(orrinName);
  // The arrow moves him to the black list and back; the black list is not the map's.
  await page.locator('#rmg-white .rmg-hero button').first().click();
  await expect(page.locator('#rmg-black .rmg-hero')).toHaveCount(1);
  await expect(page.locator('#rmg-white .rmg-hero')).toHaveCount(0);
  await page.locator('#rmg-black .rmg-hero button').first().click();
  await expect(page.locator('#rmg-white .rmg-hero')).toHaveCount(1);
  // Setting one aside through the black list's + puts everyone else on the
  // white list — Orrin already there, the other 62 of the 64 hireable join
  // him (eight a race, test-rmg-heroes); Clear empties both.
  await page.locator('#rmg-black-add').click();
  await page.locator('#rmg-pick-list .rmg-pick-hero').first().click();
  await expect(page.locator('#rmg-black .rmg-hero')).toHaveCount(1);
  await expect(page.locator('#rmg-white .rmg-hero')).toHaveCount(63);
  await page.locator('#rmg-heroes-clear').click();
  await expect(page.locator('#rmg-white .rmg-hero')).toHaveCount(0);
  await expect(page.locator('#rmg-black .rmg-hero')).toHaveCount(0);
  // And Orrin alone again, for the map below.
  await page.locator('#rmg-white-add').click();
  await page.locator('#rmg-pick-search').fill(orrinName);
  await page.locator('#rmg-pick-list .rmg-pick-hero', { hasText: orrinName }).click();
  await expect(page.locator('#rmg-white .rmg-hero')).toHaveCount(1);
  await expect(page.locator('#rmg-where')).toContainText(`${NAME}.h5m`);
  await page.locator('#rmg-ok').click();

  // The dialog closes only on success; an error would leave it open with a
  // message, so this also asserts the generation did not fail — and FAILS
  // FAST on the message rather than sitting out the four minutes a large
  // map is allowed: a dialog that is still open with an error in it is a
  // verdict already, and a renderer throw before the order even left (a
  // missing element, once) looked like a hang for exactly that long.
  await untilGenerated(ed, 4 * 60_000);
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 60_000 });
  await expect(page.locator('#pack')).toBeEnabled();
  // And it ran where it was meant to: in a child of its own, not in main.
  const line = ed.log.find((l) => l.includes('[rmg] ') && l.includes(`${NAME}.h5m`));
  expect(line, ed.log.filter((l) => l.includes('[rmg')).join(' | ')).toBeDefined();
  expect(line).toContain('in the child');

  // On disk: the archive in the sandbox's H5E, and the folder it was packed
  // from, holding what the generator writes — map.xdb with the order in its
  // sRMGProps, both terrains absent but the ground, the texts, the minimap.
  expect(existsSync(modFile(GAME, 'map', NAME))).toBeTruthy();
  const folders = ourFolders();
  expect(folders).toHaveLength(1);
  const files = readdirSync(folders[0]!);
  expect(files).toContain('map.xdb');
  expect(files).toContain('GroundTerrain.bin');
  expect(files).toContain('minimap_floor_01.dds');
  const xdb = readFileSync(join(folders[0]!, 'map.xdb'), 'latin1');
  expect(xdb).toContain('<RMGstartseed>1785351845</RMGstartseed>');
  expect(xdb).toContain('<Template href="/RMG/Templates/S1P2Z2M1.xdb');
  expect(xdb).toContain('<MapSize>MAP_SIZE_TINY</MapSize>');
  expect(xdb).toContain('<TileX>72</TileX>');
  expect(xdb).toMatch(new RegExp(`<AvailableHeroes>\\s*<Item href="${orrin.replace(/[.()]/g, '\\$&')}"/>`));
  expect(xdb.match(/<Item href="\/MapObjects\/[^"]+\(AdvMapHeroShared\)[^"]*"\/>/g)).toHaveLength(1);
  expect(xdb.split('<PlayersInfo>')[1]).toContain('<Race>TOWN_HEAVEN</Race>');
  await expect(page.locator('#hud')).toContainText('(Heaven, ');
  await expect(page.locator('#hud')).toContainText('1 heroes listed');
});

test('a name already taken is refused and the dialog stays open', async () => {
  const { page } = ed;
  await bar(page, '#rmgbtn');
  // The second opening reads nothing: the lists are there before the spinner could show.
  await expect(page.locator('#rmg-loading')).toBeHidden();
  await expect(page.locator('#rmg-size option')).toHaveCount(8);
  expect(mounts(ed)).toBe(1);
  await page.locator('#rmg-size').selectOption('0');
  await page.locator('#rmg-name').fill(NAME);
  await page.locator('#rmg-ok').click();
  await expect(page.locator('#rmg-err')).toContainText('already exists', { timeout: 30_000 });
  await expect(page.locator('#rmg')).toBeVisible();
  await page.locator('#rmg-cancel').click();
  await expect(page.locator('#rmg')).toBeHidden();
});

test('a fixed template with everything else random draws a size it fits', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  cleanup();
  await bar(page, '#rmgbtn');
  await page.locator('#rmg-random').click();
  await expect(page.locator('#rmg-template')).toHaveValue('random');
  await expect(page.locator('#rmg-players')).toHaveValue('random');
  // The tiny reference template again, so the drawn size is Tiny or Small and
  // the run stays short — `S1P2Z2M1` fits 5..14 units: Tiny, Small, and either
  // with two levels only Tiny (2×5 = 10).
  await page.locator('#rmg-template').selectOption('S1P2Z2M1');
  await page.locator('#rmg-name').fill(NAME);
  await page.locator('#rmg-ok').click();
  await expect(page.locator('#rmg')).toBeHidden({ timeout: 4 * 60_000 });
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 60_000 });
  const line = ed.log.filter((l) => l.includes('[rmg] ') && l.includes(`${NAME}.h5m`)).pop();
  expect(line).toBeDefined();
  expect(line).toMatch(/S1P2Z2M1 (72×72|96×96)/);
  const xdb = readFileSync(join(ourFolders()[0]!, 'map.xdb'), 'latin1');
  expect(xdb).toMatch(/<MapSize>MAP_SIZE_(TINY|SMALL)<\/MapSize>/);
  expect(xdb).toContain('<Players>2</Players>');
});

test('the template editor: a template drawn, saved, and generated from', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  cleanup();

  // The door: from the generator's dialog, over it.
  await bar(page, '#rmgbtn');
  await page.locator('#rmg-templates').click();
  await expect(page.locator('#rte')).toBeVisible();
  // The list is the generator's: the game's 22 and the editor's Jebus, each
  // saying whose it is; the first opens with its picture laid out.
  await expect(page.locator('#rte-list option')).toHaveCount(23);
  await expect(page.locator('#rte-list option', { hasText: 'Jebus Cross' })).toHaveText(/the editor's/);
  await expect(page.locator('#rte-svg .rte-zone').first()).toBeVisible();

  // Jebus Cross, the editor's: every notion of ours has its glyph and number
  // on the middle zone's box — the multiplier, the relic ranges, the Utopia
  // with its ceiling and guard — and the back ways are the dashed lines.
  await page.locator('#rte-list').selectOption('Jebus Cross');
  await expect(page.locator('#rte-svg .rte-zone')).toHaveCount(5);
  const middle = page.locator('#rte-svg .rte-zone[data-index="1"] text');
  await expect(middle.filter({ hasText: /^×2$/ })).toHaveCount(1);
  await expect(middle.filter({ hasText: '13× 2.5k–28k' })).toHaveCount(1); // the three ranges, summed
  await expect(middle.filter({ hasText: /^\+1$/ })).toHaveCount(1);          // one object forced
  await expect(page.locator('#rte-svg .rte-conn')).toHaveCount(8);
  await expect(page.locator('#rte-svg .rte-conn.roadless')).toHaveCount(4);
  await page.locator('#rte .mp-card').screenshot({ path: join(REPO_ROOT, '_tmp', 'e2e-rmg-template-editor-jebus.png') });

  // New: two start zones joined — and the picture says so.
  await page.locator('#rte-new').click();
  await expect(page.locator('#rte-svg .rte-zone')).toHaveCount(2);
  await expect(page.locator('#rte-svg .rte-conn')).toHaveCount(1);
  await expect(page.locator('#rte-panel h3')).toHaveText('Template');

  // A third zone, not a start, bigger — through the panel, whose rows are
  // the field tables' tags.
  await page.locator('#rte-add-zone').click();
  await expect(page.locator('#rte-svg .rte-zone')).toHaveCount(3);
  await expect(page.locator('#rte-panel h3')).toHaveText('Zone #3');
  const field = (tag: string) => page.locator(`#rte-panel .rte-row:has(> span:text-is("${tag}"))`);
  await field('CanBePlayerStart').locator('select').selectOption('false');
  await field('Size').locator('input').fill('20');
  await field('Size').locator('input').press('Tab');
  await expect(page.locator('#rte-svg .rte-zone[data-index="3"]')).not.toHaveClass(/start/);
  await expect(page.locator('#rte-svg .rte-zone[data-index="3"] text', { hasText: /^20$/ })).toHaveCount(1);
  // A named object through the picker: the palette's buildings, chosen by
  // name, land as the shared href the template writes.
  await page.locator('#rte-panel .rte-add').nth(1).click(); // Objects, under TreasureBlocks
  await expect(page.locator('#rte-panel .rte-item input[type=text]')).toHaveValue(/Dragon_Utopia/);
  await page.locator('#rte-panel .rte-item button', { hasText: '…' }).click();
  await expect(page.locator('#objpick')).toBeVisible();
  await page.locator('#op-search').fill('Crypt');
  await page.locator('#op-list .op-opt', { hasText: /^Crypt$/ }).click();
  await page.locator('#op-ok').click();
  await expect(page.locator('#objpick')).toBeHidden();
  await expect(page.locator('#rte-panel .rte-item input[type=text]')).toHaveValue('/MapObjects/Crypt.(AdvMapBuildingShared).xdb#xpointer(/AdvMapBuildingShared)');
  await expect(page.locator('#rte-svg .rte-zone[data-index="3"] text', { hasText: /^\+1$/ })).toHaveCount(1);

  // The warning line speaks, never refuses: #3 is joined to nothing yet.
  await expect(page.locator('#rte-warn')).toContainText('joined to nothing: #3');

  // Connect #1 to #3: the button, then the two boxes; the new line takes the panel.
  await page.locator('#rte-connect').click();
  await expect(page.locator('#rte-hint')).toContainText('first zone');
  await page.locator('#rte-svg .rte-zone[data-index="1"] rect.head').click();
  await page.locator('#rte-svg .rte-zone[data-index="3"] rect.head').click();
  await expect(page.locator('#rte-svg .rte-conn')).toHaveCount(2);
  await expect(page.locator('#rte-panel h3')).toHaveText('Connection 1 — 3');
  await field('GuardStrenght').locator('input').fill('7');
  await field('GuardStrenght').locator('input').press('Tab');
  await field('Road').locator('select').selectOption('false');
  await expect(page.locator('#rte-svg .rte-conn.roadless')).toHaveCount(1);
  await expect(page.locator('#rte-svg .rte-conn.roadless text')).toContainText('7');
  await expect(page.locator('#rte-warn')).toBeEmpty();

  // The template's own fields, by clicking the background.
  await page.locator('#rte-svg').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#rte-panel h3')).toHaveText('Template');
  await field('Name').locator('input').fill(TEMPLATE);
  await field('Name').locator('input').press('Tab');
  await field('UniqueRaces').locator('select').selectOption('true');

  // The picture, for a human to look at after the run (the assertions above are the test).
  await page.locator('#rte .mp-card').screenshot({ path: join(REPO_ROOT, '_tmp', 'e2e-rmg-template-editor.png') });

  // Save as the install's own; the file is where the generator's chain reads.
  await page.locator('#rte-file').fill(TEMPLATE);
  await page.locator('#rte-save').click();
  await expect(page.locator('#rte-where')).toContainText('yours', { timeout: 30_000 });
  await expect(page.locator('#rte-err')).toBeEmpty();
  const saved = userTemplateFile(GAME, TEMPLATE);
  expect(existsSync(saved)).toBeTruthy();
  const h5et = readFileSync(saved, 'utf8');
  expect(h5et).toContain(`<Name>${TEMPLATE}</Name>`);
  expect(h5et).toContain('<UniqueRaces>true</UniqueRaces>');
  expect(h5et.match(/<Index>/g)).toHaveLength(3 + 3); // three zones, and the three of the picture
  expect(h5et).toContain('<Road>false</Road>');
  expect(h5et).toContain('<Href>/MapObjects/Crypt.(AdvMapBuildingShared).xdb#xpointer(/AdvMapBuildingShared)</Href>');
  expect(h5et).toContain('<Diagram>');
  await expect(page.locator('#rte-list option')).toHaveCount(24);
  await expect(page.locator('#rte-list option', { hasText: TEMPLATE })).toHaveText(/yours/);

  // Back in the generator's dialog the new template is on offer — and a
  // tiny map comes out of it. 5..14 units, so Tiny fits.
  await page.locator('#rte-close').click();
  await expect(page.locator('#rte')).toBeHidden();
  await expect(page.locator('#rmg')).toBeVisible();
  await page.locator('#rmg-size').selectOption('0');
  await page.locator('#rmg-two').selectOption('0');
  await expect(page.locator('#rmg-template option', { hasText: TEMPLATE })).toHaveCount(1);
  await page.locator('#rmg-template').selectOption(TEMPLATE);
  await page.locator('#rmg-players').selectOption('2');
  // Not random towns: the count below reads the town documents, and the
  // dialog keeps what the previous test left in it.
  await page.locator('#rmg-towns').selectOption('0');
  await page.locator('#rmg-name').fill(NAME_FROM_TEMPLATE);
  await page.locator('#rmg-seed').fill('1785351845');
  await page.locator('#rmg-ok').click();
  await untilGenerated(ed, 4 * 60_000);
  await expect(page.locator('#title')).toContainText(NAME_FROM_TEMPLATE, { timeout: 60_000 });
  const xdb = readFileSync(join(ourFolders(NAME_FROM_TEMPLATE)[0]!, 'map.xdb'), 'latin1');
  expect(xdb).toContain(`<Template href="/RMG/Templates/${TEMPLATE}.h5et`);
  // Three zones with a town each: three towns on the map.
  expect(xdb.match(/\(AdvMapTownShared\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
});

test('the sabotage: read in the main process, the app goes deaf', async () => {
  test.setTimeout(120_000);
  // The editor of the suite is stopped for this: two editors on one sandbox
  // would both hold its H5E, and the measurement is about one process.
  await closeEditor(ed);
  const inline = await launchEditor({ HOMM5_ROOT: GAME, HOMM5_RMG_INLINE: '1' });
  try {
    const w = await openWhilePinging(inline);
    console.log(`[rmg-thread] inline: read in ${w.total | 0}ms · ${w.answers} answers · worst wait ${w.worstWait | 0}ms`);
    await expect(inline.page.locator('#rmg-size option')).toHaveCount(8);
    // The same read, the same seconds — and the main process silent for them.
    expect(w.total).toBeGreaterThan(1000);
    expect(w.worstWait).toBeGreaterThan(w.total / 2);
    expect(mounts(inline)).toBe(1);
    await inline.page.locator('#rmg-cancel').click();
  } finally {
    await closeEditor(inline);
  }
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});

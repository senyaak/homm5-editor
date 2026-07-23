// C1M1 stage 8 — the map's own settings.
//
// What is left once the ground is shaped and the objects stand on it: who plays
// this mission and in which colours, how far a hero may level, what losing means,
// which lighting the world uses, and the splash picture the campaign shows before
// the map loads.
//
// The list comes from `npm run diff-map`, which reports by PATH — and the tree
// edits by path, so a gap report line becomes an edit without a translation
// table. The tree is also the only editor that reaches everything: the curated
// tabs show what a mapmaker usually wants, and a mission uses more than that.
//
// Idempotent like every other stage: each value is read before it is written.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { MAP_DIR, NEED_FIXTURE, FIXTURE, hasFixture, openMap } from './c1m1.ts';
import {
  listLength, openTree, pickEntityRef, removeItem, setTreeTextRef, setTreeValue, treeValue,
} from './tree.ts';
import { loadMap } from '../src/map.ts';
import { readTree } from '../src/tree.ts';
import type { TreeData } from '../src/tree.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** The value at a path in a tree, or '' where there is none. */
function at(tree: TreeData | undefined, path: (string | number)[]): string {
  let cur: TreeData | undefined = tree;
  for (const step of path) {
    if (cur === undefined || typeof cur === 'string') return '';
    cur = (cur as Record<string | number, TreeData>)[step];
  }
  if (typeof cur === 'string') return cur;
  // A one-item list the schema shows as a single picker — the map's ambient
  // light is a list in the file and one choice in the editor.
  if (Array.isArray(cur) && cur.length === 1 && typeof cur[0] === 'string') return cur[0];
  return '';
}

/**
 * Everything the reconstruction has to set, as paths into the map document.
 *
 * Taken from the original rather than written out here: the point of the stage
 * is that these values reach the file, and a list of literals would be a second
 * copy of the mission to keep in step. The paths are the gap report's.
 */
const SCALARS: (string | number)[][] = [
  ['HeroMaxLevel'], ['BorderSize'], ['ReflectiveWater'],
  ['Objectives', 'Primary', 'Common', 'DieInWeekWithoutTowns'],
  ['Objectives', 'Primary', 'PlayerSpecific', 0, 'DieInWeekWithoutTowns'],
  ['Objectives', 'Secondary', 'Common', 'DieInWeekWithoutTowns'],
  ['Objectives', 'Secondary', 'PlayerSpecific', 0, 'DieInWeekWithoutTowns'],
  ['MoonCalendarModifications', 'BlockMonstersWeeks'],
  // A dropdown, not a picker: the schema marks it a registry field, so the
  // lighting presets come from the installation as a list of options.
  ['GroundAmbientLights'],
];

/**
 * References to whole documents, which are picked rather than typed: the
 * surface lighting, the pre-light pass, and the splash picture the campaign
 * shows before the map loads (`npm run make-pwl` draws ours).
 */
const REFS: (string | number)[][] = [
  ['PreLight'],
  ['PWLPicture'],
];

/** Per-player: whether they play at all, their town and their colour. */
const PLAYER_FIELDS = ['ActivePlayer', 'Race', 'Colour'];

test('C1M1 map settings, set in the tree', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const original = loadMap(readFileSync(join(FIXTURE, '..', 'C1M1.xdb'), 'utf8'));
  const want = readTree(original.desc) as Record<string, TreeData>;
  const players = Array.isArray(want.players) ? want.players.length : 0;
  expect(players, 'the original declares its players').toBeGreaterThan(0);

  await openMap(page);
  await openTree(page);

  let set = 0;
  const setIfNeeded = async (path: (string | number)[], value: string): Promise<void> => {
    if (!value) return;
    if ((await treeValue(page, path)) === value) return;
    await setTreeValue(page, path, value);
    set++;
  };

  for (const path of SCALARS) await setIfNeeded(path, at(want, path));
  for (const path of REFS) {
    const href = at(want, path);
    if (!href || (await treeValue(page, path)) === href) continue;
    await pickEntityRef(page, path, href);
    set++;
  }
  for (let i = 0; i < players; i++) {
    for (const f of PLAYER_FIELDS) await setIfNeeded(['players', i, f], at(want, ['players', i, f]));
  }
  console.log(`settings: ${set} value(s) set`);

  // The scenario-information list: a fresh map carries eight slots (the lobby
  // shows one per difficulty), C1M1 keeps one. Extra items are removed from the
  // end, which is also what makes a re-run a no-op.
  const wantInfo = Array.isArray(want.ScenarioInformation) ? want.ScenarioInformation.length : 0;
  let have = await listLength(page, ['ScenarioInformation']);
  console.log(`  scenario information: ${have} slot(s), the original keeps ${wantInfo}`);
  while (have > wantInfo) { await removeItem(page, ['ScenarioInformation'], have - 1); have--; }
  // Its two texts are file REFERENCES, not values: the mission points at
  // name.txt and description.txt, which the map already carries.
  for (const f of ['CaptionFileRef', 'DescriptionFileRef']) {
    const path = ['ScenarioInformation', 0, f];
    const wantRef = at(want, path);
    if (!wantRef || (await treeValue(page, path)) === wantRef) continue;
    await setTreeTextRef(page, path, wantRef);
    set++;
  }

  await settle(page);
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  // --- what landed in the file ---
  const built = readTree(loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8')).desc) as Record<string, TreeData>;
  const wrong: string[] = [];
  const check = (path: (string | number)[]): void => {
    const w = at(want, path), g = at(built, path);
    if (!w || w === g) return;
    // A reference's case and leading slash vary between editor versions.
    if (/^\/?[\w./()#-]+$/.test(w) && w.toLowerCase().replace(/^\//, '') === g.toLowerCase().replace(/^\//, '')) return;
    wrong.push(`${path.join('.')}: "${g}" instead of "${w}"`);
  };
  for (const path of [...SCALARS, ...REFS]) check(path);
  for (let i = 0; i < players; i++) for (const f of PLAYER_FIELDS) check(['players', i, f]);
  check(['ScenarioInformation', 0, 'CaptionFileRef']);
  check(['ScenarioInformation', 0, 'DescriptionFileRef']);
  const gotInfo = Array.isArray(built.ScenarioInformation) ? built.ScenarioInformation.length : 0;
  if (gotInfo !== wantInfo) wrong.push(`ScenarioInformation has ${gotInfo} item(s), wanted ${wantInfo}`);
  expect(wrong, `settings that differ (${wrong.length})`).toEqual([]);
});

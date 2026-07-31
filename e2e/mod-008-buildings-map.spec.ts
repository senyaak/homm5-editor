// Every building the mod carries, standing on a map.
//
// Making one is half the claim; the other half is that the editor can PLACE it —
// that the palette offers it, that its footprint is a real size, and that a row
// of them can be laid out without landing on each other. Sixteen classes plus
// the Sharpshooter's palace is also the widest sweep of the placement path we
// have: seventeen definitions, each with its own art and its own footprint.
//
// They go in the map's bottom-left corner on an eight-tile grid, which is wider
// than the biggest shipped footprint (the Dragon Utopia's eight-tile skirt is
// the outlier; nothing here is more than six), so every one of them has clear
// ground around it and a hero can walk up to any of them.
//
// Runs after mod-005 and mod-006, whose buildings it places.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launchEditor, hudSays } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { clearMap, modGameRoot, readInstalledMod } from './mods.ts';
import { newMap, planView } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile, setPlacement } from './objects.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';

let ed: Launched;
const GAME = modGameRoot();
const NAME = 'e2e Buildings Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const ARCHIVE = modFile(GAME, 'map', NAME);

/**
 * Where they stand: a grid in the bottom-left corner.
 *
 * Eight tiles apart in both directions — wider than anything placed here is —
 * so nothing touches its neighbour and every entrance is reachable.
 */
const STEP = 8;
const FIRST = { x: 6, y: 38 };
const COLUMNS = 5;

const spotFor = (i: number): { x: number; y: number } => ({
  x: FIRST.x + (i % COLUMNS) * STEP,
  y: FIRST.y + Math.floor(i / COLUMNS) * STEP,
});

test.beforeAll(async () => {
  clearMap(GAME, DATA, NAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
  // Pack answers where the game would look, since the OS dialog cannot be clicked.
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, ARCHIVE);
});
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('all of them stand in the bottom-left corner, clear of each other', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;

  const buildings = readInstalledMod(GAME).buildings ?? [];
  expect(buildings.length, 'mod-005 and mod-006 have run').toBeGreaterThanOrEqual(16);

  await newMap(page, NAME, '72');
  // Flat: the 3D projection's picking ray and tileToScreen can disagree by a
  // tile at oblique angles, and a placement that lands one tile off is exactly
  // what this spec would then report as an overlap.
  await planView(page);
  await openObjectPalette(page);

  const placed: { file: string; x: number; y: number }[] = [];
  for (const [i, b] of buildings.entries()) {
    const shared = `/Buildings/${b.file}/${b.file}.(${b.className}).xdb`;
    const at = spotFor(i);
    await test.step(`${b.file} at ${at.x}:${at.y}`, async () => {
      // The palette has to OFFER it: a building the editor cannot find is one
      // nobody can place, however well it was built.
      await pickObject(page, shared);
      const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
      await placeAtTile(page, at.x, at.y);
      const after = await page.evaluate(() => window.view.objects());
      const added = after.filter((o) => !before.has(o.id));
      // One object, not none: the editor refuses a placement that would land on
      // something already there, so a refusal here IS the overlap check.
      expect(added, `${b.file} went down`).toHaveLength(1);
      await page.evaluate((id) => window.view.select(id), added[0]!.id);
      await setPlacement(page, at);
      placed.push({ file: b.file, ...at });
    });
  }
  expect(placed).toHaveLength(buildings.length);

  await bar(page, '#save');
  await hudSays(page, /saved/i, 60_000);

  // On disk: every one of them, at the tile it was given.
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  const missing = placed.filter((p) => !xml.includes(`/Buildings/${p.file}/`));
  expect(missing.map((m) => m.file), 'buildings the saved map does not name').toEqual([]);
});

test('and the map packs with them on it', async () => {
  const { page } = ed;
  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 60_000);
  expect(existsSync(ARCHIVE)).toBe(true);

  // The archive holds the map; the buildings themselves live in the mod, which
  // is mounted globally — a map does not carry what the mod already installs.
  const names = readEntries(readFileSync(ARCHIVE)).map((e) => e.name.replace(/\\/g, '/'));
  expect(names.some((n) => n.endsWith(`Maps/SingleMissions/${NAME}/map.xdb`))).toBe(true);
  expect(names.some((n) => n.endsWith(`Maps/SingleMissions/${NAME}/map-tag.xdb`)),
    'the lobby indexes tags, so a map without one is not on the menu').toBe(true);
});

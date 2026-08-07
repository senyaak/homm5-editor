// A map with every building the campaign adds, and two sides to look at them.
//
// The stages before this one prove that each thing can be AUTHORED. This one is
// the other question, and the mod's forms cannot answer it: does what they built
// go on a map — resolvable from the palette, placeable on ground, and pointed at
// by a document the game will load. A dwelling that installs perfectly and has no
// catalogue entry is a building nobody can put down, and nothing upstream of here
// would say so.
//
// So the ten are placed through the palette, the way a person places them, and
// then the map is packed. What comes out is `<game>/H5E/SoD Dwellings.h5m`, a map
// that can be started: the two slots are turned ON and coloured, each with a hero
// to begin as — an active slot is a player who exists, and a main hero is where
// that player starts. Placing a hero does NOT turn a slot on; the object says who
// owns it and the slot says whether that owner exists, and a map with every slot
// off loads and offers nobody to play it.
//
// Red is Gem herself, which makes the map a second check on the hero the campaign
// is about; blue is one of the game's own Necromancers, since the dwellings on the
// far row are his.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { DATA, hudSays, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { newMap } from './tiles.ts';
import { pickObject, placeAtTile } from './objects.ts';
import { GEM_FILE, PALACE, SOD_DWELLINGS, clearMap, installMapFixture, modGameRoot } from './mods.ts';
import { buildingPaths } from '../src/mods/buildings.ts';
import { heroPaths } from '../src/mods/heroes.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { readEntries } from '../src/format/pak.ts';
import { MADE } from './artifacts.ts';

let ed: Launched;
const GAME = modGameRoot();
const NAME = MADE.SOD_DWELLINGS_MAP;
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** Every building the mod adds, in the order they go down. */
const BUILDINGS = [PALACE.file, ...SOD_DWELLINGS.map((b) => b.file)];
/** Where each one stands: two rows, eight tiles apart — none of them is wider. */
const AT = BUILDINGS.map((file, i) => ({
  file, x: 10 + (i % 5) * 12, y: 12 + Math.floor(i / 5) * 14,
}));

const shared = (file: string): string =>
  `/${buildingPaths({ file, className: 'AdvMapDwellingShared', model: '', messages: {} }).shared}`;

/** The two sides, as the slots are written. */
const SIDES = [
  { slot: 0, colour: 'PCOLOR_RED', player: 'PLAYER_1', at: { x: 14, y: 40 } },
  { slot: 1, colour: 'PCOLOR_BLUE', player: 'PLAYER_2', at: { x: 46, y: 40 } },
];
/**
 * Blue is one of the game's own, of the faction the far row belongs to — ASKED
 * FOR rather than named.
 *
 * A hero written in from memory is a name that may not exist, and the failure
 * comes at the palette ("no catalogue entry places …") one test after the one
 * that would explain it. The catalogue knows which heroes it can place; the only
 * thing worth stating here is which faction, and that nothing random will do.
 */
async function necromancer(page: Launched['page']): Promise<string> {
  const href = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapHero' && !o.hidden && !o.random
      && o.shared.includes('/Necropolis/'))?.shared ?? '';
  });
  expect(href, 'the catalogue offers a Necropolis hero').not.toBe('');
  return href;
}

const setPath = (page: Launched['page'], id: string, path: (string | number)[], value: string) =>
  page.evaluate((p) => window.editor.setObjectPath({ id: p.id, path: p.path, value: p.value }),
    { id, path, value });

/**
 * Put one object down and answer with its id.
 *
 * Clicked up to three times: `placeAtTile` projects the tile and, when a panel
 * covers the pixel, centres the view and projects again — and a camera that has
 * not finished moving yields a pixel belonging to another tile. It then places
 * nothing and says nothing, a click on empty ground being no error. A bounded
 * retry, because three misses in a row is a real failure and two objects from
 * one click is a fault rather than something to try past.
 */
async function place(page: Launched['page'], href: string, x: number, y: number): Promise<string> {
  let added: { id: string }[] = [];
  for (let attempt = 1; attempt <= 3 && added.length !== 1; attempt++) {
    await pickObject(page, href);
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    await placeAtTile(page, x, y);
    added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
    expect(added.length, `one click on ${x},${y} put down ${added.length} objects`).toBeLessThan(2);
  }
  expect(added, `placing ${href} at ${x},${y} put down one object, in three tries`).toHaveLength(1);
  return added[0]!.id;
}

test.beforeAll(async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  // Whatever the earlier stages did not author, the fixture fills in — so this
  // stage is about the MAP even when it runs alone.
  installMapFixture(GAME);
  // The last run's map, gone: a map is a file in the install now and New Map
  // refuses to write over one.
  clearMap(GAME, DATA, NAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

test('every building the mod adds is in the palette and goes on the ground', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await newMap(page, NAME, '96');

  for (const b of AT) {
    // The entry has to EXIST before it can be armed, and `pickObject` says so by
    // name when it does not — which is the failure worth naming here: a building
    // installed with no catalogue entry is one nobody can place.
    await place(page, shared(b.file), b.x, b.y);
  }

  const placed = await page.evaluate(() => window.view.objects().map((o) => o.type));
  expect(placed.filter((t) => t === 'AdvMapDwelling'), 'ten dwellings on the map')
    .toHaveLength(BUILDINGS.length);
});

test('two sides, red and blue, each with a hero to start as', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  const heroes = [`/${heroPaths({ id: GEM_FILE }).shared}`, await necromancer(page)];
  const ids: string[] = [];
  for (const [i, side] of SIDES.entries()) {
    const id = await place(page, heroes[i]!, side.at.x, side.at.y);
    await setPath(page, id, ['PlayerID'], side.player);
    ids.push(id);
  }

  for (const [i, side] of SIDES.entries()) {
    await page.evaluate(async (q) => {
      await window.editor.setMapPath({ path: ['players', q.slot, 'ActivePlayer'], value: 'true' });
      await window.editor.setMapPath({ path: ['players', q.slot, 'Colour'], value: q.colour });
      // Where that player begins. Without it the map loads and dies with "Start
      // player does not exist", which names neither the slot nor the hero.
      await window.editor.setMapPath({
        path: ['players', q.slot, 'MainHero'], value: `#xpointer(id(${q.id})/AdvMapHero)`,
      });
    }, { ...side, id: ids[i]! });
  }

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  // On disk, because a field that did not reach the file is a map that looks
  // right in the window and offers nobody to play it.
  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect((xml.match(/<ActivePlayer>true<\/ActivePlayer>/g) ?? []).length,
    'the map has players at all').toBe(SIDES.length);
  for (const side of SIDES) expect(xml, `${side.colour} is on`).toContain(`<Colour>${side.colour}</Colour>`);
  for (const b of BUILDINGS) {
    expect(xml, `${b} is on the map`).toContain(`${b}.(AdvMapDwellingShared).xdb`);
  }
});

test('and it packs to a map the game can be pointed at', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  const archive = modFile(GAME, 'map', NAME);
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, archive);
  await bar(page, '#pack');
  await hudSays(page, /^packed → /, 120_000);

  const members = readEntries(readFileSync(archive));
  const names = members.map((e) => e.name.split('\\').join('/'));
  // The map itself, and the tag beside it — the lobby lists TAGS, not maps, so
  // an archive without one holds a map nobody can find.
  expect(names.some((n) => n.endsWith('map.xdb')), 'the archive holds the map').toBe(true);
  expect(names.some((n) => n.includes('map-tag')), 'and the tag the lobby lists').toBe(true);
});

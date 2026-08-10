// A map of Pandora's Boxes with known contents — the probe the game answers.
//
// The stages before this proved the box BUILDS: the cube decodes, the
// documents parse, the scripts lint. What no test can prove from here is what
// the ENGINE does with them, and this map is the question sheet: one box per
// kind of content, each named for what it holds, plus the two open questions —
// does a Stand's touch trigger fire at all, and does a treasure-chest-class
// box keep its engine pickup or hand the touch to the script. A second side
// with an AI hero beside a chest-class box asks the other half of that
// question: whether the AI walks to a box of that class on its own.
//
// What comes out is `<game>/H5E/Pandora Probe.h5m` — a playable map. The
// answers are read by playing it, which is the one step this suite cannot do.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { DATA, hudSays, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { newMap } from './tiles.ts';
import { pickObject, placeAtTile } from './objects.ts';
import { clearMap, modGameRoot } from './mods.ts';
import { MADE } from './artifacts.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { readEntries } from '../src/format/pak.ts';
import { writeGameplayArchive } from '../src/mods/gameplay.ts';
import {
  PANDORA_CHEST_CLASS, PANDORA_CHEST_SHARED, PANDORA_CLASS, PANDORA_TIERS, pandoraShared,
} from '../src/mods/pandora-files.ts';
import { withPandoraBlock } from '../src/mods/pandora-scripts.ts';
import type { PandoraContents } from '../src/mods/pandora-scripts.ts';

let ed: Launched;
const GAME = modGameRoot();
const NAME = MADE.PANDORA_MAP;
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** The Stand-class box every placement below uses — the poorest tier, which is
 *  the one the palette offers. */
const BOX = `/${pandoraShared(PANDORA_TIERS[0]!.key)}`;
const CHEST = `/${PANDORA_CHEST_SHARED}`;

/**
 * The question sheet. One box per kind of content, named for what it holds —
 * the name is both the trigger's handle and the legend a player reads.
 */
const BOXES: (PandoraContents & { x: number; y: number; shared: string })[] = [
  { name: 'PandoraExp', exp: 5000, x: 24, y: 16, shared: BOX },
  { name: 'PandoraGold', gold: 10000, x: 28, y: 16, shared: BOX },
  { name: 'PandoraRes', wood: 10, ore: 10, x: 32, y: 16, shared: BOX },
  { name: 'PandoraArts', artifacts: ['ARTIFACT_ENDLESS_BAG_OF_GOLD'], x: 24, y: 22, shared: BOX },
  { name: 'PandoraSpells', spells: [2, 3], x: 28, y: 22, shared: BOX },
  { name: 'PandoraArmy', creatures: [{ creature: 'CREATURE_PEASANT', count: 20 }], x: 32, y: 22, shared: BOX },
  {
    name: 'PandoraGuarded', gold: 20000,
    guards: [{ creature: 'CREATURE_ARCHER', count: 15 }], x: 28, y: 28, shared: BOX,
  },
  // The chest-class twin, near the human: does its touch reach the script, or
  // does the engine's own pickup swallow it?
  { name: 'PandoraChest', gold: 5000, x: 24, y: 28, shared: CHEST },
  // And one beside the AI: does an AI hero walk to a chest-class box at all?
  { name: 'PandoraChestAI', gold: 5000, x: 62, y: 60, shared: CHEST },
];

const SIDES = [
  { slot: 0, colour: 'PCOLOR_RED', player: 'PLAYER_1', at: { x: 28, y: 34 } },
  { slot: 1, colour: 'PCOLOR_BLUE', player: 'PLAYER_2', at: { x: 58, y: 60 } },
];

/** Two heroes out of the catalogue — asked for, not named from memory. */
async function twoHeroes(page: Launched['page']): Promise<string[]> {
  const found = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    const heroes = objects.filter((o) => o.type === 'AdvMapHero' && !o.hidden && !o.random);
    const haven = heroes.find((o) => o.shared.includes('/Haven/'))?.shared ?? '';
    const other = heroes.find((o) => !o.shared.includes('/Haven/'))?.shared ?? '';
    return [haven, other];
  });
  for (const h of found) expect(h, 'the catalogue offers two heroes').not.toBe('');
  return found;
}

const setPath = (page: Launched['page'], id: string, path: (string | number)[], value: string) =>
  page.evaluate((p) => window.editor.setObjectPath({ id: p.id, path: p.path, value: p.value }),
    { id, path, value });

/** Put one object down and answer with its id — mod-010's bounded retry. */
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
  test.skip(!existsSync(GAME), 'needs the prepared install');
  // The box exists for the editor exactly while the archive is in the install —
  // written here the same way the Gameplay tab's Apply writes it.
  writeGameplayArchive(GAME, DATA);
  clearMap(GAME, DATA, NAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

test('every box goes down through the palette, named for what it holds', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  await newMap(page, NAME, '96');

  for (const b of BOXES) {
    const id = await place(page, b.shared, b.x, b.y);
    await setPath(page, id, ['Name'], b.name);
  }

  const placed = await page.evaluate(() => window.view.objects().map((o) => o.type));
  expect(placed.filter((t) => t === 'AdvMapStand'), 'seven stand-class boxes')
    .toHaveLength(BOXES.filter((b) => b.shared === BOX).length);
  expect(placed.filter((t) => t === 'AdvMapTreasure'), 'two chest-class boxes')
    .toHaveLength(BOXES.filter((b) => b.shared === CHEST).length);
});

test('two sides, and the script that answers a touch', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  const heroes = await twoHeroes(page);
  for (const [i, side] of SIDES.entries()) {
    const id = await place(page, heroes[i]!, side.at.x, side.at.y);
    await setPath(page, id, ['PlayerID'], side.player);
    await page.evaluate(async (q) => {
      await window.editor.setMapPath({ path: ['players', q.slot, 'ActivePlayer'], value: 'true' });
      await window.editor.setMapPath({ path: ['players', q.slot, 'Colour'], value: q.colour });
      await window.editor.setMapPath({
        path: ['players', q.slot, 'MainHero'], value: `#xpointer(id(${q.id})/AdvMapHero)`,
      });
    }, { ...side, id });
  }

  // The script: the generated pandora block, and nothing of anyone else's.
  const script = withPandoraBlock('', BOXES);
  const bound = await page.evaluate(async (text) => {
    const r = await window.editor.newScript({ base: 'MapScript' });
    await window.editor.writeFile({ href: r.lua, text });
    await window.editor.setMapPath({ path: ['MapScript'], value: r.href });
    return r.href;
  }, script);
  expect(bound).toContain('MapScript.xdb');

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xml, 'the map binds the script').toContain('MapScript.xdb#xpointer(/Script)');
  for (const b of BOXES) expect(xml, `${b.name} is on the map`).toContain(`<Name>${b.name}</Name>`);
  expect((xml.match(new RegExp(`\\(${PANDORA_CLASS}\\)`, 'g')) ?? []).length,
    'stand-class boxes reference their shared').toBeGreaterThan(0);
  expect(xml, 'the chest-class box references its shared').toContain(`(${PANDORA_CHEST_CLASS})`);

  const lua = readFileSync(join(MAP_DIR, 'MapScript.lua'), 'latin1');
  for (const b of BOXES) {
    expect(lua, `${b.name} is in the data table`).toContain(`H5E_PANDORA["${b.name}"]`);
    expect(lua, `${b.name} is hooked`).toContain(`Trigger(OBJECT_TOUCH_TRIGGER, "${b.name}"`);
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

  const names = readEntries(readFileSync(archive)).map((e) => e.name.split('\\').join('/'));
  expect(names.some((n) => n.endsWith('map.xdb')), 'the archive holds the map').toBe(true);
  expect(names.some((n) => n.endsWith('MapScript.lua')), 'and the script').toBe(true);
  expect(names.some((n) => n.includes('map-tag')), 'and the tag the lobby lists').toBe(true);
});

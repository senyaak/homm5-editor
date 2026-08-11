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
  PANDORA_ARTIFACT_SHARED, PANDORA_CLASS,
  PANDORA_MILL_SHARED, PANDORA_STILL_SHARED, PANDORA_TIERS, pandoraShared,
} from '../src/mods/pandora-files.ts';
import { withPandoraBlock } from '../src/mods/pandora-scripts.ts';
import type { PandoraContents } from '../src/mods/pandora-scripts.ts';
import { utf16 } from '../src/mods/mod-files.ts';
import { mkdirSync, writeFileSync } from 'node:fs';

let ed: Launched;
const GAME = modGameRoot();
const NAME = MADE.PANDORA_MAP;
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** The box every ordinary placement below uses — the poorest tier, which is
 *  the one the palette offers. Chest class now: a Stand cannot be touched. */
const BOX = `/${pandoraShared(PANDORA_TIERS[0]!.key)}`;

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
  // Disabled after hooking: does SetObjectEnabled hide a chest, silence its
  // pickup, or change nothing? The API doc says "hide" — worth one tile to see.
  { name: 'PandoraDisabled', gold: 5000, x: 24, y: 28, disable: true, shared: BOX },
  // Beside the AI: does an AI hero walk to a chest-class box on its own?
  { name: 'PandoraChestAI', gold: 5000, x: 62, y: 60, shared: BOX },
  // The animation probes: the SKINNED cube with the artifact idle, on a
  // windmill-type Building (the shipped proof a Building plays an AnimSet)
  // and on an artifact — the class the rig was made for, whose pickup also
  // vanishes the object.
  // The still control, FIRST in the row and unmissable: the same cube with no
  // rig at all. If it draws and the others do not, the rig is what is wrong; if
  // none of them draw, the model is.
  { name: 'PandoraStill', gold: 100, x: 20, y: 16, shared: `/${PANDORA_STILL_SHARED}` },
  { name: 'PandoraMill', exp: 100, x: 36, y: 16, shared: `/${PANDORA_MILL_SHARED}` },
  { name: 'PandoraArtifact', gold: 1000, x: 36, y: 22, shared: `/${PANDORA_ARTIFACT_SHARED}` },
];

/**
 * The bisect row is gone.
 *
 * It existed to ask why a mesh rebuilt inside a donor container did not draw,
 * and the answer came from reading the container rather than from another run:
 * the box is authored outright now, and what guards it is a byte-exact round
 * trip over every shipped geometry (tools/test-geometry-write.ts).
 */
const DIAGS: { name: string; x: number; y: number; shared: string }[] = [];

/** What a box says it gave, written beside the map for the behaviour to show. */
function givenText(b: PandoraContents): string {
  const said: string[] = [];
  if (b.exp) said.push(`${b.exp} experience`);
  if (b.gold) said.push(`${b.gold} gold`);
  for (const k of ['wood', 'ore', 'mercury', 'crystal', 'sulfur', 'gem'] as const) {
    if (b[k]) said.push(`${b[k]} ${k}`);
  }
  if (b.artifacts?.length) said.push(`${b.artifacts.length} artifact(s)`);
  if (b.spells?.length) said.push(`${b.spells.length} spell(s)`);
  for (const c of b.creatures ?? []) said.push(`${c.count} creature(s) join`);
  return said.length ? `The box yields: ${said.join(', ')}.` : 'The box was empty.';
}

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

  for (const b of [...BOXES, ...DIAGS]) {
    const id = await place(page, b.shared, b.x, b.y);
    await setPath(page, id, ['Name'], b.name);
  }

  const placed = await page.evaluate(() => window.view.objects().map((o) => o.type));
  // Every box of the chest class: the nine ordinary ones and the still control.
  expect(placed.filter((t) => t === 'AdvMapTreasure'), 'the chest-class boxes')
    .toHaveLength(BOXES.filter((b) => b.shared.includes(PANDORA_CLASS)).length + DIAGS.length);
  expect(placed.filter((t) => t === 'AdvMapBuilding'), 'the mill probe')
    .toHaveLength(1);
  expect(placed.filter((t) => t === 'AdvMapArtifact'), 'the artifact probe')
    .toHaveLength(1);
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
  // Each box also names the "you received" text the behaviour shows after it
  // opens; the files go beside the map after the first save makes its folder.
  const withGiven = BOXES.map((b) => ({
    ...b, given: `/Maps/SingleMissions/${NAME}/pandora-${b.name}.txt`,
  }));
  const script = withPandoraBlock('', withGiven);
  const bound = await page.evaluate(async (text) => {
    const r = await window.editor.newScript({ base: 'MapScript' });
    await window.editor.writeFile({ href: r.lua, text });
    await window.editor.setMapPath({ path: ['MapScript'], value: r.href });
    return r.href;
  }, script);
  expect(bound).toContain('MapScript.xdb');

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  // The reward texts, in the map's folder the save just made. UTF-16, like
  // every text the game reads.
  mkdirSync(MAP_DIR, { recursive: true });
  for (const b of BOXES) {
    writeFileSync(join(MAP_DIR, `pandora-${b.name}.txt`), utf16(givenText(b)));
  }

  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xml, 'the map binds the script').toContain('MapScript.xdb#xpointer(/Script)');
  for (const b of BOXES) expect(xml, `${b.name} is on the map`).toContain(`<Name>${b.name}</Name>`);
  expect((xml.match(new RegExp(`\\(${PANDORA_CLASS}\\)`, 'g')) ?? []).length,
    'chest-class boxes reference their shared').toBeGreaterThan(0);

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
  expect(names.some((n) => n.endsWith('pandora-PandoraExp.txt')), 'and the reward texts').toBe(true);
});

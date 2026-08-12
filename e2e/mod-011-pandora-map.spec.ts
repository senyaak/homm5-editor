// The question sheet for the Pandora's Box, as a MULTIPLAYER map.
//
// Every earlier version of this file asked whether the box exists. It does: the
// model is ours, the rig turns, the palette lists it under Treasures. What this
// map asks is what an AUTHOR can say with one, and whether the answer survives
// being played by two people:
//
//   * eight kinds of content — a message, experience, gold, resources,
//     artifacts, spells, creatures given, creatures fought — each in FOUR
//     copies, one per glow, so a run through the map is a run through the whole
//     ladder and a colour that lies is visible at a glance;
//   * the same stack given and fought, side by side, because they are worth the
//     same and must therefore wear the same colour (the rule this whole feature
//     turns on — src/mods/pandora-contents.ts);
//   * two SIDES, each with its own hero and its own copy of the row, so a box
//     opened by red says nothing to blue: the dialog, the fight and the reward
//     all belong to whoever touched it.
//
// Built through the editor the way a person builds one: the boxes come off the
// palette, and one of them is filled in through the actual window — clicked,
// typed into, saved. The other sixty-three go through the same channel that
// window calls, because sixty-four forms is a slower test and not a better one.
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
import { PANDORA_CLASS, pandoraShared } from '../src/mods/pandora-files.ts';
import { PANDORA_TIERS, pandoraValue } from '../src/mods/pandora-contents.ts';
import type { PandoraContents } from '../src/mods/pandora-contents.ts';
import { pandoraPrices } from '../src/mods/pandora-prices.ts';
import { singleRoot } from '../src/game/assets.ts';
import { PANDORA_FILE } from '../src/map/pandora-store.ts';
import { startableProblems } from '../src/map/startable.ts';
import { loadMap } from '../src/map/map.ts';

let ed: Launched;
const GAME = modGameRoot();
const NAME = MADE.PANDORA_MAP;
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** The palette's box — the poorest tier, which is what a fresh one is. */
const BOX = `/${pandoraShared(PANDORA_TIERS[0]!.key)}`;

/**
 * The eight kinds of content, each said four times over.
 *
 * The numbers are chosen to land one copy in each glow, and the test ASSERTS
 * that they did rather than trusting the arithmetic here: a threshold moved in
 * pandora-contents.ts should turn this map red, not silently regrade it.
 *
 * `message` is the exception and is deliberate — a sentence is worth no gold,
 * so its four copies carry an explicit override each. That is the other half of
 * the tier rule, and this is where it is exercised.
 */
const KINDS: { key: string; per: (tier: number) => Partial<PandoraContents> }[] = [
  {
    key: 'Says',
    per: (t) => ({
      message: `The box was empty, but it spoke: ${PANDORA_TIERS[t]!.key.toLowerCase()}.`,
      tier: PANDORA_TIERS[t]!.key,
    }),
  },
  { key: 'Exp', per: (t) => ({ exp: [1000, 7000, 20000, 60000][t]! }) },
  { key: 'Gold', per: (t) => ({ gold: [1000, 7000, 20000, 60000][t]! }) },
  {
    key: 'Res',
    // 250 gold a common, 500 a rare — so these are 1000 / 7000 / 20000 / 60000.
    per: (t) => ([
      { wood: 4 },
      { wood: 12, ore: 12, gem: 2 },
      { wood: 40, ore: 40 },
      { wood: 80, ore: 80, mercury: 20, crystal: 20, sulfur: 20, gem: 20 },
    ][t]!),
  },
  {
    key: 'Arts',
    // Priced off the game's table at run time; the ids are picked below so each
    // copy lands in its tier.
    per: () => ({}),
  },
  {
    key: 'Spells',
    // A level is 1000 gold, so a stack of them is how a spell box gets rich.
    per: () => ({}),
  },
  {
    key: 'Army',
    // Archangels at 3500 each: 1, 2, 5, 12.
    per: (t) => ({ creatures: [{ creature: 'CREATURE_ARCHANGEL', count: [1, 2, 5, 12][t]! }] }),
  },
  {
    key: 'Guard',
    // THE SAME STACKS, on the other side of the fight. Same counts on purpose:
    // the pair must come out the same colour.
    per: (t) => ({ guards: [{ creature: 'CREATURE_ARCHANGEL', count: [1, 2, 5, 12][t]! }] }),
  },
];

/**
 * The two sides, and where each one's row of boxes sits.
 *
 * EACH ON HIS OWN TEAM, which is not decoration. A fresh slot is team 0, so two
 * players left as they came are ALLIES — and the map's default victory
 * condition is "defeat all", which on a map with no enemy is satisfied at load:
 * the game wins the mission, drops the winning player, and refuses to start
 * with "Start player does not exist on map" (docs/CAMPAIGNS.md, the traps).
 * Two sides that cannot fight each other are also not what this map is asking.
 */
const SIDES = [
  { slot: 0, team: 0, colour: 'PCOLOR_RED', player: 'PLAYER_1', tag: 'R', hero: { x: 10, y: 10 }, at: { x: 14, y: 12 } },
  { slot: 1, team: 1, colour: 'PCOLOR_BLUE', player: 'PLAYER_2', tag: 'B', hero: { x: 62, y: 62 }, at: { x: 66, y: 64 } },
];

/** One placement: where it goes, what it is called, what is in it. */
interface Placement { name: string; x: number; y: number; contents: PandoraContents }

/** Every box the map carries — the same row twice, once per side. */
function placements(arts: string[][], spells: (string | number)[][]): Placement[] {
  const out: Placement[] = [];
  for (const side of SIDES) {
    KINDS.forEach((kind, row) => {
      for (let t = 0; t < PANDORA_TIERS.length; t++) {
        const name = `Pandora${side.tag}${kind.key}${PANDORA_TIERS[t]!.key}`;
        const extra: Partial<PandoraContents> =
          kind.key === 'Arts' ? { artifacts: arts[t] ?? [] }
          : kind.key === 'Spells' ? { spells: spells[t] ?? [] }
          : kind.per(t);
        out.push({
          name,
          x: side.at.x + t * 3,
          y: side.at.y + row * 3,
          contents: { name, ...extra },
        });
      }
    });
  }
  return out;
}

/**
 * Artifacts and spells enough to reach each tier, priced off the game's own
 * tables rather than from memory — an artifact's cost is data, and a list
 * written here by hand would be a second copy of it to go stale.
 */
function contentsByPrice(): { arts: string[][]; spells: (string | number)[][] } {
  const prices = pandoraPrices(singleRoot(DATA));
  const table = readFileSync(join(DATA, 'GameMechanics', 'RefTables', 'Artifacts.xdb'), 'utf8');
  const ids = [...table.matchAll(/<ID>([A-Z_]+)<\/ID>/g)].map((m) => m[1]!)
    .filter((id) => id !== 'ARTIFACT_NONE');
  const priced = ids.map((id) => ({ id, gold: prices.artifact(id) }))
    .filter((a) => a.gold > 0)
    .sort((a, b) => a.gold - b.gold);

  // One artifact per tier where a single one reaches it, and a handful where
  // the shipped table's dearest still falls short of 40 000.
  const arts: string[][] = [];
  for (let t = 0; t < PANDORA_TIERS.length; t++) {
    const want = PANDORA_TIERS[t]!.from;
    const ceiling = PANDORA_TIERS[t + 1]?.from ?? Infinity;
    const one = priced.find((a) => a.gold >= want && a.gold < ceiling);
    if (one) { arts.push([one.id]); continue; }
    // Stack the dearest until the tier is reached but not passed.
    const picked: string[] = [];
    let sum = 0;
    for (const a of [...priced].reverse()) {
      if (sum >= want) break;
      if (sum + a.gold >= ceiling) continue;
      picked.push(a.id); sum += a.gold;
    }
    arts.push(picked);
  }

  // Spells: a level is worth 1000, and the shipped set has plenty of each — so
  // a tier is a count of them. Level 5 spells first, for shorter lists.
  const spellIds = [...readFileSync(join(DATA, 'GameMechanics', 'RefTables', 'UndividedSpells.xdb'), 'utf8')
    .matchAll(/<ID>(SPELL_\w+)<\/ID>/g)].map((m) => m[1]!)
    .map((id) => ({ id, level: prices.spellLevel(id) }))
    .filter((s) => s.level > 0)
    .sort((a, b) => b.level - a.level);
  const spells: (string | number)[][] = [];
  for (let t = 0; t < PANDORA_TIERS.length; t++) {
    const want = PANDORA_TIERS[t]!.from;
    const ceiling = PANDORA_TIERS[t + 1]?.from ?? Infinity;
    const picked: string[] = [];
    let gold = 0;
    for (const s of spellIds) {
      if (gold >= Math.max(want, 1)) break;
      if (gold + s.level * 1000 >= ceiling) continue;
      picked.push(s.id); gold += s.level * 1000;
    }
    spells.push(picked);
  }
  return { arts, spells };
}

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

const setPath = (page: Launched['page'], id: string, path: (string | number)[], value: string) =>
  page.evaluate((p) => window.editor.setObjectPath({ id: p.id, path: p.path, value: p.value }),
    { id, path, value });

/**
 * Two heroes out of the catalogue — asked for, not named from memory.
 *
 * AN ENTRYPOINT IS NOT A HERO, and the catalogue does not say so: it is an
 * `AdvMapHero` whose Shared points at `/MapObjects/Utility/EntryPoint.xdb`
 * with the same `#xpointer(/AdvMapHeroShared)` a real hero carries. Taking
 * "the first one that is not Haven" picked exactly that, and the map then had
 * a live, coloured PLAYER_2 who owned nothing — which the game reports as
 * `ERROR: Start player does not exist on map/…`, three sentences away from the
 * cause (docs/CAMPAIGNS.md). A hero's record lives beside his RACE, so that is
 * what is asked for here.
 */
const HERO_RACES = ['Haven', 'Inferno', 'Necropolis', 'Sylvan', 'Academy', 'Dungeon', 'Fortress', 'Stronghold'];

async function twoHeroes(page: Launched['page']): Promise<string[]> {
  const found = await page.evaluate(async (races) => {
    const { objects } = await window.editor.listObjects();
    const heroes = objects.filter((o) => o.type === 'AdvMapHero' && !o.hidden && !o.random
      && races.some((r) => o.shared.includes(`/${r}/`)));
    const haven = heroes.find((o) => o.shared.includes('/Haven/'))?.shared ?? '';
    const other = heroes.find((o) => !o.shared.includes('/Haven/'))?.shared ?? '';
    return [haven, other];
  }, HERO_RACES);
  for (const h of found) expect(h, 'the catalogue offers two heroes of different races').not.toBe('');
  return found;
}

/** What the boxes are, worked out once and shared by the tests below. */
let BOXES: Placement[] = [];
/** Placement name → the object id it went down as. */
const ids = new Map<string, string>();

test.beforeAll(async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.skip(!existsSync(GAME), 'needs the prepared install');
  // The box exists for the editor exactly while the archive is in the install —
  // written here the same way the Gameplay tab's Apply writes it.
  writeGameplayArchive(GAME, DATA);
  clearMap(GAME, DATA, NAME);
  const { arts, spells } = contentsByPrice();
  BOXES = placements(arts, spells);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

test('the whole ladder goes down through the palette, four boxes to a kind', async () => {
  test.setTimeout(20 * 60_000);
  const { page } = ed;
  await newMap(page, NAME, '96');

  for (const b of BOXES) {
    const id = await place(page, BOX, b.x, b.y);
    await setPath(page, id, ['Name'], b.name);
    ids.set(b.name, id);
  }

  const placed = await page.evaluate(() => window.view.objects().map((o) => o.type));
  expect(placed.filter((t) => t === 'AdvMapTreasure'), 'every box is on the map')
    .toHaveLength(BOXES.length);
});

test('one box is filled in through the window, the way a person would', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  // The first box of the first side: selected on the map, opened from the
  // inspector's Contents… button, typed into, saved.
  const first = BOXES[0]!;
  const id = ids.get(first.name)!;
  await page.evaluate((oid) => window.view.select(oid), id);
  await page.locator('.pb-open button').click();
  await expect(page.locator('#pandora')).toBeVisible();
  await expect(page.locator('#pb-name')).toHaveText(first.name);

  await page.locator('#pb-gold').fill('12345');
  await page.locator('#pb-message').fill('Filled in by hand, through the window.');
  await page.locator('#pb-save').click();
  await expect(page.locator('#pandora')).toBeHidden();

  // What the window wrote is what the map now holds — asked of the channel the
  // window itself reads through, so a form that saves into the void is caught.
  const back = await page.evaluate((oid) => window.editor.pandoraGet(oid), id);
  expect(back.contents?.gold, 'the gold typed in is stored').toBe(12345);
  expect(back.contents?.message, 'and so is the message').toContain('through the window');
  // 12 345 gold is Green, and the placement is wearing it.
  expect(back.tier, 'the glow follows the value').toBe('Green');
  expect(back.worn, 'and the placement wears what it earned').toBe('Green');
});

test('the rest are filled in through the same channel, and every glow is earned', async () => {
  test.setTimeout(10 * 60_000);
  const { page } = ed;
  const prices = pandoraPrices(singleRoot(DATA));

  for (const b of BOXES) {
    // The hand-filled one keeps what the window put in it.
    if (b.name === BOXES[0]!.name) continue;
    const id = ids.get(b.name)!;
    const res = await page.evaluate((p) => window.editor.pandoraSet(p.id, p.contents),
      { id, contents: b.contents });
    const want = b.contents.tier ?? pandoraValue(b.contents, prices);
    const expected = typeof want === 'string' ? want
      : PANDORA_TIERS.filter((t) => want.total >= t.from).at(-1)!.key;
    expect(res.tier, `${b.name} earns ${expected}`).toBe(expected);
    // The name says which tier it was BUILT for; the value says which it got.
    expect(b.name.endsWith(res.tier), `${b.name} landed in ${res.tier}`).toBe(true);
  }

  // The rule the whole feature turns on, asserted on the map rather than in a
  // unit test: the same stack given and fought wears the same colour.
  for (const t of PANDORA_TIERS) {
    const given = await page.evaluate((n) => window.editor.pandoraGet(n), ids.get(`PandoraRArmy${t.key}`)!);
    const fought = await page.evaluate((n) => window.editor.pandoraGet(n), ids.get(`PandoraRGuard${t.key}`)!);
    expect(fought.value, `${t.key}: a guard is worth what a gift is worth`).toBe(given.value);
    expect(fought.worn, `${t.key}: and wears the same glow`).toBe(given.worn);
  }
});

test('two sides, each with a hero of their own', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  const heroes = await twoHeroes(page);
  for (const [i, side] of SIDES.entries()) {
    const id = await place(page, heroes[i]!, side.hero.x, side.hero.y);
    await setPath(page, id, ['PlayerID'], side.player);
    await page.evaluate(async (q) => {
      await window.editor.setMapPath({ path: ['players', q.slot, 'ActivePlayer'], value: 'true' });
      await window.editor.setMapPath({ path: ['players', q.slot, 'Colour'], value: q.colour });
      await window.editor.setMapPath({ path: ['players', q.slot, 'Team'], value: String(q.team) });
      await window.editor.setMapPath({
        path: ['players', q.slot, 'MainHero'], value: `#xpointer(id(${q.id})/AdvMapHero)`,
      });
    }, { ...side, id });

    // A HUNDRED ARCHANGELS for the first hero, so the guarded boxes can be
    // opened by whoever plays the map without a week of building up to it.
    if (i === 0) {
      await page.evaluate((oid) => window.editor.addObjectItem({ id: oid, path: ['armySlots'] }), id);
      await setPath(page, id, ['armySlots', 0, 'Creature'], 'CREATURE_ARCHANGEL');
      await setPath(page, id, ['armySlots', 0, 'Count'], '100');
    }
  }

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xml, 'the map binds a script for the boxes').toContain('MapScript.xdb#xpointer(/Script)');
  // The two sides are OPPONENTS. Left as they come, both slots are team 0 —
  // see SIDES above.
  expect((xml.match(/<Team>1<\/Team>/g) ?? []).length, 'the second side has a team of its own')
    .toBeGreaterThan(0);
  // AND THE MAP CAN BE STARTED AT ALL. The engine says one sentence for four
  // different mistakes, hours after the map was built; these rules say which,
  // here (src/map/startable.ts). This map failed on one of them — a player
  // whose only property was an EntryPoint.
  expect(startableProblems(loadMap(xml).desc), 'the game would refuse to start this map').toEqual([]);
  expect(xml, 'the first hero leads a hundred archangels').toContain('<Count>100</Count>');
  for (const b of BOXES) expect(xml, `${b.name} is on the map`).toContain(`<Name>${b.name}</Name>`);

  // THE GLOW, READ OFF THE FILE. Asking the editor what tier a box wears only
  // proves what the editor is holding: the first run of this map had every box
  // reporting its colour correctly through the channel and every placement
  // still pointing at Blue on disk, because an attribute set by hand is not
  // marked dirty and never gets written. So the map itself is asked.
  const items = xml.split('<Item ');
  for (const b of BOXES) {
    const item = items.find((s) => s.includes(`<Name>${b.name}</Name>`));
    expect(item, `${b.name} is in the map`).toBeTruthy();
    // Every box is named for the tier it was built for — except the one filled
    // in by hand, which was given 12 345 gold through the window and is Green
    // whatever its name says. That is the point of it: the glow follows the
    // contents, not the label.
    const tier = b.name === BOXES[0]!.name ? 'Green'
      : PANDORA_TIERS.find((t) => b.name.endsWith(t.key))!.key;
    expect(item, `${b.name} wears ${tier} on disk`).toContain(`PandoraBox_${tier}.(${PANDORA_CLASS}).xdb`);
  }
});

test('saving writes the block the game reads, and the texts it shows', async () => {
  test.setTimeout(5 * 60_000);
  const lua = readFileSync(join(MAP_DIR, 'MapScript.lua'), 'utf8');
  for (const b of BOXES) {
    expect(lua, `${b.name} is in the data table`).toContain(`H5E_PANDORA["${b.name}"]`);
    expect(lua, `${b.name} is hooked`).toContain(`Trigger(OBJECT_TOUCH_TRIGGER, "${b.name}"`);
  }
  // A guarded box fights before it opens, and the fight is written out in full
  // because Lua 4 cannot splice a table into an argument list.
  expect(lua, 'the guards fight').toContain('StartCombat(');
  expect(lua, 'and the behaviour is loaded last')
    .toMatch(/Trigger\(OBJECT_TOUCH_TRIGGER[\s\S]*doFile\("\/scripts\/homm5-editor\/pandora\.lua"\)/);

  // A talking box's message is a FILE — MessageBox takes a ref, so the text is
  // written beside the map and the block points at it.
  const talker = BOXES.find((b) => b.contents.message)!;
  expect(existsSync(join(MAP_DIR, `pandora-${talker.name}.txt`)), 'the message is a file').toBe(true);
  expect(lua, 'and the block points at it')
    .toContain(`/Maps/SingleMissions/${NAME}/pandora-${talker.name}.txt`);
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
  expect(names.some((n) => /pandora-Pandora\w+\.txt$/.test(n)), 'and the message texts').toBe(true);
  // The contents themselves are the EDITOR's memory and have no reader in the
  // game — what ships is the block above.
  expect(names.some((n) => n.endsWith(PANDORA_FILE)), 'the sidecar stays home').toBe(false);
  expect(names.some((n) => n.endsWith(`(${PANDORA_CLASS}).xdb`)), 'the box definitions live in the mod, not the map')
    .toBe(false);
});

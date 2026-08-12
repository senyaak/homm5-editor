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

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { DATA, hudSays, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { newMap } from './tiles.ts';
import { pickEntry, pickObject, placeAtTile, setTextRef } from './objects.ts';
import { clearMap, modGameRoot } from './mods.ts';
import { MADE } from './artifacts.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { readEntries } from '../src/format/pak.ts';
import { GAMEPLAY_ARCHIVE, writeGameplayArchive } from '../src/mods/gameplay.ts';
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
 *
 * AND NOTHING HERE ANNOUNCES A REWARD. The game does that itself for six of
 * the eight kinds; the two it does not — a spell taught and a stack given —
 * are silent in the ENGINE, and that is where they are being fixed
 * (native/qol/pandora-notify.c). A caption of ours under every gain was tried
 * and taken out again: it read as a second, worse copy of what the game had
 * already said.
 */
const KINDS: { key: string; says: string; per: (tier: number) => Partial<PandoraContents> }[] = [
  {
    key: 'Says',
    says: 'A message and nothing else. Four glows, no gift - the colour is the author\'s own.',
    per: (t) => ({
      message: `The box was empty, but it spoke: ${PANDORA_TIERS[t]!.key.toLowerCase()}.`,
      tier: PANDORA_TIERS[t]!.key,
    }),
  },
  { key: 'Exp', says: 'Experience: 1000, 7000, 20000, 60000 - left to right.', per: (t) => ({ exp: [1000, 7000, 20000, 60000][t]! }) },
  { key: 'Gold', says: 'Gold: 1000, 7000, 20000, 60000 - left to right.', per: (t) => ({ gold: [1000, 7000, 20000, 60000][t]! }) },
  {
    key: 'Res',
    says: 'Resources, worth the same as the gold row beside it.',
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
    says: 'Artifacts, priced off the game\'s own table - one glow each.',
    // Priced off the game's table at run time; the ids are picked below so each
    // copy lands in its tier.
    per: () => ({}),
  },
  {
    key: 'Spells',
    says: 'Spells to be taught. A hero with no book for them gets nothing here.',
    // A level is 1000 gold, so a stack of them is how a spell box gets rich.
    per: () => ({}),
  },
  {
    key: 'Army',
    says: 'Archangels, handed over: 1, 2, 5, 12 - left to right.',
    // Archangels at 3500 each: 1, 2, 5, 12.
    per: (t) => ({ creatures: [{ creature: 'CREATURE_ARCHANGEL', count: [1, 2, 5, 12][t]! }] }),
  },
  {
    key: 'Guard',
    says: 'The same archangels, GUARDING instead. Win and the box opens empty.',
    // THE SAME STACKS, on the other side of the fight. Same counts on purpose:
    // the pair must come out the same colour.
    per: (t) => ({ guards: [{ creature: 'CREATURE_ARCHANGEL', count: [1, 2, 5, 12][t]! }] }),
  },
  {
    key: 'Both',
    says: 'Guarded AND paying: a fight, then gold. The only row that walks the whole path.',
    // A BOX THAT IS GUARDED AND PAYS, which is what one is for — and the only
    // row that walks the whole path: question, taunt, battle, and a reward
    // handed over to whoever won. The rows above stop halfway each.
    //
    // The gold is what keeps each copy in its own glow beside the archangels:
    // 3500 a head, so 4000 / 8000 / 19500 / 47000.
    per: (t) => ({
      guards: [{ creature: 'CREATURE_ARCHANGEL', count: [1, 2, 5, 12][t]! }],
      gold: [500, 1000, 2000, 5000][t]!,
    }),
  },
];

/**
 * The two sides, and where each one's row of boxes sits.
 *
 * EACH ON HIS OWN TEAM, which is not decoration. A fresh slot is team 0, so two
 * players left as they came are ALLIES — and the map's default victory
 * condition is "defeat all", which on a map with no enemy is satisfied at load:
 * the game wins the mission, drops the winning player, and refuses to start
 * with "Start player does not exist on map" (docs/MAP_PROPERTIES.md).
 * Two sides that cannot fight each other are also not what this map is asking.
 */
const SIDES = [
  { slot: 0, team: 0, colour: 'PCOLOR_RED', player: 'PLAYER_1', tag: 'R', hero: { x: 10, y: 10 }, at: { x: 14, y: 12 } },
  { slot: 1, team: 1, colour: 'PCOLOR_BLUE', player: 'PLAYER_2', tag: 'B', hero: { x: 62, y: 62 }, at: { x: 66, y: 64 } },
];

/** One placement: where it goes, what it is called, what is in it. */
interface Placement { name: string; x: number; y: number; contents: PandoraContents }

/**
 * How far apart the boxes stand — one empty tile between neighbours.
 *
 * They were three apart, which spread nine rows of four over most of the map and
 * made a walk down the ladder a walk. Two is as tight as it goes while a hero
 * can still reach each one: touching boxes would be a wall, and the ones inside
 * it could not be opened at all.
 */
const STEP = 2;

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
          x: side.at.x + t * STEP,
          y: side.at.y + row * STEP,
          contents: { name, ...extra },
        });
      }
    });
  }
  return out;
}

/**
 * A signpost at the head of every row, saying what that row holds.
 *
 * Nine rows of four identical-looking boxes is a puzzle from the outside: the
 * glow says what a box is WORTH and nothing says what is in it, so the only way
 * to read the map was to have written it. The sign stands one tile to the LEFT
 * of the row's first box — smaller x — where a hero walking in from his own
 * start reaches it before the boxes.
 */
const SIGN = '/MapObjects/Sign.(AdvMapSignShared).xdb#xpointer(/AdvMapSignShared)';

/** One signpost: where it stands, the file its text goes in, and the text. */
interface Post { file: string; x: number; y: number; text: string }

/** Every signpost the map carries — one per row, both sides, and the barbarian's. */
function signposts(): Post[] {
  const out: Post[] = [];
  for (const side of SIDES) {
    KINDS.forEach((kind, row) => {
      out.push({
        file: `sign-${side.tag}${kind.key}`,
        x: side.at.x - STEP,
        y: side.at.y + row * STEP,
        text: `${kind.key.toUpperCase()} — ${kind.says}`,
      });
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

/**
 * Put one object down and answer with its id — mod-010's bounded retry.
 *
 * `arm` is whatever picks the swatch: a shared definition for the boxes, a
 * palette path for the heroes, where WHICH swatch is clicked is the point.
 */
async function place(
  page: Launched['page'], arm: () => Promise<void>, what: string, x: number, y: number,
): Promise<string> {
  let added: { id: string }[] = [];
  for (let attempt = 1; attempt <= 3 && added.length !== 1; attempt++) {
    await arm();
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    await placeAtTile(page, x, y);
    added = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
    expect(added.length, `one click on ${x},${y} put down ${added.length} objects`).toBeLessThan(2);
  }
  expect(added, `placing ${what} at ${x},${y} put down one object, in three tries`).toHaveLength(1);
  return added[0]!.id;
}

const setPath = (page: Launched['page'], id: string, path: (string | number)[], value: string) =>
  page.evaluate((p) => window.editor.setObjectPath({ id: p.id, path: p.path, value: p.value }),
    { id, path, value });

/**
 * Two heroes out of the palette's **GenericHeroes** folder — a Knight, a
 * Barbarian, one per class, which is what a map wants a side led by.
 *
 * NOT A NAMED ONE. Asking the catalogue for "a hero whose record sits beside a
 * race" answers with the first file in the folder, and in `MapObjects/Haven`
 * that is Alaric — a campaign hero, who is not in the standard pool at all.
 *
 * A GENERIC ENTRY STILL PLACES A REAL HERO, and the map records him by name:
 * the entry is a `RndGroup` over its class's standard pool
 * (`Heroes/Haven_Standart.xdb` and friends) and the editor places its first
 * member, so these two sides are led by `Stronghold/Hero1` and `Inferno/Calid`.
 * What is generic is the SWATCH — one per class, because the model is one per
 * class (Brem, Christian and Alaric all wear `Heroes/Knight_LOD`). No shipped
 * map mentions an `AdvMapSharedGroup` anywhere, so a group is something the
 * palette offers and never something a map carries.
 *
 * AND AN ENTRYPOINT IS NOT A HERO — it sits in that very folder. It is an
 * `AdvMapHero` whose Shared points at `/MapObjects/Utility/EntryPoint.xdb`
 * with the same `#xpointer(/AdvMapHeroShared)` a real hero carries, so no check
 * on the class or the xpointer tells it apart. Taking one gave the map a live,
 * coloured PLAYER_2 who owned nothing, which the game reports as `ERROR: Start
 * player does not exist on map/…`, three sentences away from the cause
 * (docs/MAP_PROPERTIES.md). The DOCUMENT is the difference, and that is what is
 * asked here.
 */
const GENERIC_HEROES = 'MapObjects/_(AdvMapObjectLink)/GenericHeroes';

/**
 * And WHICH generic heroes, which is not a free choice on this map.
 *
 * A BARBARIAN HAS NO SPELLBOOK. Taking the folder's first two entries gave the
 * first side a Barbarian, and a row of boxes that teach spells has nowhere to
 * put them — `TeachHeroSpell` on a hero with no book is a reward that lands
 * nowhere and says nothing, which reads from the outside exactly like a broken
 * box. The two named here can both carry a book; the fallback keeps the spec
 * working against a palette that does not offer them.
 */
const LEADS = ['Knight', 'Demonlord'];

/**
 * And a third hero, whose whole job is one question: what happens when a box
 * hands a spell to somebody who cannot hold it.
 *
 * A BARBARIAN HAS A BOOK OF HIS OWN — cries, not spells — so the two boxes
 * beside him are the two halves of the question: one holds war cries, which
 * the game's own campaign teaches a barbarian with the very same call
 * (`TeachHeroSpell("Kujin", SPELL_WARCRY_RALLING_CRY)` in A2C3M4), and the
 * other holds Town Portal, which has nowhere to go. He belongs to the first
 * side, so whoever plays red can walk over and read both answers.
 */
// WELL CLEAR OF THE LADDER, which is the point: two boxes wedged between its
// rows read as part of it, and the question they ask is a different one.
//
// LEFT IS THE SMALLER x — the direction this file had backwards twice. On
// screen north is up and bigger `y` goes up with it, but `x` grows to the
// RIGHT, so the ladder at x = 14…23 is to the right of this and blue's rows,
// far away at x = 66, are further right still.
// BELOW THE LADDER, not beside it: with the boxes two apart the rows now reach
// y = 28, and this line at 32 is clear of them with room for a row of its own.
const BARBARIAN = { at: { x: 2, y: 32 }, entry: `${GENERIC_HEROES}/Barbarian.xdb` };
const CRIES = ['SPELL_WARCRY_RALLING_CRY', 'SPELL_WARCRY_CALL_OF_BLOOD'];

/**
 * The barbarian's own row: what he CAN hold, then the whole ladder and one box
 * past the end of it.
 *
 * ONE STEP PER BOX is the rule the feature is built on, so a single box could
 * only ever show the first rung. Five show the lot: boat, creatures, dimension
 * door, town portal — and then a fifth holding Town Portal again, which is the
 * question no other box asks. His talisman is at the top by then, so
 * `H5ETalismanStep` must answer "no" and the box must fall back to teaching —
 * where the engine refuses him, and nothing at all should happen.
 *
 * The spell in each box is what an ordinary hero would be taught by it; for the
 * barbarian it is only the label, since which rung he gets depends on where his
 * talisman already stands.
 */
const LADDER = [
  'SPELL_SUMMON_BOAT', 'SPELL_SUMMON_CREATURES', 'SPELL_DIMENSION_DOOR', 'SPELL_TOWN_PORTAL',
];
const BARBARIAN_BOXES = [
  {
    name: 'PandoraCriesForTheBarbarian', x: 6, y: BARBARIAN.at.y,
    contents: { name: 'PandoraCriesForTheBarbarian', spells: CRIES },
  },
  ...[...LADDER, 'SPELL_TOWN_PORTAL'].map((spell, i) => ({
    name: `PandoraTalisman${i + 1}`, x: 8 + i * STEP, y: BARBARIAN.at.y,
    contents: { name: `PandoraTalisman${i + 1}`, spells: [spell] },
  })),
];

/**
 * A town for red, because a box that hands over Town Portal proves nothing
 * without somewhere for the portal to go.
 *
 * It is a Stronghold one and it carries the **Traveller's Shelter** from turn
 * one (`TB_SPECIAL_3`, screen `UI/ArtefactMagic`) — the shipped game's own way
 * of giving a barbarian adventure magic, which is the thing a box of ours has
 * to end up doing. Standing beside the boxes, it is what their answer is
 * compared against. Listing a building is not building it: `BLD_UPG_1` is what
 * a shipped map writes for one that stands at the start
 * (see e2e/campaign-three.spec.ts).
 */
const TOWN = {
  at: { x: 32, y: 26 },
  shared: /Orc_Stronghold\.\(AdvMapTownShared\)/i,
  buildings: ['TB_TOWN_HALL', 'TB_FORT', 'TB_SPECIAL_3'],
};

async function twoHeroes(page: Launched['page']): Promise<string[]> {
  const found = await page.evaluate(async (q) => {
    const { objects } = await window.editor.listObjects();
    const all = objects
      .filter((o) => o.type === 'AdvMapHero' && !o.hidden
        && o.path.toLowerCase().startsWith(`${q.folder.toLowerCase()}/`)
        && !/EntryPoint/i.test(o.shared.split('#')[0] ?? ''));
    // The classes this map wants first, in the order it wants them; anything
    // else after, so a palette without them still answers.
    const rank = (path: string): number => {
      const i = q.leads.findIndex((c) => path.toLowerCase().endsWith(`/${c.toLowerCase()}.xdb`));
      return i < 0 ? q.leads.length : i;
    };
    const generic = all.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
    // Two different heroes, not one class twice — the sides are told apart by
    // who leads them as much as by their colour.
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const o of generic) {
      if (seen.has(o.shared)) continue;
      seen.add(o.shared);
      picked.push(o.path);
      if (picked.length === 2) break;
    }
    return picked;
  }, { folder: GENERIC_HEROES, leads: LEADS });
  expect(found, 'the palette offers two generic heroes of different classes').toHaveLength(2);
  // Named rather than hoped for: the first side leads the row of spell boxes,
  // and a class with no spellbook makes that row untestable.
  expect(found[0]!.toLowerCase(), `the first side is led by a ${LEADS[0]}`)
    .toContain(`/${LEADS[0]!.toLowerCase()}.xdb`);
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
    const id = await place(page, () => pickObject(page, BOX), b.name, b.x, b.y);
    await setPath(page, id, ['Name'], b.name);
    ids.set(b.name, id);
  }

  // A SIGN AT THE HEAD OF EVERY ROW. Written through the panel's own New — the
  // field takes a text REF, so a sign with a message needs the file to exist,
  // and that button is what makes one where a person would.
  for (const post of signposts()) {
    const id = await place(page, () => pickObject(page, SIGN), post.file, post.x, post.y);
    await page.evaluate((oid) => window.view.select(oid), id);
    await setTextRef(page, 'MessageFileRef', post.file, post.text);
  }

  const placed = await page.evaluate(() => window.view.objects().map((o) => o.type));
  expect(placed.filter((t) => t === 'AdvMapTreasure'), 'every box is on the map')
    .toHaveLength(BOXES.length);
  expect(placed.filter((t) => t === 'AdvMapSign'), 'and every row is labelled')
    .toHaveLength(signposts().length);
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
    const id = await place(page, () => pickEntry(page, heroes[i]!), heroes[i]!, side.hero.x, side.hero.y);
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

  // THE THIRD HERO, and the two boxes that ask about him. A barbarian keeps
  // cries where everybody else keeps spells, so one box holds cries and the
  // other holds a spell that has nowhere to go; both are red's, a few tiles
  // below his own hero, so the answer is a short walk away.
  const barb = await place(page, () => pickEntry(page, BARBARIAN.entry), BARBARIAN.entry,
    BARBARIAN.at.x, BARBARIAN.at.y);
  await setPath(page, barb, ['PlayerID'], SIDES[0]!.player);
  for (const b of BARBARIAN_BOXES) {
    const id = await place(page, () => pickObject(page, BOX), b.name, b.x, b.y);
    await setPath(page, id, ['Name'], b.name);
    await page.evaluate((p) => window.editor.pandoraSet(p.id, p.contents), { id, contents: b.contents });
  }
  // And his own signpost, between him and the row — the one row on the map
  // where the boxes hand over two different things depending on who opens them.
  const barbSign = await place(page, () => pickObject(page, SIGN), 'sign-barbarian',
    BARBARIAN.at.x + STEP, BARBARIAN.at.y);
  await page.evaluate((oid) => window.view.select(oid), barbSign);
  await setTextRef(page, 'MessageFileRef', 'sign-barbarian',
    'CRIES, then the TALISMAN. The first box holds war cries, which a barbarian'
    + ' can be taught. The five after it hold adventure magic, which he cannot -'
    + ' each one raises his talisman by a single step instead: boat, creatures,'
    + ' dimension door, town portal. The fifth is one past the top and should'
    + ' hand over nothing at all.');

  // A TOWN FOR RED, so Town Portal has somewhere to go and the shelter that
  // sells talismans can be walked into and compared with.
  const townShared = await page.evaluate(async (rx) => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapTown' && new RegExp(rx, 'i').test(o.shared))?.shared ?? '';
  }, TOWN.shared.source);
  expect(townShared, 'the palette offers a Stronghold town').toBeTruthy();
  const town = await place(page, () => pickObject(page, townShared), 'town', TOWN.at.x, TOWN.at.y);
  await setPath(page, town, ['PlayerID'], SIDES[0]!.player);
  for (const [i, b] of TOWN.buildings.entries()) {
    await page.evaluate((oid) => window.editor.addObjectItem({ id: oid, path: ['buildings'] }), town);
    await setPath(page, town, ['buildings', i, 'Type'], b);
    await setPath(page, town, ['buildings', i, 'InitialUpgrade'], 'BLD_UPG_1');
    await setPath(page, town, ['buildings', i, 'MaxUpgrade'], 'BLD_UPG_5');
  }

  await bar(page, '#save');
  await hudSays(page, /saved/i, 120_000);

  const xml = readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1');
  expect(xml, 'the map binds a script for the boxes').toContain('MapScript.xdb#xpointer(/Script)');
  for (const b of BARBARIAN_BOXES) {
    expect(xml, `${b.name} is on the map`).toContain(`<Name>${b.name}</Name>`);
  }

  // And the town the portal boxes need, with the shelter standing from turn one.
  expect(xml, 'red has a town with a Traveller\'s Shelter').toContain('<Type>TB_SPECIAL_3</Type>');
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

  // AND NOTHING SAYS WHAT WAS HANDED OVER. The game announces its own gains,
  // so a line of ours under each was noise — and the two it stays silent about
  // are being given the engine's own announcement instead
  // (native/qol/pandora-notify.c). Nothing but the author's texts ships.
  const strays = readdirSync(MAP_DIR).filter((f) => /-gift\.txt$/.test(f));
  expect(strays, 'no receipts are written beside the map').toEqual([]);
  expect(lua, 'and the block points at none').not.toContain('report =');

  // AND THE BARBARIAN'S BOX ASKS FOR A TALISMAN STEP, not for a spell he cannot
  // hold. The split is made where the ladder is known — at save, off the game's
  // own table — so this is the one place it can be seen to have happened.
  //
  // ONE ENTRY AT A TIME, cut at its own closing brace: `H5E_PANDORA["x"] = {…};`
  // and nothing of the next box, so a list found here belongs to the box named.
  const entryOf = (name: string): string => {
    const from = lua.indexOf(`H5E_PANDORA["${name}"]`);
    expect(from, `${name} has an entry in the block`).toBeGreaterThan(-1);
    return lua.slice(from, lua.indexOf('};', from));
  };
  const portalBox = BARBARIAN_BOXES.find((b) => b.contents.spells?.includes('SPELL_TOWN_PORTAL'))!;
  expect(entryOf(portalBox.name), `${portalBox.name} carries Town Portal as adventure magic`)
    .toContain('adventure = { SPELL_TOWN_PORTAL }');
  // The cries stay ordinary teaching — they are the half a barbarian CAN hold,
  // and a rule that swept them into the ladder would be the same bug the other
  // way round.
  const criesBox = BARBARIAN_BOXES.find((b) => b.name.includes('Cries'))!;
  expect(entryOf(criesBox.name), 'and the cries are still taught')
    .toContain('spells = { SPELL_WARCRY_RALLING_CRY, SPELL_WARCRY_CALL_OF_BLOOD }');
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

test('and the whole box is one tick in the Gameplay tab, both ways', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  const archive = join(GAME, GAMEPLAY_ARCHIVE);
  const flags = join(GAME, 'bin', 'homm5-editor-qol.txt');

  // ASKED WITH THE ARCHIVE GONE. Everything above wrote it directly
  // (writeGameplayArchive in beforeAll), so a test that only looked would find
  // it there and say the switch worked whatever the switch does — the same
  // trap as measuring a fix with the fix already on.
  rmSync(archive, { force: true });

  await page.locator('#qolbtn').click();
  await expect(page.locator('#qolcfg')).toBeVisible();
  await page.locator('#qol-tab-gameplay').click();
  await expect(page.locator('#qol-gameplay'), 'the box lives on its own tab').toBeVisible();
  await page.locator('#qol-pandora-box').check();
  await page.locator('#qol-apply').click();
  await expect(page.locator('#qol-msg')).toContainText(/settings written|installed/i, { timeout: 120_000 });

  expect(existsSync(archive), 'ticking it puts the archive back').toBe(true);
  expect(readFileSync(flags, 'utf8'), 'and the extension is told to take the chest away')
    .toMatch(/^pandora-box 1$/m);

  // AND OFF AGAIN, which is the half that matters: the archive IS the object,
  // so a switch that cannot take it out leaves every install that ever tried
  // the box carrying it for good.
  await page.locator('#qol-pandora-box').uncheck();
  await page.locator('#qol-apply').click();
  await expect.poll(() => existsSync(archive), { timeout: 120_000 }).toBe(false);
  expect(readFileSync(flags, 'utf8'), 'and the gate goes with it').toMatch(/^pandora-box 0$/m);

  // Left ON, because what this run produces is a map to play: an install whose
  // last word was "off" has no box for the sixty-four placements to point at.
  await page.locator('#qol-pandora-box').check();
  await page.locator('#qol-apply').click();
  await expect.poll(() => existsSync(archive), { timeout: 120_000 }).toBe(true);
  await page.locator('#qol-close').click();
});

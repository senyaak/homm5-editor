// Stage 007 of the mod chain: the Sharpshooter Test map, in three sittings.
//
// One spec grew to six tests and eight hundred lines, so it lives as a folder
// now, the way the C1M1 reconstruction does — numbered files over one on-disk
// map, each launching the editor and reopening what the one before left:
//
//   001-original    build the map the way a person would, hold it against the
//                   hand-made original, pack it
//   002-proving-ground   Gem with her army, the stones and the ladder of foes
//   003-buildings   one of every building the mod carries, placed and working
//
// What is HERE is what all three share: the map's plan (the literal constants
// that read like the plan of the map), the reference paths, the helpers that
// drive placement, and the two doors every sitting enters through — launch,
// and reopen-through-the-picker.
//
// The hand-made original is the REFERENCE: it is unpacked once into _tmp and
// nothing here ever writes to it. The mod the map is made of — the
// Sharpshooter, its palace, three artifacts — is BUILT into this run's own
// game root as a fixture (e2e/mods.ts), not copied off the real install: a
// spec that borrows whatever somebody happened to build passes or fails on
// their game rather than on the code.

import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { launchEditor, REPO_ROOT } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { editStruct, placeAtTile, setPlacement, setTextRef } from '../objects.ts';
import { addValueItem, setTreeTextRef, setTreeValue } from '../tree.ts';
import { readEntries } from '../../src/format/pak.ts';
import { MOD_EXT, modFile } from '../../src/game/mod-paths.ts';
import { installMapFixture, LIVE, modGameRoot, PALACE_SHARED, REAL_GAME } from '../mods.ts';

export const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** This run's own game install: the fixture mod goes here, the archive comes out here. */
export const GAME = modGameRoot();
/**
 * The map this stage rebuilds.
 *
 * `assets/maps/` first — the checkout's own copy, which makes the run the same
 * on any machine. It is not in the repo and cannot be: the map was made by
 * editing one the stock editor produced (assets/README.md). Absent, the
 * installed one is used, under either the name our build writes or the old one.
 */
export const ORIGINAL = [
  join(REPO_ROOT, 'assets', 'maps', 'Sharpshooter Test.h5m'),
  modFile(REAL_GAME, 'map', 'Sharpshooter Test'),
  join(REAL_GAME, 'Maps', 'Sharpshooter Test.h5m'),
].find((p) => existsSync(p)) ?? '';
/** The original, unpacked as the reference. Read-only after unpackReference. */
export const REF_ROOT = join(REPO_ROOT, '_tmp', 'e2e-sharp-ref');
export const REF = join(REF_ROOT, 'Maps', 'SingleMissions', 'Sharpshooter Test');

export const NAME = 'Sharpshooter Test';
export const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
export const ARCHIVE = modFile(GAME, 'map', NAME);

export const SHARPSHOOTER = 'CREATURE_H3_SHARPSHOOTER';
/** The hero mod-004 installs, as the palette lists him and the map stores him. */
export const GEM = '/Heroes/H3Gem/H3Gem.(AdvMapHeroShared).xdb';
/** Clear of the town, the three heroes and the neutral stacks. */
export const GEM_AT = { x: 44, y: 40 };

/**
 * What a class needs from its PLACEMENT before it does anything.
 *
 * Not a nicety: a shrine with `SPELL_NONE` and a sign with no file are objects
 * that stand on the map and answer nothing at all, which is exactly how they
 * came out the first time this map was walked around (BUILDINGS.md §3).
 */
export const NEEDS: Record<string, Record<string, string>> = {
  // Ours is the Magma Shrine — runic, circles 1 to 3 — so it teaches a rune.
  AdvMapShrineShared: { SpellID: 'SPELL_RUNE_OF_CHARGE' },
};

/** The sign's words. A reference to an empty file is the same empty box. */
export const SIGN_TEXT = 'ЗдЕсЬ БыЛ ЗнАк: за ним — верфь, а перед ней хижина пророка.';

/**
 * The seer hut's errand.
 *
 * `COLLECT_RESOURCES` is the one kind that needs nothing else placed on the map:
 * its parameters are a resource index (wood 0 … gem 5, gold 6) and an amount, so
 * a hero who walks up with the gold completes it where it stands. Everything
 * else — the caption, the description, an award that is not `AWARD_NONE` — is
 * what turns the structure into an errand rather than a silent building.
 */
export const QUEST = {
  name: 'E2E_SEER_QUEST',
  caption: 'ПрОсЬбА ПрОрОкА',
  description: 'Принеси мне 500 золота, и я открою тебе то, что стоит 5000 опыта.',
  kind: 'OBJECTIVE_KIND_COLLECT_RESOURCES',
  parameters: ['6', '500'],
  award: 'AWARD_EXPERIENCE',
  experience: '5000',
};

/**
 * The shipyard, and the water without which it is a hut that says nothing.
 *
 * `ShipTile` is an OFFSET from the object's own tile and it has to land on
 * water — true of 42 of the 46 shipyards the game ships. This map is flat grass
 * to its edges, so the water is dug first, with the Lower brush, which is the
 * tool that digs to exactly 0.0 and flags the bed as sea. The shipyard then
 * stands beside it rather than in the grid the others share: it is the one
 * building whose position is decided by the terrain.
 */
export const SHIPYARD_CLASS = 'AdvMapShipyardShared';
export const SHIPYARD_AT = { x: 46, y: 64 };
export const SHIP_OFFSET = { x: 0, y: 4 };
/** Two 7×7 strokes, clear of the building above them and of the map's edge. */
export const BASIN: readonly [number, number][] = [[44, 69], [48, 69]];

/** The original's placements — read off its map.xdb, kept literal so the spec
 *  reads like the plan of the map. */
export const PLACES = {
  town: { shared: '/MapObjects/Academy.(AdvMapTownShared).xdb', x: 45, y: 47 },
  heroes: [
    { shared: '/MapObjects/Academy/Sufi.(AdvMapHeroShared).xdb', x: 34, y: 37, player: 'PLAYER_1', count: 12, artifacts: [] as string[] },
    // Back at 40. She was moved to 38 to get out of SylvanStonehenge's
    // footprint, and that building is no longer on this map.
    { shared: '/MapObjects/Preserve/Diraya.(AdvMapHeroShared).xdb', x: 40, y: 37, player: 'PLAYER_2', count: 8, artifacts: [] as string[] },
    {
      shared: '/MapObjects/Necropolis/Straker.(AdvMapHeroShared).xdb', x: 34, y: 40, player: 'PLAYER_1', count: 12,
      artifacts: ['ARTIFACT_TREEBORN_QUIVER', 'ARTIFACT_H3_UNDERTAKERS_AMULET', 'ARTIFACT_H3_VAMPIRES_CLOAK', 'ARTIFACT_H3_DEAD_MANS_BOOTS'],
    },
  ],
  // The neutral stacks: the mod's Sharpshooter between the heroes, and the two
  // Peasant stacks the original also has south of them.
  monsters: [
    { shared: '/Units/H3Sharpshooter/H3Sharpshooter.(AdvMapMonsterShared).xdb', x: 37, y: 40, amount: 6 },
    { shared: '/MapObjects/Haven/Peasant.(AdvMapMonsterShared).xdb', x: 36, y: 42, amount: 100 },
    { shared: '/MapObjects/Haven/Peasant.(AdvMapMonsterShared).xdb', x: 38, y: 42, amount: 100 },
  ],
  // ONE dwelling, and it is here to prove something: the Sharpshooter's palace
  // is a dwelling for a creature the game does not ship, which is the editor's
  // own feature. The eight tier 4–7 dwellings and the mummies' pyramid used to
  // stand here too and were taken off — they are the port's CONTENT, they
  // exercise nothing this spec is about, and a map that is mostly content takes
  // longer to rebuild for no answer.
  // It is authored as a BUILDING of the dwelling class now (mod-006), so it
  // lives under Buildings/ with the art it owns — the path is the fixture's to
  // say rather than this spec's to spell.
  dwellings: [
    { shared: PALACE_SHARED, x: 48, y: 37 },
  ],
  artifacts: [
    { shared: '/Artifacts/H3UndertakersAmulet/H3UndertakersAmulet.(AdvMapArtifactShared).xdb', x: 32, y: 39 },
    { shared: '/Artifacts/H3VampiresCloak/H3VampiresCloak.(AdvMapArtifactShared).xdb', x: 30, y: 39 },
    { shared: '/Artifacts/H3DeadMansBoots/H3DeadMansBoots.(AdvMapArtifactShared).xdb', x: 29, y: 39 },
  ],
};

/**
 * The proving ground, added AFTER the map has held against the original.
 *
 * Not decoration and not content: it is what makes this map usable as a test
 * bed for anything that depends on a hero's LEVEL or on his army taking
 * damage — a specialization scaling per level, a war machine, a skill. Twice
 * now it has been added by hand to the packed map, and twice the next run of
 * this spec repacked the map and washed it away. So it is generated.
 *
 * Two rows of learning stones north of the heroes, on tiles nothing else uses,
 * and a ladder of neutral stacks along the bottom of the map, from fodder to
 * something with teeth. Everything the original carries sits between rows 37
 * and 47; the buildings of mod-005 take the bottom LEFT (x 6…38 at y 48, 56,
 * 64) and the shipyard's bay the bottom middle — so the stacks go right of
 * them, and the stones above.
 */
/** What Gem is placed with — three stacks of the mod's own creature. */
export const GEM_ARMY = [250, 250, 250];

export const STONE = '/MapObjects/Learning_Stone.(AdvMapBuildingShared).xdb';
export const STONES: readonly [number, number][] = [
  [28, 34], [30, 34], [32, 34], [34, 34], [36, 34], [38, 34],
  [28, 36], [30, 36], [32, 36], [34, 36], [36, 36], [38, 36],
];

/**
 * Ten stacks, deliberately different creatures rather than ten of one.
 *
 * A tent is tested by what it has to mend, and that differs by what hit the
 * army: shooters wound from afar, a hydra takes a stack apart, a lich kills
 * outright. Amounts grow left to right and top to bottom, so a hero can start
 * at the west end and work along as he levels.
 */
export const FOES: readonly { shared: string; x: number; y: number; amount: number }[] = [
  { shared: '/MapObjects/Haven/Peasant.(AdvMapMonsterShared).xdb', x: 44, y: 56, amount: 300 },
  { shared: '/MapObjects/Necropolis/Sceleton_Archer.(AdvMapMonsterShared).xdb', x: 49, y: 56, amount: 150 },
  { shared: '/MapObjects/Haven/Footman.(AdvMapMonsterShared).xdb', x: 54, y: 56, amount: 120 },
  { shared: '/MapObjects/Stronghold/Centaur.(AdvMapMonsterShared).xdb', x: 59, y: 56, amount: 100 },
  { shared: '/MapObjects/Preserve/Sprite.(AdvMapMonsterShared).xdb', x: 64, y: 56, amount: 140 },
  { shared: '/MapObjects/Haven/Griffin.(AdvMapMonsterShared).xdb', x: 44, y: 60, amount: 70 },
  { shared: '/MapObjects/Inferno/Cerberi.(AdvMapMonsterShared).xdb', x: 49, y: 60, amount: 60 },
  { shared: '/MapObjects/Dungeon/Minotaur.(AdvMapMonsterShared).xdb', x: 54, y: 60, amount: 45 },
  { shared: '/MapObjects/Necropolis/Vampire.(AdvMapMonsterShared).xdb', x: 59, y: 60, amount: 40 },
  { shared: '/MapObjects/Dungeon/Hydra.(AdvMapMonsterShared).xdb', x: 64, y: 60, amount: 20 },
];

export function cleanup(): void {
  // Live, nothing is swept: the install is the game, the packed map is the
  // point, and the working tree beside it is what a person would have left.
  if (LIVE) return;
  // The INSTALL is not swept here even isolated — mod-009 reads it, being the
  // stage that asks what the run actually put on disk. It takes it away when it
  // is done.
  for (const p of [REF_ROOT, MAP_DIR]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

/** A map text is UTF-16LE with a BOM; decode it to compare content. */
export function decode(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  return buf.toString('utf8');
}

/** The reference, unpacked once. 001 needs it; the others never read it. */
export function unpackReference(): void {
  if (!existsSync(ORIGINAL) || existsSync(join(REF, 'map.xdb'))) return;
  for (const e of readEntries(readFileSync(ORIGINAL))) {
    const path = join(REF_ROOT, e.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, e.data);
  }
}

/**
 * The door every sitting enters through: the fixture ensured (idempotent, and
 * it never deletes the map under reconstruction), the editor launched on this
 * run's install, and Pack's save dialog answered — the one thing Playwright
 * cannot click is the OS dialog, so its answer is fixed to where the game
 * would look.
 */
export async function startSharp(): Promise<Launched> {
  installMapFixture(GAME);
  const ed = await launchEditor({ HOMM5_ROOT: GAME });
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, ARCHIVE);
  return ed;
}

/**
 * The map on screen, whether or not this sitting built it.
 *
 * A later file starts at the picker; the same door also catches a renderer
 * that reloaded to the start screen mid-file (main prints `[renderer gone] …`
 * when the renderer process died) — surface the app's log instead of clicking
 * at a dead page. The search filters WITHIN the active category chip, so All
 * is picked first; what the picker lists is the packed map in our folder.
 */
export async function openSharp(ed: Launched): Promise<void> {
  const { page } = ed;
  if (((await page.locator('#title').textContent()) ?? '').includes(NAME)) return;
  expect(existsSync(join(MAP_DIR, 'map.xdb')),
    `the rebuilt map is on disk — 001-original builds it (app log tail:\n${ed.log.slice(-15).join('\n')})`).toBe(true);
  await page.locator('#cats .chip', { hasText: 'All' }).click();
  await page.locator('#search').fill(NAME);
  const row = page.locator('#maplist .m', { hasText: `${NAME}.${MOD_EXT.map}` }).first();
  await expect(row, 'the picker lists the rebuilt map').toBeVisible();
  await row.click();
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
}

/** Place one object and give it its exact tile; returns its id. */
export async function placeOne(page: Launched['page'], shared: string, x: number, y: number): Promise<string> {
  const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
  await placeAtTile(page, Math.round(x), Math.round(y));
  const after = await page.evaluate(() => window.view.objects());
  const added = after.filter((o) => !before.has(o.id));
  expect(added, `placing ${shared} added one object`).toHaveLength(1);
  const id = added[0]!.id;
  await page.evaluate((oid) => window.view.select(oid), id);
  await setPlacement(page, { x, y });
  return id;
}

/**
 * The rest of what a placement needs, where a value in a box is not enough.
 *
 * `NEEDS` covers the classes whose field is a plain value. These three are not:
 * a sign's message is a REFERENCE to a text file that has to be made and
 * written, and a seer hut's quest and a shipyard's ship tile are STRUCTURES,
 * edited in the object's own tree behind the panel's "Edit…". Each is driven
 * here the way a person drives it, which is the point of doing it at all —
 * the map that comes out is only worth having if the window can make it.
 */
export async function fillPlacement(page: Launched['page'], className: string): Promise<void> {
  if (className === 'AdvMapSignShared') {
    await setTextRef(page, 'MessageFileRef', 'sign-message', SIGN_TEXT);
    return;
  }
  if (className === 'AdvMapSeerHutShared') {
    await editStruct(page, 'Quest');
    await setTreeValue(page, ['Quest', 'Name'], QUEST.name);
    await setTreeTextRef(page, ['Quest', 'CaptionFileRef'], 'seer-caption', QUEST.caption);
    await setTreeTextRef(page, ['Quest', 'DescriptionFileRef'], 'seer-desc', QUEST.description);
    await setTreeValue(page, ['Quest', 'Kind'], QUEST.kind);
    for (const p of QUEST.parameters) await addValueItem(page, ['Quest', 'Parameters'], p);
    await setTreeValue(page, ['Quest', 'Award', 'Type'], QUEST.award);
    await setTreeValue(page, ['Quest', 'Award', 'Experience'], QUEST.experience);
    await closeTree(page);
    return;
  }
  if (className === SHIPYARD_CLASS) {
    await editStruct(page, 'ShipTile');
    await setTreeValue(page, ['ShipTile', 'x'], String(SHIP_OFFSET.x));
    await setTreeValue(page, ['ShipTile', 'y'], String(SHIP_OFFSET.y));
    await closeTree(page);
  }
}

/** Put the tree away — the panel is where the next object is selected. */
export async function closeTree(page: Launched['page']): Promise<void> {
  await page.locator('#mt-close').click();
  await expect(page.locator('#mt-dialog')).toBeHidden();
}

/** One object's element out of the map, by class — one of each is placed here. */
export const blockOf = (xml: string, tag: string): string =>
  xml.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0] ?? '';

/** Run a gap report; the tools exit 1 on differences, so catch and read. */
export function gaps(tool: string, a: string, b: string): string[] {
  let out: string;
  try {
    out = execFileSync('node', [join('tools', tool), a, b], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    out = err.stdout ?? '';
    // Exit 1 with a report is "differences found"; anything else — no report,
    // exit 2, a missing input file — is the TOOL failing, and swallowing that
    // would read as "no differences". Fail loudly instead.
    if (!out.includes('DIFF') && !out.includes('difference')) {
      throw new Error(`${tool} did not produce a report (exit ${err.status}):\n${out}\n${err.stderr ?? ''}`);
    }
  }
  const diffs = out.split('\n').filter((l) => l.includes('DIFF'));
  // The summary lines name the field; the full report says which value — and
  // the next fix needs the value.
  if (diffs.length) console.log(`--- ${tool}\n${out}`);
  return diffs;
}

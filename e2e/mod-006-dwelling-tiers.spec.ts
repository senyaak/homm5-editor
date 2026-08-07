// A dwelling built out of a TOWN-SCREEN model, authored through the window.
//
// The stage next door builds a dwelling for a creature the game does not ship;
// this one builds a dwelling the game has the ART for and no object of. Heroes V
// gives a faction three dwellings, tiers 1 to 3, and one Military Post that sells
// tiers 4 to 7 from a single building — so the campaign's tier-4-to-7 buildings
// have to be split out of that post, and the only art for them is on the town
// screen, where all seven are built.
//
// WHICH IS NOT MAP ART, and that is the subject here. A town model is two to
// three times map scale AND stands where it sits in the town scene — the Unicorn
// Glade's centre is at (280, 328) — so dropped on the map it is a giant standing
// nowhere near the tile that placed it. `Bake to tiles` is the form's answer:
// copy it, move it to the origin, scale it to that many tiles, and measure the
// footprint off the result.
//
// So the checks are on the GEOMETRY the mod carries, not on what the window
// said. Both halves of a bake are asked for separately — the copy has to be about
// four tiles wide, and it has to be centred on nothing — because either alone
// passes on a model that was never touched: a model still at town scale is
// centred on the origin if you only look at the middle, and one merely moved is
// four tiles wide if you only look at a corner.
//
// The other thing this stage covers is GUARDS, which the palace has none of.
// Heroes III leaves tier 4 unguarded and puts three weekly growths on the rest,
// and the field names WHO rather than how many: three entries are three stacks,
// and the engine sizes each.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { SOD_DWELLINGS, modGameRoot } from './mods.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { messageSlots } from '../src/mods/buildings.ts';
import { extractMeshesStructured } from '../src/scene/geometry.ts';

let ed: Launched;
const GAME = modGameRoot();

/** The one with guards on it, and a model that has to be brought down to size. */
const GLADE = SOD_DWELLINGS.find((d) => d.file === 'SylvanUnicornGlade')!;
/** A tile is two world units, so this is what the copy has to end up measuring. */
const ACROSS = GLADE.bake!.tiles * 2;

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

test('a tier dwelling, off the town screen and onto the map', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();

  await page.locator('#bld-file').fill(GLADE.file);
  await page.locator('#bld-type').selectOption(GLADE.type!);
  await page.locator('#bld-model').fill(GLADE.model);
  await page.locator('#bld-icon').fill(GLADE.icon!);
  // The whole difference between this and the stage next door: a town model is
  // used through a bake or not at all.
  await page.locator('#bld-bake').fill(String(GLADE.bake!.tiles));

  // The class's own fields, both of them lists — which the FORM knows from the
  // spec rather than from the value: one creature typed into `creatures` has no
  // comma in it, and written as a plain value the dwelling hires nobody.
  const field = (name: string) => page.locator(`.bld-field[data-field="${name}"]`);
  await expect(field('creatures')).toBeVisible();
  await field('creatures').fill((GLADE.fields!.creatures as string[]).join(', '));
  await expect(field('guards'), 'a dwelling says who guards it').toBeVisible();
  await field('guards').fill((GLADE.fields!.guards as string[]).join(', '));

  const lines = messageSlots(GLADE.className).map((slot) => GLADE.messages[slot] ?? '');
  await expect(page.locator('#bld-texts .bld-text')).toHaveCount(lines.length);
  for (const [i, line] of lines.entries()) {
    await page.locator('#bld-texts .bld-text').nth(i).fill(line);
  }

  // Minutes, not seconds: the bake rewrites every geometry the model carries.
  await page.locator('#bld-ok').click();
  await expect(page.locator('#bldedit')).toBeHidden({ timeout: 240_000 });
  await expect(page.locator('#bld-note')).toContainText(`under Buildings/${GLADE.file}/`);
  await expect(page.locator('#bld-list')).toContainText(GLADE.messages.name!);
});

test('it hires one stack and is guarded by three', async () => {
  const members = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const at = (e: { name: string }): string => e.name.replace(/\\/g, '/');
  const doc = members.find((e) => at(e).endsWith(`${GLADE.file}.(AdvMapDwellingShared).xdb`))!
    .data.toString('latin1');

  const items = (tag: string): string[] =>
    [...(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(doc)?.[1] ?? '')
      .matchAll(/<Item>([^<]*)<\/Item>/g)].map((m) => m[1]!);
  expect(items('creatures')).toEqual(GLADE.fields!.creatures);
  // Three of the same id, which is the only way the format can say "more guard".
  expect(items('guards'), 'three stacks — three weekly growths').toEqual(GLADE.fields!.guards);
  expect(doc).toContain(`<Type>${GLADE.type}</Type>`);
  expect(doc, 'the model it stands on is the mod\'s own copy')
    .toMatch(new RegExp(`<Model href="/Buildings/${GLADE.file}/art/`));

  // What it blocks was measured off the BAKED model, so it is the size that was
  // asked for rather than the size the town screen has.
  //
  // ACROSS THE WIDER AXIS, because that is the one a bake sizes by — this glade
  // ends up three tiles by four, and asking only about x reads the four as a
  // failure. And the count is asked for separately: a footprint follows the ART,
  // so eleven of those twelve tiles are blocked and the corner the model leaves
  // empty is walked over.
  const tiles = (tag: string): { across: number; count: number } => {
    const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(doc)?.[1] ?? '';
    const pts = [...body.matchAll(/<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/g)]
      .map((m) => [Number(m[1]), Number(m[2])] as const);
    if (!pts.length) return { across: 0, count: 0 };
    const span = (i: 0 | 1): number =>
      Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i])) + 1;
    return { across: Math.max(span(0), span(1)), count: pts.length };
  };
  const blocked = tiles('blockedTiles');
  expect(blocked.across, 'as wide as the bake was asked for').toBe(GLADE.bake!.tiles);
  expect(blocked.count, 'and measured, not guessed at one tile').toBeGreaterThan(1);
  // And it cuts NO hole in the terrain: a baked town building keeps its pedestal
  // under the map, and a hole would show the hole.
  expect(tiles('holeTiles').count, 'nothing is cut out from under it').toBe(0);
});

test('the copy is the size it was asked for, and stands on the origin', async () => {
  const members = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const slash = (n: string): string => n.split('\\').join('/');
  const geom = members.find((e) => slash(e.name)
    .startsWith(`Buildings/${GLADE.file}/art/`) && slash(e.name).endsWith('-geom.xdb'));
  expect(geom, 'the model brought its geometry document along').toBeTruthy();
  const doc = geom!.data.toString('latin1');

  /** The three numbers under a tag, as the document writes them. */
  const vec = (tag: string): { x: number; y: number; z: number } => {
    const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(doc)?.[1] ?? '';
    const n = (axis: string): number =>
      Number(new RegExp(`<${axis}>(-?[\\d.]+)</${axis}>`).exec(body)?.[1] ?? NaN);
    return { x: n('x'), y: n('y'), z: n('z') };
  };
  const size = vec('Size');
  const centre = vec('Center');

  // The box is what the GAME places the model by, so this is the number that
  // decides whether the building is the size it looks. Scaled: the widest
  // horizontal axis is what a bake sizes by, and up on the town screen this one
  // is tens of units across.
  const across = Math.max(size.x, size.y);
  expect(across, `about ${ACROSS} units — ${GLADE.bake!.tiles} tiles`)
    .toBeGreaterThan(ACROSS * 0.95);
  expect(across).toBeLessThan(ACROSS * 1.05);
  // And moved: a town model carries the position it has in the town scene — the
  // Unicorn Glade's centre is at (280, 328) up there, hundreds of units from
  // anywhere a map would put it.
  expect(Math.abs(centre.x), 'centred on the tile that places it').toBeLessThan(1);
  expect(Math.abs(centre.y)).toBeLessThan(1);

  // And the MESH agrees with the box. Both are asked because a box rewritten over
  // an untouched mesh would pass every check above and put a building of the old
  // size on the map — the box is a promise about geometry, not the geometry.
  const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(doc)?.[1];
  expect(uid, 'the document names its binary').toBeTruthy();
  const bin = members.find((e) => slash(e.name) === `bin/Geometries/${uid!.toUpperCase()}`);
  expect(bin, 'and the mod carries it — this is our copy, not the game\'s').toBeTruthy();
  let lo = Infinity, hi = -Infinity, loY = Infinity, hiY = -Infinity;
  for (const g of extractMeshesStructured(bin!.data) ?? []) {
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i]!, y = g.positions[i + 1]!;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      if (y < loY) loY = y;
      if (y > hiY) hiY = y;
    }
  }
  expect(Number.isFinite(lo), 'the geometry decodes').toBe(true);
  expect(Math.max(hi - lo, hiY - loY), 'the mesh is the size the box claims')
    .toBeGreaterThan(ACROSS * 0.95);
  expect(Math.max(hi - lo, hiY - loY)).toBeLessThan(ACROSS * 1.05);
});

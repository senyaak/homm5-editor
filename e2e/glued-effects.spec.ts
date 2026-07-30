// An effect glued to a bone follows the bone.
//
// The shadow dragon ("Призрачные драконы") carries three effect instances: the
// mist around it, and its eye glow, which is glued to the Head bone. The glued
// one was placed against the BIND pose when the scene was built and then left
// alone, so the head turned through its idle clip and the eyes hung in the air
// where the head used to be.
//
// The claim here is the difference between those two kinds: over the same beat
// of animation the glued system MOVES and the unglued ones do not — and the
// glued one sits at head height, not at the creature's feet, which is the older
// failure this whole path was built to avoid.
//
// Runs alone: it makes its own map and takes it away again.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const NAME = 'e2e Glued Effects';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
/** The creature the game calls Призрачные драконы — its eye glow rides the Head bone. */
const DRAGON = '/MapObjects/Necropolis/Shadow_Dragon.(AdvMapMonsterShared).xdb';

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('the dragon\'s eye glow rides its head, and the mist does not', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  await newMap(page, NAME, '72');

  // The idle stance decides whether the scene carries bones at all, so it has
  // to be on BEFORE the object is placed.
  // The label reads through the closed View menu — textContent needs no box on
  // screen — but each press opens it, which is what `bar` is for.
  const idle = page.locator('#idlebtn');
  for (let i = 0; i < 3 && !((await idle.textContent()) ?? '').includes('all'); i++) await bar(page, '#idlebtn');
  await expect(idle).toHaveText('Idle stance: all');

  await openObjectPalette(page);
  await pickObject(page, DRAGON);
  await placeAtTile(page, 36, 36);
  await expect.poll(() => page.evaluate(() => window.view.idle().animated), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.view.fxSystems().length), { timeout: 60_000 })
    .toBeGreaterThan(1);

  const read = (): Promise<{ uid: string; glue: string; pos: number[] }[]> =>
    page.evaluate(() => window.view.fxSystems().map((s) => ({ uid: s.uid, glue: s.glue, pos: s.pos })));

  const before = await read();
  const glued = before.filter((s) => s.glue);
  const loose = before.filter((s) => !s.glue);
  expect(glued.length, 'the dragon has a bone-glued effect').toBeGreaterThan(0);
  expect(loose.length, 'and one that is not glued').toBeGreaterThan(0);
  expect(glued[0]!.glue).toBe('Head');

  // Head height, not the feet: the glued system stands above the ones that sit
  // at the object's own origin.
  const floor = Math.max(...loose.map((s) => s.pos[2]!));
  expect(glued[0]!.pos[2]!, 'the eye glow is up on the head').toBeGreaterThan(floor + 0.2);

  // A beat of the idle clip later: the glued one has moved with the bone, the
  // loose ones have not moved at all.
  await page.waitForTimeout(700);
  const after = await read();
  const moved = (a: { pos: number[] }, b: { pos: number[] }): number =>
    Math.hypot(b.pos[0]! - a.pos[0]!, b.pos[1]! - a.pos[1]!, b.pos[2]! - a.pos[2]!);

  for (const s of loose) {
    const t = after.find((x) => x.uid === s.uid && !x.glue)!;
    expect(moved(s, t), `the unglued ${s.uid} stays put`).toBeLessThan(1e-6);
  }
  for (const s of glued) {
    const t = after.find((x) => x.uid === s.uid && x.glue === s.glue)!;
    expect(moved(s, t), `the glued ${s.uid} follows its bone`).toBeGreaterThan(0.02);
  }
});

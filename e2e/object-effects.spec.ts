// The effects a placed object carries: what they are glued to, and how often
// they start again.
//
// Two questions of the same thing, so they stand on ONE map with both objects on
// it and one editor behind them — they were two specs, each making a 72×72 map
// of its own to put one object on it. Each system says which object it came from
// (`shared`), so a shared map costs the readings nothing; if anything it makes
// them stricter, since "everything on the floor" now has to be narrowed to the
// object under test on purpose.
//
// Makes its own map and takes it away again.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_GAME, launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';
import { modFile } from '../src/game/mod-paths.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const NAME = 'e2e Object Effects';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
/** The creature the game calls Призрачные драконы — its eye glow rides the Head bone. */
const DRAGON = '/MapObjects/Necropolis/Shadow_Dragon.(AdvMapMonsterShared).xdb';
const FOUNTAIN = '/MapObjects/Fountain_Of_Fortune.(AdvMapBuildingShared).xdb';
/** Most particles the fountain's recording has alive on any one frame. */
const ONE_COPY_PEAK = 131;

/** Both halves: the working folder AND the archive New Map refuses to write over. */
const cleanup = (): void => {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  rmSync(modFile(E2E_GAME, 'map', NAME), { force: true });
};

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

/**
 * The map, built once for the whole file: both objects standing on it, with
 * their systems alive.
 *
 * Called by every test rather than done in `beforeAll`, because Playwright
 * restarts the worker after a failed test and runs `beforeAll` again — and a
 * rebuild there would be undone work at best and a New Map refusing an archive
 * that already exists at worst.
 */
let built = false;
async function ensureScene(): Promise<void> {
  if (built) return;
  const { page } = ed;
  cleanup();
  await newMap(page, NAME, '72');

  // The idle stance decides whether the scene carries bones at all, so it has to
  // be on BEFORE anything is placed. The label reads through the closed View
  // menu — textContent needs no box on screen — but each press opens it, which
  // is what `bar` is for.
  const idle = page.locator('#idlebtn');
  for (let i = 0; i < 3 && !((await idle.textContent()) ?? '').includes('all'); i++) await bar(page, '#idlebtn');
  await expect(idle).toHaveText('Idle stance: all');

  await openObjectPalette(page);
  await pickObject(page, DRAGON);
  await placeAtTile(page, 36, 36);
  await pickObject(page, FOUNTAIN);
  await placeAtTile(page, 42, 42);

  await expect.poll(() => page.evaluate(() => window.view.idle().animated), { timeout: 60_000 })
    .toBeGreaterThan(0);
  // Two objects, and the dragon alone brings more than one system: the wait is
  // for the floor to hold both objects' worth, so a reading cannot land in the
  // gap between them.
  await expect.poll(() => page.evaluate(([a, b]) => {
    const s = window.view.fxSystems();
    return [a, b].every((href) => s.some((x) => x.shared === href));
  }, [DRAGON, FOUNTAIN]), { timeout: 60_000 }).toBe(true);
  built = true;
}

/** The systems belonging to one object, and nobody else's. */
const systemsOf = (page: Launched['page'], shared: string): Promise<
  { uid: string; glue: string; pos: number[]; alive: number }[]
> => page.evaluate((href) => window.view.fxSystems()
  .filter((s) => s.shared === href)
  .map((s) => ({ uid: s.uid, glue: s.glue, pos: s.pos, alive: s.alive })), shared);

// The shadow dragon carries three effect instances: the mist around it, and its
// eye glow, which is glued to the Head bone. The glued one was placed against
// the BIND pose when the scene was built and then left alone, so the head turned
// through its idle clip and the eyes hung in the air where the head used to be.
//
// The claim is the difference between those two kinds: over the same beat of
// animation the glued system MOVES and the unglued ones do not — and the glued
// one sits at head height, not at the creature's feet, which is the older
// failure this whole path was built to avoid.
test('the dragon\'s eye glow rides its head, and the mist does not', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await ensureScene();

  const before = await systemsOf(page, DRAGON);
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
  const after = await systemsOf(page, DRAGON);
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

// The retrigger period is in the instance's own clock, not in real seconds.
//
// The Fountain of Fortune plays a 5-second recording at `<Speed>` 0.8 with an
// `<EndCycle>` of 3.5. Read as real seconds, that period fires a fresh copy
// every 3.5s of a copy that now lasts 6.25s — two rainbows at once, the second
// arcing over the first while it is still at full strength, and the spray
// visibly brighter for it. Read in the same scaled clock the recording plays in,
// the copies cross over briefly at their tails, which is what a retrigger train
// is for.
//
// The recording's own peak is 131 particles alive (measured off
// bin/effects/843D3851…). So: one copy breathes UNDER that plus a fading tail;
// two overlapping copies reach for twice it. The threshold sits between.
test('the fountain runs one copy of its effect, not two stacked', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await ensureScene();

  // Sample across more than two periods, so an overlap cannot hide between two
  // readings. The fountain's own systems only — the dragon stands on this map
  // too, and its mist would be counted into a number that means nothing then.
  const alive: number[] = [];
  for (let i = 0; i < 20; i++) {
    alive.push((await systemsOf(page, FOUNTAIN)).reduce((n, s) => n + s.alive, 0));
    await page.waitForTimeout(500);
  }
  const peak = Math.max(...alive);
  const floor = Math.min(...alive);
  expect(floor, 'the fountain never goes out').toBeGreaterThan(0);
  // One copy plus the tail of the one before it. Two copies at full strength
  // would be reaching for 262; before the fix this measured 208.
  expect(peak, `alive particles peaked at ${peak}: ${alive.join(' ')}`)
    .toBeLessThan(ONE_COPY_PEAK * 1.4);
});

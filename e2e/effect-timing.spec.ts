// The retrigger period is in the instance's own clock, not in real seconds.
//
// The Fountain of Fortune plays a 5-second recording at `<Speed>` 0.8 with an
// `<EndCycle>` of 3.5. Read as real seconds, that period fires a fresh copy
// every 3.5s of a copy that now lasts 6.25s — two rainbows at once, the second
// arcing over the first while it is still at full strength, and the spray
// visibly brighter for it. Read in the same scaled clock the recording plays
// in, the copies cross over briefly at their tails, which is what a retrigger
// train is for.
//
// The recording's own peak is 131 particles alive (measured off
// bin/effects/843D3851…). So: one copy breathes UNDER that plus a fading tail;
// two overlapping copies reach for twice it. The threshold sits between.
//
// Runs alone: it makes its own map and takes it away again.

import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const NAME = 'e2e Effect Timing';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const FOUNTAIN = '/MapObjects/Fountain_Of_Fortune.(AdvMapBuildingShared).xdb';
/** Most particles the recording has alive on any one frame. */
const ONE_COPY_PEAK = 131;

const cleanup = (): void => { if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true }); };

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('the fountain runs one copy of its effect, not two stacked', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  await newMap(page, NAME, '72');
  await openObjectPalette(page);
  await pickObject(page, FOUNTAIN);
  await placeAtTile(page, 36, 36);
  await expect.poll(() => page.evaluate(() => window.view.fxSystems().length), { timeout: 60_000 })
    .toBeGreaterThan(0);

  // Sample across more than two periods, so an overlap cannot hide between
  // two readings.
  const alive: number[] = [];
  for (let i = 0; i < 20; i++) {
    alive.push(await page.evaluate(() => window.view.fxSystems().reduce((n, s) => n + s.alive, 0)));
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

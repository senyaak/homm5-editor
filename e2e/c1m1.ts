// Shared ground for the C1M1 reconstruction specs.
//
// The mission is rebuilt in stages — heights, kinds, rivers, textures,
// passability — and each stage is its own spec file, numbered so the suite runs
// them in order (docs/E2E_RECONSTRUCTION.md). Splitting them is not cosmetic:
// a stage takes minutes, and being able to re-run just the one you are working
// on is the difference between a tight loop and an 18-minute wait.
//
// Every stage is idempotent and works on the map left by the last one. Heights
// are planned against what the map currently holds rather than against a blank,
// so re-running a stage fixes drift instead of doubling it, and any stage can be
// run alone as long as the map exists — the heights stage creates it if not.
//
// The map is deliberately NOT cleaned up: it is the artefact the whole exercise
// is for. It lives under the data root, where the game looks for maps.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './launch.ts';
import { newMap, settle } from './tiles.ts';
import { parseTerrain } from '../src/terrain.ts';
import type { Terrain } from '../src/terrain.ts';

export const NAME = 'e2e Reconstruct C1M1';
export const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
export const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
export const FIXTURE = join(REPO_ROOT, '_tmp', 'fixtures', 'C1M1', 'GroundTerrain.bin');
/** Where the rebuilt terrain is kept for `npm run diff-terrain`. */
export const RECON_DIR = join(REPO_ROOT, '_tmp', 'recon', 'C1M1');

/** The original mission's terrain — the reference every stage compares against. */
export function fixture(): Terrain {
  return parseTerrain(readFileSync(FIXTURE));
}

export const hasFixture = (): boolean => existsSync(FIXTURE);

/** Skip note for a stage that cannot run without the extracted original. */
export const NEED_FIXTURE = 'needs the fixture — npm run extract-fixture C1M1';

/**
 * Open the reconstruction map, creating a blank one if this is the first stage
 * to run. Leaves the app in the plan view, fitted, ready to be clicked.
 */
export async function openMap(page: Page, size = '96'): Promise<number> {
  if (existsSync(join(MAP_DIR, 'map.xdb'))) {
    await page.evaluate((p) => window.view.open(p), join(MAP_DIR, 'map.xdb'));
    await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
  } else {
    await newMap(page, NAME, size);
  }
  await page.evaluate(() => { window.view.plan(true); window.view.fit(); });
  return (await page.evaluate(() => window.view.size())) + 1; // vertices per side
}

/**
 * Screen positions of every vertex, computed once.
 *
 * At the fitted zoom the whole map is on screen, so this replaces a round trip
 * per click — the difference between minutes and hours over 9409 of them.
 */
export async function vertexPixels(page: Page, V: number): Promise<[number, number][]> {
  return page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.vertexToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, V);
}

/** The same for tile centres — what the mask brush addresses. */
export async function tilePixels(page: Page, T: number): Promise<[number, number][]> {
  return page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.tileToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, T);
}

/** The same for the half-tile river grid. */
export async function cellPixels(page: Page, W: number): Promise<[number, number][]> {
  return page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.cellToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, W);
}

/** Click a precomputed pixel. The brush must already be armed. */
export async function clickAt(page: Page, at: [number, number]): Promise<void> {
  await page.mouse.move(at[0], at[1]);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Drag between two precomputed pixels — one continuous stroke.
 *
 * The intermediate moves are not decoration: a rect stroke reads the tile under
 * the cursor on press and on release, and a brush that acts per move would
 * otherwise paint the ends and nothing between them.
 */
export async function dragAt(
  page: Page, from: [number, number], to: [number, number], steps = 4,
): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  }
  await page.mouse.up();
}

/** The terrain as it currently stands on disk — the state a stage starts from. */
export function currentTerrain(): Terrain {
  return parseTerrain(readFileSync(join(MAP_DIR, 'GroundTerrain.bin')));
}

/**
 * Wait for the edits to reach the main process, save, and hand back the terrain
 * that landed on disk — also copied where `npm run diff-terrain` can find it.
 */
export async function saveTerrain(page: Page): Promise<Terrain> {
  await settle(page);
  await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });
  const bin = readFileSync(join(MAP_DIR, 'GroundTerrain.bin'));
  mkdirSync(RECON_DIR, { recursive: true });
  writeFileSync(join(RECON_DIR, 'GroundTerrain.bin'), bin);
  return parseTerrain(bin);
}

/**
 * Report the first few mismatches between two planes, as strings.
 *
 * Returned rather than asserted so a stage can name what it compared, and
 * capped because "9409 values differ" is a sentence, not a list.
 */
export function mismatches(
  built: ArrayLike<number>, want: ArrayLike<number>, side: number, label: string, limit = 10,
): string[] {
  const out: string[] = [];
  let n = 0;
  for (let i = 0; i < want.length; i++) {
    if (Math.abs(built[i]! - want[i]!) <= 1e-4) continue;
    n++;
    if (out.length < limit) out.push(`${label} (${i % side},${(i / side) | 0}) built ${built[i]} vs ${want[i]}`);
  }
  if (n > limit) out.push(`… ${n - limit} more`);
  return out;
}

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
// run alone as long as the map exists.
//
// The chain itself, though, starts from nothing: stage 1 deletes what the last
// run built (startFresh). Idempotence is for working on one stage, not for the
// run that proves the claim — over last run's finished map the terrain stages
// would sculpt and paint underneath objects that stage 6 has not placed yet,
// which is neither the order a person works in nor one the editor is fast at.
//
// The map is not cleaned up at the END: it is the artefact the whole exercise
// is for. It lives under the data root, where the game looks for maps.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, REPO_ROOT } from '../launch.ts';
import { newMap, settle } from '../tiles.ts';
import { parseTerrain } from '../../src/terrain.ts';
import type { Terrain } from '../../src/terrain.ts';

export const NAME = 'e2e Reconstruct C1M1';
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

/** The parameter that turns a missing fixture from a failure into a quiet skip. */
export const ALLOW_NO_FIXTURE = 'HOMM5_ALLOW_NO_FIXTURE';

/**
 * Gate a reconstruction stage on the extracted fixture.
 *
 * The fixture is the game/mod's OWN files, unpacked once by
 * `npm run extract-fixture C1M1` (tools/extract-fixture.ts); the specs read that
 * unpacked tree but never open the mod archives themselves. Without it a stage
 * cannot mean anything — so by default this FAILS the stage loudly, because a
 * silent skip reads as a pass and hides that the reconstruction never ran.
 *
 * On a machine that simply does not have the mod, set HOMM5_ALLOW_NO_FIXTURE=1
 * to turn that failure into a quiet skip instead. `extra` lets a stage fold its
 * own precondition (the texts stage also needs the texts/ tree) under the same
 * gate and the same parameter.
 */
export function requireFixture(extra?: { ok: boolean; need: string }): void {
  const ok = hasFixture() && (extra?.ok ?? true);
  const need = extra && !extra.ok ? extra.need : NEED_FIXTURE;
  if (process.env[ALLOW_NO_FIXTURE]) { test.skip(!ok, need); return; }
  expect(ok, `${need}  —  or set ${ALLOW_NO_FIXTURE}=1 to skip instead of fail`).toBe(true);
}

/**
 * Throw away whatever the last run built, so the chain starts from nothing.
 *
 * Called by stage 1 and nowhere else. The stages are written to converge on a
 * map that already exists, which is what makes any one of them re-runnable —
 * but a chain that starts on last run's finished map does the work in the wrong
 * ORDER: it paints ground and carves rivers under two and a half thousand
 * objects that will not be placed until stage 6. That is not the claim this
 * exercise makes, and it is not cheap either — the terrain stages slow to a
 * crawl over a populated map, and stage 4 took as long alone as the first four
 * stages take from a blank one.
 *
 * So the artefact is rebuilt rather than touched up. Running stage 1 on its own
 * therefore means "start over", which is what stage 1 is.
 */
export function startFresh(): void {
  rmSync(MAP_DIR, { recursive: true, force: true });
}

/**
 * Open the reconstruction map, creating a blank one if this is the first stage
 * to run. Leaves the app in the plan view, fitted, ready to be clicked.
 *
 * `make` is what says a caller is entitled to a blank map. Only the chain is:
 * stage 1 starts over from nothing, and every later stage means to work on what
 * the one before it left. Getting a blank map instead used to be silent, and it
 * cost a green suite going red for the wrong reason — a spec that borrowed this
 * map opened it, found a fresh 96×96 blank where the reconstruction should be,
 * and failed on "no regions" instead of "there is no reconstruction here".
 */
export async function openMap(page: Page, size = '96', make = true): Promise<number> {
  if (existsSync(join(MAP_DIR, 'map.xdb'))) {
    await page.evaluate((p) => window.view.open(p), join(MAP_DIR, 'map.xdb'));
    await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });
  } else if (make) {
    await newMap(page, NAME, size);
  } else {
    throw new Error(`no reconstruction at ${MAP_DIR}`
      + '\n  the C1M1 chain builds it: npx playwright test e2e/c1m1');
  }
  await page.evaluate(() => { window.view.plan(true); window.view.fit(); });
  return (await page.evaluate(() => window.view.size())) + 1; // vertices per side
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
  // Re-running a finished stage changes nothing, and Save is disabled then.
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
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

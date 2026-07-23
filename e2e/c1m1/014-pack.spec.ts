// C1M1 stage 14 — the capstone: prove the whole reconstruction, then pack it.
//
// Stages 1–13 each check one subsystem in isolation; this one stands back and
// asks the question the whole exercise is for — is the assembled map the
// original? — by running the three gap-report tools over what sits on disk
// (diff-map for the settings, diff-objects for the objects, diff-terrain for
// GroundTerrain.bin), and then packs the map the way a mapmaker does, into a
// .h5m the game can load.
//
// diff-map and diff-objects must be empty. diff-terrain must match every VALUE
// plane — heights, the twelve masks, ground flags, passability, rivers. The
// engine-irrelevant leftovers it also reports are tolerated: the texture-layer
// LIST order and the CASE of a tile path (the engine folds path case and does
// not care about a layer list's declaration order), and the byte-length
// difference that follows from them. Those are an editor round-trip cosmetic,
// tracked separately — not a difference the game can see.
//
// Packing has two modes, chosen by the --noRemoveMap flag (HOMM5_NO_REMOVE_MAP):
//   * default   — pack under the test data root, verify, and delete, so a suite
//                 run leaves nothing behind (and never touches the game folder).
//   * keep      — pack into the GAME's own Maps/ and leave it there, so the map
//                 can be opened in the game straight after. `npm run pack-c1m1`
//                 is the front door: `npm run pack-c1m1 -- --noRemoveMap`.
//
// This stage READS the reconstruction; it does not build it. Run stages 1–13
// first (the whole suite does, in order).

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readEntries } from '../../src/pak.ts';
import { launchEditor, REPO_ROOT } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { DATA, MAP_DIR, NAME, NEED_FIXTURE, requireFixture } from './shared.ts';

const KEEP = !!process.env.HOMM5_NO_REMOVE_MAP;
const MAP_XDB = join(MAP_DIR, 'map.xdb');
const FIXTURE_DIR = join(REPO_ROOT, '_tmp', 'fixtures', 'C1M1');
const FIXTURE_XDB = join(FIXTURE_DIR, 'C1M1.xdb');

// Where the .h5m lands. Keeping it means the game should find it, so it goes in
// the game's own Maps/ (a folder the game scans). The throwaway default stays
// under the test data root, beside where every other spec packs.
const GAME_MAPS = join(REPO_ROOT, '..', 'Maps');
const ARCHIVE = KEEP
  ? join(GAME_MAPS, `${NAME}.h5m`)
  : join(DATA, 'Maps', 'SingleMissions', `${NAME}.h5m`);

let ed: Launched;

test.beforeAll(async () => {
  ed = await launchEditor();
  // Pack asks the OS where to save; that native dialog is the one thing
  // Playwright cannot click, so it is answered in the main process with the
  // path we want — everything else about the pack is the real thing.
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, ARCHIVE);
});
test.afterAll(async () => {
  await ed?.app.close();
  if (!KEEP && existsSync(ARCHIVE)) rmSync(ARCHIVE, { force: true });
});

/** Run a gap-report tool, capturing its output whatever the exit code. */
function diff(tool: string, ...args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [join('tools', tool), ...args], { encoding: 'utf8' }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('C1M1 capstone: the whole map matches the original, and packs to a playable .h5m', async () => {
  requireFixture({ ok: existsSync(FIXTURE_XDB), need: `${NEED_FIXTURE} (map too)` });
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  expect(existsSync(MAP_XDB), 'the reconstruction is on disk (run c1m1 stages 1–13 first)').toBe(true);

  // --- prove it is the original -------------------------------------------
  const mapDiff = diff('diff-map.ts', FIXTURE_XDB, MAP_XDB);
  console.log(mapDiff.out.trimEnd());
  expect(mapDiff.code, 'map settings match the original').toBe(0);

  const objDiff = diff('diff-objects.ts', FIXTURE_XDB, MAP_XDB);
  console.log(objDiff.out.trimEnd());
  expect(objDiff.code, 'objects match the original').toBe(0);

  // Terrain: every value plane must match; the layer-order / path-case / length
  // leftovers are the engine-irrelevant round-trip cosmetic — reported, tolerated.
  const terr = diff('diff-terrain.ts', FIXTURE_DIR, MAP_DIR);
  console.log(terr.out.trimEnd());
  const COSMETIC = /^(layer ORDER|tile path SPELLING|file length)\b/;
  const valueDiffs = [...terr.out.matchAll(/^ {2}DIFF {2}(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((d) => !COSMETIC.test(d));
  expect(valueDiffs, 'terrain value planes (heights, masks, flags, passability, rivers) match').toEqual([]);

  // --- pack ----------------------------------------------------------------
  await page.evaluate((p) => window.view.open(p), MAP_XDB);
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 120_000 });

  await page.locator('#pack').click();
  await expect(page.locator('#hud')).toContainText(/^packed → /, { timeout: 60_000 });
  expect(existsSync(ARCHIVE), 'the archive was written').toBe(true);

  // A zip the game will read (local-file-header signature), with the map at its
  // in-game path inside the archive.
  expect(readFileSync(ARCHIVE).subarray(0, 4)).toEqual(Buffer.from('PK\x03\x04', 'latin1'));
  const names = readEntries(readFileSync(ARCHIVE)).map((e) => e.name);
  expect(names).toContain(`Maps/SingleMissions/${NAME}/map.xdb`);

  console.log(`\npacked → ${ARCHIVE}${KEEP ? '   (kept — open it in the game)' : '   (removed after the run)'}`);
});

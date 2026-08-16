// C1M1 stage 1 — the shape: every vertex height, set by clicking.
//
// One Vertex-brush stroke per vertex, its force being how far that vertex still
// has to move. The forces are computed against what the map currently holds, so
// running this again on a finished map is a no-op rather than a doubling.
//
// IN ROUNDS, as a guard rather than a mechanism. Every click maps its vertex to
// a pixel at the moment of the gesture (`clickVertex`), so the ground moving
// under the pass — which is what this stage does for a living — cannot re-aim a
// stroke by itself. What a round catches is whatever still slips through a
// stroke: the no-op property above is what makes replanning free, and a plan
// that is not shrinking by round four is a bug the loop must not hide.
//
// Why one stroke per vertex instead of sculpting by hand: the original surface
// is 7420 distinct heights, 87.7% of them off any step grid, and it is the trace
// of human strokes rather than the output of a filter — neither relaxation nor a
// blur of the stepped field reproduces it (measured, see the doc).

import { test, expect } from '@playwright/test';
import { launchEditor } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { armBrush, setBrushForce } from '../tiles.ts';
import { clickVertex } from '../pointer.ts';
import { fixture, mismatches, openMap, requireFixture, saveTerrain, startFresh } from './shared.ts';
import { readHeights } from '../../src/terrain/terrain.ts';

let ed: Launched;

/** Cap the work for a quick check of the machinery. */
const LIMIT = Number(process.env.HOMM5_RECON_LIMIT || 0);

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('C1M1 heights, clicked one vertex at a time', async () => {
  requireFixture();
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const target = readHeights(fixture());
  // The chain builds a map the way a person would: ground first, objects last.
  // Starting on the one the last run finished would sculpt and paint underneath
  // 2600 objects that belong to stage 6 — see startFresh.
  startFresh();
  const V = await openMap(page);
  expect(V * V).toBe(target.length);

  // A capped run only claims something about the vertices it planned; a full one
  // claims the whole plane.
  const touched = new Set<number>();

  // Four rounds is not a tuned number: the first does 7000+ strokes, the second
  // the dozen the first moved the ground under, and a plan that is not shrinking
  // by then is a bug the loop must not hide.
  for (let round = 1; round <= 4; round++) {
    // The whole map on screen: a vertex mapped while off screen is a click on
    // nothing. Once per round — mid-pass the per-click mapping looks after
    // itself, whatever the window or the ground does.
    await page.evaluate(() => window.view.fit());
    const current = await page.evaluate(() => window.view.heights());

    // Grouped by force so the toolbar field is retyped once per distinct value
    // rather than once per click; raising and lowering are separate tools, so each
    // direction is one pass.
    const up = new Map<number, number[]>(), down = new Map<number, number[]>();
    let planned = 0;
    for (let i = 0; i < target.length; i++) {
      if (LIMIT && planned >= LIMIT) break;
      // A capped later round only revisits what the cap let round one touch:
      // planning new ground would grow the claim past what LIMIT promised.
      if (LIMIT && round > 1 && !touched.has(i)) continue;
      const delta = target[i]! - current[i]!;
      // The same tolerance the check below holds the result to: planning finer
      // than the claim means a second round spent polishing float dust the
      // check never looks at — 1372 strokes of it, measured.
      if (Math.abs(delta) < 1e-4) continue;
      const bucket = delta > 0 ? up : down;
      const force = Math.abs(delta);
      if (!bucket.has(force)) bucket.set(force, []);
      bucket.get(force)!.push(i);
      planned++;
    }
    if (!planned) break;
    console.log(`heights round ${round}: ${planned} vertices to move, ${up.size} raise forces, ${down.size} dig forces`);
    for (const list of [...up.values(), ...down.values()]) for (const v of list) touched.add(v);

    const started = Date.now();
    let done = 0;
    for (const [mode, bucket] of [['bulk', up], ['dig', down]] as const) {
      if (!bucket.size) continue;
      await armBrush(page, mode, 'vertex');
      for (const [force, verts] of bucket) {
        await setBrushForce(page, force);
        for (const v of verts) {
          await clickVertex(page, v % V, (v / V) | 0);
          if (++done % 1000 === 0) {
            console.log(`  ${done}/${planned} (${(done / ((Date.now() - started) / 1000)).toFixed(0)}/s)`);
          }
        }
      }
    }
    console.log(`  ${done} strokes in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  const check = (values: ArrayLike<number>, where: string): string[] =>
    LIMIT
      ? [...touched]
        .filter((v) => Math.abs(values[v]! - target[v]!) > 1e-4)
        .slice(0, 10)
        .map((v) => `${where} (${v % V},${(v / V) | 0}) ${values[v]} vs ${target[v]}`)
      : mismatches(values, target, V, where);

  // What the app believes, before saving: a stroke that landed twice and one
  // that never landed are the same wrong height in the file, different bugs.
  const app = await page.evaluate(() => window.view.heights());
  expect(check(app, 'app'), 'heights wrong in the app after the pass').toEqual([]);

  const built = readHeights(await saveTerrain(page));
  expect(check(built, 'file'), 'heights that did not reach the original').toEqual([]);
});

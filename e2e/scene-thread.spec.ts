// The app answers while a scene is being built.
//
// Assembling C1M1's opening is ~6.5 seconds of reading archives, meshing and
// baking clips. It used to happen in the main process, which is single-threaded
// — so for those seconds nothing else answered: not the map list, not the
// object panel, not a second window. It runs in a utility process now
// (electron/scene-jobs.ts) and this is what says so.
//
// THE METRIC IS CHECKED BY SABOTAGE, in the second test: with
// HOMM5_SCENE_INLINE=1 the same build happens in the main process again, and
// the same measurement has to fail. A responsiveness number that looks good in
// both worlds is measuring nothing.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const SCENE = 'DialogScenes/C1/M1/D1';
const GAME = process.env.HOMM5_ROOT || join(REPO_ROOT, '..');
const CAMPAIGNS = join(GAME, 'UserMODs', 'All_campaigns.data.h5u');

/**
 * The longest the main process may go without answering — ONE number for both
 * tests, so the sabotage fails the very bound the real run passes.
 *
 * It was two: under 4000ms here, over 5000ms with the build inline, set when a
 * build took nine seconds. The build has since got faster (2.7–5.3s), the
 * inline stall shrank with it to 1.9–3.3s, and an inline run passed the first
 * test's bound — the metric had stopped telling the two apart without anything
 * failing. Measured 2026-10-09, four runs each: 258–303ms with the builder,
 * 1920–3329ms without. 1000 sits between with room on both sides.
 */
const STALL_BOUND = 1000;

/** How the main process behaved while one scene came up. */
interface Watch {
  /** Milliseconds the whole open took, as the window saw it. */
  total: number;
  /** Cheap main-process calls that came back during it. */
  answers: number;
  /** The longest the main process went without answering, in ms. */
  worstWait: number;
}

/**
 * Open a scene while asking the main process something cheap over and over.
 *
 * `maps:list` is the ping: it is cached per install, so what it measures is
 * whether the main process got round to answering at all — not how long its
 * own work takes.
 */
async function openWhilePinging(ed: Launched): Promise<Watch> {
  const { page } = ed;
  await page.evaluate(() => (document.getElementById('scenesbtn') as HTMLButtonElement).click());
  await page.evaluate((f) => window.view.openSceneFile(f), CAMPAIGNS);
  return page.evaluate(async (s) => {
    let answers = 0, worstWait = 0, pinging = true;
    const ping = async (): Promise<void> => {
      while (pinging) {
        const t = performance.now();
        await window.editor.listMaps();
        worstWait = Math.max(worstWait, performance.now() - t);
        answers++;
        const left = 200 - (performance.now() - t);
        if (left > 0) await new Promise((r) => setTimeout(r, left));
      }
    };
    const pings = ping();
    const t0 = performance.now();
    await window.view.openScene(s);
    const total = performance.now() - t0;
    pinging = false;
    await pings;
    return { total, answers, worstWait };
  }, SCENE);
}

test('the app keeps answering while a scene is built', { tag: '@game' }, async () => {
  test.skip(!existsSync(CAMPAIGNS), 'the campaigns\' scenes are not on this install');
  test.setTimeout(180_000);
  const ed = await launchEditor();
  try {
    const w = await openWhilePinging(ed);
    console.log(`[thread] built in ${w.total | 0}ms · ${w.answers} answers · worst wait ${w.worstWait | 0}ms`);
    // A build of several seconds, and the main process answering throughout it.
    // One answer per 200ms would be perfect; half that is still a live app, and
    // the failure this guards against is ZERO for the length of a build.
    // Measured: 47 answers against 8 with the builder off.
    expect(w.total).toBeGreaterThan(2000);
    expect(w.answers).toBeGreaterThan(w.total / 400);
    // The one stall left is the PAYLOAD, not the build: ~21 MB comes back from
    // the child, and main deserializes it and serializes it again for the
    // window, both on its own thread — about two seconds for C1M1's opening
    // in 2026-09, about 0.3 now. The bound is here so that stall cannot
    // quietly grow back into a build's worth of silence; it is STALL_BOUND, the
    // one the inline build has to break, and it is not to be loosened past it.
    expect(w.worstWait).toBeLessThan(STALL_BOUND);
    expect(ed.errors).toEqual([]);
  } finally {
    await ed.app.close();
  }
});

test('…and the same measurement fails when the build is put back in the main process', { tag: '@game' }, async () => {
  test.skip(!existsSync(CAMPAIGNS), 'the campaigns\' scenes are not on this install');
  test.setTimeout(180_000);
  // The sabotage: same app, same scene, builder disabled.
  const ed = await launchEditor({ HOMM5_SCENE_INLINE: '1' });
  try {
    const w = await openWhilePinging(ed);
    console.log(`[thread] inline: built in ${w.total | 0}ms · ${w.answers} answers · worst wait ${w.worstWait | 0}ms`);
    // The build blocks the process it runs in, so ONE ping spans the whole of
    // it. If this ever stops being true the test above is measuring nothing.
    expect(w.worstWait).toBeGreaterThan(STALL_BOUND);
    expect(ed.errors).toEqual([]);
  } finally {
    await ed.app.close();
  }
});

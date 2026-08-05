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

test('the app keeps answering while a scene is built', async () => {
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
    // window, both on its own thread — about two seconds for C1M1's opening.
    // The bound is here so that stall cannot quietly grow back into a build's
    // worth of silence; shrinking it means moving the geometry onto typed
    // arrays (or handing the window a port straight to the child), not
    // loosening this number.
    expect(w.worstWait).toBeLessThan(4000);
    expect(ed.errors).toEqual([]);
  } finally {
    await ed.app.close();
  }
});

test('…and the same measurement fails when the build is put back in the main process', async () => {
  test.skip(!existsSync(CAMPAIGNS), 'the campaigns\' scenes are not on this install');
  test.setTimeout(180_000);
  // The sabotage: same app, same scene, builder disabled.
  const ed = await launchEditor({ HOMM5_SCENE_INLINE: '1' });
  try {
    const w = await openWhilePinging(ed);
    console.log(`[thread] inline: built in ${w.total | 0}ms · ${w.answers} answers · worst wait ${w.worstWait | 0}ms`);
    // The build blocks the process it runs in, so ONE ping spans the whole of
    // it. If this ever stops being true the test above is measuring nothing.
    // Measured: 9473ms of silence, and 8 answers where the child gives 47.
    expect(w.worstWait).toBeGreaterThan(5000);
    expect(ed.errors).toEqual([]);
  } finally {
    await ed.app.close();
  }
});

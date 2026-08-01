// A dialog scene, played in the real app.
//
// Everything below the window is covered by `npm run test-dialog-scene`: the
// documents, the camera arithmetic, the rigs. What only the app can show is the
// handoff — that the scene's stage goes through the same `buildWorld` a map
// does, that its actors become skinned bodies in the same viewport, and that
// stepping a shot moves the camera and changes what people are doing.
//
// The scene is C1M1's opening, which ships inside UserMODs/All_campaigns.data.h5u,
// so this skips itself on an install without it.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

const SCENE = 'DialogScenes/C1/M1/D1';
const GAME = process.env.HOMM5_ROOT || join(REPO_ROOT, '..');
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('the editor opens a campaign scene and plays it', async () => {
  test.skip(!existsSync(join(GAME, 'UserMODs')) && !existsSync(join(DATA, SCENE)),
    'the campaigns\' scenes are not on this install');
  const { page, errors } = ed;
  test.setTimeout(180_000); // first open unpacks the scene and the camera library

  // The window first — it is where a scene is watched, and the viewport moves
  // into it. Opening one without it works too; the button is the way in.
  await page.evaluate(() => (document.getElementById('scenesbtn') as HTMLButtonElement).click());
  const info = await page.evaluate((s) => window.view.openScene(s), SCENE);
  expect(info.shots).toBe(73);
  expect(info.stage).toContain('SmallSpecialArena_Grass');
  // The set dressing is the scene's own, not the arena's: an empty field with
  // 600-odd things placed on it.
  expect(info.placed).toBeGreaterThan(600);

  const opened = await page.evaluate(() => window.view.scene());
  expect(opened?.actors.length).toBe(8);
  // Nothing is cued on the opening shot, so everybody stands in their idle.
  expect(opened?.actors.every((a) => a.kind === 'idle00')).toBe(true);

  // A shot that cues somebody: the camera moves, and one actor stops idling.
  const framing = await page.evaluate(() => {
    window.view.showShot(62, 0.6);
    const state = window.view.scene();
    return { acting: state?.actors.filter((a) => a.kind !== 'idle00') ?? [], shot: state?.shot };
  });
  expect(framing.shot).toBe(62);
  expect(framing.acting.length).toBeGreaterThan(0);

  // Running it advances on its own.
  await page.evaluate(() => window.view.playScene(true));
  await page.waitForFunction(() => (window.view.scene()?.at ?? 0) > 0.1, null, { timeout: 10_000 });
  await page.evaluate(() => window.view.playScene(false));

  // The window is the scene: a row per shot, the current one lit, and the
  // viewport moved inside it — there is one canvas in the app and the scene is
  // drawn by it, so it has to be in the dialog while the dialog is up.
  const panel = await page.evaluate(() => {
    const list = document.getElementById('sc-list')!;
    const view = document.getElementById('sc-view')!;
    const canvas = document.querySelector('canvas')!;
    const dlg = (document.getElementById('scene') as HTMLDialogElement).getBoundingClientRect();
    return {
      open: (document.getElementById('scene') as HTMLDialogElement).open,
      hosted: view.contains(canvas),
      drawn: [canvas.clientWidth > 200, canvas.clientHeight > 200],
      fills: [dlg.width >= innerWidth - 2, dlg.height >= innerHeight - 2],
      canvasTall: canvas.clientHeight > innerHeight * 0.8,
      rows: list.childElementCount,
      lit: [...list.children].findIndex((r) => r.classList.contains('on')),
      info: document.getElementById('sc-info')!.textContent ?? '',
    };
  });
  expect(panel.open).toBe(true);
  expect(panel.hosted).toBe(true);
  expect(panel.drawn).toEqual([true, true]);
  // It takes the whole window: what is behind is the launcher — a menu of other
  // editors — and any of it showing round the edges reads as the scene being
  // played into the main screen.
  expect(panel.fills).toEqual([true, true]);
  // …and the picture fills what is left after the shot list, rather than being
  // a small canvas in a big hole.
  expect(panel.canvasTall).toBe(true);
  expect(panel.rows).toBe(73);
  expect(panel.lit).toBe(62);
  expect(panel.info).toContain('73 shots');

  // Clicking a row is how a shot is chosen.
  const picked = await page.evaluate(() => {
    (document.getElementById('sc-list')!.children[7] as HTMLElement).click();
    return window.view.scene()?.shot;
  });
  expect(picked).toBe(7);

  // Closing puts the viewport back on the page and the scene down.
  const after = await page.evaluate(() => {
    (document.getElementById('sc-close') as HTMLButtonElement).click();
    return {
      scene: window.view.scene(),
      open: (document.getElementById('scene') as HTMLDialogElement).open,
      backOnPage: document.getElementById('app')!.contains(document.querySelector('canvas')!),
      world: window.view.size(),
    };
  });
  expect(after.scene).toBeNull();
  expect(after.open).toBe(false);
  expect(after.backOnPage).toBe(true);
  // …and the world goes with it: a scene left drawing behind the launcher looks
  // like a broken background, not like a scene nobody closed.
  expect(after.world).toBe(0);

  // The effects a scene carries load without a map session — the arena's
  // fireflies asked main for their baked keys and used to be told "no map
  // loaded", which killed every effect in the scene.
  expect(errors.filter((e) => /map:fx|no map loaded/.test(e))).toEqual([]);
});

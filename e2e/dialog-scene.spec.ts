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

  // …and each of them is drawn WHERE it stands. A scene's objects carry no
  // `<Item id>` — they are plain hrefs — and the renderer used to fetch an
  // object's transform by that id, so 523 of the 657 got none and were drawn at
  // the world origin instead: the armies and the set dressing in one heap in the
  // corner of the arena, the field they belong on bare. `placed` counted them
  // all, and every other number agreed; only where they are says otherwise.
  const drawn = await page.evaluate(() => ({ ...window.view.batched(), idle: window.view.idle() }));
  expect(drawn.slots).toBeGreaterThan(500);
  expect(drawn.misplaced).toBe(0);
  const opened = await page.evaluate(() => window.view.scene());

  // Nobody on the field stands in the bind pose with their arms straight out.
  // A figure is alive one of two ways: as a rigged actor, if a shot ever moves
  // them, or in the crowd, which needs the idle stance turned on — a map
  // setting, off by default, that a scene borrows for as long as it is up.
  expect(drawn.idle.mode).toBe('all');
  expect(drawn.idle.animated + (opened?.actors.length ?? 0)).toBeGreaterThan(40);

  // Eight figures speak; the other 37 are the soldiers the shots animate —
  // an actor is anyone the scene MOVES, and a stack left in the crowd can only
  // ever loop its idle.
  expect(opened?.actors.length).toBe(45);
  // Nothing is cued on the opening shot, so everybody stands in their idle.
  expect(opened?.actors.every((a) => a.kind === 'idle00')).toBe(true);

  // Shot 4 is Isabell's speech, and both armies answer it: sixteen creatures
  // cued, the Haven line three seconds in and the demons at six. Every one of
  // them is written as an INDEX into that creature's own animation set with no
  // name beside it, so reading names alone leaves the field standing still.
  const salute = await page.evaluate(() => {
    window.view.showShot(4, 6.5);
    const acting = window.view.scene()?.actors.filter((a) => a.kind !== 'idle00') ?? [];
    return { count: acting.length, kinds: [...new Set(acting.map((a) => a.kind))].sort() };
  });
  expect(salute.count).toBe(16);
  expect(salute.kinds).toContain('happy');

  // A shot fires its own effects — the spellwork the scene is made of — and
  // they belong to the shot, so they go away with it. Shot 2 is the Prayer over
  // Isabell's line of soldiers: eight copies, one per soldier.
  const spell = await page.evaluate(() => {
    window.view.showShot(2, 1);
    const lit = window.view.scene()?.fx ?? 0;
    window.view.showShot(1, 0); // no effects of its own
    return { lit, after: window.view.scene()?.fx ?? 0 };
  });
  expect(spell.lit).toBe(8);
  expect(spell.after).toBe(0);

  // …and a shot is lit by its own preset. The battle that opens the scene — 36
  // shots of it — overrides the scene's daylight with `InfernoArena`, a red key
  // light over black shade; the parley that follows keeps the scene's own. Read
  // only from the stage map's preset, as a map would, every shot looks alike.
  const light = await page.evaluate(() => {
    window.view.showShot(40, 0); // the parley: the scene's own daylight
    const day = window.view.ambientState().sun;
    window.view.showShot(14, 0); // the battle: the gating demon lord
    return { day, inferno: window.view.ambientState().sun };
  });
  expect(light.inferno).not.toEqual(light.day);
  // Red key light: more red than green and blue together.
  expect(light.inferno[0]!).toBeGreaterThan(light.inferno[1]! + light.inferno[2]!);
  // The scene's own is a warm daylight, so 'redder' is a matter of degree: the
  // battle's key light is three times as red-biased as the parley's.
  const bias = (c: number[]): number => c[0]! / (c[1]! + c[2]!);
  expect(bias(light.inferno)).toBeGreaterThan(2 * bias(light.day));

  // A shot that cues somebody: the camera moves, and one actor stops idling.
  const framing = await page.evaluate(() => {
    window.view.showShot(62, 0.6);
    const state = window.view.scene();
    return { acting: state?.actors.filter((a) => a.kind !== 'idle00') ?? [], shot: state?.shot };
  });
  expect(framing.shot).toBe(62);
  expect(framing.acting.length).toBeGreaterThan(0);

  // …and the camera STAYS where the shot put it. The orbit controls re-derive
  // it from their own state every frame, and being disabled does not stop that
  // — so a shot that was not actively playing was aimed and then overwritten
  // one FRAME later, and stepping through a scene showed the map's viewpoint
  // over and over. Which is why `before` is read in the same turn as the aim:
  // read a turn later it is already the drifted one, and the check passes on a
  // camera that has been thrown away.
  const held = await page.evaluate(async () => {
    window.view.showShot(62, 0.6);
    const before = window.view.scene()?.eye;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    return { before, after: window.view.scene()?.eye };
  });
  expect(held.after).toEqual(held.before);

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

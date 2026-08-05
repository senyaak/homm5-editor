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
/** The archive the original campaigns' 185 scenes travel in. */
const CAMPAIGNS = join(GAME, 'UserMODs', 'All_campaigns.data.h5u');

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

  // …on nothing, until a FILE is named. A scene is opened the way a map is:
  // point at an archive and the window lists what is inside it, from that
  // archive's own directory with nothing unpacked (src/dialog/scene-source.ts).
  // The campaigns' archive holds 185, so a list that comes back with a handful
  // is one that read the wrong thing.
  expect(await page.evaluate(() => document.querySelectorAll('#sc-list .shot.scene').length)).toBe(0);

  // Through the BUTTON, not past it. The one step a test cannot drive is the
  // OS file dialog, so that — and only that — is answered for it, in the main
  // process where it lives. Everything after the answer is the real path:
  // Open file… → scene:pick-file → scene:in-file → the rows. Calling
  // `openSceneFile` directly, which is what this test did first, proves the
  // listing works and says nothing about whether the button is wired to it.
  await ed.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, CAMPAIGNS);
  await page.evaluate(() => (document.getElementById('sc-file') as HTMLButtonElement).click());
  await page.waitForFunction(() => document.querySelectorAll('#sc-list .shot.scene').length > 0, null, { timeout: 60_000 });
  const listed = await page.evaluate(() => window.view.sceneFile());
  expect(listed?.file).toBe(CAMPAIGNS);
  expect(listed!.scenes.length).toBeGreaterThan(150);
  expect(listed!.scenes.some((s) => s.inner === SCENE)).toBe(true);
  const rows = await page.evaluate(() => document.querySelectorAll('#sc-list .shot.scene').length);
  expect(rows).toBe(listed!.scenes.length);

  // The filter narrows the list, and picking a row is what opens a scene.
  const chosen = await page.evaluate(() => {
    const find = document.getElementById('sc-find') as HTMLInputElement;
    find.value = 'C1/M1/D1';
    find.dispatchEvent(new Event('input'));
    const shown = [...document.querySelectorAll('#sc-list .shot.scene')];
    const row = shown.find((r) => r.querySelector('.who')?.textContent === 'C1/M1/D1');
    (row as HTMLElement | undefined)?.click();
    return { narrowed: shown.length, found: !!row };
  });
  expect(chosen.found).toBe(true);
  expect(chosen.narrowed).toBeLessThan(rows);
  await page.waitForFunction(() => !!window.view.scene(), null, { timeout: 120_000 });
  expect(await page.evaluate(() => window.view.scene()?.inner)).toBe(SCENE);

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
  // Read at two moments, because a clip is over when it is over: the eight
  // saluting at three seconds have finished by the time the other eight start.
  const salute = await page.evaluate(() => {
    const acting = (): Array<{ href: string; kind: string }> =>
      window.view.scene()?.actors.filter((a) => a.kind !== 'idle00') ?? [];
    window.view.showShot(4, 3.2);
    const first = acting();
    window.view.showShot(4, 6.5);
    const second = acting();
    return {
      first: first.length, second: second.length,
      who: new Set([...first, ...second].map((a) => a.href)).size,
      kinds: [...new Set([...first, ...second].map((a) => a.kind))].sort(),
    };
  });
  expect(salute.first).toBe(8);
  expect(salute.second).toBe(8);
  expect(salute.who).toBe(16);
  expect(salute.kinds).toContain('happy');

  // A cue is a moment on the SCENE's clock, not on its shot's. A delay is
  // measured from the shot that writes it and nothing stops it running past the
  // end: shot 6 lasts three seconds and tells the marksman to shoot at 6.7,
  // which lands in shot 8. Read one shot at a time — as this did — he never
  // shoots at all, and neither do 1033 other cues in the shipped scenes.
  const late = await page.evaluate(() => {
    window.view.showShot(8, 1.8);
    return window.view.scene()?.actors.find((a) => a.href.startsWith('Marksman.xdb'))?.kind;
  });
  expect(late).toBe('rangeattack');

  // A shot fires its own effects — the spellwork the scene is made of. Shot 2
  // is the Prayer over Isabell's line of soldiers: eight copies, one per
  // soldier, three seconds in. Before that there is the cast itself, and THAT
  // is not in the scene file at all — a clip carries an effect of its own
  // (`BasicSkelAnim` → `<Effect>`), and the blue fire running up the knight's
  // sword is his `buff` clip's. Anything alight at 0.2 seconds can only be it.
  const spell = await page.evaluate(() => {
    window.view.showShot(2, 0.2);
    const casting = window.view.scene()?.fx ?? 0;
    window.view.showShot(2, 3.5);
    const prayer = window.view.scene() ?? { fx: 0, fxModels: 0 };
    return { casting, lit: prayer.fx, models: prayer.fxModels };
  });
  expect(spell.casting).toBeGreaterThan(0);
  expect(spell.lit).toBeGreaterThanOrEqual(8);

  // An effect is not only sparks. Nine of the twelve this scene fires carry
  // `<Models>` — the ice crystal of an ice bolt, the burning gate an arch devil
  // steps out of, the meteors of a meteor shower — and without them a spell was
  // the smoke and none of the fire. Eight praying hands here, one per soldier.
  expect(spell.models).toBe(8);

  // …and they END. A model has no particle train's die-out to stop it: left
  // alone, the hands of a Prayer stood inside the soldier they were cast on for
  // the rest of the scene. Its `<SkelAnim>` is two seconds long and the
  // instance asks for one cycle, so half a second into the next shot they are
  // gone — while the effect is still BUILT, which is why this counts what is
  // drawn rather than what was made.
  const gone = await page.evaluate(() => {
    window.view.showShot(3, 0.5);
    return window.view.scene()?.fxModels ?? 0;
  });
  expect(gone).toBe(0);

  const solid = await page.evaluate(() => {
    window.view.showShot(14, 1); // the gating, four pieces of it
    return window.view.scene()?.fxModels ?? 0;
  });
  expect(solid).toBeGreaterThan(0);

  // The fallen stay down. Two things had them getting up: a one-shot clip was
  // wrapped like a loop, so clamping it to its own duration landed on frame ZERO
  // — a corpse standing to attention — and a cue was forgotten when its shot
  // ended, so the swordsmen cut down in shot 13 were on their feet in shot 14.
  // …and they have to be measured as POSES, not as clip names: a name says what
  // was cued, and both faults left the right name on a figure standing up.
  const swordsman = 'Swordsman.xdb#xpointer(/AdvMapMonster)';
  const fallen = await page.evaluate((who) => {
    window.view.showShot(0, 0); // before any of it, on his feet
    const tall = window.view.scene()?.actors.find((a) => a.href === who)?.top ?? 0;
    window.view.showShot(14, 0.5);
    const s = window.view.scene();
    const down = s?.actors.find((a) => a.href === who);
    return {
      tall,
      dead: s?.actors.filter((a) => /^(death|defeat)/.test(a.kind)).length ?? 0,
      kind: down?.kind, top: down?.top ?? 0,
    };
  }, swordsman);
  expect(fallen.dead).toBeGreaterThan(0);
  expect(fallen.kind).toBe('death');
  // The highest joint of a standing swordsman is a unit and a half up; lying
  // down it is a few tenths.
  expect(fallen.tall).toBeGreaterThan(1);
  expect(fallen.top).toBeLessThan(fallen.tall / 2);

  // A clip that ends somewhere the idle cannot follow HOLDS there. A royal
  // griffin's `specability1` is the first half of a dive — it takes off and
  // leaves him in the air, and `specability2` is what brings him down — so
  // handing back to the idle when it runs out does not blend, it teleports him
  // to the ground. Which clips those are is measured when the scene opens
  // (pose the last frame, pose the idle, compare where the body is), not listed
  // by name: nobody would think to list a griffin's special ability.
  const flight = await page.evaluate(() => {
    const griffin = (): { top: number; kind: string } | undefined =>
      window.view.scene()?.actors.find((a) => a.href.startsWith('Royal_Griffin'));
    window.view.showShot(6, 0);
    const standing = griffin()?.top ?? 0;
    window.view.showShot(6, 1.4);
    const up = griffin()?.top ?? 0;
    window.view.showShot(7, 0.5); // the clip is over — and he is still up there
    const held = griffin();
    return { standing, up, after: held?.top ?? 0, kind: held?.kind };
  });
  expect(flight.up).toBeGreaterThan(flight.standing + 1);
  expect(flight.kind).toBe('specability1');
  expect(flight.after).toBeGreaterThan(flight.standing + 1);

  // The fire an inferno soldier burns with is not a moment in the scene, it is
  // what that creature IS: it hangs off their IDLE clip and is alight from the
  // first frame to the last. On a map it rides the adventure body — which a
  // scene takes off the field to make room for the arena rig, so the demons
  // stood there cold.
  const alight = await page.evaluate(() => {
    window.view.showShot(8, 1.8);
    const lit = (window.view.scene()?.actors ?? []).filter((a) => a.fire > 0);
    return {
      count: lit.length,
      worstOff: Math.max(0, ...lit.map((a) => a.fireOff)),
      who: [...new Set(lit.map((a) => a.href.split('.')[0]))].sort(),
    };
  });
  expect(alight.count).toBeGreaterThan(10);
  expect(alight.who).toContain('Horned_Demon');
  // …and it is ON them. The systems are built against an identity frame and the
  // actor's own is applied each time they are placed, so a fire that was never
  // placed sits at the world origin rather than being invisible.
  expect(alight.worstOff).toBeLessThan(0.01);

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

  // …and the shot can be SEEN. Four of this scene's cameras pull back into the
  // ridge of mountains that lines the arena — shot 22 has the eye five units
  // inside Mountain12x12 — and every other number about it is right: the camera
  // is where the file puts it, the mountain where the map does. What decides
  // whether that frame is the archangel or the inside of a rock is which faces
  // are drawn, and the engine culls the ones turned away (`<Is2Sided>` is false
  // on 11209 of the 11639 shipped materials). Measured as a sightline rather
  // than looked at: the frame was WRONG for a week and looked deliberate.
  const sight = await page.evaluate(() => {
    window.view.showShot(22, 0.5);
    return window.view.sightline('Archangel.1');
  });
  expect(sight?.to).toBeGreaterThan(10);
  expect(sight?.hits.map((h) => h.name)).toEqual([]);

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

// C1M1's opening never moves anybody off their tile — the whole battle is
// fought standing still. Marching is the other half of what a scene does, and
// most of it lives in the addon's scenes.
const MARCH = 'DialogScenes/A2C3/M4/S1';

test('a scene walks its actors, and they stay where it leaves them', async () => {
  test.skip(!existsSync(join(DATA, MARCH)) && !existsSync(join(GAME, 'data')),
    'the addon\'s scenes are not on this install');
  const { page } = ed;
  test.setTimeout(180_000);

  const info = await page.evaluate((s) => window.view.openScene(s), MARCH);
  expect(info.shots).toBe(13);

  // Most of this scene's cast is declared INSIDE a CustomAnimation — an
  // `#n:inline(AdvMapMonster)` link with the whole body in it. Read only from
  // `<objects>` and the sentences, as this was, and the field is nearly empty:
  // the marching army is not there to march.
  const cast = await page.evaluate(() => window.view.scene()?.actors.length ?? 0);
  expect(cast).toBeGreaterThan(100);

  // Shot 3 is the march. `MovePoints` is a list of tiles with no pace and no
  // starting point: the pace comes off the `move` clip (every one of the 922
  // walks in the shipped scenes writes MovementSpeed 0) and the start is
  // wherever the actor is standing when it begins.
  const march = await page.evaluate(() => {
    const at = (shot: number, t: number): Map<string, [number, number, number]> => {
      window.view.showShot(shot, t);
      return new Map((window.view.scene()?.actors ?? []).map((a) => [a.key, a.pos]));
    };
    const moved = (from: Map<string, number[]>, to: Map<string, number[]>): number => {
      let n = 0;
      for (const [k, p] of from) {
        const q = to.get(k);
        if (q && Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) > 1) n++;
      }
      return n;
    };
    const start = at(3, 0);
    const midway = at(3, 6);
    const walking = window.view.scene()?.actors.filter((a) => a.kind === 'move').length ?? 0;
    const later = at(8, 0);
    return { during: moved(start, midway), walking, after: moved(start, later) };
  });
  expect(march.during).toBeGreaterThan(20);
  // …and they are playing `move` while they do it, looping it: one stride is
  // under two seconds and the march takes nine.
  expect(march.walking).toBeGreaterThan(20);
  // Where a walk leaves an actor is where they ARE, five shots later. Position
  // is not a property of a shot, so it comes off the scene's clock like
  // everything else rather than being set once when the scene opens.
  expect(march.after).toBeGreaterThanOrEqual(march.during);

  await page.evaluate(() => (document.getElementById('sc-close') as HTMLButtonElement).click());
});

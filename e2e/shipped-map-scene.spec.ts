// One shipped map, opened ONCE, and everything the scene it produces has to be
// right about: its light preset, the sum an object is shaded by, the particle
// systems its objects grow, and which way its shadows fall.
//
// WHY THEY ARE IN ONE FILE. These were four specs, and between them they opened
// A2C1M1 four times — thirteen seconds apiece, for the same map, to look at four
// properties of the same scene. Eighty-one seconds became about thirty. The
// subject is not four subjects: it is what comes out the other end of opening a
// map, and each test below asks one question of the one scene.
//
// THE ORDER IS PART OF IT, and it is the only reason these are not `test.step`s:
//
//   1. the fallback look, which only exists BEFORE a map is open;
//   2. the preset that replaces it, which is the open itself;
//   3. the particle systems, which arrive asynchronously after the scene;
//   4. the shading sum, which is arithmetic over the preset above;
//   5. the shadows, because measuring them takes the camera to plan view and
//      zooms it in on a corner of the map;
//   6. closing it, LAST, because it is the one test that ends with the scene
//      gone — and it wants everything above standing when it starts.
//
// Needs the game data — the map, the presets and the effects all live in it — so
// it skips itself without one.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPng } from '../src/format/png.ts';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
// A2C1M1, not A1C1M1: the first campaign's maps are not in the unpacked data at
// all, so a spec pointed at those skipped itself on every run instead of
// checking anything. WHICH preset it names does not matter — every expectation
// below is computed from the one the map actually loaded.
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');
/** Half-height of the plan frustum, in tiles — close enough that a shadow is many pixels long. */
const ZOOM = 14;
/** A2C1M1's preset: Pitch 35 / Yaw 40, pointing AT the light — south-west (§3). */
const SUN = [-0.439, -0.369];

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/**
 * The map, opened once for the whole file.
 *
 * Every test calls it, and only the first one does anything: the second is
 * cheap, and a test that assumed the first had run would fail differently
 * depending on which tests were filtered in. The light toggle is settled here
 * too — it persists in the profile, and a profile left on "flat" would have
 * three of these fail for the wrong reason.
 */
let opened = false;
async function openOnce(): Promise<void> {
  if (opened) return;
  const { page } = ed;
  await page.evaluate((p) => window.view.open(p), MAP);
  // 180s: a cold run decodes the ground textures on the way in.
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 180_000 });
  await page.evaluate(() => {
    const light = document.getElementById('lightbtn');
    if (light?.textContent?.includes('flat')) (light as HTMLButtonElement).click();
    // And the passability grid off: with it on the frame the shadow test reads
    // is a wall of red squares over the ground the shadows land on.
    const grid = document.getElementById('blockbtn');
    if (grid?.classList.contains('on')) (grid as HTMLButtonElement).click();
  });
  opened = true;
}

test('before any map, the fallback look', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page } = ed;
  // Its three colours are the ends of the same mix a preset drives — sun and
  // shade equal to ambient would be flat light, so the sun end sits above it.
  const before = await page.evaluate(() => window.view.ambientState());
  expect(before.preset).toBe(false);
  expect(before.terrain.sun).toEqual([0.55, 0.55, 0.55]);
  expect(before.terrain.amb).toEqual([0.31, 0.31, 0.31]);
});

test('opening a map applies its AmbientLight preset', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;
  await openOnce();

  // A2C1M1 names /Lights/_(AmbientLight)/AdvMap/Addon2/A2C1M1.xdb: LightColor
  // (0.392, 0.322, 0.275), AmbientColor (0.188, 0.2, 0.255), Whitening on,
  // Pitch 35, Yaw 40. The uniforms carry the preset's own numbers, raw — the
  // sum they feed runs in the game's gamma space, so nothing is converted.
  const after = await page.evaluate(() => window.view.ambientState());
  expect(after.preset).toBe(true);
  expect(after.terrain.sun).toEqual([0.392, 0.322, 0.275]);
  expect(after.terrain.amb).toEqual([0.188, 0.2, 0.255]);
  // The multiplier is the pipeline's ×4 and does not come from the preset —
  // its <Whitening> flag reaches nothing in this path.
  expect(after.terrain.whiten).toBe(4);
  // A2C1M1's ShadeColor, the end of the mix the editor had missing entirely.
  expect(after.terrain.shade).toEqual([0.149, 0.157, 0.216]);
  // Sun direction: pitch from the zenith, yaw from −X, unit length — so Yaw 40
  // points at 220°, the light standing in the SOUTH-WEST of the map with the
  // shadows falling north-east (docs/LIGHTING.md §3). The azimuth is asserted,
  // not just the magnitudes: this axis has been round all three ways now, and
  // only a signed check tells them apart.
  const [x, y, z] = after.sunPos as [number, number, number];
  expect(z).toBeCloseTo(Math.cos(35 * Math.PI / 180), 2);
  expect(Math.atan2(y, x) * 180 / Math.PI).toBeCloseTo(40 - 180, 1);
  expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);

  expect(errors).toEqual([]);
});

// tools/test-effects.ts proves the parser against the whole library without a
// window; what only exists in Electron is the DELIVERY — that a map's placed
// objects actually grow playing systems: scene meta over map:load, baked keys
// over map:fx as typed arrays, atlas + instanced quads in the renderer.
test('placed objects grow playing particle systems', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;
  await openOnce();

  // The systems are built asynchronously after the scene (map:fx + atlases).
  await page.waitForFunction(() => window.view.idle().fx > 0, null, { timeout: 60_000 });
  // A2C1M1 places campfires, mana crystals and portals by the dozen — if the
  // chain works at all, systems number in the tens. The exact count belongs to
  // the map, not the test.
  const fx = await page.evaluate(() => window.view.idle().fx);
  expect(fx).toBeGreaterThan(10);

  // Creature effects ride the idle CLIP, not the shared (whose <Effect/> is
  // empty on every monster) — a separate resolver path. The map's ghost dragon
  // carries cloud mist and bone-glued eye glow; after a moment on the clock its
  // systems must have live particles, and the eyes specifically prove the
  // bone-rest composition (unresolvable glue drops them instead).
  await page.waitForTimeout(1500);
  const dragon = await page.evaluate(() =>
    window.view.fxSystems().filter((s) => s.shared.includes('Horror_Dragon')));
  expect(dragon.length).toBeGreaterThanOrEqual(3); // mist + two eye instances
  expect(dragon.some((s) => s.alive > 0)).toBe(true);

  expect(errors).toEqual([]);
});

// The game shades every surface the same way — `albedo · (Ambient + Light·N·L) ·
// Whitening`, clamped, multiplied in GAMMA space on the raw texel (docs/
// LIGHTING.md §2, and §2a for the probe in the running game that says Direct3D's
// own lighting is switched off). The terrain has always run that sum; objects
// used to go through three.js's linear lighting instead, which is not a
// brightness difference but a colour one.
//
// So this is not a screenshot test. `shadeProbe` draws ONE known albedo under
// ONE known normal and reads the pixel back, and the expected value is computed
// here from the preset the map actually loaded. Every term is separable: the
// normal facing away from the sun isolates Ambient, a white albedo proves the
// clamp, and the whole thing moves if the space, the factor or the clamp is
// touched.
test('an object is lit by the game\'s own sum, not by three.js', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;
  await openOnce();

  const seen = await page.evaluate(() => ({
    amb: window.view.ambientState(),
    up: window.view.shadeProbe([0.5, 0.5, 0.5], [0, 0, 1]),
    away: window.view.shadeProbe([0.5, 0.5, 0.5], [0, 0, -1]),
    white: window.view.shadeProbe([1, 1, 1], [0, 0, 1]),
    dark: window.view.shadeProbe([0.1, 0.1, 0.1], [0, 0, 1]),
  }));

  const { amb, sun, shade: shadeCol } = seen.amb.terrain;
  const w = seen.amb.terrain.whiten;
  const dir = seen.amb.sunPos as [number, number, number];
  // The whole chain is ×4: the CPU writes the mixed colour into the vertex as a
  // plain byte, the vertex shader scales it by c29 — 1 except while a scene
  // fades — and the pixel shader's mul_x4_sat multiplies by four and clamps.
  expect(w).toBe(4);

  /**
   * The game's vertex colour for one channel, as a byte.
   *
   * A MIX between three preset colours, not a sum — `LightColor` is what a
   * surface facing the sun becomes, `ShadeColor` what one facing away becomes,
   * and `AmbientColor` the middle. Read out of the running game's vertex buffer
   * and fitted over 390,000 vertices (docs/LIGHTING.md §2).
   */
  const shade = (albedo: number, i: number, ndl: number): number => {
    const mix = amb[i]! + Math.max(ndl, 0) * (sun[i]! - amb[i]!)
                        + Math.max(-ndl, 0) * (shadeCol[i]! - amb[i]!);
    return Math.round(Math.min(1, albedo * mix * w) * 255);
  };

  // Flat ground's normal: N·L is the sun's height, which is cos(Pitch) because
  // Pitch counts from the zenith — the probe inside the game confirmed that
  // vector to three decimals (docs/LIGHTING.md §3).
  const ndl = dir[2];
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(seen.up[i]! - shade(0.5, i, ndl))).toBeLessThanOrEqual(1);
    expect(Math.abs(seen.dark[i]! - shade(0.1, i, ndl))).toBeLessThanOrEqual(1);
    // A normal pointing straight DOWN is the ShadeColor end of the mix, and it
    // is asserted separately because that is the term the editor had missing
    // altogether: with it dropped this probe reads AmbientColor, and on the
    // shipped menu preset the two differ by 43 in green.
    expect(Math.abs(seen.away[i]! - shade(0.5, i, -ndl))).toBeLessThanOrEqual(1);
  }

  // Halving the albedo halves the pixel: the multiply is in gamma space. Under
  // three.js's linear lighting it would not — that is the whole bug this fixes,
  // and 0.1 against 0.5 is far enough apart that a 1/2.2 power cannot hide.
  for (let i = 0; i < 3; i++) {
    expect(seen.dark[i]! / Math.max(1, seen.up[i]!)).toBeCloseTo(0.2, 1);
  }

  // A white albedo is the top of the range, and it is asserted against the same
  // formula rather than against a bare 255 — the formula carries the clamp, so
  // this checks the clamp AND everything under it with one expectation. Under
  // this preset a white texel does overflow (lit ground runs ×1.42) and a half
  // one does not, which is what makes the pair worth asserting together.
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(seen.white[i]! - shade(1, i, ndl))).toBeLessThanOrEqual(1);
  }

  expect(errors).toEqual([]);
});

// The shadow pass has no state to read back that would prove it did anything: a
// `shadowState().on` of true is equally true when the map is drawn without a
// shadow anywhere in it. So the picture is the measurement — the same frame with
// the pass on and off differs ONLY where a shadow was drawn — and the question
// asked of it is the one a wrong sign would answer differently: WHICH WAY the
// shadows fall.
//
// That question is not answerable by eye. Reading the top-down frame by hand got
// the direction backwards twice in one sitting, because the objects casting are
// dark themselves and the ground has its own light and shade. Here the objects'
// world positions are known exactly (the plan camera is orthographic and centred
// on a named target), so a disc mask of them is slid over the darkened mask and
// the offset that overlaps best is taken: that offset IS the direction, in
// pixels. Checked by sabotage — flipping the sign of the shadow direction in
// shadows.ts moves the agreement below from +0.995 to −0.945.
//
// LAST in the file: it takes the camera to plan view and zooms in on one corner.
test('objects cast shadows, and they fall away from the preset\'s sun', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;
  await openOnce();

  const state = await page.evaluate(() => window.view.shadowState());
  expect(state.on).toBe(true);
  // The shadow direction is the sun's on this map (ShadowPitch 100 = "follow
  // the sun"), and it points AT the light.
  expect(state.dir[0]).toBeCloseTo(SUN[0]!, 2);
  expect(state.dir[1]).toBeCloseTo(SUN[1]!, 2);

  // Somewhere with things standing on it: the densest 8x8 block of objects.
  const at = await page.evaluate(() => {
    const bins = new Map<string, { n: number; x: number; y: number }>();
    for (const o of window.view.objects()) {
      const k = `${o.x >> 3}|${o.y >> 3}`;
      const b = bins.get(k) ?? { n: 0, x: 0, y: 0 };
      b.n++; b.x += o.x; b.y += o.y;
      bins.set(k, b);
    }
    let best = { n: 0, x: 0, y: 0 };
    for (const b of bins.values()) if (b.n > best.n) best = b;
    return { x: Math.round(best.x / best.n), y: Math.round(best.y / best.n) };
  });
  await page.evaluate(({ x, y, zoom }) => {
    window.view.plan(true);
    window.view.focus(x, y);
    window.view.zoom(zoom);
  }, { ...at, zoom: ZOOM });
  // The ground textures stream in after the map; shot too early the frame is the
  // flat colour blend, which shadows still darken but only just. Nine seconds
  // when this spec opened the map itself — three now, because the tests above
  // have had it open for a good ten seconds already and this only has to cover
  // the camera move.
  //
  // NOT "wait until the frame stops changing", which was tried and is slower
  // than either: the scene ANIMATES — creatures idle, particles run — so two
  // identical snapshots never come, and the loop pays its whole cap every time.
  await page.waitForTimeout(3000);

  const shot = async (on: boolean): Promise<{ w: number; h: number; rgba: Uint8Array }> => {
    await page.evaluate((v) => window.view.shadows(v), on);
    await page.waitForTimeout(400);
    const url = await page.evaluate(() => window.view.snapshot());
    const img = readPng(Buffer.from(url.split(',')[1]!, 'base64'));
    return { w: img.width, h: img.height, rgba: img.rgba };
  };
  const lit = await shot(true);
  const flat = await shot(false);
  await page.evaluate(() => window.view.shadows(true));

  const W = lit.w, H = lit.h;
  const dark = new Uint8Array(W * H);
  let darkCount = 0;
  for (let i = 0; i < W * H; i++) {
    const a = lit.rgba[i * 4]! + lit.rgba[i * 4 + 1]! + lit.rgba[i * 4 + 2]!;
    const b = flat.rgba[i * 4]! + flat.rgba[i * 4 + 1]! + flat.rgba[i * 4 + 2]!;
    if (b - a > 12) { dark[i] = 1; darkCount++; }
  }
  // A few percent of a busy frame. Zero is "the pass drew nothing"; most of the
  // frame would be "the whole picture went dark", which is what a broken
  // projection or a shadow camera pointing into the ground produces.
  const share = darkCount / (W * H);
  expect(share).toBeGreaterThan(0.01);
  expect(share).toBeLessThan(0.5);

  // World -> pixel, from the plan camera's own numbers (stage.ts: world +Y is
  // screen up, +X screen right; the frustum is `half` tall about the target).
  const U = 2, half = ZOOM * U;
  const perUnit = (H / 2) / half;
  const seeds: Array<[number, number]> = [];
  for (const [tx, ty] of await page.evaluate(() => window.view.objects().map((o) => [o.x, o.y] as [number, number]))) {
    const px = ((tx + 0.5) * U - (at.x + 0.5) * U) * perUnit + W / 2;
    const py = H / 2 - ((ty + 0.5) * U - (at.y + 0.5) * U) * perUnit;
    if (px > -perUnit && px < W + perUnit && py > -perUnit && py < H + perUnit) seeds.push([px, py]);
  }
  expect(seeds.length).toBeGreaterThan(20);

  const R = Math.max(2, Math.round(perUnit * 2)); // an object's own footprint
  const SEARCH = Math.round(perUnit * 8);
  let best = { dx: 0, dy: 0, score: -1 };
  for (let dy = -SEARCH; dy <= SEARCH; dy += 2) {
    for (let dx = -SEARCH; dx <= SEARCH; dx += 2) {
      if (dx * dx + dy * dy < R * R) continue; // under the caster: dark either way
      let score = 0;
      for (const [px, py] of seeds) {
        const x = Math.round(px + dx), y = Math.round(py + dy);
        if (x >= 0 && y >= 0 && x < W && y < H) score += dark[y * W + x]!;
      }
      if (score > best.score) best = { dx, dy, score };
    }
  }

  const len = Math.hypot(best.dx, best.dy) || 1;
  const fall = [best.dx / len, -best.dy / len];        // screen y is down, world y is up
  const awayLen = Math.hypot(SUN[0]!, SUN[1]!);
  const cos = -(fall[0]! * SUN[0]! + fall[1]! * SUN[1]!) / awayLen;
  expect(cos, `shadows fall toward (${fall[0]!.toFixed(2)}, ${fall[1]!.toFixed(2)})`).toBeGreaterThan(0.8);

  expect(errors).toEqual([]);
});

// And then TAKING IT DOWN, which belongs here because everything a teardown can
// double-free is standing by now: textures, instanced batches, the lightmap
// bake, the shadow pass.
//
// close-map.spec.ts covers the door between the two faces of the window on a map
// it makes itself — no textures, no batches, no bake, no shadows. Which is how
// "closed the map and got the failure screen" reached Senya through a green
// suite. Last in the file, because it is the one test that ends with the scene
// gone; it puts it back before it finishes, and that is the other half of what
// it checks.
test('closing a fully loaded map does not throw', async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  const { page, errors } = ed;
  await openOnce();
  expect(errors, `errors before closing: ${errors.join('\n')}`).toEqual([]);

  await bar(page, '#closemapbtn');
  await expect(page.locator('#empty')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);

  // The failure trap would have put this on screen.
  await expect(page.locator('#fatal')).toHaveCount(0);
  expect(errors, `errors after closing: ${errors.join('\n')}`).toEqual([]);

  // And the viewport still draws: a torn-down scene that lost its GL context
  // would fail here rather than at the close itself.
  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  expect(errors, `errors after reopening: ${errors.join('\n')}`).toEqual([]);
});

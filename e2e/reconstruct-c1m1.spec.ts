// C1M1, stage 1: rebuild the mission's SHAPE by clicking, and diff it against
// the original (docs/E2E_RECONSTRUCTION.md).
//
// A blank 96×96 through the New Map dialog, then the height of every one of its
// 9409 vertices set with the Vertex brush: force = how far this vertex has to
// move, one click per vertex, through the real UI. The saved GroundTerrain.bin
// is then compared to the fixture value for value.
//
// Why per vertex rather than by brush strokes: the original's surface is 7420
// distinct heights, 87.7% of them off any step grid, and it is the trace of
// human strokes rather than the output of a filter — neither relaxation nor a
// blur of the stepped field reproduces it (measured; see the doc). So the
// strokes are COMPUTED instead: each one lands on its target exactly.
//
// The fixture is not in the repo (game content). Run `npm run extract-fixture
// C1M1` first; without it this test skips.
//
// Long by nature — it is thousands of real clicks. HOMM5_RECON_LIMIT caps the
// vertex count for a quick check of the machinery.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { armBrush, dragTiles, newMap, planView, setGroundKind, setRiverStrength } from './tiles.ts';
import { parseTerrain, readHeights, readGroundFlags, readWaterPlane, tierOf, RAMP_BIT, TIER_STEP } from '../src/terrain.ts';

let ed: Launched;

const NAME = 'e2e Reconstruct C1M1';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const FIXTURE = join(REPO_ROOT, '_tmp', 'fixtures', 'C1M1', 'GroundTerrain.bin');
/** Where the rebuilt terrain is kept for `npm run diff-terrain`. */
const RECON_DIR = join(REPO_ROOT, '_tmp', 'recon', 'C1M1');

/** A blank map is flat here. */
const FLAT = 2.0;
/** Cap the work for a smoke run: how many vertices to actually sculpt. */
const LIMIT = Number(process.env.HOMM5_RECON_LIMIT || 0);

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('the shape of C1M1, rebuilt by clicking', async () => {
  test.skip(!existsSync(FIXTURE), 'needs the fixture — npm run extract-fixture C1M1');
  test.setTimeout(3 * 60 * 60_000);
  const { page } = ed;

  const fixture = parseTerrain(readFileSync(FIXTURE));
  const target = readHeights(fixture);
  const targetFlags = readGroundFlags(fixture)!;
  const targetRiver = readWaterPlane(fixture)!;

  await newMap(page, NAME, '96');
  await planView(page);
  await page.evaluate(() => window.view.fit());
  const V = (await page.evaluate(() => window.view.size())) + 1;
  expect(V * V).toBe(target.length);

  // --- the plan ------------------------------------------------------------
  //
  // One stroke per vertex, grouped by the force it needs so the toolbar field
  // is retyped once per distinct value instead of once per click. Raising and
  // lowering are different tools, so each direction is one pass.
  const up = new Map<number, number[]>(), down = new Map<number, number[]>();
  let vertices = 0;
  for (let i = 0; i < target.length; i++) {
    if (LIMIT && vertices >= LIMIT) break;
    const delta = target[i]! - FLAT;
    if (Math.abs(delta) < 1e-6) continue;
    const bucket = delta > 0 ? up : down;
    const force = Math.abs(delta);
    if (!bucket.has(force)) bucket.set(force, []);
    bucket.get(force)!.push(i);
    vertices++;
  }
  console.log(`plan: ${vertices} vertices, ${up.size} raise forces, ${down.size} dig forces`);

  // Every vertex is on screen at the fitted zoom, so their pixels are computed
  // once here rather than per click — the difference between a few minutes and
  // an hour of round trips.
  const pixels = await page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.vertexToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, V);

  // --- the strokes ---------------------------------------------------------
  const started = Date.now();
  let done = 0;
  for (const [mode, bucket] of [['bulk', up], ['dig', down]] as const) {
    if (!bucket.size) continue;
    await armBrush(page, mode, 'vertex');
    await page.locator('#brushtension').fill('0');
    await page.locator('#brushtension').dispatchEvent('input');
    for (const [force, verts] of bucket) {
      await page.locator('#brushforce').fill(String(force));
      await page.locator('#brushforce').dispatchEvent('input');
      for (const v of verts) {
        const [px, py] = pixels[v]!;
        await page.mouse.move(px, py);
        await page.mouse.down();
        await page.mouse.up();
        if (++done % 500 === 0) {
          const rate = done / ((Date.now() - started) / 1000);
          console.log(`  ${done}/${vertices} strokes (${rate.toFixed(0)}/s)`);
        }
      }
    }
  }
  console.log(`${done} strokes in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  // --- the tiers -----------------------------------------------------------
  //
  // The kinds go on AFTER the heights, and the order is not arbitrary: the kind
  // brush leaves the ground where it is, while every sculpting tool rewrites the
  // flag of what it moves. Doing it the other way round would undo itself.
  //
  // One rectangle over the whole map lays down the kind most of it shares —
  // 8195 of 9409 vertices here — and the rest is painted vertex by vertex, which
  // is how a person would do it too.
  const byKind = new Map<number, number[]>();
  for (let i = 0; i < targetFlags.length; i++) {
    const k = targetFlags[i]!;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(i);
  }
  const kinds = [...byKind].sort((a, b) => b[1].length - a[1].length);
  const [bulkKind, bulkVerts] = kinds[0]!;
  console.log(`kinds: ${kinds.map(([k, v]) => `${k}×${v.length}`).join(' ')}`);

  const paintKind = async (kind: number): Promise<void> => {
    await setGroundKind(page, tierOf(kind), (kind & RAMP_BIT) !== 0);
  };

  const tiles = V - 1;
  await armBrush(page, 'kind', 'rect');
  await paintKind(bulkKind);
  await dragTiles(page, [0, 0], [tiles - 1, tiles - 1], 12);
  console.log(`  one rect stroke: kind ${bulkKind} over ${bulkVerts.length} vertices`);

  await armBrush(page, 'kind', 'vertex');
  let painted = 0;
  for (const [kind, verts] of kinds.slice(1)) {
    await paintKind(kind);
    for (const v of verts) {
      const [px, py] = pixels[v]!;
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.mouse.up();
      painted++;
    }
  }
  console.log(`  ${painted} vertices painted one at a time`);

  // --- the rivers ----------------------------------------------------------
  //
  // The river plane is half-tile and graded, so it is painted on its own grid at
  // its own strength, grouped by value the way the height forces were. Carving
  // is off: this map's bed is barely dug (only half its wet vertices sit below
  // their neighbours, by 0.058 on average) and the ground is already final.
  const byStrength = new Map<number, number[]>();
  for (let i = 0; i < targetRiver.data.length; i++) {
    const v = targetRiver.data[i]!;
    if (!v) continue;
    if (!byStrength.has(v)) byStrength.set(v, []);
    byStrength.get(v)!.push(i);
  }
  const wet = [...byStrength.values()].reduce((n, a) => n + a.length, 0);
  console.log(`rivers: ${wet} cells, ${byStrength.size} distinct strengths`);

  const W = targetRiver.W;
  const cellPixels = await page.evaluate((n) => {
    window.view.fit();
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = window.view.cellToScreen(x, y);
      out.push([at.x, at.y]);
    }
    return out;
  }, W);

  await armBrush(page, 'river', '1');
  let cells = 0;
  for (const [value, list] of byStrength) {
    await setRiverStrength(page, value, false);
    for (const c of list) {
      const [px, py] = cellPixels[c]!;
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.mouse.up();
      cells++;
    }
  }
  console.log(`  ${cells} river cells painted`);

  await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  // --- the diff ------------------------------------------------------------
  //
  // The workspace is cleaned up after the run, so the result is kept where the
  // whole-file comparison can be pointed at it:
  //   npm run diff-terrain _tmp/fixtures/C1M1 _tmp/recon/C1M1
  const builtBin = readFileSync(join(MAP_DIR, 'GroundTerrain.bin'));
  mkdirSync(RECON_DIR, { recursive: true });
  writeFileSync(join(RECON_DIR, 'GroundTerrain.bin'), builtBin);

  const built = readHeights(parseTerrain(builtBin));
  const wrong: string[] = [];
  let checked = 0;
  for (const bucket of [up, down]) {
    for (const verts of bucket.values()) {
      for (const v of verts) {
        checked++;
        if (Math.abs(built[v]! - target[v]!) > 1e-4 && wrong.length < 20) {
          wrong.push(`(${v % V},${(v / V) | 0}) built ${built[v]!.toFixed(3)} vs ${target[v]!.toFixed(3)}`);
        }
      }
    }
  }
  console.log(`checked ${checked} vertices`);
  expect(wrong, 'vertices that did not reach the original height').toEqual([]);

  // Tiers and ramps, every vertex — and the heights are re-checked above rather
  // than before the kind pass, so this also proves painting a kind moved
  // nothing: a tool that nudged the ground would show up as a wrong height.
  const builtFlags = readGroundFlags(parseTerrain(builtBin))!;
  const wrongKind: string[] = [];
  for (let i = 0; i < targetFlags.length && wrongKind.length < 20; i++) {
    if (builtFlags[i] !== targetFlags[i]) {
      wrongKind.push(`(${i % V},${(i / V) | 0}) built ${builtFlags[i]} vs ${targetFlags[i]}`);
    }
  }
  expect(wrongKind, 'vertices whose ground kind differs').toEqual([]);

  const builtRiver = readWaterPlane(parseTerrain(builtBin))!;
  const wrongRiver: string[] = [];
  for (let i = 0; i < targetRiver.data.length && wrongRiver.length < 20; i++) {
    if (builtRiver.data[i] !== targetRiver.data[i]) {
      wrongRiver.push(`cell (${i % W},${(i / W) | 0}) built ${builtRiver.data[i]} vs ${targetRiver.data[i]}`);
    }
  }
  expect(wrongRiver, 'river cells that differ').toEqual([]);
  expect(TIER_STEP).toBe(16); // the encoding the plan above assumes
});

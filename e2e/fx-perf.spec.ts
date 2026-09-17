// What a shipped map costs to draw, with its effects and without them.
//
// SLICE_fx_performance.md §5: the numbers in that file are static — how much of
// everything is CREATED — and say nothing about where the frame goes. This is
// the live half. It opens the map the slice was counted on, lets it settle,
// and reads the frame the way a person with DevTools would: percentiles of
// frame time, draw calls, the particle side (systems, atlases, bytes), the
// long frames Chromium attributes to a script, memory per process, and
// whether the machine is drawing on its GPU at all — a run on SwiftShader
// invalidates every other number here, so that one is asserted.
//
// The readings are the result. They go to the console and to a JSON under
// `_tmp/perf/`, so a change to the renderer has a before to hold its after
// against; the ceilings that turn them into a guard are set from that
// baseline, not guessed here.
//
// Needs the game data; skips itself without it.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { bar } from './bar.ts';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** The map the slice counted: 2731 objects on the surface, 607 particle systems. */
const MAP = join(DATA, 'Maps', 'Scenario', 'A2C1M1', 'map.xdb');
const OUT = join(REPO_ROOT, '_tmp', 'perf');
/** How long each reading watches the frame, ms. */
const WINDOW_MS = 5000;

let ed: Launched;
test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

type Perf = ReturnType<Window['view']['perf']>;

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;
const ms = (x: number): string => x.toFixed(1);
const line = (tag: string, p: Perf): string =>
  `${tag.padEnd(4)} frame p50/p95/max ${ms(p.frame.p50)}/${ms(p.frame.p95)}/${ms(p.frame.max)} ms`
  + ` · js ${ms(p.js.p50)}/${ms(p.js.p95)}/${ms(p.js.max)} ms`
  + ` [${Object.entries(p.sections).map(([k, v]) => `${k} ${ms(v.p50)}`).join(', ')}]`
  + ` · ${p.calls} calls · ${p.triangles} tris · ${p.textures} textures`
  + ` · fx ${p.fx.copies} copies in ${p.fx.batches} batches, ${p.fx.alive} alive,`
  + ` ${p.fx.atlases} atlases (${p.fx.distinctAtlases} distinct) = ${mb(p.fx.atlasBytes)},`
  + ` ${p.fx.tables} tables = ${mb(p.fx.tableBytes)}`
  + ` · idle ${p.idle.bodies} bodies over ${p.idle.tables} tables = ${mb(p.idle.tableBytes)}`;

/** Watch the frame for WINDOW_MS from a clean slate. */
async function reading(): Promise<Perf> {
  const { page } = ed;
  await page.evaluate(() => window.view.perfReset());
  await page.waitForTimeout(WINDOW_MS);
  return page.evaluate(() => window.view.perf());
}

test('A2C1M1: the frame with effects on and off', { tag: '@data' }, async () => {
  test.skip(!existsSync(MAP), 'no shipped maps under the data root');
  test.setTimeout(300_000);
  const { page, errors } = ed;

  // Not on software rendering — or nothing below means anything. The report
  // names the switch when a previous run remembered it, and the adapter
  // otherwise; a SwiftShader adapter is the case to catch.
  const gpu = await page.evaluate(() => window.editor.gpuReport());
  console.log(`[perf] ${gpu.replace(/\n/g, '\n[perf] ')}`);
  expect(gpu, 'the editor is drawing in software — every number below would be about SwiftShader').not.toMatch(/swiftshader/i);

  const t0 = Date.now();
  await page.evaluate((p) => window.view.open(p), MAP);
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 180_000 });
  const loadMs = Date.now() - t0;
  // The systems arrive after the scene, and their atlases after them (each is
  // a chain of image decodes). Everything counted must be there before the
  // window opens, or "off" would win by being measured later.
  await page.waitForFunction(() => window.view.idle().fx > 0, null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const p = window.view.perf();
    return p.fx.batches > 0 && p.fx.atlases === p.fx.batches * 2;
  }, null, { timeout: 120_000 });
  const fxReadyMs = Date.now() - t0;
  // Effects on, whatever the profile remembers.
  const fxOn = await page.evaluate(() => document.getElementById('fxbtn')?.classList.contains('on'));
  if (!fxOn) await bar(page, '#fxbtn');
  await page.waitForTimeout(1000);

  const on = await reading();
  await bar(page, '#fxbtn');
  await page.waitForTimeout(500);
  const off = await reading();
  await bar(page, '#fxbtn'); // leave the preference as it was found: on
  const metrics = await page.evaluate(() => window.editor.appMetrics());

  const report = [
    `map:load ${loadMs} ms · effects ready at ${fxReadyMs} ms`,
    `${on.size[0]}×${on.size[1]} @ pixelRatio ${on.pixelRatio}`,
    line('on', on),
    line('off', off),
    `memory: ${metrics.map((m) => `${m.type} ${(m.workingSetKB / 1024) | 0} MB`).join(' · ')}`,
    ...(on.loaf.length ? ['long frames with effects on:', ...on.loaf.slice(-10).map((l) =>
      `  ${l.duration | 0} ms (blocking ${l.blocking | 0}, render ${l.render | 0}): ${l.scripts.slice(0, 3).join(' | ')}`)] : ['no long frames with effects on']),
  ];
  console.log(report.map((r) => `[perf] ${r}`).join('\n'));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'A2C1M1.json'), JSON.stringify({
    when: new Date().toISOString(), loadMs, fxReadyMs, gpu, on, off, metrics,
  }, null, 2));

  // The readings ARE the test; what is asserted is that they were readings…
  expect(on.frames).toBeGreaterThan(30);
  expect(off.frames).toBeGreaterThan(30);
  expect(on.fx.copies).toBeGreaterThan(0);
  // …and the ceilings the slice's three steps earned, so a later change cannot
  // quietly hand them back. Counts and bytes, not milliseconds: those belong
  // to the machine. The one time asserted is advanceFx's, which is a few
  // integer divisions per batch now and would only grow if the sampling loop
  // came back (SLICE_fx_performance.md §1a: 4.3 ms before, 0.2 after).
  expect(on.fx.batches, 'one batch per distinct effect payload').toBeLessThan(on.fx.copies);
  expect(on.fx.distinctAtlases, 'every atlas is its own effect').toBe(on.fx.atlases);
  expect(on.fx.atlasBytes, 'atlases: 146 MB on A2C1M1').toBeLessThan(170 * 1048576);
  expect(on.fx.tableBytes, 'baked recordings: 24 MB on A2C1M1').toBeLessThan(40 * 1048576);
  expect(on.calls - off.calls, 'effects cost one draw per batch').toBeLessThanOrEqual(on.fx.batches);
  expect(on.sections.fx!.p50, 'advanceFx is a lookup, not a sampler').toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

// A map crammed with the expensive things, and what the frame does under it.
//
//   node tools/perf-stress.ts                 — the "mix": effects, creatures, trees
//   node tools/perf-stress.ts --map effects   — effect-bearing objects only
//   node tools/perf-stress.ts --map creatures — animated creatures only
//   node tools/perf-stress.ts --count 3000 --size 216
//
// The shipped maps are the honest workload (e2e/fx-perf.spec.ts), but they
// are also what the renderer was tuned on. This builds a map no designer would
// — thousands of campfires, a field of dragons — through the same palette path
// a person places with (`view.place`), and reads the frame the same way
// fx-perf does: percentiles, the loop's sections, draw calls, the particle and
// idle tables, memory per process. Then it saves the map and opens it again,
// which is the load-time half. Readings go to the console and to
// `_tmp/perf/stress-<map>.json`; a snapshot of the view to `stress-<map>.png`.
//
// Runs in the e2e sandbox install (e2e/launch.ts), never the real game folder.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, DATA, E2E_GAME, REPO_ROOT, hudSays } from '../e2e/launch.ts';
import { bar } from '../e2e/bar.ts';
import { newMap } from '../e2e/tiles.ts';
import { modFile } from '../src/game/mod-paths.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const KIND = arg('map', 'mix');
const COUNT = Number(arg('count', '2000'));
const SIZE = arg('size', '176');
const NAME = `e2e Stress ${KIND}`;
const OUT = join(REPO_ROOT, '_tmp', 'perf');

/** What goes on the map: a shared-href pattern, and its share of the count. */
const RECIPES: Record<string, { pattern: RegExp; share: number }[]> = {
  effects: [
    { pattern: /Campfire|Chest\.|Will_o_the_wisp|SwampHaze|Fountain_Of_Fortune|Crystal|Gold\.|Ore\.|Wood\./i, share: 1 },
  ],
  creatures: [
    { pattern: /AdvMapMonsterShared/, share: 1 },
  ],
  mix: [
    { pattern: /Campfire|Chest\.|Will_o_the_wisp|SwampHaze|Fountain_Of_Fortune|Crystal/i, share: 0.4 },
    { pattern: /AdvMapMonsterShared/, share: 0.3 },
    { pattern: /Trees?\/|Tree\d|Bush/i, share: 0.3 },
  ],
};

const mb = (b: number): string => `${(b / 1048576).toFixed(1)} MB`;
const ms = (x: number): string => x.toFixed(1);

const cleanup = (): void => {
  const dir = join(DATA, 'Maps', 'SingleMissions', NAME);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  rmSync(modFile(E2E_GAME, 'map', NAME), { force: true });
};

cleanup();
const ed = await launchEditor();
const { page } = ed;
const appLog: string[] = [];
page.on('console', (m) => { const t = m.text(); if (/^\[perf\]/.test(t)) appLog.push(t); });
try {
  await page.evaluate(() => window.editor.setIdleAnimation('all'));
  await page.evaluate(() => { const b = document.getElementById('fxbtn')!; if (!b.classList.contains('on')) b.click(); });
  await newMap(page, NAME, SIZE);

  // The palette's own catalogue, filtered by the recipe.
  const { objects } = await page.evaluate(() => window.editor.listObjects());
  const recipe = RECIPES[KIND];
  if (!recipe) throw new Error(`no recipe "${KIND}"; one of ${Object.keys(RECIPES).join(', ')}`);
  const picks: { type: string; shared: string }[] = [];
  for (const { pattern, share } of recipe) {
    const kinds = objects.filter((o) => !o.hidden && !o.random && pattern.test(o.shared));
    if (!kinds.length) { console.warn(`nothing in the catalogue matches ${pattern}`); continue; }
    const n = Math.round(COUNT * share);
    for (let i = 0; i < n; i++) { const k = kinds[i % kinds.length]!; picks.push({ type: k.type, shared: k.shared }); }
    console.log(`${n} × from ${kinds.length} kind(s) matching ${pattern}`);
  }
  // Shuffle so a kind's copies are spread over the map, not lined up.
  for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picks[i], picks[j]] = [picks[j]!, picks[i]!]; }

  // A grid with room between neighbours; 3 tiles apart fills a 176 map with
  // ~3300 spots, which is more than the default count.
  const size = Number(SIZE), step = 3, margin = 4;
  const spots: [number, number][] = [];
  for (let y = margin; y < size - margin; y += step) for (let x = margin; x < size - margin; x += step) spots.push([x, y]);
  const n = Math.min(picks.length, spots.length);
  console.log(`placing ${n} objects on a ${size}×${size} map…`);
  const t0 = Date.now();
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = spots[i]!;
    // A kind whose model the editor cannot decode is refused; the spot is skipped.
    try {
      await page.evaluate((o) => window.view.place(o), { ...picks[i]!, x, y });
    } catch (e) {
      skipped++;
      if (skipped < 5) console.warn(`  skipped ${picks[i]!.shared}: ${e instanceof Error ? e.message.split(/\r?\n/)[0] : e}`);
    }
    if (i % 250 === 249) console.log(`  ${i + 1} placed, ${((Date.now() - t0) / 1000) | 0}s`);
  }
  console.log(`placed in ${((Date.now() - t0) / 1000).toFixed(1)}s${skipped ? `, ${skipped} skipped` : ''}`);
  await page.waitForFunction(() => window.view.pending() === 0, null, { timeout: 120_000 });
  // Effects arrive asynchronously; give the last placements their systems.
  await page.waitForTimeout(3000);

  const read = async (tag: string): Promise<ReturnType<Window['view']['perf']>> => {
    await page.evaluate(() => window.view.perfReset());
    await page.waitForTimeout(5000);
    const p = await page.evaluate(() => window.view.perf());
    console.log(`[perf] ${tag.padEnd(10)} frame p50/p95/max ${ms(p.frame.p50)}/${ms(p.frame.p95)}/${ms(p.frame.max)} ms · js ${ms(p.js.p50)}/${ms(p.js.p95)}`
      + ` [${Object.entries(p.sections).map(([k, v]) => `${k} ${ms(v.p50)}`).join(', ')}] · ${p.calls} calls · ${p.triangles} tris`
      + ` · fx ${p.fx.copies} copies/${p.fx.batches} batches, ${p.fx.alive} alive, atlases ${mb(p.fx.atlasBytes)}, tables ${mb(p.fx.tableBytes)}`
      + ` · idle ${p.idle.bodies} bodies/${p.idle.tables} tables ${mb(p.idle.tableBytes)} · js heap ${mb(p.jsHeapBytes)}`);
    return p;
  };
  // Three views: the whole map from above, a corner close up, the default orbit.
  await page.evaluate(() => { window.view.plan(true); window.view.fit(); });
  const plan = await read('plan/fit');
  await page.evaluate((s) => { window.view.focus(s / 2, s / 2); window.view.zoom(12); }, size);
  const close = await read('plan/zoom');
  await page.evaluate(() => window.view.plan(false));
  const orbit = await read('orbit');
  // Half the pixels: if the frame follows, the GPU's fill rate is the wall
  // and `render` above was the CPU waiting on it, not three's own work.
  await page.evaluate(() => window.view.pixelRatio(0.5));
  const half = await read('orbit ½px');
  await page.evaluate(() => window.view.pixelRatio(Math.min(devicePixelRatio, 2)));
  // And without the shadow pass: the second submission of every caster.
  await page.evaluate(() => window.view.shadows(false));
  const noShadow = await read('no shadows');
  await page.evaluate(() => window.view.shadows(true));
  const metrics = await page.evaluate(() => window.editor.appMetrics());
  console.log(`[perf] memory: ${metrics.map((m) => `${m.type} ${(m.workingSetKB / 1024) | 0} MB`).join(' · ')}`);
  mkdirSync(OUT, { recursive: true });
  const url = await page.evaluate(() => window.view.snapshot());
  writeFileSync(join(OUT, `stress-${KIND}.png`), Buffer.from(url.split(',')[1]!, 'base64'));

  // The load-time half: the same map saved and opened again.
  await bar(page, '#save');
  await hudSays(page, /saved/i, 300_000);
  const mapPath = join(DATA, 'Maps', 'SingleMissions', NAME, 'map.xdb');
  const t1 = Date.now();
  await page.evaluate((p) => window.view.open(p), mapPath);
  await page.waitForFunction(() => window.view.size() > 0, undefined, { timeout: 300_000 });
  const loadMs = Date.now() - t1;
  await page.waitForFunction(() => { const p = window.view.perf(); return p.fx.batches === 0 || p.fx.atlases === p.fx.batches; }, null, { timeout: 300_000 });
  const readyMs = Date.now() - t1;
  console.log(`[perf] reopen: map:load ${loadMs} ms · effects ready at ${readyMs} ms`);
  const reopened = await read('reopened');
  console.log('\napp [perf] lines:\n  ' + appLog.filter((l) => !/jank/.test(l)).slice(-30).join('\n  '));
  const jank = appLog.filter((l) => /jank/.test(l));
  if (jank.length) console.log(`\n${jank.length} jank warning(s), worst: ${jank.map((l) => Number(/(\d+)ms/.exec(l)?.[1])).sort((a, b) => b - a).slice(0, 5).join(' ')} ms`);

  writeFileSync(join(OUT, `stress-${KIND}.json`), JSON.stringify({
    when: new Date().toISOString(), kind: KIND, count: n, size, plan, close, orbit, half, noShadow, reopened, loadMs, readyMs, metrics, appLog,
  }, null, 2));
  console.log('errors', ed.errors);
} finally {
  await ed.app.close();
  cleanup();
}

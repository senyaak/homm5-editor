// C1M1 stage 6 — the objects, placed where the original puts them.
//
// 2645 of them, and the count is the least interesting thing about the job. The
// measurement (`npm run object-shape`) says what actually matters:
//
//   * 118 distinct shared definitions, 24 of which no object link points at —
//     they are placeable at all only since the catalogue started reading the
//     bare shared files (713 objects, 27% of the map);
//   * 218 objects at an arbitrary fraction of a tile, none on a half tile;
//   * 368 at one of 80 distinct angles.
//
// So a pass is: pick an entry in the palette once per definition, click the map
// once per object, and then go back over the ones that need an exact position
// or facing and type it in the panel. That is a person's workflow, and it is
// the whole of it — the fields those objects carry are the next stage.
//
// Idempotent like the terrain stages: what the map already holds is matched
// against the target first, and only the difference is placed.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { degOf, pickObject, placeAtTile, rotDelta, setPlacement, sharedKey } from './objects.ts';
import { MAP_DIR, NEED_FIXTURE, FIXTURE, hasFixture, openMap } from './c1m1.ts';
import { loadMap } from '../src/map.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** Cap the work for a quick check of the machinery. */
const LIMIT = Number(process.env.HOMM5_RECON_LIMIT || 0);

/** How close a placement has to be to count as the same object. */
const POS_EPS = 0.005;
const ROT_EPS = 1e-3;

interface Target { shared: string; type: string; x: number; y: number; rot: number }

test('C1M1 objects, placed one click at a time', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(2 * 60 * 60_000);
  const { page } = ed;

  // The original's objects, as placements. Floor 1 would need the underground
  // view; C1M1 has none, and the fixture is checked rather than assumed.
  const original = loadMap(readFileSync(join(FIXTURE, '..', 'C1M1.xdb'), 'utf8'));
  const all: Target[] = original.objects.map((o) => ({
    shared: o.shared ?? '', type: o.type, x: o.pos!.x, y: o.pos!.y, rot: o.rot,
  }));
  // One list for the whole pass, capped once: placing one set and then checking
  // another would report mismatches that are the cap's, not the editor's.
  const targets = LIMIT ? all.slice(0, LIMIT) : all;
  expect(original.objects.every((o) => o.floor === 0), 'C1M1 is a one-floor map').toBe(true);

  await openMap(page);

  // What the map already holds — this stage can be re-run, and re-running it
  // must not double the forest.
  const already = await page.evaluate(() => window.view.objects());
  const pool = new Map<string, typeof already>();
  for (const o of already) {
    const k = sharedKey(o.shared);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(o);
  }
  const todo: Target[] = [];
  /** Objects already here that stand right but do not FACE right — see below. */
  const reface: [string, Target][] = [];
  for (const t of targets) {
    const cands = pool.get(sharedKey(t.shared));
    // Among the ones on this spot, prefer the one already facing the right way:
    // two of a kind can share a tile, and taking either would report the pair as
    // one right and one wrong when the set is already correct.
    const here = cands?.filter((c) => Math.abs(c.x - t.x) <= POS_EPS && Math.abs(c.y - t.y) <= POS_EPS) ?? [];
    const hit = here.find((c) => rotDelta(c.r, t.rot) <= ROT_EPS) ?? here[0];
    if (hit) {
      cands!.splice(cands!.indexOf(hit), 1);
      // Re-running has to CONVERGE, not just stop adding: an object left facing
      // the wrong way by an interrupted pass is right where it belongs, so
      // matching on position alone would call it done forever.
      if (rotDelta(hit.r, t.rot) > ROT_EPS) reface.push([hit.id, t]);
      continue;
    }
    todo.push(t);
  }
  console.log(`objects: ${targets.length} in the original, ${already.length} already placed`
    + `, ${todo.length} to place, ${reface.length} to turn`);

  // Grouped by definition: picking an entry in the palette is a search and a
  // click, and doing it once per object rather than once per definition would
  // be 2645 trips through the catalogue instead of 118.
  const byShared = new Map<string, Target[]>();
  for (const t of todo) {
    const k = sharedKey(t.shared);
    if (!byShared.has(k)) byShared.set(k, []);
    byShared.get(k)!.push(t);
  }

  const started = Date.now();
  let placed = 0;
  /** Targets still to be given their exact position and facing, by object id. */
  const adjust: [string, Target][] = [...reface];
  for (const [, group] of byShared) {
    await pickObject(page, group[0]!.shared);
    const before = new Set((await page.evaluate(() => window.view.objects())).map((o) => o.id));
    for (const t of group) {
      // The click lands on a whole tile; the fraction and the angle are typed
      // in afterwards, which is what the panel's boxes are for.
      await placeAtTile(page, Math.floor(t.x), Math.floor(t.y));
      if (++placed % 200 === 0) {
        console.log(`  ${placed}/${todo.length} (${(placed / ((Date.now() - started) / 1000)).toFixed(0)}/s)`);
      }
    }
    // Which object each click made, rather than which one is nearest afterwards.
    // Nearest is ambiguous exactly where this map is busiest: two bushes of the
    // same kind on one tile are the same distance from both targets, so the
    // fraction meant for one landed on the other and the facing followed it.
    // Insertion order is the answer the DOM already has.
    const made = (await page.evaluate(() => window.view.objects())).filter((o) => !before.has(o.id));
    expect(made.length, `objects created by ${group.length} clicks`).toBe(group.length);
    made.forEach((o, i) => adjust.push([o.id, group[i]!]));
  }
  console.log(`  ${placed} placed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  // Right-click gives the armed object up: leaving it armed would make the next
  // stray click place another bush.
  await page.mouse.click(10, 400, { button: 'right' });

  // --- the exact positions and facings ---
  //
  // Everything is on its tile now; 218 of them belong at a fraction of it and
  // 368 face an angle no button can produce. Both are typed into the panel, on
  // the object the click created.
  let fixed = 0;
  const adjustStarted = Date.now();
  for (const [id, t] of adjust) {
    await page.evaluate((i) => window.view.select(i), id);
    const at = await page.evaluate((i) => window.view.objects().find((o) => o.id === i), id);
    const needsPos = !at || Math.abs(at.x - t.x) > POS_EPS || Math.abs(at.y - t.y) > POS_EPS;
    const needsRot = !at || rotDelta(at.r, t.rot) > ROT_EPS;
    if (!needsPos && !needsRot) continue;
    await setPlacement(page, {
      ...(needsPos ? { x: +t.x.toFixed(3), y: +t.y.toFixed(3) } : {}),
      ...(needsRot ? { rotDeg: +degOf(t.rot).toFixed(3) } : {}),
    });
    if (++fixed % 200 === 0) console.log(`  adjusted ${fixed} (${((Date.now() - adjustStarted) / 1000).toFixed(0)}s)`);
  }
  console.log(`  ${fixed} exact positions/facings set`);

  // --- anything the original does not have ---
  //
  // A re-run must converge, and an interrupted one leaves objects behind: a
  // capped pass, a crash mid-group, a click that landed twice. So the map is
  // reconciled against the target rather than only added to — what no target
  // claims is selected and deleted, the same two actions a person would take.
  const live = await page.evaluate(() => window.view.objects());
  const claimed = new Map<string, Target[]>();
  for (const t of targets) {
    const k = sharedKey(t.shared);
    if (!claimed.has(k)) claimed.set(k, []);
    claimed.get(k)!.push(t);
  }
  const extra: string[] = [];
  for (const o of live) {
    const want = claimed.get(sharedKey(o.shared));
    const i = want?.findIndex((t) => Math.abs(t.x - o.x) <= POS_EPS && Math.abs(t.y - o.y) <= POS_EPS);
    if (want && i !== undefined && i >= 0) { want.splice(i, 1); continue; }
    extra.push(o.id);
  }
  for (const id of extra) {
    await page.evaluate((i) => window.view.select(i), id);
    await page.locator('#p-del').click();
  }
  if (extra.length) console.log(`  ${extra.length} object(s) the original does not have, deleted`);

  // --- what landed in the file ---
  await settle(page);
  // A pass that changed nothing leaves nothing to save, and Save is disabled
  // then — which is the point of the stage being idempotent, not a failure.
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 300_000 });

  const built = loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8'));
  const mine = built.objects.map((o) => ({
    shared: sharedKey(o.shared ?? ''), x: o.pos!.x, y: o.pos!.y, rot: o.rot, type: o.type,
  }));
  if (!LIMIT) {
    expect(mine.length, 'objects in the saved map').toBe(targets.length);
  }

  // Matched the way `npm run diff-objects` matches: by what it is and where it
  // stands, never by id or file order.
  const left = new Map<string, typeof mine>();
  for (const o of mine) {
    if (!left.has(o.shared)) left.set(o.shared, []);
    left.get(o.shared)!.push(o);
  }
  const wrong: string[] = [];
  for (const t of targets) {
    const cands = left.get(sharedKey(t.shared));
    if (!cands?.length) { wrong.push(`nothing placed for ${t.type} ${t.shared} at (${t.x}, ${t.y})`); continue; }
    let best = 0, bestD = Infinity;
    cands.forEach((c, i) => {
      const d = Math.hypot(c.x - t.x, c.y - t.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    const o = cands.splice(best, 1)[0]!;
    if (bestD > POS_EPS) wrong.push(`${t.type} at (${t.x}, ${t.y}) landed at (${o.x}, ${o.y})`);
    else if (rotDelta(o.rot, t.rot) > ROT_EPS) {
      wrong.push(`${t.type} at (${t.x}, ${t.y}) faces ${o.rot} instead of ${t.rot}`);
    }
    if (o.type !== t.type) wrong.push(`${t.type} at (${t.x}, ${t.y}) was placed as ${o.type}`);
  }
  expect(wrong.slice(0, 10), `objects that differ (${wrong.length})`).toEqual([]);
});

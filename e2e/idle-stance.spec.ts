// The idle stance in the real app.
//
// tools/test-idle.ts already proves the skinning maths against three.js's own
// implementation, and it does so without a window. What it cannot see is the
// half that only exists once Electron is up: that a SkinnedMesh built from a
// scene payload survives contact with the real materials and the real render
// loop, that the objects come out of the batched draw when they take an
// animated body, and that the clock actually turns.
//
// Needs the game data (creatures come from it), so it skips itself without one.

import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';

let ed: Launched;
/** Restored afterwards: this is the user's own persisted setting. */
let previousMode: 'off' | 'visible' | 'all' = 'off';

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');

/** The first shipped map that actually has a monster standing on it. */
function mapWithMonsters(): string | null {
  const root = join(DATA, 'Maps');
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(path); continue; }
      if (entry.name !== 'map.xdb') continue;
      if (existsSync(join(dir, 'GroundTerrain.bin')) && readFileSync(path, 'utf8').includes('AdvMapMonster')) return path;
    }
  }
  return null;
}

const MAP = mapWithMonsters();

test.beforeAll(async () => {
  ed = await launchEditor();
  previousMode = await ed.page.evaluate(() => window.editor.idleAnimation());
});
test.afterAll(async () => {
  await ed?.page.evaluate((mode) => window.editor.setIdleAnimation(mode), previousMode);
  await ed?.app.close();
});

test('creatures take an animated body and the loop turns', async () => {
  test.skip(!MAP, 'no shipped map with monsters under the data root');
  const { page, errors } = ed;

  // Built with animation off first: the same map, no bones anywhere. This is
  // the state the editor ships in, and it has to stay a clean one.
  await page.evaluate(() => window.editor.setIdleAnimation('off'));
  await page.evaluate((path) => window.view.open(path), MAP!);
  expect(await page.evaluate(() => window.view.idle())).toMatchObject({ mode: 'off', animated: 0 });

  // Now with it on. The setting decides what map:load BUILDS, so the map has to
  // be opened again — which is exactly what the button tells the user.
  await page.evaluate(() => window.editor.setIdleAnimation('all'));
  await page.evaluate((path) => window.view.open(path), MAP!);
  const on = await page.evaluate(() => window.view.idle());
  expect(on.mode).toBe('all');
  expect(on.animated).toBeGreaterThan(0);

  // The clock turns. A skeleton that is built and never stepped draws a
  // creature frozen in its bind pose, which looks like a still map — the bug
  // this catches would otherwise pass every check above.
  await expect.poll(async () => (await page.evaluate(() => window.view.idle())).time, { timeout: 5000 })
    .toBeGreaterThan(on.time + 0.2);

  // And nothing in the renderer fell over on the way — a SkinnedMesh with the
  // wrong attributes throws from inside three.js at draw time, not at build.
  expect(errors).toEqual([]);
});

test('the toolbar button cycles the three modes', async () => {
  test.skip(!MAP, 'no shipped map with monsters under the data root');
  const { page } = ed;
  const label = page.locator('#idlebtn');
  await expect(label).toBeVisible();
  // The map above was opened with animation on, so every mode is reachable
  // without another reload and the label must follow each step.
  const seen: string[] = [await label.textContent() ?? ''];
  for (let i = 0; i < 3; i++) {
    await label.click();
    seen.push(await label.textContent() ?? '');
  }
  expect(seen[3]).toBe(seen[0]); // three clicks, back where it started
  expect(new Set(seen)).toEqual(new Set(['Idle stance: off', 'Idle stance: visible', 'Idle stance: all']));
});

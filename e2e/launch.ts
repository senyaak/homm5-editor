// Shared Electron launch helper for the e2e suite.
//
// Every test opens the real app the way `npm start` does — `electron .` from the
// repo root, which runs electron/main.ts (Node strips its types). Playwright
// finds the electron binary from the installed `electron` package.

import { _electron as electron, expect } from '@playwright/test';
import { note } from './trace.ts';
import type { ElectronApplication, Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Repo root — the folder holding package.json (main: electron/main.ts). */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The install the suite runs against, unless a spec brings its own.
 *
 * A map is a file in an install now (`<game>/H5E/<name>.h5m`), so the specs need
 * one — and it must not be the real game folder, or every run would leave `e2e …`
 * maps in it.
 */
export const E2E_GAME = process.env.HOMM5_ROOT || join(REPO_ROOT, '_tmp', 'e2e-install');

/**
 * The unpacked game data every spec resolves assets against.
 *
 * Here rather than in one spec's folder because it is the same answer for all of
 * them, and because the two places that used to define it — the campaign
 * reconstruction's `shared.ts` and `mods.ts` — had it written out twice, which is
 * how a spec about the script editor came to import from the reconstruction.
 * Read-only to the suite: nothing writes into it except a map being worked on.
 */
export const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');

/** A launched app plus its first (only) window, ready for interaction. */
export interface Launched {
  app: ElectronApplication;
  page: Page;
  /**
   * Uncaught renderer errors, in the order they happened.
   *
   * Collected for every launch because the listener has to be attached before
   * the bundle runs, and the errors worth catching are the ones thrown at its
   * top level — by which time any test could only find the wreckage. A dead
   * renderer keeps the whole static page, so a test asserting on markup passes
   * happily; this array is what tells the difference.
   */
  errors: string[];
  /**
   * The app's own terminal output, line by line. The main process reports
   * renderer deaths here (`[renderer gone] …`) — the one trace a renderer that
   * silently reloaded to the start screen leaves behind.
   */
  log: string[];
}

/**
 * Launch the editor and wait for its window to render.
 * @param env extra environment (e.g. HOMM5_DATA) merged over the current one.
 * @param args extra Chromium/Electron switches, appended after the app path.
 */
export async function launchEditor(env: Record<string, string> = {}, args: string[] = []): Promise<Launched> {
  const app = await electron.launch({
    args: ['.', ...args],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // Say it rather than let the app work it out. The app also remembers a
      // data root in the user's app-data folder, shared with a packaged build,
      // so without this a test run inherits wherever someone last pointed the
      // installed editor — which is how a whole suite came to open the setup
      // window instead of the editor, after that folder was deleted.
      HOMM5_DATA: process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked'),
      // An install of its own, unless the spec brings one. A new map is a file
      // in the install now — `<game>/H5E/<name>.h5m` — so without this every
      // spec that creates one would leave an archive in the real game folder,
      // and the picker would fill up with `e2e …` maps nobody asked for.
      HOMM5_ROOT: E2E_GAME,
      // Unpack maps where the specs can find them. Every map the editor opens
      // lives in an archive and is unpacked to work in; left to itself the app
      // puts that copy in a workspace under _tmp, keyed by a hash of the
      // archive's path, which is a fine place for a person and no place for a
      // test to read `GroundTerrain.bin` from. Pointed at the data root, a map
      // lands at its in-game path — `<data>/Maps/SingleMissions/<name>` — which
      // is what every spec here computes for itself.
      HOMM5_UNPACK_TO: process.env.HOMM5_UNPACK_TO || process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked'),
      ...env,
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const log: string[] = [];
  const collect = (chunk: Buffer | string): void => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log.push(line);
  };
  app.process().stdout?.on('data', collect);
  app.process().stderr?.on('data', collect);
  await page.waitForLoadState('domcontentloaded');
  return { app, page, errors, log };
}

/**
 * Close the editor, and FAIL if the renderer threw anything while it was open.
 *
 * A spec that only asserts on what the screen says can pass over a renderer
 * that died: a dead one keeps the whole static page, so every locator still
 * resolves and every message that was already written is still there. The
 * errors array is the one thing that tells the difference — and asking for it
 * at the end of every test is the sort of line that gets forgotten, so this
 * closes AND checks, and specs call it instead of `ed.app.close()`.
 *
 * `allow` is for the specs that provoke a throw on purpose (the WebGL one):
 * anything matching is dropped, anything else still fails.
 *
 * READ AFTER THE CLOSE, not before. The list used to be taken at entry and
 * asserted afterwards, so anything the renderer threw while shutting down was
 * collected into the array and never looked at — and shutdown is exactly when a
 * listener nobody unhooked, or a promise still in flight against a window that
 * is going away, throws. The window between the two lines was the only part of
 * a spec's life this could not see.
 */
export async function closeEditor(ed: Launched, allow?: RegExp): Promise<void> {
  try {
    await ed.app.close();
  } finally {
    const unexpected = allow ? ed.errors.filter((e) => !allow.test(e)) : ed.errors;
    expect(unexpected, 'the renderer threw nothing while this ran, closing included').toEqual([]);
  }
}

/**
 * Wait for the status line to say something, and give up the moment it says the
 * operation failed.
 *
 * The HUD is where the app reports a failed IPC call, so an `error:` there means
 * the thing being waited for is never going to happen. Waiting out the timeout
 * anyway costs a minute per step and turns a message that names the problem
 * ("… .h5m not found") into a bare "timed out" — the failure most likely to be
 * blamed on the wrong thing.
 *
 * Returns the matching text, so a caller that needs to parse a path out of it
 * does not have to read the element a second time.
 */
export async function hudSays(page: Page, expected: RegExp | string, timeout = 60_000): Promise<string> {
  const hud = page.locator('#hud');
  const hit = (t: string): boolean => (typeof expected === 'string' ? t.includes(expected) : expected.test(t));
  const deadline = Date.now() + timeout;
  // A pack or a save is the longest wait in the suite, and a silent one: the
  // status line is the only thing that moves. Say what it says every few
  // seconds, so a run that is working can be told apart from a wedged one
  // WITHOUT waiting out the timeout. See e2e/trace.ts.
  const started = Date.now();
  let spoke = 0;
  for (;;) {
    const text = (await hud.textContent()) ?? '';
    if (hit(text)) return text;
    if (text.startsWith('error:')) throw new Error(`the editor reported a failure instead: ${text}`);
    if (Date.now() > deadline) throw new Error(`the status line never matched ${expected}; it says: ${text || '(nothing)'}`);
    const waited = Math.floor((Date.now() - started) / 5000);
    if (waited > spoke) {
      spoke = waited;
      note(`waiting for ${expected} — the editor says ${text ? `"${text}"` : 'nothing yet'} (${waited * 5}s)`);
    }
    await delay(100);
  }
}

// Shared Electron launch helper for the e2e suite.
//
// Every test opens the real app the way `npm start` does — `electron .` from the
// repo root, which runs electron/main.ts (Node strips its types). Playwright
// finds the electron binary from the installed `electron` package.

import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** Repo root — the folder holding package.json (main: electron/main.ts). */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** A launched app plus its first (only) window, ready for interaction. */
export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launch the editor and wait for its window to render.
 * @param env extra environment (e.g. HOMM5_DATA) merged over the current one.
 */
export async function launchEditor(env: Record<string, string> = {}): Promise<Launched> {
  const app = await electron.launch({
    args: ['.'],
    cwd: REPO_ROOT,
    env: { ...process.env, ...env } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
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
  for (;;) {
    const text = (await hud.textContent()) ?? '';
    if (hit(text)) return text;
    if (text.startsWith('error:')) throw new Error(`the editor reported a failure instead: ${text}`);
    if (Date.now() > deadline) throw new Error(`the status line never matched ${expected}; it says: ${text || '(nothing)'}`);
    await delay(100);
  }
}

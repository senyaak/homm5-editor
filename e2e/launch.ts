// Shared Electron launch helper for the e2e suite.
//
// Every test opens the real app the way `npm start` does — `electron .` from the
// repo root, which runs electron/main.ts (Node strips its types). Playwright
// finds the electron binary from the installed `electron` package.

import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
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

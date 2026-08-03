// The packaged editor — the exe, not the checkout.
//
// Everything else in this suite runs `electron .` over the repo, where Node
// strips the types off main.ts and the checkout's position answers where the
// game is. The packaged app has neither: it is a bundle inside app.asar with no
// repo around it, so this is the only test that can catch a path that only
// resolved because the source tree happened to be there.
//
// Skipped unless `npm run dist` has been run — dist/ is a build artifact and
// not everyone has one.

import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './launch.ts';

const EXE = join(REPO_ROOT, 'dist', 'homm5-editor-win32-x64', 'homm5-editor.exe');
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');

test.skip(!existsSync(EXE), 'no packaged build — run `npm run dist` first');
test.describe.configure({ mode: 'serial' });

/**
 * Launch the exe with a per-user folder of its own.
 *
 * A packaged build that cannot write beside itself keeps its `.env` in that
 * folder, so without this a test could be handed a configured editor it meant
 * to find unconfigured — or leave one behind for the next run.
 */
async function launchPackaged(env: Record<string, string>): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'homm5-packaged-'));
  const app = await electron.launch({
    executablePath: EXE,
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, HOMM5_DATA: '', HOMM5_ROOT: '', HOMM5_EDITOR: '', ...env } as Record<string, string>,
  });
  return { app, userData };
}

test('the packaged app opens the editor when it knows where the data is', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchPackaged({ HOMM5_DATA: DATA });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // The map list is the editor's first screen, and it is populated from the
    // data root — so seeing maps proves the bundle found both the UI and the data.
    await expect(page.locator('#maplist .m').first()).toBeVisible({ timeout: 60_000 });
    expect(await page.locator('#maplist .m').count()).toBeGreaterThan(0);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('with nothing configured it asks where the game is', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchPackaged({});
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Setup, not the editor: the game folder is unknown, so there is nothing to
    // list and the app must say so rather than open onto an empty picker.
    await expect(page.locator('#pick-game')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#start')).toBeDisabled();
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('and finishing setup opens the editor, without a second launch', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchPackaged({});
  try {
    const setup = await app.firstWindow();
    await setup.waitForLoadState('domcontentloaded');
    await expect(setup.locator('#pick-game')).toBeVisible({ timeout: 60_000 });

    // Answer setup the way its own buttons do — the folder pickers are native
    // dialogs, which is the one thing that cannot be clicked from here.
    //
    // Not awaited: finishing closes this very window, so the call it is waiting
    // on dies with the page. Awaiting it fails whatever the app then does, which
    // makes the check meaningless.
    void setup.evaluate(({ game, data }) => {
      const w = window as unknown as { setup: { finish: (g: string, d: string) => Promise<boolean> } };
      void w.setup.finish(game, data);
    }, { game: join(REPO_ROOT, '..'), data: DATA }).catch(() => { /* the page is gone; that is the point */ });

    // The editor window, in this run. Destroying the setup window left the app
    // with no windows open for an instant, and it took that as its cue to quit:
    // setup appeared to do nothing and the answers only took effect the next
    // time the exe was started.
    const editor = await app.waitForEvent('window', { timeout: 30_000 });
    await editor.waitForLoadState('domcontentloaded');
    await expect(editor.locator('#maplist .m').first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

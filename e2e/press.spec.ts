// The press itself (e2e/press.ts): a click that starts nothing fails at once,
// and an action's outcome is the one the spec said — or the spec fails with
// what the action said instead.
//
// The action used is the random map dialog's opening on an install that has
// no executable of ours: the generator refuses it, by rule, every time and on
// any machine, so the refused path is there without the game.

import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, closeEditor, launchEditor, type Launched } from './launch.ts';
import { press, pressBar } from './press.ts';

const BARE = join(REPO_ROOT, '_tmp', 'e2e-press-bare');
let ed: Launched;

test.beforeAll(async () => {
  rmSync(BARE, { recursive: true, force: true });
  mkdirSync(join(BARE, 'bin'), { recursive: true });
  ed = await launchEditor({ HOMM5_ROOT: BARE });
});
test.afterAll(async () => { await closeEditor(ed); });

/** What a press threw, if it threw, and how long it took to. */
async function thrown(run: () => Promise<unknown>): Promise<{ message: string | null; ms: number }> {
  const t0 = Date.now();
  const message = await run().then(() => null, (e: Error) => e.message);
  return { message, ms: Date.now() - t0 };
}

test.describe('a press waits for its own action, and only that @nodata', () => {
  test('a click that starts no action fails at once', async () => {
    // The bar's Map button opens a menu and nothing more: no action.
    const got = await thrown(() => press(ed.page, ed.page.locator('#bar [popovertarget="mapmenu"]')));
    expect(got.message).toMatch(/the click started no action/);
    expect(got.ms, 'at once, not at a timeout').toBeLessThan(5_000);
    await ed.page.keyboard.press('Escape');
  });

  test('a refusal the spec expects is the outcome', async () => {
    const got = await pressBar(ed.page, '#rmgbtn', { refused: /has not been prepared yet/ });
    expect(got).toMatchObject({ name: 'rmg: open', outcome: 'refused' });
    await expect(ed.page.locator('#rmg-err'), 'and the dialog says it').toContainText('has not been prepared yet');
    await ed.page.locator('#rmg-cancel').click();
  });

  test('a refusal where the spec expected done fails with what it said', async () => {
    const got = await thrown(() => pressBar(ed.page, '#rmgbtn'));
    expect(got.message).toMatch(/^rmg: open: refused — .*has not been prepared yet/);
    await ed.page.locator('#rmg-cancel').click();
  });

  test('a refusal with other words than expected fails too', async () => {
    const got = await thrown(() => pressBar(ed.page, '#rmgbtn', { refused: /already exists/ }));
    expect(got.message).toMatch(/refused, but with ".*has not been prepared yet.*", not \/already exists\//);
    await ed.page.locator('#rmg-cancel').click();
  });
});

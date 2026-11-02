// The harness itself: a failure the app reports ends the test at once, with the
// app's own words — not a wait run out to its timeout (e2e/failures.ts).
//
// Each case plants one kind of failure, then waits on something that will never
// appear, with a timeout far longer than the failure should take to land. The
// wait must reject quickly and carry the planted text; a harness that stopped
// listening would sit out the timeout and fail on the elapsed time instead.

import { test, expect } from '@playwright/test';
import { launchEditor, type Launched } from './launch.ts';

/** Far longer than a report takes to arrive; short enough that a broken harness fails fast too. */
const NEVER = 20_000;
/** A report reaches the harness in well under a second; this is the margin. */
const AT_ONCE = 5_000;

/**
 * Plant a failure, wait on nothing; the wait must end at once. Returns the
 * first report — what the log's `FAIL the app reported:` line and
 * closeEditor's check name as the cause.
 */
async function waitingEndsWith(ed: Launched, plant: () => Promise<unknown>): Promise<string> {
  await expect(ed.page.locator('body')).toBeVisible();
  const t0 = Date.now();
  await plant();
  const err = await expect(ed.page.locator('#this-never-exists')).toBeVisible({ timeout: NEVER })
    .then(() => null, (e: Error) => e);
  const took = Date.now() - t0;
  expect(err, 'the wait failed').not.toBeNull();
  expect(took, 'and it failed at once, not at its timeout').toBeLessThan(AT_ONCE);
  expect(ed.page.isClosed(), 'the window was closed under it').toBe(true);
  expect(ed.errors, 'with the planted failure recorded').toHaveLength(1);
  return ed.errors[0]!;
}

test.describe('a failure the app reports ends the test at once @nodata', () => {
  test('a throw in the renderer', async () => {
    const ed = await launchEditor();
    try {
      const said = await waitingEndsWith(ed, () => ed.page.evaluate(() => {
        setTimeout(() => { throw new Error('planted renderer throw'); }, 0);
      }));
      expect(said).toBe('uncaught: planted renderer throw');
    } finally {
      await ed.app.close();
    }
  });

  test('a rejected promise nobody handled in the renderer', async () => {
    const ed = await launchEditor();
    try {
      const said = await waitingEndsWith(ed, () => ed.page.evaluate(() => {
        void Promise.reject(new Error('planted rejection'));
      }));
      expect(said).toMatch(/^uncaught: .*planted rejection/);
    } finally {
      await ed.app.close();
    }
  });

  test('console.error in the renderer', async () => {
    const ed = await launchEditor();
    try {
      const said = await waitingEndsWith(ed, () => ed.page.evaluate(() => console.error('planted console error')));
      expect(said).toBe('console: planted console error');
    } finally {
      await ed.app.close();
    }
  });

  test('a throw in the main process', async () => {
    const ed = await launchEditor();
    try {
      const said = await waitingEndsWith(ed, () => ed.app.evaluate(() => {
        setTimeout(() => { throw new Error('planted main throw'); }, 0);
      }));
      expect(said).toMatch(/^main: \[main error\] uncaught exception: Error: planted main throw/);
    } finally {
      await ed.app.close();
    }
  });

  test('an allowed failure is recorded and the test goes on', async () => {
    const ed = await launchEditor({}, [], { allow: /planted allowed/ });
    try {
      await ed.page.evaluate(() => console.error('planted allowed error'));
      await expect.poll(() => ed.errors).toEqual(['console: planted allowed error']);
      expect(await ed.page.evaluate(() => 1 + 1), 'the window is still there').toBe(2);
    } finally {
      await ed.app.close();
    }
  });
});

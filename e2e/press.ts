// Pressing a control and waiting for exactly what it started.
//
// A control bound with `onAct` (renderer/core/actions.ts) starts an action in
// the click itself and ends it once, as done, refused or failed, on the
// window's action list. So a press is: click, read the action the click
// started — none is a failure at once, the control is wired to nothing — and
// wait for that action's end, however long its work takes and no longer.
// There is no timeout here to guess: an action has a budget, and going over
// it is a console error, which ends the test at once (e2e/failures.ts).

import type { Locator, Page } from '@playwright/test';
import { openBarMenu } from './bar.ts';

export interface Pressed {
  name: string;
  outcome: 'done' | 'refused' | 'failed';
  ms: number;
  message?: string;
}

export interface PressExpect {
  /** The action must be refused, with a message matching this. */
  refused?: RegExp;
}

interface Event { id: number; name: string; phase: string; ms?: number; message?: string }

/** Click `target` and wait for the action it starts to end; the outcome must be the one expected. */
export async function press(page: Page, target: Locator, want: PressExpect = {}): Promise<Pressed> {
  const from = await page.evaluate(() => window.__actions?.length ?? -1);
  if (from < 0) throw new Error('this window keeps no action list — is the renderer bundle current?');
  await target.click();
  const started = await page.evaluate(
    (n) => window.__actions!.slice(n).find((e) => e.phase === 'start') as Event | undefined, from);
  if (!started) throw new Error(`${target}: the click started no action`);
  const handle = await page.waitForFunction(
    (id) => window.__actions!.find((e) => e.id === id && e.phase !== 'start'),
    started.id, { timeout: 0 },
  );
  const end = await handle.jsonValue() as Event;
  const got: Pressed = { name: end.name, outcome: end.phase as Pressed['outcome'], ms: end.ms ?? 0, ...(end.message ? { message: end.message } : {}) };
  if (want.refused) {
    if (got.outcome !== 'refused') throw new Error(`${got.name}: expected a refusal matching ${want.refused}, but it was ${got.outcome}${got.message ? `: ${got.message}` : ''}`);
    if (!want.refused.test(got.message ?? '')) throw new Error(`${got.name}: refused, but with "${got.message}", not ${want.refused}`);
    return got;
  }
  if (got.outcome !== 'done') throw new Error(`${got.name}: ${got.outcome}${got.message ? ` — ${got.message}` : ''}`);
  return got;
}

/** `press` on a bar control, its menu opened first (e2e/bar.ts). */
export async function pressBar(page: Page, sel: string, want: PressExpect = {}): Promise<Pressed> {
  await openBarMenu(page, sel);
  return press(page, page.locator(sel), want);
}

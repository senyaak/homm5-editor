// The moment the app reports something went wrong, the test fails — with what
// the app said.
//
// A spec checks what it expects to see. When the app breaks on the way there,
// the expected thing simply never appears, and the spec waits out its timeout
// and fails with "timed out waiting for …", minutes later and naming the wrong
// thing. So every launch is watched for the app's own reports of failure, and
// the first one that is not allowed ends the test at once:
//
//   uncaught:  the renderer threw, or a promise in it was rejected unhandled
//   console:   the renderer wrote console.error — the app's own "this failed"
//   main:      the main process threw unhandled or reported a failure
//              ([main error], [failure] — electron/failure.ts, src/failure.ts),
//              the renderer process died ([renderer gone]), or the preload
//              failed ([preload])
//
// Ending it means closing the window with the report as the reason: every
// pending Playwright call in the test rejects with that text. A wait that is
// not a Playwright call (a poll over the HUD or a file) calls throwIfFailed().
//
// A spec that provokes a failure on purpose says so at launch, `allow`, with a
// pattern as narrow as the message it expects. Everything is still recorded in
// `errors`, allowed or not, for the spec to assert on.

import type { ElectronApplication, Page } from '@playwright/test';
import { note } from './trace.ts';

/** The main process's lines that are a failure, by their marker. */
const MAIN_FAILURE = /^\[(main error|failure|renderer gone|preload)\]/;

export interface Watched {
  /** Every report, allowed or not, in order, each prefixed by its source. */
  errors: string[];
  /** The first report that was not allowed, once there is one. */
  failure?: string;
}

const live = new Set<Watched>();

/**
 * Watch one launch. `log` receives the main process's output line by line; a
 * failure line there counts the same as one from the renderer.
 */
export function watchFailures(app: ElectronApplication, page: Page, allow?: RegExp): {
  watched: Watched;
  mainLine: (line: string) => void;
} {
  const watched: Watched = { errors: [] };
  live.add(watched);
  app.on('close', () => live.delete(watched));

  const report = (text: string): void => {
    watched.errors.push(text);
    if (watched.failure || allow?.test(text)) return;
    watched.failure = text;
    note(`FAIL the app reported: ${text}`);
    // Not awaited: the report arrives in an event handler, and the close is
    // what turns every pending call of the test into this message.
    page.close({ reason: `the app reported a failure — ${text}` }).catch(() => {});
  };

  page.on('pageerror', (e) => report(`uncaught: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') report(`console: ${m.text()}`); });
  const mainLine = (line: string): void => { if (MAIN_FAILURE.test(line)) report(`main: ${line}`); };
  return { watched, mainLine };
}

/** For a wait that polls without Playwright: stop it the moment the app failed. */
export function throwIfFailed(): void {
  for (const w of live) if (w.failure) throw new Error(`the app reported a failure — ${w.failure}`);
}

// The one way the renderer reports a failure: where the person is looking, and
// as a console error.
//
// A catch that only writes into a form's error line is seen by whoever happens
// to look at that line, and by nobody else; a catch that only logs is seen by
// nobody. Every catch in the renderer therefore hands the error on, is marked
// `not a failure:`, or comes here (tools/test-silent-catches.ts). The console
// line is what the e2e harness fails a test on at once (e2e/failures.ts), so a
// spec that provokes a failure on purpose allows its text at launch.
//
// What nothing catches — an UnknownFailure thrown on purpose included — lands
// in the trap of renderer/index.html, which shows it whole (#fatal), and the
// harness sees it as an uncaught error.

import { isRefusal, messageOf } from '#src/failure.ts';
import { $ } from './dom.ts';

export { messageOf };

/** What a failure is, as a person reads it: its kind when it has one, and its message. */
const describe = (e: unknown): string =>
  (e instanceof Error && e.name !== 'Error' ? `[${e.name}] ` : '') + messageOf(e);

/**
 * Report a failure: `what` says what was being done, `e` what went wrong.
 * Shown in `line` (a form's error line, by element or id) when given, else on
 * the status line as `error: …`.
 */
export function failed(what: string, e: unknown, line?: HTMLElement | string): void {
  // A refusal is an answer to the person, not a failure: shown the same way,
  // logged as what it is, and not the console error a test fails on.
  if (isRefusal(e)) console.info(`[refused] ${what}: ${messageOf(e)}`);
  else console.error(`${what}: ${describe(e)}`);
  if (line === undefined) $('hud').textContent = `error: ${what}: ${messageOf(e)}`;
  else (typeof line === 'string' ? $(line) : line).textContent = messageOf(e);
}

/** `failed` as a promise's rejection handler: `.catch(failing('loading the list'))`. */
export const failing = (what: string, line?: HTMLElement | string) => (e: unknown): void => failed(what, e, line);

// What a gesture does, as one action that says how it ended.
//
// A test used to tell that a click had done its work by watching the page for
// a side effect, with a timeout chosen by guess: an action that finished at
// once was still waited on, one that never started was waited on longest.
// Now a gesture runs as an action (`act`), and every action reports on one
// stream (`actions$`): it started, then exactly one of
//
//   done      the work finished
//   refused   the app said no by a rule (src/failure.ts Refusal) — an answer
//   failed    the work threw
//
// with how long it took. The stream is what the status line and the e2e
// harness read alike (window.__actions; e2e/press.ts), so a test waits for
// the action's own end, not for a guess.
//
// An action has a BUDGET — how long its work may take — 1 s unless it says
// more, with the reason beside the number. Going over is a console error
// naming the action, which fails a test at once (e2e/failures.ts); the work
// itself goes on, because a slow machine is not a reason to drop what a
// person asked for. Unsubscribing aborts the work's signal.

import { defer, from, Observable, Subject } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { isRefusal, messageOf } from '#src/failure.ts';
import { failed } from './failure.ts';
import { $ } from './dom.ts';

export type Outcome = 'done' | 'refused' | 'failed';

export interface ActionEvent {
  id: number;
  name: string;
  phase: 'start' | Outcome;
  /** Milliseconds from the start, on the end. */
  ms?: number;
  /** What a refusal or a failure said. */
  message?: string;
}

/** Every action's start and end, in order. */
export const actions$ = new Subject<ActionEvent>();

declare global {
  interface Window {
    /** The stream as a list, for the e2e harness to read without a binding. */
    __actions?: ActionEvent[];
  }
}
window.__actions = [];
actions$.subscribe((e) => window.__actions!.push(e));

/** Unless an action says otherwise: a gesture's work is a second at most. */
export const DEFAULT_BUDGET_MS = 1000;

export interface ActOptions {
  /** How long the work may take, in ms. More than the default carries its reason in a comment. */
  budget?: number;
}

let serial = 0;

/**
 * The work as an action: started on subscription, reported on `actions$`,
 * its signal aborted when unsubscribed before it ends.
 */
export function act<T>(name: string, work: (signal: AbortSignal) => Promise<T>, opts: ActOptions = {}): Observable<T> {
  return defer(() => {
    const id = ++serial;
    const budget = opts.budget ?? DEFAULT_BUDGET_MS;
    const started = performance.now();
    const abort = new AbortController();
    let ended = false;
    const over = setTimeout(() => {
      console.error(`${name}: over its budget — still running after ${budget} ms`);
    }, budget);
    const end = (phase: Outcome, message?: string): void => {
      ended = true;
      clearTimeout(over);
      actions$.next({ id, name, phase, ms: Math.round(performance.now() - started), ...(message ? { message } : {}) });
    };
    actions$.next({ id, name, phase: 'start' });
    return from(work(abort.signal)).pipe(
      tap({
        complete: () => end('done'),
        error: (e: unknown) => end(isRefusal(e) ? 'refused' : 'failed', messageOf(e)),
      }),
      finalize(() => {
        if (!ended) { clearTimeout(over); abort.abort(); }
      }),
    );
  });
}

/**
 * Bind a control's click to an action. The action starts in the click itself,
 * so a click that starts nothing is visible at once; its refusal or failure is
 * shown in `line` (the form's error line, or the status line) by `failed`.
 */
export function onAct(
  id: string,
  name: string,
  work: (signal: AbortSignal) => Promise<unknown>,
  opts: ActOptions & { line?: string } = {},
): void {
  $(id).onclick = () => {
    act(name, work, opts).subscribe({ error: (e: unknown) => failed(name, e, opts.line) });
  };
}

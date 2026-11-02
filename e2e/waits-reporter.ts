// Where a run spends its time waiting, said while it runs.
//
// A spec waits on what it expects to see. When the thing comes at once the
// wait is free; when it never comes the wait runs to its timeout — and if that
// timeout is caught and the spec goes on, the run is minutes slower and
// nothing says why. So every Playwright call and every expect is timed here:
//
//   WAIT 12.3s  expect.toBeVisible — e2e/x.spec.ts:123
//       a wait longer than E2E_WAIT_MS (2 s): the run is working, and here is
//       where its time goes;
//   TIMEOUT 15.0s  expect.toBeVisible — e2e/x.spec.ts:123 — and the test went on
//       a wait that ran out its time, caught, the test carrying on after it.
//
// The end of the run lists the longest waits and every timeout the tests went on
// past. A Playwright reporter rather than code in the specs: it sees every call
// of every spec without one line changed in them.

import type { FullResult, Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { relative } from 'node:path';

const WAIT_MS = Number(process.env.E2E_WAIT_MS || 2000);
const KEEP = 15;

/** Only the calls a spec makes itself; a call inside an expect is the expect's. */
const timed = (s: TestStep): boolean =>
  (s.category === 'pw:api' || s.category === 'expect')
  && !(s.parent && (s.parent.category === 'pw:api' || s.parent.category === 'expect'));

const isTimeout = (s: TestStep): boolean => !!s.error && /timeout|timed out|exceeded/i.test(s.error.message ?? '');

interface Wait { ms: number; title: string; at: string; test: string }

export default class WaitsReporter implements Reporter {
  private waits: Wait[] = [];
  private swallowed: Wait[] = [];
  /** Timeouts of the running test, kept until it ends and says whether it went on. */
  private pending = new Map<TestCase, Wait[]>();

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (!timed(step)) return;
    const at = step.location ? `${relative(process.cwd(), step.location.file)}:${step.location.line}` : '?';
    const w: Wait = { ms: step.duration, title: step.title, at, test: test.title };
    if (isTimeout(step)) {
      const list = this.pending.get(test) ?? [];
      list.push(w);
      this.pending.set(test, list);
    }
    if (step.duration >= WAIT_MS) {
      this.waits.push(w);
      console.log(`  WAIT ${(step.duration / 1000).toFixed(1)}s  ${step.title} — ${at}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const timeouts = this.pending.get(test) ?? [];
    this.pending.delete(test);
    // A test that failed on its timeout did not go on; one that passed, or failed
    // on something else after it, did.
    const last = result.status === 'passed' ? null : timeouts.at(-1);
    for (const w of timeouts) {
      if (w === last) continue;
      this.swallowed.push(w);
      console.log(`  TIMEOUT ${(w.ms / 1000).toFixed(1)}s  ${w.title} — ${w.at} — and the test went on`);
    }
  }

  onEnd(_result: FullResult): void {
    if (!this.waits.length && !this.swallowed.length) return;
    const total = this.waits.reduce((n, w) => n + w.ms, 0);
    console.log(`\n[waits] ${this.waits.length} wait(s) over ${WAIT_MS / 1000}s, ${(total / 1000).toFixed(0)}s in all; the longest:`);
    for (const w of [...this.waits].sort((a, b) => b.ms - a.ms).slice(0, KEEP)) {
      console.log(`  ${(w.ms / 1000).toFixed(1).padStart(6)}s  ${w.title} — ${w.at}`);
    }
    if (this.swallowed.length) {
      console.log(`[waits] ${this.swallowed.length} timeout(s) the tests went on past:`);
      for (const w of this.swallowed) console.log(`  ${(w.ms / 1000).toFixed(1).padStart(6)}s  ${w.title} — ${w.at} (${w.test})`);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}

// Saying what the suite is doing, while it is doing it.
//
// A spec that drives the window makes hundreds of gestures inside ONE test, and
// Playwright's reporter prints a line per test — so a run that is working and a
// run that is wedged look identical for minutes at a time, and the only way to
// tell them apart is to wait for the timeout and read the failure. That is the
// hour this file is meant to give back.
//
// It is deliberately not a log of everything. A gesture that behaved says
// nothing; the ones worth printing are:
//
//   SLOW  — it finished, but took longer than a person would call instant, so
//           the run is progressing and this is where the time goes;
//   FAIL  — it threw, named, with how long it waited before it did.
//
// With `E2E_TRACE=1` every gesture prints, which is what you want when a step
// hangs and you need to know which one — the last line before silence IS the
// culprit, and without it there is no way to tell a wedged click from a wedged
// build.

/** How long a gesture may take before it is worth a line. */
const SLOW_MS = Number(process.env.E2E_SLOW_MS || 1000);
/** Print every gesture, not only the slow ones. */
const ALL = !!process.env.E2E_TRACE;

const started = Date.now();
/** Seconds since the suite started — the axis that makes a stall obvious. */
const at = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;

/**
 * Run one gesture under a name.
 *
 * Wrapping rather than logging at the call sites keeps the harness readable and
 * means a helper cannot be traced in one spec and silent in another.
 */
export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  if (ALL) console.log(`  [${at()}] → ${name}`);
  try {
    const out = await run();
    const took = Date.now() - t0;
    if (ALL) console.log(`  [${at()}] ✓ ${name} (${took}ms)`);
    else if (took >= SLOW_MS) console.log(`  [${at()}] SLOW ${name} — ${(took / 1000).toFixed(1)}s`);
    return out;
  } catch (e) {
    // The message Playwright prints on a timeout says which locator gave up; it
    // does not say what the spec was trying to DO, which is the half a person
    // needs to know where to look.
    console.log(`  [${at()}] FAIL ${name} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    throw e;
  }
}

/** A note in the same stream as the gestures, for the phases between them. */
export function note(what: string): void {
  console.log(`  [${at()}] ${what}`);
}

/**
 * Wait for a result, but give up the moment the window says it failed.
 *
 * The shape every install in this suite has: press a button, then watch a note
 * that fills in when it worked and an error box that fills in when it did not.
 * Waiting only on the note means a refusal — a name already taken, a missing
 * donor — is indistinguishable from slow work, and the run spends its whole
 * timeout on an answer the window gave in the first second.
 */
export async function settled(
  page: { locator: (sel: string) => { textContent: () => Promise<string | null> } },
  what: string,
  ok: string,
  err: string,
  timeout = 120_000,
): Promise<string> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const failed = (await page.locator(err).textContent())?.trim();
    if (failed) throw new Error(`${what} failed: ${failed}`);
    const done = (await page.locator(ok).textContent())?.trim();
    if (done) return done;
    if (Date.now() > deadline) throw new Error(`${what}: neither ${ok} nor ${err} said anything in ${timeout}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

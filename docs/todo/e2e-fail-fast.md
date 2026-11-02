# e2e fail fast — a broken step fails at once, never at a timeout

**What.** A spec fails the moment something goes wrong, with what went wrong,
instead of waiting out a timeout on a result that will never appear. Owner's
rule: a failure the harness cannot see is a bug — the app must report it as a
proper error, and any error nobody expected fails the whole test.

1. **Measure.** Done once (2026-11-02, before the harness): 188 tests, 20.5
   min wall; 018 takes 630 s of it, its seven-tier row alone 378 s (21
   creatures built and painted through the window — work, not waiting).
   Still to look at: that row, and 018's "taken apart" (159 s).
2. **The harness.** Done: `e2e/failures.ts`, proven by `e2e/fail-fast.spec.ts`.
   Its first full run caught a failure the suite had passed over: `rmg.spec`
   "the template editor … generated from" opens a generated map whose
   `GroundTerrain.bin` is not there — still to be found.
3. **The app reports every failure.** Pass one done
   ([working/failures.md](../working/failures.md), `test-silent-catches`):
   no catch swallows. Pass two: each `UnknownFailure` (33) gets a kind and a
   message of its own as the runs show where they land.
4. **A guard against bare clicks.** A nodata suite that reads every spec and
   fails on `.click(` outside the harness helpers, with an allowlist of the
   specs not yet moved that may only shrink.
5. **Specs moved to a checked press**: a helper that clicks and asserts the
   gesture's visible outcome; timeouts over 15 s carry their reason or come
   down.

**Source.** [docs/working/e2e.md](../working/e2e.md), [docs/working/testing.md](../working/testing.md)
"A test fails at the moment something goes wrong".

**Acceptance.** `e2e/fail-fast.spec.ts` green and each case sabotaged once;
the full `test-e2e-fast` green with the harness on; the guard suite in
`npm test`; the measured run time before and after written here or in the PR.

**Depends on.** none.

// Playwright config for the end-to-end suite.
//
// These tests drive the REAL Electron app (via _electron.launch) — the same
// binary `npm start` runs — so they exercise the whole stack a user touches:
// renderer -> preload -> IPC -> main -> core. That is the layer the unit tests
// (tools/test-*) deliberately do not reach. See docs/E2E_RECONSTRUCTION.md.
//
// Serial, single worker: each test owns a live Electron process, and the tests
// share on-disk project state (a New Map, a Pack), so they must not interleave.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // The C1M1 reconstruction is NOT part of the ordinary suite. It is a
  // different kind of test — a release gate that rebuilds a whole shipped
  // campaign mission, minutes of work over an extracted fixture, measuring the
  // editor's completeness rather than guarding a change. So a bare
  // `playwright test` never picks it up; `npm run test-e2e` (tools/e2e-full.ts)
  // sets PW_C1M1 and runs everything, which is what a release is gated on.
  testIgnore: process.env.PW_C1M1 ? [] : ['**/c1m1/**'],
  // The app loads a BUILT renderer bundle; without this the suite tests
  // whatever app.js was last left on disk. See e2e/build.ts.
  globalSetup: './e2e/build.ts',
  fullyParallel: false,
  workers: 1,
  // A cold Electron launch plus a map load is well over the default 30s on a
  // first run; give each test room without hiding a genuine hang.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // STOP AT THE FIRST FAILURE. The suite is serial and every test drives the
  // same app over the same on-disk state, so once one has failed the rest are
  // running against a world nobody planned: what they report afterwards is
  // noise, and a person watching has to sit through it to reach the one message
  // that mattered. `PW_ALL=1` runs the whole thing anyway, for the sweep after a
  // fix; `--max-failures=N` on the command line beats both.
  maxFailures: process.env.PW_ALL ? 0 : 1,
  reporter: [['list']],
  // Artifacts (screenshots, traces) land under test-results/, which is ignored.
  outputDir: 'test-results',
});

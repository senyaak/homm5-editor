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
  fullyParallel: false,
  workers: 1,
  // A cold Electron launch plus a map load is well over the default 30s on a
  // first run; give each test room without hiding a genuine hang.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  // Artifacts (screenshots, traces) land under test-results/, which is ignored.
  outputDir: 'test-results',
});

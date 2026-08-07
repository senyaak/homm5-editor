// The ordinary run: every e2e spec except the C1M1 reconstruction.
//
//   npm run test-e2e-fast                       — all of it
//   npm run test-e2e-fast -- e2e/smoke.spec.ts   — one spec
//
// A thin runner rather than `playwright test` itself, for one reason: the whole
// output goes to a file as well as to the screen, and the exit status is
// Playwright's (tools/e2e-log.ts). `npx playwright test` still works and is
// still the right thing when you are watching it happen.

import { runPlaywright } from './e2e-log.ts';

process.exit(await runPlaywright(process.argv.slice(2), {}, 'fast'));

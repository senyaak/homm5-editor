// The release gate: every e2e spec INCLUDING the C1M1 reconstruction.
//
//   npm run test-e2e            — everything, c1m1 and all
//   node tools/e2e-full.ts e2e/c1m1   — the reconstruction alone
//
// The reconstruction is a different kind of test — it rebuilds a whole shipped
// campaign mission over an extracted fixture, minutes of work that measure the
// editor's completeness rather than guard a change — so the playwright config
// ignores it unless PW_C1M1 is set, and this thin runner owns that switch the
// same way tools/e2e-live.ts owns HOMM5_NO_REMOVE. An ordinary run is
// `npm run test-e2e-fast` (or plain `npx playwright test`), and neither will
// ever wander into the reconstruction by accident again.
//
// The output is teed to a file whole (tools/e2e-log.ts): a fifteen-minute run's
// answer is not something to read once as it scrolls past.

import { runPlaywright } from './e2e-log.ts';

process.exit(await runPlaywright(process.argv.slice(2), { PW_C1M1: '1' }, 'full'));

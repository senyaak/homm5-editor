// Run the C1M1 capstone — verify the finished reconstruction and pack it.
//
//   node tools/pack-c1m1.ts [--noRemoveMap]
//
// Playwright rejects unknown CLI flags, so this thin runner owns the flag: it
// translates --noRemoveMap into the HOMM5_NO_REMOVE_MAP the spec reads, then
// hands off to Playwright. With the flag the playable .h5m is packed into the
// game's Maps/ and left there; without it the pack goes under the test data
// root and is cleaned up (see e2e/c1m1/014-pack.spec.ts).

import { spawnSync } from 'node:child_process';

const keep = process.argv.slice(2).includes('--noRemoveMap');
const env = { ...process.env };
if (keep) env.HOMM5_NO_REMOVE_MAP = '1';

const r = spawnSync('npx', ['playwright', 'test', 'e2e/c1m1/014-pack.spec.ts'], {
  stdio: 'inherit',
  env,
  shell: true,
});
process.exit(r.status ?? 1);

// Run e2e specs against the REAL install and leave everything they make.
//
//   node tools/e2e-live.ts e2e/mod-003-artifacts-create.spec.ts
//   node tools/e2e-live.ts e2e/mod-001-units-create.spec.ts e2e/mod-007-sharpshooter/
//   npm run e2e-live -- e2e/mod-003-artifacts-create.spec.ts
//
// Not called `test-…`: `npm test` runs every script with that prefix as a
// suite, and this one needs arguments — it is a runner, not a suite.
//
// An ordinary run gives every mod spec a throwaway install under `_tmp`: an
// executable with the shipped ceilings, an empty mod folder, deleted when the
// run ends. That is what makes the suite say something about the code rather
// than about this machine — and it also means a run leaves nothing you can
// play.
//
// This is the other mode. The specs work in the install this checkout sits in,
// and nothing is swept up: the patched executable, `H5E/homm5-editor.h5u` and
// any map a spec packed stay where the game reads them. What you get is what
// clicking the same buttons by hand would have got you.
//
// It is not a wrecking ball. A live run first takes OUR things back out of the
// installed mod so the spec authors them from nothing, and leaves everything
// else in the archive alone — there are dwellings in there that no dialog can
// author again. See LIVE in e2e/mods.ts.
//
// Playwright rejects flags it does not know, which is why this thin runner owns
// the switch, the same way tools/pack-c1m1.ts owns --noRemoveMap for the C1M1
// capstone's map.

import { spawnSync } from 'node:child_process';

const specs = process.argv.slice(2).filter((a) => a !== '--noRemove');
if (!specs.length) {
  console.error('usage: node tools/e2e-live.ts <spec…>   (e.g. e2e/mod-003-artifacts-create.spec.ts)');
  process.exit(2);
}

console.log(`live run — the real install, nothing removed:\n  ${specs.join('\n  ')}\n`);
const r = spawnSync('npx', ['playwright', 'test', ...specs], {
  stdio: 'inherit',
  env: { ...process.env, HOMM5_NO_REMOVE: '1' },
  shell: true,
});
process.exit(r.status ?? 1);

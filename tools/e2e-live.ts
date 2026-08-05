// Run e2e specs against the REAL install and leave everything they make.
//
//   node tools/e2e-live.ts e2e/mod-003-artifacts-create.spec.ts
//   node tools/e2e-live.ts e2e/mod-001-units-create.spec.ts e2e/mod-007-sharpshooter/
//   node tools/e2e-live.ts --all          every spec, the way an ordinary run does
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

// `--all` passes NO filter on, which is not the same as passing `e2e/`. The
// suite's global setup has only this command line to read, and it puts the mod
// chain back to its start for a run that could contain it — no filter means the
// whole suite and it does; `e2e/` is the same set of specs and says so nowhere.
// The bare form still refuses: running every spec against somebody's install is
// a thing to say out loud, not to reach by forgetting an argument.
const args = process.argv.slice(2).filter((a) => a !== '--noRemove');
const all = args.includes('--all');
const specs = args.filter((a) => a !== '--all');
if (!all && !specs.length) {
  console.error('usage: node tools/e2e-live.ts <spec…>   (e.g. e2e/mod-003-artifacts-create.spec.ts)');
  console.error('       node tools/e2e-live.ts --all     every spec, C1M1 aside');
  process.exit(2);
}
if (all && specs.length) {
  console.error('--all is every spec; naming some as well says two different things');
  process.exit(2);
}

console.log(all
  ? 'live run — the real install, nothing removed: every spec (C1M1 aside)\n'
  : `live run — the real install, nothing removed:\n  ${specs.join('\n  ')}\n`);
const r = spawnSync('npx', ['playwright', 'test', ...specs], {
  stdio: 'inherit',
  env: { ...process.env, HOMM5_NO_REMOVE: '1' },
  shell: true,
});
process.exit(r.status ?? 1);

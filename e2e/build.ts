// Build the renderer bundle before the e2e suite runs.
//
// Electron loads renderer/app.js, which esbuild produces from renderer/app.ts.
// Nothing rebuilt it for a test run, so the suite silently exercised whatever
// bundle happened to be on disk — an edit to app.ts would be invisible, and a
// test written against it would fail for a reason that has nothing to do with
// the code being tested. Cost is a fraction of a second per run.

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { buildRenderer } from '../tools/build-renderer.ts';
import { modDir } from '../src/mod-paths.ts';
import { hasFixture, NEED_FIXTURE, ALLOW_NO_FIXTURE } from './c1m1/shared.ts';
import { E2E_GAME, REPO_ROOT } from './launch.ts';
import { clearFixture, LIVE, REAL_GAME } from './mods.ts';

export default async function build(): Promise<void> {
  await buildRenderer();

  // A run starts with an empty install. A map is a file now, and the app refuses
  // to write over one — so an archive left by the last run makes New Map fail in
  // the next, in a spec that has nothing to do with it. Only ever the suite's
  // own throwaway install: a real one handed over in HOMM5_ROOT is left alone.
  if (E2E_GAME.startsWith(join(REPO_ROOT, '_tmp'))) {
    rmSync(modDir(E2E_GAME), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // A LIVE run works in the real install (tools/e2e-live.ts), and it starts the
  // way a fresh one does: our creature, its dwelling, the artifacts and the set
  // come out of the installed mod, and the specs put them back as they run.
  //
  // ONCE, here, and not in each spec — creatures and artifacts share one
  // archive, so a spec that cleared before its own work would undo the one that
  // ran before it. Everything else in the archive is left standing: there are
  // dwellings in there that no dialog can author again.
  if (LIVE) {
    clearFixture(REAL_GAME);
    console.warn(`\n[e2e] live run — working in ${REAL_GAME}; the fixtures were cleared`
      + ' and the specs will rebuild them. Nothing is removed at the end.\n');
  }

  // One place that says it out loud: the C1M1 reconstruction stages read files
  // the mod ships, unpacked once by `npm run extract-fixture C1M1`. Without that
  // tree those stages fail by design (a silent skip reads as a pass); this note
  // tells you why before the failures scroll by, and how to opt into skipping.
  if (!hasFixture()) {
    const skipping = !!process.env[ALLOW_NO_FIXTURE];
    console.warn(
      `\n[e2e] no C1M1 fixture — ${NEED_FIXTURE}\n` +
      (skipping
        ? `[e2e] ${ALLOW_NO_FIXTURE} is set: the C1M1 reconstruction stages will skip.\n`
        : `[e2e] the C1M1 reconstruction stages will FAIL; set ${ALLOW_NO_FIXTURE}=1 to skip them instead.\n`),
    );
  }
}

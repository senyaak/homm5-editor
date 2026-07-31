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
import { modDir } from '../src/game/mod-paths.ts';
import { hasFixture, NEED_FIXTURE, ALLOW_NO_FIXTURE } from './c1m1/shared.ts';
import { E2E_GAME, REPO_ROOT } from './launch.ts';
import { LIVE, openModGameRoot, REAL_GAME } from './mods.ts';

export default async function build(): Promise<void> {
  await buildRenderer();

  // A run starts with an empty install. A map is a file now, and the app refuses
  // to write over one — so an archive left by the last run makes New Map fail in
  // the next, in a spec that has nothing to do with it. Only ever the suite's
  // own throwaway install: a real one handed over in HOMM5_ROOT is left alone.
  if (E2E_GAME.startsWith(join(REPO_ROOT, '_tmp'))) {
    rmSync(modDir(E2E_GAME), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // The mod stages share ONE install and run as a chain — the creature, its
  // paint, the artifacts, then a map made of all of it — so the install is put
  // into its starting state HERE, once, and never by a spec: they would each be
  // undoing the one before. Isolated that is a sandbox reset to a game no mod
  // has touched; live it is the real install with our own things taken back out
  // of it, everything else left standing (there are dwellings in there no
  // dialog can author again).
  await openModGameRoot();
  if (LIVE) {
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

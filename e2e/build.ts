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
import { checkDeclared, clearAll } from './artifacts.ts';
import { hasFixture, NEED_FIXTURE, ALLOW_NO_FIXTURE } from './c1m1/shared.ts';
import { E2E_GAME, REPO_ROOT } from './launch.ts';
import { LIVE, openModGameRoot, REAL_GAME } from './mods.ts';

export default async function build(): Promise<void> {
  await buildRenderer();

  // A run starts clean. A map is a file now and the app refuses to write over
  // one, so an archive left by the last run makes New Map fail in the next, in a
  // spec that has nothing to do with it.
  //
  // The suite's own throwaway install goes wholesale — nothing in it is anyone
  // else's. A REAL one handed over in HOMM5_ROOT is a player's folder, so only
  // what the suite makes comes out of it, by name: see e2e/artifacts.ts, which
  // also refuses to start a run that makes a name it has not been told about.
  checkDeclared();
  if (E2E_GAME.startsWith(join(REPO_ROOT, '_tmp'))) {
    rmSync(modDir(E2E_GAME), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  const gone = clearAll();
  if (gone.length) {
    console.warn(`\n[e2e] cleared ${gone.length} thing(s) the last run left:\n  ${gone.join('\n  ')}\n`);
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
  // Only when the reconstruction is actually in this run (PW_C1M1, the release
  // gate) — an ordinary run never reaches those stages, so the note would be
  // noise about a suite that is not running.
  if (process.env.PW_C1M1 && !hasFixture()) {
    const skipping = !!process.env[ALLOW_NO_FIXTURE];
    console.warn(
      `\n[e2e] no C1M1 fixture — ${NEED_FIXTURE}\n` +
      (skipping
        ? `[e2e] ${ALLOW_NO_FIXTURE} is set: the C1M1 reconstruction stages will skip.\n`
        : `[e2e] the C1M1 reconstruction stages will FAIL; set ${ALLOW_NO_FIXTURE}=1 to skip them instead.\n`),
    );
  }
}

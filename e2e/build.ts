// Build the renderer bundle before the e2e suite runs.
//
// Electron loads renderer/app.js, which esbuild produces from renderer/app.ts.
// Nothing rebuilt it for a test run, so the suite silently exercised whatever
// bundle happened to be on disk — an edit to app.ts would be invisible, and a
// test written against it would fail for a reason that has nothing to do with
// the code being tested. Cost is a fraction of a second per run.

import { existsSync, readdirSync, rmSync } from 'node:fs';
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
  // the next, in a spec that has nothing to do with it.
  if (E2E_GAME.startsWith(join(REPO_ROOT, '_tmp'))) {
    rmSync(modDir(E2E_GAME), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } else {
    // A REAL install, handed over in HOMM5_ROOT: the folder is the player's, so
    // the run takes out only what the suite itself makes. Every name it uses
    // begins with `e2e `, which is the guard the specs' own cleanups already
    // rest on — "a name no real map would have".
    //
    // AND IT SAYS SO. A run that is killed part-way — the first failure stops
    // the rest, and Playwright does not finish the cleanups of the specs that
    // had already passed — leaves those files behind, and the next run then
    // fails in whichever spec happens to want that name, reporting "already
    // exists" about something the person watching never asked for. This turns
    // that into one line at the start, before any test has run.
    const dir = modDir(E2E_GAME);
    const left = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('e2e ')) : [];
    for (const f of left) {
      rmSync(join(dir, f), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    if (left.length) {
      console.warn(`\n[e2e] AN EARLIER RUN DID NOT FINISH — it left ${left.length} of its own`
        + ` files in ${dir}, and they have been removed:\n  ${left.join('\n  ')}\n`);
    }
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

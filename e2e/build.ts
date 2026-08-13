// Build the renderer bundle before the e2e suite runs.
//
// Electron loads renderer/app.js, which esbuild produces from renderer/app.ts.
// Nothing rebuilt it for a test run, so the suite silently exercised whatever
// bundle happened to be on disk — an edit to app.ts would be invisible, and a
// test written against it would fail for a reason that has nothing to do with
// the code being tested. Cost is a fraction of a second per run.

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { buildRenderer } from '../tools/build-renderer.ts';
import { modDir } from '../src/game/mod-paths.ts';
import { checkDeclared, clearAll } from './artifacts.ts';
import { hasFixture, NEED_FIXTURE, ALLOW_NO_FIXTURE } from './c1m1/shared.ts';
import { E2E_GAME, REPO_ROOT } from './launch.ts';
import { LIVE, openModGameRoot, REAL_GAME } from './mods.ts';

/**
 * Could a mod stage be in this run?
 *
 * Playwright hands a global setup the config and nothing else — the setup runs
 * BEFORE the tests are collected, so there is no list of files to ask. What
 * there is, is the command that asked for them: `playwright test <filter…>`,
 * still sitting in this process's own arguments.
 *
 * The rule is deliberately generous. A filter that names no file at all is the
 * whole suite, and the whole suite has the chain in it; anything mentioning
 * `mod-` is a stage of it. Only a run that names files and none of them a mod
 * stage is treated as unrelated — which is the case that must not pay for the
 * chain's reset, and the only one worth being sure about.
 *
 * A filter can also name a FOLDER, and then the string says nothing: `e2e/` is
 * every spec there is and mentions no stage by name. Read from disk instead of
 * from the argument. Guessing from the string cost a live run — the chain was
 * not put back to its start, and mod-001 failed on finding last week's creature
 * still installed, 93 specs from the end of a 6-minute run.
 */
function specUnder(filter: string, part: string): boolean {
  const at = join(REPO_ROOT, filter);
  if (!existsSync(at) || !statSync(at).isDirectory()) return false;
  return readdirSync(at, { recursive: true })
    .some((e) => { const s = String(e); return s.includes(part) && s.endsWith('.spec.ts'); });
}

const modSpecsUnder = (filter: string): boolean => specUnder(filter, 'mod-');

/** What the command line asked for, switches and stray words dropped. */
function filtersIn(argv: readonly string[]): string[] {
  return argv.filter((a) => !a.startsWith('-')
    && (a.includes('spec') || a.includes('e2e') || a.includes('mod-') || a.includes('c1m1')));
}

export function runHasModStages(argv: readonly string[] = process.argv.slice(2)): boolean {
  const filters = filtersIn(argv);
  return filters.length === 0 || filters.some((f) => f.includes('mod-') || modSpecsUnder(f));
}

/**
 * The stage that authors the mod from NOTHING, and the only one a reset is for.
 *
 * Named by its file so a rename is caught here rather than by a live run: it is
 * the first link of the chain, the one whose dialog has to open with no creature
 * of ours already installed.
 */
const CHAIN_START = '001-mod-units-create';

/**
 * Does this run START the mod chain?
 *
 * A different question from "has a mod stage in it", and the difference is what
 * a live run costs. Every stage after the first BUILDS ON the archive: the map
 * stages place the creature, the artifacts and the dwellings the stages before
 * them authored. Taking the archive away in front of one of those does not put
 * it back to a starting state — it deletes forty megabytes of authored content
 * that the run will not rebuild, and leaves maps naming things no longer there.
 *
 * That is what running one stage live did, over and over: `H5E/homm5-editor.h5u`
 * gone every time, restored by hand from MOD_BACKUP (Senya, 13.08.2026 —
 * "стой! это баг!"). It is only right when the chain's own first stage is in the
 * run, or when nothing was named at all and the run is therefore the whole
 * suite, chain and all.
 *
 * Live only. In the throwaway install a reset costs nothing and the sandbox has
 * to exist before any stage can work in it, so there `runHasModStages` still
 * decides.
 */
export function runStartsTheModChain(argv: readonly string[] = process.argv.slice(2)): boolean {
  const filters = filtersIn(argv);
  return filters.length === 0
    || filters.some((f) => f.includes(CHAIN_START) || specUnder(f, CHAIN_START));
}

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
  //
  // ONLY FOR A RUN THAT HAS A MOD STAGE IN IT. This is a global setup, so it
  // ran for every run — and live, "put the chain back to its start" means
  // taking the authored content out of the player's installed mod, which the
  // chain then spends four minutes rebuilding. A run of one unrelated spec paid
  // that price and left the install with maps referring to content that was no
  // longer there: the game loaded them and died. So the runner's own arguments
  // decide. No file named means the whole suite, which has the chain in it.
  //
  // AND LIVE, THE ARCHIVE ONLY GOES WHEN THE CHAIN'S FIRST STAGE IS RUNNING.
  // Every later stage builds ON the archive rather than starting it, so the
  // reset in front of one of those deleted the installed mod and rebuilt none of
  // it — see runStartsTheModChain above. The sandbox still gets prepared for any
  // stage: it has to exist before a stage can work in it, and nothing in it is
  // anybody's.
  const startsChain = runStartsTheModChain();
  if (runHasModStages()) {
    await openModGameRoot(startsChain);
    if (LIVE) {
      console.warn(startsChain
        ? `\n[e2e] live run — working in ${REAL_GAME}; the fixtures were cleared`
          + ' and the specs will rebuild them. Nothing is removed at the end.\n'
        : `\n[e2e] live run — working in ${REAL_GAME}. This run does not start the mod`
          + ' chain, so the installed mod is left exactly as it is.\n');
    }
  } else if (LIVE) {
    console.warn(`\n[e2e] live run — working in ${REAL_GAME}. No mod stage in this run,`
      + ' so the installed mod is left exactly as it is.\n');
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

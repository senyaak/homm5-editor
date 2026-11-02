# Testing

How the suites are run, what to run, and what a test must do. Writing e2e
specs: [e2e.md](e2e.md).

## Running

Always say where the game is — nothing guesses it:

```bash
export HOMM5_GAME="C:/Games/Steam/steamapps/common/Heroes of Might and Magic 5 Tribes of the East"
```

Without it `test-heroes`, `test-controller-slots`, `test-exe-import` and every
e2e spec fail with "nobody said where the game is" — not a real failure.
`--game <dir>` on a command line works too. `HOMM5_ROOT` alone makes the e2e
work IN that install instead of a copy; for ordinary runs use `HOMM5_GAME`.

```bash
npm test                 # every test-* suite, including test-e2e-fast (~6 min)
npm run test-nodata      # one level: the checkout alone
npm run test-data        # ... plus the unpacked data
npm run test-game        # ... plus a real install
npm run test-rmg         # the generator's suites
node tools/test-all.ts --level game --list   # what a level would run
npm run test-e2e         # release gate: npm test + the C1M1 reconstruction
node tools/test-spell-mod.ts                 # one suite
npm run test-e2e-fast -- e2e/smoke.spec.ts   # one spec
```

- A unit suite declares its level in a line near the top: `// needs: data` or
  `// needs: game`; none = nodata. An e2e test: `{ tag: '@game' }`, or
  `@nodata` in the title. A suite that skips itself for want of the game is
  missing that line.
- `test-heroes` takes the data directory as a POSITIONAL argument; give it
  nothing or a data directory, never `--game`.
- A failed `npm test` names its log (`_tmp/e2e-logs/fast-<stamp>.log`): read
  the log's `Error:` lines and final counts, not the table.
- Never pipe a run through `| tail` / `| grep`: the output keeps only what
  passed the pipe.
- Never run `npm test` beside a separate playwright run: they share sandboxes.

## What to run

- Tests you wrote or changed: at once, without asking; report the result.
- Other tests: not, unless the change is in something shared (mod format, IPC
  contract, builders) or it is a release.
- A failure in a suite you did not touch: re-run that suite alone before
  believing it — flakes exist.
- Before a release: `npm test` and `npm run test-e2e` with `PW_ALL=1`; any red,
  on topic or not, blocks the release.
- The C1M1 reconstruction: only before a release or when the change is in it.
- Instead of launching the game: `node tools/test-native-anchors.ts` (every
  address the extension recognises, read from the executable on disk) and
  `node tools/test-fixes.ts` (the hand-assembled stubs).

## What a test must do

- An answer found with a one-off command goes into a test in the same commit,
  behind a cheap door: a `test-*` script, not only behind an e2e `beforeAll`.
  Put the pure half in a module both can call.
- Every new test or metric is sabotaged once: break the line it guards, run
  with a time limit, see it go red, restore. A hang is a finding, not a pass;
  suites keep a watchdog that prints "hung" and exits non-zero.
- Back up before sabotage through git (`git checkout --` after) or into the
  session scratchpad under a telling name — never a short name in a shared
  `/tmp`, never `&&` before the backup.
- Check what is required, not a weaker aggregate (each cut and its ends, not
  "number of pieces"). Never import the definition under test from the code
  under test.
- An exemption ("identical except X") is a claim: prove it, and print its
  price on every run (`hole … N of M differ`).
- A verdict from an earlier session is a hypothesis; re-check it before
  relying on it, especially when it closes work.
- Fixtures come from the second or third element of a series, and invented
  numbers are all different — so a swapped id, index or count shows.
- Run a rule over the whole set available, not over one witness.
- A fix that restores something is measured with the fix OFF as well. Count
  outcomes in separate counters.
- A rule only the game could run is written in TypeScript and tested against a
  model of the engine that exposes only what a script can see.
- A test fails at the moment something goes wrong, never by waiting out a
  timeout: assert each step's outcome as soon as it happens. A tool that
  crashed is an error, not "no differences".
- A magic number in a test sits beside its reason, or it gets lowered.

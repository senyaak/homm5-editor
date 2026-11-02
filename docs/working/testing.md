# Testing

How the suites are run, what to run for a change, and what makes a test worth
having. The e2e side has its own page, [e2e.md](e2e.md).

## Say where the game is. Every time.

```bash
export HOMM5_GAME="C:/Games/Steam/steamapps/common/Heroes of Might and Magic 5 Tribes of the East"
```

Nothing guesses it. `tools/game-dir.ts` used to fall back to the checkout's
parent and a worktree made that a lie, so the answer is only ever SAID —
`--game <dir>` on a command line, or `HOMM5_GAME` / `HOMM5_ROOT` in the
environment (both names work; two halves of the repo grew their own).
`HOMM5_ROOT` alone points the e2e at that install itself rather than at a copy
of it, so for an ordinary run say `HOMM5_GAME`.

Forget it and **four suites fail for a reason that is not about the change**:
`test-heroes`, `test-controller-slots`, `test-exe-import` and every e2e spec,
each saying some version of "nobody said where the game is". That looks exactly
like a real failure and costs a bisect to find out it is not (08.08.2026).

## The commands

```bash
npm test                 # every test-* suite, including test-e2e-fast
npm run test-nodata      # one level: the checkout alone
npm run test-data        # ... plus the unpacked data
npm run test-game        # ... plus a real install
npm run test-rmg         # the generator's suites (--only rmg-)
node tools/test-all.ts --level game --list   # what a level would run, nothing run
npm run test-e2e         # the release gate: npm test plus the C1M1 reconstruction
```

`npm test` is about six minutes, most of it the e2e half, and it is what "all
the tests" means here. `test-e2e-fast` is the whole e2e set except
`e2e/c1m1/**`.

Every suite says what it needs, and the runs are cut by that. A unit suite
carries one line near its top — `// needs: data` or `// needs: game`, none
means nodata; an e2e test carries the tag (`{ tag: '@game' }`, or `@nodata` in
its title). The aggregator reads the line and keeps no list, so a new suite
without the line runs at nodata, and a suite that then skips itself for want of
the game is a missing line.

One suite:

```bash
node tools/test-spell-mod.ts               # most read HOMM5_GAME from the environment
node tools/test-spell-mod.ts --game ..     # or say it here
npm run test-e2e-fast -- e2e/smoke.spec.ts # one e2e spec
```

**`test-heroes` is the exception**: it takes the unpacked-data directory as a
POSITIONAL argument, so `--game ..` is read as that directory and the suite
skips itself with "no unpacked data at ..". Give it nothing, or a data
directory.

## Reading a failure

`npm test` prints a one-line-per-suite table at the end. The e2e half tees its
whole output to a file and says so:

```
[e2e] FAILED — the whole output is in _tmp/e2e-logs/fast-<timestamp>.log
```

Read that log, not the table: its useful lines are `Error:` and the
`N failed / N passed` at the end. **Never pipe a run through `| tail` or
`| grep`** — the file keeps only what got through the pipe, and twice in one
day the list of failed suites was lost that way and everything ran again to
learn "which".

A failure in a suite the change did not touch is re-run ON ITS OWN before it
is believed: flakes exist (`fill.spec`'s density preview under load), and so
do failures that are not about the change.

## What to run

- **The tests you wrote or changed in this change: at once, without asking,
  and report the result.** A test left "written, not run" is not done.
- **Not the rest.** A full run "just in case" says nothing new: on a local
  change it is either green or red on someone else's flake. The whole set is
  for a change in something shared (the mod format, the IPC contract, the
  builder) and before a release.
- **Before a release, everything**: `npm test` and `npm run test-e2e`, with
  `PW_ALL=1` so `maxFailures: 1` does not stop the run at the first failure. A
  failure off the change's topic still blocks the release — the runner's
  environment (an empty data root, no `Editor/`, a cold cache) is not this
  machine's.
- **The C1M1 reconstruction never, except before a release** or when the
  change is in the reconstruction itself. It is an acceptance test, not a
  regression test, and costs 15–40 minutes.
- `npm test` contains the e2e scripts: never run it beside a separate
  playwright run, they fight over the sandboxes.

The one that stands in for launching the game is
`node tools/test-native-anchors.ts` — it reads every address the extension
recognises by its bytes out of the executable on disk. `tools/test-fixes.ts`
does the same for the hand-assembled stubs: whole instructions, jumps landing
on instruction boundaries, and the installer's patch offsets inside one
instruction each. Both take seconds, and both catch what would otherwise cost
a launch.

## What makes a test worth having

- **A check made in a console is not a check.** If a question was answered by
  a one-off `node -e …`, it goes into a test in the same commit; the next
  person to change the data will not get that look. And the test needs a cheap
  door: `npm test` picks up any `test-*` script, while a check that lives only
  behind a playwright `beforeAll` that raises Electron and needs an install is
  a check nobody runs — put the pure half in a module both can call.
- **Break it on purpose before believing it.** A new test or metric is
  sabotaged once — break the line it guards, run it **with a time limit**,
  restore — and must go red. Green means nothing until it has shown it can
  fail. A sabotaged run that HANGS has not gone red, it has gone mute, and that
  is a finding; suites keep a watchdog that prints "hung" and exits non-zero.
  Back the file up through git (commit first, `git checkout --` after) or into
  the session scratchpad under a telling name — never `cp x /tmp/r.bak` with
  `&&` before it: a failed copy and a successful restore once poured a stranger
  file into the source.
- **A metric weaker than the requirement passes sabotage and is still blind.**
  "Number of road pieces on the map" went red when the fix was off, and still
  said nothing about a road cut in two by a town, joined up again at the far
  end. Check what is required — each cut, its own ends — and never import the
  definition under test from the implementation.
- **An exemption is a claim.** "Byte-identical except X" says X is not ours,
  or not deterministic, and that has to be proven like anything else. An
  exemption prints its price on every run (`hole … N of M differ`); a silent
  one reads as "done" a month later. A verdict from an earlier session is a
  hypothesis with a history, not a fact.
- **The first case of a series hides the bug.** In the first request, row or
  frame every counter is 1, so an id, an index and a count are
  interchangeable and a swapped field looks right. Take fixtures from the
  second or third element; make invented numbers all different.
- **The whole set, not one witness.** Three reference runs were green and a
  run over all 22 templates showed four matching; a rule seen on one witness is
  not checked.
- **A fix that restores something is measured with the fix OFF.** With it on,
  "nothing was happening" and "we put it back" look the same. Count outcomes
  in separate counters, so one boring outcome cannot eat a shared cap.
- **A rule only the game can run is written in TypeScript and run against a
  model of the engine** that hands the rule only what a script can see (the
  sharpshooter training: 16 000 armies a second against `ArmyView`, where the
  game would have cost a launch per bug).
- **Fail at once, never at a timeout.** A test that waits on something that
  cannot come spends its whole timeout saying nothing. Assert what each step
  did as soon as it did it (e2e: [e2e.md](e2e.md)); a tool that crashed is not
  "no differences" — tell "exit 1 with a report" from "died without one".
- **Constants with their reason.** A magic number in a test sits beside why
  (`LOG_READ_ARMY = 500` — the rounds are the instrument), or somebody lowers
  it "to make it faster".

# Working on this repo

## Running the tests — always the same two things

**1. Say where the game is. Every time.**

```bash
export HOMM5_GAME="C:/Games/Steam/steamapps/common/Heroes of Might and Magic 5 Tribes of the East"
```

Nothing guesses it. `tools/game-dir.ts` used to fall back to the checkout's
parent and a worktree made that a lie, so the answer is only ever SAID —
`--game <dir>` on a command line, or `HOMM5_GAME` / `HOMM5_ROOT` in the
environment (both names work; two halves of the repo grew their own).

Forget it and **four suites fail for a reason that is not about the change**:
`test-heroes`, `test-controller-slots`, `test-exe-import` and every e2e spec,
each saying some version of "nobody said where the game is". That looks exactly
like a real failure and costs a bisect to find out it is not. Measured
08.08.2026.

**2. Then one command.**

```bash
npm test
```

That is every `test-*` suite in `package.json` — **including `test-e2e-fast`**,
which is the whole e2e set except the C1M1 reconstruction. It takes about six
minutes, most of it the e2e half. This is the ordinary run and it is what
"all the tests" means here.

The release gate is `npm run test-e2e` — the same plus the C1M1
reconstruction, which rebuilds a whole shipped campaign mission and takes
fifteen minutes. Run it before a tag or a publish, and not otherwise.

## Reading a failure

`npm test` prints a one-line-per-suite table at the end. The e2e half tees its
whole output to a file and says so:

```
[e2e] FAILED — the whole output is in _tmp/e2e-logs/fast-<timestamp>.log
```

Read that log, not the table. Its useful lines are `Error:` and the
`N failed / N passed` at the end.

## Running one suite

```bash
node tools/test-spell-mod.ts               # most read HOMM5_GAME from the environment
node tools/test-spell-mod.ts --game ..     # or say it here
npm run test-e2e-fast -- e2e/smoke.spec.ts # one e2e spec
```

**`test-heroes` is the exception**: it takes the unpacked-data directory as a
POSITIONAL argument, so `--game ..` is read as that directory and the suite
skips itself with "no unpacked data at ..". Give it nothing, or give it a data
directory.

## What to run for a change

Run the suite for the thing you touched, and the whole set only when you
touched something shared. A failure in somebody else's suite is worth
re-running on its own before believing it.

The one that stands in for launching the game is
`node tools/test-native-anchors.ts` — it reads every address the extension
recognises by its bytes out of the executable on disk. `tools/test-fixes.ts`
does the same for the hand-assembled stubs: whole instructions, jumps landing
on instruction boundaries, and the installer's patch offsets inside one
instruction each. Both are seconds, and both catch things that would otherwise
cost a launch.

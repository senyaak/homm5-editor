---
owner: senyaak
base: main
repos: [senyaak/homm5-editor]
kinds: [read, build, test, bug]
---

# This project's fleet

What the shared roles in `.claude/agents/` and `.claude/fleet/` need to know
about homm5-editor. They cite it as `project.md § <section>`. The shared part
is a pinned version of `senyaak/claude-fleet`
([../../.claude/fleet/README.md](../../.claude/fleet/README.md)); this file is
the project's own.

Two facts shape everything below:

- **The game is only on this machine.** The suites that read the data or an
  install, and the executables the reverse tools read, cannot go to a cloud
  session, so every session is LOCAL, and CI runs only what needs neither.
- **The repo is public.** Anyone can open an issue or a pull request; the
  fleet acts only for the owner (`.claude/fleet/strangers.md`). What is read
  out of the executables is published here as it always was: behaviour and
  addresses in `docs/engineInternals/`.

## Owner

`senyaak`. Only that account's issues, PRs, comments and labels count.

## Repos

One repo, `senyaak/homm5-editor` (public): every kind of issue, every PR,
`needs-owner` questions and `fleet-process` reports. It never carries game
content — no file of the game, unpacked or not, and nothing generated from
one ([../../CONTRIBUTING.md](../../CONTRIBUTING.md)) — and no host or account
of the owner's.

## Kinds

| kind | what | taken by |
| - | - | - |
| `read` | an executable read, the finding written into `docs/engineInternals/` with the tests that pin it; no editor code | `developer`, under § Sources |
| `build` | editor, extension or tool code from findings that already exist | `developer` |
| `test` | tests only | `developer` |
| `bug` | a reported misbehaviour, diagnosed before it is fixed | `developer` |

Issue titles are `[<area>] <what>`, the area being the item file's prefix:
`[factions] audit every reader of the race list`. "What the user sees" is
what a person sees in the editor, or a player in the game.

## Sources

- **The game's own behaviour** is read out of the executables of the install
  with the tools in [../ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md), under
  [../working/reverse-method.md](../working/reverse-method.md): thunks
  expanded, a routine read whole, negatives checked a second way, `[esp+N]`
  named by `tools/net-probe.ts --frame`. Cited as the doc and the address:
  `engineInternals/<file>.md, 0x…`. An address the extension relies on is
  pinned by `test-native-anchors`.
- **The file formats** are cited as the doc under [../README.md](../README.md)
  that describes them, or the shipped data they were measured on (path in the
  data, never the content).
- **The game's ordinary behaviour** comes from its own docs (`Editor
  Documentation/*.pdf` in the install) and the web before the disassembler.
- **Search what is written first**: `docs/engineInternals/`, `docs/`, the
  item file and its plan, before reading the executable, and before saying
  anything is not there.
- **A missing source**: a small read (a routine, a table) is done in the same
  PR and written into the doc that owns it; a bigger one is a `read` issue the
  build depends on.
- **The owner settles** only what the executable and the docs cannot: a
  design choice an item leaves open, or how the game looked or felt.

## Decisions

An owner answer goes into the doc that owns the subject — the item file, the
plan under `docs/`, or `docs/working/` for a rule — with the owner's words
quoted and the issue number.

## Work list

[../todo.md](../todo.md) and one file per item under [../todo/](../todo/).
The issue links the item's file. Finishing an item deletes its file and its
index line in the same change; finishing part of it rewrites the file to what
is still open. An item whose next step is the owner playing (`factions-3-play-test`
and its like) becomes the `## Play` section of the PR that builds it, not an
issue.

## Order of work

[../todo.md](../todo.md), top to bottom, until the owner changes it:

0. Housekeeping: `e2e-fail-fast`, `file-size-guard`, `split-hot-files` — before
   builds run in parallel in the files they split.
1. Factions of our own, to a release.
2. Creature abilities through Lua.
3. Lua in multiplayer.
4. The asset editor.

Items within a group by their number; reads before the builds that need them.

## Hot files

- **Indexes, one entry per line, sorted:** [../todo.md](../todo.md),
  [../README.md](../README.md), [../working/README.md](../working/README.md),
  and every other index under `docs/`.
- **Registration lists:** `package.json` scripts, the include list of
  `native/homm5-editor.c`, the IPC channel tables — a line at its sorted place,
  or beside its group's last entry.
- **`CHANGELOG.md` is never edited by a PR**: a user-visible change adds
  `changes/<issue>-<slug>.md` ([../../changes/README.md](../../changes/README.md)).
- **Hot modules** are what [split-hot-files.md](../todo/split-hot-files.md)
  names; until it is done, issues that edit one of them are chained.

## Build rules

- [../../CLAUDE.md](../../CLAUDE.md) and [../working/](../working/README.md)
  hold for every line: no game content committed; nothing opens a window (the
  e2e under Playwright and the batch map editor are run as tests); an install
  is touched only in a copy of the slot's own.
- **Failure reporters** (`.claude/rules/failures.md`): `failed` / `failing`
  in the renderer (`renderer/core/failure.ts`), `mainFailed` in the main
  process (`electron/failure.ts`), `noteFailure` in shared code
  (`src/failure.ts`), which also holds `Refusal`, `UnknownFailure` and
  `isMissing`. A refusal crosses IPC as `Refusal: <msg>`
  ([../working/failures.md](../working/failures.md)).
- **Actions** (`.claude/rules/testing.md`): a control a spec presses is bound
  with `onAct` (`renderer/core/actions.ts`) and pressed with `press` /
  `pressBar` (`e2e/press.ts`); a refusal the spec expects is declared,
  `{ refused: /…/ }`. Only the random map window is moved so far; the rest is
  [e2e-fail-fast.md](../todo/e2e-fail-fast.md).
- A module that would grow a second concern is split first, in its own commit.

## Docs

1. A finding goes into the doc that owns its subject; a new subject is a new
   file plus one index line at its sorted place.
2. The issue's item file is deleted or rewritten (§ Work list).
3. A user-visible change adds `changes/<issue>-<slug>.md`; internal work —
   reading, tests, refactoring — adds none.

## Verify

Each to its own log under `_tmp/`, then read the log:

```bash
npm run typecheck > _tmp/typecheck.log 2>&1
node tools/test-doc-links.ts > _tmp/links.log 2>&1
node tools/test-silent-catches.ts > _tmp/catches.log 2>&1
node tools/test-<each suite the change touches>.ts > _tmp/<suite>.log 2>&1
npm run test-e2e-fast -- <each spec the change touches or adds> > _tmp/e2e.log 2>&1
```

- **The queue**: every e2e runner, `npm test` and a bare `playwright test`
  wait in one machine-wide queue (`tools/run-queue.ts`). Start such a run with
  `run_in_background` and read its log when notified; a single unit suite
  (`node tools/test-<name>.ts`) does not queue. In one slot, one run after
  the other: both use the worktree's `_tmp/`.
- **The harness**: `e2e/failures.ts` ends a test at the first failure the app
  reports (an uncaught throw or rejection, `console.error`, a main-process
  `[main error]` / `[failure]` / `[renderer gone]` line); a spec that provokes
  one says so as `allow` at launch. `e2e/waits-reporter.ts` lists every wait
  over two seconds and every timeout a test went on past. Each launch's own
  terminal is in `_tmp/e2e-logs/app/`.
- `test-native-anchors` for anything under `native/`. Never the C1M1
  reconstruction (`npm run test-e2e`, `e2e/c1m1/`): that is the release's.
- CI (`.github/workflows/build.yml`) runs the typecheck, the doc links, the
  changelog check, the app build and the `@nodata` e2e;
  `.github/workflows/fleet.yml` runs `fleet.mjs verify` and the shared link
  check. Everything that reads the data or an install runs locally.

## Review

**A `read` PR**, before the shared checks: re-read every address in
`## Sources` and the changed docs yourself, with the tools in
[../ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md), and write your own one-line
reading of each into the draft BEFORE reading the author's conclusion. A claim
decoded from the middle of a routine, a `calls X` that did not expand the
thunks, or a negative without the search behind it is a defect.

**Every PR**: a spec gesture is pressed as an action and checked by its
outcome, not by a guessed timeout; `CHANGELOG.md` untouched, and a `changes/`
entry for a user-visible change.

## Merge

- The base is `main`.
- CI on a PR: `build.yml` and `fleet.yml`.
- Nothing after a merge besides the shared steps.

## Slots

```bash
node tools/fleet-slots.ts <count> --root C:/Projects/homm5-fleet [--game-from <install>]
```

makes the missing slots — `slot-<n>/editor`, a worktree detached at
`origin/main` with its own `node_modules` and `data-unpacked` a junction to
the main checkout's (read only), and `slot-<n>/game`, the slot's own copy of
the game — and rewrites each slot's `.claude/settings.local.json`: a Bash
allow list, `HOMM5_GAME` pointing at the slot's game, and `FLEET_SLOT` for the
guard. Safe to run again.

Three slots exist. Developers and the reviewer each take one; the planner and
the merger need none and run in the main checkout. A worker session is opened
in its slot's `editor`.

## Traps

- Bash only: PowerShell mangles UTF-8 on this machine, and only Bash commands
  are pre-allowed in a slot.
- `HOMM5_GAME` is set by the slot's settings. Never point a run at another
  install, and never set `HOMM5_ROOT`: it makes the e2e work in the install
  instead of its sandbox under `_tmp/`.
- `git show <rev>:<path>` has its argument mangled by Git Bash's path
  conversion; prefix it with `MSYS_NO_PATHCONV=1`.
- `gh issue view <n> --comments` can print nothing; read comments with
  `gh api repos/senyaak/homm5-editor/issues/<n>/comments`, which gives each
  comment's author.
- `gh pr view --json` has no `merged`; use `gh api
  repos/senyaak/homm5-editor/pulls/<n> --jq .merged`.
- A one-off measurement is a script under `_tmp/`, never committed, unless the
  item asks for the check to stay — then it is a `test-*` suite.
- Lessons this project paid for itself: [LESSONS.md](LESSONS.md).

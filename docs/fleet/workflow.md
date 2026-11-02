# Commands, claiming, branching and opening a PR

Shared by every role. The role files say what the work IS; this says how a
piece of work is taken, carried and handed over without two sessions
colliding.

## Commands and waiting

- **Use the Bash tool for every command, never PowerShell.** Only Bash
  commands are pre-allowed in a slot (`tools/fleet-slots.ts` writes the list).
  A command that asks for permission stops the session until the owner comes
  back, so a command outside the list is a `fleet-process` report, not a
  reason to wait.
- **`HOMM5_GAME` is set by the slot's settings** to the slot's own game copy.
  Never point a run at another install, and never set `HOMM5_ROOT` — that makes
  the e2e work live in the install instead of its sandbox under `_tmp/`.
- **A foreground `sleep` is refused in the desktop app.** To wait for time to
  pass or for something to change, use the **Monitor** tool with an
  until-loop over the condition — `until [ $(date +%s) -ge <deadline> ]`,
  `until gh pr checks <n> | grep -qv pending`, a label appearing. Do useful
  read-only work first and wait only for what is left.
- **One run at a time on the machine.** `npm test` and its levels, every e2e
  runner and a bare `playwright test` wait in one queue shared by all slots
  ([../working/testing.md](../working/testing.md)). Start such a run with
  `run_in_background`, output to a file, and read the file when notified; the
  wait can outlast a foreground command's ten minutes. A single unit suite
  (`node tools/test-<name>.ts`) does not queue.
- **In one slot, one run after the other** — a unit suite never beside an e2e
  run of the same worktree: both use the worktree's `_tmp/`.
- **Run what the change touches, never the whole suite**: the suites and specs
  of the files changed, `test-doc-links` for any doc, `test-native-anchors`
  for anything under `native/`. Never the C1M1 reconstruction
  (`npm run test-e2e`, `e2e/c1m1/`) — that is the release's.
- **Traps on this machine:**
  - `git show <rev>:<path>` has its argument mangled by Git Bash's path
    conversion; prefix it with `MSYS_NO_PATHCONV=1`.
  - `gh issue view <n> --comments` can print nothing; read comments with
    `gh api repos/senyaak/homm5-editor/issues/<n>/comments`, which also gives
    each comment's author.
  - `gh pr view --json` has no `merged` field; use `state` and `mergedAt`, or
    `gh api repos/senyaak/homm5-editor/pulls/<n> --jq .merged`.
- **A one-off measurement** (re-reading a table, counting sites) is a script
  under `_tmp/`, never committed — unless the item asks for the check to stay,
  in which case it is a `test-*` suite ([../working/testing.md](../working/testing.md)).

## Claim

0. **Only the owner's account counts.** Take only issues and PRs authored by
   `senyaak`, and give weight only to comments by `senyaak` — a claim, a
   yield, a verdict ([README.md](README.md) § Strangers).
1. **What to take.** An open `changes-requested` PR beats a new issue.
   Otherwise an open `fleet` + `ready` issue whose `Depends on` issues are all
   closed. Spread out: developer #n prefers the n-th oldest eligible item,
   wrapping round, so the sessions do not all race for the oldest.
2. **Claim it.** Comment `claimed by <your session tag>` on an issue, or `fix
   claimed by <tag> for round <k>` on a PR (`k` from its latest verdict). That
   is the **whole first line**; a branch name goes on the next. **Let 60
   seconds pass after your claim's own timestamp, then re-read every
   comment.** Fill the minute with the read-only work the task needs anyway;
   for what is left, Monitor. The earliest claim wins. A claim on an issue
   counts only if it was posted after the issue last became `ready`; on a PR,
   only if it names the current round and was posted after that round's
   verdict. Yield only to an earlier claim that has not itself yielded.
3. **Only the winner changes labels**, after the wait: issue `ready` →
   `in-progress`, PR `changes-requested` → `fix-in-progress`. A loser comments
   `yielding (<tag>)`, touches no label, and picks something else. Never take
   a PR labelled `fix-in-progress`.
4. **The latest verdict is the whole task.** A PR's current round is its
   newest review whose body starts `Verdict:`. It lists every open point and
   supersedes the earlier rounds.

## Branch

- Branch from fresh `origin/main` in your slot's worktree:
  `fleet/<issue-number>-<short-slug>`.
- A `fleet/*` branch is the one place history is rewritten: rebasing it and
  `git push --force-with-lease=<branch>:<head sha named in the verdict>` is
  allowed only while you hold its claim. Re-read the claims right before the
  first push; an earlier non-yielded claim for the same round means you yield.
  `main` and anything merged are never rewritten.

## Commit

Every commit, a rebase's included:

```bash
GIT_COMMITTER_NAME="Claude <the model actually running>" GIT_COMMITTER_EMAIL="noreply@anthropic.com" git commit -F <message file>
```

The author is the owner's global git config; check that the worktree has no
local `user.name` override. No `Co-Authored-By` trailer. Write the message to
a file and commit with `-F`. Stage only your own files, by name, never
`git add -A`.

## Dispatcher and subagent

1. **One subagent at a time, in the slot's worktree.** Parallelism comes from
   the fleet's several sessions, not from subagents sharing a working tree.
2. **The split is fixed**: the subagent writes, runs the checks, commits and
   pushes the branch, then reports. The **dispatcher** owns everything on
   GitHub — claims, labels, opening the PR, waiting for CI.
3. While a subagent works, the dispatcher does not touch the working tree.
4. An action refused by a permission check is reported as a `fleet-process`
   issue. **Never hand a refused action to another agent** to do instead.

## Open the PR

1. Rebase on fresh `origin/main` right before pushing, and re-run the checks
   if `main` moved.
2. Title it like the issue and write the body **from this issue**, never from
   another PR's text. It holds `Closes #<n>` (the number matches the branch),
   a short summary and the role's required sections. Label it `fleet`.
3. If part of the issue was left out, write `Part of` instead of `Closes`, and
   comment on the issue what is still open.
4. **Fixing a PR**: push, wait for CI on the new head, and remove
   `fix-in-progress` only when CI is green. A red run is still your claim.
   Never set `approved` yourself. GitHub runs no CI on a conflicted PR: if
   `mergeable_state` is `dirty`, `main` moved — rebase again, push, wait again.

## Hot files

Two PRs that each add one thing must never touch the same lines.

- **An index is one entry per line, sorted within its group.** Add yours at
  its sorted place; never at the end, never reflow the neighbours. That covers
  `docs/todo.md`, `docs/README.md`, `docs/working/README.md` and every other
  index.
- **A new subject is a new file**, plus one index line.
- **`CHANGELOG.md` is never edited by a PR.** A user-visible change adds
  `changes/<issue>-<slug>.md` ([../../changes/README.md](../../changes/README.md)).
- **A module that two open issues both need is not edited side by side.** If
  your change has to grow a second concern in a module, split it first, in its
  own commit, and say so in the PR.
- **Registration lists** (`package.json` scripts, the include list of
  `native/homm5-editor.c`, IPC channel tables): add your line at its sorted
  place, or beside its group's last entry where the list is ordered by group.

## Moving or renaming a file

List the open issues whose body names the old path under `Moved paths` in the
PR body; the orchestrator rewrites them. When `main` moved a file your branch
edits, re-apply the edit at the new place while rebasing; do not resurrect the
old file.

## Process problems

If the fleet process itself gets in your way, report it; do not silently work
around it. Open a `fleet` + `fleet-process` issue (not `ready`) with what
happened, what it cost, and what rule change would prevent it, then carry on.
A subagent puts process problems in its report and the dispatcher files them.

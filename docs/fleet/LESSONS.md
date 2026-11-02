# Fleet lessons

Problems the fleet's PROCESS ran into, and the rule change that fixed each.
Agents report them as `fleet-process` issues; the orchestrator changes the
roles and adds a line here. A flaw found in one of the repo's own rules is
fixed in that rule and not recorded here. One line per lesson, newest at the
top; numbers are never reused, because issues cite them.

## This fleet

None yet. Each is a row `| L<n> | problem | fix | where |` under a header
`| # | Problem | Fix | Where |`, newest first.

## Inherited

The roles were adapted on 2026-11-02 from the fleets of `senyaak/pcktor` (its
L1–L41) and `senyaak/pigs-of-worldwar` (its L1–L8), both in their
`docs/fleet/LESSONS.md`. What each became here:

| Lesson | What it taught | Here |
| - | - | - |
| pcktor L2, L10 | a looping session drags old tasks along; subagents sharing a checkout clobber it | `workflow.md` § Dispatcher and subagent |
| pcktor L3, pigs L2 | sessions stalled on permission prompts | each slot's `.claude/settings.local.json` from `tools/fleet-slots.ts`; Bash only |
| pcktor L4, L9, L15, L16, L24, L39 | claim races on issues and PR fixes | `workflow.md` § Claim and § Branch |
| pcktor L7, L22, L25 | merges raced; green CI on a stale base | one merger; `reviewer.md` § Merger |
| pcktor L8, L41 | hot shared files cost a rebase round per PR | `workflow.md` § Hot files; CHANGELOG as `changes/` fragments |
| pcktor L11 | a refused action handed to another agent | `workflow.md` § Dispatcher and subagent 4 |
| pcktor L12 | a PR carried another PR's text | `workflow.md` § Open the PR 2 |
| pcktor L13 | placeholder issues | `planner.md` § Output, dependencies first |
| pcktor L18, L20, L32 | agent comments looked like owner answers | `planner.md` § Owner answers; only `senyaak` counts |
| pcktor L19, L35 | `Closes` against a partly done issue | `workflow.md` § Open the PR 3 |
| pcktor L23, L26, L31 | rebase-only rounds | `reviewer.md` § Merger 1: the merger rebases a clean PR itself |
| pcktor L28, L40 | `mergeable_state` lags; no CI on a conflicted PR | the local `git merge-tree` check; `workflow.md` § Open the PR 4 |
| pigs L1 | a foreground `sleep` is refused in the desktop app | Monitor; `workflow.md` § Commands and waiting |
| pigs L3, L4 | parallel e2e starve each other; unit beside e2e in one slot | the machine-wide run queue; one run after the other in a slot |
| pigs L5 | shell traps: `git show`, `gh issue view --comments`, `gh pr view --json merged` | `workflow.md` § Commands and waiting |
| pigs L6 | an item cut into several issues | `docs/todo.md`: finishing part of an item rewrites its file |
| pigs L7 | no line between blocking and non-blocking; returned PRs; approvals without a record | `reviewer.md` § Pick, § Decide |
| pigs L8 | the branch deleted before the PR showed merged | `reviewer.md` § Merger 4 |

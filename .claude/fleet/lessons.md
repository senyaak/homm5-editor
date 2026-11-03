# Shared lessons

The process problems the shared rules came from, one line each, newest at the
top. They were paid for in the fleets of `senyaak/pcktor` (its lessons
L1–L42) and `senyaak/pigs-of-worldwar` (its L1–L8), whose own LESSONS files
keep the full story; the last column says which. Numbers are never reused,
because issues cite them. A lesson that only one project's machine, repos or
checks could have taught stays in that project's lessons.

| # | Problem | Rule | Where | From |
| - | - | - | - | - |
| F27 | Two fleets kept their own copies of the same rules, and drifted: a lesson one learned (area labels) never reached the other. | The shared rules are one versioned repo; projects pin a version and update. | [updating.md](updating.md) | pcktor L42 vs pow |
| F26 | Rules written only as prose (committer, staging by name, master to the merger) held most of the time, not every time. | A hook refuses the commands that break them, written in Node and run in exec form so it is the same on Windows and Linux. | [guard.md](guard.md) | research, 2026-11 |
| F25 | Agents retried one broken approach again and again; others' fleets name it their most common failure. | Three strikes: stop, push, write what was tried, `blocked`. | [workflow.md](workflow.md) § Three strikes | research, 2026-11 |
| F24 | A session that died kept its claim and its label, and nothing freed the item; locks held too long cut another fleet's throughput tenfold. | Claims expire: two hours with no push in the last hour; holders push hourly. | [workflow.md](workflow.md) § Claim 5 | research, 2026-11 |
| F23 | Parallel workers kept picking issues that edit the same shared helper, then rebased against each other. | `area:<part>` labels; a worker skips an issue whose area is held. | [workflow.md](workflow.md) § Claim 1, [planner.md](../agents/planner.md) | pcktor L42 |
| F22 | The merger deleted the branch before GitHub marked the PR merged, which can leave it closed as unmerged; `in-progress` stayed on closed issues. | Confirm merged, then delete the branch; the merger removes `in-progress`. | [reviewer.md](../agents/reviewer.md) § Merger 4 | pow L8 |
| F21 | Reviewers had no line between blocking and non-blocking, no rule for a returned PR, and an approval left no record. | Only what lands blocks; a returned PR is reviewed on its new diff; approval is an `Approved (round k)` note. | [reviewer.md](../agents/reviewer.md) § Pick, § Decide | pow L7 |
| F20 | An item cut into several issues had no rule for its work-list file in between. | Finishing part of an item rewrites its file to what is still open; the last issue deletes it. | [developer.md](../agents/developer.md) § Work 6 | pow L6 |
| F19 | Several slots running heavy UI tests at once starved each other into false reds. | One machine-wide lock for the heavy checks, waited on inside the tool, never with `sleep`. | `project.md` § Verify | pow L3 |
| F18 | The claim's minute could not be a `sleep`, which the desktop app refuses. | Fill the minute with reading; wait with Monitor. | [workflow.md](workflow.md) § Commands and waiting | pow L1 |
| F17 | Reuse hints named helpers that did not exist; verdicts prescribed what a newer rule forbade; a rule change reopened approved points. | Reuse hints exist on the base; rules apply to new work; reviewers pull the roles before a verdict. | [planner.md](../agents/planner.md), [reviewer.md](../agents/reviewer.md) § Decide | pcktor L29, L30, L38 |
| F16 | `mergeable_state` lagged behind a conflict; no CI runs on a conflicted PR. | The conflict check is a local `git merge-tree` on fresh base. | [workflow.md](workflow.md) § Open the PR 4, [reviewer.md](../agents/reviewer.md) § Pick | pcktor L28, L40 |
| F15 | Base fixes went into stacked copies of a PR and drifted; link checks crashed or were skipped. | No stacking: a dependency is `blocked` until it merges; the link check runs in CI. | [planner.md](../agents/planner.md) § What a good issue is | pcktor L27, L34, L36 |
| F14 | Rebase-only rounds bounced approved PRs through full re-review and conflicted again. | The merger rebases a clean PR itself and range-diffs it; index-only conflicts it resolves. | [reviewer.md](../agents/reviewer.md) § Merger 1 | pcktor L23, L26, L31 |
| F13 | A missing prerequisite was filed as a question to the owner. | A missing source is work: small, in the same PR; bigger, its own issue that blocks. | [developer.md](../agents/developer.md) § The rule | pcktor L21, L33 |
| F12 | PRs that left part of an issue out had no rule for `Closes` against `Part of`; gaps were left ownerless. | `Part of` plus a comment of what remains, unless every part has its own issue. | [workflow.md](workflow.md) § Open the PR 3 | pcktor L19, L35 |
| F11 | Agents post as the owner's account, so an agent's comment looked like an owner answer; strangers can write in a public repo. | Owner answers come only through `needs-owner` + `answered`; a stranger's item is never work. | [strangers.md](strangers.md), [planner.md](../agents/planner.md) § Owner answers | pcktor L18, L20, L32 |
| F10 | The planner made placeholder issues and patched `Depends on` afterwards. | Issues are created dependencies first. | [planner.md](../agents/planner.md) § Output | pcktor L13 |
| F9 | A PR went up with another PR's description. | The body is written from its own issue; `Closes` matches the branch number. | [workflow.md](workflow.md) § Open the PR 2 | pcktor L12 |
| F8 | A refused action was handed to another agent to do instead. | A refusal is a `fleet-process` report, never relayed. | [workflow.md](workflow.md) § Dispatcher and subagent 4 | pcktor L11 |
| F7 | Hot shared files cost a rebase round per parallel PR. | One entry per line, sorted; a new subject is a new file; hot files are split. | [workflow.md](workflow.md) § Hot files | pcktor L8, L41 |
| F6 | Merges raced, and green CI on a stale base turned the base red. | One merger; a fast-forward of exactly the head CI passed. | [reviewer.md](../agents/reviewer.md) § Merger | pcktor L7, L22, L25 |
| F5 | Process friction was noticed only by chance. | Every role reports it as `fleet-process`. | [workflow.md](workflow.md) § Process problems | pcktor L6 |
| F4 | Claim races on issues and on PR fixes, in every variant. | Comment, wait a minute, re-read, earliest wins; claims count per round and only after the latest `ready`. | [workflow.md](workflow.md) § Claim | pcktor L4, L9, L15, L16, L24, L39 |
| F3 | Sessions stalled on permission prompts with no one to answer. | Every command a role runs is pre-allowed in its slot. | [starting.md](starting.md) | pcktor L3, pow L2 |
| F2 | Subagents sharing one checkout clobbered each other. | One subagent at a time per worktree. | [workflow.md](workflow.md) § Dispatcher and subagent 1 | pcktor L10 |
| F1 | A worker looping in one conversation dragged every earlier task's history along. | The session is a dispatcher; one subagent per issue. | [starting.md](starting.md) | pcktor L2 |

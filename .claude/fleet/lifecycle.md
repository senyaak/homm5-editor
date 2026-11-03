# Roles, lifecycle and labels

A planner files small issues, workers take one each, reviewers check them, one
merger lands them. The owner answers what only the owner can, and plays what
lands.

## Roles

- **Planner** — [planner.md](../agents/planner.md) — the work list → small issues; strangers triaged; owner answers → decisions
- **Developer** — [developer.md](../agents/developer.md) — one issue → one branch → one PR that cites its sources
- **Reviewer** — [reviewer.md](../agents/reviewer.md) — re-checks every cited source itself, runs the checks, labels `approved`
- **Merger** — [reviewer.md](../agents/reviewer.md) § Merger — fast-forwards approved PRs, lowest number first

A project may add roles of its own in `.claude/agents/` (`project.md` § Kinds
names them); they follow [workflow.md](workflow.md) like these.

## An issue's way

1. The planner opens an issue per work item, in the repo `project.md` § Repos
   gives its kind: labels `fleet`, the kind and `ready`, or `blocked` when it
   depends on another.
2. A worker claims it (`ready` → `in-progress`) and opens a PR in the same
   repo as the issue.
3. A reviewer either labels the PR `approved` or posts a verdict and labels it
   `changes-requested`; the next run fixes it on the same branch.
4. The merger fast-forwards an approved PR onto the base, closes the issue,
   and labels it **`needs-play`** when the change is something a user can
   see. The owner's play queue is the closed issues carrying that label; the
   owner removes it after looking.
5. A question only the owner can answer goes into a **`needs-owner`** issue.
   The owner answers in a comment, in any language, and labels it `answered`.

Everything the fleet writes on GitHub — issues, PRs, reviews, comments — is
in English.

## Labels

Every repo of the project carries the same set: `fleet`, the kinds of
`project.md` § Kinds, `ready`, `in-progress`, `blocked`, `changes-requested`,
`fix-in-progress`, `approved`, `needs-owner`, `answered`, `needs-play`,
`fleet-process`, the six `priority:<level>` labels
([workflow.md](workflow.md) § Priority), and `area:<part>` labels as the
planner needs them. `node .claude/fleet/fleet.mjs doctor --fix` creates the
missing ones in every repo of the project; a role that finds one of them
missing creates it (`gh label create <name> --repo <repo>`). Only the planner
creates an `area:<part>` label; another role that needs a missing one reports
it as `fleet-process`.

## Guard rails

1. **CI is a gate, not the whole gate.** What CI cannot run, the developer
   runs and the reviewer runs again; both paste the counts.
2. **The base stays green.** Anyone who finds it red stops other work and
   opens `[ci] <base> is red: <step>` (`fleet` + `bug` + `ready`) unless one
   is open.
3. **No direct pushes to the base** except the merger's fast-forward of an
   approved head.
4. **Commits keep the owner's attribution**: author the owner (the global git
   config), committer `Claude <model actually running>`, no `Co-Authored-By`
   trailer — on every commit, a rebase's included.
5. **Only the owner's account is trusted** ([strangers.md](strangers.md)).
6. **Process problems are reported, not worked around** (`fleet-process`).

3, 4 and the merge part of 5 are also enforced by the [guard](guard.md).

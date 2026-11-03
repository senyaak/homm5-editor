# The agent fleet — index

Autonomous Claude Code sessions that take a project's work list through
GitHub issues and pull requests. This folder and the role files in
`.claude/agents/` are a **copy of a version of `senyaak/claude-fleet`**, pinned
in `fleet.lock.json` and never edited here ([updating.md](updating.md)). What
is this project's own is in [docs/fleet/project.md](../../docs/fleet/project.md).
The working rules every session follows, a fleet role or not, are beside this
folder: [../rules/README.md](../rules/README.md).

## How it works

- [lifecycle.md](lifecycle.md) — the roles, an issue's way from the work list to the base branch, labels, guard rails
- [starting.md](starting.md) — slots, a slot in the owner's checkout, and the prompt each session is started with
- [strangers.md](strangers.md) — only the owner's account is ever acted on
- [workflow.md](workflow.md) — claiming, waiting, three strikes, branching, committing, opening a PR, hot files

## Roles

- [../agents/developer.md](../agents/developer.md) — one issue → one branch → one PR that cites its sources
- [../agents/planner.md](../agents/planner.md) — the work list → small issues; strangers triaged; owner answers → decisions
- [../agents/reviewer.md](../agents/reviewer.md) — re-checks every cited source, runs the checks, labels `approved`; § Merger lands them

## The copy itself

- [doctor.mjs](doctor.mjs) — `fleet.mjs doctor [--fix]`: everything the fleet needs, the project file and the GitHub labels included
- [fleet.mjs](fleet.mjs) — `check`, `update`, `verify`, `doctor`: the fleet as a pinned dependency
- [guard.md](guard.md) — the hook that refuses what the rules forbid, why it is Node, and the version check beside it
- [lessons.md](lessons.md) — the process problems the shared rules came from
- [links.mjs](links.mjs) — every relative markdown link lands; CI runs it (`../rules/docs.md`)
- [project-template.md](project-template.md) — what `docs/fleet/project.md` must hold; the installer starts it from this
- [updating.md](updating.md) — taking a new version, and where a change to the rules is made
- [version-check.mjs](version-check.mjs) — at an owner session's start, one line when a newer version is out ([guard.md](guard.md) § The version check)

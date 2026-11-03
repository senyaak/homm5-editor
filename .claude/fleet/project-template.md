---
owner: <github login>
base: <base branch, e.g. master>
repos: [<owner>/<repo>]
kinds: [build, test, bug]
# cloud: fleet   (optional: a cloud session, CLAUDE_CODE_REMOTE=true, is a fleet session)
---

# This project's fleet

What the shared roles in `.claude/agents/` and `.claude/fleet/` need to know
about this project. They cite it as `project.md § <section>`, so every section
below must exist under exactly this name; a section that does not apply says
so in one line. The front matter above is the same facts in a form
`fleet.mjs doctor` reads: it checks each repo and creates the labels the
roles use. `cloud: fleet`, when set, makes every cloud session of the
project a fleet session for the guard (`.claude/fleet/guard.md` § In a fleet
session); without it a cloud session is an owner session. This file is the
project's own: the installer writes it once from
`.claude/fleet/project-template.md` and never touches it again; `doctor` says
which sections still hold the template's text.

## Owner

The GitHub account the fleet acts for and trusts, and nobody else's
(`.claude/fleet/strangers.md`).

## Repos

Every repo the fleet works in: its name, public or private, which issue kinds
and PRs live there, where questions to the owner (`needs-owner`) and
`fleet-process` reports go, and what a repo may never carry.

## Kinds

The issue kinds and the role that takes each. The shared roles are `planner`,
`developer`, `reviewer` (with the merger); a role of this project's own is a
file in `.claude/agents/` and is named here.

## Sources

What counts as the source of a behaviour, how it is cited (in code, specs and
PR bodies), where existing sources are searched first, and how a missing one
is established.

## Decisions

The doc an owner answer is written into, and how it is tagged.

## Work list

Where the open items live, what finishing one or part of one changes there,
and which items are the owner's alone (not issues).

## Order of work

The owner's order for the planner, until the owner changes it.

## Hot files

The indexes that are one entry per line, and the code modules too hot to edit
in two issues at once.

## Build rules

The project's hard rules for code, which the developer follows and the
reviewer checks.

## Docs

What a change updates in the same commit: facts, the work-list file, what is
never appended to.

## Verify

Every check a developer runs before a PR and a reviewer runs again, as
commands with their log files; which of them CI already runs; locks and order.

## Review

Checklists for kinds the shared reviewer does not cover (a project role's
PRs), and extra checks for the ones it does.

## Merge

The base branch, what CI runs on a PR, and anything the merger does after a
merge besides the shared steps.

## Slots

How this project's slots are made, where they are, which role uses which, and
what each slot pre-allows; a kind that runs in the owner's checkout
(`.claude/fleet/starting.md` § A slot in the owner's checkout).

## Traps

Machine, shell and tool traps a session would otherwise pay for.

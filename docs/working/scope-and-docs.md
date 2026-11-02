# Scope, and where a thing is written

## Scope

- A task does what it says. A bug noticed on the way is named and filed, not
  fixed inside the task.
- Small incidental fixes in our code are in scope: a stale or wrong comment, a
  one-line slip beside the change. Behaviour and UX changes are not — flag
  them first. A neighbouring subsystem is never incidental.

## Where it is written

- Write by subject, not into the open file — code, tests and docs alike. An
  "and" in a title, or a section on its own schedule, means a second subject:
  split it. One test = one subject; one module = one responsibility.
- A file past about 500 lines is split; the old path becomes the index of its
  pieces.
- A doc is one thing or an index. An index is one link per line with a
  one-line summary, sorted.
- A correction replaces the wrong text; no strike-through.
- A finding is written into the doc that owns its subject when it is found.
  A closed issue is not documentation.
- A `SLICE_*.md` at the root is work in flight; when it lands, its open tails
  move out and it moves to [docs/_slices_done/](../_slices_done/).

## How a rule here is written

A rule is a protocol: **when** it applies and **what** to do. A reason is kept
only when it defines where the rule applies (a mechanism, in half a line).
No incident stories, dates or costs.

# Scope, and where a thing is written

## Scope

- **A task does what it says.** A neighbouring bug noticed on the way is
  named and filed, not fixed inside someone else's task — the broken `<teams>`
  rule found while checking a slot's colour was not that task.
- **Small incidental fixes in our code are in scope**: a stale or wrong
  comment, a one-line correctness slip next to the change. The scope is the
  whole app. A behaviour or UX change is not incidental — removing a
  confirmation is flagged first, correcting its stale rationale is not.
- **A neighbouring subsystem is not incidental**, however small the fix looks.

## Where it is written

- **By subject, not by the open file.** Code, tests and docs alike: material on
  the first aid tent once sat in `SPECIALIZATIONS.md` and `HERO_CLASSES.md`,
  neither of which is about a war machine. The tells that a file holds two
  things: an "and" in its title, or a section that lives on a different
  schedule from the rest. One test = one subject; one module = one
  responsibility, wired by a call from the main one.
- **Past about 500 lines a file almost always holds two subjects** and is
  split; the old path becomes the index of its pieces, so citations still land.
- **A doc is one thing or an index.** An index is a list of links with a line
  each; indexes keep one entry per line, sorted, so two changes adding to one
  index do not touch the same line.
- **A correction replaces the wrong text** — no strike-through, no "~~old~~
  new": a reader skimming takes the struck line for a fact, and git keeps the
  old version.
- **A finding is written where its subject lives, the day it is found** — a
  format detail in its format doc, an engine reading in `engineInternals/`, a
  working rule here. The next person should not have to derive it again, and a
  closed GitHub issue is not documentation.
- **A `SLICE_*.md` at the repo root is work in flight**; when it lands it moves
  to [docs/_slices_done/](../_slices_done/) with its open tails moved out
  first, so nobody has to read an archive to find work.

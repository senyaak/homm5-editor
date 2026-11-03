---
paths:
  - "**/*.md"
---

# Docs: one thing per file, or an index

- A markdown file describes ONE thing, or it is an INDEX: a list of links,
  each to a one-thing file or another index, with a one-line summary each.
  Nothing else goes in an index.
- A file that grows a second subject is split, and the old file becomes the
  index of its pieces at the same path, so every citation of it still lands.
  Past about 500 lines a one-thing file almost always holds two.
- An index is one entry per line, sorted by file name within its group. Add
  an entry at its sorted place — never at the end, never on another entry's
  line, never reflowing the neighbours — so two changes never touch one line.
- A correction replaces the wrong text: no strike-through, no "~~old~~ new",
  no "see below". Git keeps the old version.
- A record of work is a new file, never an append to a shared one.
- A finished work-list item is deleted, not ticked.
- Every relative link lands: `node .claude/fleet/links.mjs` checks the repo's
  markdown, and CI runs it.

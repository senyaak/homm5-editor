---
paths:
  - ".claude/rules/**"
  - ".claude/agents/**"
  - ".claude/skills/**"
  - "**/CLAUDE.md"
  - "docs/fleet/**"
---

# How a rule is written

A rule is a protocol: **when** it applies and **what** to do. It is followed,
not argued with, so it carries what a session needs to follow it and nothing
else.

- A reason is kept only when it defines where the rule applies — a mechanism,
  in half a line. No incident stories, no dates, no cost of the mistake that
  led to it.
- One rule, one line where it can be; a rule that needs a paragraph is
  usually two.
- A rule that only one project needs is that project's, in its own docs. A
  rule every project needs comes here, through a change to
  `senyaak/claude-fleet`, never as an edit of this copy.
- A rule found wrong is replaced, not struck through or footnoted.
- A rule loads when it is needed. A rule about certain files gets `paths` in
  its front matter and loads when a session touches one. Only a rule for every
  conversation goes without, and it stays a few lines. A procedure run now and
  then — a migration, a release, a pass over the code — is a skill in
  `.claude/skills/<name>/SKILL.md`, whose description says when to use it.

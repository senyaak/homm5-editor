---
paths:
  - ".claude/rules/**"
---

# Working rules — index

Rules every Claude session in the owner's projects follows, a fleet role or
not. Claude Code loads them by itself: a rule with `paths` in its front matter
when a session reads or writes a matching file, a rule without them into every
session. They are a **copy of a version of `senyaak/claude-fleet`**, like
`.claude/fleet/`, and never edited here. A project names its own parts of
them — its reporters, its test harness, its commands — in
[docs/fleet/project.md](../../docs/fleet/project.md) § Build rules and
§ Verify; a project rule that goes further than these lives in the project's
own docs.

## Every session

- [commits.md](commits.md) — the owner authors, Claude commits, staged by name, no trailer
- [investigating.md](investigating.md) — search before reading, a negative is a list of searches, prove the cause
- [owner.md](owner.md) — English in the repo, the owner's language in chat; terms explained, lists citable, plain reports, no estimates
- [running-tests.md](running-tests.md) — only what changed, output to a file, one heavy run at a time

## With matching files

- [angular.md](angular.md) — Angular sources: three files a component, constructor DI, signals by default, reactive forms
- [code.md](code.md) — source files: small single-purpose modules, no leftovers, one code path, the task and nothing beside it
- [docs.md](docs.md) — markdown: one thing per file or an index; sorted one-line entries; corrections replace
- [failures.md](failures.md) — source files: every catch hands the error on, reports it, or says why it is none; no raw error reaches a client
- [testing.md](testing.md) — test files: a test fails at the moment something goes wrong; a gesture is an action it waits on
- [typescript.md](typescript.md) — TypeScript sources: types from their definitions, no `any` or `Record<string, …>`, enums, no `?.` / `!` shortcuts
- [writing-rules.md](writing-rules.md) — rules, roles, skills, CLAUDE.md: a rule is a protocol, loaded when it is needed

The procedures run now and then are skills in `.claude/skills/`, loaded when a
task calls for one: `failures-pass` brings a project's catches to
[failures.md](failures.md).

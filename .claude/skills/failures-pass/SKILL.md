---
name: failures-pass
description: Bring a project's catch blocks to the failures rule (.claude/rules/failures.md) in two passes, with a guard that keeps it so. Use when a project adopts the rule, or when asked to clean up swallowed errors or add a catch guard.
---

# Bringing a project to the failures rule

The rule is `.claude/rules/failures.md`: every catch hands the error on,
reports it through its layer's one reporter, or is marked `not a failure:
<why>`.

1. **Reporters.** One per layer — the UI, a server or main process, shared
   library code — each saying what was being done and what went wrong, where
   the person looks and where a test fails on it. Name them in
   `docs/fleet/project.md` § Build rules. Add `Refusal` and `UnknownFailure`.
2. **The guard.** A check over every catch of the project's code that fails on
   a catch which neither hands on, reports, nor carries the marker, and that
   counts `UnknownFailure`s; the count only goes down. Name it in
   `project.md` § Verify and run it in CI.
3. **First pass, mechanical.** Every catch gets one of the three. What is not
   understood on sight becomes `throw new UnknownFailure(what, e)`. Commit
   this pass alone; the guard goes green on it.
4. **Second pass, as the runs show.** Each `UnknownFailure` a run hits gets its
   kind, a class and a message of its own — the refusals first, since the
   tests of refusals are the first to go red. One kind per commit.

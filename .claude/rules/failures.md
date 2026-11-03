---
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
---

# Failures: caught, said, never swallowed

When a catch drops an error, a broken gesture becomes nothing at all: the
person sees no message, and a test waits out a timeout instead of failing
with the cause. A catch that only writes into a form's error line, or only
logs, is the same: seen by whoever looks there.

## Every catch is one of three

- **Hands it on**: `throw` (wrapped or not), `reject(e)`, a handler the
  caller gave (`onError(…, e)`), or the error returned or posted as a value.
- **Reports it** through its layer's one reporter — one per layer (the UI,
  a server or main process, shared library code), each saying what was being
  done and what went wrong, where the person looks and where a test fails on
  it. The project names them in `project.md` § Build rules.
- **Is marked** with a comment inside the handler, `not a failure: <why>`: a
  probe whose "no" is the answer, a cache entry decoded again, a clean-up the
  next run retries.

A guard checks every catch of the project's code and fails on anything else
(`project.md` § Verify names it).

## Kinds of failure

- **A refusal is not a failure.** When the app says no by one of its rules —
  a name taken, an id that is not the person's to use, a thing still held by
  another — it throws a `Refusal`, worded for the person to act on. It is
  shown like a failure and logged as a refusal, not as an error; a test
  expects it by name. "Not found" where the thing should be there is not a
  refusal: the person did nothing wrong.
- **Not known yet** → `throw new UnknownFailure(what, e)`. It is loud
  everywhere — on screen, in the log, failing a test at once. Each one is a
  place still to be decided: when understood, it gets a class and a message of
  its own. The guard counts them, and the count only goes down.
- **"The file is not there"** is the one failure a "may not exist yet" catch
  is about: test for exactly that (`ENOENT`); anything else goes on.

## What reaches a client

- Never a raw error: no subprocess stderr, exception message, SQL error,
  stack trace or file path. Log the detail on the server; send a short
  message from a fixed vocabulary.
- An expected failure gets its precise status — 400 bad input, 404 missing,
  409 conflict, 422 unprocessable, 502 / 504 upstream. 500 is a real bug only,
  never the default.

## Where a loop meets a bad item

One unreadable item among many is reported and skipped; the scan goes on. A
read whose failure would be taken for "empty" — a manifest, a list the next
write saves back — throws instead: the next write would replace what is there
with nothing. Where the owner decided a loss is acceptable, the loss is
reported.

Bringing a project to this rule is the `failures-pass` skill.

# Failures: caught, said, never swallowed

How the code handles an error. The e2e side of it: [e2e.md](e2e.md).

## Every catch is one of three

`tools/test-silent-catches.ts` (in `npm test`) checks every `catch` and
`.catch(…)` in `renderer/`, `electron/` and `src/`:

- **Hands it on**: `throw` (wrapped or not), `reject(e)`, a caller's handler
  (`opt.onError(…, e)`), or the error returned / posted as a value.
- **Reports it** through its layer's one reporter:
  - renderer — `failed(what, e, line?)` / `failing(what, line?)`
    (`renderer/core/failure.ts`): shown in the form's line or on the status
    line, and a console error;
  - main process — `mainFailed(what, e)` (`electron/failure.ts`), for what has
    no caller: a watcher, a background job, a clean-up;
  - `src/` — `noteFailure(what, e)` (`src/failure.ts`), for one item of many
    that could not be read while the rest still are.
- **Is marked** `not a failure: <why>` inside the handler: a probe whose "no"
  is the answer, a cache entry that is simply decoded again, a clean-up the
  next run retries.

A form's error line alone, or a log alone, is a swallow.

## A refusal is not a failure

- When the app says no by one of its rules — a name taken, an id the game
  owns, a thing still held by another, an install not prepared — it throws
  `Refusal` (`src/failure.ts`), worded for the person to act on.
- It crosses IPC as `Refusal: …` and is a `Refusal` again in the renderer
  (`renderer/core/ipc.ts`); `failed()` shows it like any failure, logs it as
  `[refused]`, and writes no console error — so a spec that provokes it checks
  the line it is shown in, and needs no `allow`.
- "Not found" where the thing should be there (`… is not in the mod`) is not a
  refusal: the person did nothing wrong. It stays an error.

## When the kind is not known yet

- `throw new UnknownFailure(what, e)` (`src/failure.ts`). It reaches the
  renderer's trap (`#fatal`) or `[main error]`, and fails an e2e test at once.
- Each one is a place still to be decided: when it is understood, it gets a
  class and a message of its own, and `UNKNOWN_AT_MOST` in the guard goes down
  by one. The number is never raised.
- "The file is not there" is the one failure a "may not exist yet" catch is
  about: test it with `isMissing(e)`; anything else goes on.

## Where a loop meets a bad item

One unreadable file among many is reported (`noteFailure` / `mainFailed`) and
skipped; the scan goes on. A read whose failure would be taken for "empty" —
a mod's manifest, a roster — throws instead: the next write would replace what
is there with nothing. Where an owner's decision says the loss is accepted
(the Pandora sidecar costs its boxes, not the map), the loss is reported.

---
paths:
  - "**/*.{spec,test}.{ts,tsx,js,jsx,mjs,cjs}"
  - "**/e2e/**"
  - "**/test/**"
  - "**/tests/**"
  - "**/unit/**"
  - "**/__tests__/**"
---

# Tests: fail at the moment, wait for the end

A test that waits out a timeout when something broke costs minutes and names
the wrong thing. A test that infers "done" from a side effect, with a timeout
chosen by guess, waits even when the work finished at once. Both go away when
the app reports what happened and the test listens.

## A failure fails the test at once

- The harness watches every launch for the app's own reports: an uncaught
  throw or rejection, the UI's error log, the server's failure marker, a dead
  process. The first one not allowed ends the test, with the report as the
  reason.
- A test that provokes a failure on purpose says so at launch, as narrowly as
  the text it expects.
- A wait that polls outside the test framework checks for a report on every
  turn.

## A gesture is an action the test waits on

- Every gesture a test touches runs as an **action**: one name, started in
  the gesture itself, ended once as **done**, **refused** or **failed**, with
  its time, on one stream the UI and the test both read. An observable stream
  (RxJS) is the shape: a timeout or a cancellation is part of the pipe. Only
  the gestures are wrapped; the work inside them stays as it is.
- An action has a **budget**: one second unless it says more, with the reason
  beside the number. Going over is a failure report naming the action; the
  work is not cut off for the person.
- The test's **press**: click, take the action the click started — none is a
  failure at once, the control is wired to nothing — and wait for that
  action's end, however long and no longer. The outcome must be done, or the
  refusal the test names.
- An action's end covers everything the person waits for (making a thing
  AND opening it), so nothing is left running into the next test.
- Work nobody clicked (a watcher, a background job) that a test waits on is an
  action too.

## Two layers

- **The logic**: the action stream says what was done, how it ended, how long
  it took.
- **The view**: after a press, one check of what the person sees. It waits for
  nothing: the work is over. A drawn thing is checked on what is drawn; a read
  of the state that should have drawn it is not a paint check.

## Every test is proven

- A new test is broken on purpose once — the line it guards changed — and must
  go red, then restored. A hang is a finding, not a pass.
- A check done by hand in a console goes into a test in the same change.
- A slow wait is shown while the run is going (a reporter listing every wait
  over two seconds, and every timeout a test went on past, with its line).

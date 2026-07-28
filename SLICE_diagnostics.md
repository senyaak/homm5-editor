# SLICE — The app says what is wrong with it, and stops hiding in one file

> **Status:** nothing built yet; the case for it is a day of debugging that
> should have cost minutes. Two duplicate `id`s in `renderer/index.html` sent
> every error a mod form ever raised to a slot behind another dialog, and four
> e2e failures in a row read, from the outside, as "the window hangs" — the
> reasons were in the run's own artifacts all along, unread. This slice makes
> what the app knows reach a file and a person, and cuts the renderer into
> pieces small enough that the next such bug has nowhere to sit.
> When it ships, fold what is worth keeping into
> [docs/E2E_RECONSTRUCTION.md](docs/E2E_RECONSTRUCTION.md) and README, and
> retire this file.

Reading first: [README.md](README.md) (what the renderer is),
[e2e/launch.ts](e2e/launch.ts) (the suite already collects the app's stdout and
uncaught renderer errors — this generalises that), and
[playwright.config.ts](playwright.config.ts) (`maxFailures: 1`, the same
instinct applied to runs).

---

## 1. Scope

1.1. **In:**

- а) **A test that no `id` is used twice.** Read `renderer/index.html`, pull
  every `id="…"`, fail on a repeat, naming both places. Today it passes at
  323/323 — the two duplicates are already gone — so it lands green and stays a
  guard rather than a chore. Cheap, deterministic, and it runs before the app
  does: Chromium's own `[DOM] Found N elements with non-unique id` warning is
  real but only arrives once a page is up and something asks for that element.
- б) **The same guard at runtime, in `$()`.** It is the single door to every
  element in the renderer, so one check there covers everything the markup
  test cannot see (anything built by script). Dev only — a flag turns it off in
  a packaged build, where it must cost nothing.
- в) **One log file, everything in it.** The main process's own output
  (`[perf]`, `[open]`, `[new]` are already there), the renderer's console
  through `webContents.on('console-message')` — which is how Chromium's own
  warnings arrive: failed resources, CSP violations, deprecations —
  `uncaughtException` and `unhandledRejection` in both processes, and
  `render-process-gone`. One file per run under the app's data folder, a few
  kept, the newest reachable from the app.
- г) **The suite fails on an unexpected warning.** With (в) in place the e2e
  runs get an invariant they have never had: nothing in the log above a level
  we allow. This is the part that pays for (в) — the renderer has
  `.catch(() => {})` in a few places, and an error that lands in one of those is
  invisible today.
- д) **Split the renderer, one dialog at a time.** `renderer/index.html` is 1651
  lines and 21 `<dialog>`s; `renderer/app.ts` is 8148 lines. Each dialog gets
  its markup in `renderer/parts/<name>.html` and its code in
  `renderer/<name>.ts`, assembled by the existing build step
  ([tools/build-renderer.ts](tools/build-renderer.ts)); `index.html` keeps only
  the shell. Mechanical, verifiable move by move — the 52 top-level e2e specs
  drive this UI by `id` and would catch a mistake at once.
- е) **A crash dialog that ends in a filed ticket.** For UNHANDLED errors only:
  copy the details, open the log, or open a prefilled
  `github.com/senyaak/homm5-editor/issues/new?title=…&body=…` carrying version,
  platform and stack. Nothing is sent by the app; the browser shows the text and
  the person decides. One dialog per error signature per session.

1.2. **Out (deferred — "потом"):**

- а) A framework. No React, no Vue, no build-time templating language. The split
  is files and a build step that concatenates them; the DOM code stays what it
  is.
- б) Telemetry of any kind. Nothing leaves the machine without a person pressing
  a button in their own browser.
- в) Restructuring `electron/main.ts` (2503 lines). It has the same smell and is
  a separate slice; the renderer is where the bugs of this kind actually
  happened.
- г) A log viewer inside the app. "Open the folder" is enough until it is not.

## 2. Why — what went wrong, and what would have caught it

2.1. **A duplicate `id` is silent where it matters.** `getElementById` returns
the first match and the DOM spec permits the repeat, so `id="um-err"` in both
the mods LIST and the mods FORM meant every message `submitUnitsMod` ever wrote
landed on the dialog behind the one being looked at. Nobody saw an error
because there was nothing to see. §1.1(а) and (б) make that state impossible to
reach twice.

2.2. **The result of a build was written into a dialog that closes.** The same
family: `am-note` lived inside `artedit`, which closes on success, so
"installed …" was set and then hidden. A test asserted the text and passed —
`toContainText` does not care whether a human can see it.

2.3. **"It hangs" was always a message nobody read.** Four separate failures
this session presented as a window sitting there: the spec waiting out a 30s
timeout on an element that was in the DOM and not on screen, or on an entry that
cannot exist. Playwright had written the reason to
`test-results/*/error-context.md` every time. `maxFailures: 1` is now in place
so a run stops at the first one; §1.1(в–г) is the same idea for the app itself.

2.4. **8148 lines is why the two `id`s never met.** The markup of a form and the
markup of the list it opens over sit 150 lines apart; their handlers sit
thousands apart in another file. Splitting is not tidiness here — it is putting
the two halves of one thing within sight of each other.

## 3. Model

3.1. **Three levels, and only the top one interrupts.**

```
expected     a bad name, a missing donor        → the form's own error line
unexpected   an exception nobody catches        → crash dialog + log + ticket
everything   perf lines, warnings, console      → the log file, always
```

3.2. **The log is a file, not a stream to watch.** One per run,
`<userData>/logs/<timestamp>.log`, last ten kept. Every line stamped and
tagged with where it came from (`main`, `renderer`, `chromium`). The point is
that it exists when something has already gone wrong, not that anyone tails it.

3.3. **A part is markup plus code with one name.** `parts/unitedit.html` and
`unitedit.ts` — nothing else in the tree may reach into that dialog's ids. The
uniqueness test then means something stronger after the split than before: no
part may collide with another part.

3.4. **The ticket is a URL, not a request.** The app composes it and opens a
browser. That answers the privacy question by construction — the body contains
paths with a user name in them, and the person reads it before it goes anywhere.

## 4. Touchpoints

| File | What happens to it |
| --- | --- |
| [tools/test-renderer-ids.ts](tools/test-renderer-ids.ts) *(new)* | §1.1(а). Parses the markup, fails on a repeated `id`, naming both lines. Registered in `package.json` so `npm test` runs it. |
| [renderer/app.ts](renderer/app.ts) | `$()` grows the dev-only duplicate check (§1.1(б)); then loses 8000 lines to `renderer/<name>.ts` (§1.1(д)). |
| [electron/log.ts](electron/log.ts) *(new)* | §1.1(в). Opens the run's file, subscribes to both processes, writes tagged lines. |
| [electron/crash.ts](electron/crash.ts) *(new)* | §1.1(е). The dialog, the signature-per-session rule, the issue URL. |
| [electron/main.ts](electron/main.ts) | Calls both at startup, before the window; `webContents` handlers hang off the window it already creates. |
| [renderer/index.html](renderer/index.html) | Keeps the shell; the 21 dialogs move out to `renderer/parts/`. |
| [tools/build-renderer.ts](tools/build-renderer.ts) | Assembles the parts into the page before esbuild runs on the modules. |
| [e2e/launch.ts](e2e/launch.ts) | Already collects stdout and page errors; gains the assertion that the log holds nothing above the allowed level (§1.1(г)). |
| [package.json](package.json) | `test-renderer-ids`; nothing else new. |

Verification, in order: the id test fails on a planted duplicate and passes on
the tree as it stands; the log file holds a line from each source after a plain
start-and-quit; a thrown error in a handler reaches the dialog and the log; the
52 top-level e2e specs stay green across every step of the split.

## 5. Open questions (need a call before code)

5.1. **Do Chromium's own `[DOM]`/`[Violation]` messages reach
`webContents.on('console-message')`?** Some DevTools-issued messages never leave
DevTools. A ten-line probe answers it: a page with a planted duplicate `id`, and
see whether the handler fires. It decides only how much §1.1(в) catches for
free — the id test does not depend on it.

5.2. **What counts as "above the allowed level" for §1.1(г)?** Errors,
certainly. Warnings are the question: a stock Electron start already prints
security warnings in dev, and a rule that fails on those fails always. Probably:
errors fail, warnings are listed in the run summary, and a named allow-list
keeps the known ones quiet.

5.3. **How far does the split go in one pass?** Twenty-one dialogs is a lot of
mechanical moves. Suggested: the mods dialogs first (they are where the bugs
were), then the map picker and object palette, then the rest as they are
touched — rather than a single sweep that no review can hold.

5.4. **Where does the log live for a packaged build?** `app.getPath('userData')`
is the obvious answer and it is not where a person looks. The crash dialog's
"open the log" button covers it; a copy beside the executable would be friendlier
and is a decision, not a detail.

5.5. **Does the crash dialog belong in dev too?** It would interrupt e2e runs,
which is exactly what a test wants to avoid. Likely off when `HOMM5_ROOT` or
another test marker is set, and the log carries the same information anyway.

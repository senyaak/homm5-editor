# SLICE — The app says what is wrong with it, and stops hiding in one file

> **Status:** nothing built yet, but the five questions this slice used to end
> on are answered by measurement now, not opinion — §5 carries the answers and
> §6 the list of defects they turned up. The case for it is a day of debugging
> that should have cost minutes. Two duplicate `id`s in `renderer/index.html`
> sent every error a mod form ever raised to a slot behind another dialog, and
> four e2e failures in a row read, from the outside, as "the window hangs" — the
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

- а) **A test that no `id` is used twice.** Read `renderer/parts/*`, pull
  every `id="…"`, fail on a repeat, naming both places. Today it passes at
  323/323 — the two duplicates are already gone — so it lands green and stays a
  guard rather than a chore. This is the whole mechanism, not a nicety on top of
  the log: Chromium's `[DOM] Found N elements with non-unique id` never leaves
  its own DevTools window (§5.1 — measured on four channels), so nothing else
  will ever tell us.
- б) **The same guard at runtime, in `$()`.** It is the single door to every
  element in the renderer, so one check there covers everything the markup
  test cannot see (anything built by script). Dev only — a flag turns it off in
  a packaged build, where it must cost nothing.
- в) **One log file, everything in it.** The main process's own output
  (`[perf]`, `[open]`, `[load]`, `[ipc]` are already there), the renderer's
  console through `webContents.on('console-message')`, `uncaughtException` and
  `unhandledRejection` in both processes, and `render-process-gone`. One file
  per run under `tmpRoot()/logs`, a few kept, the newest reachable from the app.
  What that channel does and does not carry is measured, not assumed — §5.1.
- г) **No warnings. Not "few" — none.** With (в) in place the e2e runs get an
  invariant they have never had: the log holds nothing at warning or error
  level, and there is no allow-list. A permanent warning nobody can clear is
  how a person learns to stop reading warnings, which is exactly the habit that
  let two duplicate `id`s live in the markup. Two things have to happen before
  the rule can be switched on: the levels must stop lying (§6.1) and the
  warnings we do have must be fixed rather than excused (§6). What is left over
  is not an exemption list but a debt register — every line a number that may
  only go down.
- д) **Split the renderer by section, not by dialog.** DONE, and it grew into
  its own slice — see [SLICE_renderer_layout.md](docs/_slices_done/SLICE_renderer_layout.md).
  `renderer/app.ts` is 803 lines rather than 8676, and the sections live under
  `renderer/{core,viewport,features}`. The measurement in §5.3 held: the
  dialogs were never the unit, the sections were. The markup followed a day
  later — `renderer/index.html` is assembled from `renderer/page.html` and
  `renderer/parts/`, which needed the build step §1.2.а allowed for and no
  more than that. The deeply-wired sections named in §1.2.д turned out to be
  movable after all once shared state was put on named objects.
- е) **A crash dialog that ends in a filed ticket.** For UNHANDLED errors only:
  copy the details, open the log, or open a prefilled
  `github.com/senyaak/homm5-editor/issues/new?title=…&body=…` carrying version,
  platform and stack. Nothing is sent by the app; the browser shows the text and
  the person decides. One dialog per error signature per session, and never when
  a debugger is attached (§5.5).

1.2. **Out (deferred — "потом"):**

- а) A framework. No React, no Vue, no build-time templating language. The split
  is files and a build step that concatenates them; the DOM code stays what it
  is. **This is what shipped** (2026-07-31): `<!-- @include parts/x.html -->`,
  replaced verbatim, one level deep — see
  [SLICE_renderer_layout.md](docs/_slices_done/SLICE_renderer_layout.md) §4.
- б) Telemetry of any kind. Nothing leaves the machine without a person pressing
  a button in their own browser.
- в) ~~Restructuring `electron/main.ts` (2671 lines). It has the same smell and
  is a separate slice; the renderer is where the bugs of this kind actually
  happened.~~ Done on 2026-07-31, as the separate slice this called for: 3011
  lines down to 187, the handlers in `electron/channels/` — see
  [SLICE_renderer_layout.md](docs/_slices_done/SLICE_renderer_layout.md) §1.
- г) A log viewer inside the app. "Open the folder" is enough until it is not.
- д) ~~The deeply-wired sections of `renderer/app.ts` — regions, the terrain
  parts, the palettes.~~ Moved after all, once the shared state they hold was
  put on named objects rather than module globals — see
  [SLICE_renderer_layout.md](docs/_slices_done/SLICE_renderer_layout.md) §2.2. It was a design
  job, as predicted; the design was one object per thing being shared.

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

2.4. **8676 lines is why the two `id`s never met.** The markup of a form and the
markup of the list it opens over sit 150 lines apart; their handlers sit
thousands apart in another file. Splitting is not tidiness here — it is putting
the two halves of one thing within sight of each other.

## 3. Model

3.1. **Three levels, and only the top one interrupts.**

```
expected     a bad name, a missing donor        → the form's own error line
unexpected   an exception nobody catches        → crash dialog + log + ticket
everything   perf lines, measurements, console  → the log file, always
```

3.2. **A level is a claim, and it has to be true.** `console.error` means
something is broken; `console.warn` means something is wrong and still running;
everything else is a measurement. Today the app breaks this in both directions —
`[ipc] map:open-archive 14119ms` goes out as an error and is a timing, while
`[perf] jank` is a genuine warning about a genuine defect. Until the labels are
honest the invariant in §1.1(г) cannot be written at all, and once they are, it
needs no allow-list.

3.3. **The log is a file, not a stream to watch.** One per run, under
`tmpRoot()/logs/<timestamp>.log` — which is `<repo>/_tmp/logs` in a checkout and
`<userData>/_tmp/logs` in a packaged build, a split
[electron/paths.ts](electron/paths.ts) already makes. Every line stamped and
tagged with where it came from (`main`, `renderer`). The point is that it exists
when something has already gone wrong, not that anyone tails it.

3.4. **A part is markup plus code with one name.** `parts/unitedit.html` and
`unitedit.ts` — nothing else in the tree may reach into that dialog's ids. The
uniqueness test then means something stronger after the split than before: no
part may collide with another part.

3.5. **The ticket is a URL, not a request.** The app composes it and opens a
browser. That answers the privacy question by construction — the body contains
paths with a user name in them, and the person reads it before it goes anywhere.

## 4. Touchpoints

| File | What happens to it |
| --- | --- |
| [tools/test-renderer-ids.ts](tools/test-renderer-ids.ts) *(new)* | §1.1(а). Parses the markup, fails on a repeated `id`, naming both lines. Registered in `package.json` so `npm test` runs it. |
| [renderer/app.ts](renderer/app.ts) | `$()` grows the dev-only duplicate check (§1.1(б)); the three loose sections leave for `renderer/<name>.ts` (§1.1(д)); the five `.catch(() => {})` report instead of swallowing (§6.5). |
| [renderer/page.html](renderer/page.html) | Gains a CSP (§6.2). The shell, now that the dialogs have moved out to `renderer/parts/` (done). |
| [electron/log.ts](electron/log.ts) *(new)* | §1.1(в). Opens the run's file, subscribes to both processes, writes tagged lines. |
| [electron/crash.ts](electron/crash.ts) *(new)* | §1.1(е). The dialog, the signature-per-session rule, the issue URL, the debugger check. |
| [electron/main.ts](electron/main.ts) | Calls both at startup, before the window; the `[ipc]` and `[perf]` lines stop going out as errors (§6.1). |
| [tools/build-renderer.ts](tools/build-renderer.ts) | Assembles `renderer/parts/*.html` into the page. The CODE split needs nothing here — esbuild already bundles ESM, which `code-editor.ts`, `particles.ts` and `skinning.ts` have relied on all along. |
| [e2e/launch.ts](e2e/launch.ts) | Already collects stdout and page errors; gains the assertion that neither the log nor `page.on('console')` holds anything at warning or error (§1.1(г)). Both, because they see different things — §5.1. |
| [package.json](package.json) | `test-renderer-ids`; nothing else new. |

Verification, in order: the id test fails on a planted duplicate and passes on
the tree as it stands; the log file holds a line from each source after a plain
start-and-quit; a thrown error in a handler reaches the dialog and the log; the
52 top-level e2e specs stay green across every step of the split.

## 5. Answered — by probe, not by opinion

The probes were throwaway: a scratch Electron app loading a page with a
duplicate `id`, a missing image and a long handler, read through four channels;
then the real editor started twice, once plain and once opening a map.

5.1. **Chromium's `[DOM]` warning reaches nobody.** `console-message` carries
the renderer's `console.*` at every level, `Uncaught Error`, `Uncaught (in
promise)`, and Electron's own security warning. It does NOT carry `[DOM] Found N
elements with non-unique id`, `[Violation]`, or a failed resource load — and
opening DevTools does not change that, because the DevTools frontend writes that
line into its own window. Attaching CDP from outside and asking for
`DOM.getDocument`, which is what the Elements panel does, produces nothing
either. So §1.1(а) is the mechanism. One asymmetry worth keeping: under
Playwright the `Log` domain is enabled, so a test DOES see
`Failed to load resource: net::ERR_FILE_NOT_FOUND`, which the app's own log
never will — the e2e invariant must read both channels.

5.2. **The allowed level is "nothing".** A plain start produces one renderer
warning (Electron's own, for the missing CSP) and one stdout line. Opening a map
adds `[perf] loadMap`, two splat timings, the `[open]`/`[load]`/`[ipc]` lines —
and one more warning, `[perf] jank: main thread blocked 116ms`, which is a real
defect and belongs in §6, not in an allow-list. `src/*.ts` prints no warnings or
errors at all, so the surface is small enough to hold at zero.

5.3. **The split goes by section, and the first pass is about 1500 lines.** The
19 dialogs are 483 of the 1703 lines of markup and 206 of the 323 ids, but only
**351 of 8676 lines of `app.ts`** — 4%. Counting mentions of `scene`, `world`,
`renderer` and `camera` inside each section separates the loose from the wired:

| section | lines | shared state |
| --- | --- | --- |
| Units & Artifacts + sets + Recolor | 929 | 2 × `hud`, 1 × `view` |
| campaigns + one mission | 283 | 2 × `hud`, 1 × `view` |
| map settings dialog | 277 | 2 × `hud` |
| regions | 550 | 16 × `hud`, 10 × `world`, 5 × `scene` |
| terrain-projected parts | 696 | 20 × `world`, 7 × `scene` |

The first three are where the bugs of §2 happened and carry almost no shared
state; they go first. The last two are §1.2(д).

5.4. **The log's home is already decided.** `app.getPath('userData')` is
`…/AppData/Roaming/homm5-editor`, but nothing new has to be chosen:
`tmpRoot()` in [electron/paths.ts](electron/paths.ts) already resolves to the
checkout's `_tmp` in dev and to userData in a packaged build, and `.gitignore`
covers both `_tmp/` and `*.log`. A packaged Windows build has no console at all,
so the file is the only output there — which is why §1.1(е) opens it for the
person rather than telling them where it is.

5.5. **The app can tell it is being driven.** Playwright launches Electron with
`--inspect=0 --remote-debugging-port=0`. They do not appear in `process.argv`,
but `app.commandLine.hasSwitch('remote-debugging-port')` is `true` under
Playwright and `false` on a normal start. So the crash dialog suppresses itself
on that, with no new environment variable — and the rule reads correctly on its
own terms: do not interrupt when someone is holding a debugger. The log is
written either way.

## 6. The debt register

Not an allow-list. Every line is a defect with a number, the number may only go
down, and §1.1(г) switches on when the first two are done — otherwise the suite
is red on day one for things that are not defects.

6.1. **The levels lie.** `[ipc] <channel> <ms>` and `[ipc] … still running`
leave through `console.error` in `electron/main.ts`, and they are timings. Move
the measurements to `console.log`; leave `console.error` to failures.

6.2. **No CSP.** `renderer/page.html` carries no
`http-equiv="Content-Security-Policy"`, which is why every single run prints
Electron's security warning. The warning is right; the fix is the header, not a
flag.

6.3. **`[perf] jank: main thread blocked 116ms`** on opening a map
([renderer/app.ts](renderer/app.ts), the render loop, `JANK_MS = 100`). In the
same run `[perf] splat surface 112ms` and `splat underground 111ms` — building
the splat textures on the main thread is almost certainly the whole of it.

6.4. **`[ipc] map:open-archive 14119ms`** for a 23-file map. Fourteen seconds on
first open. The largest number found and the least understood.

6.5. **Five `.catch(() => {})` in `renderer/app.ts`** — around
`showExtensionState` and the two mod-preset loaders. An error there reaches
neither the log nor the dialog, so "no warnings" would be true by omission.

6.6. **A literal NUL byte in `renderer/app.ts`**, in the tree-path key
separator: written as the raw byte instead of `'\0'`. Every `grep` over the file
stops there and reports "binary file matches" — a tool that lies quietly, which
this project has paid for once already.

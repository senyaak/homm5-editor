# The e2e suite

The playwright specs drive the real Electron window. What the suite is for and
how it is run is in [testing.md](testing.md); this page is how a spec is
written so that it tests the path a person takes, and fails the moment it goes
wrong.

## Every gesture is checked by its outcome

- **After every click, the renderer threw nothing.** A test that reads only
  text on the screen passes over a dead renderer: the static markup stays,
  locators resolve, earlier messages are still there. The one thing that tells
  them apart is `ed.errors` from `launchEditor`. Close with `closeEditor(ed)`
  from `e2e/launch.ts` — it closes AND checks `errors === []`; expected
  exceptions go in as a regexp, `closeEditor(ed, /WebGL/)`. In a dialog's
  spec, press through a helper — click, then at once `expect(ed.errors)
  .toEqual([])` and an empty form error — never a bare `.click()`. A check at
  the end only catches the error after the next `expect` has waited out its
  timeout over a dead handler (the owner, 19.09.2026: "every button press with
  a check that nothing threw, otherwise you wait for the timeout").
- **Every gesture asserts its visible effect**: the row was found and visible
  BEFORE the click, the dialog closed, the value applied. An unchecked click
  waits out a timeout and hides the cause. Mind the UI's filters — a picker's
  search works INSIDE the active category, so pick "All" first.
- **A harness that documents a precondition ensures it.** `tileToScreen` was
  written for the plan camera while the object specs ran in perspective, so a
  click "on a tile" took another tile, or nothing, silently. `screenOf` now
  switches to the plan view itself and `placeAtTile` checks the way back: the
  pixel must pick the tile it was computed from, or the test goes red naming
  the tile it hit.
- **An external tool's crash is not "no differences".** Tell "exit 1 with a
  report" (data) from "died without one" (throw).

## Build through the window, not under it

A map in a spec is built with the palette — `pickObject(page, shared)` and
`placeAtTile(page, x, y)` from `e2e/objects.ts` (the template is `placeOne` in
the sharpshooter specs): arm the swatch, click the tile, take the id from the
diff of `window.view.objects()`. Never `window.editor.addObject` with a path
written by hand: every `Shared` came out without its
`#xpointer(/AdvMapHeroShared)`, the game resolved none of them, and the map
had no heroes and no start player. A literal `.xdb` path in a spec is already
suspicious. (`place-objects.spec` calls `addObject` on purpose: its subject is
the defaults of every type, not a map.)

The same holds for every window: a spec that sets a manifest field the window
does not show is testing a path no person takes.

## Chains of specs

- **Playwright restarts the worker after ANY failed test**: `afterAll` runs in
  the old worker, `beforeAll` again in the new one. A cleanup in `beforeAll`
  then wipes what the earlier tests made, and the next test sees a fresh app
  on the start screen. In a chain, `beforeAll` only ENSURES its fixtures
  (idempotent, deletes nothing), the first test makes the clean slate itself,
  the final tidy-up is at the end of the last test, and `afterAll` only closes
  the app. A comment above the code saying "beforeAll deletes nothing" is not
  a check — read the code under it.
- **One map per group, not parallel workers.** The time is in map loads (A2C1M1
  is 13 s to open), not in Electron starts (1.7 s). Specs that ask questions of
  the same scene share one load; a new test goes into the file that already
  has its subject and map. Parallel workers were measured faster and rejected:
  two tests measure TIME and flake under load. Each test then picks ITS OWN
  object — five took `objects()[0]`, right while the map held one thing and
  quietly someone else's on a shared one. A map's name is declared in `MADE`
  (`e2e/artifacts.ts`) or the run refuses to start.
- **Waiting "until the frame stops changing" is slower than a fixed pause**: an
  animated scene never gives two equal frames, so the loop spends its whole
  limit.

## Runs that touch an install

An ordinary run gives the mod specs a throwaway install under `_tmp/` and
deletes it at the end — it never touches `<game>/H5E/`. A **live run**
(`npm run e2e-live -- <spec…>`, see `tools/e2e-live.ts`) runs against the
install the checkout points at and keeps what the specs make: the patched
executable, `H5E/homm5-editor.h5u`, packed maps. It rebuilds our mod from
nothing by design — that is how what the specs built gets into the game, and
it is not asked about. What is guarded against is an ACCIDENTAL reset (a
single unrelated spec once emptied the mod, 05.08.2026): the banner at the
start of a run says what it is about to do, and a destructive line there is
what the output is read for. A live run also strips the QoL settings from the
install; the owner reapplies them from the panel.

## Seeing what the window draws

- The app's frame is captured with `page.evaluate(() => window.view.snapshot())`
  — it renders and calls `toDataURL()` in one tick. A screenshot of the
  Electron WINDOW comes back without the WebGL layer.
- A probe script that launches the app loads the BUILT `renderer/app.js`: start
  it with `npm run build:renderer`, or it measures code that is not in the
  window (an hour, 05.08.2026).
- When a run goes quiet: `e2e/trace.ts` prints anything slower than a second
  (`SLOW`), anything that threw (`FAIL`, with the gesture's name), and a
  heartbeat while waiting on a save or a pack; `E2E_TRACE=1` prints every
  gesture, and the last line before the silence is the culprit.

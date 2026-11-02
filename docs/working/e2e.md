# The e2e suite

How a playwright spec is written. Running the suite: [testing.md](testing.md).

## Every gesture is checked

- A failure the app reports ends the test at once, with the report
  (`e2e/failures.ts`): a throw or unhandled rejection in the renderer, a
  `console.error`, a `[main error]` / `[failure]` line, a dead renderer. A spec
  that provokes one on purpose allows it at launch, as narrowly as its text:
  `launchEditor({}, [], { allow: /WebGL/ })`. Close with `closeEditor(ed)` from
  `e2e/launch.ts` (closes AND asserts nothing unallowed was reported). In
  dialog specs press through a helper that clicks, then asserts the form error
  empty — never a bare `.click()`.
- Every gesture asserts its visible effect: the row exists and is visible
  BEFORE the click, the dialog closed, the value applied. A picker's search
  works inside the active category: pick "All" first.
- A harness helper that has a precondition ensures it itself (`screenOf`
  switches to the plan view; `placeAtTile` checks the pixel picks the tile it
  came from).
- An external tool: "exit 1 with a report" is data, "died without one" is an
  error.

## Press an action, wait for its end

- A control a spec presses is bound with `onAct(id, name, work, { budget })`
  (`renderer/core/actions.ts`): its click starts an action that ends once, as
  done, refused or failed, on the window's action list. A budget over the
  default 1 s carries its reason beside the number; going over is a console
  error, so the test fails with the action's name.
- The spec presses it with `press(page, locator)` / `pressBar(page, sel)`
  (`e2e/press.ts`): a click that starts no action fails at once; otherwise the
  press waits for that action's end, however long, and the outcome must be
  `done` — or the refusal the spec names, `{ refused: /already exists/ }`.
- After the press, one check of what the person sees; it waits for nothing.
- An action's end covers everything the person waits for (generating AND
  opening the map), so nothing is left running into the next test.

## Build through the window

- A map in a spec is built with the palette: `pickObject(page, shared)` +
  `placeAtTile(page, x, y)` from `e2e/objects.ts`. Never
  `window.editor.addObject` with a hand-written path; a literal `.xdb` path in
  a spec is a red flag. (`place-objects.spec` is the exception: its subject is
  the defaults of every type.)
- A window is driven through its controls; never set a manifest field the
  window does not show.

## Chains

- Playwright restarts the worker after any failed test (`afterAll` in the old
  worker, `beforeAll` in the new). So in a chain: `beforeAll` only ensures
  fixtures and deletes nothing; the first test makes the clean slate; the last
  test tidies up; `afterAll` only closes the app.
- Tests that question one map share one load: add the test to the file that
  already has that map. No parallel workers — timing tests flake under load.
- On a shared map each test selects ITS OWN object, never `objects()[0]`.
- A spec's map name is declared in `MADE` (`e2e/artifacts.ts`).
- Prefer a fixed pause to "wait until the frame stops changing" — an animated
  scene never stops.

## Installs

- An ordinary run builds the mod in a throwaway install under `_tmp/` and
  never touches `<game>/H5E/`.
- `npm run e2e-live -- <spec…>` runs against the install the checkout points
  at and keeps what it built; it rebuilds our mod from nothing — intended, not
  asked about. It also strips the QoL settings; the owner reapplies them.
- Read the banner at the start of a run: a destructive line there means stop
  if it was not intended.

## Seeing the frame

- Capture the app's frame with `page.evaluate(() => window.view.snapshot())`;
  a window screenshot has no WebGL layer.
- A probe script that launches the app loads the built renderer: run
  `npm run build:renderer` first.
- A quiet run: `e2e/trace.ts` prints `SLOW`, `FAIL` and heartbeats;
  `E2E_TRACE=1` prints every gesture — the last line before silence is the
  culprit.

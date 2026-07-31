# SLICE — The renderer stops being one file, and the rest follows

> **Status:** DONE (2026-07-30 / 07-31), and this file can be retired once its
> rules have been read once more by whoever comes next. `renderer/app.ts` went
> from 8996 lines to 803, `electron/main.ts` from 3011 to 187, `src/`'s 66 flat
> files into ten folders, and `renderer/index.html`'s 2023 lines into a shell,
> 20 parts and 20 stylesheets. Every layout is in
> [CONTRIBUTING.md](../../CONTRIBUTING.md) → *Layout*; what is left below is the four
> rules that made the passes survivable and the checks that proved each one.

Reading first: [CONTRIBUTING.md](../../CONTRIBUTING.md) (the layout and the import
rules as they stand), and §1.д of [SLICE_diagnostics.md](../../SLICE_diagnostics.md),
which asked for this split and named the sections to start from.

---

## 1. What was done

The renderer now has three layers, and the dependency direction is one-way:
`core/` knows nothing above it, `viewport/` may use `core/`, `features/` may
use both.

```
core/       dom · ipc · dialog · prefs · state · coords · rosters · dirty
viewport/   stage · lighting · materials · geoms · splat · terrain-mesh · world
            instancing · idle · fx · point-lights · overlays · particles · skinning
features/   shell · map-session · selection · history · palettes · regions
            inspector/{panel,controls,tree,map-props,refs}
            terrain-brush/{brush,sculpt} · text-editor/{document,context,code-editor}
            localization · campaigns · mods/{units,heroes,recolor,preset,shared}
app.ts      the pointer, the automation hook, the menus, the render loop, init*()
```

The main process has the same shape, one layer deeper each time:

```
paths.ts    where the game, the data and our own folders are
state.ts    the open session and the window, on one object, plus need()
edits.ts · sidecar.ts · spec.ts · localization.ts · mod-install.ts
channels/   17 modules, one per domain, each exporting register()
main.ts     the switches, the window, the timing wrapper, the register calls
```

`channels/` sits beside `ipc.ts`, which stays what it was: the contract — every
payload and result type, and `EditorApi`. A channel module never imports another
channel module; what two of them need lives one layer down (that rule is what
moved `readLoc` and `buildAndInstall` out of the channels that happened to hold
them).

`src/` is grouped by what each file KNOWS rather than by layer, because it is a
library and not an application: `format/` (bytes, no game meaning), `game/`
(where the install is and what it mounts), `map/`, `terrain/`, `scene/`,
`schema/`, `mods/`, `exe/`, `campaign/`, `script/`. The grouping turns out to
be a real dependency order without being made one — `format/` imports nothing
else in src and everything else imports it; `terrain/` and `script/` import
nothing across a folder at all. The three edges that point "backwards" are each
a fact about the game, not a mistake: the roster reads a creature document, the
first-run install puts the extension in, and the scene builder loads a map.

Imports go through package.json subpath aliases — `#core/…`, `#viewport/…`,
`#features/…`, `#src/…`, `#electron/…`. Node's strip-mode and esbuild both
resolve them (`tools/test-idle.ts` imports `#viewport/skinning.ts` and passes,
and the main process now boots entirely on them), so a file can move without
rewriting every path that mentions it.

With ONE exception, which is a rule and not an oversight: inside `src/` the
imports are relative. src is loaded by four runtimes — Node for `tools/`,
Electron for the main process, esbuild for the renderer bundle, and Playwright's
own loader for the e2e suite — and a relative path is the only form all four
resolve without being told how. `tools/` and `e2e/` reach into it the same way.

## 2. The rules that made it work

**2.1. A module is wired by an exported call, never by being imported.**
(`init*()` in the renderer, `register()` in the main process.)
A module whose handlers sit at file scope is wired only while something else
imports it for a value. `features/mods/heroes.ts` has no export the app reads,
so its buttons would have been dead markup — nothing would have failed, the
form simply would not have opened. Worse, file-scope wiring runs DURING module
evaluation: `mtDialog().addEventListener(...)` in `inspector/refs.ts` threw
`mtDialog is not a function` on boot, because `inspector/tree.ts` had not
finished evaluating when the refs module ran. Both problems have the same fix,
and it is the rule now: every handler lives in `init*()`, and `app.ts` calls
them once everything is loaded.

The main process makes the same rule earn its keep for a second reason: its
handlers are all measured by a wrapper main.ts installs around
`ipcMain.handle`, so anything that registered while being imported would be
the one channel with no clock on it. `register()` after the wrapper, in one
visible list, and the order is a fact of the file rather than of the import
graph.

**2.2. State two modules write is a field on a named object.** An ESM live
binding can be read across modules but never assigned, so `export let` works
until a second module wants to set it. Rather than a setter per field:
`state.world` / `state.selected`, `brush` (armed, size, mode, force), `stroke`
(the drag in flight), `armed` (the object and tile a click will place), `doc`
(the open document and its editor), `loc`, `region.anchor`, `sea.base`,
`tiles.inMap`, `session.openedMap`. It also makes the writes greppable: who
owns a transition and who merely reads one.

**2.3. Cut by what the code says it is, never by line number.** Every section
carries its `// --- … ---` banner; cutting on those survives the edits made
between passes. Line numbers do not, and `git checkout renderer/app.ts` in the
middle of a series of cuts silently threw away three finished extractions — the
modules were still on disk, the file they came out of was not.

The main pass went one better and cut by top-level UNIT: a scanner that tracks
brace depth outside strings, comments and regex literals, so a "unit" is one
declaration or one `ipcMain.handle(...)` plus the comments above it, and a
module is named by the units it wants. That it round-tripped the file byte for
byte before a single cut was made is what made the rest of the pass boring.
Two things the scanner had to learn, both of which had eaten the file whole
until they were fixed: a slash after `return` starts a regex, not a division,
and a quote scan that runs past a newline has to give the newline back or every
line index after it is off by one.

**2.4. What two modules of a layer both need lives one layer down.** Not in
whichever of them wrote it first. Every time this was violated the import read
as a dependency between two peers that have nothing to do with each other —
save.ts on loc.ts, the mod listing on the hero form — and the fix was a move,
never an interface.

## 3. What the split turned up on the way

- Placing an object from the palette carried its own copy of `buildGeos`, and
  the copy had already drifted: the comment above it said as much ("Same skin
  wiring as buildGeos/geometryFor, or a brand-new model placed with idles on
  would stand frozen"). Both paths call `registerGeom` now.
- Campaigns carried a second, unchecked `modDialog` (`$(id) as
  HTMLDialogElement`) and a `fillSelect` three other screens wanted.
- Two doc comments described whichever function had ended up under them rather
  than the one they were written for (`terrainGeometry`'s had drifted onto
  `waterCells`); three more stacked above `ask()`, documenting two functions
  declared thirty lines below it.
- The document editor was split across two sections — its state in one, its
  `openTextEdit`/`saveDoc` in another — which only became visible when the two
  landed in different files.

And in the main process:

- `buildAndInstall`'s doc comment was sitting on `modIsEmpty`, which had been
  declared under it; `setEffectsFrom`'s "the same, for a set" pointed forward at
  a function declared after it. Both only look wrong once the pair is alone in a
  short file.
- Three "dependencies" between domains were layer mistakes: packing asked the
  localization CHANNEL whether the map was localized, the mod listing asked the
  hero channel for its enums, and five mod channels shared a tail that lived in
  one of them. All three moved down a layer (rule 2.4).
- The whole handler set is measured by a wrapper installed around
  `ipcMain.handle` before anything registers — which the old file got right by
  accident of ordering, and which is now a comment and a list of calls.

And in `src/`, where the answer was that almost nothing had to change:

- Exactly ONE file in 62 knew where it sat on disk (`project.ts`, walking up to
  `package.json` for the editor version). That is the whole reason a 67-file
  move came down to three hand edits — the other two being `tools/build-api.ts`
  and `tools/script-api.ts`, which build a path to `src/script-api.json` out of
  string parts a specifier rewrite cannot see. Grep for `import.meta` BEFORE
  moving anything; it is the only thing that can silently survive a typecheck
  and fail at runtime.
- `format/` imports nothing else in src, and `terrain/` and `script/` import
  nothing across a folder — which nobody designed. Grouping by what a file
  knows produced a dependency order for free.

## 4. The page, which was the one that needed a build step first

`renderer/index.html` is now GENERATED — gitignored, like `app.js`, and built
by the same script from `renderer/page.html` (the shell), `renderer/parts/`
(20 files: one per screen, dialogs grouped by the feature that drives them) and
`renderer/style/` (20 stylesheets, in cascade order, linked rather than
inlined so DevTools has a filename to show).

`<!-- @include parts/x.html -->` is replaced by that file verbatim. One level,
no nesting, no expressions — §1.2.а of SLICE_diagnostics still holds, and this
is not a step towards a template language. It exists because HTML has no
include of its own and the markup has to BE there before app.js runs: the e2e
suite finds its elements in the static page, and so does the failure trap.

Two things made a 2000-line page safe to take apart:

- **Move verbatim, then prove it.** Every line kept its indentation, so the
  assembled page could be checked against the original: same 792 stylesheet
  lines, same markup lines with none lost and none gained, same 403 ids. The
  check found a real bug on the first run — the splitter walked backwards over
  comment SYNTAX to find each block's leading comment and so took only the last
  line of every wrapped one, dropping 45 lines of prose. Starting each block
  where the previous one ended instead cannot lose anything.
- **Order matters for the stylesheet, not for the dialogs.** The CSS was cut
  only at section boundaries and reassembled in the same order; the `<dialog>`s
  were regrouped freely, which is safe because they are hidden until
  `showModal()` and nothing in the stylesheet reaches from one to another
  (checked before moving any: no sibling combinators). The overlays and `#app`
  stayed last, where their stacking order is decided.

Then the harness answered the question the tests cannot: all 20 stylesheets
loaded (448 rules), `#bar` still computes to a fixed bar at z-index 10, every
panel keeps its z-index, and eight dialogs opened to correctly sized cards.

## 5. How to verify a pass

`npm run typecheck` after every cut — it names each connection the move broke,
which is what makes this safe to do in steps. Then `npm test` (44 suites) and
`npm run test-e2e-fast` (83 pass, 2 skip without `A1C1M1` under the data root).
Do NOT reach for the full `npx playwright test`: the reconstruction chain adds
20+ minutes and covers nothing this work can break that the fast suite does not.

One thing typecheck cannot see: a module that is never imported, wiring that
runs too early, or markup that did not make it into the page. All of them show
up as the app not booting or a screen that is not there, and the fastest read
is `npm run harness` — `#fatal` carries the message (the harness stub has no
`gpuSoftware`, so it stops there of its own accord with `__booted === true`;
anything BEFORE that line is a real failure). It is also where a CSS question
gets answered without launching Electron: computed styles, z-indexes and a
dialog's geometry are all one `javascript_tool` call away.

A move inside `src/` has its own cheap check: `grep -rn "import.meta" src/`.
A file that computes a path from its own location is the one kind of breakage
that typechecks cleanly and fails at runtime, and there is exactly one of them.

For the main process the two cheap checks are worth doing before any test run,
because both answer in seconds:

- **Every channel is still registered.** Collect `ipcMain.handle('…')` across
  `electron/` and compare against `invoke('…')` in `preload.cjs`. They have to
  match exactly, bar setup's own six. A handler that quietly lost its
  `register()` call is otherwise a runtime "no handler registered" on a screen
  nobody opened yet.
- **It boots and loads a map:** `HOMM5_SMOKE=<map.xdb> npx electron .` runs the
  real main process end to end — every module resolved, every subpath alias
  answered by Node rather than by esbuild — and prints one line.

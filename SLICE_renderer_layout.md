# SLICE — The renderer stops being one file, and the rest follows

> **Status:** the renderer is done and green (2026-07-30) and so is the main
> process (2026-07-31). `renderer/app.ts` went from 8996 lines to 803, and
> `electron/main.ts` from 3011 to 187; both layouts are in
> [CONTRIBUTING.md](CONTRIBUTING.md) → *Layout*. What is left is the 66 flat
> files under `src/` and `renderer/index.html` (2023 lines, 30 `<dialog>`s).
> This file carries the rules that made both splits survivable, so the next
> pass does not rediscover them. Retire it when src/ is done and its layout is
> in CONTRIBUTING.

Reading first: [CONTRIBUTING.md](CONTRIBUTING.md) (the layout and the import
rules as they stand), and §1.д of [SLICE_diagnostics.md](SLICE_diagnostics.md),
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

Imports go through package.json subpath aliases — `#core/…`, `#viewport/…`,
`#features/…`, `#src/…`, `#electron/…`. Node's strip-mode and esbuild both
resolve them (`tools/test-idle.ts` imports `#viewport/skinning.ts` and passes,
and the main process now boots entirely on them), so a file can move without
rewriting every path that mentions it.

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

## 4. What is left

4.1. **`src/`, 66 files flat.** Group by what they know: `src/format/` (pak,
gr2, dds, oodle, xml, pe, disasm), `src/map/` (map, objects, terrain*, scene,
geometry), `src/mods/` (creature-mod, artifacts*, heroes, dwellings),
`src/exe/`. Mechanical, but it touches every import in the repo and every
`tools/test-*`, so it wants its own pass with nothing else in flight. The
aliases make it cheaper than it was: a file that moves inside `src/` only
changes the tail of `#src/…`.

4.2. **`renderer/index.html`, 2023 lines, 30 `<dialog>`s.** The riskiest, and
the reason it is last: every id in it is load-bearing for the e2e suite, and
the app has no templating step. Moving markup means adding one (concatenation
at build time, `renderer/parts/<name>.html`), which is a build change on top of
a move. §1.2.а of SLICE_diagnostics still holds — no framework, no template
language.

## 5. How to verify a pass

`npm run typecheck` after every cut — it names each connection the move broke,
which is what makes this safe to do in steps. Then `npm test` (44 suites) and
`npm run test-e2e-fast` (83 pass, 2 skip without `A1C1M1` under the data root).
Do NOT reach for the full `npx playwright test`: the reconstruction chain adds
20+ minutes and covers nothing this work can break that the fast suite does not.

One thing typecheck cannot see: a module that is never imported, or wiring that
runs too early. Both show up as the app not booting, and the fastest read on
that is `renderer/harness.html` — open it, and `#fatal` carries the message
(the harness stub has no `gpuSoftware`, so it stops there of its own accord;
anything BEFORE that line is a real failure).

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

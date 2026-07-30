# SLICE — The renderer stops being one file, and the rest follows

> **Status:** the renderer is done and green (2026-07-30). `renderer/app.ts`
> went from 8996 lines to 803 across four commits, and the layout it landed on
> — `core/` → `viewport/` → `features/` — is described in
> [CONTRIBUTING.md](CONTRIBUTING.md) → *Layout*. What is left is the same job on
> `electron/main.ts` (2825 lines, ~60 IPC handlers in a row), on the 66 flat
> files under `src/`, and on `renderer/index.html` (2023 lines, 30 `<dialog>`s).
> This file carries the rules that made the renderer split survivable, so the
> next pass does not rediscover them. Retire it when main.ts and src/ are done
> and their layout is in CONTRIBUTING.

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

Imports inside `renderer/` go through package.json subpath aliases — `#core/…`,
`#viewport/…`, `#features/…`, `#src/…`, `#electron/…`. Node's strip-mode and
esbuild both resolve them (`tools/test-idle.ts` imports `#viewport/skinning.ts`
and passes, which is the proof for the Node side), so a file can move without
rewriting every path that mentions it.

## 2. The three rules that made it work

**2.1. A feature is wired by an exported `init*()`, never by being imported.**
A module whose handlers sit at file scope is wired only while something else
imports it for a value. `features/mods/heroes.ts` has no export the app reads,
so its buttons would have been dead markup — nothing would have failed, the
form simply would not have opened. Worse, file-scope wiring runs DURING module
evaluation: `mtDialog().addEventListener(...)` in `inspector/refs.ts` threw
`mtDialog is not a function` on boot, because `inspector/tree.ts` had not
finished evaluating when the refs module ran. Both problems have the same fix,
and it is the rule now: every handler lives in `init*()`, and `app.ts` calls
them once everything is loaded.

**2.2. State two modules write is a field on a named object.** An ESM live
binding can be read across modules but never assigned, so `export let` works
until a second module wants to set it. Rather than a setter per field:
`state.world` / `state.selected`, `brush` (armed, size, mode, force), `stroke`
(the drag in flight), `armed` (the object and tile a click will place), `doc`
(the open document and its editor), `loc`, `region.anchor`, `sea.base`,
`tiles.inMap`, `session.openedMap`. It also makes the writes greppable: who
owns a transition and who merely reads one.

**2.3. Cut by text marker, never by line number.** Every section carries its
`// --- … ---` banner; cutting on those survives the edits made between passes.
Line numbers do not, and `git checkout renderer/app.ts` in the middle of a
series of cuts silently threw away three finished extractions — the modules
were still on disk, the file they came out of was not.

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

## 4. What is left

4.1. **`electron/main.ts`, 2825 lines.** Roughly 60 IPC handlers one after
another, each with its own `// --- IPC: … ---` banner. The easiest of the three:
handlers barely reference each other, so they split by domain —
`electron/ipc/{map,terrain,objects,tree,text,loc,campaign,mods,project}.ts`,
each exporting a `register(session)` that main calls. Deferred once already in
§1.2.в of SLICE_diagnostics; nothing has changed except that the renderer now
shows the shape it should land in.

4.2. **`src/`, 66 files flat.** Group by what they know: `src/format/` (pak,
gr2, dds, oodle, xml, pe, disasm), `src/map/` (map, objects, terrain*, scene,
geometry), `src/mods/` (creature-mod, artifacts*, heroes, dwellings),
`src/exe/`. Mechanical, but it touches every import in the repo and every
`tools/test-*`, so it wants its own pass with nothing else in flight.

4.3. **`renderer/index.html`, 2023 lines, 30 `<dialog>`s.** The riskiest, and
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

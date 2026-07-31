# Contributing

Thanks for looking! This is a from-scratch map & campaign editor for **Heroes of
Might & Magic V: Tribes of the East**. It reverse-engineers the game's formats and
rebuilds the editor on Electron + TypeScript, no native deps.

If you're here to hack on it, this file covers the conventions that keep the
project honest. Read [README.md](README.md) for what works and how to run it, and
[ROADMAP.md](ROADMAP.md) for where it's going.

## The one hard rule: no game content in commits

The game's assets — models, textures, maps, `.pak`/`.h5m` archives, unpacked
`data/` — are **copyrighted (Nival / Ubisoft) and must never be committed.**
`samples/` is `.gitignore`d for exactly this reason. You need your own legal copy
of the game to run and test; point `HOMM5_DATA` at an unpacked data folder (or run
`npm run unpack-data` to build one in `data-unpacked`, which stays
untracked). This repo is **code
and format notes only.** A PR that adds game bytes will be rejected.

## Setup

- **Node 24+** (the version bundled in Electron 43 strips TS types natively).
- Your own game install for assets (see above).
- `npm install`, then `npm start` to launch, or `npm run harness` to poke the UI
  in a plain browser without the game. See README → *Running* for all scripts.

## Layout

```
src/        the core — format decoders and the game model, by what each file
            knows. Runs as .ts directly (no build):
              format/   bytes in, bytes out: pak, oodle, dds, texture, gif,
                        gr2, xml, png, recolor — no game meaning in any of them
              game/     where the game is on this machine and what it mounts:
                        env-file, first-run, unpack, assets, mod-paths
              map/      the map document and its project: map, map-tag,
                        map-source, blank-map, new-map, objects, donors,
                        defaults, watch, project, history
              terrain/  GroundTerrain.bin — its own format, its own six files
              scene/    a map + its assets turned into something drawable:
                        scene (the walk) + payload (what crosses IPC), xdb,
                        model-geom, materials, object-effects, skin, splat,
                        water, ambient, geometry, animation, effects, units
              schema/   typed editing: schema, typespec, tree, skeleton,
                        registry, town-bonuses + the two .schema.json
              mods/     content the game does not ship. What a mod HAS is
                        mod-model; what a build reads and returns is mod-files;
                        creature-mod builds the creatures and edits the three
                        game files, with artifact-/hero-/dwelling-files doing
                        the same for the rest; mod-archive writes, packs,
                        installs and reads one back; mod-art copies the art in;
                        xml-edit and model-box are what those are made of.
                        Beside them, what each KIND is: creatures, artifacts*,
                        heroes, dwellings, extension
              exe/      the executable: pe, disasm, exe-*, lua-registry, and
                        the two ceiling patchers
              campaign/ campaign, campaign-project, campaign-pack
              script/   the engine's Lua: lua-lint + the API the editor
                        completes from
electron/   the main process. main.ts is the boot — switches, window, the
            timing wrapper, the register() calls — and beside it:
              ipc.ts     the contract: every payload/result type + EditorApi
              state.ts   the open session and the window, on one object
              edits.ts   record(): run an edit, keep the patch, undo/redo
              sidecar.ts the text files a map references
              spec.ts    the game's types.xml, parsed once
              channels/  one module per domain, each exporting register()
              preload.cjs the bridge (plain CommonJS — see below)
renderer/   the UI. page.html + parts/ + style/ are assembled into index.html,
            and app.ts is bundled into app.js — both by build-renderer:
              page.html  the shell: the <link>s and one @include per part
              parts/     the markup, one file per screen; dialogs/ per feature
              style/     the stylesheet, one file per section, in cascade order
              core/      what every screen shares — dom, ipc, dialog, prefs,
                         state (the loaded world + selection), coords, rosters
              viewport/  the drawing — stage (context, cameras, controls),
                         lighting, materials, geoms, splat, terrain-mesh,
                         instancing, idle, fx, point-lights, overlays
              features/  one folder or file per screen — shell (toolbar,
                         panels, picker), map-session, selection, history,
                         inspector/ (panel, controls, tree, map-props, refs),
                         terrain-brush/, palettes, regions, localization,
                         text-editor/, campaigns, mods/ (units, artifacts,
                         artifact-sets, heroes, recolor, preset over shared)
              app.ts     the pointer, the automation hook, the menus, the
                         render loop, and the init*() calls that wire it all
docs/       the reverse-engineering write-ups and the plans. Keep these in step.
tools/      test scripts (test-*), the harness generator, CLIs.
```

`src/*` is the foundation; `electron/` and `renderer/` are wiring on top. New
format knowledge belongs in `src/` with a test in `tools/` and a note in `docs/`.

Imports go through the subpath aliases declared in package.json — `#core/…`,
`#viewport/…`, `#features/…`, `#src/…`, `#electron/…` — so moving a file does
not rewrite every path that mentions it. Node's strip-mode and esbuild both
resolve them; keep the real `.ts` extension.

Inside `src/` the imports stay RELATIVE (`./x.ts`, `../format/xml.ts`), and
that is deliberate: src is loaded by four runtimes — Node for `tools/`,
Electron for the main process, esbuild for the renderer bundle, and
Playwright's own loader for the e2e suite — and a relative path is the one form
all four agree on without being configured. `tools/` and `e2e/` reach it the
same way, with `../src/…`.

The dependency direction is one-way on both sides. In the renderer: `core/`
knows nothing above it, `viewport/` may use `core/`, `features/` may use both.
In the main process: `paths.ts` → `state.ts` → `edits.ts`/`sidecar.ts`/`spec.ts`
→ `channels/*` → `main.ts`. A channel module never imports another channel
module; what two of them need lives one layer down.

**Wiring is a call, never an import side effect.** A feature binds itself to
its markup in an exported `init*()` that app.ts calls; a channel module wires
its handlers in an exported `register()` that main.ts calls. A module that did
it at file scope works right up until something tidies away an import it looked
unused from — and then the screen is dead markup, or the channel answers "no
handler registered", with nothing anywhere saying why.

**The page is assembled, not templated.** `renderer/index.html` is generated
and gitignored, like `app.js`: edit `renderer/page.html`, `renderer/parts/*` or
`renderer/style/*` and rebuild. `<!-- @include parts/x.html -->` is replaced by
that file verbatim — one level, no nesting, no expressions. This is not a step
towards a template language (§1.2.а of SLICE_diagnostics: no framework); it
exists because HTML has no include of its own and the markup has to BE there
before app.js runs. The e2e suite finds its elements in the static page, and so
does the failure trap. Adding a screen means a part, a stylesheet, an
`@include` line and a `<link>` — a missing part throws at build time rather
than leaving a hole.

## Conventions that matter

- **The format layer is byte-faithful.** `serialize(parse(x)) === x` holds on
  every shipped map; keep it that way. An edit rewrites exactly what changed and
  nothing else — that's what lets the external-change watcher and round-trip
  tests work. Never introduce a lossy read or a reformatting write.
- **Editing goes through the schema, not ad-hoc UI.** `src/schema/map.schema.json` and
  `src/schema/objects.schema.json` describe every field; the tree and the dialog build
  their controls from it (`x-` keywords carry game intent — registries, refs,
  tabs, name handles). To make a field editable, describe it in the schema; the
  UI follows. See [docs/MAP_PROPERTIES.md](docs/MAP_PROPERTIES.md).
- **Edits are path-addressable and recorded.** Map/object edits apply by path and
  run through `record(session, …, {map:true}, …)` so they share undo / dirty /
  save. Don't write a bespoke mutation path.
- **Don't guess — the game is the source of truth.** Enum values, rosters and
  rules come from the data corpus (the shipped maps, `GameMechanics/RefTables`,
  `MapObjects/…`) and the official `Editor Documentation/*.pdf` (read with
  `pdftotext -layout`), never from memory. Rosters are *discovered dynamically*
  (`src/schema/registry.ts`), so mod/Lua-added content appears on its own. When you add
  a value, say where it came from (see the naming/scripting model in
  [docs/NAMES_AND_SCRIPTING.md](docs/NAMES_AND_SCRIPTING.md)).
- **Use the web platform.** Native `<dialog>`, modern DOM/CSS — prefer the
  platform over hand-rolled widgets or a framework. But **never `confirm()`,
  `alert()` or `prompt()`**: in Electron those are native windows that block the
  renderer, so a spec that reaches one hangs until its timeout with nothing to
  read. Ask with `ask(question, label)` — a `<dialog>` that stacks over whatever
  is open, answers no on Esc, and can be read and pressed by a test.
- **Match the surrounding code** — its naming, comment density, and idiom. Files
  carry a short "why" comment at the top; keep that habit.

### TypeScript strip-mode gotchas

`src/`, `electron/`, `tools/` run their `.ts` unbuilt via Node's type stripping,
which only *erases* types — it never emits code. So:

- **No `enum`, no parameter properties** (`constructor(private x)`), no
  `namespace` with runtime output. Declare class fields explicitly and assign in
  the constructor. `tsconfig` has `erasableSyntaxOnly`; if it type-checks, it
  runs.
- **`preload.cjs` stays plain CommonJS JavaScript.** Electron reads a preload
  verbatim with no stripping, so a single type annotation there breaks it
  silently. Keep it in step with the `EditorApi` interface in `electron/ipc.ts`.
- JSON is imported with an import attribute: `import x from './f.json' with {
  type: 'json' }`.

## Dev workflow

Before opening a PR:

```
npm run typecheck    # must be clean — tsc --noEmit across everything
npm run build:renderer
npm run test-map     # + the other test-* relevant to your change
npm run harness      # exercise UI changes in a browser (DOM-level checks)
```

Every change must **typecheck** and keep the **tests green**. If you touched a
format, add or extend a `tools/test-*.ts`. If you touched the UI, verify it in
the harness — the renderer talks to Electron at module scope, so the harness (a
stubbed `window.editor`) is how you drive it headless. Extend the stub in
`tools/make-harness.js` when your feature needs a new IPC (mirror the real
`EditorApi` arg shapes — the stub is called directly, so it takes the raw args).

### Adding common things

- **An editable field** → add it to the right schema with the fitting `x-`
  keywords; the tree/dialog render it. No renderer change for the common cases.
- **A game roster** (spells, a new object class) → `src/schema/registry.ts`, discovered
  from the data tree; add a line to `tools/test-registry.ts`.
- **An IPC channel** → the payload/result types + `EditorApi` in
  `electron/ipc.ts`, the binding in `preload.cjs`, the handler in the
  `electron/channels/` module for its domain (a new domain also needs its
  `register()` called from `main.ts`), and the stub in `tools/make-harness.js`.

## Testing, the big picture

**Which command, and when.** `npm test` is the everyday one: every unit suite
plus `test-e2e-fast`, which is every spec EXCEPT `e2e/c1m1/**`. The bare
`npx playwright test` adds the reconstruction chain — three files of 5 to 10
minutes each, 40 minutes end to end — and belongs before a release or when the
change is in the reconstruction itself. Reaching for it as "run all the tests"
costs three quarters of an hour and answers nothing the fast run did not.

**When you want to PLAY what a spec built.** Every ordinary run gives the mod
specs a throwaway install under `_tmp` and deletes it at the end, so a green run
leaves nothing to launch. `npm run e2e-live -- <spec…>` runs the same specs
against the install this checkout sits in and keeps what they make — the patched
executable, `H5E/homm5-editor.h5u`, and any map a spec packed:

```
npm run e2e-live -- e2e/mod-005-sharpshooter-map.spec.ts
```

That is also how a fixture map gets rebuilt after you have edited it by hand: the
spec authors it from a blank New Map, so the archive in `H5E/` comes back as the
spec describes it and whatever you changed in place is gone. A live run first
takes OUR things back out of the installed mod so the spec builds them from
nothing, and leaves the rest of the archive alone. The flag behind it is
`HOMM5_NO_REMOVE`; pass it through the runner rather than by hand, since
Playwright rejects switches it does not know. See the header of
`tools/e2e-live.ts` and `LIVE` in `e2e/mods.ts`.

**When a run goes quiet.** A spec that drives the window makes hundreds of
gestures inside ONE test, and the reporter prints a line per test — so a working
run and a wedged one look identical for minutes. `e2e/trace.ts` prints anything
that took longer than a second (`SLOW`), anything that threw (`FAIL`, with the
name of the gesture, which the locator error does not carry), and a heartbeat
while `hudSays` waits on a save or a pack. `E2E_TRACE=1` prints every gesture —
when a step hangs, the last line before the silence is the culprit.

Beyond the unit `test-*` scripts, the project's north-star e2e is
**reconstructing the shipped campaign missions from scratch** and diffing against
the originals — see [docs/E2E_RECONSTRUCTION.md](docs/E2E_RECONSTRUCTION.md).
Contributions that move a mission's reconstruction forward, or close a gap it
surfaced, are especially welcome.

## Commits & PRs

- Small, focused commits with a clear imperative subject and a body that says
  *why*, not just *what*. One logical change per PR.
- Keep `docs/` and `ROADMAP.md` in step with the code — a format detail you had
  to discover is worth writing down; the next person shouldn't re-derive it.
- A `SLICE_*.md` at the repo root is work in flight: what it is for, what is in
  scope, and what was measured to decide. When its work lands, move it to
  `docs/_slices_done/` rather than deleting it — the code says what the shape
  is, the slice says why it is that shape.
- Describe how you verified (which tests, harness checks, or — for map/format
  work — that it round-trips and, ideally, loads in the game).

## Scope & etiquette

Bug fixes, format notes, tests, and roadmap items are all fair game — grab a
`⬜` from [ROADMAP.md](ROADMAP.md), or open an issue to discuss a direction
first for anything large. Be kind in reviews; assume good faith.

Unofficial project, not affiliated with Nival or Ubisoft.

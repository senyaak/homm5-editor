# Contributing

Thanks for looking! This is an experimental, from-scratch map & campaign editor
for **Heroes of Might & Magic V: Tribes of the East**. It reverse-engineers the
game's formats and rebuilds the editor on Electron + TypeScript, no native deps.

If you're here to hack on it, this file covers the conventions that keep the
project honest. Read [README.md](README.md) for what works and how to run it, and
[ROADMAP.md](ROADMAP.md) for where it's going.

## The one hard rule: no game content in commits

The game's assets — models, textures, maps, `.pak`/`.h5m` archives, unpacked
`data/` — are **copyrighted (Nival / Ubisoft) and must never be committed.**
`samples/` is `.gitignore`d for exactly this reason. You need your own legal copy
of the game to run and test; point `HOMM5_DATA` at an unpacked data folder (or run
`npm run unpack-data` to build one in `samples/paks/data`, which stays
untracked). This repo is **code
and format notes only.** A PR that adds game bytes will be rejected.

## Setup

- **Node 24+** (the version bundled in Electron 43 strips TS types natively).
- Your own game install for assets (see above).
- `npm install`, then `npm start` to launch, or `npm run harness` to poke the UI
  in a plain browser without the game. See README → *Running* for all scripts.

## Layout

```
src/        the core: format decoders + the map model (terrain, geometry, xml,
            map, registry, schema, skeleton…). Runs as .ts directly (no build).
electron/   the Electron main process + the IPC contract (ipc.ts) + preload.cjs.
renderer/   the UI: app.ts (bundled by esbuild) + index.html. The only built part.
docs/       the reverse-engineering write-ups and the plans. Keep these in step.
tools/      test scripts (test-*), the harness generator, CLIs.
```

`src/*` is the foundation; `electron/` and `renderer/` are wiring on top. New
format knowledge belongs in `src/` with a test in `tools/` and a note in `docs/`.

## Conventions that matter

- **The format layer is byte-faithful.** `serialize(parse(x)) === x` holds on
  every shipped map; keep it that way. An edit rewrites exactly what changed and
  nothing else — that's what lets the external-change watcher and round-trip
  tests work. Never introduce a lossy read or a reformatting write.
- **Editing goes through the schema, not ad-hoc UI.** `src/map.schema.json` and
  `src/objects.schema.json` describe every field; the tree and the dialog build
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
  (`src/registry.ts`), so mod/Lua-added content appears on its own. When you add
  a value, say where it came from (see the naming/scripting model in
  [docs/NAMES_AND_SCRIPTING.md](docs/NAMES_AND_SCRIPTING.md)).
- **Use the web platform.** Native `<dialog>`, modern DOM/CSS — prefer the
  platform over hand-rolled widgets or a framework.
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
- **A game roster** (spells, a new object class) → `src/registry.ts`, discovered
  from the data tree; add a line to `tools/test-registry.ts`.
- **An IPC channel** → the payload/result types + `EditorApi` in
  `electron/ipc.ts`, the binding in `preload.cjs`, the handler in
  `electron/main.ts`, and the stub in `tools/make-harness.js`.

## Testing, the big picture

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
- Describe how you verified (which tests, harness checks, or — for map/format
  work — that it round-trips and, ideally, loads in the game).

## Scope & etiquette

Bug fixes, format notes, tests, and roadmap items are all fair game — grab a
`⬜` from [ROADMAP.md](ROADMAP.md), or open an issue to discuss a direction
first for anything large. Be kind in reviews; assume good faith.

Unofficial project, not affiliated with Nival or Ubisoft.

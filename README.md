# homm5-editor

A from-scratch map & campaign editor for **Heroes of Might & Magic V: Tribes of
the East**, built on Electron and Node with no native dependencies. It reverse-
engineers the game's own formats and rebuilds the editor on top of them — and it
already builds maps the game loads and plays: a mission created here from
scratch, packed by us, runs. The proving ground is rebuilding a shipped campaign
mission click by click (see *Testing* below).

TypeScript throughout. Node 24 — and the Node 24.18 inside Electron 43 — strip
types natively, so `src/`, `electron/` and `tools/` run their `.ts` straight off
disk with no build step; only `renderer/` is bundled (esbuild), because a browser
cannot strip types. `tsconfig.json` is therefore type-check only.

One exception worth knowing: `electron/preload.cjs` must stay JavaScript.
Electron reads a preload verbatim and never applies Node's type-stripping hook,
so a `.cts` preload dies on the first type annotation — silently, leaving
`window.editor` undefined while the window loads as normal.

> **No game content lives here.** This repository holds code and format notes only.
> Running anything requires your own legal copy of the game: the tools read assets
> from its folder (`HOMM5_DATA`, defaulting to `data-unpacked`, which is
> gitignored). Nival/Ubisoft models, textures and maps are neither distributed nor
> to be committed here.
>
> Unofficial project, not affiliated with Nival or Ubisoft.

## What works

Launch with `npm start`. Open a `.h5m` (or make one with **New map…**) and you
get a live 3D scene you sculpt, paint, populate, script and pack.

### Terrain

- **Rendering, end to end**: tile textures through a splat shader compositing by
  `<Priority>`, sea derived from the ground-flag plane, painted river brushes,
  vertical cut faces where ground kinds meet, rock-textured cliffs, and both
  floors. Write-up: [docs/TERRAIN_FORMAT.md](docs/TERRAIN_FORMAT.md).
- **`GroundTerrain.bin`** (`src/terrain.ts`): reads heights, texture layer masks,
  ground flags, passability and the river plane, and writes every one of them
  back. Planes are fixed-size, so a write is a byte-for-byte overwrite in place
  and the output differs only where asked. Round-trip tested on real maps
  (`npm run test-terrain`, `test-terrain-write`).
- **Height brushes**, named as the original editor names them. *Bulk* and *Dig*
  sculpt smoothly with a radial falloff, on a chosen force and tension so a stroke
  lands on an exact value (C1M1's field is 87.7% off any fixed lattice — constants
  couldn't reach it). *Raise* stands a plateau 2.0 above the ground with sheer cut
  edges, carrying the relief it was raised from. *Lower* digs a pit to exactly 0.0
  and flags it water, so it floods. *Ramp* cuts a walkable half-step (flag bit 3),
  and only at the foot of a cut — all 3,718 ramp vertices in the shipped maps
  border a different tier. *Plateau* levels everything it touches to the tier the
  stroke started on. A **Ground-kind** brush sets the tier (and ramp bit) without
  moving the ground — for a surface already at its final height.
- **Tile painting**: all shipped tiles previewed from their own `.dds`, grouped by
  category. Arm a brush and left-drag at 1/3/5/7 tiles, or *Rect*, or *Vertex*. A
  stroke writes a chosen **weight** into one layer and leaves the layers under it
  alone (real ground blends — C1M1's weights sum to 510 at a vertex as often as
  not), goes onto the GPU masks for immediate feedback and into the main process,
  which owns the bytes that get saved. Picking a tile the map lacks splices in a
  new layer (`src/terrain-layer.ts`) — the one terrain edit that moves bytes
  rather than overwriting them.
- **River brushes** (Water, Bog, LavaFlow): these are not ordinary tiles. A stroke
  writes the half-tile river plane — which is what makes a river a river to the
  game rather than paint — and optionally carves the bed below its banks. Carving
  is a toggle because ground already at its final height must not be dug.
- **Passability grid** and the movement mask (the original's Masks tab): the tile
  grid coloured in three states — red blocked, blue navigable, clear walkable —
  plus Mask/Erase brushes. Three states because *blocked* and *you cannot walk
  here* are different questions: a lake stops a footman and carries a boat.
- **Brush cursor**: the system arrow is hidden while a brush is armed and replaced
  by its footprint drawn on the ground, following the terrain, so size and
  placement are visible before committing.

### Objects

- **Placement that reaches a shipped map**: an object palette catalogued from the
  1466 `_(AdvMapObjectLink)` files, grouped by `Editor/MapFilters.xml`, with icons
  from `Editor/IconCache`. It also places the **559 shared definitions no link
  points at** — the 434 statics an `_(AdvMapSharedGroup)` picks from at random and
  the 83 named heroes the original reaches only through "Random hero". A position
  can be a **fraction of a tile** and a facing **any angle** (C1M1 uses 80 distinct
  ones); Alt-drag/Alt-click and the panel's x/y/degrees boxes set exact values.
- **New objects arrive correctly**: the donor gives the field *set* (right across
  types, versions and mods), the schema gives the *values* — measured against a map
  made in the original for the purpose (`docs/OBJECT_DEFAULTS.md`), all 21 types.
  The **game's own type spec** (`data/types.xml`, 739 types) then supplies a field
  a donor's version predates and confirms 29 defaults independently.
- **Select, move (grid-snapped), rotate and delete** — a free-angle slider, ±15°
  and quarter-turn buttons, `[` / `]` keys, Delete.
- **Property panel**: every simple field of the selected object, read from the
  object itself rather than a per-type table, with editors inferred from the value
  (bool/number/enum/text). A field an object doesn't carry is offered under its own
  heading when *both* the game's spec and our schema agree it exists. Enum fields
  are dropdowns over the **full legal set** from the spec — every value the shipped
  maps use is offered, and an unlisted (modded) value is kept rather than dropped.
- **Object tree** ("Tree…"): the structures a text box can't honestly hold — a
  hero's army, a capture trigger, a monster's reward — rendered from `$defs`
  declared once in `src/objects.schema.json`, wherever they appear.
- Every object edit runs through the same path-addressed, recorded API, so it
  shares undo / dirty / save.

### Map properties, model & scripting

- **`map.xdb` model** (`src/map.ts`, `src/xml.ts`): loss-less XML DOM —
  `serialize(parse(x)) === x` on every sample map — with a typed object model over
  it. Editing an object rewrites exactly one line; deletion is surgical.
- **Undo/redo** (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`): not a command model — an
  edit is recorded as the byte difference between the documents before and after
  it, so anything is undoable without writing its inverse, and a feature added
  later is undoable for free. It covers terrain brushes, object edits and adding a
  ground layer alike, and survives a restart (the stack is stored keyed by a hash
  of the documents and re-adopted only if they still match).
- **Map Properties** dialog: two synchronised views over `<AdvMapDesc>` — a curated
  8-tab dialog (General / Players / Teams / Heroes / Spells / Artifacts / Script /
  Rumours) and a full tree, both schema-driven (`x-tab`, `x-file`, refs), both
  editing by path through one API so they share undo/dirty/save. Structured refs
  (Birds/Wind/AmbientLight, a player's main town/hero) get create/select/edit
  controls. See [docs/MAP_PROPERTIES.md](docs/MAP_PROPERTIES.md).
- **Regions**: named rectangles dragged out on the map and coloured in a panel —
  because four coordinates are not how a person describes a box they can see.
- **Script editor** (CodeMirror 6, in the document window): Lua highlighting
  (legacy stream mode, so the game's 4.0-shaped Lua isn't painted red), the app's
  dark theme, and completion from the engine API (204 functions from the shipped
  manuals, `npm run script-api`), the game's own scripts, and *this* map's names —
  objects, regions, objectives — offered inside string literals where the API takes
  them. **New** on the map's `MapScript` row creates the `.lua` + its `.xdb` wrapper
  and binds it. A **structural linter** (`src/lua-lint.ts`) marks what the engine's
  parser rejects — unbalanced `end`/brackets, unterminated strings — live in the
  gutter; it deliberately does *not* flag unknown names (our API list is partial;
  completion prevents mistyped names instead).
- **Default, unique `<Name>` handles** for placed objects (`MONSTER_001`, …),
  numbered per type — an empty handle can't be addressed from Lua at all. See
  [docs/NAMES_AND_SCRIPTING.md](docs/NAMES_AND_SCRIPTING.md).

### Project, packing, localization

- **Project model**: the editor edits *unpacked* files (a project is a tree of
  files, the way the game sees `data/…`), not a ZIP in place. Opening a `.h5m`
  unpacks it into a reused workspace; **Save** repacks over the source; **Pack** is
  a separate explicit build to `.h5m`/`.h5c`/`.h5u`/`.pak`. A `project.json`
  manifest tracks file hashes at pack time for `git status`-style dirty detection
  and editor-version drift. Archive members are named by their in-game path
  (`Maps/…/map.xdb`) — pack to the root and the game can't see the map.
- **External-change watcher** (`src/watch.ts`): the original Nival editor can be
  open on the same folder. When it saves, a banner offers to take its version.
  Content hashes, not timestamps, so our own saves never self-trigger.
- **Localization** (`docs/LOCALIZATION.md`): the game reads *one* language (the ref
  names a plain `name.txt`), so localization is the editor's job. A per-map
  **Localize** toggle authors every language side by side in tagged files
  (`name.en.txt`) behind a `localization.json` sidecar the game never sees;
  **Export as `<language>`** packs an ordinary single-language `.h5m`.

## Running

On Windows, `start-editor.bat` does the same by double-click: it checks Node,
installs dependencies on first run, and keeps its window open if anything fails.

```
npm start            # build the renderer, then launch the editor
npm run typecheck    # tsc --noEmit across the whole project
npm test             # every unit test-* in one run (tools/test-all.ts)
npm run test-e2e     # Playwright: New Map, placement, scripts, the C1M1 rebuild
npm run harness      # the renderer in a plain browser, on a stub bridge
npm run unpack-data  # unpack the install's .pak into data-unpacked
npm run inspect      # low-level dump of a .bin's structure
npm run pak          # ZIP (.pak/.h5m/.h5c) read/write CLI
```

The individual unit tests (`test-terrain`, `test-terrain-write`,
`test-terrain-layer`, `test-map`, `test-watch`, `test-pak`, `test-objects`,
`test-schema`, `test-history`, `test-lua-lint`, `test-typespec`, …) run one at a
time from `package.json`; `npm test` runs them all.

`npm run harness` serves `renderer/harness.html` on :8123 — the real `index.html`
with a stubbed `window.editor` injected ahead of the app module. The renderer
talks to Electron at module scope, so without this the UI can only be exercised by
launching the whole app; the harness makes the brushes and the toolbar clickable
in any browser, and records every IPC call on `window.__calls`.

Point `HOMM5_DATA` at an unpacked game data folder, or build one with

```bash
npm run unpack-data
```

which unpacks every `.pak` in the install's `data/` into `data-unpacked`
(gitignored) in the game's own overlay order — the addon's files (`a2p1-*`) last,
so they win, exactly as the game loads them. It skips files already current, so
re-running after a patch only writes what changed. A partial unpack is the usual
cause of untextured ground: the random-map generator's tiles, for one, ship only
in the addon pak. Individual archives are ordinary ZIPs and `tools/pak-cli.js`
handles them one at a time.

## `GroundTerrain.bin`

Reverse-engineered empirically and cross-checked against WindBell's 2009 analysis
(heroescommunity.com TID=32009). The container is a stream of self-describing
arrays, each introduced by a framing group:

```
<blockTag u8> <u32 sizeA>
01 08 <u32 V>          # side in VERTICES (V = tiles + 1)
02 08 <u32 V>          # the same value again
03 <u32 sizeB>         # sizeB = 2 * arrayByteLength + 1
<array data>
```

**The low bit of a size is a width flag**, which is why every size the array
scan ever met looked "always odd":

```
odd  -> the size is a little-endian u32 there, len = (size - 1) / 2
even -> the size IS that single byte,         len = size / 2
```

Arrays are big and always take the u32 form; path strings are short and always
take the one-byte form. A tile path of length L is stored as
`03 <2L+4> 03 <2L> <L bytes>`, an outer record wrapping the string record —
identical across all 20 layer paths in the sample maps. Knowing this is what
makes it possible to *write* a new layer rather than only read one.

Key points:

- Data is stored **per vertex**, not per tile: a T×T map yields `(T+1)²` values
  per plane.
- **Every array declares its own length** via `sizeB` (`len = (sizeB − 1) / 2`),
  so the parser hardcodes no sizes and works for any map. `V` comes from the file
  too.
- Plane order: texture layers (u8 mask + a path to `(AdvMapTile).xdb`), then
  **height** (`float32`), then **ground flags** (u8), a near-uniform reserved
  plane, **passability** (u8, `0` blocked / `1` walkable), and the **river
  plane** on a half-tile `(2V−1)²` grid.
- **Passability is per TILE**, though stored in a vertex-sized array: entry
  `y*V + x` is tile `(x, y)` and the last row and column are filler — the map
  interior is 8.98% blocked while both are 0.00%, exactly, over 2.3M vertices.
  Every other u8 plane in the file is per vertex, so this one is the exception.
- **Passability is authored, not derived.** Against a 9.0% background rate of
  blocked vertices across all 232 maps: `Sand/Sand_Rock` 92.4%,
  `Grass/Rock_Floor_grass` 75.5%, a drop steeper than 2 units 25.0%,
  `Water/LavaFlow` 26.4%, `Water/Bog` 24.6%, and sea (flag `0`) 6.4% — *below*
  background, because flag `0` means **navigable**: a boat crosses it, so there
  is nothing to block. Water is not implicitly impassable, and an overlay that
  paints it red is claiming the opposite of the truth. Depth explains
  nothing: a bed level with its bank is 23.8% blocked and one more than 1.5
  below it is 22.1%, with every bucket between within a point of those. Whether
  a river can be waded is a decision recorded here.
- **The ground flag is the tier number times 16**, plus 8 for a ramp:
  `flag = 16 * tier + 8 * isRamp`. Median height per value across all 232 maps —
  `0` → 0.00, `16` → 2.50, `32` → 5.24, `48` → 6.65, `64` → 8.00, and `80`
  exists too. The step across each adjacent pair is exactly 2.00 at the median
  and ≥0.8 in 95–100% of cases. The ramp bit falls out of the same arithmetic:
  `16→24` and `24→32` each step 1.00, exactly half, so a ramp sits midway
  between two tiers — which is what makes it walkable rather than a wall.
  A cut therefore forms wherever the **tier** changes, so a plateau stacked on a
  plateau cuts against it; treating everything above ground as one "plateau"
  kind smooths that wall away.
- ⚠️ WindBell's spec is inaccurate here. There are no separate Plateau / Ramp /
  WaterDepth planes — those are **bits of one flag plane**.
- ⚠️ Height is **not the only plane with a visual effect**. The flags decide where
  terrain breaks into a vertical cut and where it stays smooth, and the river
  plane carries painted water. Without them a map looks fundamentally different.
- **Navigability is the flag, and the water texture has nothing to do with it.**
  Flag `0` marks swimmable water; those vertices sit at exactly `0.0` in 100.0%
  of the 62,788 flagged vertices measured across 60 shipped maps. The engine
  draws the surface itself — what is painted on a navigable bed is ordinary
  ground: DarkGround 29%, Conquest/Dirt 27%, Grass 14%, and 56% of such vertices
  carry no strong texture at all. `Water.xdb` does not appear in the top eight.
  Conversely a painted river keeps flag `16` and stays walkable however deep its
  bed. So a lake is dug with `lower`, not painted; `Water.xdb`, `Bog.xdb` and
  `LavaFlow.xdb` are decorative shallows you walk through.
- Height `2.0` is the **default ground level**, not water. A bed dug by `lower`
  is always exactly `0.0`.

Full write-up with the measurements: [docs/TERRAIN_FORMAT.md](docs/TERRAIN_FORMAT.md).

## Assets and 3D models

- `data.pak` (ZIP, ~1.4 GB): 62k `.xdb` XML descriptors, 9k `.dds` textures,
  binary geometry in `bin/Geometries/` (3567 GUID files), skeletons in
  `bin/Skeletons/` (2242), animations in `bin/animations/` (3393).
- The reference chain is plain XML: map object → `*.(AdvMapStaticShared).xdb`
  (carries `blockedTiles`, the footprint) → `*.(Model).xdb` → geometry binary
  plus `.dds`.
- Geometry binaries use the **same container format** as `GroundTerrain.bin`
  (same `08 <u32>` and `03 <sizeB>` tags), but the mesh layout inside
  (vertex/index/submesh/material/skin) is more involved.

### Mesh geometry — working

There is no public HoMM5 mesh parser; this one was reverse-engineered from
scratch. Meshes decode to render-ready vertices and triangles with **zero broken
edges** on reconstruction.

- The container is a tree of records: scalar `tag 08 <u32>`, block
  `tag <u32 sizeB> <body>` with `len = (sizeB−1)/2`. `parseTree()` walks it.
- A mesh node holds **positions** `count₁×vec3f`, a **remap** `count₂×u16` (all
  values < count₁) and **indices** `tris×3×u16`. The engine does a vertex split:
  `render[i].pos = positions[remap[i]]`, with triangles indexing render vertices.
  The remap is identified unambiguously as the u16 array whose values are all
  `< count₁`.
- Positions are validated against the bbox in `.(Geometry).xdb`. The file stores
  the data twice (LOD); the duplicate is dropped.
- **UVs** are the first 4 bytes of the attribute stream (`tag3`): 2×int16 ÷ 2048
  (V ∈ [0,1], U tiles). Confirmed by UV continuity across shared edges.
- **Normals** are computed from geometry — the packed ones are imprecise.
- **Textures** are `.dds` (DXT1/3/5 and uncompressed), decoded by `src/dds.ts`.

Still open: per-submesh material assignment, skeletons and animations, and the
roughly one-third of catalogue meshes still undecoded (interleaved vertex buffers,
multi-mesh buildings) — refused with a message when placed. Details in
[docs/GEOMETRY_FORMAT.md](docs/GEOMETRY_FORMAT.md) and
[MESH_PLAN.md](MESH_PLAN.md).

## Testing

The unit `test-*` scripts guard the format layer (byte-faithful round trips) and
the model. The north-star e2e, though, is **rebuilding the shipped campaign
missions from scratch** — one at a time in order, driving the real app through
Playwright and diffing each reconstruction against the original to surface, and
then close, whatever the editor can't yet express. See
[docs/E2E_RECONSTRUCTION.md](docs/E2E_RECONSTRUCTION.md).

The first mission, **C1M1**, is rebuilt end to end: its whole `GroundTerrain.bin`
(heights, ground kinds, rivers, twelve texture layers, passability), all 2645
objects placed by clicking with their fractional positions and 80 facings, their
fields, the map settings, the 17 regions, the tile list, the objectives, the
localized texts, and the mission Lua — each a staged spec under `e2e/`
(`c1m1-1-heights` … `c1m1-13-texts`). `npm run diff-terrain`, `diff-objects` and
`diff-map` are down to a handful of accepted deviations the engine doesn't read.
Every gap it hit became a feature above.

## Next

The terrain and object tooling is enough to build a map by hand; attention is on
**typed entity editing** and reaching the next reconstructed mission.

- [ ] Typed per-type editors (Phase 4): towns (faction, buildings, garrison),
      heroes (class, army, artifacts, skills), creature stacks, players/teams —
      beyond the generic property panel.
- [ ] Multi-select, copy/paste.
- [ ] Terrain-tab parity, deferred: the texture `Up`/`Down`/`Eraser` + `Strength`
      modifiers (so a layer's weight nudges and a tile can be erased) and the
      `rnd`/`smth`/`zero`/`water` terraforming tools.
- [ ] Map validation on save, as the original does (overlaps, unset settings,
      towns with no specialisation), reported as a click-to-fly list.
- [ ] Dialog-scene editor + player, which needs skeletal animation playback first
      (Phase 5b).
- [ ] Campaign editor (`*.(Campaign).xdb` is plain XML).
- [ ] Fix the remaining undecoded meshes (see [MESH_PLAN.md](MESH_PLAN.md)).

See [ROADMAP.md](ROADMAP.md) for the full plan.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
conventions (byte-faithful formats, schema-driven editing, TS strip-mode
gotchas) and [ROADMAP.md](ROADMAP.md) for open work. One hard rule: **no game
content in commits** — `samples/` is gitignored; bring your own copy via
`HOMM5_DATA`.

# homm5-editor (experiment)

A map/campaign editor prototype for **Heroes of Might & Magic V: Tribes of the East**,
built on Electron and Node with no native dependencies.

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

- **Terrain rendering, end to end** (`npm start`): tile textures through a splat
  shader compositing by `<Priority>`, sea derived from the ground-flag plane,
  painted river brushes, vertical cut faces where ground kinds meet, rock-textured
  cliffs, and both floors. Write-up: [docs/TERRAIN_FORMAT.md](docs/TERRAIN_FORMAT.md).
- **`GroundTerrain.bin`** (`src/terrain.ts`): reads heights, texture layer masks,
  ground flags and the river plane, and writes every one of them back. Planes
  are fixed-size, so a write is a byte-for-byte overwrite in place and the
  output differs only where asked. Round-trip tested on real 96×96 and 136×136
  maps (`npm run test-terrain`, `npm run test-terrain-write`).
- **`map.xdb` model** (`src/map.ts`, `src/xml.ts`): loss-less XML DOM —
  `serialize(parse(x)) === x` on all 108 sample maps — with a typed object model
  over it. Editing an object rewrites exactly one line.
- **Object editing**: a categorised, searchable list; click to select, drag to move
  on the grid; save; pack to `.h5m` with version tracking.
- **External-change watcher** (`src/watch.ts`): the original Nival editor can be
  open on the same map folder. When it saves, a banner offers to take its
  version. Content hashes, not timestamps, so our own saves never trigger it and
  a rewrite with identical bytes is not a change.
- **Brush cursor**: the system arrow is hidden while a brush is armed and
  replaced by its footprint drawn on the ground — every tile the stroke will
  touch, following the terrain, so size and placement are visible before
  committing.
- **Height brushes**, four of them, named as the original editor names them.
  *Bulk* and *Dig* sculpt smoothly with a radial falloff. *Raise* stands a
  plateau 2.0 above the ground with sheer cut edges — 2.0 because that is the
  step on 45% of the 23,539 plateau edges in the shipped maps, and it is added
  rather than levelled to because only 25.6% of plateau vertices are level with
  their neighbours: a plateau carries the relief it was raised from. *Lower*
  digs a pit to exactly 0.0 and flags it water, so it floods. *Ramp* cuts a
  walkable way up: half a step, flagged with bit 3, which is the only
  intermediate the format has — measured, `16→24` and `24→32` each step 1.00,
  exactly half the 2.00 between tiers. It only applies at the foot of a cut,
  because that is the only place a ramp exists: all 3,718 ramp vertices in the
  shipped maps border a different tier, 100.0% of them. *Plateau* levels
  everything it touches to the tier the stroke started on — drag from an upper
  tier and the ground around is pulled up to it.
- **Rect** beside the 1/3/5/7 brush sizes: drag out a rectangle, which previews
  as you go and applies once on release. It works with every tool. All of them remesh
  live, and a basin dug on a dry map raises its sea immediately.
- **Ground palette and tile brush**: all 82 shipped tiles previewed from their
  own `.dds`, grouped by category. Pick one, arm the brush, and left-drag to
  paint at 1/3/5/7 tiles wide. The stroke goes into the mask texture on the GPU
  for immediate feedback and into the main process, which owns the bytes that
  get saved.
- **Passability grid** and the movement mask (the original editor's Masks tab):
  the tile grid drawn on the ground, coloured in three states — red blocked,
  blue navigable, clear walkable — plus Mask/Erase brushes at 1/3/5/7 tiles.
  Three states rather than two because *blocked* and *you cannot walk here* are
  different questions: a lake stops a footman and carries a boat. Blocking is a
  union — the mask plus what the terrain implies, namely the river plane and any
  step over 0.8 across a tile — because the mask alone is empty on maps where
  nobody opened the Masks tab. Navigable tiles are outlined over the sea rather
  than filled under it, so the water still looks like water. The blocked fill
  reuses the terrain's own triangles rather than laying a quad per tile, so it
  hugs cut faces and half-submerged cells the way the original editor does.
- **River brushes**: Water, Bog and LavaFlow are not ordinary tiles. Painting
  one sinks the bed 0.4 below its banks with a 0.2 rim, and writes the half-tile
  river plane — which is what makes a river a river to the game rather than
  paint. Sinking is idempotent per vertex and persists across strokes, seeded
  from the map's own river plane.
- **Adding a texture layer** (`src/terrain-layer.ts`): picking a tile the map
  does not carry splices a new mask array and its path into the container and
  grows every enclosing block's declared length. The only terrain edit that
  moves bytes rather than overwriting them, so the tests compare every
  pre-existing plane byte for byte (`npm run test-terrain-layer`).
- **Mesh decoding** (`src/geometry.ts`): positions, indices, UVs and textures.
  See [docs/GEOMETRY_FORMAT.md](docs/GEOMETRY_FORMAT.md).

## Running

On Windows, `start-editor.bat` does the same by double-click: it checks Node,
installs dependencies on first run, and keeps its window open if anything fails.

```
npm start                 # build the renderer, then launch the editor
npm run typecheck         # tsc --noEmit across the whole project
npm run test-terrain      # terrain parser round-trip on sample maps
npm run test-terrain-write # plane writes + the tile brush
npm run test-terrain-layer # splicing a new texture layer in
npm run test-map          # map.xdb model + loss-less XML round-trip
npm run test-watch        # external-change watcher
npm run test-pak          # ZIP reader/writer
npm run inspect           # low-level dump of a .bin's structure
npm run harness           # the renderer in a plain browser, on a stub bridge
```

`npm run harness` serves `renderer/harness.html` on :8123 — the real
`index.html` with a stubbed `window.editor` injected ahead of the app module.
The renderer talks to Electron at module scope, so without this the UI can only
be exercised by launching the whole app; the harness makes the brushes and the
toolbar clickable in any browser, and records every IPC call on `window.__calls`.

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

Still open: per-submesh material assignment, skeletons and animations.
Details in [docs/GEOMETRY_FORMAT.md](docs/GEOMETRY_FORMAT.md).

## Next

- [ ] Height brushes: `raise`/`lower`/ramp. These edit heights **and** flags, or
      cuts won't form (a cut is a change of ground kind, not steepness — see the
      terrain write-up), and they have to remesh the cells they touch.
- [ ] Undo/redo — the brushes make it matter now.
- [ ] Object rotation, deletion, undo/redo, a property panel.
- [ ] Fix the remaining undecoded models (see [MESH_PLAN.md](MESH_PLAN.md)).
- [ ] Campaign editor (`*.(Campaign).xdb` is plain XML).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
conventions (byte-faithful formats, schema-driven editing, TS strip-mode
gotchas) and [ROADMAP.md](ROADMAP.md) for open work. One hard rule: **no game
content in commits** — `samples/` is gitignored; bring your own copy via
`HOMM5_DATA`.

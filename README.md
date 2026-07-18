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
> from its folder (`HOMM5_DATA`, defaulting to `samples/paks/data`, which is
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
  ground flags and the river plane; writes heights back into a valid file.
  Round-trip tested on real 96×96 and 136×136 maps (`npm run test-terrain`).
- **`map.xdb` model** (`src/map.ts`, `src/xml.ts`): loss-less XML DOM —
  `serialize(parse(x)) === x` on all 108 sample maps — with a typed object model
  over it. Editing an object rewrites exactly one line.
- **Object editing**: a categorised, searchable list; click to select, drag to move
  on the grid; save; pack to `.h5m` with version tracking.
- **External-change watcher** (`src/watch.ts`): the original Nival editor can be
  open on the same map folder. When it saves, a banner offers to take its
  version. Content hashes, not timestamps, so our own saves never trigger it and
  a rewrite with identical bytes is not a change.
- **Ground palette**: all 82 shipped tiles previewed from their own `.dds`,
  grouped by category. Brushes are not implemented yet — painting comes next.
- **Mesh decoding** (`src/geometry.ts`): positions, indices, UVs and textures.
  See [docs/GEOMETRY_FORMAT.md](docs/GEOMETRY_FORMAT.md).

## Running

```
npm start                 # build the renderer, then launch the editor
npm run typecheck         # tsc --noEmit across the whole project
npm run test-terrain      # terrain parser round-trip on sample maps
npm run test-map          # map.xdb model + loss-less XML round-trip
npm run test-watch        # external-change watcher
npm run test-pak          # ZIP reader/writer
npm run inspect           # low-level dump of a .bin's structure
```

Point `HOMM5_DATA` at an unpacked game data folder, or unpack one into
`samples/paks/data` (gitignored) — `.pak` archives are ordinary ZIPs, and
`tools/pak-cli.js` handles them.

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

Key points:

- Data is stored **per vertex**, not per tile: a T×T map yields `(T+1)²` values
  per plane.
- **Every array declares its own length** via `sizeB` (`len = (sizeB − 1) / 2`),
  so the parser hardcodes no sizes and works for any map. `V` comes from the file
  too.
- Plane order: texture layers (u8 mask + a path to `(AdvMapTile).xdb`), then
  **height** (`float32`), then **ground flags** (u8), a reserved plane, the
  **river plane** on a half-tile `(2V−1)²` grid, and passability.
- ⚠️ WindBell's spec is inaccurate here. There are no separate Plateau / Ramp /
  WaterDepth planes — those are **bits of one flag plane**, established by
  measuring across all 232 shipped maps: `0` water, `16` ground, `32` plateau,
  bit 3 ramp.
- ⚠️ Height is **not the only plane with a visual effect**. The flags decide where
  terrain breaks into a vertical cut and where it stays smooth, and the river
  plane carries painted water. Without them a map looks fundamentally different.
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

- [ ] Write masks and flags back to `GroundTerrain.bin` — the brushes are blocked
      on this. Painting tiles edits layer masks; `lower`/`raise`/ramp edit heights
      **and** flags, or cuts won't form (a cut is a change of ground kind, not
      steepness — see the terrain write-up).
- [ ] Terrain brushes: tile painting, raise/lower, ramps, brush sizes.
- [ ] Object rotation, deletion, undo/redo, a property panel.
- [ ] Fix the remaining undecoded models (see [MESH_PLAN.md](MESH_PLAN.md)).
- [ ] Campaign editor (`*.(Campaign).xdb` is plain XML).

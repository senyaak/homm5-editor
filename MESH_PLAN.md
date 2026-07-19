# Plan: get the model meshes working

**Premise:** you cannot edit what you cannot see, so meshes matter. The model count
is finite — **~1395 unique Shared definitions** across all maps, some sharing
geometry — which makes this an enumerable problem rather than an open-ended one.
The approach is systematic: catalogue → human visual QA (good/bad) → fix one at a
time → repeat until they all work. Meshes run as a **separate track** from the map
editor.

**Lesson learned:** search for existing work on the format BEFORE reverse-engineering
by hand, not after.

---

## Phase M0 — Research (first!) 🔬

Look for existing work on the HoMM5/Nival geometry format before reversing further:

- The `.geometry` / `bin/Geometries` format, the Nival container, vertex
  declaration and stride.
- Noesis plugins, QuickBMS scripts, xentax/zenhax threads, the ToE modding wiki,
  heroescommunity forums, MMArchive and other modder resources.
- What matters most: the **vertex layout** — offset and type of each field
  (position/normal/UV/skin) and the stride. That unblocks both the untextured
  models (missing UVs) and the interleaved buffers.
- Record findings in `docs/GEOMETRY_FORMAT.md` under "external sources".

## Phase M1 — Model catalogue

- Collect **unique models** across all maps: resolve Shared → Model → geometry uid,
  dedupe by uid (a stable key that doesn't depend on the map).
- Per model: `{ uid, sharedPath, modelPath, bbox, verts, tris, textured?,
  decodeStatus }`.
- Prioritise by usage frequency (AdvMapStatic dominates by a wide margin).
- Emit `model-catalog.json`.

## Phase M2 — Model explorer + human QA

**Not a gallery.** The same UI as the editor's map list, reused: **rows +
category chips + search**, except the rows are models and each carries a
**good/bad checkbox**.

- **Categories** come from the `MapObjects/` folder structure (Grass, Dirt, Snow,
  Sand, Lava, Mountains, Trees, Buildings…) — ready-made groupings. Chips with
  counts, as in the map picker.
- **Clicking a row renders that model in the main 3D viewport** (one model, orbit
  and zoom). Look at it, tick good/bad on the row.
- **Verdicts persist to `model-verdicts.json`**, keyed by geometry uid →
  `{ good: bool, note, checkedAt }`. Autosaved.
- Progress readout — checked N of total, good vs bad — plus filters for unchecked,
  bad, and untextured.
- Lives inside the Electron editor as a "Models" tab reusing the categorised list
  and the 3D viewport, not as a separate application.

## Phase M3 — Fix loop, one model at a time

- Take models marked **bad**, most-used first.
- Diagnose with `tools/mesh-quality.js`: planar versus interleaved buffer, index
  pairing, presence of UVs — informed by whatever M0 turned up.
- Fix the decoder (`src/geometry.js`), re-render, re-check the verdict.
- Iterate until no bad models remain, or the rest are marked unfixable and get a
  placeholder.
- Progress is measured from `model-verdicts.json`.

## Phase M4 — The editor consumes the verdicts

- The map editor reads `model-verdicts.json`:
  - `good` → draw the decoded mesh;
  - `bad`/unfixable → draw a **bbox placeholder** (a box or footprint) so the
    object stays visible and, crucially, **clickable and editable**.
- Editing is then never blocked by an undecoded mesh.

---

## Data

- `model-catalog.json` — every unique model (generated).
- `model-verdicts.json` — human verdicts, `{ [uid]: {good, note, checkedAt} }`.
  Lives in the project and is committed: it represents real manual effort.

## Order

**M0 (research) → M1 (catalogue) → M2 (explorer + QA) → M3 (fix one at a time) →
M4 (placeholders in the editor).** M2 and M3 run as a loop. This whole track is
standalone: the map editor (rotation, undo, adding objects, properties) moves in
parallel and picks up the verdicts at M4.

## Mountain 10x10 — FIXED (2026-07-19)

The black wedges and stripes were two bugs, neither in the mesh decoder, and
both of them general rather than specific to this model.

**1. `<ProjectOnTerrain>` does NOT mean "paint the ground onto this".** It was
read that way, and parts carrying the flag went through a shader that shaded
them with the terrain splat sampled at their world XY, using their own texture
only as a darkener. On a 10-unit-tall mountain that smears one column of ground
texels up every cliff face (the stripes) and multiplies dark rock over it (the
black wedges).

The reading was inferred from one model — the Abandoned Mine's mound — and the
corpus does not support it. 393 shipped parts set the flag and they run from
perfectly flat to **three times taller than they are wide**. Two attempts to
rescue it by finding which parts are "really" decals both failed on measurement:

- *height/span*, tried at 0.35, cannot separate the mine's mound (0.284) from
  Mountain8x8 (0.340) — 8x8 stayed dark for exactly this reason.
- *"is this part the whole model or a skirt on it"* is no better: the 75 parts
  that ARE their whole model have median 0.394, the 318 that are one of several
  have median 0.300, and both groups are mostly tall.

So the shader is gone. Every part draws with its own texture, and `AM_OVERLAY`
is what blends a mound into the ground beneath it — which is what the mine's
mound wanted all along. The flag now only earns a depth nudge, and only where
the mesh really is flat (height/span < 0.15), so a decal does not z-fight with
the terrain it lies on. **What the flag means to the engine remains unknown.**

**2. The duplicate-mesh test demanded exact positions.** The model ships its
geometry twice — once with the authored rock texture, once with `SubTerrain`,
the underground ground. The second copy is the same 448 vertices and 662
triangles under identical indices and identical UVs, merely pushed outward by up
to one unit on a twenty-unit model, so the exact-match test never fired and the
dark grey shell swallowed the textured one whole. The test now matches on
topology plus coincidence within a tenth of the model's diagonal, which caught
two more models across the whole set (104 -> 106) — a small blast radius.

Also tried and **reverted**: forcing `AM_OVERLAY` to opaque on non-flat parts,
on the theory that an overlay with nothing behind it renders see-through. It
made no visible difference to the mountain and turned the Abandoned Mine's hill
into a black slab, so it was removed rather than kept "just in case".

Verified by rendering Mountain8x8, Mountain10x10 and the Abandoned Mine and
looking at them. Senya confirmed 10x10 in the editor.

## Everything was drawn at twice its size — FIXED (2026-07-19)

Spotted by Senya: a random treasure that occupies 1x1 in the game was drawn 2x2
in the editor. He was right, and it was not specific to treasure — **every model
was drawn at exactly twice its proper size.**

One map tile is **2 world units**, and the renderer puts geometry into a world
where a tile is 1 unit, with no scale applied anywhere. Measured over the 396
shared objects that declare both a `blockedTiles` footprint and a model
`<Size>`: the ratio's 25th percentile, median and 75th percentile are 2.000,
2.000 and 2.202, and 67% of the 792 samples are within 0.2 of exactly 2.0.
(Ratios above 2 are expected — `<Size>` is a bounding box and a tree's canopy
overhangs the tiles it blocks — which is why the upper tail is the loose one.)

Mountain10x10 is the clean illustration: `<Size>` 20x20, `blockedTiles`
spanning exactly 10x10.

Object positions were never the problem — those are already in tiles (a 320x320
map places objects at 1..318) and so is the terrain grid. Only the geometry was
in the other unit. `UNITS_PER_TILE` in `src/scene.ts` now converts it, along
with the effect cards, whose `<Bound>` is in the same world units.

Checked afterwards: the drawn footprint matches the declared `blockedTiles`
exactly — Mountain10x10 draws 10.00x10.00 tiles, Mountain8x8 8.00x8.00, the
Abandoned Mine 3.00x3.09 against a 3x3 block. A region of the 320x320 random map
was also rendered with a one-line-per-tile grid, and chests and crystals now sit
inside a single cell.

### Still open: are terrain heights in the same unit?

`GroundTerrain.bin` heights are **untested**. If they are world units like the
geometry was, the terrain is currently drawn twice as steep as it should be and
wants the same halving; if they are already in tiles, halving would flatten every
map. Two attempts to settle it failed: the heights are continuous, so there is no
step size to read a unit off (60 maps, 275k non-zero steps, no mode — the most
common difference is 0.01 at 3.5%), and nothing else in the data ties a height to
a tile count. It needs an eye that knows how the game looks, or a frame diff.

## Known bad: the audit's hard failures

`TESTS/A-geom`, `DemonLord_Path/Cross02` and `SmallStone/SmallStone_1x1_01`
decode to nothing; `Dwellings/archers_tower` comes out short (2 -> 1) and
`Snowed/Elemental_Stockpile_Snow` long (2 -> 3).

Run `npm run mesh-audit` for the current numbers. Note that the audit selects
models by `<NumMeshes>`, which for the ~1277 models that reference a separate
`(Geometry).xdb` lives in that other file — so its percentage is not coverage.

## Abandoned Mine — ACCEPTABLE, NOT DONE (2026-07-19)

Closed as good enough to move on, not as matching the engine. Senya's verdict
after the terrain-projection work: still the same as before.

Fixed and verified along the way, and these generalise far beyond this model:

- the geometry container is read structurally instead of guessed at — mesh
  count now matches the models' own `<NumMeshes>` for 2071 of 2076
- texture coordinates (16-bit fixed point over 2048) and the authored normals
  (bytes at +12, 128 for zero) are decoded
- materials are per submesh via `<MaterialQuantities>`, blending follows
  `<AlphaMode>`, and `<ProjectOnTerrain>` parts take the ground under them
- the duplicate opaque copy of a projected mesh is dropped (92 models have one)

What is still not right is unknown. The model reads as a mine and sits on grass
rather than on a slab, but it does not look like the engine's, and no
measurement so far says why. Anyone picking this up should start by diffing a
frame against the engine rather than by re-reading the format: every remaining
format question measured here came out matching.

## What already exists to build on

- `src/geometry.js` — the decoder (planar positions + indices + UVs,
  topology verification, shatter gate at 0.06).
- `tools/mesh-quality.js` — per-model breakage diagnostics.
- `tools/view-scene.js` — standalone HTML viewer, a starting point for the explorer.
- `src/scene.js` — Shared → Model → geometry + texture resolution.

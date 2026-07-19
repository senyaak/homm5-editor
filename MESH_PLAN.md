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

**1. `<ProjectOnTerrain>` was read as "this is flat".** Parts carrying the flag
went through the decal shader, which samples the ground by world XY and uses the
part's own texture only to darken it. On a 10-unit-tall mountain that smears one
column of ground texels up every cliff face (the stripes) and multiplies dark
rock over it (the black wedges). Measured across the shipped models, 393 parts
set the flag and they run from perfectly flat to **three times taller than they
are wide** — so the flag does not mean flat. Projection is now gated on the mesh
actually being flat, at a deliberately generous height/span < 0.35 so that only
the clearly-tall cases change: the Abandoned Mine's hill (0.284) stays on the
path it was on, Mountain10x10 (0.505) comes off it.

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

Not established: what the engine actually does with `<ProjectOnTerrain>`. 0.35
is a bound on the absurd, not a measurement. A frame diff against the engine
would beat it, and that is still the right next move for any model that looks
off — every format question measured so far has come out matching.

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

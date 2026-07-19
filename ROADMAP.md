# homm5-editor — implementation plan

Goal: a full map and campaign editor for Heroes of Might & Magic V: Tribes of the
East on Electron — at parity with the original editor, with decent Lua, mod
authoring, and correct parsing of every map asset.

Status markers: `✅ done` · `🔨 in progress` · `⬜ todo` · `🔬 needs research`

---

## Target architecture

```
Electron
├── main (Node)         — filesystem, .pak/.h5m/.h5c I/O, asset resolver
│     └── src/*.js       — the format decoders (terrain, geometry, dds, container)
├── renderer (web)
│     ├── 3D scene       — Three.js: terrain + objects + editing
│     ├── UI             — property panels, object tree, inspectors
│     └── Lua editor     — Monaco + the HoMM V API
└── shared               — typed map/campaign data model
```

Principle: `src/*.js` — the reverse-engineered format layer — is the core; UI and
3D are built on top of it.

### Project model: unpacked files, explicit packing, version tracking

The editor **does not edit ZIPs in place**. The working unit is a **project — a
tree of unpacked files**, the way the game sees `data/…`. Edits happen per file.
Building a `.pak`/`.h5m`/`.h5c` is a **separate, explicit "Pack" command**.

A `project.json` manifest tracks versions so the drift between the working tree
and the last packed build is always visible:

```
project.json
├── source        — which archive it was unpacked from (path + hash of the original)
├── editorVersion — the editor version that made the edits
├── lastPack      — { time, hash, editorVersion, output: "MyMap.h5m" }
└── files[path]   — { hash, mtime }   # snapshot taken at pack time
```

- **Dirty detection**: current file hashes ≠ the `lastPack` snapshot → show which
  files changed since packing (like `git status`) and mark the build stale.
- **Version drift**: `lastPack.editorVersion ≠ editorVersion` → warn that the
  packed build came from a different editor version.
- Content hashes (sha1/sha256) are cheap to recompute; packing refreshes the
  snapshot.

---

## Phase 0 — Format layer (foundation) — MOSTLY DONE

- [x] Nival container (record tree) — `src/geometry.js parseTree` ✅
- [x] Terrain: read/write heights — `src/terrain.js` ✅
- [x] Mesh geometry: positions + indices + UVs + normals — `src/geometry.js` ✅
- [x] DDS textures (DXT1/3/5 and uncompressed) → RGBA — `src/dds.js` ✅
- [x] Object asset resolution (map → shared → model → geometry + texture) ✅
- [x] Terrain: ground flags, river plane, texture layer masks — `src/terrain.js` ✅
      Flags decoded: `0` water, `16` ground, `32` plateau, bit 3 ramp.
      See docs/TERRAIN_FORMAT.md.
- [x] Passability plane — the third vertex-sized u8 plane after height, `0`
      blocked / `1` walkable. Identified by correlation across all 232 maps;
      read and written by `src/terrain.ts` ✅
- [x] `.pak`/`.h5m`/`.h5c`/`.h5u` — ZIP read **and write** — `src/pak.js` ✅
      (content-identical round trip, validated against Python's zipfile)

## Phase 1 — Map data core (model + round trip)

- [x] Loss-less XML DOM (`src/xml.js`): byte-identical round trip, 108/108 maps ✅
- [x] Full `map.xdb` parser → model (`src/map.js`): all 21 object types
      (Static/Town/Hero/Monster/Treasure/Mine/Artifact/Dwelling/Shrine/Garrison/…),
      header (dims/floors/terrain/heroMaxLevel/mapScript), 126k objects ✅
- [x] Serialisation back to `map.xdb`: `save()` leaves untouched fields alone —
      moving an object changes exactly one line, deletion is surgical ✅
- [ ] ⬜ Typed per-type properties (hero army, town buildings…) — Phase 4
- [ ] ⬜ Adding new objects + `map-tag.xdb`
- [ ] ⬜ Asset registry: one href → file resolver, cache, reverse lookups
      (which objects use a given Shared/Model/Texture)
- [ ] ⬜ Whole-`.h5m` load/save (unpack → edit → repack)
- [ ] 🔬 Shared definitions for every type (blockedTiles, passability, actions)

## Phase 2 — 3D view

- [x] Terrain heightmap + objects at their positions and rotations, textured ✅
- [x] Moved from a one-shot exporter into the live renderer scene ✅
- [x] **TERRAIN COMPLETE** (2026-07-18) ✅
      Splat shader compositing by `<Priority>`, sea from the ground-flag plane,
      painted river brushes, vertical cut faces at ground-kind boundaries,
      rock-textured cliffs, both floors. Format write-up in docs/TERRAIN_FORMAT.md.
      Cosmetic remainder: shoreline foam, a brown band along the top of a cliff,
      water animation.
- [ ] ⬜ Render ALL object types, not just static decor; for creatures/heroes on
      GR2 skeletons a static bind pose or billboard icon is enough
- [ ] ⬜ RTS camera niceties: tile grid, minimap, hover highlight
- [ ] ⬜ Instancing for repeated props + LOD

## Phase 3 — Editing core

**NEXT STEP — OBJECTS.** The terrain brushes are good enough to build a map
with, so the remaining Tiles-tab parity (see the deferred item below) waits.
Attention moves to objects: rotate and delete, then a property panel, then
placing new ones from a palette.

- [x] Select and move objects, snapped to the grid ✅ (plus a categorised,
      searchable object list)
- [x] Rotate and delete objects: a free-angle slider, ±15° buttons, `[` / `]`
      keys (Shift for 45°), and Delete ✅
- [x] Undo/redo — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and toolbar buttons, covering
      every edit including terrain brushes and adding a ground layer. NOT a
      command model: an edit is recorded as the byte difference between the
      documents before and after it, so an operation is undoable without anyone
      writing its inverse, and one added later is undoable for free. Survives a
      restart — the stack is stored under the app's data folder, keyed by a hash
      of the documents, and adopted on open only if they still hash the same ✅
- [ ] ⬜ Multi-select, copy/paste
- [x] Property panel: every simple field of the selected object, read from the
      object itself rather than a per-type table. Editors inferred from the
      value (bool/number/enum/text); structures and asset refs are shown, not
      edited. Typed per-type editors (army, buildings) remain Phase 4 ✅
- [x] Terrain writing: masks, flags, heights and the river plane — `src/terrain.ts`
      `writeTerrain`, with `src/terrain-edit.ts` as the editable document ✅
- [x] Tile brush: paint the selected ground tile, sizes 1/3/5/7. Applied to the
      GPU masks for feedback and to the authoritative bytes in one message per
      stroke ✅
- [x] Height brush: raise/lower with a radial falloff, live remeshing, and the
      water/ground flag transitions at height 0. Digging a basin raises a sea
      without a reload ✅
- [x] Adding a texture layer for a tile the map does not carry — `src/terrain-layer.ts`.
      Splices the record and grows every enclosing block; the size encoding's
      width flag was decoded to make this writable ✅
- [x] River brushes (Water/Bog/LavaFlow): sink the bed below its banks and write
      the half-tile river plane ✅
- [x] Passability grid (red blocked / blue navigable / clear walkable) + the
      Mask/Erase brushes, drawn on the ground beneath the water sheet ✅
- [x] Raise (plateau, +2.0 with cut edges, flag 32) and Lower (pit to 0.0,
      flag 0, floods) beside the smooth Bulk and Dig ✅
- [x] Plateau (level to the starting tier) and the Rect brush size ✅
- [ ] ⬜ **Terrain parity, deferred** — the terrain is usable, so the rest of the
      original's Tiles tab waits. Measured against its panel:
      - Missing terraforming tools: `rnd`, `smth`, `zero`, `water`. We have
        bulk/dig/raise/lower/ramp and plato.
      - Missing tile modifiers: **Up / Down / ERASER** and **Strength**. Our
        brush only ever writes a full-strength replace, so a layer's weight
        cannot be nudged and a tile cannot be erased at all — which is why
        there is no way to take a river back off the ground.
      - Layout: the original keeps size, terraforming, the tile grid and those
        modifiers in ONE panel. Ours are split between the top toolbar and the
        Ground palette and should move into the panel.
- [x] Object palette + drag and drop — `src/objects.ts`. Catalogue from the
      1466 `_(AdvMapObjectLink)` files, groups from `Editor/MapFilters.xml`,
      icons from `Editor/IconCache`. Placing clones an object of the same type
      already on the map; with no donor a skeleton is written and the caller is
      told ✅
- [ ] ⬜ **Per-type defaults for new objects, written by hand** — a placed
      monster currently inherits its donor's Amount/Mood rather than a sensible
      default (a creature is "obviously 1"). Needed before placement is
      trustworthy for gameplay objects; decor is fine today.
- [ ] ⬜ A third of catalogue entries have no decodable mesh, so they cannot be
      placed at all (see MESH_PLAN.md). Refused with a message today.
- [ ] ⬜ Write edits back into `.h5m` (patch in place where possible)

## Phase 4 — Parity with the original (entities and rules)

- [ ] ⬜ Towns: faction, buildings, garrison, owner
- [ ] ⬜ Heroes: class, army, artifacts, skills, starting stats
- [ ] ⬜ Creature stacks: type, count, mood, whether they guard
- [ ] ⬜ Artifacts, resources, mines, dwellings, chests — properties
- [ ] ⬜ Players/teams: colours, alliances, starting bonuses, available factions
- [ ] ⬜ Victory/loss conditions, map properties (size, weather, fog)
- [ ] ⬜ Events/triggers/quests, guarded zones, rivers and roads
- [ ] ⬜ Map validation, as the original does: unreachable areas, duplicates,
      broken references

## Phase 5 — Lua, done properly

- [ ] ⬜ Embed Monaco with Lua highlighting
- [ ] ⬜ HoMM V API definitions (from `HOMM5_A2_Script_Functions.pdf` /
      `HOMM5_A2_IDs_for_Scripts.pdf`) → completion and signature help
- [ ] ⬜ Bind scripts to the map and to objects (map script, per-object triggers)
- [ ] ⬜ Lint before saving: unknown functions, syntax errors
- [ ] ⬜ (optional) Embedded Lua interpreter for dry-run checks

## Phase 6 — Campaigns

- [ ] ⬜ Parser/editor for `*.(Campaign).xdb` (XML: missions, bonuses, dependencies)
- [ ] ⬜ Mission list, ordering, unlocks, carried-over heroes/armies/artifacts
- [ ] ⬜ Mission start bonuses (army/artifact/resources/building/spell)
- [ ] ⬜ Intro/outro text, briefings, map bindings
- [ ] ⬜ Building `.h5c`

## Phase 7 — Mods and packing

- [x] **Project = a tree of unpacked files**; `openProject` unpacks an archive
      into a working folder — `src/project.js` ✅
- [x] **"Pack" command**: `packProject` / `pak-cli pack` builds the tree into
      `.h5m`/`.h5c`/`.h5u`/`.pak` — `src/project.js` ✅
- [x] **`project.json` manifest + version tracking**: hash snapshot at pack time,
      `lastPack`, dirty detection (`status`), version-drift warning ✅
- [ ] ⬜ Mod structure for `.h5u`/`.pak`, managing overrides
- [ ] ⬜ Importing custom assets into a project (models/textures/texts)
- [ ] ⬜ Mod integrity check before building

## Phase 8 — Localisation tool (LOW priority)

- [ ] ⬜ Parse text resources (`texts.pak`, `/Text*`, per language)
- [ ] ⬜ Click a string to replace a translation with the default/original
- [ ] ⬜ Build a language-specific version (collect the right `.txt` set + pack)

## Phase 9 — Shell and polish

- [x] Electron shell running (`electron/main.ts` + `preload.cjs` + `renderer/`):
      window, open `map.xdb` → live 3D scene, select and drag an object → edit
      through `map.js`, Save, Pack `.h5m`, dirty indicator. `npm start` ✅
      (the main pipeline is covered by an `HOMM5_SMOKE` smoke test) 🔨
- [x] **External-change watcher** (`src/watch.ts`): the open map folder is
      hashed and watched, so edits from the original editor raise a "reload?"
      banner instead of being silently overwritten. Our own saves resync the
      baseline, so they never self-trigger ✅
- [ ] ⬜ Projects, recent maps, game path settings
- [ ] ⬜ Auto-detect the game installation and unpack `.pak` into a project cache
- [ ] ⬜ Performance (workers for parsing/packing, asset streaming)
- [ ] ⬜ Round-trip tests across the shipped map set (saving must not break them)
- [ ] ⬜ User documentation and examples

---

## Open research questions

- 🔬 **Per-submesh materials**: when a model has more than one
  (`MaterialQuantities`).
- 🔬 **Undecoded models**: roughly a third of placed objects still resolve to no
  mesh (interleaved vertex buffers, multi-mesh buildings). See MESH_PLAN.md.
- 🔬 **GR2 skeletons/animations** (Granny) — NOT needed for the editor; a static
  pose suffices. Only worth it for an animated preview.

## Order and priorities

Critical path to a working map editor: **Phase 0 (finish) → 1 → 3 → 2 (live scene)
→ 4**. Lua (5) and campaigns (6) run in parallel once the core exists. Mods (7)
follow saving. The localisation tool (8) is low priority and comes last. The shell
(9) runs throughout.

> Requirements: parity with the original → phases 3–4; decent Lua → phase 5;
> localisation tool (low) → phase 8; map/campaign mods → phases 6–7; correct
> parsing of additional assets → phases 0–1.

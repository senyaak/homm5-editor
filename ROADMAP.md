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
- [x] ✅ Whole-`.h5m` load/save (unpack → edit → repack), through a workspace that
      is reused per archive; Save repacks over the source. See Milestone 0 below.
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
- [x] **Plan-view picking comes from the camera** (2026-07-22): under the
      top-down orthographic camera the ray is vertical, so where it meets the
      ground follows from the camera alone. Asking the raycast instead put a
      click on the wrong side of a steep step — a cut face is edge-on to that
      camera and a grazing hit lands exactly on the grid line between two
      vertices. 18 of C1M1's 9409 vertices, all beside tall spikes ✅
- [x] **Vertex brush size** (2026-07-22): Bulk/Dig moves the single grid corner
      nearest the cursor. The smallest square brush is four vertices — a tile's
      corners — which cannot express a surface whose corners differ, and it can
      never reach the outermost row and column, of which there is one more than
      there are tiles. Clicks on that outer ring are aimed a quarter tile inward
      (`window.view.vertexToScreen`), or the ray passes beside the mesh and the
      stroke silently does nothing ✅
- [x] **Sculpting no longer demotes a tier-4 plateau** (2026-07-22): the guard
      that protects authored ground kinds tested `flag & 32`, true for tiers 2
      and 3 only, so any height change on tier 4 (flag 64) reset it to ordinary
      ground — 623 vertices of C1M1. It now asks for the tier ✅
- [x] **Brush force and tension** (2026-07-22): how much height one Bulk/Dig
      stroke adds, and how much of it reaches the vertices around the centre.
      Both were constants, which put every height the brush could produce on one
      lattice — and C1M1's field is 87.7% off any such grid, so most of a real
      map was unreachable. Now a stroke lands on a chosen value exactly, which
      is what lets a reconstruction compute its strokes
      (`docs/E2E_RECONSTRUCTION.md`, `e2e/click-terrain.spec.ts`) ✅
- [ ] ⬜ **Terrain parity, deferred** — the terrain is usable, so the rest of the
      original's Tiles tab waits. Measured against its panel:
      - Missing terraforming tools: `rnd`, `smth`, `zero`, `water`. We have
        bulk/dig/raise/lower/ramp and plato.
      - Missing tile modifiers: **Up / Down / ERASER** and **Strength** — the
        TEXTURE ones. The height brush has its force and tension now, but the
        tile brush still only writes a full-strength replace, so a layer's
        weight cannot be nudged and a tile cannot be erased at all — which is
        why there is no way to take a river back off the ground.
      - Layout: the original keeps size, terraforming, the tile grid and those
        modifiers in ONE panel. Ours are split between the top toolbar and the
        Ground palette and should move into the panel.
- [x] Object palette + drag and drop — `src/objects.ts`. Catalogue from the
      1466 `_(AdvMapObjectLink)` files, groups from `Editor/MapFilters.xml`,
      icons from `Editor/IconCache`. Placing clones an object of the same type
      already on the map; with no donor a skeleton is written and the caller is
      told ✅
- [x] ✅ **Per-type defaults for new objects** (2026-07-22) — a placed object now
      arrives in the state the ORIGINAL editor writes it in, instead of carrying
      the tuning of whatever object it was cloned from (the game's own town
      donor has 21 buildings and no guild spells; its monster has a stack of 4).
      The split: the **donor gives the field set** — correct by construction
      across types, game versions and mods — and the **schema gives the values**.
      They are not guesses: measured with `npm run object-defaults` off a map
      made in the original for the purpose, all 21 types, written as JSON Schema
      `default` in `src/objects.schema.json` and applied by `src/defaults.ts`.
      See docs/OBJECT_DEFAULTS.md. What that turned up: a new creature stack is
      `Amount` **0**, not the "obviously 1" this item used to assume (0 = sized
      by difficulty); a town's guild-spell list defaults to EVERY spell, an
      empty one meaning "no spells"; a shipyard's boat sits 4 tiles out; and the
      game writes two different empty refs (`href=""` vs no attribute), which is
      per field and measured. `tools/test-defaults.ts` places one of every type
      and diffs it against the reference map field by field.
      Two fields still keep the donor's value: a town's `spellIDs` needs the
      installation's roster (supplied by the app, absent in a bare test), and
      anything the schema does not declare.
- [x] ✅ **The game ships its own type spec** — `<data>/types.xml`: 739 types,
      3293 fields with type ids, chunk ids and constraints, and 1092 declared
      DefaultValues. Read by `src/typespec.ts` at test time. It **confirms 29 of
      our defaults with no conflicts**, an independent source saying what the
      ENGINE expects against a map saying what the EDITOR writes. It does not
      replace the measurement — the defaults that make a new object usable are
      not in it — but it is authoritative about SHAPE, which is more than
      docs/OBJECT_FIELDS.md (inferred from maps) can claim.
- [x] ✅ **End-to-end: place in the app, save, compare the file** —
      `e2e/place-objects.spec.ts` creates a map through the New Map dialog,
      places one object of every type the catalogue offers, saves, then reads
      the `map.xdb` off disk and compares every object element by element
      against the measurement. It found two real bugs on its first run, neither
      of which any unit test could see (see below), which is the argument for
      testing the product rather than the parts.
- [x] ✅ **Field sets from the spec** (2026-07-22) — `src/typespec.ts` resolves
      inheritance (`BaseType` names a type's `__ServerPtr`, not its `TypeID`) and
      returns the ordered field list at every depth, so:
      - a placed object gets a field its DONOR's game version predates, written
        in the place the spec puts it. A seer hut cloned from a campaign map used
        to arrive without `Quest/CheckDelay` and three sound refs; it does not
        now.
      - the **property panel offers fields the object does not carry**, under
        their own heading, and setting one creates the element. Two independent
        yeses are required — the game's spec says the type has the field, our
        schema says what shape to write — so nothing is ever invented.
      Covered end to end: `e2e/place-objects.spec.ts` opens a shipped map whose
      statics predate `TerrainAligned`/`ScalePercent`, sets one through the same
      IPC the panel uses, and finds it in the saved file, in order.
- [ ] ⬜ **Naming for entities that are not placed objects** — a seer hut's
      quest carries a `<Name>` of its own, and a new one is left empty (matching
      the original). Same hazard as an object with no handle.
- [x] ✅ **Enum members from the spec** (2026-07-22) — a field whose values the
      game closes is now a dropdown over the FULL legal set, not a text box and
      not a list guessed from what shipped maps happen to use. 24 object fields,
      1393 options, resolved through `src/typespec.ts` (`fieldValues`), served
      by `spec:values` and cached per type. Lists resolve too: `spellIDs` points
      at an anonymous `TYPE_TYPE_ARRAY` whose element is `SpellID`, 353 members.
      The dropdown keeps a value the spec does not list rather than dropping it
      — a modded install is a real thing, and silently rewriting a map on save
      is worse than an extra choice. `tools/test-typespec.ts` asserts the claim
      that earns the feature: **every value the 126 shipped maps use is
      offered**. It also caught our own schema inventing `MASTERY_ULTIMATE`; the
      game calls that level `MASTERY_EXTRA_EXPERT`.
- [ ] ⬜ **The rest of the PDF's rosters** — perks and class feats by class,
      town-building IDs, border-guard key colours, trigger types are all in
      `HOMM5_A2_IDs_for_Scripts.pdf` and mostly in types.xml too. Useful for
      Phase 5 (Lua completion) and for the typed panels of Phase 4.
- [ ] ⬜ **The 59 defaults the spec declares and our schema does not** — `data/types.xml` declares 97 enum types
      with every member, and an object's enum field points at one, so a dropdown
      could offer what is LEGAL instead of what shipped maps happen to use
      (`AttackType` is `ATTACK_ANY` on all 6377 monsters ever shipped; the type
      also has `ATTACK_RANGE` and `ATTACK_MELEE`). Mind the sentinels —
      `MONSTER_MOODS_COUNT` closes the enum and is not a mood. See
      docs/TYPE_SPEC.md.
- [ ] ⬜ **The 59 defaults the spec declares and our schema does not** — printed
      by name at the end of `npm run test-defaults`. Mostly map-level
      (`AdvMapDesc.BirdsAmount` 10, `BorderSize` 1) and the entity `$defs`
      (a wind's `Angle` 45, an ambient light's fog distances).
- [ ] ⬜ A third of catalogue entries have no decodable mesh, so they cannot be
      placed at all (see MESH_PLAN.md). Refused with a message today.
- [x] ✅ Write edits back into `.h5m` — Save repacks the archive it was opened
      from. Not a patch in place; the whole archive is rewritten, which is fast
      enough for a map and keeps one code path.

## Phase 4 — Parity with the original (entities and rules)

- [ ] ⬜ Towns: faction, buildings, garrison, owner
- [ ] ⬜ Heroes: class, army, artifacts, skills, starting stats
- [ ] ⬜ Creature stacks: type, count, mood, whether they guard
- [ ] ⬜ Artifacts, resources, mines, dwellings, chests — properties
- [ ] ⬜ Players/teams: colours, alliances, starting bonuses, available factions
- [x] ✅ Map properties — a "Map Properties" dialog (toolbar) with two views,
      mirroring the original's two forms: a curated **8-tab dialog** (General /
      Players / Teams / Heroes / Spells / Artifacts / Script / Rumours) driven by
      the schema (`x-tab`), and a full **tree** panel over the whole
      `<AdvMapDesc>`. Both edit by path through one API, so dialog and tree stay
      in sync and share undo/dirty/save. Name/description edit in place (writing
      the sibling txt files); TileX/TileY/Version stay read-only. Structured refs
      (Birds/Wind/AmbientLight, a player's Main Town/Hero) get a create / select /
      edit control; text refs get New / browse / edit. See `docs/MAP_PROPERTIES.md`.
- [ ] ⬜ Remaining dialog polish: `x-mapObjects` pickers for links to *placed*
      objects; in-dialog checklists for the player sub-lists (ReserveHeroes,
      TavernFilter). Victory/loss conditions, weather, fog.
- [ ] ⬜ Events/triggers/quests, guarded zones, rivers and roads
- [ ] ⬜ **Map validation, as the original does** — it runs a check on save and
      reports into a dialog. Observed messages, which is the checklist to
      implement (verbatim, "craig" is theirs):

      ```
      Map has no restrictions for Max Hero Level
      Map has no rumours!
      Object and craig intersection: 23:57, ground floor.
      There are towns without specialization! It's coordinates are: 27:37 21:58
      ```

      So: map-level settings left unset (hero level cap, rumours), objects
      overlapping cliff/crag tiles — which needs the object's footprint against
      the terrain's ground kind, the same data the Grid overlay already draws —
      and per-type required fields (a town with no specialisation). Plus the
      ones we know it does: unreachable areas, duplicates, broken references.
      Ours should report the same way — a list you can click to fly to the
      coordinate, rather than a wall of text.

## Phase 5 — Lua, done properly

The map–script contract is documented in `docs/NAMES_AND_SCRIPTING.md`: Lua
addresses everything by its `<Name>` handle, and "main/reserve" heroes & towns
are named *definitions* the script/engine materialises at run time
(`DeployReserveHero`, `TransformTown`, …), which is why the editor never places
them.

- [ ] ⬜ Pick an editor component (Monaco / CodeMirror / other — TBD) with Lua
      highlighting
- [ ] ⬜ HoMM V API definitions (from `HOMM5_A2_Script_Functions.pdf` /
      `HOMM5_A2_IDs_for_Scripts.pdf`) → completion and signature help
- [ ] ⬜ **Name completion in Lua** — offer the map's own names (objects, towns,
      heroes, objectives, regions) as completions in argument positions that take
      a name, driven by `map:names` (the same source the `x-nameRef` datalists
      use). Makes "reference an entity from Lua" correct instead of hand-typed.
- [ ] ⬜ Bind scripts to the map and to objects (map script, per-object triggers)
- [ ] ⬜ Lint before saving: unknown functions, syntax errors, **names used in
      script that no object defines**
- [ ] ⬜ (optional) Embedded Lua interpreter for dry-run checks

### Naming (prerequisite for reliable scripting)

- [x] ✅ **Default, unique `<Name>` handles** for placed objects (2026-07-22) —
      `HommMap.nextName()` gives a new object `MONSTER_001`, `SEER_HUT_002`…,
      numbered per type, and a name asked for by the caller is auto-suffixed
      (`boss`, `boss_2`) rather than refused mid-placement. A deliberate
      divergence: the original leaves `<Name>` empty, and an empty handle cannot
      be addressed from Lua at all (see `docs/NAMES_AND_SCRIPTING.md`).
      **Known limit**: numbering counts the handles IN USE, so deleting
      `MONSTER_002` puts that name back in circulation and a script still using
      it would then address a different object. The map is the only state we
      have; catching it belongs to the lint below.
- [ ] ⬜ The same for named entities that are not placed objects (objectives,
      the map's own lists) — only objects are covered so far.

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

## Testing strategy — reconstruction (see `docs/E2E_RECONSTRUCTION.md`)

The primary e2e is **rebuilding the shipped campaign missions from scratch**, one
at a time in order (C1M1 → C6M5), diffing each reconstruction against the
original to surface — and then close — whatever the editor can't yet express. A
mission's reconstruction script is its e2e test and re-runs on every change.
Round-trip (load→save→identical) is the cheap complementary net.

- [x] ✅ **Milestone 0 — New Map** (2026-07-22): a "New map…" dialog mirroring the
      original's (Name / Two Level Map / Type / Size) writes a blank project —
      map.xdb from the schema skeleton, flat GroundTerrain.bin, sibling txt — and
      the acceptance criterion is met: **the game loads and plays a map created
      here from scratch and packed by us**. Everything else in the reconstruction
      plan builds on this.

      What it took beyond writing the files:
      - **The archive is the working unit.** Open `.h5m` unpacks it into a
        workspace under `_tmp/workspaces/`, keyed by a hash of the archive path,
        and reused on the next open so undo and unsaved work survive. **Save**
        means "put it back where it came from" — repack over the source archive
        (Pack still writes a copy elsewhere).
      - **Archive members are named by their in-game path** (`Maps/…/map.xdb`),
        not relative to the map folder. Packing to the root produced `.h5m` files
        the game could not see — `archivePrefix` in the manifest records it.
      - **A pack that would write an empty archive is refused**, and Save refuses
        a project dir that is gone. Both cost a real map once.
      - `npm run unpack-data` unpacks every `.pak` (addon last) so assets resolve
        from one tree — `RMG/Tiles/*` ships only in `a2p1-data.pak`.

---

## Open research questions

- 🔬 **Per-submesh materials**: when a model has more than one
  (`MaterialQuantities`).
- 🔬 **Undecoded models**: roughly a third of placed objects still resolve to no
  mesh (interleaved vertex buffers, multi-mesh buildings). See MESH_PLAN.md.
- 🔬 **GR2 skeletons/animations** (Granny) — NOT needed for the editor; a static
  pose suffices. Only worth it for an animated preview.

## Known nits (cosmetic, not blocking)

- 🐛 **Effect models stand slightly wrong.** The Mystical Garden's gnome — an
  animated model inside the object's `<Effect>` — is now the right SIZE (it used
  to inherit a particle's `<Scale>` of 10 and tower over the map), but it sits a
  little off: raised above its spot and leaning. The ModelInstance's Position and
  Rotation are applied; what is not is the model's own bind pose, which for a
  skinned mesh lives in the GR2 skeleton we deliberately do not read. Everything
  is recognisable and placeable, so this waits. Same suspicion for any other
  animated effect model.

## Order and priorities

Critical path to a working map editor: **Phase 0 (finish) → 1 → 3 → 2 (live scene)
→ 4**. Lua (5) and campaigns (6) run in parallel once the core exists. Mods (7)
follow saving. The localisation tool (8) is low priority and comes last. The shell
(9) runs throughout.

> Requirements: parity with the original → phases 3–4; decent Lua → phase 5;
> localisation tool (low) → phase 8; map/campaign mods → phases 6–7; correct
> parsing of additional assets → phases 0–1.

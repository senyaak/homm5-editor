# E2E by reconstruction — the plan

The editor is proven the only way that counts: **rebuild the shipped campaign
missions from scratch, one at a time, and check the result against the
original.** Round-trip tests only prove we don't corrupt existing files;
reconstruction proves a user can actually *author* a map — terrain, objects,
parameters, entities, script — and that the engine accepts it.

Each mission is a forcing function: whatever the editor can't yet express shows
up as a gap against the original, and closing that gap is the work. Knowledge we
learn (required fields, format quirks, engine rules) is documented as we go.

## The rule

**Strictly sequential, one mission at a time. We do not start the next mission
until the current one is done.** "Done" = the reconstruction reproduces the
original's content (see "What 'match' means"), it packs, and it loads and plays
in the real game. Deliberately deferred items are allowed but must be written
down, not silently skipped.

## The loop (per mission)

A mission is rebuilt and accepted **in stages, in this order — terrain, objects,
map settings, Lua** — each with its own comparison, because a stage that is not
yet reproduced would otherwise drown the next one's report. Whatever a stage
cannot express is a tool we have not built; we build it and re-run, rather than
lowering the bar. Everything learned on the way is written down as we go, and the
whole set ends in `docs/RECIPES.md` — how to actually do each thing.

1. **Extract** the original mission from `UserMODs/All_campaigns.data.h5u`
   (`Maps/Scenario/<CxMy>/…`) into `_tmp/fixtures/<CxMy>/` — the reference:
   `npm run extract-fixture C1M1`.
2. **Reconstruct from scratch through the app itself**, driven by Playwright —
   the same clicks a person makes, in the running editor:
   `New Map → paint/sculpt terrain → place & rotate objects → set params →
   create referenced entities (+names) → write Lua → Pack .h5m`. Driving the
   handlers headless would prove the writers work; driving the UI proves the
   *editor* works, which is the claim being tested. It also means the harness
   needs tile-level addressing (tile → screen, scrolling, tool selection) — one
   layer, reused by all thirty missions.
3. **Diff** the reconstruction against the original, per stage → a **gap report**:
   what is missing, wrong, or not yet expressible.
   Terrain: `npm run diff-terrain _tmp/fixtures/C1M1 <workspace>`.
4. **Close the gaps** — implement or fix the missing editor capability, re-run,
   until the diff is empty. A difference we cannot reproduce means the tools are
   wrong or missing, not that the difference is acceptable.
5. **Pack** `.h5m`. Loading in the real game comes at the end of a *campaign*,
   not per mission: rebuilding a map that already works proves nothing on its
   own — the point is that the editor can produce it.
6. **Document** everything new: format details into the relevant `docs/*.md`,
   editor capabilities into `ROADMAP.md`, and cross-check the fixture into the
   round-trip suite.

The reconstruction script for a mission is itself the e2e test: it re-runs on
every change and must keep passing, so later missions can't regress earlier ones.

## What "match" means

The target is **1:1 in content**. Identity of the *bytes* is not reachable for
the XML — object ids are fresh GUIDs, element order and float formatting differ —
so the map document is compared normalized and semantically. `GroundTerrain.bin`
has no such excuse: it is a fixed grid of values, and every value should end up
the same. Per subsystem:

- **Map params** — the whole `<AdvMapDesc>` scalar/enum/ref set (our schema
  already enumerates it): equal after normalizing whitespace and numeric form.
- **Terrain** — every plane equal value for value: layer set and each weight
  mask, heights, ground flags, passability, the river plane
  (`tools/diff-terrain.ts`).
- **Objects** — matched by a normalized identity (type + Shared + position +
  rotation + the type's key params), **not** by GUID or file order.
- **Players / teams / objectives / rumours** — structural equality.
- **Referenced entities** — Birds/Wind/AmbientLight/MainTown/… documents present
  with equivalent content.
- **Script** — the Lua reproduced (last, Phase 5).

A gap = something in the original that the editor cannot yet produce. Each gap is
logged with the mission it was found in.

## Stage 2 — assemble the campaign (not just the maps)

Individual maps passing is necessary but not sufficient: the campaign layer has
its own content the maps don't carry. **After a campaign's five missions are
reconstructed, assemble them into a campaign and verify that too.** Per campaign:

1. Build the `*.(Campaign).xdb` — mission list and order, unlock/dependency
   rules, per-mission start bonuses, intro/outro text, map bindings.
2. Wire the cross-mission carry-over the campaign relies on — migrated
   heroes/armies/artifacts, entry points on the destination maps
   (see `docs/NAMES_AND_SCRIPTING.md`).
3. Pack the `.h5c` and confirm in the game: missions unlock in order, bonuses are
   offered, a hero carries into the next mission as in the original.
4. Diff the reconstructed `*.(Campaign).xdb` against the original (semantic).

This is what exercises Phase 6, and it's where the whole set finally comes
together into something playable end to end — the real proof.

## Order and tracker

6 campaigns × 5 missions = 30, in campaign order. Start at **C1M1** (first
mission, simplest). Mark `✅ done` / `🔨 in progress` / `⬜ todo`; only one
`🔨` at a time. After each campaign's five missions, do its **Stage 2**
assembly (`⬜ .h5c`) before moving to the next campaign.

```
C1: [🔨] C1M1  [ ] C1M2  [ ] C1M3  [ ] C1M4  [ ] C1M5   → [ ] C1.h5c
C2: [ ] C2M1  [ ] C2M2  [ ] C2M3  [ ] C2M4  [ ] C2M5   → [ ] C2.h5c
C3: [ ] C3M1  [ ] C3M2  [ ] C3M3  [ ] C3M4  [ ] C3M5   → [ ] C3.h5c
C4: [ ] C4M1  [ ] C4M2  [ ] C4M3  [ ] C4M4  [ ] C4M5   → [ ] C4.h5c
C5: [ ] C5M1  [ ] C5M2  [ ] C5M3  [ ] C5M4  [ ] C5M5   → [ ] C5.h5c
C6: [ ] C6M1  [ ] C6M2  [ ] C6M3  [ ] C6M4  [ ] C6M5   → [ ] C6.h5c
```

Final checkpoint: all six campaigns assembled and playable — parity reached.

## C1M1 — what it is made of

96×96, one floor, no underground. The map document is `C1M1.xdb`, not `map.xdb`
(the name is free; `map-tag.xdb` binds it by href), and the `name.txt` /
`description.txt` it references are **not in the archive** — a campaign mission
takes its texts from `All_campaigns.texts_en.h5u`. Parity here is by
functionality, not by filename.

| | |
|---|---|
| objects | 2645 — 2603 `AdvMapStatic`, 15 monsters, 13 treasures, 5 dwellings, 4 signs, 3 buildings, 1 hero, 1 garrison |
| terrain | 12 tile layers (Grass ×5, Dirt ×2, Sand, Water, Road ×2), rivers on 6.2% of the half-tile plane |
| the rest | 4 Lua scripts + their `.xdb` wrappers, `PWL.(Texture).dds`, regions with triggers, ambient light ref, moons/weather/wind/birds, objectives, rumours, start scene |

**Terrain gap report** (blank 96×96 vs the original — `npm run diff-terrain`):

- 11 tile layers to add (`addTextureLayer` exists — the count should close), and
  the original spells tile paths lowercase where our blank does not.
- Every height differs, up to 16.8 — expected, that is the sculpting.
- Ground flags: the map is tiered (48 = tier 3) where a blank is flat 16.
- **Passability plane absent from a blank entirely** — inserting a plane is not
  implemented (`docs/TERRAIN_FORMAT.md`). First real tool gap of this stage.

### The shape cannot be recovered as a formula (measured)

`npm run terrain-shape` on the fixture: **7420 distinct heights over 9409
vertices**, not one still at the blank's 2.0, **87.7% off any 2.0 step grid**,
field level 8.0 on tier 3. The shipped single mission A2S1, for contrast, is
70.6% on-step with 10.6% untouched.

Two hypotheses for reproducing that surface by rule, both tested and both
rejected:

- **Relaxation** (smooth until it settles, with the stepped vertices pinned) —
  the field is not harmonic: median `|h − mean of its 4 neighbours|` is 0.100,
  p90 0.41. Only 9.4% of smoothed vertices sit within 0.01 of that mean.
- **Blur of the stepped field** — quantise every height to the nearest 2.0 and
  blur 3×3: best fit is one pass at rms **0.396** against a height sd of 3.014,
  and more passes only make it worse (0.45, 0.52, 0.59…).

So the surface is the trace of a particular sequence of human strokes, not the
output of a filter, and there is nothing to invert. Reaching it needs a brush
whose stroke lands on a *chosen* value — hence **force** (units of height per
stroke) and **tension** (how much of that reaches the vertices around it) in the
toolbar. With force set and tension 0, a 1×1 stroke moves its four vertices by
exactly that much, all the way into the file (`e2e/click-terrain.spec.ts`), so
the reconstruction can compute its strokes instead of guessing them.

## Milestone 0 — the one missing primitive: New Map

Everything above needs a starting point the editor does not have yet: a **blank,
valid map project**. Build it from pieces we already own —

- `map.xdb` from the schema skeleton (`buildEntity` builds valid XML from
  defaults) with the required header (TileX/TileY, floors, terrain refs);
- a flat `GroundTerrain.bin` at the chosen size (terrain writers);
- the sibling `name`/`description` txt and folder layout.

Validate it by (a) loading it back in our own editor, (b) round-tripping it, (c)
packing it, then (d) loading the `.h5m` in the game — iterating the skeleton
until the engine accepts it. **This is the first e2e goal; C1M1 builds on it.**

## Deliverables per mission

- `_tmp/fixtures/<CxMy>/` — the extracted original (git-ignored if large; a
  small extractor script regenerates it).
- `tools/reconstruct-<CxMy>.ts` — the headless reconstruction/e2e script.
- A gap report folded into `ROADMAP.md` (new capabilities) and the format docs.
- The fixture added to the round-trip suite.

## Why this is the whole product, not just a test

The reconstruction script *is* the authoring workflow, start to finish. If it
passes for a mission, the editor can build that mission; when all five of a
campaign pass and its `.h5c` assembles and plays, the editor can build that
campaign. When all six campaigns come together, the editor is at parity with the
original on real content, maps *and* campaigns — the goal in `ROADMAP.md`. Lua
(`MapScript`) is the last step of the map path and the last subsystem, where the
cutscene/API documentation and the Lua editor (highlighting + name completion)
come together (Phase 5).

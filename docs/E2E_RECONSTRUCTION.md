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

1. **Extract** the original mission from `UserMODs/All_campaigns.data.h5u`
   (`Maps/Scenario/<CxMy>/…`) into `samples/fixtures/<CxMy>/` — the reference.
2. **Reconstruct from scratch** by driving the *real* handler pipeline headless
   (the same code the UI calls), as a script:
   `New Map → paint/sculpt terrain → place & rotate objects → set params (by
   schema path) → create referenced entities (+names) → write Lua → Pack .h5m`.
3. **Diff** the reconstruction against the original (semantic, normalized — see
   below) → a **gap report**: what is missing, wrong, or not yet expressible.
4. **Close the gaps** — implement the missing editor capability, re-run, until
   the diff is empty or every remaining item is on the deferred list.
5. **Pack** `.h5m`; **load in the real game** (manual — the maintainer does this)
   and confirm it plays and matches the original mission.
6. **Document** everything new: format details into the relevant `docs/*.md`,
   editor capabilities into `ROADMAP.md`, and cross-check the fixture into the
   round-trip suite.

The reconstruction script for a mission is itself the e2e test: it re-runs on
every change and must keep passing, so later missions can't regress earlier ones.

## What "match" means (semantic, not byte)

A from-scratch map can never be byte-identical to the original — object ids are
fresh GUIDs, element ordering and float formatting differ. So the comparison is
**normalized and semantic**, per subsystem:

- **Map params** — the whole `<AdvMapDesc>` scalar/enum/ref set (our schema
  already enumerates it): equal after normalizing whitespace and numeric form.
- **Terrain** — dimensions, per-tile texture/layer and height, rivers/roads.
- **Objects** — matched by a normalized identity (type + Shared + position +
  rotation + the type's key params), **not** by GUID or file order.
- **Players / teams / objectives / rumours** — structural equality.
- **Referenced entities** — Birds/Wind/AmbientLight/MainTown/… documents present
  with equivalent content.
- **Script** — the Lua reproduced (last, Phase 5).

A gap = something in the original that the editor cannot yet produce. Each gap is
logged with the mission it was found in.

## Order and tracker

6 campaigns × 5 missions = 30, in campaign order. Start at **C1M1** (first
mission, simplest). Mark `✅ done` / `🔨 in progress` / `⬜ todo`; only one
`🔨` at a time.

```
C1: [ ] C1M1  [ ] C1M2  [ ] C1M3  [ ] C1M4  [ ] C1M5
C2: [ ] C2M1  [ ] C2M2  [ ] C2M3  [ ] C2M4  [ ] C2M5
C3: [ ] C3M1  [ ] C3M2  [ ] C3M3  [ ] C3M4  [ ] C3M5
C4: [ ] C4M1  [ ] C4M2  [ ] C4M3  [ ] C4M4  [ ] C4M5
C5: [ ] C5M1  [ ] C5M2  [ ] C5M3  [ ] C5M4  [ ] C5M5
C6: [ ] C6M1  [ ] C6M2  [ ] C6M3  [ ] C6M4  [ ] C6M5
```

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

- `samples/fixtures/<CxMy>/` — the extracted original (git-ignored if large; a
  small extractor script regenerates it).
- `tools/reconstruct-<CxMy>.ts` — the headless reconstruction/e2e script.
- A gap report folded into `ROADMAP.md` (new capabilities) and the format docs.
- The fixture added to the round-trip suite.

## Why this is the whole product, not just a test

The reconstruction script *is* the authoring workflow, start to finish. If it
passes for a mission, the editor can build that mission. When it passes for all
30, the editor is at parity with the original on real content — which is the
goal in `ROADMAP.md`. Lua (`MapScript`) is the last step of the path and the
last subsystem, where the cutscene/API documentation and the Lua editor
(highlighting + name completion) come together (Phase 5).

# The work list — index

Everything open, one file per item under [todo/](todo/). This file only lists
them.

- **Adding an item**: a new file plus ONE line here, at its sorted place in its
  group.
- **Finishing an item** deletes its file and its line in the same change that
  does the work; finishing part of it rewrites the file to what is still open.
- An item file has: **What** (the work, in plain words), **Source** (the plan
  or doc it comes from), **Acceptance** (the tests that must exist and pass),
  **Depends on** (other items, or none), and **Needs** when the owner must
  play or decide something.

## Housekeeping — before work runs in parallel

- [file-size-guard.md](todo/file-size-guard.md) — a test that fails on a file past 500 lines, with an allowlist that only shrinks
- [split-hot-files.md](todo/split-hot-files.md) — the files nearly every change touches, made so two changes never edit the same lines

## Feature 1 — the asset editor ([SLICE_asset_editor.md](../SLICE_asset_editor.md))

- [asset-editor-1-play-as-the-game.md](todo/asset-editor-1-play-as-the-game.md) — read how the engine plays effects, models and clips; fix where we play them differently
- [asset-editor-2-gltf-import-and-viewer.md](todo/asset-editor-2-gltf-import-and-viewer.md) — the window over a preset, its scene switch, and glTF in
- [asset-editor-3-edits-in-place.md](todo/asset-editor-3-edits-in-place.md) — gizmo, materials, skeleton, AnimSet and clip curves, shown on the map at once
- [asset-editor-4-texture-debts.md](todo/asset-editor-4-texture-debts.md) — DXT3 and mips, an image as a texture, per-material targeting, revert
- [asset-editor-5-particle-baker.md](todo/asset-editor-5-particle-baker.md) — our own particle system and a baker into `bin/effects`
- [asset-editor-one-particle-probe.md](todo/asset-editor-one-particle-probe.md) — one hand-written particle effect, seen or not in the game

## Feature 2 — factions of our own ([FACTION_PLAN.md](FACTION_PLAN.md))

- [factions-ai-of-the-race.md](todo/factions-ai-of-the-race.md) — what a race's AI builds and values, and an AI player of the race in play
- [factions-arenas.md](todo/factions-arenas.md) — a battle arena of our own
- [factions-exterior-preview.md](todo/factions-exterior-preview.md) — the ten exterior stages drawn over the chosen ground plan, uncovered holes marked
- [factions-grail-common-bonuses.md](todo/factions-grail-common-bonuses.md) — where the grail's +5000 gold and +50% growth are computed, and whether a ninth race gets them
- [factions-multiplayer-match.md](todo/factions-multiplayer-match.md) — the lobby compares the mod and the races file before a game
- [factions-own-pick-hull.md](todo/factions-own-pick-hull.md) — an AIGeometry hull written for a moved building model
- [factions-stage-per-building.md](todo/factions-stage-per-building.md) — an exterior model for any building built, past the engine's ten stages
- [factions-tests.md](todo/factions-tests.md) — the tests the Factions window still lacks
- [factions-town-screen-scene.md](todo/factions-town-screen-scene.md) — the town screen as a scene to edit: buildings switched off and moved

## Not cut into items yet

These still hold open work in their own text; each becomes items here as it
is taken up.

- [ROADMAP.md](../ROADMAP.md) — the `⬜` lines of phases 1–10 (parity, Lua, animation, campaigns, mods, localisation, shell, the generator's ideas)
- [SLICE_diagnostics.md](../SLICE_diagnostics.md) — the app says what is wrong with it; nothing built
- [SLICE_effects_probe.md](../SLICE_effects_probe.md) — the effects reading list, folded into asset-editor-1
- [SLICE_fx_performance.md](../SLICE_fx_performance.md) — §7, the rest of the frame work, deferred by the owner
- [SLICE_paint_writes.md](../SLICE_paint_writes.md) — painting over an object-heavy map, left over
- [SLICE_spell_effects_of_our_own.md](../SLICE_spell_effects_of_our_own.md) — piece 3, entries of our own
- [MESH_PLAN.md](../MESH_PLAN.md) — the meshes that still do not decode

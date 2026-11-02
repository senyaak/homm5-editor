# The work list — index

Everything open, one file per item under [todo/](todo/). This file only lists
them, in the owner's order: the groups top to bottom, items within a group by
their number.

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

## 1. Factions of our own — finish and release ([FACTION_PLAN.md](FACTION_PLAN.md))

- [factions-1-audit-race-readers.md](todo/factions-1-audit-race-readers.md) — every place the game reads the race list, with a verdict: detoured, patched, data, harmless, or open
- [factions-2-e2e-gaps.md](todo/factions-2-e2e-gaps.md) — every faction field and refusal reached through a window by some spec
- [factions-3-play-test.md](todo/factions-3-play-test.md) — the install prepared and a checklist for the owner to play
- [factions-4-release.md](todo/factions-4-release.md) — the changelog cut, the full gate, the version handed over for tagging

## 2. Creature abilities of our own, through Lua

- [abilities-0-how-shipped-abilities-work.md](todo/abilities-0-how-shipped-abilities-work.md) — research first: kinds, moments, readers, how activated ones are offered; a design for the owner to approve
- [abilities-1-tab.md](todo/abilities-1-tab.md) — abilities as a list of the mod, authored in a tab of the Units window
- [abilities-2-lua-has-ability.md](todo/abilities-2-lua-has-ability.md) — a Lua function: does this creature have that ability
- [abilities-3-battle-events.md](todo/abilities-3-battle-events.md) — battle triggers with their unit: turn, hit, death, spell
- [abilities-4-behaviour-in-lua.md](todo/abilities-4-behaviour-in-lua.md) — an ability's battle script, written in the tab, built into the mod

## 3. Lua in multiplayer

- [mp-lua-1-read-the-world-script-system.md](todo/mp-lua-1-read-the-world-script-system.md) — read the engine's unused world-side script door
- [mp-lua-2-revive-the-world-machine.md](todo/mp-lua-2-revive-the-world-machine.md) — call it in network and hotseat games, tested in hotseat

## 4. The asset editor ([SLICE_asset_editor.md](../SLICE_asset_editor.md))

- [asset-editor-1-play-as-the-game.md](todo/asset-editor-1-play-as-the-game.md) — read how the engine plays effects, models and clips; fix where we play them differently
- [asset-editor-2-gltf-import-and-viewer.md](todo/asset-editor-2-gltf-import-and-viewer.md) — the window over a preset, its scene switch, and glTF in
- [asset-editor-3-edits-in-place.md](todo/asset-editor-3-edits-in-place.md) — gizmo, materials, skeleton, AnimSet and clip curves, shown on the map at once
- [asset-editor-4-texture-debts.md](todo/asset-editor-4-texture-debts.md) — DXT3 and mips, an image as a texture, per-material targeting, revert
- [asset-editor-5-particle-baker.md](todo/asset-editor-5-particle-baker.md) — our own particle system and a baker into `bin/effects`
- [asset-editor-one-particle-probe.md](todo/asset-editor-one-particle-probe.md) — one hand-written particle effect, seen or not in the game

## Factions, after the release

- [factions-ai-of-the-race.md](todo/factions-ai-of-the-race.md) — what a race's AI builds and values
- [factions-arenas.md](todo/factions-arenas.md) — a battle arena of our own
- [factions-exterior-preview.md](todo/factions-exterior-preview.md) — the ten exterior stages drawn over the chosen ground plan, uncovered holes marked
- [factions-grail-common-bonuses.md](todo/factions-grail-common-bonuses.md) — where the grail's +5000 gold and +50% growth are computed, and whether a ninth race gets them
- [factions-multiplayer-match.md](todo/factions-multiplayer-match.md) — the lobby compares the mod and the races file before a game
- [factions-own-pick-hull.md](todo/factions-own-pick-hull.md) — an AIGeometry hull written for a moved building model
- [factions-stage-per-building.md](todo/factions-stage-per-building.md) — an exterior model for any building built, past the engine's ten stages
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

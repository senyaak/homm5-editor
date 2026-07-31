# Documentation

One document per subject. Flat files are about a *format* or a *mechanism*;
`mapPlaceables/` is about the things a map is made of, one folder per kind.

## Map placeables

What each kind of object on the adventure map is, what defines it, and what a
mod may change about it.

- [mapPlaceables/buildings/BUILDINGS.md](mapPlaceables/buildings/BUILDINGS.md) —
  adventure-map buildings: the 128 `BuildingType` behaviours compiled into the
  executable, the sixteen classes that declare them, the three levels a
  parameter can live at, ownership, and the full registry.

Dwellings, creatures, artifacts, towns and heroes still have their notes in the
mod documents below; they move here as each gets written up.

## Formats

- [TERRAIN_FORMAT.md](TERRAIN_FORMAT.md) — `GroundTerrain.bin`: heights, flags, textures.
- [GEOMETRY_FORMAT.md](GEOMETRY_FORMAT.md) — `bin/Geometries/<uid>` meshes.
- [GR2_FORMAT.md](GR2_FORMAT.md) — the Granny container skeletons and animations live in.
- [ANIMATION_FORMAT.md](ANIMATION_FORMAT.md) — skeletons, clips, and where the rest pose is.
- [EFFECTS_FORMAT.md](EFFECTS_FORMAT.md) — `bin/effects`: a baked simulation, not emitters.
- [OODLE1_FORMAT.md](OODLE1_FORMAT.md) — the compression under all of it, ported byte-exact.
- [LIGHTING.md](LIGHTING.md) — ambient presets, and the point lights that actually light a map.
- [TYPE_SPEC.md](TYPE_SPEC.md) — `types.xml`: the type every `.xdb` is an instance of.

## The map document

- [MAP_PROPERTIES.md](MAP_PROPERTIES.md) — the settings the original's map-properties dialog holds.
- [OBJECT_FIELDS.md](OBJECT_FIELDS.md) — every field of all 21 object types, measured over the corpus.
- [OBJECT_DEFAULTS.md](OBJECT_DEFAULTS.md) — what a freshly placed object looks like.
- [NAMES_AND_SCRIPTING.md](NAMES_AND_SCRIPTING.md) — `<Name>` is the script handle; how references work.
- [SCRIPT_API.md](SCRIPT_API.md) — the Lua API (generated).
- [LOCALIZATION.md](LOCALIZATION.md) — the game reads one language, so the editor keeps the rest.

## Mods and content

- [UNITS_AND_ARTIFACTS.md](UNITS_AND_ARTIFACTS.md) — how new content gets into the game from here.
- [CONTENT_FORMS.md](CONTENT_FORMS.md) — what every window that MAKES something agrees on: what it refuses, and why a form must carry back all of what it shows.
- [NEW_CREATURES.md](NEW_CREATURES.md) — a creature, including the ceiling in the executable.
- [ARTIFACTS.md](ARTIFACTS.md) — an artifact, start to finish.
- [ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md) — what data, script and the exe each control.
- [ENGINE_INTERNALS.md](ENGINE_INTERNALS.md) — read out of the binary: where a mod can cut in.
- [EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md) — the Lua functions the executable registers.
- [ARCHIVES.md](ARCHIVES.md) — a map, a campaign and a mod are one thing to the engine.
- [CAMPAIGNS.md](CAMPAIGNS.md) — binding maps into a story, and what carries over between them.

## Working in this repo

- [RECIPES.md](RECIPES.md) — task-first notes: how to actually make things.
- [E2E_RECONSTRUCTION.md](E2E_RECONSTRUCTION.md) — proving the editor by rebuilding a shipped campaign.
- [_slices_done/](_slices_done/) — slices whose work has landed, kept for the
  reasoning: what was measured, what was tried first, what the check caught. A
  slice still in flight lives at the repo root instead.

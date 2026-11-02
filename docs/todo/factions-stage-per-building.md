# Factions — an exterior stage per building

**What.** The engine chooses one of ten exterior stages from the hall, the
walls and the guild (`0xAC7980`). Let a faction show a model of the town for
ANY building built: the stage table grown past ten in the DLL, the chooser
ours, `TownSpec.exterior` naming a model per building.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §2c (later).

**Acceptance.** Unit tests of the stage file the editor writes; the DLL's
chooser checked by `test-native-anchors`; e2e builds a faction with a stage on
a non-hall building.

**Depends on.** factions-exterior-preview.

**Needs.** The owner sees the stage change in the game when the building is
built.

# Factions — a preview of the exterior on its ground

**What.** A town has ONE ground plan (`blockedTiles`, `holeTiles`,
`activeTiles`, `PossessionMarkerTile` on the `AdvMapTownShared`) for all ten
exterior stages, and each shipped model covers exactly its own town's hole
tiles. Stages mixed from towns of different shapes leave holes black. Not a
refusal — the author decides: in the Factions window, draw the ten stages,
each over the chosen ground plan, with the hole tiles the model does not cover
marked. A model of the author's own is checked the same way, by its geometry
against the holes.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §2f.

**Acceptance.** e2e 018 keeps its mix (Necropolis's first stage, Haven's nine,
Necropolis's ground) and the preview marks the uncovered holes on exactly the
stages that do not match; a unit test computes covered/uncovered holes from a
geometry and a plan.

**Depends on.** none (the asset editor's renderer is not required: a top-down
drawing of tiles and the model's footprint is enough).

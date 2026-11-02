# Factions — a pick hull of our own

**What.** A building model moved on the town screen (`BuildingEdit.model` with
`place` or `at`, `src/mods/town-screen.ts`) keeps the donor slot's AIGeometry
hull, so the hover and the click are the old spot's (the graves light the
ground beside them). Write an AIGeometry hull for the moved model: the
container the geometry tools do not yet rewrite.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §1d, §2e.

**Acceptance.** The written hull reads back through our reader; it encloses the
moved model's geometry (a unit test over the vertices); e2e 018 writes one for
the pit.

**Depends on.** none.

**Needs.** The owner hovers and clicks the moved building in the game.

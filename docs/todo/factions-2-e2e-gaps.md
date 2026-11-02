# Factions 2 — the e2e that is still missing

**What.** e2e 018 builds Bone Court through the windows end to end. List every
field of `FactionSpec`, `TownSpec`, `RaceSpec` and the hero/creature parts a
faction uses, mark which a spec sets through a window and asserts in the built
archive, and write the missing ones. Known gap: `asEmptyTree`
(`renderer/features/mods/factions.ts`) — a manifest written before the tree
started empty opens as an empty tree with every old building put `{from:
donor, grants: null}`.

Also check each refusal the window has (deleting with holders, a race without
tier 1–3 base creatures, a guild-dependent building with no guild) is reached
through the window by some spec.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) "Where it stands";
[docs/working/e2e.md](../working/e2e.md).

**Acceptance.** The field list with its coverage is written into
`e2e/018-mod-faction-create.spec.ts`'s header or a doc beside it; every
uncovered field gets a test; each new test sabotaged once.

**Depends on.** none.

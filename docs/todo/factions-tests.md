# Factions — the tests still missing

**What.** The Factions window is built and e2e 018 builds Bone Court through
it end to end; what is left is test coverage. Known gaps:

- `asEmptyTree` (renderer/features/mods/factions.ts): a manifest written before
  the tree started empty opens as an empty tree with every old building put
  `{from: donor, grants: null}` — untested.
- The rest: to be listed by the owner.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) "Where it stands".

**Acceptance.** Each listed case has a test; each test sabotaged once.

**Depends on.** none.

**Needs.** The owner names the remaining cases.

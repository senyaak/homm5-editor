# Abilities 3 — battle events an ability can act on

**What.** An ability's behaviour needs moments to act on. Add battle triggers
with the unit they concern: a unit's turn begins, a unit is hit (attacker,
target, damage), a unit dies, a spell is cast on a unit — beside
`H5E_COMBAT_STARTED` and `H5E_MANA_SPENT`. A battle is a chain of events built
by the cast and applied by its caller ([engineInternals/BATTLE_SCRIPTING.md](../engineInternals/BATTLE_SCRIPTING.md)):
each trigger fires where the engine applies, not where it plans.

**Source.** [docs/api/combat.md](../api/combat.md) "Not here yet".

**Acceptance.** Each trigger documented in `docs/api/combat.md` and
`script-api-ours.ts`; each native site checked by `test-native-anchors`; a
test map's battle script logs every trigger.

**Depends on.** abilities-0-how-shipped-abilities-work (its approved design may reshape this item).

**Needs.** The owner fights the test battle.

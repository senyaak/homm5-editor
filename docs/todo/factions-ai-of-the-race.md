# Factions — the race's AI

**What.** What the AI builds, and when, is a compiled valuation over
race-indexed arrays; a faction has to say what its AI builds and values. The
skill values are rows already (`ai.skillsLike`, `ai.skillValues`); the
building valuation is not read. Read it, make it a field of the faction, and
write it from the Factions window.

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §1 "The AI", §4.

**Acceptance.** A note with addresses; the field written by the editor and
checked by a unit test; its sites by `test-native-anchors`.

**Depends on.** none.

**Needs.** The owner plays a map with an AI player of the race for a few weeks.

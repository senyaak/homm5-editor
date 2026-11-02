# Factions — the grail's common bonuses

**What.** The grail's racial part is compiled per town like a special; its
common +5000 gold and +50% growth are not in `DefaultStats` but in code, and
whether inside or outside the race switch is unknown. Find where they are
computed and whether a ninth race gets them; if not, give them to it the way
the other race-indexed values are given (`native/faction/race-traits.c`).

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §1, "The grail".

**Acceptance.** A note with addresses in `engineInternals/FACTIONS.md`; if a
row is added, its file is written by the editor and checked by a unit test, and
its site by `test-native-anchors`.

**Depends on.** none.

**Needs.** The owner builds the grail in a town of the race and reads the
income and growth.

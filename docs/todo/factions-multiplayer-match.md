# Factions — every client has the same faction

**What.** A client whose races file is a row short seats a different picker,
and a client without the mod has no town for the type. Carry the mod
archive's hash and the races file's hash in the room's description, and have
our lobby compare them before a game starts (h5e-lobby, the agent in
`native/net/`).

**Source.** [FACTION_PLAN.md](../FACTION_PLAN.md) §4, "Multiplayer".

**Acceptance.** Unit tests of the hash and the comparison; the agent's site
checked by `test-native-anchors`.

**Depends on.** none.

**Needs.** A second machine to play against (none at present).

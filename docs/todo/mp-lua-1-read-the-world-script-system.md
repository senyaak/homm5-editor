# Lua in multiplayer 1 — read the engine's dead door

**What.** In a network game and in hotseat the engine creates no Lua machine at
all: one predicate, `0x7223E0` (`CWorld+0x88` network, `+0x89` hotseat), gates
the adventure map (`0x6D9310`), battle (`0x65A280`), town (`0x84B300`),
trigger calls (`0x6DE100`) and flybys (`0x64C030`). The engine also holds an
unused world-side door: `CWorldScriptSystem` (`CWorld+0x1D0`), method
`0xA4B6A0` with the opposite condition — "if network or hotseat, create a
machine and run the map's script" — called from nowhere, with the replicated
`CRunScriptCallbackCmd` (`Exec 0xB34080`) and `CWorld` vtable `+0x204`
(`0xA56BF0`) beside it. Read all of it to the end: what the world machine
runs, how a script's effects reach the world (as replicated commands or not),
what keeps it deterministic across clients, and what calls it would need.

**Source.** The 2026-08-13 reading (move it into
`docs/engineInternals/LUA.md` as part of this item).

**Acceptance.** A note in `engineInternals/LUA.md` with addresses: the door's
body, its callers' would-be place, the command's path, and the open questions
with what would settle each.

**Depends on.** none.

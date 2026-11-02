# Abilities 2 — Lua can ask whether a creature has an ability

**What.** The engine has no "does this creature have that ability" for a
script. Register one in the extension, in the map table and the battle table
(as `EditorTest` / `H5ETentCharge` are): by creature type on the map, by unit
in a battle.

**Source.** ROADMAP Phase 7, "The Lua question"; [docs/api/combat.md](../api/combat.md).

**Acceptance.** The function is described in `src/script/script-api-ours.ts`
and `npm run build-api` rerun (`test-our-api` green); its native site checked
by `test-native-anchors`; a Lua test map asks about a shipped ability and one
of ours.

**Depends on.** abilities-1-tab.

**Needs.** The owner runs the test map's battle and reads the two answers on
screen.

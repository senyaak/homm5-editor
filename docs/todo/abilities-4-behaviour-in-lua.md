# Abilities 4 — an ability's behaviour written in Lua

**What.** The ability tab gets a battle script, built into the mod as
`scripts/homm5-editor/<ABILITY>-combat.lua` and loaded like a skill's battle
script: it registers handlers on the battle events and acts for the units that
have the ability. One worked example of ours shipped as the template.

**Source.** [docs/api/combat.md](../api/combat.md) "Where your code goes".

**Acceptance.** e2e: write an ability with a script through the window, give it
to a creature, read the script back from the archive; the Lua linter passes it.

**Depends on.** abilities-1-tab, abilities-2-lua-has-ability, abilities-3-battle-events.

**Needs.** The owner fights a battle with the creature and sees the ability act.

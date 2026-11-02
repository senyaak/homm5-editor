# Abilities 1 — a tab for abilities of our own

**What.** Abilities become a list of the mod beside creatures, artifacts, sets,
skills, classes and specializations, authored in a tab of the Units &
Artifacts window: id, caption, description. Numbers continue after ours and
the list is append-only (the number is what a creature's record stores). The
editor's own (`EDITOR_ABILITIES`, `src/mods/ability-files.ts`) are shown and
can be neither removed nor renumbered. Removing one of the mod's is refused
while a creature holds it.

**Source.** ROADMAP Phase 7, "Abilities of your own"; `tools/test-abilities.ts`.

**Acceptance.** e2e: make an ability in the tab, give it to a creature, read
both back from the built archive (`types.xml` enum and table size,
`CombatAbilities.xdb`); the editor's own refuse removal through the window.

**Depends on.** abilities-0-how-shipped-abilities-work (its approved design may reshape this item).

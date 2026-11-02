# Abilities 0 — how the shipped abilities work

**What.** Research before anything is built, so the feature is comfortable to
use and plays like the shipped abilities. For the shipped `ABILITY_*` set,
read and write down:

- where the engine asks about each ability, and at which moment of a battle
  (start, turn, move, attack, hit, retaliation, death, spell, end) or of the
  adventure map;
- the kinds there are: passive flags (Undead), modifiers of a stat or a roll,
  triggered reactions, activated abilities with a button, auras; which data
  each takes from `CombatAbilities.xdb` and the creature record;
- how an activated ability is offered, aimed and paid for (the button, the
  cursor, cooldowns, charges), and how the AI decides to use it;
- what the battle shows for each: icon, tooltip, combat log line, animation;
- which of these an ability of ours can reuse through the engine's own path,
  and which need ours.

Start from the data (`CombatAbilities.xdb`, creature records, the docs and
the modding guides on the net), then the executable for what they do not say.

**Source.** [engineInternals/BATTLE_SCRIPTING.md](../engineInternals/BATTLE_SCRIPTING.md),
[docs/api/combat.md](../api/combat.md); the owner's call (2026-11-02): research
first, then a comfortable design.

**Acceptance.** `docs/engineInternals/ABILITIES.md` with addresses: a table of
the shipped abilities by kind, moment and reader; the moments a battle offers
an ability to act; and a proposed design for abilities of ours (what the tab
asks for, which events and Lua functions it needs), for the owner to approve
before items 1–4 start.

**Depends on.** none.

**Needs.** The owner approves the design.

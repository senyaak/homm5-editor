# Hero specializations, and the first aid tent

*Answers: what a specialization is in the data and in the code, whether a value
of our own is accepted, and where its effect has to be added.*

Proven in game on 2026-08-01 — see the measurement at the end. The work that
found this is written up in
[_slices_done/SLICE_hero_specializations.md](../_slices_done/SLICE_hero_specializations.md).

`HeroSpecialization` is a plain enum in types.xml: 84 values, `HERO_SPEC_NONE`
= 0 through `HERO_SPEC_INFERNAL_MACHINE` = 83. Unlike a creature (a reference
table plus a ceiling compiled into the executable) and unlike an artifact (a
table whose `MinElements` **equals** its `MaxElements`), it declares **no size
anywhere** and has no file per value. So a specialization of ours is one entry
appended after the last, and nothing has to be retuned.

**Value 84 loads, and the engine answers about it.** Measured in game rather
than argued from the absence of a check: a hero carrying `HERO_SPEC_H3_FIRST_AID`
= 84 stands on a map, and the engine's own `HasSpecialization(84)` — the vtable
slot the tent uses, `+0x294` — returns true for him. The only bound in the
image is `cmp edx,53h; ja` in the enum → string helper, whose default is
harmless.

The value lives in the hero at **`+0xEC`**, and roughly sixty places compare it
against a literal. That is the whole of what a specialization *is*: a value the
executable was compiled against. A value it was not compiled against does
nothing at all, which is why the name, the description and the icon show up
from data while the arithmetic has to come from us.

**Where the words live is the hero, not the specialization.** Four fields:
`<Specialization>` plus `SpecializationNameFileRef`, `SpecializationDescFileRef`
and `SpecializationIcon`. Two heroes may hold one value and describe it
differently — and the shipped data does exactly that in reverse, which is how a
Sylvan hero holding a Necropolis specialization is described as an embalmer.
The editor writes a specialization's own words onto every hero holding it,
unless the hero overrode them.

Some specializations' NUMBERS are data — `DefaultStats.xdb` →
`HeroSpecializations`, grouped by class, all `…PerLevel` fractions — but that
is a struct of NAMED fields, one per shipped specialization, so a new value
gets nothing there. The ToE ones also carry `Base`/`PerPower` in their
`SPELL_SPEC_*` records. Neither is reachable for a value of ours.

## The first aid tent, in full

`0x77fca0` decides what the tent is worth, and it is the only place that does:

```
amount = { 10, 20, 50, 100 }[war machines mastery]
       + 5 × hero level, if his specialization is HERO_SPEC_EMPIRIC (36)
```

A four-case jump table writing the constants, then `push 24h;
call [vtable+294h]` — "does this hero hold 36" — and inside that branch
`lea eax,[eax+eax*4]`, the ×5. Signature from the call site at `0xb82d16`: two
out-parameters in ecx and edx, then the unit and the mastery on the stack.

Both of the tent's spells draw on that one number. `CCombatWarMachine::GetSpellPower`
at `0x9c96d0` answers for machine type 3 with the owner's War Machines mastery
for the heal (0xBD) and for the plague (0x160) alike — so one term of ours
reaches both, and the perk whose identifier reads `LAST_AID` and whose name in
game is «Чумная палатка» needs nothing of its own.

Three things about it cost a run each:

- **The mastery is an INDEX, not a multiplier.** Returning ten times it moved
  the tooltip and BROKE the tent: out of the table's range the engine falls
  into a constant. From the numbers alone that reads as "this value changes
  nothing".
- **The tooltip and the effect are computed by different code.** The prediction
  followed our doubled number while the applied amount did not. Read the battle
  log, never the hovering number.
- **Healing is capped by what is missing.** A stack of 15-HP creatures can
  never show more than 14 healed, whatever the amount is. The amount is a
  BUDGET: it tops the wounded creature up, then raises dead ones at `maxHP`
  each, and the remainder is lost.

Reaching the hero from the combat unit: `vt+0x18` → `vt+0x0C`. His level and
his specialization then answer on a **virtual base**, not on the hero pointer —
`this = hero + 4 + *(int *)(*(void **)(hero + 4) + 8)`, spelled out by the
engine at `0xb7fd00`. Calling those slots on the plain pointer crashes the
battle. Same rule as everywhere here: make the call the way the engine makes
it, and no address has to be guessed.

Our own term is a percentage of the engine's own number per hero level, added
after it: `engine × percent × level / 100`, truncated. Five percent is Heroes
III's Gem — and note it **coincides with the shipped Empiric at expert War
Machines**, since five per level is five percent of a hundred, and is weaker at
every mastery below, which is what Heroes III does. Measured in game at basic
mastery, level 1: engine 20, we add 1, amount 21.

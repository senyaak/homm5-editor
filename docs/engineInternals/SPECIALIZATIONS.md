# Hero specializations

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

## The one we have lands on the first aid tent

Its arithmetic, its two crashed runs and everything else about that war machine
now live in [FIRST_AID_TENT.md](FIRST_AID_TENT.md) — a tent is not a
specialization, and the material was here only because this is where it was
found.

What belongs to THIS page is the shape of the term, which is the same whatever
it lands on: **a percentage of the engine's own number, per level of the hero,
added after it** — `engine × percent × level / 100`, truncated, because the
engine's number is an integer and so is what it hands on. Five percent is Heroes
III's Gem, and it coincides with the shipped Empiric at expert War Machines,
since five per level is five percent of a hundred, and is weaker at every mastery
below — which is what Heroes III does.

The hero is asked `HasSpecialization(value)` through the vtable slot `+0x294`,
and that call — like his level at `+0x23C` — answers on a **virtual base**,
`this = hero + 4 + *(int *)(*(void **)(hero + 4) + 8)`, spelled out by the engine
at `0xb7fd00`. Calling those slots on the plain hero pointer crashes the battle.
Make the call the way the engine makes it and no address has to be guessed.

Measured in game at basic mastery, level 1: engine 20, we add 1, amount 21.

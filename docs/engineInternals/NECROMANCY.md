# Necromancy: the raise percentage and the dark energy pool

*Answers: what the two numbers are made of, which of their terms are data, and
where a term of ours goes.*

Both are here because they are one mechanism in two objects — the percentage
belongs to a HERO and the pool to a PLAYER, and the player's version walks its
heroes to build itself. Term 7 of the first sum is the shape everything the
extension does is modelled on.

## The necromancy percentage, in full

One function at `0xc77850`, called from `0xc77c35`, returns the raise
percentage. It is a plain sum, and every term prints itself to the debug log
(`"necromancy skill raise "`, `"lord of undead raise "`, …), which is what made
it findable. Each term is capped at 100 individually; `[ebp+N]` are fields of
the `Necromancy` block of `DefaultStats.xdb`, i.e. **the numbers are data**.

| # | term | how the engine finds it | number |
|---|---|---|---|
| 1 | base | — | `RaisePercentBase` (10) |
| 2 | skill | `GetSkillMastery(15)`; **if the hero has no Necromancy skill, falls back to the level set by `MakeHeroNecromancer`** | × `RaisePercentPerSkillLevel` (10) |
| 3 | Lord of Undead | `GetSkillMastery(0x65)` (perk 101) | `LordOfUndeadBonus` (5) |
| 4 | amplifiers | count of the town buildings | × `NecromancyAmplifierBonus` (10) |
| 5 | Obelisk of Confined Souls | the Necropolis grail building | × `GrailBonus` (50) |
| 6 | **Necromancer's Pendant** | `equipped.contains(0x47)` — artifact id **71**, a literal in the code | `NecroPendantBonus` (10) |
| 7 | **the Necromancer set** | `GetArtifactSetItemsCount(5) >= 4` | `Necromancers_4Necromancer_NecromancyBonusPercents` (20) |

The **raise cost** is a second, near-identical function at `0xc77270`, and the
two are easy to confuse. It sums a discount the same way — Pendant by the same
literal id 71 (`NecroPendant_CreatureCostDisountPercents`, 10) plus the same
set at ≥ 4 pieces (`…CreatureCostDisountPercents`, 25) — caps it at 100, and
folds it into `(100 − discount) × power / (CreaturePowerPointsForOneEnergy ×
100)`. The two set constants sit in adjacent fields (`+0x119c` raise,
`+0x11a0` cost), which is how they were told apart.

So four worn pieces give **both**: +20% to the raise *and* −25% off the cost.
An in-game description that mentions only the discount is describing one of
the two.

Two things fall out of this.

**`MakeHeroNecromancer` is exactly what it looked like.** The scripted level is
consulted *only* when the hero's own Necromancy skill is zero — so it fits a
knight in a cloak and does nothing for a necromancer.

**Term 7 is the shape our own bonus should take.** It is twenty bytes: count
worn pieces of a set, compare against a threshold, add a number that came from
data. Nothing about it is special-cased elsewhere in the engine. A term for
our own set is the same twenty bytes reading our own number — which is the
whole design, and the reason the next section is short.

## Dark energy, in full

There is no setter because there is no single value being set: the pool is
`[player+0x638]`, and what the engine actually maintains is a **ceiling made of
four numbers**, which it then fills the pool up to. Everything else follows from
that. Reached from Lua by `GetPlayerNecroEnergy`, which calls the player's
`+0x1fc`.

| what | where | shape |
|---|---|---|
| the pool | `+0x638` | one int |
| the four terms of the ceiling | `+0x67c … +0x688` | four ints, copied in one `movups` |
| "this player has a necromancer" | `+0x68c` | flag, set by the same computation |
| read the pool | `0xc06c50`, vtable `+0x1fc` | `mov eax,[ecx+638h]` |
| hand out the four | `0xc06c60`, vtable `+0x200` | `lea eax,[ecx+67Ch]` |
| spend | `0xc06640`, vtable `+0x208` | clamps to ≥ 0, refuses if short, subtracts |
| recompute + clamp | `0xc06670`, vtable `+0x204` | sum the four; cut the pool down to it |
| refill | `0xc066d0`, vtable `+0x214` | recompute, then `pool = sum` |

`CNecromancy::CalcEnergyCaps` = **`0xc770d0`** (`ecx` = the five-int buffer,
`edx` = the player) fills those four the same way the raise percentage is
summed, out of the `Necromancy` block of `DefaultStats`:

| # | term | number |
|---|---|---|
| 1 | base | `EnergyBase` (200) |
| 2 | necromancer heroes | `EnergyPerNecromancerLevel` (1) × a walk over the player's heroes |
| 3 | Necromancy Amplifiers | `EnergyPerNecromancyAmplifier` (**150**) × how many |
| 4 | the grail building | `EnergyForGrailBuilding` (150) × how many |

Term 2 is where the heroes come in: the player hands over its hero vector
through its own vtable `+0xC0` (`{ begin, end }`, four bytes each), and each
hero is checked alive before `GetSkillMastery(15)` is asked of it. That walk is
worth copying rather than inventing — it is how an artifact worn by a hero can
contribute to a number that belongs to the player.

**Three sums, and only three.** Scanning every instruction in `.text` that
touches `+0x67c … +0x68c` finds the four added up in exactly three places: the
clamp (`0xc0669c`), the refill (`0xc066e5`) and the `dark-energy-bar` widget
(`0x74ed42`, reached through the accessor at vtable `+0x200`, which ten call
sites use and nothing else does). Nothing displays the four separately, so a
fifth term of ours has three places to appear and no tooltip to contradict.

That is what `native/homm5-editor.c` does: detour the refill and the clamp, and
replace the accessor's single vtable pointer so the bar is handed a copy with
our term in it. The pool itself is still the engine's to grant — we move the
ceiling, and it fills to it on its own.

**Two consequences of leaving the grant to the engine** (seen in game
2026-07-29, and expected rather than worked around):

- **A hero who starts wearing the pieces starts with the pool full to the raised
  ceiling.** The first refill runs with the artifacts already on, and it fills
  to whatever the ceiling says then.
- **Taking a piece off lowers the ceiling at once, but the pool only follows the
  next day.** The bar's maximum is recomputed on every update, so it drops
  immediately; the pool is cut by the clamp, and the clamp runs when the engine
  recalculates — which is the same rule that governs its own four terms. Energy
  already banked is not confiscated the moment the ceiling moves, and that is
  the engine's behaviour, not ours.

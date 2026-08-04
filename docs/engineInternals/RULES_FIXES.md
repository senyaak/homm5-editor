# Rules the shipped game gets wrong

Bugs in Tribes of the East 3.1 that are one wrong byte in a lookup table, taken
out in memory by a flag of their own. The battle AI's three are a page apart:
[COMBAT_AI.md](COMBAT_AI.md). The flags themselves are described in
[../QOL.md](../QOL.md).

## Whose work this is

**dredknight's [H5_DLL](https://github.com/dredknight/H5_DLL)**, ported here with
his permission (Discord, 2026-08-03: *"yes you can add it in no worries"*). His
patch is a replacement `um.dll` that writes absolute addresses of the **retail**
3.1 executable; ours is a different build of the same version, compiled for SSE
where that one is x87, so not one address survives. Each fix is found again here
by what the code does.

## The tool

`tools/reverse/match.ts` is the three ways of finding the same code in a
different build, and every claim below was made with it:

```bash
node tools/reverse/match.ts table <exeA> <vaA> <exeB> <vaB> <len>
node tools/reverse/match.ts find <exe> <maxFnLen> <hex:count> [hex:count…]
node tools/reverse/match.ts fingerprint <refExe> <refVA> <exe> <va…>
```

The retail executable to compare against is the one shipped inside
`CombatAIFix_v1.1.zip`; H5_DLL patches that same build.

## The method: a switch has a shape

Two of these are entries in a **jump-table switch** — `cmp` a bound, index a
byte table, jump through a table of addresses. That makes them findable across
builds in a way that code is not:

- The **byte table is data**, and often identical between builds. Encourage's was
  found by searching our executable for the retail table's 195 bytes: one hit.
  Try this first — one hit is an answer, and no tool is needed for it.
- When the tables *do* differ, their **shape** survives: which ids share a case,
  and which sit on the default (`match.ts table`). Two builds number the cases
  differently — ours deduplicates identical bodies where retail keeps them apart
  — but the grouping is the switch's own structure. Barbarian Learning's table
  was matched that way (13 groups against 15, differing exactly where our
  compiler merged bodies).

The snare's crash has no table, and was found a third way: by **fingerprint**.
The reference function's sequence of virtual-call slots, notable immediates and
`ret` form — `V6c V6c V0 C V1c V6c V0 C V6c V1d8 M48 M68 I19 Vc C Re4` — is what
a recompilation keeps when it throws away registers, encodings and addresses.
`match.ts find` over our `.text` for functions calling slot `+0x6C` three times
and `+0x1D8` once left two candidates out of 400 000, and `match.ts fingerprint`
scored them 88% and 34%:

```bash
node tools/reverse/match.ts find <ours> c0 "FF??6C:3" "FF??D8010000:1"
node tools/reverse/match.ts fingerprint <retail> 9bb340 <ours> dc3220 dc3090
```

The 34% one is not a miss: it is the retail function's *caller*, with the
function inlined into it — which is how both copies came to light.

`tools/test-fixes.ts` then checks every patch against the installed executable.
It finds them by walking the `overwrite_code(...)` calls in `native/` and
resolving the names each call hands it, so **a fix added tomorrow is checked
tomorrow** — a list kept by hand is a list that forgets.

## A wall summoned onto a snare — the crash

`0xDC30A6` and `0xDC3236`, RVA `0x9C30A6` and `0x9C3236`, fifteen bytes each.

The snare asks whatever stepped on it for the creature standing there — a
virtual getter at slot `+0x6C`, called four times over the function — and
dereferences the answer without testing it. Arcane Crystal and Blade Barrier are
summoned **obstacles**, not creatures: the getter returns null, `mov edx,[eax]`
reads address zero, and the battle ends.

**This one is not a transliteration.** dredknight's writes fourteen bytes over
the retail build: it tests the first call's answer and, when null, jumps over the
damage arithmetic into the tail — where `ebx` was never initialised, so the
damage applied is whatever the caller happened to leave in it. Our build inlined
the function, allocated its registers differently and put its tail elsewhere;
the same work plus a test and a jump does not fit in the bytes available.

So ours tests the same answer and jumps to the function's **own "nothing
happened" exit** — the `xor eax,eax` return the engine already uses there. The
three later calls that dereference the same null are skipped with it, nothing
stale is read, and no number is invented.

It fits because the **second call is dropped**: both calls ask the same object
the same getter one instruction apart, which the retail fix already assumes when
it tests the first answer and lets the second be dereferenced. Those three bytes,
plus one saved by `xchg eax,ecx` in place of `mov ecx,eax`, pay for the test and
the `je` exactly:

```
test eax,eax / je <exit> / mov esi,eax / xchg eax,ecx / mov edx,[ecx] / call [edx]
```

**Both copies are patched.** Our compiler emitted this code twice — inlined into
its only caller (`0xDC3090`, the live one) and standing alone (`0xDC3220`, ending
in `ret 4` where the caller ends in `ret 8`). The standalone has no `call`, no
`jmp` and no pointer to it anywhere in the image, which is every measure
available from outside — but *"no reference I can find"* is a weaker claim than
*"no reference"*, and a second verified write costs nothing. The extension logs
how many of the two took.

## Encourage, refused by an immune target

`0xAD46C8`, RVA `0x6D46C8`, one byte: `0` → `1`.

`CanCastSpellOnTarget` (`0x97F610` in retail) refuses with
`COMBAT_CANT_CAST_SPELL_IMMUNITY` when the target's immunity comes back at 100 —
but only for the abilities a switch at `0xAD46A0` says to check. That switch
answers **yes** for exactly six:

| id | |
|---|---|
| `0x34` | `SPELL_ENCOURAGE` |
| `0x36` | `SPELL_PRAYER` |
| `0x9C` | `SPELL_ABILITY_LAY_HANDS` |
| `0x9D` | `SPELL_ABILITY_RESURRECT_ALLIES` |
| `0xA0` | `SPELL_ABILITY_FEAR` |
| `0xF6` | `SPELL_EFFECT_MARK_OF_FIRE` |

Two hostile, four cast on one's own side. So a Knight's Encourage — which does
nothing to a creature but move its turn up — is refused by **his own stack**
being immune to magic.

**What the game says**, which is the test every one of these has to pass:
*"Особое боевое свойство, позволяющее воодушевлять войска на поле сражения, тем
самым ускоряя наступление их очереди драться"* — a special combat property that
hastens a friendly stack's turn. Nothing about magic. The record agrees:
`<Target>TARGET_FRIEND</Target>`, `MAGIC_SCHOOL_SPECIAL`.

**Only Encourage.** Prayer, Lay Hands and Resurrect Allies are cast on one's own
side too and are checked the same way, so the same argument appears to carry.
The fix this comes from changes one byte, and inventing three more changes in
somebody else's name is not porting it — noted here instead.

## Barbarian Learning, never taken back off

`0xC1EAFC`, RVA `0x81EAFC`, one byte: `12` → `0`.

A switch at `0xC1E87B` (inside `0xC1D3B0`; retail has it as a function of its
own at `0xB55D80`, ours inlined it) undoes what a skill granted. Index is
`skillId - 3`, byte table at `0xC1EA48`, jump table at `0xC1EA14`.

**Case 0 has exactly one member: `HERO_SKILL_LEARNING` (3).** It asks the hero
his mastery of the skill (`vt+0x174`) and walks back what it gave.
`HERO_SKILL_BARBARIAN_LEARNING` (183) — the same skill in barbarian clothing —
sits on the table's **default**, three instructions that pop and return. So the
primary-stat bonuses stay granted after the skill is gone.

Pointing 183 at case 0 is not inventing behaviour: it gives the barbarian's
Learning the case its own Learning already has. That the one-member case belongs
to skill 3 is what makes this readable rather than guessed at.

**One hole is left.** `HERO_SKILL_WARCRY_LEARNING` (185) sits on the same
default. Whether it grants what Learning grants has not been checked here, and
the fix this comes from does not touch it.

## Payback, paid out for a spell that worked

`0xB7F90D`, RVA `0x77F90D`, ten bytes — five of them a jump that buys five more.

The cast (`0xB7EA00`) keeps one byte on its stack, `[esp+0x13]`, meaning *the
spell did nothing*. It is set to 1 at `0xB7EAE5`, right before the dispatch, and
copied out to the caller in the tail (`0xB7FAFB`). A damage spell clears it —
`sete` on the total, so zero damage counts as nothing. The three spells that put
an **obstacle** on the field never touch it, and it goes home still saying 1.

The caller reads that as a resisted spell: `cmp byte ptr [esp+13h],0` at
`0xB764DE` and `0xB768CD`, then "Payback!", the whole cost back, and the hero's
turn moved up. Cast an Arcane Crystal with the perk and it is free.

**What the game says**: *"Если заклинание не подействовало на отряд существ
благодаря их сопротивлению магии, то герою возвращается вся потраченная на
заклятие мана, и его следующий ход наступает раньше."* Mana comes back when a
stack **resisted**. Nothing resisted a crystal that is standing there.

**How it was found.** `"Payback!"` is in the image once (`0xFBC97C`) and pushed
from three places; the two that matter sit three instructions below the byte's
test, and the call above them — `0xB7EA00` — is the cast this fix is about. A
string with one use is the cheapest anchor there is, and it needed none of the
tooling.

**One place for three spells.** Ids `0x11A`–`0x11C` index a four-entry jump
table at `0xB7FC8C`: Arcane Crystal and Summon Hive share a body at `0xB7F8F4`,
and Blade Barrier lays its three tiles at `0xB7F917` before jumping back into
that body for the last of them. So all three leave through the same
`call 0xD54520` — put the obstacle down — and the `jmp` to the tail after it.

**Ten bytes, and five wanted.** dredknight writes the clear over the retail
build's last placement call, where his compiler left room. Between our call and
our tail there are exactly ten bytes and no room at all, so the `jmp` becomes a
jump to ten bytes of ours: clear the byte, jump on to the tail it was going to
anyway. Nothing is displaced and the stack is untouched — the tail reads
`[esp+0x13]` at exactly the `esp` we hand it, which is what makes this safe to
say.

His file is `ArcaneRenewalFix.cpp`; that is Heroes 5.5's name for the perk, and
the shipped game calls it Payback.

## Empowered Armageddon, which the impact code does not recognise

`0xD60E26` (eight bytes, one of them the fix), `0xD60EA6` and `0xD610B7`.

`SPELL_EMPOWERED_ARMAGEDDON` is id 232 and `SPELL_ARMAGEDDON` is id 10. The
engine knows they are one spell: `0xAD44C0` maps every empowered id to the spell
it is a version of — a jump table at `0xAD4294` over ids 223…330, where 232
answers `mov eax,0Ah` — and the cast dispatcher uses it, which is how both reach
the same impact function (`0xD60C30`).

That function then asks three questions about the spell, and asks all three of
the **raw** id:

| where | question | when the answer is no |
|---|---|---|
| `0xD60E29` | is this Armageddon? | the damage at the point of impact is zero |
| `0xD60EA6` | is this Armageddon? | a target with no creature — a war machine — is skipped |
| `0xD610BA` | is this Armageddon? | the tiles around the impact take another path |

So the empowered spell costs double the mana, hits for 50% more, and is the
weaker one in every way the code decides by id. Its own description promises
*"урон всем существам **и боевым машинам**"*.

**The first site is one byte.** `0xAD44C0` is called four instructions above it
and its answer is still in `eax`, live and used two instructions below; the
comparison reads the raw id out of `ecx` instead. `cmp ecx,0Ah` becomes
`cmp eax,0Ah` — `F9` to `F8` — and `ecx` keeps the raw id, which the call below
still wants.

**The other two ask.** Each jumps to a stub that calls `0xAD44C0` and jumps on
to whichever of that site's two continuations the answer picks. The spell object
is in `esi` at both, `0xAD44C0` preserves `esi`, and both continuations reload
every other register the stub touches — except at the third site, whose
else-branch pushes the raw id it loaded, so there the ask is bracketed by
`push eax` / `pop eax` (a `pop` leaves the flags alone).

dredknight's version hard-codes 232 beside 10 at the second and third sites, and
at the first removes the comparison altogether — which would give the local
damage to every spell that shares this code, Holy Word among them.

## Dragon Form, offered to a dragon that never upgraded

`0xABC9FC`, RVA `0x6BC9FC`, thirteen bytes.

The Rune of the Dragon Form gives a stack +100% attack and defence and +50%
magic resistance for a turn, and its description ends *"(неприменимо к
драконам)"*. The refusal has a string of its own —
`COMBAT_RUNIC_SPELL_CANT_DRAGONFORM`, *"Драконье обличье неприменимо к
драконам"* — and one function decides it: `IsDragon` (`0xABC9F0`), called from
exactly one place (`0xDA0759`).

It answers from a table of four ids at `0xABCA30`: Bone (41), Green (55), Deep
(83), Fire (104). But **it does not look up the id it was given.** It looks up
`[record+0x100]` — the creature's BASE creature — which is `CREATURE_UNKNOWN`
for a creature that is a base itself. `add eax,-0x29` then takes zero out of
range, `ja` answers "not a dragon", and the four the table names are the four it
cannot catch. Upgraded dragons are caught correctly: Magma's base is Fire,
Rainbow's is Green.

**How `+0x100` was read.** By the idiom around it. Reading a base creature in
this executable is always two steps — `[record+0x100]`, and when that is zero
the creature's own id from `[unit+0x1C]`, the same `+0x1C` handed to `IsDragon`.
Three copies of it in our build, eighteen in retail:

```bash
node tools/reverse/match.ts find <exe> c0 "8B800001000085C075:1"
```

`IsDragon` has the first half and not the second. That is the whole bug, and it
is also the fix.

**Thirteen bytes, and eleven wanted.** The record is already in `eax` — fetched
four instructions up, tested against null, untouched since — so
`mov ecx,esi / call GetCreature / mov eax,[eax+0x100]` is the same fetch done
twice. Dropping the repeat pays for the fallback with two bytes to spare:

```
mov eax,[eax+0x100] / test eax,eax / cmovz eax,esi / nop / nop
```

**And the thirteenth dragon.** The table is four ids compiled into the
executable, so the fix above ends exactly where the shipped game ends: a dragon
of the editor's is not in it and never can be. So a creature of ours says it for
itself, the way it says it is undead — with an ABILITY in its own record.
`ABILITY_DRAGON` is a real one, added to the `CombatAbilities` table and to
types.xml the way an artifact is added, and doing nothing whatever, since
nothing in the engine asks about it. See [../NEW_CREATURES.md](../NEW_CREATURES.md).

**And we ask the creature, not a list.** The one place the question is asked
(`0xDA0759`) is pointed at us: the engine's answer first — the table, now with
its fallback — and the creature's own abilities after it. The only thing the
extension cannot work out is which NUMBER the ability got, since that is decided
when the mod is built, so the config carries that one number
(`dragon-ability <n>`) and nothing else. Give the ability another number and the
line moves with it.

**Where a record keeps its abilities is measured, not assumed.** They are a
vector — `begin` and `end` pointers, four bytes an entry, the shape the engine's
own accessor at `0xABA730` reads a record's vector with. The offset is found
once, on the first question, by looking: the Fire Dragon (104) carries exactly
Elemental (12), Immunity to Fire (21), Fire Shield (62) and Fire Breath (76), in
that order and nothing else, so the record is searched for the pointer pair
whose contents are those four. One hit is the offset, and the log says which.
No hit means the data under us is not what was measured — and then this answers
nothing rather than dereferencing a guess.

**Not a transliteration.** dredknight's patch throws the table away and answers
`tier >= 7`. That covers the same four, but it makes a dragon of every other
tier-7 creature: an Archangel or a Titan in a dwarf's army would be refused a
rune the shipped game allows. The rune's text says dragons, and the engine
already knows which creatures those are — it was only asking the wrong one.

## What is not done

Proving the effects in a running game. The patches are verified as bytes and the
extension logs what it installed (`bin/homm5-editor.log`), but "the barbarian
loses the stats when he forgets the skill" is a thing to watch in a battle, and
nothing here automates that.

## Not ported, and why

- **AgilityFix** — dredknight withdrew it himself: the ability's in-game text
  says the unit *begins* combat with the charge, so the "fix" contradicted the
  description rather than restoring it. The lesson is the process: check the
  claimed bug against the game's own words before porting.
- **OneStackSplit** — a change, not a fix, and `quick-split` covers the same
  ground on our side.
- **EliteCastersFix** — his own file calls it a *Change*: Elite Casters halves
  what a creature caster pays, and he narrows that to the four magic schools so
  it stops applying to abilities. The perk's text says *"потратят только
  половину маны, которая требуется на создание заклинания"* and does not draw
  that line — and the line makes no difference anyway: **not one creature
  ability in the shipped data has a mana cost at all** (every `TrainedCost`
  under `Spell/Creature_Abilities` is zero), so there is nothing for the
  halving to be wrong about. A change with no effect is not worth a switch.
- **CombatAIFix** — already ours, found independently; see
  [COMBAT_AI.md](COMBAT_AI.md).

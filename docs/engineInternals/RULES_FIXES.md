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
- **CombatAIFix** — already ours, found independently; see
  [COMBAT_AI.md](COMBAT_AI.md).

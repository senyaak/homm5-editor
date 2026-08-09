# A spell of our own

*Answers: what a spell is in the data, what it is in the code, how far one of
ours gets on its own, and what the extension has to carry. Written up
2026-08-07, mid-work — the state below is measured in game unless it says
otherwise.*

## The data half, and its ceiling

A spell is one entry in `GameMechanics/RefTables/UndividedSpells.xdb` — 353 of
them, spells, hero abilities, creature abilities and the effects they leave, in
one list. Unlike a creature the entry is a **path**, so a spell of ours is a
document the mod carries plus a line pointing at it.

Its size is stated **five** times and all five have to move together:

| where | what |
|---|---|
| types.xml | the `SpellID` enum list |
| types.xml | the name→number map (the NUMBER is what saves and maps store) |
| types.xml | `ref_table_num_objs`, `MinElements`, `MaxElements` — equal here, as with artifacts |
| the executable | the count pushed when the table is registered (`push imm32`) |
| the executable | a LIVE accessor, `0xb1eec0`, twelve callers |

The accessor is the half a table loses silently: registered longer, accessor
short, and everything past the shipped count is simply never offered. The skill
table taught that once already. `src/exe/table-limit.ts` (SPELL_TABLE) moves
both; `src/mods/spells.ts` writes the data half; `tools/test-spell-mod.ts`
checks each of the five by itself.

## The document, in full — and what is not in it

Twenty-two fields, all of which the editor writes: `NameFileRef`,
`LongDescriptionFileRef`, `Texture`, `EffectTexture`, `SpellBookPredictions`,
`CombatLogTexts`, `Level`, `MagicSchool`, `RequiredHeroLevel`, `TrainedCost`,
`damage`, `duration`, `sSpellCost`, `IsAimed`, `IsAreaAttack`, `CanSelectDead`,
`Target`, `Element`, `DamageIsElemental`, `visuals`, `PresetPrice`,
`AvailableForPresets`.

Two of them are not what their names suggest:

- **`TrainedCost` is the MANA a cast costs.** Magic Arrow 4, Plague 6, Fireball
  10. Left at zero the book offers a free spell, which is how ours shipped
  first.
- **`damage` is four entries read positionally**, one per mastery of the school,
  each `Base` + `PerPower`. Fewer than four is not an option, so a spec that
  gives fewer repeats its last.

`visuals` names `SpellVisual` documents, and those are scenery too — `Effect`,
`SoundEffect`, `Decal`, `HitDelay`, `ParticleDuration`. **Nothing anywhere in
the data says what a spell DOES.** Armageddon hits the whole field and its own
`IsAreaAttack` is `false`.

## The code half: the resolver and its dispatch

`CCastCombatSpellCmd::Execute` (`0xb72790`, the command's vtable `+0x1C`) is what
a click becomes; the spell id is the command's `+0x10`. It asks one question it
returns on — the cast gate, `0xB7B4C0` — and then reaches the resolver,
`0xB7EA00`, whose shape is the whole story:

```
mov byte ptr [esp+13h],1     "this spell did nothing" — set BEFORE the id
call 0xAD44C0                ecx = the spell's id
cmp ecx,115h  /  lea eax,[ecx-0Bh]  /  jmp [eax*4+0B7FB40h]      first table
dec ecx / cmp ecx,0ECh / jmp [eax*4+0B7FB60h]                    second table
…
ja 0xB7FADA                  everything it does not know goes to the tail
```

Two dispatch tables, an index byte array before each (`0xB7FB48`, `0xB7FB9C`).
A branch is short — Unholy Word's (`0xb7ed4a`) is six instructions: prepare the
power, `call 0xD60C30`, `mov byte ptr [esp+13h],0` — *it worked* — and `jmp
0xB7FAF0`, the success tail.

**That byte is also Payback's.** The perk reads it as "the spell was resisted"
and refunds the mana ([RULES_FIXES.md](RULES_FIXES.md)), so a spell of ours that
never clears it is a spell that pays its caster back.

## How far a spell of ours gets by itself

Measured, in this order, each on a run in the game:

1. It is in the book, on its page, with its name, its icon and its mana.
2. The book asks the gate per target to decide whether to grey it — which is why
   Resurrection is grey the moment the book opens.
3. A click becomes a command carrying our id, with a living caster.
4. **The gate refuses it, silently** — no reason pushed, no message.
5. So the resolver never hears about it, and nothing happens.

And the refusal is about the NUMBER, not the document. The control that settled
it: a copy of Armageddon differing in nothing else — same school, level, mana,
damage, both of its visuals — is refused exactly the same way.

## What the extension carries (`native/combat/spell-*.c`)

Three marks and one answer, all built up from the runs above:

| where | logs as | what it does |
|---|---|---|
| the dispatch head `0x77eaf8` | `[resolver]` | for OUR ids fires the battle event and **calls our own resolver** |
| the command `0x772790` | `[cast command]` | logs the command's block and what it returned |
| the gate `0x77b4c0` | `[gate]` | logs the verdict, and for ours answers **whether the cast would reach anybody** |
| the gate's refusal funnel `0x77b51e` | `[gate]` | logs the reason the engine names |
| the damage lookup `0x77ce8a` | `[worth]` | for ours, takes the case that reads the record |
| the damage function `0x7861a0` | `[damage]` | for ours, spares the kinds the mod's row names |
| the record getter `0x71eed0` | `[record]` | refuses a number that is not an id instead of reading past the table |
| a spell's text `0x6d5140` | `[text]` | builds the string off a spell that exists when the record is missing |

**A tag is a place, not a deed.** No line here means a person pressed anything:
the engine walks a hero's whole school through `[gate]` and `[resolver]` when a
book opens or the AI weighs a move, and one cast prints `[damage]` once per stack
on the field. The tags were added after a log of exactly that walk — eleven Dark
spells, level by level, ending in Unholy Word — was read as eleven casts. Read
the sequence, and give a new hook a tag of its own.

**Only the silent refusal is overruled.** The funnel raises a flag; a refusal
that named a reason (`COMBAT_CANT_CAST_SPELL_IMMUNITY`, `COMBAT_NO_ENOUGH_MANA`,
`COMBAT_CANT_CAST_BLOCKED_SPELL`) is the engine applying a rule that has nothing
to do with our number, and answering over it made the ripple the one spell in
the game that ignores a black dragon — found in a battle, fixed the same day.

With that in, the cast goes through: `cast: OURS, spell id 353` from the
resolver, and the engine carries the mana, the hero's turn and the animation.

## The gate, mapped — and what "yes" should have been

**The overrule started as a flat yes, and that was a bug of ours**: a spell of
ours could be cast where it would touch nobody. The mana went, the hero's turn
went, and nothing happened — while the book kept the page bright, because a page
greys off this same answer. Read out 09.08.2026, after it was called one.

**The gate branches on the DOCUMENT, not on the number.** Every question it asks
about the spell itself goes through the record accessor `0xB1EED0`:

| it asks | which is |
|---|---|
| `0xAD3E30` | `[rec+0xCC]` — `IsAimed` |
| `0xAD4800` | `[rec+0xCD]` — `IsAreaAttack` |
| `0xAD4610` / `0xAD4640` | `[rec+0x88]` — the school, against 5 and 6 |
| `0xAD4580` / `0xAD4670` / `0xAD4790` | a literal id each: 208, 67, and 348…351 |

So a spell of ours is routed like any other, and it reaches one of four
endpoints — none of which is reached by being compiled in:

| the spell | ends in |
|---|---|
| aimed, with a target, area | `0xB83470` |
| aimed, with a target, no area | the tail at `0xB7B87C`, which needs one |
| school 5 / 6 | `0xC63940` / `0xD5B660` |
| **no target at all** | **`0xB840B0`** |

**And `0xB840B0` is the fifth switch on the number.** `cmp eax,13Ch` and two
jump tables; everything they do not name falls to `0xB84423`, which is
`xor al,al / ret 4` — the silent refusal, in two instructions, with the document
never consulted. That is where a whole-field spell of ours died.

**The engine's own case says what the answer should be.** The one for spell 316,
four instructions long: build the list of stacks the cast would touch
(`0xD61830`), then

```
cmp ecx,[esp+1Ch]     ; begin against end
setne bl              ; "there is somebody to hit"
```

So the question the gate is really asking a mass spell is *would this reach
anyone* — and the answer is a list, not a flag. Ours answers the same, out of
the walk the cast itself is about to make: `our_cast_would_reach_anyone` in
`native/combat/spell-resolve.c`, sharing `we_would_hit` with the resolver so the
two can never drift apart. A spell of ours that would reach nobody is refused,
the mana stays, and — because the same answer is given to a question as to a
cast — the book greys the page by itself, the way it greys Resurrection.

**What the gate hands us**, read at the call site `0xB7287C` and both readings
anchored in the source so a test checks them rather than a battle:

```
xor ecx,ecx                 ; the message sink — absent when nobody is asking
lea edx,[ebx+0Ch]           ; THE BLOCK: the command's own, twelve bytes in
push dword ptr [ebx+24h]    ; the second argument — the stack aimed at, or none
push dword ptr [ebx+20h]    ; the first — the CASTER
call 0xB7B4C0
```

and four instructions later the command measures `[ebx+18h] - [ebx+14h]`, the
vector of stacks the cast will touch — so it is already built when the gate is
asked, and it is the block's `+0x08`/`+0x0C`. **Only inside a command**: the
seven other callers ask with a local of their own, where those offsets are
somebody else's business, and there the area shape answers "cannot tell".

**Cannot tell is a yes, and it is a third answer on purpose.** A wrong no is a
spell that can never be cast; a wrong yes costs one cast's mana. So a missing
record, a caster with no combat, an unreadable list — each answers yes and says
so.

## The bridge to Lua

A cast of ours becomes ONE battle event, `H5E_SPELL_CAST` (4), with the number
as its argument; `H5EOnSpellCast(id, fn)` is the sugar a spell's script uses.
The runtime is Lua the mod ships (`src/mods/skill-scripts.ts`,
`COMBAT_TRIGGER_RUNTIME`), and the closure it builds reads its captures as **Lua
4 upvalues** (`%spell`, `%handler`) — written plainly they are nil at call time
and the handler never fires.

A spell carries its script the way a skill does: `SpellSpec.script` becomes
`scripts/homm5-editor/<file>-spell.lua`, and the same runtime loads it. Proven
in game: `battle fires: H5EFire(4,353)` and then the script's own line in the
log.

**A script can log.** `print` reaches the game's console only; `H5ECombatTest()`
is ours and lands in the run's log, `bin/homm5-editor-*.log` (`--log lua/battle`),
which is how "the script never
loaded" is told from "it ran quietly".

## Which creatures a spell may touch

`ABILITY_FLESH_AND_BLOOD` exists, has a name and a description, and **no
creature carries it**: the game prints «Живое существо» when none of the three
kinds is there. The kinds are one field with three values — «Нежить»,
«Механизм», «Живое существо» — never printed together.

So the mod generates the lists out of the creature records at build time and the
battle runtime carries them as tables keyed by id: 37 not living, and the black
dragon alone proof against magic. A script asks `H5EIsLiving(creature)`. A
creature the mod adds is in them without anybody remembering.

## The effect: a resolver of our own

The battle's own vocabulary reads a stack and cannot hurt one, so the damage has
to come from the engine — and it must, because **resistance, anti-magic, school
protection and the combat log are all inside the engine's own routines**. Damage
applied by hand would bypass every one of them and the result would look exactly
like our bugs.

**But calling those routines and standing inside somebody else's branch are two
different things**, and for a while this was the second one: a cast of ours
`jmp`ed into the middle of Unholy Word's six instructions. What that cost is
measured — three crashes in a row on casts of *Unholy Word itself*, byte-identical
registers each time, and one cast of ours running the per-stack filter 178 times
because it was inside a loop written for another spell. See
[the standing rule](#the-line-borrowed-and-called) below.

So the walk is ours and the leaves are the engine's, each called through **its
own entry point** with the arity taken from its `ret`:

| ours | the engine's, called properly |
|---|---|
| which stacks — the whole field, the tiles of our row, the one aimed at | `0xBAB520` every stack on the field (`ret`) |
| which of them this spell passes over | `0xB57100` may a spell touch this stack (`ret 4`) |
| the loop, and the running total | `0xB7CE70` what the spell is worth (`ret 0Ch`) |
| the "did nothing" byte, from the total | `0xB7D030` what it does to one stack (`ret 18h`) |
| | `0xB75C10` the **combat log line**, the floating number, and what a vulnerability ADDS (`ret 10h`) |
| | `0xBD1980` **one stack's** entry — what the battle plays back (`ret 10h`) |

`0xB7D030` and `0xB75C10` have twenty-one and fourteen callers of the engine's
own; neither belongs to a spell. Between them sits `0xB861A0`, which is where
resistance, anti-magic, school protection and our own row's filter all apply — so
nothing is skipped by resolving the cast ourselves.

**`0xB75C10` does NOT answer with the damage, and a run was spent learning it.**
Called it "the stack loses it" and summed its answers, and a cast of the mod's
came back zero eight times out of eight while every stack was taking twenty —
so the cast called itself a spell that did nothing, skipped the entry the battle
shows, and nothing happened at all. What the function actually does, read after
the log said `landed 0`:

```
ecx = 0xAD4E90(spell)                 ; the spell's own text
call 0xC49DB0 / 0xC49F20 /            ; THE COMBAT LOG LINE — four composers,
     0xC49D90 / 0xC49E00              ; by which of caster and spell are known
st  = a multiplier that comes back    ; 1.0 unless something is vulnerable
if (1.0 >= it) return 0
extra = damage * (it - 1)             ; only the SURPLUS
"FLYING_SIGN_ELEMENTAL_DAMAGE"        ; the number that floats over the stack
```

Every shipped branch adds it to the damage it already had — `mov [esp+20h],eax`
/ `call` / `add ecx,eax` / `sete [esp+13h]` — and so does ours. **A cast's total
is `damage + extra` per stack**, and that total is the "did nothing" byte.

## A cast changes nothing. It builds a CHAIN, and the caller plays it

This is the piece that cost three runs, and it is measured rather than read.

**Nothing inside `Resolve` writes.** Six functions followed to their `ret`: the
worth is arithmetic; `0xB861A0` ends `mov eax,edi / ret 8`; `0xB7D030` returns
`esi`; `0xB75C10` writes a combat log line and a floating figure; and the
sixty-byte object the appliers build is, by its own RTTI, **`CCombatEventLog`**.

**The probe settled it.** Asking the stack itself — `vt+0x1D8`, the creature
count the engine's own `0xB57310` clamps against — gives `before 200` and
`after 200` around our whole cast, **and the creatures still die**. So the cast
produces EVENTS and the caller applies them: `Resolve` returns the chain in
`edi`, and its caller hands it straight on —

```
0xB7B3F3  call 0xB7EA00              ; Resolve → eax, the chain
0xB7B3FE  push eax
0xB7B3FF  call dword ptr [edx+110h]  ; and there it is played
```

`CCombatEventHit`, `CCombatEventDeath`, `CCombatEventFlyingNumber`,
`CCombatEventSpell` — the battle is a stream of these, and a spell's damage
rides in the entry an applier builds.

**Which is why the entry is per STACK.** The mass routine's applier call sits
inside its loop (`mov edx,edi` — its loop variable — at `0xD61152`), and so does
the area routine's. One entry for the whole cast, in the caster's name, is a
cast whose every logged number is right and which nobody pays for — measured
08.08.2026, eight stacks dealt twenty apiece and a total of 160 that changed
nothing.

**And the visual is per stack too**, played before the entry:

```
combat->vt[0x108]()           ; a yes means this battle wants no visuals at all
SpellVisual(spell, which)     ; 0xAD5050, `ret` — ecx and edx are the WHOLE
                              ; signature; the pushes at the call site belong
                              ; to the next call. Index into the document's
                              ; `visuals`; past the end answers NULL.
unit->vt[0x280](chain, visual, 0, 0, 1)     ; the stack plays it, chain grows
```

The mass routine asks for visual `1` and the single-target branch for `0`, so a
document's `visuals` are authored in that order; ours asks for the second and
falls back to the first.

`0xD60C30`, the mass-damage routine the Armageddon branch calls, is **no longer
used by us at all**. It is worth keeping the reading of it, because it is what
the whole-field shape is measured against:

- It **takes the spell from the cast's own block** (`[ctx+4]`), never as an
  argument.
- It walks **every stack on the field**, alive or not, and asks two questions
  per stack — one shared with Armageddon, one about distance.
- Its inner `jmp [ecx*4+0xD61290]` is **not** a filter. The index array covers
  ids 10…239 and holds two values, and the four that differ (Armageddon, Unholy
  Word, Holy Word and the boss firewall) only pick a different **propagation
  speed** out of the config (`cfg+0x9D4`) instead of the constant 10.0.

The kind filter is in `0xB861A0` — "how much does this spell do to that stack" —
which opens with it:

```
ebx = normalise(block->spellId)              ; 0xAD44C0
if (target) {
  if (ebx == SPELL_UNHOLY_WORD)              ; 21
    return 0 if HasAbility(ABILITY_UNDEAD) or HasAbility(ABILITY_DEMONIC)
  if (ebx == SPELL_HOLY_WORD)                ; 35 — the same rule inverted
    return 0 unless demon-raged, undead or demonic
}
… resistance, anti-magic, protection from the school, the combat log …
```

Two cases, both compiled against a literal, and `HasAbility` is a virtual on the
stack (vtable `+0x28C`). Everything below the filter is where the rules live.

## The line: borrowed and called

"Do not reuse engine code" cannot mean "do not touch the engine" — every hook is
a call into it. The line that is usable, and the one this file is written to:

- **Allowed, and correct:** calling an engine function through **its own entry
  point**, with a signature taken from the code. Arity from its `ret`, never from
  the shape of one call site.
- **Not allowed:** entering the **middle of another spell's branch** and
  inheriting its stack frame.

Only when there is no other way in does a mid-function entry get taken, and then
it is written down with what it costs. There is exactly one left, and it is not a
spell's: `0xB7CED1`, the worth switch's document-reading case, shared by
twenty-one ids. What it costs is in `native/combat/spell-switches.c` beside it.

**`SPELL_ARMAGEDDON` and `SPELL_UNHOLY_WORD` are not touched by us at all** — not
borrowed, not detoured, not read.

## And the second dispatch, which the first run found

Once the field was walked and the filter spared the undead, every living stack
still took **zero**. The reason is one
function EARLIER than the damage. `0xB7CE70` is "what is this spell worth at this
power", asked once before the loop, and it is a switch on the number too:

```
edi = normalise(spellId)
cmp edi,117h  /  je 0xB7CED1                   ; the ones that hurt
lea eax,[edi-1] / cmp eax,0EEh / ja 0xB7CEBD   ; out of range
jmp [eax*4+0xB7CF34]                           ; 21 in, 218 out
…
0xB7CEBD:  xor esi,esi                         ; a spell it does not know
0xB7CED1:  ecx = the id ; push the power ; call 0xAD4EC0   ; READ THE RECORD
```

Twenty-one spells reach `0xB7CED1` — the nine destructive ones, Armageddon,
Plague, both Words, the mines, the wasps and a few creature abilities. Everything
else gets a hard zero. So **a new spell needs the effect AND the number**, and
they are two different switches in two different functions.

`0xAD4EC0` itself is generic: handed the id and the power it reads `<damage>` out
of the loaded document, four entries by mastery. From there the numbers are the
editor's.

## The three damage shapes, and what chooses between them

The resolver has ONE branch per shape, not per spell. Following both of its
switches, the whole table is 17 branches for 353 spells, and for damage there
are exactly three. **We take none of them** — the column is here so a shape of
ours can be read against the game's own:

| the game's branch | the game's own spells | the shape |
|---|---|---|
| `0xB7ED4A` | Armageddon, Holy Word, Unholy Word | every stack on the field |
| `0xB7ED16` | Fireball, Frost Ring, Stone Spikes | an area around a point |
| `0xB7F6DC` | Magic Arrow, Lightning Bolt, Ice Bolt, Implosion, Magic Fist | one stack |

**Where ours gets each list.** The whole field is asked of the combat
(`0xBAB520`, both sides). The area needs no tile-to-unit lookup at all: the
command has already turned the covered tiles — which are OURS, from the row —
into a list of stacks and left it in the cast object at `+0x24`/`+0x28`. One
stack is the cast object's `+0x18`.

**What separates them is already in the document.** `IsAimed` and
`IsAreaAttack` — the two flags the gate reads and the extension already had to
hand — split the shipped spells with nothing left over:

| `IsAimed` | `IsAreaAttack` | shape |
|---|---|---|
| false | false | the whole field |
| true | true | an area |
| true | false | one stack |

So a cast of ours picks the shape its own record implies. Nothing new is said
anywhere: no field in the document, no row in the config, and in the editor it is
two checkboxes that already exist.

**The limit, before it bites.** The flags separate the three DAMAGE shapes and no
more — Curse and Bless read `true`/`false` too, exactly like Magic Arrow, because
they aim at one stack as well. The day a spell of ours puts an EFFECT on that
stack instead of hurting it, the config row will have to say which shape it is.

### And the area's own shape: a third dispatch

`IsAreaAttack` says a spell hits an area. It does not say WHAT area, and the
document has no field that does — twenty-two of them and not one is a radius.
The shape is `0xB7BE30`, and it is a switch on the number like the other two:

```
edi = normalise(spellId)
if (!IsAreaAttack(edi) && !isMassSpell(edi)) return {}   ; nothing to cover
cmp edi,11Ah / … / jmp [eax*4+0xB7C67C]                  ; the shape
0xB7C59A:  if (!isMassSpell(edi)) return {}              ; the default
```

Every area spell has a case of its own — Fireball, Frost Ring, Stone Spikes,
Meteor Shower, the Firewall, the death cloud, the scatter shot, gating, the
battle dive — and the 221 ids that share the default get **nothing**, because
that default is only for the twelve mass spells (`isMassSpell` = `0xAD40C0`,
which is ids 210…221 mapped back to the spell they are a mass version of).

So the flag is the DOOR, not the shape: a spell of ours with it set would ask
where to aim and then cover no tiles at all.

**And the shapes are not a menu.** The engine builds each list by pushing one
tile at a time — `vector<Point>::push_back` at `0x584970`, `__thiscall`, eight
bytes an element — and every case it has is only a different loop around that
call. A fireball is the point plus the eight around it; a frost ring is those
eight without the point; the mass spells' default is a 4×4 block, both axes
running −1…2.

So ours is our own loop, over offsets the mod writes: `spell 355 area 0,0 -1,0
1,0 …`, with `(0,0)` the tile aimed at. Any set of tiles at all.

**The grid is SQUARE, and the engine says so.** Its "adjacent tiles" routine
(`0xC0F3D0`) walks a table at `0x10910E8` holding eight pairs — `(0,-1) (0,1)
(-1,0) (1,0) (1,-1) (1,1) (-1,-1) (-1,1)` — which is a 3×3 block without its
centre. That is also what makes a fireball a 3×3. Plain (dx, dy) is the whole
coordinate system; nothing here is hexagonal.

Only an area spell of ours reaches that switch: the other two shapes have the
flag false and are not mass spells, so the early exit turns them away first.

## What a spell of ours is made of

| where | what |
|---|---|
| the dispatch stub `0x77eaf8` | for our ids, **call our own resolver** and leave through the function's own exit |
| the worth stub `0x77ce8a` | for our ids, take the case that **reads the record** (`0xB7CED1`) instead of falling to the zero |
| the shape stub `0x77be7f` | for our ids, **push the tiles the row names** and join the engine at its tail |
| the damaging stub `0x7d0e88` | for our ids, answer **yes** to "does this spell deal damage" |
| the damage function `0x7861a0` | for our ids, answer **zero** for the kinds the mod says it spares, then let the engine do the rest |
| `bin/homm5-editor-effects.txt` | `spell 353 spares 10 12 9` — the kinds, by ability NUMBER<br>`spell 355 area 0,0 -1,0 …` — the tiles, as offsets |

**The exit is not a borrowed branch.** `0xB7FAF0` is the epilogue every one of
the 250 cases jumps to — it writes the "did nothing" byte through the caller's
pointer, frees two things the prologue made and returns `edi`. It belongs to the
function, not to a spell. Our stub arrives with the frame untouched (a `pushad`,
a `call`, a `popad`) and `edi` still the chain the caller passed in.

**The stubs are hand-assembled and now checked as such.** `tools/test-fixes.ts`
decodes every `*_STUB` byte row: it must be whole instructions ending exactly at
the length it declares, and every branch inside it must land on an instruction
boundary. Both halves have already caught a real miscount — the offsets in the
installer are counted by hand, and they move whenever an instruction is added.

**The cast object is the source, not the frame.** The prologue copies ten of its
fields onto the stack before the dispatch, which is how each shipped branch reads
them; ours reads the object, because a frame offset is only true until somebody
pushes. Every one was read out of the code that uses it:

| field | what | how it was read |
|---|---|---|
| `+0x04` | the spell id | `mov ecx,[eax+4]` before every worth |
| `+0x14` | the caster | `ebp` for the whole function |
| `+0x18` | the one stack aimed at | the single-target branch's second argument |
| `+0x24`/`+0x28` | the affected stacks, begin/end | the area routine's vector |
| `+0x2C` | the caster's spell power | reaches `0xAD4EC0` as the multiplier |
| `+0x30` | the mastery | reaches `0xAD4EC0` as the table index |
| `+0x34` | a scale, float | the last-but-one argument of the hit |

The "did nothing" byte at `[esp+13h]` is written by the stub from whether the
whole cast landed anything — so a spell of ours stops paying its caster back.

The row is the only part of a spell that does not travel in the archive: the
game's data has no field for it and the engine has no case for our number.
`writeModEffectsFile` writes the whole file from the manifest, in one place —
there are four kinds of row now and three callers, and a caller that knew three
of them silently deleted the fourth.

## Data or a switch: which is which

The pattern is worth stating, because it decides how much work a new property is.

**A switch on the NUMBER** — needs a case of ours, one stub each. Four so far, and
all four are about CHOOSING A BEHAVIOUR:

| what it decides | where |
|---|---|
| what the spell does | `0xB7EA00`, the resolver |
| what it is worth | `0xB7CE70` |
| which tiles an area covers | `0xB7BE30` |
| whether it deals damage at all | `0xBD0E80` — nine callers |
| which ELEMENT a whole-field spell hits in | `0xD610BA` — one applier per element, and a fourth for none |

**Read from the RECORD** — works for a spell of ours with no code at all, because
the engine reads the document the same way for every id. Everything about
VALUES AND PROPERTIES is here: school, level, mana, the four damage entries,
`IsAimed`, `IsAreaAttack`, and the **element**.

The element is the clearest case. `SpellElement` (`0xAD4E50`) normalises the id,
fetches the record, answers 0 unless `DamageIsElemental` is set and otherwise
gives `Element` (`+0xD4`, `+0xD8`). **Twenty-two places ask it and not one looks
at a number**: the four elemental protections in the damage function each pair a
flag on the target with this answer, and the three Master perks pick their skill
from it — air `0x2D`, water `0x2B`, fire `0x2C` — before leaving the burn.

So "does each modifier have to be reversed separately" is answered no. What had
to be found for the burn was not the burn: it was the gates in front of it.

### The Master's mark, and why the shapes differ

`0xBD1420` is the function that leaves one — it asks the caster for
`HERO_SKILL_MASTER_OF_FIRE` (44; Ice is 43) and the target for the two abilities
that exempt it, then hands a number to `SPELL_EFFECT_FIRE_DAMAGE` (202).

**THE FOUR ARE NOT INTERCHANGEABLE, and this is the thing to know before calling
any of them.** Their `ret`s are `10h` (fire), `14h` (air), `18h` (water) and
`10h` (plain) — four, five, six and four stack arguments — and fire even swaps
the roles of `ecx` and `edx` against the plain one (`ecx->vt[8]` where the plain
does `edx->vt[8]`). A call written for one and pointed at another returns with
the stack short, and the crash lands somewhere with nothing to do with spells.
That is what `mass-spell-element-fix` used to risk; see below.

**Our own resolver calls the PLAIN one**, whose argument list is decoded from the
resolver's own single-target branch: `ecx` the caster, `edx` the stack aimed at,
then (damage, chain, spell id, `Resolve`'s own first argument). So a spell of
ours builds its entry and leaves **no Master's mark** — each of the other three
needs its own reading first. Named, not hidden.

Five places call the fire one, and two of them are routines a spell of ours used
to borrow — which behave differently:

- **the area routine** (`0xD608C0`) dispatches on the **element**: air →
  `0xBD1790`, fire → `0xBD1420`, water → `0xBD12C0` — and pushes five, four and
  six arguments respectively, which is where the arities above were read.
  **Measured, while the branch was still borrowed:** an area fire spell of ours
  left the mark in game with nothing said about it anywhere. Our own resolver
  does not go through this routine, so that mark is gone until the appliers are
  called properly.

- **the whole-field routine** (`0xD60C30`) dispatches on the **number**: `cmp
  eax,0Ah` — Armageddon and nothing else. So a whole-field spell of ours cannot
  burn whatever its element.

  **What that branch really is.** There are FOUR appliers, and three of them are
  an element each — each asks the caster for that element's Master perk:

  | applier | asks for |
  |---|---|
  | `0xBD1790` | 45, Master of Lightnings — air |
  | `0xBD1420` | 44, Master of Fire |
  | `0xBD12C0` | 43, Master of Ice — water |
  | `0xBD1980` | nothing — the NO-ELEMENT applier |

  The AREA routine dispatches on the element and reaches all four. **This one
  does not**: it has a single `cmp eax,0Ah`, and behind it `0xBD1420` and nothing
  else. Two questions in one comparison — "is it elemental" and "which element" —
  and the second was answered by there being one spell to answer it for. Of the
  three whole-field spells only Armageddon's damage is elemental: both Words name
  an element and leave `DamageIsElemental` false.

  So a whole-field spell of ours went through the no-element applier — **its
  damage was not fire at all**, and the missing Master of Fire mark was only the
  part that showed. Reading that comparison as "the elemental branch" and letting
  anything elemental in would have sent an ICE spell of ours down the FIRE path,
  which is the hole this closes rather than opens.

  (Armageddon additionally gets `0xBD1980` for units within `config[0x9B4]`
  doubled of a position the routine fetches — the «локальный физический урон в
  месте применения» of its description. It reaches a spell of ours with nothing:
  the amount is decided at `0xD60E29`, where `cmp ecx,0Ah` gives everything else
  a zero, and `0xBD1980` bails on a zero in its first two instructions.
  **Assumed and unchecked:** that the position is where the meteor lands.)

  **Fixed in ONE place, and it does not name a spell.** The comparison becomes
  `SpellElement(id) == fire` — the question `cmp eax,0Ah` was a shortcut for,
  asked of the document. The `call 0xBD1420` behind it is left as the game wrote
  it.

  **It used to be two, and the second was a bug.** The `call` was made indirect
  through a pointer set from the element — fire, water or air. Those three do not
  take the same number of arguments and the site pushes four, so water or air
  would have returned four or eight bytes short. It never fired, because the only
  elemental spell that reaches this routine is Armageddon and Armageddon is fire;
  it was found while giving our own spells a resolver. **An applier is not
  interchangeable with another applier** — that is the lesson, and it is the same
  one as arity-from-`ret`.

  **Behind `mass-spell-element-fix`, whole.** The flag decides whether any of it
  is written, not a branch inside it: off and not a byte moves. It is a fix of
  shipped behaviour — the empowered Armageddon — so it belongs beside the others
  in the panel rather than happening quietly. A mass spell of a mod no longer
  rides on it: ours does not come through this routine at all. See
  docs/FIX_TEST_MAP.md §5a.

Two other functions were read on the way and are worth naming so nobody reads
them again: `0xBD3A00`-ish builds the spellbook's PREDICTION — the "duration",
"enchant", "damage_bonus" and "heal" it writes are strings into a bag, not
effects — and `0xAD4640` is "is this spell of school 6", not a gate on anything
we care about.

## What is not done yet

1. **The three ELEMENT appliers, each with its own reading.** Ours calls the
   element-less one, so a spell of ours leaves no Master's mark. Each of the
   other three needs its arity and its `ecx`/`edx` roles read from a site that
   calls it — they disagree on both. Once they are in, our resolver picks by the
   document's element for **all three shapes**, which is more than the game does
   for its own (only the area routine dispatches on element).
2. **`H5EDamage(unit, amount)` for scripts that want to hit by themselves** —
   our first function WITH arguments, through the engine's parser `0xa454d0`
   (a shipped function builds a format string like `"sn"` and its own name on
   the heap and hands both over). Now that the walk is ours this is a smaller
   step than it was: the loop that picks whom to hurt is already C, and a Lua
   function would only be another way of asking it.
3. ~~The gate's answer should become "is there anything to hit".~~ **Done
   09.08.2026** — see "The gate, mapped" above. One shape is still answered with
   "cannot tell" and therefore a yes: an AREA spell asked about from outside a
   cast command, where the list of stacks it would cover is not the block's to
   read. Its page stays bright until the click; the cast itself answers
   properly. Closing it means finding what the book has instead of that vector,
   or asking `0xB7BE30` for the tiles and turning tiles into stacks ourselves —
   neither measured yet.
4. **Effects, and effects of our own.** A spell whose content is not damage but
   something it leaves behind — the fourth shape (`0xB7F99A`, the 18 shipped
   effects). Deliberately not started: the three damage shapes came first.
   Note the flags stop being enough here — Curse and Bless read `true`/`false`
   exactly like Magic Arrow — so the row will have to say which shape it is.

(All three damage shapes are done, and are ours; what a spell reaches is the pair
of flags in its record — see "The three damage shapes" above.)

## Where a person makes one

**Spells…** in the launcher bar, its own window
(`renderer/features/mods/spells.ts`, `renderer/parts/dialogs/spells.html`,
`electron/channels/mods-spells.ts`). Its shape follows the split this document
is about, because the split is what a person filling it in keeps running into:

- everything in **The spell**, **What it does** and **What it looks like** goes
  into the spell's own document, and works because the engine reads those fields
  for any number at all;
- **What it reaches** is ONE question that writes TWO booleans, since the engine
  picks its damage branch by that pair and nothing else;
- **Only the extension can** holds the two the document has no field for — the
  tiles and the spared kinds — and says so in its legend.

The tiles are a grid of checkboxes, one per tile, centred on the tile aimed at.
That is not a menu of the engine's shapes: the engine builds every list of its
own by pushing one tile at a time, so any set is legal, and the grid is square
because the combat grid is. Which way the grid faces on SCREEN has not been
measured — for a symmetric shape it does not arise, and an asymmetric one would
settle it in one battle.

An area spell with no tiles is refused by the window AND by `addSpell` behind
it: the window is not the only door (the e2e fixtures and `tools/write-effects.ts`
come in through the model), and the failure it prevents is silent — a cast that
plays, spends the mana and covers nothing.

**Removing one is never refused.** The question names what will notice — the maps
that store its name in a book, a guild or a shrine, and the heroes and classes of
the mod that name it — and then goes ahead: what the mod owns is edited (the id
leaves their lists), what it does not own is the map, which is the author's to
fix. Something you cannot delete because something else names it is a trap, not a
safeguard; the artifact and hero windows have always worked this way.

`e2e/mod-008-spells-create.spec.ts` authors one through the window and follows
both halves to disk: the manifest for the document's fields, and
`bin/homm5-editor-effects.txt` for the tiles and the kinds, by number on both
sides.

## The stand

`Rules Test` (docs/FIX_TEST_MAP.md, section 11) carries both: Death Ripple on
four heroes — knight with no Dark Magic, wizard Basic, scholar Advanced, warlock
Expert — and the Armageddon copy on the wizard as the control. `installSpellFixture`
puts them in the mod before the map is built, because an id types.xml does not
declare is a map the game refuses to load.

**Nothing in the probe is rationed.** Two runs were lost to log budgets going
quiet exactly where the answer was; see the note in `spell-cast.c`, which holds
for all four of the spell files.

## The adventure map's gate, and the four-slot ceiling explained

Everything above is a battle. The map has its own gate, `CanCastHere`
(**0xc614c0**, `__fastcall(ecx, edx)` plus two on the stack, `ret 8`), and it is
asked from two places that look like separate problems and are one:

- `CCastAdvSpellCmd`'s execute — `call 0xc614c0 ; test al,al ; je <end>` and only
  then `call 0xc619a0`, the cast itself;
- the interface, which greys a page out with the same answer.

So **a page that cannot be pressed and a click that does nothing are one
verdict**, not two, and one detour fixes both.

What it answers with is a switch on the number, and the shape is the finding:

```
mov  eax,[eax+4]     ; the spell
cmp  eax,0EAh        ; 234 — a case of its own
jg   <the small table>   ->  sub eax,15Ch ; cmp eax,3 ; ja <no>
sub  eax,31h         ; 49, the first adventure spell
cmp  eax,9Fh         ; ...through 208
ja   <no>
movzx eax,byte ptr [eax+0C618E4h]
jmp  dword ptr [eax*4+0C618CCh]
```

Two ranges: **49…208** for the shipped adventure spells, and **348…351** for
`SPELL_ABILITY_CUSTOM1…4`. That `cmp eax,3` IS the famous four-custom-abilities
ceiling — two instructions, and no amount of data moves it. Anything else,
including every id a mod appends, lands on `xor al,al`: refused, silently, with
no reason pushed.

Which is the same finding as the battle gate one branch over: **the engine
decides what a spell may do from what it was compiled against**, and a document
cannot answer for a number it has never seen.

`native/combat/spell-cast.c` (the gate half) therefore answers for our own ids and leaves every
shipped one alone — a silent refusal is overruled, a reasoned one never is.
Measured 07.08.2026: with that in place Gelu's page is live and takes a click.

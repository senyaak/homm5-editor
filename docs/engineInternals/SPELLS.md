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

## What the extension carries (`native/combat/spell-cast.c`)

Three marks and one answer, all built up from the runs above:

| where | what it does |
|---|---|
| the dispatch head `0x77eaf8` | logs every cast; for OUR ids fires the battle event and jumps into the branch below |
| the command `0x772790` | logs the command's block and what it returned |
| the gate `0x77b4c0` | logs the verdict, and ANSWERS YES for ours |
| the gate's refusal funnel `0x77b51e` | logs the reason the engine names |
| the damage function `0x7861a0` | for ours, spares the kinds the mod's row names |

**Only the silent refusal is overruled.** The funnel raises a flag; a refusal
that named a reason (`COMBAT_CANT_CAST_SPELL_IMMUNITY`, `COMBAT_NO_ENOUGH_MANA`,
`COMBAT_CANT_CAST_BLOCKED_SPELL`) is the engine applying a rule that has nothing
to do with our number, and answering over it made the ripple the one spell in
the game that ignores a black dragon — found in a battle, fixed the same day.

With that in, the cast goes through: `cast: OURS, spell id 353` from the
resolver, and the engine carries the mana, the hero's turn and the animation.

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
is ours and lands in `bin/homm5-editor.log`, which is how "the script never
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

## The effect: the branch we borrow

The battle's own vocabulary reads a stack and cannot hurt one, so the damage has
to come from the engine — and it must, because **resistance, anti-magic, school
protection and the combat log are all inside the engine's own routine**. Damage
applied by hand would bypass every one of them and the result would look exactly
like our bugs.

`0xD60C30` is that routine — the one every mass spell that hits the whole field
goes through. Reading it settled what it is and what it is not:

- It **takes the spell from the cast's own block** (`[ctx+4]`), never as an
  argument. So a call made for our id stays ours all the way down: our damage
  numbers, our name in the log.
- It walks **every stack on the field**, alive or not, and asks two questions
  per stack — one shared with Armageddon, one about distance.
- Its inner `jmp [ecx*4+0xD61290]` is **not** a filter. The index array covers
  ids 10…239 and holds two values, and the four that differ (Armageddon, Unholy
  Word, Holy Word and the boss firewall) only pick a different **propagation
  speed** out of the config (`cfg+0x9D4`) instead of the constant 10.0. Ours
  falls outside the range and takes the constant, which is a hair of timing.

The filter is one function further in. `0xB861A0` — "how much does this spell do
to that stack" — opens with it:

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

## And the second dispatch, which the first run found

With the branch borrowed the cast walked every stack on the field and the filter
spared the undead — and every living stack took **zero**. The reason is one
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
else gets a hard zero. So **a new spell needs the branch AND the number**, and
they are two different switches in two different functions.

`0xAD4EC0` itself is generic: handed the id and the power it reads `<damage>` out
of the loaded document, four entries by mastery. From there the numbers are the
editor's.

## The three damage shapes, and what chooses between them

The resolver has ONE branch per shape, not per spell. Following both of its
switches, the whole table is 17 branches for 353 spells, and for damage there
are exactly three:

| branch | the game's own | what it does |
|---|---|---|
| `0xB7ED4A` | Armageddon, Holy Word, Unholy Word | every stack on the field |
| `0xB7ED16` | Fireball, Frost Ring, Stone Spikes | an area around a point |
| `0xB7F6DC` | Magic Arrow, Lightning Bolt, Ice Bolt, Implosion, Magic Fist | one stack |

**What separates them is already in the document.** `IsAimed` and
`IsAreaAttack` — the two flags the gate reads and the extension already had to
hand — split the shipped spells with nothing left over:

| `IsAimed` | `IsAreaAttack` | shape |
|---|---|---|
| false | false | the whole field |
| true | true | an area |
| true | false | one stack |

So a spell of ours is pointed at the branch its own record implies. Nothing new
is said anywhere: no field in the document, no row in the config, and in the
editor it is two checkboxes that already exist.

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
| the dispatch stub `0x77eaf8` | for our ids, **jump into the branch the record asks for** instead of returning to the comparison |
| the worth stub `0x77ce8a` | for our ids, **jump to the branch that reads the record** (`0xB7CED1`) instead of falling to the zero |
| the shape stub `0x77be7f` | for our ids, **push the tiles the row names** and join the engine at its tail |
| the damaging stub `0x7d0e88` | for our ids, answer **yes** to "does this spell deal damage" |
| the damage function `0x7861a0` | for our ids, answer **zero** for the kinds the mod says it spares, then let the engine do the rest |
| `bin/homm5-editor-effects.txt` | `spell 353 spares 10 12 9` — the kinds, by ability NUMBER<br>`spell 355 area 0,0 -1,0 …` — the tiles, as offsets |

Both stubs are the same shape, and every branch is safe to jump into: nothing
between the comparison and the branch pushes, so the frame each reads is the
frame it expects. The first stub's jump is INDIRECT, through a variable the C
sets per cast, because which branch a cast wants is a question about its record.

**The stubs are hand-assembled and now checked as such.** `tools/test-fixes.ts`
decodes every `*_STUB` byte row: it must be whole instructions ending exactly at
the length it declares, and every branch inside it must land on an instruction
boundary. Both halves have already caught a real miscount — the offsets in the
installer are counted by hand, and they move whenever an instruction is added.

Jumping into the branch is safe because the dispatch reaches it by a `jmp`, not
a `call`, and everything the branch reads (`ebp`, `edi`, `[esp+68h]`,
`[esp+18h]`) is set by the prologue from the cast's own block — none of it is
Unholy Word's. The branch also clears `[esp+13h]`, so ours stops paying its
caster back.

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
that exempt it, then hands a number to `SPELL_EFFECT_FIRE_DAMAGE` (202). Five
places call it, and two of them are routines a spell of ours borrows — which
behave differently:

- **the area routine** (`0xD608C0`) dispatches on the **element**: air →
  `0xBD1790`, fire → `0xBD1420`, water → `0xBD12C0`. Data, so an area spell of
  ours with `ELEMENT_FIRE` reaches the burn by itself.
  **Measured: it does.** An area fire spell of ours leaves the mark in game, with
  nothing said about it anywhere.

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

  **Fixed in two places, and neither names a spell.** The comparison becomes
  `SpellElement(id) != 0`; the `call 0xBD1420` becomes an indirect one through a
  pointer set from that same element — fire, water, air, the very table the area
  routine dispatches on. Earth and none answer no at the comparison and take the
  plain applier, as they do today.

  **Behind `mass-spell-element-fix`, whole.** The flag decides whether any of it
  is written, not a branch inside it: off and not a byte moves, for the game's
  spells or ours. It is a fix of shipped behaviour — the empowered Armageddon —
  so it belongs beside the others in the panel rather than happening quietly, and
  a mass spell of a mod rides on it. See docs/FIX_TEST_MAP.md §5a.

Two other functions were read on the way and are worth naming so nobody reads
them again: `0xBD3A00`-ish builds the spellbook's PREDICTION — the "duration",
"enchant", "damage_bonus" and "heal" it writes are strings into a bag, not
effects — and `0xAD4640` is "is this spell of school 6", not a gate on anything
we care about.

## What is not done yet

1. **`H5EDamage(unit, amount)` for scripts that want to hit by themselves** —
   our first function WITH arguments, through the engine's parser `0xa454d0`
   (a shipped function builds a format string like `"sn"` and its own name on
   the heap and hands both over). Worth it only for effects the borrowed branch
   cannot express, because the parser is the fiddly part and the crash lands in
   a battle.
2. **The gate's answer should become "is there anything to hit"** rather than a
   flat yes, so the book greys our spell by itself the way it greys
   Resurrection.
3. **Effects, and effects of our own.** A spell whose content is not damage but
   something it leaves behind — the fourth shape (`0xB7F99A`, the 18 shipped
   effects). Deliberately not started: the three damage shapes came first
   because they are one branch each.

(The third damage shape is done; what a spell reaches is the pair of flags in
its record — see "The three damage shapes" above.)

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
quiet exactly where the answer was; see the note in `spell-cast.c`.

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

`native/combat/spell-cast.c` therefore answers for our own ids and leaves every
shipped one alone — a silent refusal is overruled, a reasoned one never is.
Measured 07.08.2026: with that in place Gelu's page is live and takes a click.

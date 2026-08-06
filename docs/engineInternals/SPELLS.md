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
| the dispatch head `0x77eaf8` | logs every cast; for OUR ids fires the battle event |
| the command `0x772790` | logs the command's block and what it returned |
| the gate `0x77b4c0` | logs the verdict, and ANSWERS YES for ours |
| the gate's refusal funnel `0x77b51e` | logs the reason the engine names |

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

## What is not done yet, and the plan

**The effect.** The battle's own vocabulary reads a stack and cannot hurt one,
so the damage has to come from the engine — and it must, because **resistance,
anti-magic, school protection and the combat log are all inside the engine's own
routine**. Damage applied by hand would bypass every one of them.

The way in is Unholy Word's branch. Its `0xD60C30` is the "word" routine and the
filter is NOT an argument: inside it there is a dispatch of its own
(`jmp [ecx*4+0xD61290]`), it asks for the spell id (`0xAD44C0`) and compares
against ability numbers (`cmp ecx,0Ah` — `ABILITY_UNDEAD`). So:

1. **Give our ids a branch of their own** that does what Unholy Word's does:
   call the routine, clear `[esp+13h]`, jump to `0xB7FAF0`. First version may
   pass Unholy Word's own id to get real damage with the engine's rules, and its
   filter (which also spares demons and orcs) — a run where the spell finally
   *does* something.
2. **Then our own filter**: find where `0xD60C30` decides a kind, and either
   parameterise the call or carry our copy of that decision, so the ripple
   spares only the undead (and elementals and machines, which are not living).
3. **`H5EDamage(unit, amount)` for scripts that want to hit by themselves** —
   our first function WITH arguments, through the engine's parser `0xa454d0`
   (a shipped function builds a format string like `"sn"` and its own name on
   the heap and hands both over). Only worth it once the engine-side damage
   works, because the parser is the fiddly part and the crash lands in a battle.
4. **The gate's answer should become "is there anything to hit"** rather than a
   flat yes, so the book greys our spell by itself the way it greys
   Resurrection.

## The stand

`Rules Test` (docs/FIX_TEST_MAP.md, section 11) carries both: Death Ripple on
four heroes — knight with no Dark Magic, wizard Basic, scholar Advanced, warlock
Expert — and the Armageddon copy on the wizard as the control. `installSpellFixture`
puts them in the mod before the map is built, because an id types.xml does not
declare is a map the game refuses to load.

**Nothing in the probe is rationed.** Two runs were lost to log budgets going
quiet exactly where the answer was; see the note in `spell-cast.c`.

# Hero classes and skills

*Answers: what a class decides and what it does not, how a skill is bound to
one, what gates a perk, what a table of either costs the game, and which half of
all this the executable will not do for us.*

The tenth class loads and a hero can be of it: measured in game on 2026-08-02,
with Gem standing on a map as a Колдунья holding a racial of ours. What is
written down here is what that took and what it cost.

## A class, in the data

One record in `GameMechanics/RefTables/HeroClass.xdb`, and four fields is the
whole of it:

| field | what it decides |
|---|---|
| `NameFileRef` | what the hero screen calls him |
| `SkillsProbs` | how often each skill is offered at a level up |
| `AttributeProbs` | how often each of the four attributes grows |
| `PreferredSpellsFromSpellShop` | what the class would rather buy |

**Morale is not among them**, and neither is anything else people expect a class
to hold. The penalty for a mixed army is computed by the executable from the
stacks' own `TownType`; the class does not enter it. There is no field for
movement, none for growth, none for the town.

### The regularity is the specification

All nine shipped classes carry **exactly thirteen** skill weights summing to
**exactly 100**, and four attribute weights summing to **exactly 100**:

```
KNIGHT       13 weights, sum 100 | 30/45/10/15
RANGER       13 weights, sum 100 | 15/45/10/30
WIZARD       13 weights, sum 100 | 10/15/30/45
DEMON_LORD   13 weights, sum 100 | 45/10/15/30
NECROMANCER  13 weights, sum 100 | 10/30/45/15
WARLOCK      13 weights, sum 100 | 30/10/45/15
RUNEMAGE     13 weights, sum 100 | 20/30/30/20
BARBARIAN    13 weights, sum 100 | 45/35/5/15
```

Thirteen is not a coincidence either: it is the **twelve common skills every
class lists** — logistics, luck, learning, leadership, defence, offence,
sorcery, light, dark, destructive, summoning, war machines — plus that class's
own racial. No class is denied a common skill. A class does not choose WHICH
skills exist for it; it chooses how often each is offered, and a weight of zero
is how "never" is spelled.

Both sums are distributions the engine walks, so both are checked before a class
is written: under a hundred leaves a range that answers nothing, over it leaves
the tail of the list unreachable. `classProblems()` refuses either.

## The racial skill is bound from the skill's side

There is no table of racials and no field on a class saying which is his. Of the
27 `SKILLTYPE_SKILL` entries in `Skills.xdb`, exactly eight carry a class in
`<HeroClass>`:

| skill | class |
|---|---|
| `HERO_SKILL_TRAINING` | Knight |
| `HERO_SKILL_GATING` | Demon Lord |
| `HERO_SKILL_NECROMANCY` | Necromancer |
| `HERO_SKILL_AVENGER` | Ranger |
| `HERO_SKILL_ARTIFICIER` | Wizard |
| `HERO_SKILL_INVOCATION` | Warlock |
| `HERO_SKILL_RUNELORE` | Runemage |
| `HERO_SKILL_DEMONIC_RAGE` | Barbarian |

The other nineteen are `HERO_CLASS_NONE`. **The skill names the class, and that
is the entire binding** — so a racial of ours is a skill of ours carrying our
class.

A racial is drawn and named **four times**, one per mastery, and the fourth is
`MASTERY_EXTRA_EXPERT` — the level an artifact grants. A common skill has three,
which is why its fourth texture entry repeats the third. The `Texture` list of a
racial has five entries: an empty one for `MASTERY_NONE`, then the four.

## What gates a perk

Not the class record. The gate is on the **perk**, as a list of classes with the
dependencies each of them needs:

```xml
<ID>HERO_SKILL_LAST_AID</ID>            <!-- «Чумная палатка» -->
<BasicSkillID>HERO_SKILL_WAR_MACHINES</BasicSkillID>
<SkillPrerequisites>
  <Item><Class>HERO_CLASS_DEMON_LORD</Class>
        <dependenciesIDs><Item>HERO_SKILL_FIRST_AID</Item></dependenciesIDs></Item>
  <Item><Class>HERO_CLASS_NECROMANCER</Class> …
  <Item><Class>HERO_CLASS_WARLOCK</Class> …
  <Item><Class>HERO_CLASS_BARBARIAN</Class> …
</SkillPrerequisites>
```

Four classes, and the Ranger is not one of them — which is exactly why a Ranger
never gets a plague tent, at any weight. Three things about that list:

- **An empty list is an OPEN door, not a closed one.** 75 of the 194 perks carry
  none, and those are free to any class that has the branch. It is a list *with
  names in it* that shuts everybody else out.
- **The dependencies are per class.** 37 of the 115 perks that carry
  prerequisites ask different classes for different things — the demon lord
  needs demonic fire for the triple ballista and everybody else only needs the
  ballista.
- **A class of ours reaches a shipped perk by being added to that list**, which
  is one `<Item>` and no executable at all.

### `<HeroClass>` on a perk is a different thing

On a perk of a **common** branch it is decoration: `HERO_SKILL_TRIPLE_BALLISTA`
carries `HERO_CLASS_KNIGHT` and all eight classes are in its prerequisites — it
marks whose art the icon was drawn for. On a `SKILLTYPE_CLASS_PERK` of a
**racial** branch it is the ownership that matters, because the branch itself
belongs to one class: Multishot names the Ranger, carries no prerequisites at
all, and no other class can reach it since no other class has Avenger to hang it
from. A perk of ours is that second kind.

## What a table of either costs

Both are reference tables with a declared size, and the size is written **four
times, and for the skill table five**. Miss one and the game either ignores what
the mod added or refuses to start:

1. `types.xml` — the enum's entry list (`<Item>HERO_CLASS_WITCH</Item>`);
2. `types.xml` — the name→number map the executable compares against;
3. `types.xml` — the table type's `ref_table_num_objs` **and** the `objects`
   field's `MinElements`/`MaxElements`;
4. the executable — the count pushed where the table is registered;
5. the executable — an out-of-line `mov eax,N; ret` the code calls, **when the
   table has a live one**. The skill table does and the class table does not.

The shipped counts are **9 classes** and **221 skills**.

### Finding the count in the executable

The registration routine has ONE shape for every table:

```
mov edx, <the table's path string>     ; "/GameMechanics/RefTables/X.xdb"
…copy the path onto the heap…
push <count>                           ; imm8 or imm32
push …, push …, push <type name>
call <register>
```

So a table is identified by its own path — unique in the image — and the count
is the first `push` after the reference to it. Checked on all four tables the
editor extends (creatures, artifacts, hero classes, skills). `src/exe/table-limit.ts`
patches by that pattern, never by address.

### The second number, which cost an evening

Twelve one-line `mov eax,N; ret` functions sit together at `0xa9ef30`…`0xa9f330`,
one per table, and the creature and artifact patchers both write theirs.
**Nothing references any of the twelve** — not a call, not a jump, not a pointer,
searched for all of them. From that the conclusion "these one-liners are dead"
was drawn, and it was drawn too wide.

The skill table has **another one**, far from that block, at `0xb1ef80`, and
fifteen call sites reach it:

```
0x5d1b1b  test ebx,ebx        ; the skill id
0x5d1b1d  js   <refuse>
0x5d1b23  call 0xb1ef80       ; mov eax,0DDh ; ret   — 221
0x5d1b28  cmp  ebx,eax
0x5d1b2a  jge  <refuse>       ; id past the count: no such skill
```

That one is inside `GiveHeroSkill`; the rest are `for (i = 0; i < that; i++)`
walks of the skill manager, which is how the game enumerates what a hero could be
offered. A table registered as 225 long whose accessor still says 221 **loads
fine, shows the racial fine, and silently offers no perk past the shipped ones**.

So `src/exe/table-limit.ts` now finds it rather than assuming, and only when it
identifies itself: a one-liner returning this table's count **that something
calls**. `mov eax,9; ret` fits the hero class table and the player colour table
equally — but nothing calls either, so there is nothing to choose between and
nothing to write. Two live ones returning the same number would be refused rather
than guessed at.

## What the editor does with all this

| file | what it owns |
|---|---|
| `src/mods/hero-classes.ts` | the record, the enum, the table, the perk gate, reading the shipped nine |
| `src/mods/hero-skills.ts` | a racial or a perk of ours: the record, its texts, its icons |
| `src/exe/table-limit.ts` | the count in the executable, for any table |
| `renderer/features/mods/hero-classes.ts` | the class form — priorities and availability |
| `renderer/features/mods/hero-skills.ts` | the skill form |
| `renderer/features/mods/hero-tabs.ts` | the Heroes window's tabs; each side registers its own |

The class form is the two questions a class answers. **Priorities** is a weight
per skill and one per attribute, both totalled as they are typed. **Availability**
is the two sides of the perk gate with a button between them, and a perk with no
class list at all is in neither — moving it would write an entry that CLOSED it
to everyone else. The donor button fills all of it from a shipped class.

Ownership, in the model: **a class owns its skills**. The skill names the class
and the class weights the skill, so refusing both ways is a knot nobody can
untie; removing a class removes what hangs off it, and removing a skill a class
still weights says which class to remove instead. A hero stays refused either
way — he is not part of the class.

The whole chain is authored through the window by
`e2e/mod-004-classes-create.spec.ts`, and `e2e/mod-004-heroes-create.spec.ts`
builds Gem out of what it made. The order there is the real constraint: class,
then skill, then back to the class to weight it, because neither can name the
other before it exists.

## What the executable will not do for us

Every shipped skill's arithmetic is compiled against its own enum value, exactly
as a specialization's is
([engineInternals/SPECIALIZATIONS.md](engineInternals/SPECIALIZATIONS.md)). A
value it was not compiled against has a name, an icon and a place in the tree,
and does nothing whatever. So a skill of ours is two halves — the record here,
and a term the native extension adds — and until the second half exists the
words are a promise.

**Two sums it can already reach**, because the extension had already found where
to append to them: the necromancy percentage and the dark energy ceiling. The
skill form carries them, the hero is asked for his mastery through the same slot
the engine's own `HasHeroSkill` uses, and the amount is per level of that
mastery. A skill is the third subject of one mechanism — see
[engineInternals/EXTENSION.md](engineInternals/EXTENSION.md), "Three subjects,
one shape". Everything else a skill of ours might do still costs a detour of its
own, which is what the next section is about.

## Why the perks were not offered, and what it was not

The three perks of the Witch's branch were written the way the shipped Multishot
is — `SKILLTYPE_CLASS_PERK`, `BasicSkillID` naming the branch, an empty
`SkillPrerequisites` — and were never offered at a level up. The racial above
them worked perfectly: taken, named, advanced through all four levels.

**The cause was the accessor above**: the game's walk over "every skill there is"
stopped at 221, so ids 222–224 did not exist to it. The racial survived that
because a racial is handed to a hero by his class, not looked up by id. One
number, patched, and the branch is reachable.

Which makes the shape of a perk of ours the shipped shape after all:

```xml
<SkillType>SKILLTYPE_CLASS_PERK</SkillType>
<HeroClass>HERO_CLASS_WITCH</HeroClass>      <!-- whose branch this is -->
<BasicSkillID>HERO_SKILL_TENT_MASTER</BasicSkillID>
<SkillPrerequisites/>                        <!-- holding the branch is enough -->
```

### The detour, kept because the reasoning was sound and wrong

In between, the plague tent — a shipped perk with a class list — **was** offered
to her after `<Class>HERO_CLASS_WITCH</Class>` was added to it, while ours were
not. That looked like an A/B with one variable, and it produced a rule: "an empty
list means ask the compiled route, so a perk of ours must name its class". Both
observations were real; the inference was not. The plague tent's id is 194, below
the ceiling, and that — not its list — is why it was reachable. **Two records
differing in one element can still differ in a third thing neither of them
mentions.**

The gate rule that survives, and it is the useful one:

- **An empty `SkillPrerequisites` is an open door**, narrowed only by
  `BasicSkillID` (you hold the branch) and, on a class perk, `<HeroClass>`. That
  field is plain data, so our tenth class works there like any other.
- **A list is for perks that come later.** Across the shipped table every id
  named in a `dependenciesIDs` is itself a perk — 119 of them, not one base
  skill. Writing the branch's own skill into the list asks the game a question it
  is never asked anywhere else, so `skillProblems` refuses it.

Still worth keeping from the detour: **a perk is registered nowhere else.** Over
the whole data root a perk is named in `Skills.xdb`, in `types.xml`, and in four
maps that hand it to a preset hero. No UI file, no wheel, no list per class.

The general shape specializations taught still holds — **data reaches a value the
executable never heard of; compiled comparisons do not** — and this adds the
other half: *a compiled COUNT is a comparison too*, and it will not announce
itself. When something of ours is inert, ask what the exe would have to count
before asking what the record says.

## The effects, and where each of them will have to go

None of the four skills does anything yet. This is what the next pass starts
from, so it is written down rather than remembered.

**The racial: one more use of the first aid tent per level of the skill.** The
quantity already exists in data — `GameMechanics/RefTables/WarMachines.xdb`,
`WAR_MACHINE_FIRST_AID_TENT`, `<Shots>3</Shots>`. So "uses" is not a number we
invent; it is a field, and the shipped tent has three. Editing it in the mod
would change it for every hero in the game, so the per-hero term belongs where
the machine is set up for a battle, in the extension.

*Found since, and this is the site rather than the neighbourhood.* Addresses are
in-memory, RVA + 0x400000, as everything in this file:

```
CCombatWarMachine ctor            0xdc9730   the only caller is 0xd53f48
  [this+0xA8] = the world CWarMachine        its type is at +0x1C, tent = 3
  switch (type)                              jump table at 0xdc9a90, index type-1
  [this+0xB0] = CWarMachine::GetShots()      0xabbc20 — ONE caller, this one
CWarMachine::GetShots              0xabbc20   record(type)->[0x44], i.e. <Shots>
  record by type                   0xb27650
```

and `+0xB0` is the counter the tent actually spends, read and written nowhere
else worth naming:

```
0xdc9dc8  cmp dword ptr [esi-1Ch],0     may it act at all
0xdc9f06  cmp dword ptr [esi-1Ch],0     may it cast THIS spell (0xBD or 0x160)
0xdc9f59  add dword ptr [esi-1Ch],-1    it just did
```

(`-0x1C` because those three are interface methods and `this` arrives adjusted;
the same field, reached from the other side.) Three gates read the field
directly rather than through the accessor, so **the only worthwhile hook is the
one that fills it**, and the constructor is where the object exists.

*Done, and confirmed in game*: basic mastery gives the tent four uses, advanced
five. `tent_charges` is a stat a skill — or an artifact — can carry.

**Two hooks, because the moment that has the number and the moment that has the
hero are not the same one.** The constructor (`0xdc9730`) only writes the tent's
pointer into a small ring; the raise happens in the tent's amount hook, where the
engine hands over a live unit. Asking a machine for its owner inside its own
constructor ends the battle — the object is a moment old and has no owner yet,
and no guard helps, because the slot holds a real function and the fault is
inside it. Being on the ring is what makes the raise happen once, and the total
is the same either way: the gate has already let the tent act, so three charges
plus ours is the same number of uses whether the bonus lands before the first
spend or just after it.

Four crashed battles paid for this section. Every one was the same mistake in a
different coat — **the call was made almost the way the engine makes it**:

- **Arity from the `ret`, never from the call site.** The constructor ends
  `ret 18h`: six stack arguments. Counting pushes at its one call site gives
  five, because the sixth is a `push 1` put down five instructions early with a
  virtual call in between that takes its `this` in ecx and nothing off the stack.
  A hook one argument short cleans four bytes less than the caller left, and the
  stack is wrong from the first war machine built.
- **`engine > 0` was a guard, not an early-out.** The amount function has two
  call sites and only one hands over a unit whose owner can be asked for.
- **Skills answer one virtual call further along.** At `0xdc9705` the engine
  takes the hero exactly as `unit_hero` does — `[+0x18]` for the owner, `[+0x0C]`
  for the hero — and then makes one more call, **slot 0**, before asking
  `[+0x174]` for a mastery. That pointer is right for everything else the tent
  asks of a hero, and wrong for this. Named by the cleanest evidence of the whole
  session: attacking with Gem crashed and attacking with anyone else did not, so
  the fault was in the one path only a hero with a tent reaches.

And the one thing that was measured rather than reasoned: **the unit sits at
`machine + 0xCC`**. The probe printed the constructor's machine and the `unit`
the amount hook receives, same battle, and the two numbers were 204 apart — the
`0xCC` the disassembly writes as `lea ecx,[esi-0CCh]`.

Two nearby places were already written up in
[engineInternals/SPECIALIZATIONS.md](engineInternals/SPECIALIZATIONS.md):
`0x77fca0` computes what the tent is worth (`{10,20,50,100}[war machines
mastery]`, plus five per hero level for `HERO_SPEC_EMPIRIC`), and
`CCombatWarMachine::GetSpellPower` at `0x9c96d0` answers for machine type 3.
That one is worth reading for another reason: it fetches the owner's mastery
with `push 2; call [hero_vtable+0x174]`, and 2 is `HERO_SKILL_WAR_MACHINES` —
the engine asking the very question our skill rows now ask.

**Two of the perks happen inside a battle**, at the moment the tent acts: the
cleanse and the random blessing. Lua cannot see that moment. The combat script
API is a controller for scripted battles — attached to a hero by
`SetHeroCombatScript`, per hero and per map — and it has no event for "the tent
healed somebody". Both are extension work.

**The third is adventure-map shaped**, and Lua can have it: a tent destroyed in
a battle is rebuilt afterwards. `COMBAT_RESULTS_TRIGGER` fires after a combat
with the combat index; `GetSavedCombatArmyHero` names the heroes,
`HasHeroSkill` asks whether one holds the perk, and
`HasHeroWarMachine` / `GiveHeroWarMachine` do the rest. It belongs in the mod's
own `scripts/advmap-common.lua`, which runs on **every** adventure map, the
game's own included, and where triggers stack rather than replace — both
measured, in [NAMES_AND_SCRIPTING.md](NAMES_AND_SCRIPTING.md).

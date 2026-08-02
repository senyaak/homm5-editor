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

Both are reference tables with a declared size, and the size is written **four**
times. Miss one and the game either ignores what the mod added or refuses to
start:

1. `types.xml` — the enum's entry list (`<Item>HERO_CLASS_WITCH</Item>`);
2. `types.xml` — the name→number map the executable compares against;
3. `types.xml` — the table type's `ref_table_num_objs` **and** the `objects`
   field's `MinElements`/`MaxElements`;
4. the executable — the count pushed where the table is registered.

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

**The one-line accessors are not patched, and should not be.** Twelve
`mov eax,N; ret` functions sit together at `0xa9ef30`…`0xa9f330`, one per table,
and the creature and artifact patchers both write theirs. Two things say they do
not matter: **nothing references them** — not a call, not a jump, not a pointer
anywhere in the image, searched for all twelve — and **the value cannot identify
the table**: `mov eax,9; ret` fits the hero class table and the player colour
table equally, and both declare 9.

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

## A perk of ours has to name its class

The three perks of the Witch's branch were written the way the shipped Multishot
is — `SKILLTYPE_CLASS_PERK`, `BasicSkillID` naming the branch, and an EMPTY
`SkillPrerequisites`, since the branch is one class's and nobody else can reach
it. They were never offered at a level up. In the same launch, on the same hero,
the **plague tent was offered** — and the only thing that had been done to it was
adding `<Class>HERO_CLASS_WITCH</Class>` to its own prerequisite list.

That is the whole experiment, and it says what an empty list means:

> An empty `SkillPrerequisites` does not mean "open to everybody". It means
> **ask the compiled route** — and for a class perk that route is the
> `<HeroClass>` field, matched against the classes the executable was built
> with. A class it has never heard of loses every such comparison.

So the door left open to a class of ours is the one written in data, and a perk
of the mod always names its class in its own gate, with the branch as the
dependency:

```xml
<SkillPrerequisites>
  <Item><Class>HERO_CLASS_WITCH</Class>
        <dependenciesIDs><Item>HERO_SKILL_TENT_MASTER</Item></dependenciesIDs></Item>
</SkillPrerequisites>
```

Two things were ruled out on the way, and both are worth keeping:

- **It is not the id being past the shipped count.** The racial is 221, one past
  the shipped 221 skills, and it is offered, taken and advanced through its
  levels. Ids above the old ceiling are ordinary once the ceiling moves.
- **It is not a missing registration.** Over the whole data root a perk is named
  in `Skills.xdb`, in `types.xml` (the enum, as every id is), and in four maps
  that hand it to a preset hero. Nothing registers a perk anywhere else — no UI
  file, no wheel, no list per class.

The general shape of this is the same one specializations taught: **data reaches
a value the executable never heard of; compiled comparisons do not.** Anything
in the game that works by "the engine knows which class this belongs to" has to
be re-said in data for a class of ours, and anything that works by arithmetic
compiled against an id has to be re-said in the extension.

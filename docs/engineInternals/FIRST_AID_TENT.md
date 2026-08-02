# The first aid tent

*Answers: what the tent is worth, how many times it may be used, where each of
those two numbers is decided, and how a term of ours joins them.*

Its own file because it is its own mechanism. The material was written down
twice, in the two documents that happened to be open when it was found — the
specialization that raises its healing lived in
[SPECIALIZATIONS.md](SPECIALIZATIONS.md), the charges in
[../HERO_CLASSES.md](../HERO_CLASSES.md) — and neither is about a war machine.

Addresses are in-memory (RVA + 0x400000), as everywhere in these notes, and are
landmarks rather than constants: another build is another compilation.

## Two numbers, two places

| number | decided at | what changes it |
|---|---|---|
| how much it heals | `0x77fca0` | War Machines mastery, `HERO_SPEC_EMPIRIC`, and our specialization term |
| how many uses | the machine's constructor `0xdc9730`, from `<Shots>` | our `tent_charges` term |

Both of the tent's spells draw on the first. `CCombatWarMachine::GetSpellPower`
at `0x9c96d0` answers for machine type 3 with the owner's War Machines mastery
for the heal (`0xBD`) and the plague (`0x160`) alike — so one term of ours
reaches both, and the perk whose identifier reads `LAST_AID` and whose name in
game is «Чумная палатка» needs nothing of its own.

## What it is worth

`0x77fca0` is the only place that decides:

```
amount = { 10, 20, 50, 100 }[war machines mastery]
       + 5 × hero level, if his specialization is HERO_SPEC_EMPIRIC (36)
```

A four-case jump table writing the constants, then `push 24h;
call [vtable+294h]` — "does this hero hold 36" — and inside that branch
`lea eax,[eax+eax*4]`, the ×5. Signature from the call site at `0xb82d16`: two
out-parameters in ecx and edx, then the unit and the mastery on the stack.

Three things about it cost a run each:

- **The mastery is an INDEX, not a multiplier.** Returning ten times it moved
  the tooltip and BROKE the tent: out of the table's range the engine falls into
  a constant. From the numbers alone that reads as "this value changes nothing".
- **The tooltip and the effect are computed by different code.** The prediction
  followed our doubled number while the applied amount did not. Read the battle
  log, never the hovering number.
- **Healing is capped by what is missing.** A stack of 15-HP creatures can never
  show more than 14 healed, whatever the amount is. The amount is a BUDGET: it
  tops the wounded creature up, then raises dead ones at `maxHP` each, and the
  remainder is lost.

Our own term here is a **specialization's**, and its shape is that file's
subject: a percentage of the engine's own number per hero level, added after it,
`engine × percent × level / 100`, truncated. Five percent is Heroes III's Gem.
Measured in game at basic mastery, level 1: engine 20, we add 1, amount 21.

## How many times it may be used

The quantity is data — `GameMechanics/RefTables/WarMachines.xdb`,
`WAR_MACHINE_FIRST_AID_TENT`, `<Shots>3</Shots>`, the record's first field. So
"uses" is not a number we invent. Editing it in the mod would change it for
every hero in the game, which is why the per-hero term belongs in the extension.

```
CCombatWarMachine ctor            0xdc9730   the only caller is 0xd53f48
  [this+0xA8] = the world CWarMachine        its type is at +0x1C, tent = 3
  switch (type)                              jump table at 0xdc9a90, index type-1
  [this+0xB0] = CWarMachine::GetShots()      0xabbc20 — ONE caller, this one
CWarMachine::GetShots              0xabbc20   record(type)->[0x44], i.e. <Shots>
  record by type                   0xb27650
```

`+0xB0` is the counter the tent actually spends, read and written nowhere else
worth naming:

```
0xdc9dc8  cmp dword ptr [esi-1Ch],0     may it act at all
0xdc9f06  cmp dword ptr [esi-1Ch],0     may it cast THIS spell (0xBD or 0x160)
0xdc9f59  add dword ptr [esi-1Ch],-1    it just did
```

(`-0x1C` because those three are interface methods and `this` arrives adjusted;
the same field, reached from the other side.) All three read the field directly
rather than through the accessor, so the only worthwhile hook is the one that
FILLS it.

**Done, and confirmed in game**: basic mastery gives the tent four uses, advanced
five. `tent_charges` is a stat a skill — or an artifact — can carry; see
[EXTENSION.md](EXTENSION.md) for the config row.

### Two hooks, because one moment has the number and another has the hero

The constructor only writes the tent's pointer into a small ring; the raise
happens in the amount hook, where the engine hands over a live unit. Asking a
machine for its owner inside its own constructor ends the battle — the object is
a moment old and has no owner yet, and no guard helps, because the slot holds a
real function and the fault is inside it. Being on the ring is what makes the
raise happen once, and the total is the same either way: the gate has already let
the tent act, so three charges plus ours is the same number of uses whether the
bonus lands before the first spend or just after it.

## Reaching the hero from a war machine

```
unit = machine + 0xCC              measured, see below
  [vt+0x18]  -> the owner
  [vt+0x0C]  -> the hero           <- what unit_hero returns
  [vt+0x00]  -> what his SKILLS answer on
  [vt+0x174] -> GetSkillMastery(skillId)
```

His level and his specialization answer on a **virtual base** instead:
`this = hero + 4 + *(int *)(*(void **)(hero + 4) + 8)`, spelled out by the engine
at `0xb7fd00`. Two different adjustments off one hero pointer, which is the whole
difficulty of this page.

**`unit = machine + 0xCC` was measured, not reasoned.** A probe printed the
constructor's machine and the `unit` the amount hook receives, same battle, and
the two numbers were 204 apart — the `0xCC` the disassembly writes as
`lea ecx,[esi-0CCh]`.

### Four crashed battles, one mistake in four coats

Every one was **the call made almost the way the engine makes it**:

- **Arity from the `ret`, never from the call site.** The constructor ends
  `ret 18h`: six stack arguments. Counting pushes at its one call site gives
  five, because the sixth is a `push 1` put down five instructions early with a
  virtual call in between that takes its `this` in ecx and nothing off the stack.
  A hook one argument short cleans four bytes less than the caller left, and the
  stack is wrong from the first war machine built.
- **`engine > 0` was a guard, not an early-out.** The amount function has two
  call sites and only one hands over a unit whose owner can be asked for.
- **Skills answer one virtual call further along.** At `0xdc9705` the engine
  takes the hero exactly as `unit_hero` does and then makes one more call, slot
  0, before asking `[+0x174]` for a mastery. That pointer is right for everything
  else the tent asks of a hero and wrong for this.
- **Nothing may be asked of an object inside its own constructor.**

The third was named by the cleanest evidence of the session: attacking with Gem
crashed and attacking with anyone else did not, so the fault was in the one path
only a hero with a tent reaches. `push 2; call [hero_vtable+0x174]` inside
`GetSpellPower` is the engine asking the very same question — 2 is
`HERO_SKILL_WAR_MACHINES`.

## Still open

- **The second out-parameter.** `0x77fca0` fills two, and only the first is the
  healing. The second moves with the mastery and what it decides is unknown; the
  extension passes it through untouched.
- **Which class owns vtable slot `0x174`.** Naming it would make every hook that
  asks about a hero's skills easier to write — the same wish as `0x328` (set
  count) and `0x368` (scripted necromancy level) in
  [../ENGINE_INTERNALS.md](../ENGINE_INTERNALS.md).

## The branch's three perks, and where each will have to go

The Witch's «Мастер палатки» branch — see [../HERO_CLASSES.md](../HERO_CLASSES.md)
for the class and the records.

**Two happen inside a battle**, at the moment the tent acts: the cleanse and the
random blessing. Lua cannot see that moment — the combat script API is a
controller for scripted battles, attached to a hero by `SetHeroCombatScript`, per
hero and per map, and it has no event for "the tent healed somebody". Both are
extension work, and the amount hook is already standing in the right place.

**The third is written, and it is Lua on both sides.** «Запасной комплект»: a
tent destroyed in a battle is back afterwards. The difficulty was never the
rebuilding — it is knowing there was a tent to rebuild, because after the battle
"no tent" and "never had one" look the same.

The answer is that the battle knows, and can be asked without being told
anything:

```
in the battle   GetAttackerWarMachine(3) / GetDefenderWarMachine(3)
                -> SetGameVar("h5e.tent."..GetHeroName(hero), "1")
after it        COMBAT_RESULTS_TRIGGER hands over the combat index
                GetSavedCombatArmyHero(index, side) names both heroes
                HasHeroSkill / HasHeroWarMachine / GiveHeroWarMachine
```

The two halves live in two Lua contexts that share nothing but the game
variables, and each is reached through its own global script — the map's
`advmap-common.lua`, loaded last, and the battle's `combat-startup.lua`, whose
tail is the only place a mod's battle code survives. Both are generated by
`src/mods/skill-scripts.ts` from what the skill form holds; the loading order and
why it is not symmetric are in [../NAMES_AND_SCRIPTING.md](../NAMES_AND_SCRIPTING.md).

Three things that were checked rather than assumed, because each would have cost
a design:

- **There is no "battle starts" trigger.** `SetTrigger` (`0x5f2640`) takes types
  0…16 and one `cmp ebx,10h` decides it; of those, one is about combat and it
  fires afterwards. Type 10 is undeclared in the game's own scripts and real —
  a TOWN trigger (`Object "%s" is not a town`), not a battle one.
- **`OBJECT_TOUCH` does fire before the battle** (A2C0M1 starts a scripted fight
  from one), but it is registered per named object, and 57 of the 67 monsters on
  a shipped map have no name. It cannot see a battle against a hero at all.
- **Nothing needed to be overridden.** The block runs when the battle is built,
  so it just looks; the game's own death hooks stay the game's.

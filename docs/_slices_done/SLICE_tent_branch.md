# The Witch's tent branch, second attempt

*What her four perks are, why the first three were thrown away, and where in
the executable each of the new ones lands.*

Addresses are in-memory (RVA + 0x400000). Everything here was read out of the
game's own data and executable on 2026-08-02.

**All four are written** — `TENT_PERKS` in `e2e/mods.ts`, four stats in
`src/mods/artifact-effects.ts`, two new detours in `native/homm5-editor.c`. What
is left is a battle: nothing below has been seen in game yet, and the log lines
are there to be read rather than reasoned about.

## Why the first three were dropped

They were written before we knew what the engine already does with a first aid
tent, and two of the three asked for things it does by itself:

- **«Запасной комплект»** (a destroyed tent is rebuilt after the battle) is the
  shipped **«Первая помощь»** (`HERO_SKILL_FIRST_AID`, 22) — its description in
  the game says so in as many words, and the code path is below. We built it as
  Lua, saw a tent come back, and had no way to tell whose doing that was.
- **«Чистая повязка»** (the tent cleanses) is a state the engine already has:
  `COMBAT_FAT_HEAL_REMOVE_CURSE` and its family are strings it picks between.
- **«Целебный настой»** (a random blessing on the healed stack) needed a moment
  no script can see, and it was the only honest one of the three.

The Lua machinery built for them is NOT thrown away: a skill can carry a script
for the adventure map and one for a battle (`src/mods/skill-scripts.ts`,
`tools/test-skill-scripts.ts`). It stays in the editor, unused by the mod, until
something needs it that can be tested honestly — an artifact, or a tent that
repairs itself.

**The lesson worth keeping**: before writing a perk, ask what the engine already
does with the thing. Ten minutes in `DefaultStats.xdb` and the tooltip strings
would have saved both of them.

## What the engine already does with a tent

| what | where | notes |
|---|---|---|
| heals `{10,20,50,100}[mastery]` | `0x77fca0` | our specialization term is already added here |
| 3 uses, from `<Shots>` | ctor `0xdc9730` via `0xabbc20` | our `tent_charges` term already raises it |
| health | `0xabc040` | `<Health>` + 100 × mastery, ×2 with the machine's own perk |
| cleanses | tooltip at `0xb82e1a` | level of the effect compared against a threshold |
| rebuilt after a battle | `0xac4ae0` | gated on `HERO_SKILL_FIRST_AID` |
| Ring of Machine Affinity | — | "the tent heals twice as much", +1 shot to ballista and catapult |

Both tuning numbers are DATA, in `GameMechanics/RPGStats/DefaultStats.xdb`:

```xml
<WarMachines_HealthBonusPerSkillTrained>100</WarMachines_HealthBonusPerSkillTrained>
<WarMachines_PerkSpecificHealthMultiplier>2</WarMachines_PerkSpecificHealthMultiplier>
```

Editing them changes the game for everybody, which is exactly why a per-hero term
belongs in the extension — the same argument as `<Shots>`.

## The four perks

Three of them land on functions we have already opened; only the fourth needs a
point we have never touched.

### 1. Her tent is very tough — multiply its health

`0xabc040` is the only place a machine's health is decided:

```
hp  = record->[0x4C]                          // <Health>, 100 for the tent
    + GetSkillMastery(2) * settings[0x124]    // WarMachines_HealthBonusPerSkillTrained
switch (type - 1):                            // jump table at 0xabc148
  ballista → if holds skill 23, hp *= settings[0x128]
  catapult → if holds skill 24, …
  tent     → if holds skill 22 (FIRST_AID), …
```

So "a perk multiplies a machine's health" is a shape the engine already has, and
ours is a second multiplier in the same function. Same detour pattern as
`tent_charges`: read the hero, ask for our skill, scale the result.

### 2. Fifty more healing

The hook already stands inside `0x77fca0` and already adds the specialization's
percentage. A flat term per level of the perk is another line in the same place.
The Ring of Machine Affinity doubles the tent's healing, so multipliers and
addends already coexist there — worth reading how the ring does it before
choosing where in the sum ours goes.

### 3. Cleanse effects up to level 5 (war machines alone reach 3)

**The threshold was in our hands the whole time: it is the amount function's
SECOND out-parameter**, the one the extension has been passing through untouched
since the specialization landed, and the page that carried it said "what it
decides is unknown".

`0x77fca0` fills `{10,20,50,100}` and `{0,0,1,3}` by mastery. The apply path
tests the second against zero before it walks anything (`0xb7a983`) and then
hands it to `0xc78910` per effect, which ends `call 0xad4b70` — the effect's
spell record, its `<Level>` — and `cmp eax,[esp+0Ch]; jg` → no. The tooltip
makes the same comparison at `0xb82dd3`, which is why the words and the deed
agree.

So the perk is `*second += 2`, in a hook that was already standing. **The lesson
is the same one as the dropped perks, one turn further along**: what a function
already hands you is worth reading before looking for a place to hook.

### 4. Ultimate — one charge back per 50 mana spent

The only new point in the set, and it turned out to be one command:

- **spending mana**: `CSetCombatCasterMana::Execute` (`0xb74300`) is the single
  funnel for every mana change inside a battle — it is a NETWORKED command, and
  a multiplayer game cannot afford a second route. It carries the caster at
  `+0x0C` and the new value at `+0x10`; what it was before comes off the caster
  himself through `[vtable+0x234]`, the getter the engine pairs with `+0x22C` in
  its own mana-draining spell (`0xb78929`).
- **giving a charge**: already known — the counter is `[machine+0xB0]`, and our
  `tent_charges` term already writes it.
- **the join between them**: a tent knows its hero, not the other way round, so
  the amount hook writes each tent down beside the three pointers its owner
  answers on and the counting side matches the caster against all three. Which
  one it is has not been measured — the log says, in one battle.

Native rather than scripted: an event into Lua is worth introducing when more
than one thing wants it — which is true of `Hit`, not of this.

## What actually happened

The order held (1 and 2 first, both edits to a function already hooked), and
then 3 and 4 collapsed into far less work than the plan expected: **three of the
four perks land in ONE detour**, because the tent's amount function answers
three questions and we had only been reading one of them.

Three of them ran in a battle the same day. The fourth — the ultimate — did not,
and the plan was wrong about it in a way worth keeping:

**The mana command was never the path.** `CSetCombatCasterMana` (`0xb74300`) was
hooked on the reasoning that combat mana changes through a network command, and
it did not fire once — a dozen battles, a hero with 300 mana and spells to spend.
The lesson is not about that address. It is that the perk needed **no address at
all**: the battle's own Lua reads mana (`GetUnitManaPoints`), every unit's turn
arrives as `UnitMove` in ordinary battles, and the only thing Lua cannot do —
write `machine+0xB0` — is one argument-less call into the extension.
Senya's design; mine was to keep looking for the setter.

So the ultimate is half Lua and half native, and the division is now the shape
every later perk should start from: **watch where the answers already are, write
where the memory is**. It is written up in [docs/api/combat.md](../api/combat.md).

**What the perks cost in the end**: one detour (`0x77fca0`) carrying three terms,
one more for the machine's health (`0xabc040`), the trigger runtime, and one
registered function. No new enum, no data file of the game's edited.

**And two of the day's four battles were spent on things that were not perks at
all** — a `return;` that failed a whole file, and a hero record whose
`OverrideMask` of 0 quietly ignored every stat the stand wrote. Both are written
down where the next person meets them: the linter, and
[docs/OBJECT_DEFAULTS.md](docs/OBJECT_DEFAULTS.md).

## Still worth knowing, from the same session

- **A battle calls the script exactly four ways**, and they are format strings the
  engine executes: `DoPrepare()`, `DoStart()`, `UnitMove("%s")`, `UnitDeath("%s")`
  (`0x720b9e`, `0x720d18`, `0x720e7f`). There is no "a spell was cast" event, and
  no `Trigger` at all in the battle context — the 17 trigger types are the
  adventure map's.
- **A battle runs one scripted script**, plus the global `combat-startup.lua` →
  `combat-common.lua` pair that a mod can carry.
- **Combat is already an event bus in C++**: `CCombatEvent` with twelve
  descendants (`Fight`, `Hit`, `MissileMove`, `Spell`, `Death`, …). That is where
  an `OnHit`-style event for Lua would attach — wanted for the dragon that roars
  and summons when struck.

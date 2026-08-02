# The Witch's tent branch, second attempt

*What her four perks will be, why the first three were thrown away, and where in
the executable each of the new ones lands.*

Addresses are in-memory (RVA + 0x400000). Everything here was read out of the
game's own data and executable on 2026-08-02; nothing is implemented yet.

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

The mechanism EXISTS. In the tooltip path the engine walks the effects on the
target and compares each effect's level against a threshold
(`cmp eax,[esp+1Ch]` in the loop at `0xb82db0`), then picks between
`COMBAT_FAT_HEAL`, `COMBAT_FAT_HEAL_REMOVE_CURSE`,
`COMBAT_FAT_HEAL_RESURRECT` and `COMBAT_FAT_HEAL_RESURRECT_REMOVE_CURSE`.
`0xb573a0` sits beside it and is called from two more places (`0xb864d1`,
`0xb86654`) which look like the APPLY path rather than the tooltip.

**Open**: name the function that yields the threshold. Once named, the perk is
"raise a number", which is the kind of change we already know how to make.

### 4. Ultimate — one charge back per 50 mana spent

The only new point in the set. Two halves:

- **spending mana**: a hook we have never looked for. Find where a hero's mana is
  deducted in combat and accumulate there.
- **giving a charge**: already known — the counter is `[machine+0xB0]`, read at
  `0xdc9dc8`/`0xdc9f06` and spent at `0xdc9f59`, and our `tent_charges` term
  already writes it.

Native rather than scripted: an event into Lua is worth introducing when more
than one thing wants it — which is true of `Hit`, not of this.

## Order

1 and 2 first (both are edits to functions already hooked), then 3 (one search),
then 4. Before any of it: take the three old perks out of the mod and rewrite —
not delete — the specs that author them.

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

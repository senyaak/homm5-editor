# Script API

**Generated** by `npm run build-api` — do not edit by hand. Write functions up
in `src/script-api-curated.ts` (the source of truth) and re-run.

This is OUR reference, written by hand and grown as missions turn up new calls,
because the shipped manuals are the only published list and they are crooked
(mangled by `pdftotext`, no clean grouping, and not ours to reproduce). Each
entry is in our own words, with typed arguments and a real example.

**61** functions written up so far, of **238** the editor knows
(the rest are signatures from the manual, listed at the end — a to-do list).
For the task view — which call for which job — see
[RECIPES.md](RECIPES.md#which-call-for-what).

## Written up

- [Combat](#combat) — 2
- [Dialog](#dialog) — 1
- [Flow](#flow) — 7
- [Fog of war](#fog-of-war) — 1
- [Heroes](#heroes) — 8
- [Objectives](#objectives) — 2
- [Objects](#objects) — 4
- [Ours · Artifact sets](#ours-artifact-sets) — 2
- [Ours · Battle](#ours-battle) — 2
- [Ours · Creatures](#ours-creatures) — 6
- [Ours · Heroes and spells](#ours-heroes-and-spells) — 9
- [Ours · Hiring](#ours-hiring) — 5
- [Ours · Plumbing](#ours-plumbing) — 6
- [Ours · Windows](#ours-windows) — 4
- [Players](#players) — 1
- [Triggers](#triggers) — 1

## Combat

### `SetControlMode(side, mode)`

Set a combat side's control to manual or automatic. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `side` | ATTACKER \| DEFENDER | Which side. |
| `mode` | MODE_* | MODE_MANUAL or MODE_AUTO. |

```lua
SetControlMode(ATTACKER, MODE_MANUAL);
```

> Used from a combat script; the side must be human-controlled.

### `StartCombat(heroName, enemyHeroName, creaturesCount, creatureType/Amount…, combatScriptName, combatFinishTrigger, arenaName = "", allowQuickCombat)`

Start a scripted battle against a hero or a stack of creatures. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `heroName` | name | The attacking hero. |
| `enemyHeroName` | name \| nil | The defending hero, or nil to fight creatures only. |
| `creaturesCount` | number | How many creature stacks follow. |
| `creatureType/Amount…` | CREATURE_*, number | A creatureType, creatureAmount pair per stack, repeated creaturesCount times. |
| `combatScriptName` | ref | The combat script's xpointer, or nil. |
| `combatFinishTrigger` | string | Name of a function to call when the battle ends. |
| `arenaName` | ref | The arena to fight on ("" for the default). _(optional, default "")_ |
| `allowQuickCombat` | boolean | Whether quick combat is allowed. _(optional)_ |

```lua
StartCombat("Isabell", nil, 1, CREATURE_PEASANT, 13, '/Maps/…/C1M1-CombatScript.xdb#xpointer(/Script)', 'AfterCombat');
```

> A variadic call: creatureType[i], creatureAmount[i] repeat creaturesCount times between the count and the script.

## Dialog

### `StartDialogScene(dialogSceneName, callback = "", saveName = "")`

Play a dialogue cutscene, optionally calling back when it ends. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `dialogSceneName` | ref | The scene's xpointer, "/DialogScenes/…/DialogScene.xdb#xpointer(/DialogScene)". |
| `callback` | string | Name of a function to call when the scene finishes. _(optional, default "")_ |
| `saveName` | string | Autosave name to make before the scene. _(optional, default "")_ |

```lua
StartDialogScene("/DialogScenes/C1/M1/D1/DialogScene.xdb#xpointer(/DialogScene)");
```

## Flow

### `GetGameVar(name, default)`

Read a persistent script variable, with a default if unset. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `name` | string | The variable name. |
| `default` | any | Returned when the variable is unset. _(optional)_ |

**Returns:** The stored value, or the default.

```lua
if GetGameVar( "temp.C1M1.num_combat", 0 ) == '0' then … end;
```

### `Loose()`

End the mission as a defeat for the human player. · first seen in C1M1

```lua
Loose();
```

> Spelled "Loose" in the engine, not "Lose".

### `MessageBox(textRef)`

Show a text popup to the player. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `textRef` | ref | A text file reference, e.g. "/Maps/…/notready.txt". |

```lua
MessageBox('/Maps/Scenario/C1M1/notready.txt');
```

### `SetGameVar(name, value)`

Store a persistent script variable (survives save/load). · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `name` | string | The variable name, e.g. "temp.tutorial". |
| `value` | any | The value to store. |

```lua
SetGameVar("temp.tutorial", 1);
```

### `sleep(segments)`

Pause the current thread for a number of turn segments. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `segments` | number | How long to wait. |

```lua
sleep(5);
```

### `startThread(func)`

Run a function concurrently, as its own thread. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `func` | function | The function to run (passed by value, not by name). |

```lua
startThread(PObjective1);
```

> Long-running loops (objective checks, tutorial watchers) run in threads so the main script does not block. See startThreadOnce for a guarded version.

### `Win()`

End the mission as a victory for the human player. · first seen in C1M1

```lua
Win();
```

## Fog of war

### `OpenCircleFog(x, y, floorID, range, playerID)`

Reveal the fog of war within a circle for a player. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `x` | number | Centre tile x. |
| `y` | number | Centre tile y. |
| `floorID` | number | Floor (0 surface, 1 underground). |
| `range` | number | Radius in tiles. |
| `playerID` | PLAYER_* | Whose fog to lift. |

```lua
OpenCircleFog(x, y, fl, 4, PLAYER_1);
```

## Heroes

### `AddHeroCreatures(heroName, creatureID, quantity)`

Put creatures into a hero's army.

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |
| `creatureID` | CREATURE_* | Which creature to add. |
| `quantity` | number | How many. Must be positive. |

```lua
AddHeroCreatures(HERO_NAME, CREATURE_ARCHER, 20);
```

> IT DOES NOT HAPPEN YET. Like its Remove twin it builds a command and hands it to the world to run later, while GetHeroCreatures reads the army itself — so counting straight after an add counts the army as it was. `sleep` until the count changes before doing anything that depends on it.

### `GetHeroCreatures(heroName, creatureID)`

Count how many of a creature are in a hero's army. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |
| `creatureID` | CREATURE_* | Which creature, e.g. CREATURE_FOOTMAN. |

**Returns:** The number of that creature the hero has (0 if none).

```lua
nFootman = GetHeroCreatures(HERO_NAME, CREATURE_FOOTMAN);
```

### `GetHeroCreaturesTypes(heroName)`

Which creatures a hero's army holds, slot by slot.

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |

**Returns:** SEVEN separate numbers, not a table: the distinct creature ids in slot order, padded with zeroes. A hero with two stacks of archers and one of marksmen answers CREATURE_ARCHER, CREATURE_MARKSMAN, 0, 0, 0, 0, 0.

```lua
local a, b, c, d, e, f, g = GetHeroCreaturesTypes(HERO_NAME);
```

> The name says "types", and every instinct says table — but `for kind in GetHeroCreaturesTypes(h)` dies with "`for' table must be a table", and this game has no `type` to ask with. Read from the executable instead: it pushes seven numbers and returns 7. Collect them into a table yourself if you want to walk them.

### `GetHeroStat(heroName, statID)`

Read one of a hero's stats. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |
| `statID` | STAT_* | Which stat, e.g. STAT_MOVE_POINTS. |

**Returns:** The stat value.

```lua
local ap = GetHeroStat("Isabell", STAT_MOVE_POINTS);
```

### `GiveExp(heroName, amount)`

Grant experience points to a hero. · **undocumented** (learned from a script) · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |
| `amount` | number | Experience to add. |

```lua
GiveExp('Isabell', 500);
```

> Not in the shipped manuals — an engine built-in the campaigns use. The editor cannot complete it; type it by hand.

### `IsHeroAlive(heroName)`

Whether a hero is still alive.

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |

**Returns:** Non-nil if alive, nil otherwise.

```lua
if IsHeroAlive("Isabell") == nil then Loose(); end;
```

### `RemoveHeroCreatures(heroName, creatureID, quantity)`

Take creatures out of a hero's army.

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |
| `creatureID` | CREATURE_* | Which creature to take. |
| `quantity` | number | How many. Asking for more than he has takes all he has. |

```lua
RemoveHeroCreatures(HERO_NAME, CREATURE_ARCHER, 20);
```

> IT LEAVES ONE BEHIND rather than empty a hero. When the creature asked for occupies every slot he has, the engine quietly removes one less — a hero whose only stack is twenty archers keeps one archer, and says nothing. To replace a whole army: add the new creature, `sleep` until it is really there, and only then remove. Both halves matter — this call decides how many to take WHEN IT IS MADE, not when the world gets round to running it, so an add queued a line earlier has not happened yet and counts for nothing.

### `SetHeroCombatScript(heroName, scriptName)`

Attach a combat script to a hero, run when that hero fights. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `heroName` | name | The hero's Name handle. |
| `scriptName` | ref | The combat script wrapper's xpointer, e.g. "/Maps/…/IsabellScript.xdb#xpointer(/Script)". |

```lua
SetHeroCombatScript('Isabell', '/Maps/Scenario/C1M1/IsabellScript.xdb#xpointer(/Script)');
```

## Objectives

### `GetObjectiveState(objectiveName, playerID = PLAYER_1)`

Read a quest objective's current state. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectiveName` | name | The objective's handle. |
| `playerID` | PLAYER_* | Whose quest log to read. _(optional, default PLAYER_1)_ |

**Returns:** The OBJECTIVE_* state, or OBJECTIVE_UNKNOWN if never set.

```lua
if GetObjectiveState("prim2") == OBJECTIVE_UNKNOWN then SetObjectiveState("prim2", OBJECTIVE_ACTIVE); end;
```

### `SetObjectiveState(objectiveName, state, playerID = PLAYER_1)`

Change a quest objective's state (active, completed, failed). · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectiveName` | name | The objective's handle, as named in the map tree under Objectives (e.g. "prim1"). |
| `state` | OBJECTIVE_* | OBJECTIVE_ACTIVE, OBJECTIVE_COMPLETED, OBJECTIVE_FAILED, or OBJECTIVE_UNKNOWN (hidden). |
| `playerID` | PLAYER_* | Whose quest log to change. _(optional, default PLAYER_1)_ |

```lua
SetObjectiveState("prim1", OBJECTIVE_ACTIVE);
```

## Objects

### `GetObjectPosition(objectName)`

Find an object's position on the map. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectName` | name | The object's (or hero's) Name handle. |

**Returns:** Three values: x, y, floor.

```lua
x, y, fl = GetObjectPosition('zastava');
```

### `IsObjectExists(objectName)`

Whether a named object is still on the map. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectName` | name | The object's Name handle. |

**Returns:** Non-nil if the object exists, nil otherwise.

```lua
if IsObjectExists('swordsman') then Trigger(OBJECT_TOUCH_TRIGGER, "swordsman", nil); end;
```

### `RemoveObject(objectName)`

Remove a placed object from the map for good. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectName` | name | The object's Name handle. |

```lua
RemoveObject("enemy1");
```

### `SetObjectEnabled(objectName, enable)`

Turn an interactive object's OWN behaviour on or off. Disabled, a hero who comes to it gets nothing but the OBJECT_TOUCH_TRIGGER handler, if one is set — the way to make any visitable object do what the script says. It stays on the map either way (to remove it, RemoveObject). · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectName` | name | The object's Name handle. |
| `enable` | number \| nil | 1 for the object's standard behaviour, nil to leave only the touch trigger. |

```lua
SetObjectEnabled("camp", nil);
Trigger(OBJECT_TOUCH_TRIGGER, "camp", "OnCampTouched");
```

## Ours · Artifact sets

### `EditorHeroWearing(player, members, count)`

The first hero of a player wearing at least N of these artifacts. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `player` | PLAYER_* | Whose heroes to look through. |
| `members` | table | Artifact ids — a set's `<Set>_MEMBERS` list. |
| `count` | number | How many have to be worn. |

**Returns:** The hero's name, or nil when none of them qualifies.

```lua
local hero = EditorHeroWearing(player, H3UndeadKing_MEMBERS, 3);
```

> The condition half of a set's script: what the set does is up to the script, whether that is one of ours or anything else the API offers.

### `EditorWornCount(hero, members)`

How many of these artifacts the hero is WEARING. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `members` | table | Artifact ids — a set's `<Set>_MEMBERS` list. |

**Returns:** The count worn. A piece in the backpack does not count.

```lua
EditorWornCount(hero, H3UndeadKing_MEMBERS)
```

> Plain Lua, defined in the mod's copy of scripts/advmap-common.lua rather than in the extension. It leans on HasArtefact's third argument, which the manuals omit and which is what makes "worn" mean worn.

## Ours · Battle

### `H5ECombatTest()`

Write one line to the extension's log — proof that a battle's script reaches the extension. · **ours** (needs the editor's extension installed)

```lua
H5ECombatTest();
```

> The log line needs a build with `--log lua/registry`.

### `H5ETentCharge()`

Give the first aid tent one more use. · **ours** (needs the editor's extension installed)

```lua
H5ETentCharge();
```

> The half of a perk the battle's Lua cannot do: no function of the game's touches the tent's charges. With no arguments it cannot be told WHOSE tent, so the use goes to the last one built — right when one side has a tent, the ordinary case. See docs/api/combat.md.

## Ours · Creatures

### `H5ECreatureAt(n, minTier = 1, maxTier = 7)`

The id of the Nth creature within the tiers asked, in the table's own order. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `n` | number | Which one — the first is 1. |
| `minTier` | number | The lowest tier counted. _(optional, default 1)_ |
| `maxTier` | number | The highest tier counted. _(optional, default 7)_ |

**Returns:** A CREATURE_* number; nothing past the last.

```lua
local c = H5ECreatureAt(random(H5ECreatureCount(3, 6)) + 1, 3, 6);
```

### `H5ECreatureCost(creature, resource = 6)`

What one of a creature costs, in one resource. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |
| `resource` | number | The game's resource number; gold is 6. _(optional, default 6)_ |

**Returns:** The price of one.

```lua
local gold = H5ECreatureCost(CREATURE_ANGEL);
```

### `H5ECreatureCount(minTier = 1, maxTier = 7)`

How many creatures the game's table holds — the mod's own included — within the tiers asked. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `minTier` | number | The lowest tier counted. _(optional, default 1)_ |
| `maxTier` | number | The highest tier counted. _(optional, default 7)_ |

**Returns:** The count; 0 when the filter leaves none.

```lua
local n = H5ECreatureCount(3, 6);
```

> With H5ECreatureAt this is a roll that needs no list kept up to date: H5ECreatureAt(random(n) + 1, 3, 6). A count and an index rather than one call with many results, because a table built from one call's results keeps only the first of them in this Lua.

### `H5ECreatureGrowth(creature)`

What a week of a creature is — the number its dwelling stocks. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |

**Returns:** Its weekly growth.

```lua
local week = H5ECreatureGrowth(CREATURE_ARCHER);
```

### `H5ECreatureTier(creature)`

A creature's tier. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |

**Returns:** 1 to 7; nothing for an id the table lacks.

```lua
if H5ECreatureTier(c) >= 5 then ... end;
```

### `H5ECreatureTown(creature)`

The race a creature belongs to. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | The creature. |

**Returns:** A TOWN_* number.

```lua
if H5ECreatureTown(c) == TOWN_NECROMANCY then ... end;
```

## Ours · Heroes and spells

### `H5EAnswer(spell, verdict)`

Say whether an adventure spell of the mod may be cast now. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `spell` | SPELL_* | The spell's number. |
| `verdict` | number | 1 (or anything but 0) for yes, 0 for no. |

```lua
H5EAnswer(spell, now);
```

> The engine was never built with the mod's spell numbers, so its own gate says no to them; the extension answers in its place with the last verdict the map gave. The same answer greys the spellbook page and refuses the click.

### `H5EArmySlots(hero)`

How many slots of a hero's army are taken. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |

**Returns:** The number of taken slots, 0 to 7; nil when there is no such hero or army.

```lua
if H5EArmySlots(hero) < 7 then AddHeroCreatures(hero, c, n); end;
```

> The engine keeps slot counting to itself — GetHeroCreatures counts creatures, not slots — and this asks the routine it counts with. Nil rather than a guess: a rule that read "no answer" as "plenty of room" is what this exists to end.

### `H5ECanHoldSpell(hero, spell)`

The school half of H5ECanLearnSpell on its own: whether spells of that kind are for this hero at all. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `spell` | SPELL_* | The spell. |

**Returns:** 1 when his kind may hold it; nothing otherwise.

```lua
if H5ECanHoldSpell(hero, spell) == nil then -- refused for what he IS
```

> Tells a refusal for what the hero IS (a barbarian handed magic) from one for what he lacks yet (level, skill) — the first is worth paying for, the second is lost the way it is at a shrine.

### `H5ECanLearnSpell(hero, spell)`

Whether a hero may learn a spell now — school, skill, mastery and level, as the game decides. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `spell` | SPELL_* | The spell. |

**Returns:** 1 when he may; nothing when he may not, or when there is no such hero or spell.

```lua
if H5ECanLearnSpell(hero, SPELL_MAGIC_ARROW) ~= nil then TeachHeroSpell(hero, SPELL_MAGIC_ARROW); end;
```

### `H5ECasterKnown()`

Whether the extension holds the hero whose adventure spell this is. · **ours** (needs the editor's extension installed)

**Returns:** 1 when it does; nothing when nobody is casting.

```lua
if H5ECasterKnown() ~= nil then ... end;
```

> Tells "I could not find him among the player's heroes" (refuse) from "nobody is casting" — falling back to any hero is how one hero's spell was once decided by another hero's army.

### `H5EHeroHasSpecialization(hero, spec)`

Whether a hero holds this specialization. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |
| `spec` | number | The specialization value — the mod's own included. |

**Returns:** 1 when he holds it; nothing when he does not, or when there is no such living hero.

```lua
if H5EHeroHasSpecialization(hero, 84) ~= nil then ... end;
```

> What lets a specialization of the mod GRANT something on the map rather than have it written into documents at build time. A value read that is not a specialization at all is refused, not compared.

### `H5EIsBarbarian(hero)`

Whether a hero is of the Horde. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |

**Returns:** 1 for a barbarian; nothing for anybody else.

```lua
if H5EIsBarbarian(hero) ~= nil then ... end;
```

### `H5EIsCastingHero(hero)`

Whether this hero is the one casting the adventure spell being decided now. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `hero` | name | The hero's script name. |

**Returns:** 1 when he is; nil when he is not, and nil when it cannot be told — read that as "not him".

```lua
if H5EIsCastingHero(hero) ~= nil then ... end;
```

> For the scripts behind adventure spells of the mod (the page that is live or greyed). Ask H5ECasterKnown first: nil from here can also mean nobody is casting.

### `RestoreDarkEnergy(player)`

Fill a player's dark energy back up to its ceiling. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `player` | PLAYER_* | Whose pool to fill — 1 through 8. |

```lua
RestoreDarkEnergy(PLAYER_1);
```

> The engine has no setter for the pool: it keeps a CEILING and fills to it weekly, so "restore" is asking the player to do that refill out of turn. Any ceiling our artifacts add is included, because the refill is one of the calculations the extension extends. A player number out of range is refused in the engine's own words.

## Ours · Hiring

### `H5EHireCost(creature, count, resource = GOLD)`

What that many cost on the open hire screen, in one resource. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | A creature of the open list. |
| `count` | number | How many. |
| `resource` | WOOD…GOLD | Which resource. _(optional, default GOLD)_ |

**Returns:** The amount — the number the screen showed and checked; nothing for a creature the list does not hold.

```lua
local gold = H5EHireCost(creature, count);
```

### `H5EHireLeft(creature, count)`

Tell the open hire screen how many of a creature are left. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | A creature of the open list. |
| `count` | number | What is left of it now. |

```lua
H5EHireLeft(creature, left);
```

> Said from the purchase event, it lands before the window reads its list again, so the screen shows the script's number at once. A creature the list does not hold is ignored.

### `H5EHireOpen()`

Whether a hire screen of ours is the screen on screen. · **ours** (needs the editor's extension installed)

**Returns:** 1 while one is up, 0 otherwise.

```lua
while H5EHireOpen() == 1 do sleep(1); end;
```

### `H5EHirePay(creature, count)`

Take what that many cost on the open hire screen from the buying player. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | A creature of the open list. |
| `count` | number | How many were bought. |

**Returns:** 1 when paid (or when the line is free), 0 when the purse is short.

```lua
if H5EHirePay(creature, count) == 1 then AddHeroCreatures(hero, creature, count); end;
```

> Only inside the purchase event — the "bought=" function — because that is when there is a buyer. It charges exactly what the screen showed (H5EHireCost). A line the script gives away is simply not paid for.

### `H5EHireScreen(options…, creature, count, price = 100)`

Open the game's own hire screen over a list of the script's, at the script's prices. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `options…` | string | Any argument that is a string is an option, wherever it stands: "bought=<function>" (required), "tag=<text>", "hero=<name>", "object=<name>", "notabs" — see the notes. |
| `creature` | CREATURE_* | A line of the list: the creature on offer. 0 skips the line. |
| `count` | number | How many of it are on offer. |
| `price` | number | Its price in percent of the creature's own cost, every resource alike: 100 ordinary, 50 half, 0 free. _(optional, default 100)_ |

```lua
H5EHireScreen("bought=CampBought", "tag=" .. town, CREATURE_PEASANT, 20, 100, CREATURE_ARCHER, 10, 50);
```

> Lines are THREE numbers each and are read until they run out; the screen keeps the list's order. OPTIONS: "bought=<function>" names the map function told of a purchase, as <function>(creature, count, tag) — the screen has already checked the stock, the room in the army and the money; the function pays (H5EHirePay), gives the creatures and writes down what is left (H5EHireLeft). "tag=<text>" comes back as that third argument word for word (no quotes or backslashes), so four towns share one function. Without "hero=" the TOWN SCREEN must be up and its town buys. "hero=<name>" opens it on the ADVENTURE MAP for that hero (his army beside the offers) and then "object=<name>" is required: the object on the map that sells — the camp he walked into — as a dwelling sells on its own screen. "notabs" hides the three caravan tabs on the left. One screen of ours at a time; a call while one is up is refused. Every refusal is named in bin/homm5-editor-*.log.

## Ours · Plumbing

### `EditorTest()`

Write one line to the extension's log — proof that the map's Lua reaches the extension. · **ours** (needs the editor's extension installed)

```lua
EditorTest();
```

> "The extension is loaded" and "the game's Lua can reach it" are different claims; only the second explains why a script does nothing.

### `H5EAnnounceGain()`

Ask for the next gain a hero receives to be announced on screen. · **ours** (needs the editor's extension installed)

```lua
H5EAnnounceGain(); TeachHeroSpell(hero, spell);
```

> One announcement per call, counted: a box with three spells asks three times, because the grants are deferred and run after the asks. Nothing else in the game is announced — a script that never asks never notices the extension.

### `H5ELog(value)`

A number from a script, into the extension's log. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `value` | number | What to write down. |

```lua
H5ELog(GetHeroLevel(hero));
```

> print goes to the game's console, which is where a player looks; this lands in bin/homm5-editor-*.log beside everything else the extension says, so a script can measure the game and the measurement survives the session.

### `H5EMapIsPlaying()`

Tell the extension the map is being played, not set up. · **ours** (needs the editor's extension installed)

```lua
H5EMapIsPlaying();
```

> For the extension's own use: a line put into every map starts a thread that calls this once it gets past its first sleep, which only happens once the game is running — so a spell a map's start-up script hands out is not announced.

### `H5ENoSuchFunction()`

The "else" of a line the extension says to the map — logs that the function it named is missing. · **ours** (needs the editor's extension installed)

```lua
if CampBought ~= nil then CampBought(c, n, t); else H5ENoSuchFunction(); end;
```

> For the extension's own use: every call it makes into the map's Lua (a town button, a purchase event) is guarded this way, so a function the map lacks is a line in the log rather than nothing at all.

### `H5ETownButtons()`

How many town buttons the extension's file lists — and the map introduces itself. · **ours** (needs the editor's extension installed)

**Returns:** The number of buttons in bin/homm5-editor-buildings.txt.

```lua
H5ETownButtons();
```

> A button's click has no Lua context of its own; calling this hands the extension the map. The extension now also takes the map from the script scheduler's tick, so a map does not have to call it.

## Ours · Windows

### `H5EAskCount(creature, becomes, most)`

Put up the game's own count slider. Answers nothing — see ShowSliderDialog. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | What the player is counting. |
| `becomes` | CREATURE_* | What they turn into. |
| `most` | number | The largest number the slider will reach. |

```lua
H5EAskCount(CREATURE_GRAND_ELF, CREATURE_SHARP_SHOOTER, 12);
```

> The window is the engine's own split slider (CSplitStack) driven by a controller of ours, so it has the game's frame, slider and buttons, and it goes on whichever screen the player is looking at. The picture is made from the creature NUMBER, the way the engine makes it from a stack. A second window while one is open is refused: there is one answer to collect. Prefer ShowSliderDialog, which waits.

### `H5EAskedCount()`

What the count slider was answered with, if it has been. · **ours** (needs the editor's extension installed)

**Returns:** Nothing while the window is open; the chosen number once OK is pressed; -1 when it was closed without an answer.

```lua
local n = H5EAskedCount(); if n ~= nil then ... end;
```

### `H5EMessageBox(text, header)`

A message box on whatever screen is up — a town screen included. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `text` | path \| table | The text, as MessageBox takes it: a path to a text file, or a table of the path and its values. |
| `header` | path \| table | A header above the text, the same way. _(optional)_ |

```lua
H5EMessageBox("/Text/MyMod/camp_closed.txt");
```

> The game's MessageBox queues its box for the ADVENTURE screen and shows it only when that screen runs again — after a town screen closes. This one goes straight onto the screen on top, the way the town screen's own boxes do. It does not wait for the player.

### `ShowSliderDialog(creature, becomes, most)`

Ask the player how many creatures to turn into another kind, and wait. · **ours** (needs the editor's extension installed)

| param | type | meaning |
|---|---|---|
| `creature` | CREATURE_* | What the player is counting. |
| `becomes` | CREATURE_* | What they turn into. |
| `most` | number | The largest number the slider will reach. |

**Returns:** The number the player chose, from 1 to `most`, or -1 if they closed it.

```lua
local n = ShowSliderDialog(CREATURE_GRAND_ELF, CREATURE_SHARP_SHOOTER, 12);
```

> Plain Lua, defined in the mod's copy of scripts/advmap-common.lua, over the extension's H5EAskCount and H5EAskedCount. THE WAITING IS THE WRAPPER'S: a registered function's results are counted the moment it returns, so the one that opens the window cannot answer with a number that does not exist yet. Without the extension it answers -1 rather than hanging. The slider starts at `most` and never reaches nought — that is what Cancel is for. The window draws the FIRST creature on both sides today: the engine asks its controller once and uses the one answer for both icons, so showing what they become means filling the second icon ourselves.

## Players

### `SetPlayerResource(player, resourceKind, quantity)`

Set the amount of one of a player's resources. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `player` | PLAYER_* | Which player. |
| `resourceKind` | resource | WOOD, ORE, MERCURY, CRYSTAL, SULFUR, GEM, or GOLD. |
| `quantity` | number | The new amount (absolute, not a delta). |

```lua
SetPlayerResource(PLAYER_1, GOLD, 0);
```

## Triggers

### `Trigger(triggerType, target, functionName)`

Bind (or clear) a handler for a world event. Pass nil as the function to unbind. · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `triggerType` | *_TRIGGER | Which event: REGION_ENTER_AND_STOP_TRIGGER, OBJECT_TOUCH_TRIGGER, OBJECT_CAPTURE_TRIGGER, HERO_LEVELUP_TRIGGER, PLAYER_REMOVE_HERO_TRIGGER, … |
| `target` | name \| enum | What to watch — a region or object name, or a player id, depending on the trigger type. |
| `functionName` | string \| nil | Name of the Lua function to call, as a string; nil removes the handler. |

```lua
Trigger(REGION_ENTER_AND_STOP_TRIGGER, "d2", "Dialog2");
```

> The handler is named by STRING, not passed as a value, and the engine calls it when the event fires. There are SEVENTEEN types and no more — the engine decides on one `cmp ebx,10h` at 0x5f27cb — and the game's own scripts declare sixteen of them: type 10 is real, undeclared, and a TOWN trigger (it refuses an object that is not a town). None of the seventeen is "a battle is starting"; COMBAT_RESULTS_TRIGGER fires afterwards. Handlers STACK rather than replace, so one set from a mod's advmap-common.lua survives a map setting its own.

---

## From the manual — signature only, not yet written up

177 functions the extraction found that we have not documented in our
own words yet. Signature is the manual's; when one turns up in a mission, move it
into `src/script-api-curated.ts` with a real description.

### ADVMAP

- `AddObjectCreatures(objectName, creatureID, quantity)`
- `BlockGame()`
- `CalcHeroMoveCost(heroName, x, y, floorID = -1)`
- `CanMoveHero(heroName, x, y, floorID = -1)`
- `ChangeHeroStat(heroName, statID, delta)`
- `CreateMonster(monsterName, creatureType, creaturesCount, x, y, floorID, mood= MONSTER_MOOD_AGGRESSIVE, courage= MONSTER_COURAGE_CAN_FLEE_JOIN, rotation= 0)`
- `DeployReserveHero(heroName, x, y, floor)`
- `EnableAIHeroHiring(playerID, townName, enable)`
- `EnableHeroAI(heroName, enable)`
- `GenerateMonsters(monsterTypeID, countGroupsMin, countGroupsMax, countInGroupMin, countInGroupMax)`
- `GetAllNames(filter = 0)`
- `GetCurrentPlayer()`
- `GetDate(dateTypeID)`
- `GetDifficulty()`
- `GetHeroLevel(heroname)`
- `GetObjectCreature(objectName, creatureID)`
- `GetObjectiveProgress(objectiveName, playerID = PLAYER_1)`
- `GetObjectOwner(objectName)`
- `GetObjectsInRegion(regionName, objectType)`
- `GetPlayerHeroes(playerID)`
- `GetPlayerResource(player, resourceKind)`
- `GetTownBuildingLevel(townName, buildingID)`
- `GetTownBuildingLimitLevel(townName, buildingID)`
- `GetTownBuildingMaxLevel(townName, buildingID)`
- `GetTownHero(townName)`
- `GiveArtefact(heroname, artefactID, [bindToHero = 0])`
- `GiveHeroSkill(heroName, skillID)`
- `GiveHeroWarMachine(heroName, warMachineType)`
- `HasArtefact(heroname, artefactID)`
- `HasBorderguardKey(player, color)`
- `HasHeroSkill(heroName, skillID)`
- `HasHeroWarMachine(heroName, warMachineType)`
- `IsHeroLootable(heroName)`
- `IsObjectEnabled(objectName)`
- `IsObjectInRegion(objectName, regionName)`
- `IsObjectiveVisible(objectiveName, playerID = PLAYER_1)`
- `IsObjectVisible(playerID, objectName)`
- `IsRegionBlocked(regionName, playerID)`
- `KnowHeroSpell(heroName, spell)`
- `length(array)`
- `LevelUpHero(heroName)`
- `Load(fileName)`
- `MarkObjectAsVisited(objectName, heroName)`
- `mod(x, y)`
- `MoveCamera(x, y, floorID, zoom = 50, pitch = pi/2, yaw = 0, noZoom = 0, noRotate = 0)`
- `MoveHero(heroName, x, y, floorID = -1)`
- `MoveHeroRealTime(heroName, x, y, floorID = -1)`
- `onLand(1/0)`
- `onSea(1/0)`
- `OpenRegionFog(player, regionName)`
- `Play2DSound(soundName)`
- `Play3DSound(soundName, x, y, floor)`
- `PlayObjectAnimation(objectName, animName, action)`
- `print(...)`
- `random(top)`
- `RazeTown(townName)`
- `RegionToPoint(regionName)`
- `RemoveArtefact(heroname, artefactID)`
- `RemoveHeroWarMachine(heroName, warMachineType)`
- `RemoveObjectCreatures(objectName, creatureID, quantity)`
- `ResetHeroCombatScript(heroName)`
- `ResetObjectFlashlight(objectName)`
- `Save(fileName)`
- `SetAIHeroAttractor(objectName, heroName, priority)`
- `SetAIPlayerAttractor(objectName, playerID, priority)`
- `SetAmbientLight(floorID, lightName, fade = false, time = 1)`
- `SetCombatLight(lightName)`
- `SetHeroLootable(heroName, enable)`
- `SetObjectFlashlight(objectName, lightName)`
- `SetObjectiveProgress(objectiveName, step, playerID = PLAYER_1)`
- `SetObjectiveVisible(objectiveName, enable, playerID = PLAYER_1)`
- `SetObjectOwner(objectName, playerID)`
- `SetObjectPosition(objectName, x, y, floor = -1)`
- `SetPlayerStartResources(player, wood, ore, mercury, crystal, sulfur, gem, gold)`
- `SetRegionBlocked(regionName, status, playerID = -1)`
- `SetTownBuildingLimitLevel(townName, buildingID, limit)`
- `SetWarfogBehaviour(onLand, onSea)`
- `ShowFlyingSign(messageName, objectName, targetPlayerID = -1, time = 1.0)`
- `SiegeTown(heroName, townName, arenaName = "")`
- `sqrt(x)`
- `StopPlaySound(loopingSoundID)`
- `TeachHeroSpell(heroName, spell)`
- `TransformTown(townName, type)`
- `UnblockGame()`
- `UnreserveHero(heroName)`

### ARMIES

- `GetObjectCreaturesTypes(objectName)`

### COMBAT

- `AddCreature(side, type, number, x = -1, y = -1)`
- `EnableAutoFinish(enable)`
- `EnableCinematicCamera(enable)`
- `Finish(winnerSide)`
- `GetAttackerCreatures()`
- `GetAttackerHero()`
- `GetAttackerWarMachine(type)`
- `GetAttackerWarMachines()`
- `GetBuildingType(unitName)`
- `GetCreatureNumber(unitName)`
- `GetCreatureType(unitName)`
- `GetDefenderBuilding(type)`
- `GetDefenderBuildings()`
- `GetDefenderCreatures()`
- `GetDefenderHero()`
- `GetDefenderWarMachine(type)`
- `GetDefenderWarMachines()`
- `GetHeroName(unitName)`
- `GetUnitPosition(unitName)`
- `GetWarMachineType(unitName)`
- `IsAttacker(unitName)`
- `IsBuilding(unitName)`
- `IsComputer(side)`
- `IsCreature(unitName)`
- `IsDefender(unitName)`
- `IsHero(unitName)`
- `IsHuman(side)`
- `IsWarMachine(unitName)`
- `Prepare()`
- `Start()`

### COMBATS

- `GetSavedCombatArmyCreatureInfo(combatIndex, forWinner, creatureIndex)`
- `GetSavedCombatArmyCreaturesCount(combatIndex, forWinner)`
- `GetSavedCombatArmyHero(combatIndex, forWinner)`
- `GetSavedCombatArmyPlayer(combatIndex, forWinner)`
- `GetSavedCombatResult(combatIndex)`

### GAME

- `GetCurrentMoonWeek()`

### HEROES

- `ControlHeroCustomAbility(heroName, customAbilityID, customAbilityMode)`
- `GetArtifactSetItemsCount(heroName, artifactSetID, onlyCombined=1)`
- `IsHeroInBoat(heroName)`
- `IsHeroInTown(heroName, townName, checkGate=1, checkGarrison=1)`
- `LockMinHeroSkillsAndAttributes(heroName)`
- `MakeHeroInteractWithObject(heroName, objectName)`
- `MakeHeroNecromancer(heroName, necromancyLevel)`
- `MakeHeroReturnToTavernAfterDeath(heroName, enable, heroShouldStayAtTavernUntilHired = 0)`
- `SetHeroBiography(heroName, newBioTextFileRef)`
- `SetHeroesExpCoef(fCoef)`
- `SetHeroRoleMode(heroName, roleMode)`
- `SinkHero(heroName)`
- `TakeAwayHeroExp(heroName, exp)`

### MONSTERS

- `SetMonsterCourageAndMood(monsterName, playerID, courage, mood)`
- `SetMonsterNames(monsterName, monsterNamesFilter, nameFileRef)`
- `SetMonsterSelectionType(monsterName, selectionType)`

### OBJECTS

- `CreateDwelling(scriptName, townType, creaturesTier, ownerPlayer, x, y, floorID, rotation = 0)`
- `DenyGarrisonCreaturesTakeAway(garrisonName, deny = 1/0)`
- `OverrideObjectTooltipNameAndDescription(objectName, name, desc)`
- `ReplaceDwelling(name, newTownType, [creatureId1, [creatureId2, [creatureId3, [creatureId4] ] ] ])`
- `SetDisabledObjectMode(objectName, disabledMode)`
- `SetRegionAutoObjectEnable(regionName, autoMode, heroTownType, heroPlayerID, heroName, objectName, enableType)`

### PLAYERS

- `AllowHeroHiringByRaceForAI(playerID, townTypeID, allow)`
- `AllowHeroHiringByRaceInTown(townName, townTypeID, allow)`
- `AllowHiringOfHeroForAI(playerID, heroName, allow)`
- `AllowHiringOfHeroInTown(townName, heroName, allow)`
- `AllowOpenFogOfWarForAlly(actingPlayer, fogSeeAllyPlayer, allow=1/0)`
- `AllowPlayerTavernHero(playerID, heroName, allow)`
- `AllowPlayerTavernRace(playerID, townTypeID, allow)`
- `BlockTownGarrisonForAI(townName, isBlocked)`
- `DoNotGiveTurnToPlayerAIIfNoTownsAndActiveHeroes(playerID, enable)`
- `GetPlayerSelectedCampaignBonusIndex(playerID)`
- `SetPlayerTeam(player, team)`

### TOWN

- `CreateCaravan(caravanName, caravanPlayer, floorID, x, y, destFloorID, destX, destY)`
- `CreatureHired(type, number)`
- `DenyAIHeroesFlee(PlayerID, isDenied, enemyHeroName = "")`
- `DenyAIHeroFlee(heroName, isDenied, enemyHeroName = "")`
- `GetHeroSkillMastery(heroName, skillID)`
- `HeroHired(name)`
- `OpenPuzzleMap(player, numObelisks)`
- `PlayVisualEffect(effectName, objectName="", tagName="", x=0, y=0, z=0, rot=0, floor=0)`
- `QuestionBox(messageName, callbackYes = "", callbackNo = "")`
- `RazeBuilding(objectName)`
- `SetAIHeroFleeControl(heroName, isUnique)`
- `SetObjectRotation(objectName, rotation)`
- `StartAdvMapDialog(dialogIndex, callback)`
- `StopVisualEffects(tagName="")`

### TOWNS

- `DestroyTownBuildingToLevel(townName, buildingID, level, canRebuild = 1)`
- `DisableAutoEnterTown(townName, disable)`
- `MakeTownMovable(townName)`

### TUTORIAL

- `IsTutorialItemEnabled(name)`
- `IsTutorialMessageBoxOpen()`
- `TutorialActivateHint(stringID)`
- `TutorialMessageBox(stringID)`
- `TutorialSetBlink(stringID, turnOn)`

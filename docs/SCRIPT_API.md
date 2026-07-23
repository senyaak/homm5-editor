# Script API

**Generated** by `npm run build-api` — do not edit by hand. Write functions up
in `src/script-api-curated.ts` (the source of truth) and re-run.

This is OUR reference, written by hand and grown as missions turn up new calls,
because the shipped manuals are the only published list and they are crooked
(mangled by `pdftotext`, no clean grouping, and not ours to reproduce). Each
entry is in our own words, with typed arguments and a real example.

**24** functions written up so far, of **204** the editor knows
(the rest are signatures from the manual, listed at the end — a to-do list).
For the task view — which call for which job — see
[RECIPES.md](RECIPES.md#which-call-for-what).

## Written up

- [Combat](#combat) — 2
- [Dialog](#dialog) — 1
- [Flow](#flow) — 7
- [Fog of war](#fog-of-war) — 1
- [Heroes](#heroes) — 5
- [Objectives](#objectives) — 2
- [Objects](#objects) — 4
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

Show or hide a placed object (a disabled object is not on the map for the player). · first seen in C1M1

| param | type | meaning |
|---|---|---|
| `objectName` | name | The object's Name handle. |
| `enable` | number \| nil | 1 to show, nil (or 0) to hide. |

```lua
SetObjectEnabled('zastava', 1);
```

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

> The handler is named by STRING, not passed as a value, and the engine calls it when the event fires.

---

## From the manual — signature only, not yet written up

180 functions the extraction found that we have not documented in our
own words yet. Signature is the manual's; when one turns up in a mission, move it
into `src/script-api-curated.ts` with a real description.

### ADVMAP

- `AddHeroCreatures(heroname, creatureID, quantity)`
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
- `RemoveHeroCreatures(heroname, creatureID, quantity)`
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

- `GetHeroCreaturesTypes(heroName)`
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

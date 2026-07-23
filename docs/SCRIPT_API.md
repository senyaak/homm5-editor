# Script API — the engine functions, by section

**Generated** by `npm run script-api` from the manuals the game ships
(`HOMM5_Script_Functions.pdf`, `HOMM5_A2_Script_Functions.pdf`). Do not edit by hand.

203 functions the engine exposes to a map script, across 12
sections. This is the *catalogue* — the name and parameter list of each call, so
you know what exists and how to call it. For what each one *does*, the
`HOMM5_A2_Script_Functions.pdf` supplement in the game's `Editor Documentation`
is the authority; this deliberately does not copy its descriptions.

For the *task* view — which calls to reach for when writing objectives, triggers,
dialog or combat — see [RECIPES.md](RECIPES.md#script-a-mission). Not every
function a mission calls is here: some the campaigns use (`GiveExp`, the combat
runtime `combatReadyPerson`/`setATB`, the tutorial `WaitForTutorialMessageBox`)
are engine built-ins the manuals never documented — see
[NAMES_AND_SCRIPTING.md](NAMES_AND_SCRIPTING.md#the-linter--the-errors-the-engine-wont-tell-you-about).

## Sections

- [ADVMAP](#advmap) — 109
- [ARMIES](#armies) — 2
- [COMBAT](#combat) — 31
- [COMBATS](#combats) — 5
- [GAME](#game) — 1
- [HEROES](#heroes) — 13
- [MONSTERS](#monsters) — 3
- [OBJECTS](#objects) — 6
- [PLAYERS](#players) — 11
- [TOWN](#town) — 14
- [TOWNS](#towns) — 3
- [TUTORIAL](#tutorial) — 5

## ADVMAP

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
- `GetGameVar(name)`
- `GetHeroCreatures(heroName, creatureID)`
- `GetHeroLevel(heroname)`
- `GetHeroStat(heroName, statID)`
- `GetObjectCreature(objectName, creatureID)`
- `GetObjectiveProgress(objectiveName, playerID = PLAYER_1)`
- `GetObjectiveState(objectiveName, playerID = PLAYER_1)`
- `GetObjectOwner(objectName)`
- `GetObjectPosition(objectName)`
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
- `IsHeroAlive(heroname)`
- `IsHeroLootable(heroName)`
- `IsObjectEnabled(objectName)`
- `IsObjectExists(objectName)`
- `IsObjectInRegion(objectName, regionName)`
- `IsObjectiveVisible(objectiveName, playerID = PLAYER_1)`
- `IsObjectVisible(playerID, objectName)`
- `IsRegionBlocked(regionName, playerID)`
- `KnowHeroSpell(heroName, spell)`
- `length(array)`
- `LevelUpHero(heroName)`
- `Load(fileName)`
- `Loose()`
- `MarkObjectAsVisited(objectName, heroName)`
- `MessageBox(messageName, callback = "")`
- `mod(x, y)`
- `MoveCamera(x, y, floorID, zoom = 50, pitch = pi/2, yaw = 0, noZoom = 0, noRotate = 0)`
- `MoveHero(heroName, x, y, floorID = -1)`
- `MoveHeroRealTime(heroName, x, y, floorID = -1)`
- `onLand(1/0)`
- `onSea(1/0)`
- `OpenCircleFog(x, y, floorID, range, playerID)`
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
- `RemoveObject(objectName)`
- `RemoveObjectCreatures(objectName, creatureID, quantity)`
- `ResetHeroCombatScript(heroName)`
- `ResetObjectFlashlight(objectName)`
- `Save(fileName)`
- `SetAIHeroAttractor(objectName, heroName, priority)`
- `SetAIPlayerAttractor(objectName, playerID, priority)`
- `SetAmbientLight(floorID, lightName, fade = false, time = 1)`
- `SetCombatLight(lightName)`
- `SetGameVar(name, value)`
- `SetHeroCombatScript(heroName, scriptName)`
- `SetHeroLootable(heroName, enable)`
- `SetObjectEnabled(objectName, enable)`
- `SetObjectFlashlight(objectName, lightName)`
- `SetObjectiveProgress(objectiveName, step, playerID = PLAYER_1)`
- `SetObjectiveState(objectiveName, state, playerID = PLAYER_1)`
- `SetObjectiveVisible(objectiveName, enable, playerID = PLAYER_1)`
- `SetObjectOwner(objectName, playerID)`
- `SetObjectPosition(objectName, x, y, floor = -1)`
- `SetPlayerResource(player, resourceKind, quantity)`
- `SetPlayerStartResources(player, wood, ore, mercury, crystal, sulfur, gem, gold)`
- `SetRegionBlocked(regionName, status, playerID = -1)`
- `SetTownBuildingLimitLevel(townName, buildingID, limit)`
- `SetWarfogBehaviour(onLand, onSea)`
- `ShowFlyingSign(messageName, objectName, targetPlayerID = -1, time = 1.0)`
- `SiegeTown(heroName, townName, arenaName = "")`
- `sleep(number-of-segments)`
- `sqrt(x)`
- `StartCombat(heroName, enemyHeroName, enemyHeroName, creaturesCount, creatureType[1], creatureAmount[1], ..., creatureType[Count], creatureAmount[Count], combatScriptName, combatFinishTrigger, arenaName, allowQuickCombat)`
- `StartDialogScene(dialogSceneName, callback = "", saveName = "")`
- `startThread(func)`
- `StopPlaySound(loopingSoundID)`
- `TeachHeroSpell(heroName, spell)`
- `TransformTown(townName, type)`
- `Trigger(triggerType, ..., functionName)`
- `UnblockGame()`
- `UnreserveHero(heroName)`
- `Win()`

## ARMIES

- `GetHeroCreaturesTypes(heroName)`
- `GetObjectCreaturesTypes(objectName)`

## COMBAT

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
- `SetControlMode(side, mode)`
- `Start()`

## COMBATS

- `GetSavedCombatArmyCreatureInfo(combatIndex, forWinner, creatureIndex)`
- `GetSavedCombatArmyCreaturesCount(combatIndex, forWinner)`
- `GetSavedCombatArmyHero(combatIndex, forWinner)`
- `GetSavedCombatArmyPlayer(combatIndex, forWinner)`
- `GetSavedCombatResult(combatIndex)`

## GAME

- `GetCurrentMoonWeek()`

## HEROES

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

## MONSTERS

- `SetMonsterCourageAndMood(monsterName, playerID, courage, mood)`
- `SetMonsterNames(monsterName, monsterNamesFilter, nameFileRef)`
- `SetMonsterSelectionType(monsterName, selectionType)`

## OBJECTS

- `CreateDwelling(scriptName, townType, creaturesTier, ownerPlayer, x, y, floorID, rotation = 0)`
- `DenyGarrisonCreaturesTakeAway(garrisonName, deny = 1/0)`
- `OverrideObjectTooltipNameAndDescription(objectName, name, desc)`
- `ReplaceDwelling(name, newTownType, [creatureId1, [creatureId2, [creatureId3, [creatureId4] ] ] ])`
- `SetDisabledObjectMode(objectName, disabledMode)`
- `SetRegionAutoObjectEnable(regionName, autoMode, heroTownType, heroPlayerID, heroName, objectName, enableType)`

## PLAYERS

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

## TOWN

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

## TOWNS

- `DestroyTownBuildingToLevel(townName, buildingID, level, canRebuild = 1)`
- `DisableAutoEnterTown(townName, disable)`
- `MakeTownMovable(townName)`

## TUTORIAL

- `IsTutorialItemEnabled(name)`
- `IsTutorialMessageBoxOpen()`
- `TutorialActivateHint(stringID)`
- `TutorialMessageBox(stringID)`
- `TutorialSetBlink(stringID, turnOn)`

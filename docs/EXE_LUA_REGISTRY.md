# The executable's Lua registration tables

Read out of `bin/H5_Game.exe` (Steam build) on 2026-07-27 by walking the
`{name pointer, C function pointer}` pair arrays in `.data`. Seven
null-terminated tables sit back to back at file offsets 0xc8c258-0xc8cc00 and
0xc8f138-0xc8f2a0 — **306 functions the engine exposes to Lua**, next to the
204 signatures the shipped manuals admit to ([SCRIPT_API.md](SCRIPT_API.md)).
Function addresses are this build's only — match by pattern, never by offset,
on any other build (same rule as the creature/artifact ceilings).

Functions **not in the shipped manuals** are marked `·undoc`. The tables are
packed tight (no slack to append in place); extending means relocating a
table or repointing single entries — see the plan in
[ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md).


## Table 1 — file 0xc8c258 (99 entries)

| function | code VA | |
|---|---|---|
| `GetPlayerState` | `0x5ce840` | ·undoc |
| `GetPlayerHeroes` | `0x5cea30` |  |
| `GetPlayerResource` | `0x5ceed0` |  |
| `SetPlayerResource` | `0x5cf130` |  |
| `SetPlayerStartResources` | `0x5cf4c0` |  |
| `HasBorderguardKey` | `0x5cf7c0` |  |
| `GiveBorderguardKey` | `0x5cfa20` | ·undoc |
| `DeployReserveHero` | `0x5cfcb0` |  |
| `UnreserveHero` | `0x5d0180` |  |
| `IsHeroAlive` | `0x5d04c0` |  |
| `GetHeroLevel` | `0x5d06e0` |  |
| `GetHeroStat` | `0x5d08d0` |  |
| `ChangeHeroStat` | `0x5d0b40` |  |
| `LevelUpHero` | `0x5d1200` |  |
| `HasHeroSkill` | `0x5d14d0` |  |
| `KnowHeroSpell` | `0x5d1da0` |  |
| `TeachHeroSpell` | `0x5d2010` |  |
| `GiveHeroSkill` | `0x5d1990` |  |
| `HasArtefact` | `0x5d2300` |  |
| `GetHeroArtifactsCount` | `0x5d2580` | ·undoc |
| `GiveArtefact` | `0x5d2800` |  |
| `RemoveArtefact` | `0x5d2af0` |  |
| `GetHeroCreatures` | `0x5d3520` |  |
| `AddHeroCreatures` | `0x5d3780` |  |
| `RemoveHeroCreatures` | `0x5d3b00` |  |
| `IsHeroLootable` | `0x5d3090` |  |
| `SetHeroLootable` | `0x5d32b0` |  |
| `HasHeroWarMachine` | `0x5d3e70` |  |
| `GiveHeroWarMachine` | `0x5d40c0` |  |
| `RemoveHeroWarMachine` | `0x5d4390` |  |
| `SetHeroCombatScript` | `0x5d4670` |  |
| `ResetHeroCombatScript` | `0x5d49b0` |  |
| `GetTownBuildingLevel` | `0x5d4c60` |  |
| `GetTownBuildingMaxLevel` | `0x5d4f20` |  |
| `GetTownBuildingLimitLevel` | `0x5d51e0` |  |
| `SetTownBuildingLimitLevel` | `0x5d54a0` |  |
| `DestroyTownBuildingToLevel` | `0x5d5840` |  |
| `IsObjectExists` | `0x5d5c40` |  |
| `CreateArtifact` | `0x5d5e40` | ·undoc |
| `CreateMonster` | `0x5d61a0` |  |
| `TransformTown` | `0x5d77b0` |  |
| `RazeTown` | `0x5d7e00` |  |
| `RazeBuilding` | `0x5d8220` |  |
| `RemoveObject` | `0x5d86b0` |  |
| `GetObjectPosition` | `0x5d8930` |  |
| `SetObjectPosition` | `0x5d8b90` |  |
| `GetObjectOwner` | `0x5d90e0` |  |
| `SetObjectOwner` | `0x5d9340` |  |
| `IsObjectInRegion` | `0x5d9750` |  |
| `GetObjectsInRegion` | `0x5d99f0` |  |
| `IsObjectVisible` | `0x5d9d50` |  |
| `GetObjectCreatures` | `0x5da010` | ·undoc |
| `AddObjectCreatures` | `0x5daa50` |  |
| `SetObjectDwellingCreatures` | `0x5dae70` | ·undoc |
| `GetObjectDwellingCreatures` | `0x5db150` | ·undoc |
| `RemoveObjectCreatures` | `0x5db3c0` |  |
| `IsObjectEnabled` | `0x5db880` |  |
| `SetObjectEnabled` | `0x5dbad0` |  |
| `MarkObjectAsVisited` | `0x5dbde0` |  |
| `SetMonsterSelectionType` | `0x5dc210` |  |
| `CanMoveHero` | `0x5dc520` |  |
| `CalcHeroMoveCost` | `0x5dc880` |  |
| `MoveHero` | `0x5dce20` |  |
| `MoveHeroRealTime` | `0x5dd210` |  |
| `StartCombat` | `0x5dd9b0` |  |
| `SiegeTown` | `0x5de450` |  |
| `GenerateMonsters` | `0x5deb40` |  |
| `RemoveAllMonsters` | `0x5dee30` | ·undoc |
| `CalcAverageMonstersTier` | `0x5df060` | ·undoc |
| `GetStandStatesCount` | `0x5df3f0` | ·undoc |
| `GetStandState` | `0x5df610` | ·undoc |
| `SetStandState` | `0x5df830` | ·undoc |
| `GetTownHero` | `0x5dfb50` |  |
| `GetHeroTown` | `0x5dfd80` | ·undoc |
| `GetObjectsFromPath` | `0x5dffd0` | ·undoc |
| `SetPlayerHeroesCountNotForHire` | `0x5e0540` | ·undoc |
| `GetHeroSkillMastery` | `0x5d1730` |  |
| `SetObjectRotation` | `0x5d8e50` |  |
| `CreateTreasure` | `0x5e07b0` | ·undoc |
| `CreateStatic` | `0x5e0c50` | ·undoc |
| `CreateDwelling` | `0x5d6dd0` |  |
| `ReplaceDwelling` | `0x5e10c0` |  |
| `GetArtifactSetItemsCount` | `0x5d2df0` |  |
| `SetMonsterNames` | `0x5d6860` |  |
| `IsHeroInTown` | `0x5d7500` |  |
| `SetMonsterCourageAndMood` | `0x5d6b00` |  |
| `GetObjectCreaturesTypes` | `0x5da290` |  |
| `GetHeroCreaturesTypes` | `0x5da670` |  |
| `DenyGarrisonCreaturesTakeAway` | `0x5e1430` |  |
| `MakeHeroInteractWithObject` | `0x5e16b0` |  |
| `ControlHeroCustomAbility` | `0x5e1a10` |  |
| `GetPlayerSelectedCampaignBonusIndex` | `0x5e1cd0` |  |
| `SetHeroBiography` | `0x5e1ee0` |  |
| `GetCurrentMoonWeek` | `0x5e2180` |  |
| `GetPlayerRace` | `0x5e2350` | ·undoc |
| `IsAIPlayer` | `0x5e25a0` | ·undoc |
| `GetObjectArmySlotCreature` | `0x5e2800` | ·undoc |
| `GetPlayerTeam` | `0x5e2aa0` | ·undoc |
| `GetPlayerNecroEnergy` | `0x5e2ce0` | ·undoc |

## Table 2 — file 0xc8c608 (113 entries)

| function | code VA | |
|---|---|---|
| `GetMaxFloor` | `0x5f6ad0` | ·undoc |
| `ExitGame` | `0x5f69c0` | ·undoc |
| `Win` | `0x5eba40` |  |
| `Loose` | `0x5ebff0` |  |
| `GetDate` | `0x5ec2a0` |  |
| `GetCurrentPlayer` | `0x5ec510` |  |
| `GetAllNames` | `0x5ed070` |  |
| `IsObjectiveVisible` | `0x5ed370` |  |
| `SetObjectiveVisible` | `0x5ed600` |  |
| `GetObjectiveState` | `0x5ed900` |  |
| `SetObjectiveState` | `0x5edb80` |  |
| `GetObjectiveProgress` | `0x5ee000` |  |
| `SetObjectiveProgress` | `0x5ee290` |  |
| `RegionToPoint` | `0x5ee600` |  |
| `IsRegionBlocked` | `0x5ee860` |  |
| `SetRegionBlocked` | `0x5eeb20` |  |
| `OpenRegionFog` | `0x5eef20` |  |
| `OpenCircleFog` | `0x5ef380` |  |
| `SetAmbientLight` | `0x5efc80` |  |
| `SetObjectFlashlight` | `0x5f0120` |  |
| `MessageBoxInt` | `0x5f04e0` | ·undoc |
| `QuestionBoxInt` | `0x5f0760` | ·undoc |
| `MessageBox` | `0x5f04e0` |  |
| `QuestionBox` | `0x5f0760` |  |
| `ShowFlyingSign` | `0x5f1630` |  |
| `Play2DSound` | `0x5f1b00` |  |
| `Play3DSound` | `0x5f1d30` |  |
| `SetTrigger` | `0x5f2640` | ·undoc |
| `Trigger` | `0x5f2640` |  |
| `StopTrigger` | `0x5f2fe0` | ·undoc |
| `StartDialogSceneInt` | `0x5f3160` | ·undoc |
| `StartCutSceneInt` | `0x5f33f0` | ·undoc |
| `StartDialogScene` | `0x5f3160` |  |
| `StartCutScene` | `0x5f33f0` | ·undoc |
| `GetGameVar` | `0x5f3c00` |  |
| `SetGameVar` | `0x5f3e10` |  |
| `BlockGame` | `0x5f4000` |  |
| `UnblockGame` | `0x5f41a0` |  |
| `MoveCamera` | `0x5f4340` |  |
| `DisableCameraFollowHeroes` | `0x5f48f0` | ·undoc |
| `random` | `0x5f4f00` |  |
| `SetWarfogBehaviour` | `0x5f4c80` |  |
| `EnableHeroAI` | `0x5ef6a0` |  |
| `SetAIHeroAttractor` | `0x5f50e0` |  |
| `SetAIPlayerAttractor` | `0x5f53c0` |  |
| `EnableAIHeroHiring` | `0x5ef950` |  |
| `SetCombatAmbientLight` | `0x5f56d0` | ·undoc |
| `GetTerrainSize` | `0x5f64d0` | ·undoc |
| `IsTilePassable` | `0x5f66e0` | ·undoc |
| `GetGuardsTier` | `0x5f6120` | ·undoc |
| `GetObjectNamesByType` | `0x5f59a0` | ·undoc |
| `PlayVisualEffect` | `0x5f6ca0` |  |
| `StopVisualEffects` | `0x5f7200` |  |
| `PlayObjectAnimation` | `0x5f7440` |  |
| `SetPlayerTeam` | `0x5f7720` |  |
| `DenyAIHeroFlee` | `0x5f79d0` |  |
| `DenyAIHeroesFlee` | `0x5f7ed0` |  |
| `SetAIHeroFleeControl` | `0x5f7c60` |  |
| `OpenPuzzleMap` | `0x5f8160` |  |
| `SetHeroesExpCoef` | `0x5f83d0` |  |
| `StartAdvMapDialog` | `0x5f8630` |  |
| `OverrideAdvMapDialogPos` | `0x5f8830` | ·undoc |
| `CreateCaravan` | `0x5f8a70` |  |
| `IsHeroInBoat` | `0x5f8d50` |  |
| `SinkHero` | `0x5f8fc0` |  |
| `BlockTownGarrisonForAI` | `0x5f92a0` |  |
| `AllowHeroHiringByRaceForAI` | `0x5f9560` |  |
| `AllowHiringOfHeroForAI` | `0x5f9800` |  |
| `AllowHeroHiringByRaceInTown` | `0x5f9a90` |  |
| `AllowHiringOfHeroInTown` | `0x5f9d40` |  |
| `AllowPlayerTavernRace` | `0x5f9fd0` |  |
| `AllowPlayerTavernHero` | `0x5fa280` |  |
| `MakeHeroReturnToTavernAfterDeath` | `0x5fa7a0` |  |
| `AllowOpenFogOfWarForAlly` | `0x5faa00` |  |
| `MakeHeroNecromancer` | `0x5fa510` |  |
| `SetDisabledObjectMode` | `0x5faca0` |  |
| `MakeTownMovable` | `0x5faf50` |  |
| `TakeAwayHeroExp` | `0x5fb1f0` |  |
| `GetLastSavedCombatIndex` | `0x5fb460` | ·undoc |
| `GetSavedCombatResult` | `0x5fb630` |  |
| `GetSavedCombatArmyPlayer` | `0x5fb810` |  |
| `GetSavedCombatArmyHero` | `0x5fba30` |  |
| `GetSavedCombatArmyCreaturesCount` | `0x5fbc90` |  |
| `GetSavedCombatArmyCreatureInfo` | `0x5fbec0` |  |
| `DisableAutoEnterTown` | `0x5fc180` |  |
| `SetRegionAutoObjectEnable` | `0x5fc440` |  |
| `LockMinHeroSkillsAndAttributes` | `0x5fc820` |  |
| `SetHeroRoleMode` | `0x5fca70` |  |
| `OverrideObjectTooltipNameAndDescription` | `0x5fcd00` |  |
| `DoNotGiveTurnToPlayerAIIfNoTownsAndActiveHeroes` | `0x5fd000` |  |
| `UpgradeTownBuilding` | `0x5fd2b0` | ·undoc |
| `SetAmbientLightForPlayers` | `0x5efed0` | ·undoc |
| `MessageBoxForPlayers` | `0x5f0a20` | ·undoc |
| `QuestionBoxForPlayers` | `0x5f0ce0` | ·undoc |
| `Play2DSoundForPlayers` | `0x5f2090` | ·undoc |
| `Play3DSoundForPlayers` | `0x5f22d0` | ·undoc |
| `StartDialogSceneForPlayers` | `0x5f36a0` | ·undoc |
| `StartCutSceneForPlayers` | `0x5f3940` | ·undoc |
| `MoveCameraForPlayers` | `0x5f4610` | ·undoc |
| `DisableCameraFollowHeroesForPlayers` | `0x5f4ab0` | ·undoc |
| `WinTeam` | `0x5ebd40` | ·undoc |
| `IsPlayerCurrent` | `0x5ec720` | ·undoc |
| `IsPlayerInGhostMode` | `0x5ec960` | ·undoc |
| `IsPlayerWaitingForTurn` | `0x5ecba0` | ·undoc |
| `IsTeamCurrent` | `0x5ecde0` | ·undoc |
| `IsPlayerLost` | `0x5fd670` | ·undoc |
| `CanShowToPlayer` | `0x5fd8e0` | ·undoc |
| `GetTurnTimeLeft` | `0x5fdb70` | ·undoc |
| `WarpToMap` | `0x5fddf0` | ·undoc |
| `WarpHeroExp` | `0x5fdfb0` | ·undoc |
| `GiveHeroBattleBonus` | `0x5fe280` | ·undoc |
| `GetTownRace` | `0x5fe540` | ·undoc |
| `TalkBoxForPlayers` | `0x5f0fe0` | ·undoc |

## Table 3 — file 0xc8c9b0 (53 entries)

| function | code VA | |
|---|---|---|
| `EnableDynamicBattleMode` | `0x6014b0` | ·undoc |
| `SetControlMode` | `0x601700` |  |
| `GetHost` | `0x601980` | ·undoc |
| `EnableAutoFinish` | `0x601bb0` |  |
| `combatEnableFinish` | `0x601bb0` | ·undoc |
| `Finish` | `0x601de0` |  |
| `Break` | `0x6020a0` | ·undoc |
| `GetUnitSide` | `0x602230` | ·undoc |
| `GetUnitType` | `0x602480` | ·undoc |
| `GetUnits` | `0x602760` | ·undoc |
| `GetUnitPosition` | `0x602c10` |  |
| `pos` | `0x602c10` | ·undoc |
| `GetHeroName` | `0x602e40` |  |
| `GetCreatureType` | `0x603050` |  |
| `GetCreatureNumber` | `0x603260` |  |
| `GetWarMachineType` | `0x603490` |  |
| `GetBuildingType` | `0x6036a0` |  |
| `AddCreature` | `0x6038b0` |  |
| `SummonCreature` | `0x603c30` | ·undoc |
| `GetUnitManaPoints` | `0x603fb0` | ·undoc |
| `GetUnitMaxManaPoints` | `0x6041c0` | ·undoc |
| `SetUnitManaPoints` | `0x6043d0` | ·undoc |
| `UnitCastGlobalSpell` | `0x604650` | ·undoc |
| `UnitCastAreaSpell` | `0x604870` | ·undoc |
| `UnitCastAimedSpell` | `0x604ab0` | ·undoc |
| `postEvent` | `0x604d10` | ·undoc |
| `GetGameVar` | `0x604e40` |  |
| `SetGameVar` | `0x605090` |  |
| `showHighlighting` | `0x6052b0` | ·undoc |
| `addUnit` | `0x605440` | ·undoc |
| `exist` | `0x6058c0` | ·undoc |
| `unitNames` | `0x605a90` | ·undoc |
| `removeUnit` | `0x605cf0` | ·undoc |
| `RemoveAllUnits` | `0x605f50` | ·undoc |
| `displace` | `0x606250` | ·undoc |
| `commandDefend` | `0x606510` | ·undoc |
| `commandMove` | `0x606700` | ·undoc |
| `commandMoveAttack` | `0x606a90` | ·undoc |
| `commandShot` | `0x606de0` | ·undoc |
| `commandDoSpecial` | `0x607090` | ·undoc |
| `commandDoSpell` | `0x607420` | ·undoc |
| `combatStarted` | `0x6077c0` | ·undoc |
| `combatReadyPerson` | `0x607980` | ·undoc |
| `setATB` | `0x607b80` | ·undoc |
| `combatSetPause` | `0x608040` | ·undoc |
| `combatPlayEmotion` | `0x608270` | ·undoc |
| `playAnimation` | `0x607dd0` | ·undoc |
| `GetRagePoints` | `0x609340` | ·undoc |
| `GetRageLevel` | `0x6095d0` | ·undoc |
| `MessageBox` | `0x609880` |  |
| `ShowFlyingSign` | `0x609ab0` |  |
| `Play2DSound` | `0x609eb0` |  |
| `Play3DSound` | `0x60a0a0` |  |

## Table 4 — file 0xc8cb60 (7 entries)

| function | code VA | |
|---|---|---|
| `toggleTutorialMode` | `0x6084d0` | ·undoc |
| `showMessage` | `0x608670` | ·undoc |
| `clearMessage` | `0x608830` | ·undoc |
| `changeSubject` | `0x6089b0` | ·undoc |
| `subject` | `0x608ba0` | ·undoc |
| `shots` | `0x608d50` | ·undoc |
| `shotsNumber` | `0x608fd0` | ·undoc |

## Table 5 — file 0xc8cbe0 (6 entries)

| function | code VA | |
|---|---|---|
| `IsTutorialItemEnabled` | `0x60b8b0` |  |
| `TutorialActivateHint` | `0x60ba70` |  |
| `TutorialSetBlink` | `0x60bc00` |  |
| `TutorialMessageBox` | `0x60bdb0` |  |
| `IsTutorialMessageBoxOpen` | `0x60bf40` |  |
| `IsTutorialEnabled` | `0x60c100` | ·undoc |

## Table 6 — file 0xc8f138 (12 entries)

| function | code VA | |
|---|---|---|
| `_ERRORMESSAGE` | `0xa3fb80` | ·undoc |
| `out` | `0xa388c0` | ·undoc |
| `Sleep` | `0xa2f340` | ·undoc |
| `StartThread` | `0xa2f200` | ·undoc |
| `random` | `0xa38b30` |  |
| `Ptr` | `0xa3fd50` | ·undoc |
| `ObjPtr` | `0xa3fe50` | ·undoc |
| `IsValid` | `0xa40000` | ·undoc |
| `IsEqual` | `0xa38c70` | ·undoc |
| `SetGlobalVar` | `0xa39120` | ·undoc |
| `GetGlobalVar` | `0xa38e40` | ·undoc |
| `LuaTest` | `0xa39300` | ·undoc |

## Table 7 — file 0xc8f1a0 (16 entries)

| function | code VA | |
|---|---|---|
| `sleep` | `0xa2f340` |  |
| `startThread` | `0xa2f200` |  |
| `errorHook` | `0xa2f3c0` | ·undoc |
| `isEqual` | `0xa38c70` | ·undoc |
| `_ERRORMESSAGE` | `0xa42f10` | ·undoc |
| `parse` | `0xa43070` | ·undoc |
| `print` | `0xa43f30` |  |
| `consoleCmd` | `0xa431a0` | ·undoc |
| `doFile` | `0xa432c0` | ·undoc |
| `mod` | `0xa43470` |  |
| `sqrt` | `0xa43660` |  |
| `floor` | `0xa43810` | ·undoc |
| `ceil` | `0xa43960` | ·undoc |
| `intg` | `0xa43ab0` | ·undoc |
| `frac` | `0xa43c30` | ·undoc |
| `round` | `0xa43dd0` | ·undoc |
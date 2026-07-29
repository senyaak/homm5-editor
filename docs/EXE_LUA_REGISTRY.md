# The executable's Lua registration tables

Read out of `bin/H5_Game_H5E.exe` on 2026-07-27. **Use an unwrapped binary**
— a Steam install ships `H5_Game.exe` with its `.text` encrypted (entropy
7.98, an extra `.bind` section) and it disassembles to nonsense. `npm run
unwrap-exe` produces the clean copy; GOG and retail builds need no such step.
Data sections are identical either way, so string and pointer addresses
transfer; only code needs the clean build.

Seven `{name pointer, function pointer}` arrays sit in `.data`. Together they
expose **306 functions to Lua** — against the 204 signatures the shipped
manuals admit to. Everything marked ·undoc is absent from those manuals.

## Signatures come from the binary

Every registered function opens by copying two strings onto the heap: an
argument format and its own name. The format is a compact grammar —
`s` string, `n` number, `b` bool, `f` float, `o` object, `t` table, and
`[default]` marking an optional argument. `GiveArtefact` carries `snn[0]`,
which is exactly the manual's `GiveArtefact(hero, id, [bindToHero = 0])`.
The parser at `0xa454d0` reads it and reports mismatches by function name.

So the tables below are not guesses: the argument list is what the engine
itself checks. Where the manual and the binary disagree, **the binary wins** —
see `HasArtefact`, which really takes a third argument
([ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md#knowing-what-the-hero-has)).

Function addresses belong to this build only. Patch by pattern, never by
address — the same rule the creature and artifact ceilings follow.

Regenerate with `node tools/reverse/lua-registry.ts`.

**Adding functions of our own** is four bytes, not a proxy DLL: each table is
reached through an accessor (`mov eax,<table>; ret`), so the extension hands the
engine a copy with its own rows appended. How, and what a registered function
has to look like, is in
[ENGINE_INTERNALS.md](ENGINE_INTERNALS.md#how-lua-functions-are-registered);
what ours do is in [SCRIPT_API.md](SCRIPT_API.md) under *Ours*.


## Table 1 — `0xc8c258` (99 entries)

| function | arguments | code | |
|---|---|---|---|
| `GetPlayerState` | `(number)` | `0x5ce840` | ·undoc |
| `GetPlayerHeroes` | `(number)` | `0x5cea30` |  |
| `GetPlayerResource` | `(number, number)` | `0x5ceed0` |  |
| `SetPlayerResource` | `(number, number, number, string = ?)` | `0x5cf130` |  |
| `SetPlayerStartResources` | `(number, number, number, number, number, number, number, number)` | `0x5cf4c0` |  |
| `HasBorderguardKey` | `(number, number)` | `0x5cf7c0` |  |
| `GiveBorderguardKey` | `(number, number)` | `0x5cfa20` | ·undoc |
| `DeployReserveHero` | `(string, number, number, number = 0, number = 0)` | `0x5cfcb0` |  |
| `UnreserveHero` | `(string)` | `0x5d0180` |  |
| `IsHeroAlive` | `(string)` | `0x5d04c0` |  |
| `GetHeroLevel` | `(string)` | `0x5d06e0` |  |
| `GetHeroStat` | `(string, number)` | `0x5d08d0` |  |
| `ChangeHeroStat` | `(string, number, number)` | `0x5d0b40` |  |
| `LevelUpHero` | `(string)` | `0x5d1200` |  |
| `HasHeroSkill` | `(string, number)` | `0x5d14d0` |  |
| `KnowHeroSpell` | `(string, number)` | `0x5d1da0` |  |
| `TeachHeroSpell` | `(string, number)` | `0x5d2010` |  |
| `GiveHeroSkill` | `(string, number)` | `0x5d1990` |  |
| `HasArtefact` | `(string, number, number = 0)` | `0x5d2300` |  |
| `GetHeroArtifactsCount` | `(string, number, number = 0)` | `0x5d2580` | ·undoc |
| `GiveArtefact` | `(string, number, number = 0)` | `0x5d2800` |  |
| `RemoveArtefact` | `(string, number)` | `0x5d2af0` |  |
| `GetHeroCreatures` | `(string, number)` | `0x5d3520` |  |
| `AddHeroCreatures` | `(string, number, number, number = -1)` | `0x5d3780` |  |
| `RemoveHeroCreatures` | `(string, number, number, number = -1)` | `0x5d3b00` |  |
| `IsHeroLootable` | `(string)` | `0x5d3090` |  |
| `SetHeroLootable` | `(string, bool)` | `0x5d32b0` |  |
| `HasHeroWarMachine` | `(string, number)` | `0x5d3e70` |  |
| `GiveHeroWarMachine` | `(string, number)` | `0x5d40c0` |  |
| `RemoveHeroWarMachine` | `(string, number)` | `0x5d4390` |  |
| `SetHeroCombatScript` | `(string, string)` | `0x5d4670` |  |
| `ResetHeroCombatScript` | `(string)` | `0x5d49b0` |  |
| `GetTownBuildingLevel` | `(string, number)` | `0x5d4c60` |  |
| `GetTownBuildingMaxLevel` | `(string, number)` | `0x5d4f20` |  |
| `GetTownBuildingLimitLevel` | `(string, number)` | `0x5d51e0` |  |
| `SetTownBuildingLimitLevel` | `(string, number, number, number = 0)` | `0x5d54a0` |  |
| `DestroyTownBuildingToLevel` | `(string, number, number, number = 1)` | `0x5d5840` |  |
| `IsObjectExists` | `(string)` | `0x5d5c40` |  |
| `CreateArtifact` | `(string, number, number, number, number)` | `0x5d5e40` | ·undoc |
| `CreateMonster` | `(string, number, number, number, number, number, number = 1, number = 2, number = 0, number = 0)` | `0x5d61a0` |  |
| `TransformTown` | `(string, number)` | `0x5d77b0` |  |
| `RazeTown` | `(string)` | `0x5d7e00` |  |
| `RazeBuilding` | `(string)` | `0x5d8220` |  |
| `RemoveObject` | `(string)` | `0x5d86b0` |  |
| `GetObjectPosition` | `(string)` | `0x5d8930` |  |
| `SetObjectPosition` | `(string, number, number, number = -1, number = -1)` | `0x5d8b90` |  |
| `GetObjectOwner` | `(string)` | `0x5d90e0` |  |
| `SetObjectOwner` | `(string, number)` | `0x5d9340` |  |
| `IsObjectInRegion` | `(string, string)` | `0x5d9750` |  |
| `GetObjectsInRegion` | `(string, number)` | `0x5d99f0` |  |
| `IsObjectVisible` | `(number, string)` | `0x5d9d50` |  |
| `GetObjectCreatures` | `(string, number)` | `0x5da010` | ·undoc |
| `AddObjectCreatures` | `(string, number, number, number = -1)` | `0x5daa50` |  |
| `SetObjectDwellingCreatures` | `(string, number, number)` | `0x5dae70` | ·undoc |
| `GetObjectDwellingCreatures` | `(string, number)` | `0x5db150` | ·undoc |
| `RemoveObjectCreatures` | `(string, number, number, number = -1)` | `0x5db3c0` |  |
| `IsObjectEnabled` | `(string)` | `0x5db880` |  |
| `SetObjectEnabled` | `(string, bool)` | `0x5dbad0` |  |
| `MarkObjectAsVisited` | `(string, string)` | `0x5dbde0` |  |
| `SetMonsterSelectionType` | `(string, number)` | `0x5dc210` |  |
| `CanMoveHero` | `(string, number, number, number = -1)` | `0x5dc520` |  |
| `CalcHeroMoveCost` | `(string, number, number, number = -1)` | `0x5dc880` |  |
| `MoveHero` | `(string, number, number, number = -1)` | `0x5dce20` |  |
| `MoveHeroRealTime` | `(string, number, number, number = -1)` | `0x5dd210` |  |
| `StartCombat` | `(string)` | `0x5dd9b0` |  |
| `SiegeTown` | `(string, string, string = ?)` | `0x5de450` |  |
| `GenerateMonsters` | `(number, number, number, number, number)` | `0x5deb40` |  |
| `RemoveAllMonsters` | `(number)` | `0x5dee30` | ·undoc |
| `CalcAverageMonstersTier` | `(number = -1)` | `0x5df060` | ·undoc |
| `GetStandStatesCount` | `(string)` | `0x5df3f0` | ·undoc |
| `GetStandState` | `(string)` | `0x5df610` | ·undoc |
| `SetStandState` | `(string, number)` | `0x5df830` | ·undoc |
| `GetTownHero` | `(string)` | `0x5dfb50` |  |
| `GetHeroTown` | `(string)` | `0x5dfd80` | ·undoc |
| `GetObjectsFromPath` | `(string, number, number, number = -1)` | `0x5dffd0` | ·undoc |
| `SetPlayerHeroesCountNotForHire` | `(number, number)` | `0x5e0540` | ·undoc |
| `GetHeroSkillMastery` | `(string, number)` | `0x5d1730` |  |
| `SetObjectRotation` | `(string, number)` | `0x5d8e50` |  |
| `CreateTreasure` | `(string, number, number, number, number, number, number = 0)` | `0x5e07b0` | ·undoc |
| `CreateStatic` | `(string, string, number, number, number, number = 0, number = -1, number = 100)` | `0x5e0c50` | ·undoc |
| `CreateDwelling` | `(string, number, number, number, number, number, number, number = 0)` | `0x5d6dd0` |  |
| `ReplaceDwelling` | `(string, number, number = 0, number = 0, number = 0, number = 0)` | `0x5e10c0` |  |
| `GetArtifactSetItemsCount` | `(string, number, number = 1)` | `0x5d2df0` |  |
| `SetMonsterNames` | `(string, number, string)` | `0x5d6860` |  |
| `IsHeroInTown` | `(string, string, number = 1, number = 1)` | `0x5d7500` |  |
| `SetMonsterCourageAndMood` | `(string, number, number, number)` | `0x5d6b00` |  |
| `GetObjectCreaturesTypes` | `(string)` | `0x5da290` |  |
| `GetHeroCreaturesTypes` | `(string)` | `0x5da670` |  |
| `DenyGarrisonCreaturesTakeAway` | `(string, number)` | `0x5e1430` |  |
| `MakeHeroInteractWithObject` | `(string, string)` | `0x5e16b0` |  |
| `ControlHeroCustomAbility` | `(string, number, number)` | `0x5e1a10` |  |
| `GetPlayerSelectedCampaignBonusIndex` | `(number)` | `0x5e1cd0` |  |
| `SetHeroBiography` | `(string, string)` | `0x5e1ee0` |  |
| `GetCurrentMoonWeek` | `?` | `0x5e2180` |  |
| `GetPlayerRace` | `(number)` | `0x5e2350` | ·undoc |
| `IsAIPlayer` | `(number)` | `0x5e25a0` | ·undoc |
| `GetObjectArmySlotCreature` | `(string, number)` | `0x5e2800` | ·undoc |
| `GetPlayerTeam` | `(number)` | `0x5e2aa0` | ·undoc |
| `GetPlayerNecroEnergy` | `(number)` | `0x5e2ce0` | ·undoc |

## Table 2 — `0xc8c608` (113 entries)

| function | arguments | code | |
|---|---|---|---|
| `GetMaxFloor` | `?` | `0x5f6ad0` | ·undoc |
| `ExitGame` | `?` | `0x5f69c0` | ·undoc |
| `Win` | `(number = -1)` | `0x5eba40` |  |
| `Loose` | `(number = -1)` | `0x5ebff0` |  |
| `GetDate` | `(number = 0)` | `0x5ec2a0` |  |
| `GetCurrentPlayer` | `?` | `0x5ec510` |  |
| `GetAllNames` | `(number)` | `0x5ed070` |  |
| `IsObjectiveVisible` | `(string, number = 1)` | `0x5ed370` |  |
| `SetObjectiveVisible` | `(string, bool, number = 1)` | `0x5ed600` |  |
| `GetObjectiveState` | `(string, number = 1)` | `0x5ed900` |  |
| `SetObjectiveState` | `(string, number, number = 1)` | `0x5edb80` |  |
| `GetObjectiveProgress` | `(string, number = 1)` | `0x5ee000` |  |
| `SetObjectiveProgress` | `(string, number, number = 1)` | `0x5ee290` |  |
| `RegionToPoint` | `(string)` | `0x5ee600` |  |
| `IsRegionBlocked` | `(string, number)` | `0x5ee860` |  |
| `SetRegionBlocked` | `(string, bool, number = -1)` | `0x5eeb20` |  |
| `OpenRegionFog` | `(number, string)` | `0x5eef20` |  |
| `OpenCircleFog` | `(number, number, number, number, number)` | `0x5ef380` |  |
| `SetAmbientLight` | `?` | `0x5efc80` |  |
| `SetObjectFlashlight` | `(string, string = ?)` | `0x5f0120` |  |
| `MessageBoxInt` | `?` | `0x5f04e0` | ·undoc |
| `QuestionBoxInt` | `?` | `0x5f0760` | ·undoc |
| `MessageBox` | `?` | `0x5f04e0` |  |
| `QuestionBox` | `?` | `0x5f0760` |  |
| `ShowFlyingSign` | `?` | `0x5f1630` |  |
| `Play2DSound` | `(string, number = 0)` | `0x5f1b00` |  |
| `Play3DSound` | `(string, number, number, number)` | `0x5f1d30` |  |
| `SetTrigger` | `?` | `0x5f2640` | ·undoc |
| `Trigger` | `?` | `0x5f2640` |  |
| `StopTrigger` | `?` | `0x5f2fe0` | ·undoc |
| `StartDialogSceneInt` | `(string, string = ?, string = ?)` | `0x5f3160` | ·undoc |
| `StartCutSceneInt` | `(string, string = ?, string = ?)` | `0x5f33f0` | ·undoc |
| `StartDialogScene` | `(string, string = ?, string = ?)` | `0x5f3160` |  |
| `StartCutScene` | `(string, string = ?, string = ?)` | `0x5f33f0` | ·undoc |
| `GetGameVar` | `(string)` | `0x5f3c00` |  |
| `SetGameVar` | `(string, string)` | `0x5f3e10` |  |
| `BlockGame` | `(number = 0)` | `0x5f4000` |  |
| `UnblockGame` | `(number = 0)` | `0x5f41a0` |  |
| `MoveCamera` | `?` | `0x5f4340` |  |
| `DisableCameraFollowHeroes` | `(number, number = 0, number = 0)` | `0x5f48f0` | ·undoc |
| `random` | `(number)` | `0x5f4f00` |  |
| `SetWarfogBehaviour` | `(number, number, number = -1)` | `0x5f4c80` |  |
| `EnableHeroAI` | `(string, bool)` | `0x5ef6a0` |  |
| `SetAIHeroAttractor` | `(string, string, number)` | `0x5f50e0` |  |
| `SetAIPlayerAttractor` | `(string, number, number)` | `0x5f53c0` |  |
| `EnableAIHeroHiring` | `(number, string, bool)` | `0x5ef950` |  |
| `SetCombatAmbientLight` | `(string)` | `0x5f56d0` | ·undoc |
| `GetTerrainSize` | `?` | `0x5f64d0` | ·undoc |
| `IsTilePassable` | `(number, number, number = 0)` | `0x5f66e0` | ·undoc |
| `GetGuardsTier` | `(string)` | `0x5f6120` | ·undoc |
| `GetObjectNamesByType` | `(string)` | `0x5f59a0` | ·undoc |
| `PlayVisualEffect` | `?` | `0x5f6ca0` |  |
| `StopVisualEffects` | `(string = ?)` | `0x5f7200` |  |
| `PlayObjectAnimation` | `(string, string, number)` | `0x5f7440` |  |
| `SetPlayerTeam` | `(number, number)` | `0x5f7720` |  |
| `DenyAIHeroFlee` | `(string, number, string = ?)` | `0x5f79d0` |  |
| `DenyAIHeroesFlee` | `(number, number, string = ?)` | `0x5f7ed0` |  |
| `SetAIHeroFleeControl` | `(string, number)` | `0x5f7c60` |  |
| `OpenPuzzleMap` | `(number, number)` | `0x5f8160` |  |
| `SetHeroesExpCoef` | `(number)` | `0x5f83d0` |  |
| `StartAdvMapDialog` | `(number, string = ?)` | `0x5f8630` |  |
| `OverrideAdvMapDialogPos` | `(number, number, number = 0, number = 0, number = 0)` | `0x5f8830` | ·undoc |
| `CreateCaravan` | `(string, number, number, number, number, number, number, number)` | `0x5f8a70` |  |
| `IsHeroInBoat` | `(string)` | `0x5f8d50` |  |
| `SinkHero` | `(string)` | `0x5f8fc0` |  |
| `BlockTownGarrisonForAI` | `(string, number)` | `0x5f92a0` |  |
| `AllowHeroHiringByRaceForAI` | `(number, number, number)` | `0x5f9560` |  |
| `AllowHiringOfHeroForAI` | `(number, string, number)` | `0x5f9800` |  |
| `AllowHeroHiringByRaceInTown` | `(string, number, number)` | `0x5f9a90` |  |
| `AllowHiringOfHeroInTown` | `(string, string, number)` | `0x5f9d40` |  |
| `AllowPlayerTavernRace` | `(number, number, number)` | `0x5f9fd0` |  |
| `AllowPlayerTavernHero` | `(number, string, number)` | `0x5fa280` |  |
| `MakeHeroReturnToTavernAfterDeath` | `(string, number, number = 0)` | `0x5fa7a0` |  |
| `AllowOpenFogOfWarForAlly` | `(number, number, number)` | `0x5faa00` |  |
| `MakeHeroNecromancer` | `(string, number)` | `0x5fa510` |  |
| `SetDisabledObjectMode` | `(string, number)` | `0x5faca0` |  |
| `MakeTownMovable` | `(string)` | `0x5faf50` |  |
| `TakeAwayHeroExp` | `(string, number)` | `0x5fb1f0` |  |
| `GetLastSavedCombatIndex` | `?` | `0x5fb460` | ·undoc |
| `GetSavedCombatResult` | `(number)` | `0x5fb630` |  |
| `GetSavedCombatArmyPlayer` | `(number, number)` | `0x5fb810` |  |
| `GetSavedCombatArmyHero` | `(number, number)` | `0x5fba30` |  |
| `GetSavedCombatArmyCreaturesCount` | `(number, number)` | `0x5fbc90` |  |
| `GetSavedCombatArmyCreatureInfo` | `(number, number, number)` | `0x5fbec0` |  |
| `DisableAutoEnterTown` | `(string, number)` | `0x5fc180` |  |
| `SetRegionAutoObjectEnable` | `(string, number, number, number, string, string, number)` | `0x5fc440` |  |
| `LockMinHeroSkillsAndAttributes` | `(string)` | `0x5fc820` |  |
| `SetHeroRoleMode` | `(string, number)` | `0x5fca70` |  |
| `OverrideObjectTooltipNameAndDescription` | `(string, string, string)` | `0x5fcd00` |  |
| `DoNotGiveTurnToPlayerAIIfNoTownsAndActiveHeroes` | `(number, number)` | `0x5fd000` |  |
| `UpgradeTownBuilding` | `(string, number)` | `0x5fd2b0` | ·undoc |
| `SetAmbientLightForPlayers` | `?` | `0x5efed0` | ·undoc |
| `MessageBoxForPlayers` | `?` | `0x5f0a20` | ·undoc |
| `QuestionBoxForPlayers` | `?` | `0x5f0ce0` | ·undoc |
| `Play2DSoundForPlayers` | `(number, string, number = 0)` | `0x5f2090` | ·undoc |
| `Play3DSoundForPlayers` | `(number, string, number, number, number)` | `0x5f22d0` | ·undoc |
| `StartDialogSceneForPlayers` | `(number, string, string = ?, string = ?)` | `0x5f36a0` | ·undoc |
| `StartCutSceneForPlayers` | `(number, string, string = ?, string = ?)` | `0x5f3940` | ·undoc |
| `MoveCameraForPlayers` | `?` | `0x5f4610` | ·undoc |
| `DisableCameraFollowHeroesForPlayers` | `(number, number = 0, number = 0, number = 0)` | `0x5f4ab0` | ·undoc |
| `WinTeam` | `(number)` | `0x5ebd40` | ·undoc |
| `IsPlayerCurrent` | `(number)` | `0x5ec720` | ·undoc |
| `IsPlayerInGhostMode` | `(number)` | `0x5ec960` | ·undoc |
| `IsPlayerWaitingForTurn` | `(number)` | `0x5ecba0` | ·undoc |
| `IsTeamCurrent` | `(number)` | `0x5ecde0` | ·undoc |
| `IsPlayerLost` | `(number)` | `0x5fd670` | ·undoc |
| `CanShowToPlayer` | `(number)` | `0x5fd8e0` | ·undoc |
| `GetTurnTimeLeft` | `(number)` | `0x5fdb70` | ·undoc |
| `WarpToMap` | `(string, number = -1)` | `0x5fddf0` | ·undoc |
| `WarpHeroExp` | `(string, number)` | `0x5fdfb0` | ·undoc |
| `GiveHeroBattleBonus` | `(string, number, number)` | `0x5fe280` | ·undoc |
| `GetTownRace` | `(string)` | `0x5fe540` | ·undoc |
| `TalkBoxForPlayers` | `?` | `0x5f0fe0` | ·undoc |

## Table 3 — `0xc8c9b0` (53 entries)

| function | arguments | code | |
|---|---|---|---|
| `EnableDynamicBattleMode` | `(bool)` | `0x6014b0` | ·undoc |
| `SetControlMode` | `(number, number)` | `0x601700` |  |
| `GetHost` | `(number)` | `0x601980` | ·undoc |
| `EnableAutoFinish` | `(bool)` | `0x601bb0` |  |
| `combatEnableFinish` | `(bool)` | `0x601bb0` | ·undoc |
| `Finish` | `(number)` | `0x601de0` |  |
| `Break` | `?` | `0x6020a0` | ·undoc |
| `GetUnitSide` | `(string)` | `0x602230` | ·undoc |
| `GetUnitType` | `(string)` | `0x602480` | ·undoc |
| `GetUnits` | `(number, number)` | `0x602760` | ·undoc |
| `GetUnitPosition` | `(string)` | `0x602c10` |  |
| `pos` | `(string)` | `0x602c10` | ·undoc |
| `GetHeroName` | `(string)` | `0x602e40` |  |
| `GetCreatureType` | `(string)` | `0x603050` |  |
| `GetCreatureNumber` | `(string)` | `0x603260` |  |
| `GetWarMachineType` | `(string)` | `0x603490` |  |
| `GetBuildingType` | `(string)` | `0x6036a0` |  |
| `AddCreature` | `?` | `0x6038b0` |  |
| `SummonCreature` | `?` | `0x603c30` | ·undoc |
| `GetUnitManaPoints` | `(string)` | `0x603fb0` | ·undoc |
| `GetUnitMaxManaPoints` | `(string)` | `0x6041c0` | ·undoc |
| `SetUnitManaPoints` | `(string, number)` | `0x6043d0` | ·undoc |
| `UnitCastGlobalSpell` | `(string, number)` | `0x604650` | ·undoc |
| `UnitCastAreaSpell` | `(string, number, number, number)` | `0x604870` | ·undoc |
| `UnitCastAimedSpell` | `(string, number, string)` | `0x604ab0` | ·undoc |
| `postEvent` | `(string, number = -1, number = -1)` | `0x604d10` | ·undoc |
| `GetGameVar` | `(string)` | `0x604e40` |  |
| `SetGameVar` | `(string, string)` | `0x605090` |  |
| `showHighlighting` | `(object, float, float)` | `0x6052b0` | ·undoc |
| `addUnit` | `(number, number, number, number, number, string)` | `0x605440` | ·undoc |
| `exist` | `(string)` | `0x6058c0` | ·undoc |
| `unitNames` | `?` | `0x605a90` | ·undoc |
| `removeUnit` | `(string)` | `0x605cf0` | ·undoc |
| `RemoveAllUnits` | `?` | `0x605f50` | ·undoc |
| `displace` | `(string, number, number)` | `0x606250` | ·undoc |
| `commandDefend` | `?` | `0x606510` | ·undoc |
| `commandMove` | `?` | `0x606700` | ·undoc |
| `commandMoveAttack` | `?` | `0x606a90` | ·undoc |
| `commandShot` | `?` | `0x606de0` | ·undoc |
| `commandDoSpecial` | `?` | `0x607090` | ·undoc |
| `commandDoSpell` | `?` | `0x607420` | ·undoc |
| `combatStarted` | `?` | `0x6077c0` | ·undoc |
| `combatReadyPerson` | `?` | `0x607980` | ·undoc |
| `setATB` | `(string, number)` | `0x607b80` | ·undoc |
| `combatSetPause` | `(bool)` | `0x608040` | ·undoc |
| `combatPlayEmotion` | `(number, bool)` | `0x608270` | ·undoc |
| `playAnimation` | `(string, string, number = 3)` | `0x607dd0` | ·undoc |
| `GetRagePoints` | `(string)` | `0x609340` | ·undoc |
| `GetRageLevel` | `(string)` | `0x6095d0` | ·undoc |
| `MessageBox` | `?` | `0x609880` |  |
| `ShowFlyingSign` | `?` | `0x609ab0` |  |
| `Play2DSound` | `(string)` | `0x609eb0` |  |
| `Play3DSound` | `(string, number, number)` | `0x60a0a0` |  |

## Table 4 — `0xc8cb60` (7 entries)

| function | arguments | code | |
|---|---|---|---|
| `toggleTutorialMode` | `?` | `0x6084d0` | ·undoc |
| `showMessage` | `(string)` | `0x608670` | ·undoc |
| `clearMessage` | `?` | `0x608830` | ·undoc |
| `changeSubject` | `(number)` | `0x6089b0` | ·undoc |
| `subject` | `?` | `0x608ba0` | ·undoc |
| `shots` | `?` | `0x608d50` | ·undoc |
| `shotsNumber` | `(bool)` | `0x608fd0` | ·undoc |

## Table 5 — `0xc8cbe0` (6 entries)

| function | arguments | code | |
|---|---|---|---|
| `IsTutorialItemEnabled` | `(string)` | `0x60b8b0` |  |
| `TutorialActivateHint` | `(string)` | `0x60ba70` |  |
| `TutorialSetBlink` | `(string, number)` | `0x60bc00` |  |
| `TutorialMessageBox` | `(string)` | `0x60bdb0` |  |
| `IsTutorialMessageBoxOpen` | `?` | `0x60bf40` |  |
| `IsTutorialEnabled` | `?` | `0x60c100` | ·undoc |

## Table 6 — `0xc8f138` (12 entries)

| function | arguments | code | |
|---|---|---|---|
| `_ERRORMESSAGE` | `?` | `0xa3fb80` | ·undoc |
| `out` | `?` | `0xa388c0` | ·undoc |
| `Sleep` | `?` | `0xa2f340` | ·undoc |
| `StartThread` | `?` | `0xa2f200` | ·undoc |
| `random` | `?` | `0xa38b30` |  |
| `Ptr` | `?` | `0xa3fd50` | ·undoc |
| `ObjPtr` | `?` | `0xa3fe50` | ·undoc |
| `IsValid` | `?` | `0xa40000` | ·undoc |
| `IsEqual` | `?` | `0xa38c70` | ·undoc |
| `SetGlobalVar` | `(string, string)` | `0xa39120` | ·undoc |
| `GetGlobalVar` | `(string, string = ?)` | `0xa38e40` | ·undoc |
| `LuaTest` | `?` | `0xa39300` | ·undoc |

## Table 7 — `0xc8f1a0` (16 entries)

| function | arguments | code | |
|---|---|---|---|
| `sleep` | `?` | `0xa2f340` |  |
| `startThread` | `?` | `0xa2f200` |  |
| `errorHook` | `?` | `0xa2f3c0` | ·undoc |
| `isEqual` | `?` | `0xa38c70` | ·undoc |
| `_ERRORMESSAGE` | `(string)` | `0xa42f10` | ·undoc |
| `parse` | `(string)` | `0xa43070` | ·undoc |
| `print` | `?` | `0xa43f30` |  |
| `consoleCmd` | `(string)` | `0xa431a0` | ·undoc |
| `doFile` | `(string)` | `0xa432c0` | ·undoc |
| `mod` | `(number, number)` | `0xa43470` |  |
| `sqrt` | `(number)` | `0xa43660` |  |
| `floor` | `(number)` | `0xa43810` | ·undoc |
| `ceil` | `(number)` | `0xa43960` | ·undoc |
| `intg` | `(number)` | `0xa43ab0` | ·undoc |
| `frac` | `(number)` | `0xa43c30` | ·undoc |
| `round` | `(number)` | `0xa43dd0` | ·undoc |

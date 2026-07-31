# Adventure-map buildings

Everything here was read out of the game's own files — `data-unpacked/types.xml`,
`MapObjects/**`, `GameMechanics/**`, `Text/Game/**` and the 117 shipped maps.
Anything not verified that way is marked `[~]`.

> **Two things are called a building.** This document is about the **adventure
> map**: the mine, the dwelling, the Witch Hut, the Sphinx — objects a hero
> walks up to. The other kind is the **town building** (`TownBuildingSharedStats`,
> the `TB_*` enum, 31–39 records per faction under
> `GameMechanics/TownBuildingSharedStats/<Race>/`); it shares nothing with this
> one but the word, and is not covered here.

## 1. The behaviour is the type, and the type is in the executable

`types.xml` declares the enum `BuildingType` with **128 values**, `BUILDING_ABANDONED_MINE = 0`
through `BUILDING_NAGA_TEMPLE = 127`. A value means "what happens when a hero
steps on it" — refill mana, teach a skill, hand over the mine, open a riddle —
and that code lives in `H5_Game.exe`. **No data file defines a behaviour, so a
mod cannot add a 129th.** Data only *chooses* one.

The counterpart is that a value may be chosen freely and more than once. Fourteen
documents declare `BUILDING_ABANDONED_MINE` — the seven random dwellings and a
handful of scenery pieces (`Inferno_Town_Ruines`) among them — because they need
*something* in the field and nothing about the value is owned. This is the same
rule dwellings already rely on ([src/mods/dwellings.ts](../../../src/mods/dwellings.ts)).

## 2. Two ways a document is bound to a behaviour

The class of a document is its **root element**, not its file name: the addon
ships `MapObjects/H5A2/SpellShop.xdb` whose root is `<AdvMapBuildingShared>`.
Scanning by file name misses eight of the addon's objects.

Either the class carries a `<Type>` field and *that* selects the behaviour, or
the class **is** the behaviour and there is no `<Type>` at all. Nothing else.

**And the two do not substitute for each other.** A plain `AdvMapBuildingShared`
declaring `BUILDING_PRISON` — a value whose own class exists — stands on the map,
shows the name and description its `messagesFileRef` gives it, and on a visit
answers *"Вы прикасаетесь к неизвестному действующему объекту"*: the generic
class's fallback for a Type it has no code for. So for the seven class-covered
values the CLASS is the behaviour, and `<Type>` on a generic document only names
it. Measured 2026-07-31 in the game (`tools/probe-buildings.ts`).

**The Type is what runs, not the model or the texts.** The control for that
measurement is a third document with the same class, the same model and the same
message files as the Naga Temple probe below, differing only in carrying
`BUILDING_ABANDONED_MINE` — and it gives the same "unknown object". Which also
settles section 1's "no opinion" reading from the other side: value 0 on the
plain class really is nothing, which is why fourteen documents can spend it on
ruins and random dwellings without owning anything.

| class | docs | `<Type>` | types seen | extra definition fields |
|---|---|---|---|---|
| `AdvMapBuildingShared` | 118 | yes | 77 | — |
| `AdvMapDwellingShared` | 46 | yes | 36 | `creatures`, `guards`, `RandomType` |
| `AdvMapMineShared` | 27 | yes | 8 | — |
| `AdvMapTentShared` | 16 | yes | 2 | `Color` |
| `AdvMapGarrisonShared` | 10 | yes | 3 | — |
| `AdvMapHillFortShared` | 2 | yes | 1 | — |
| `AdvMapCartographerShared` | 2 | yes | 1 | — |
| `AdvMapShrineShared` | 4 | no | — | `Level`, `RunicMagic`, `MaxRunicMagicLevel` |
| `AdvMapAbanMineShared` | 1 | no | — | `GuardsVariants` |
| `AdvMapDwarvenWarrenShared` | 2 | no | — | — |
| `AdvMapPrisonShared` | 1 | no | — | — |
| `AdvMapSeerHutShared` | 1 | no | — | — |
| `AdvMapSphinxShared` | 1 | no | — | — |
| `AdvMapShipyardShared` | 1 | no | — | — |
| `AdvMapSignShared` | 1 | no | — | — |
| `AdvMapStandShared` | 1 | no | — | `States`, `StateChanges` |

Everything else in a definition is the same `AdvMapObjectBase` set every placed
object has: `Model`, `AnimSet`, `blockedTiles` / `holeTiles` / `activeTiles` /
`passableTiles`, `PossessionMarkerTile`, `Effect` / `EffectWhenOwned`,
`messagesFileRef`, `SoundEffect`, `flybyMessageFileRef`, `ObjectTypeFileRef`,
`WaterBased`, `ApplyHeroTrace`, `TerrainAligned`, `FlyPassable`, `RazedStatic`,
`Icon128`.

`ObjectRecordID` on the root element is **optional** — 71 of the 234 building
definitions ship without it, including every addon object.

## 3. Where a parameter can live — three levels, not one

**(a) The definition** (`*Shared`, one document, shared by every placement).
Model, footprint, message files, icon — plus whatever the class adds:
`creatures` / `guards` / `RandomType` for a dwelling, `Level` and the runic pair
for a shrine, `GuardsVariants` for an abandoned mine, `Color` for a tent,
`States` / `StateChanges` for a stand.

**(b) The placement** (the `<AdvMapX>` element in `map.xdb`, per instance).
From [src/schema/objects.schema.json](../../../src/schema/objects.schema.json):

| placed type | fields beyond the common ones |
|---|---|
| `AdvMapBuilding` | `PlayerID`, `GroupID`, `CaptureTrigger`, `showCameras` |
| `AdvMapMine` | `PlayerID`, `armySlots`, `CaptureTrigger`, `CreatureSwapBlockedForAI` |
| `AdvMapDwelling` | `PlayerID`, `RandomCreatures`, `creaturesEnabled`, `RndSource`, `LinkToPlayer`, `LinkToTown`, `CaptureTrigger` |
| `AdvMapGarrison` | `PlayerID`, `TownType`, `armySlots`, `CollectableArmy`, `AllowQuickCombat`, `CaptureTrigger` |
| `AdvMapDwarvenWarren` | `PlayerID`, `armySlots`, `CaptureTrigger`, `CreatureSwapBlockedForAI` |
| `AdvMapAbanMine` | `AvailableResources`, `CaptureTrigger` |
| `AdvMapCartographer` | `Cost`, `CaptureTrigger` |
| `AdvMapShrine` | `SpellID` |
| `AdvMapPrison` | `PrisonedHero`, `RandomHero` |
| `AdvMapSeerHut` | `Quest` |
| `AdvMapSphinx` | `Riddle`, `RandomRiddle` |
| `AdvMapSign` | `MessageFileRef` |
| `AdvMapShipyard` | `ShipTile` |
| `AdvMapHillFort` | `CreaturesUpgradesFilter` |
| `AdvMapTent`, `AdvMapStand` | none |

**(c) Global tables**, one setting for every instance in the game:

- `GameMechanics/RPGStats/DefaultStats.xdb` → `RaiseAttributesBuildings`: which
  attribute and how much for `BUILDING_MERCENARY_CAMP`, `_STAR_AXIS`,
  `_GARDEN_OF_REVELATION`, `_MARLETTO_TOWER`.
- the same file → `SelectAttributeBuildings`: both branches of
  `BUILDING_ARENA` and `BUILDING_SCHOOL_OF_MAGIC`, each with value, icon,
  text and tooltip.
- `GameMechanics/SphinxRiddles/**` — the riddle pool.

**Everything else is in the executable.** Notably a bank's garrison: the
generic class has no `guards` field, so how many dragons wait inside a Dragon
Utopia is not data. Neither is the amount a Windmill pays, or the experience a
Learning Stone grants.

That is the honest shape of "presets with and without parameters": it is not a
property of the *type* but of the *class*. All 77 types on the plain
`AdvMapBuildingShared` are equally parameterless — Shipyard, Memory Mentor,
Magic Well and Library of Enlightenment differ by one enum value and nothing
else.

Scripting is not a third kind. `CaptureTrigger` sits on eight of the placed
types and Lua addresses any object by its `<Name>`, so a trigger is a layer over
whatever the object already is, available to parameterless and parameterised
alike.

## 4. Ownership

There is a capturable/visit-only split, but **it cannot be derived from data**:

- every `AdvMapBuilding` placement has a `PlayerID` field, and across the 117
  shipped maps **524 of 3010** buildings carry a non-`PLAYER_NONE` value —
  obelisks and monoliths included. Map authors set it on things that are not
  capturable at all;
- what the data *does* show is a capture string, and only for: the seven mines
  and the Dwarven Warren (`Text/Game/Mines/*/FLYOFF_Captured.txt`), and the
  Lighthouse (`Text/Game/Buildings/Lighthouse/Capture.txt`, the only generic
  building with one);
- dwellings are plainly capturable — every dwelling's first-visit line says so
  — yet only Kennels and Imp Crucible carry an `*Owned` effect, so the effect is
  decoration, not the marker.

So the capturable set the editor needs is a **curated list**, not a derived one.
Verified members: towns, the seven mines, the abandoned mine, the Dwarven
Warren, all dwellings, garrisons and outposts, and the Lighthouse.

## 5. The registry

`docs` counts every definition in `data-unpacked/MapObjects` declaring that
value. "Shown name" is the first message file of the first document that has
one — where several objects share a value it may name a sibling rather than the
example (`BUILDING_ABANDONED_MINE` shows a ruin, `BUILDING_CYCLOPS_STOCKPILE`
shows the Elemental variant, because `Cyclops_Stockpile.xdb` itself carries no
messages and stands on no shipped map).

| id | `BUILDING_*` | class | docs | what it does |
|---|---|---|---|---|
| 0 | ABANDONED_MINE | Building + Mine + Dwelling | 14 | the "no opinion" value — used by ruins, snow variants and every random dwelling |
| 1 | ALCHEMIST_LAB | Mine | 4 | +1 mercury a day |
| 2 | CRYSTAL_CAVERN | Mine | 3 | +1 crystal a day |
| 3 | GEM_POND | Mine | 4 | +1 gems a day |
| 4 | GOLD_MINE | Mine | 4 | +1000 gold a day |
| 5 | ORE_PIT | Mine | 4 | +2 ore a day |
| 6 | SAWMILL | Mine | 4 | +2 wood a day |
| 7 | SULFUR_DUNE | Mine | 3 | +1 sulfur a day |
| 8 | WATER_WHEEL | Building | 2 | a little gold, once a week |
| 9 | WINDMILL | Building | 2 | a few random resources, once a week |
| 10 | LEAN_TO | Building | 1 | a small pile of resources |
| 11 | TRADING_POST | Building | 1 | buy and sell resources |
| 12 | BLACK_MARKET | Building | 2 | buy artifacts |
| 13 | WAGON | Building | 1 | resources, or a random artifact |
| 14 | SKELETON | Building | 1 | may hold an artifact |
| 15 | STABLES | Building | 2 | extra movement for the rest of the week |
| 16 | RALLY_FLAG | Building | 1 | +luck, +morale, +movement for the next battle |
| 17 | OASIS | Building | 1 | +morale and +movement |
| 18 | LAKE_OF_SCARLET_SWAN | Building | 2 | +luck, but spends all remaining movement |
| 19 | FONTAIN_OF_FORTUNE | Building | 1 | changes luck for the next battle |
| 20 | MAGIC_SPRING | Building | 1 | doubles maximum mana, once a week |
| 21 | FONTAIN_OF_YOUTH | Building | 2 | +morale and +movement |
| 22 | FAERIE_RING | Building | 1 | +luck for the next battle |
| 23 | IDOL_OF_FORTUNE | Building | 1 | +luck or +morale, sometimes both |
| 24 | TEMPLE | Building | 1 | +morale for the next battle |
| 25 | SANCTUARY | Building | 1 | shelter: the hero cannot be attacked here |
| 26 | LIGHTHOUSE | Building | 1 | **owned**: +sea movement for all of the owner's heroes |
| 27 | HILL_FORT | Building + HillFort | 4 | upgrade creatures in the hero's army |
| 28 | MAGIC_WELL | Building | 1 | refills mana |
| 29 | SIGN | — (`AdvMapSignShared`) | 0 | a signpost with a custom message |
| 30 | SHIPYARD | — (`AdvMapShipyardShared`) | 0 | builds ships |
| 31 | SEER_HUT | — (`AdvMapSeerHutShared`) | 0 | quest giver: reward for a task |
| 32 | REDWOORD_OBSERVATORY | Building | 2 | reveals the surrounding map |
| 33 | HUT_OF_MAGI | Building | 2 | reveals the area around every Eye of the Magi |
| 34 | EYE_OF_MAGI | Building | 6 | the viewpoint the Hut reveals |
| 35 | PRISON | — (`AdvMapPrisonShared`) | 0 | releases a captive hero into your service |
| 36 | BORDER_GUARD | Tent | 8 | blocks the road unless you hold the matching key; `Color` picks which |
| 37 | KEYMASTER_TENT | Tent | 8 | grants the key of its `Color` |
| 38 | DEN_OF_THIEVES | Building | 1 | intelligence on the other players |
| 39 | SUBTERRA_GATE | Building | 2 | to and from the underground floor |
| 40 | MONOLITH_ONE_WAY_EXIT | Building | 1 | destination of a one-way portal |
| 41 | MONOLITH_ONE_WAY_ENTRANCE | Building | 1 | one-way portal |
| 42 | MONOLITH_TWO_WAY | Building | 1 | two-way portal |
| 43 | GARRISON | Garrison | 7 | an army that blocks the road |
| 44 | GARRISON_ANTIMAGIC | Garrison | 2 | the same, with magic suppressed |
| 45 | CRYPT | Building | 1 | bank: beat the guard, loot the graves |
| 46 | CYCLOPS_STOCKPILE | Building | 3 | bank (the shipped art is the Elemental Stockpile) |
| 47 | NAGA_BANK | Building | 2 | bank (shipped as the Magi Vault) |
| 48 | PYRAMID | Building | 1 | bank guarding spells |
| 49 | DRAGON_UTOPIA | Building | 2 | bank: dragons, and the biggest hoard |
| 50 | STAR_AXIS | Building | 1 | +1 spellpower, once *(value in `DefaultStats.xdb`)* |
| 51 | GARDEN_OF_REVELATION | Building | 1 | +1 knowledge, once *(value in `DefaultStats.xdb`; shipped art is the Crystal of Revelation)* |
| 52 | MARLETTO_TOWER | Building | 1 | +1 defence, once *(value in `DefaultStats.xdb`)* |
| 53 | MERCENARY_CAMP | Building | 2 | +1 attack, once *(value in `DefaultStats.xdb`)* |
| 54 | LEARNING_STONE | Building | 1 | +1000 experience, once |
| 55 | WITCH_HUT | Building | 1 | teaches or upgrades a skill |
| 56 | SHRINE_OF_MAGIC | — (`AdvMapShrineShared`) | 0 | teaches a spell; `Level` bounds the circle, placement picks `SpellID` |
| 57 | OBELISK | Building | 1 | one piece of the Tear of Asha map |
| 58 | CARTOGRAPHER | Cartographer | 2 | sells map knowledge for `Cost` (land and water variants) |
| 59 | TREE_OF_KNOWLEDGE | Building | 1 | a level, for a fee or free |
| 60 | BUOY | Building | 2 | +morale at sea |
| 61 | SIRENS | Building | 1 | kills 30% of the army, pays experience for the dead |
| 62 | MERMAIDS | Building | 1 | +luck at sea |
| 63 | WHIRLPOOL | Building | 1 | teleports a ship to another whirlpool |
| 64 | PEASANT_HUT | Dwelling | 1 | peasants |
| 65 | ARCHERS_HOUSE | Dwelling | 1 | archers |
| 66 | BARRACKS | Dwelling | 1 | swordsmen |
| 67 | HEAVEN_MILITARY_POST | Dwelling | 1 | Haven tiers 4–7 in one building |
| 68 | MYSTICAL_GARDEN | Building | 3 | a little gold or gems, once a week |
| 69 | ARENA | Building | 1 | choose +2 attack or +2 defence *(both branches in `DefaultStats.xdb`)* |
| 70 | SHIP_GALEON | Building | 3 | a galleon standing on the map |
| 71 | SPHINX | Building | 1 | the generic-class twin of the Sphinx behaviour |
| 72 | DEMON_GATE | Dwelling + Building | 2 | demons |
| 73 | IMP_CRUCIBLE | Dwelling + Building | 2 | imps |
| 74 | KENNELS | Dwelling + Building | 2 | hell hounds |
| 75 | INFERNO_MILITARY_POST | Dwelling + Building | 2 | Inferno tiers 4–7 |
| 76 | GRAVEYARD | Dwelling | 1 | skeletons |
| 77 | NECROPOLIS_MILITARY_POST | Dwelling | 1 | Necropolis tiers 4–7 |
| 78 | HIGH_CABINS | Dwelling | 1 | elven archers |
| 79 | WOOD_GUARD_QUARTERS | Dwelling | 1 | blade dancers |
| 80 | PRESERVE_MILITARY_POST | Dwelling | 1 | Sylvan tiers 4–7 |
| 81 | ACADEMY_MILITARY_POST | Dwelling | 1 | Academy tiers 4–7 |
| 82 | DUNGEON_MILITARY_POST | Dwelling | 1 | Dungeon tiers 4–7 |
| 83 | FAIRIE_TREE | Dwelling | 1 | sprites |
| 84 | FIRE_LAKE | Dwelling | 1 | firebirds and phoenixes |
| 85 | WORKSHOP | Dwelling | 1 | gremlins |
| 86 | STONE_PARAPET | Dwelling | 1 | stone gargoyles |
| 87 | GOLEM_FORGE | Dwelling | 1 | iron golems |
| 88 | BATTLE_ACADEMY | Dwelling | 1 | scouts |
| 89 | SHADOW_STONE | Dwelling | 1 | furies |
| 90 | MAZE | Dwelling | 1 | **a dwelling** — minotaurs, not a puzzle |
| 91 | FORGOTTEN_CRYPT | Dwelling | 1 | zombies |
| 92 | RUINED_TOWER | Dwelling + Building | 2 | ghosts |
| 93 | WARMACHINE_FACTORY | Building | 1 | buy war machines |
| 94 | REFUGEE_CAMP | Dwelling | 1 | hires high-tier creatures from a fixed list |
| 95 | ELEMENTAL_CONFLUX | Dwelling | 1 | **a dwelling** — elementals, not a bank |
| 96 | TAVERN | Building | 1 | hire a hero |
| 97 | DEMOLISH | Building | 3 | wrecked ship: search it once per game |
| 98 | UNKEMPT | Building | 3 | derelict ship: search it |
| 99 | BIARA_CITADEL | Building | 1 | campaign scenery (its name and description files are empty) |
| 100 | DEMON_SOVEREIGN_CITADEL | Building | 1 | campaign scenery (same) |
| 101 | SCHOOL_OF_MAGIC | Building | 2 | choose +1 spellpower or +1 knowledge *(`DefaultStats.xdb`)* |
| 102 | WAR_ACADEMY | Building | 2 | choose +1 attack or +1 defence |
| 103 | TOMB_OF_THE_WARRIOR | Building | 2 | an artifact, at −3 morale |
| 104 | DWARVEN_TREASURE | Building | 2 | bank: gold and gems |
| 105 | BLOOD_TEMPLE | Building | 2 | bank (shipped as the Witch Bank) |
| 106 | LIBRARY_OF_ENLIGHTENMENT | Building | 2 | +2 knowledge and +2 spellpower if the hero is experienced enough |
| 107 | TREANT_THICKET | Building | 1 | bank: gold and wood |
| 108 | GARGOYLE_STONEVAULT | Building | 2 | bank: gold and ore |
| 109 | MAGMA_SHRINE | — (`AdvMapShrineShared`) | 0 | teaches a rune spell, circles 1–3 |
| 110 | DWARVEN_WARREN | — (`AdvMapDwarvenWarrenShared`) | 0 | **a mine**: 1 random resource a day, wood and gold excluded; capturable, has a garrison |
| 111 | FORTRESS_DEFENDERS | Dwelling | 2 | mountain guards |
| 112 | FORTRESS_AXEMEN | Dwelling | 2 | spearwielders |
| 113 | FORTRESS_BEAR_RIDERS | Dwelling | 2 | bear riders |
| 114 | FORTRESS_MILITARY_POST | Dwelling | 2 | Fortress tiers 4–7 |
| 115 | MEMORY_MENTOR | Building | 1 | retrains every skill and ability the hero has |
| 116 | SACRIFICIAL_ALTAR | Building | 1 | sacrifice creatures or artifacts for enlightenment |
| 117 | SPELL_SHOP | Building | 1 | trades resources for circle 4–5 spells |
| 118 | NOMADS_SHAMAN | Building | 1 | +10% health to the whole army in the next battle |
| 119 | FORTUITOUS_SANCTUARY | Building | 1 | a creature bonus that depends on the day of the week |
| 120 | ASTROLOGER_TOWER | Building | 1 | predicts — and can change — the coming week |
| 121 | SUNKEN_TEMPLE | Building | 1 | bank, underwater ruins |
| 122 | OUTPOST | Garrison | 1 | the addon's garrison |
| 123 | STRONGHOLD_GOBLINS | Dwelling | 1 | goblins |
| 124 | STRONGHOLD_CENTAURS | Dwelling | 1 | centaurs |
| 125 | STRONGHOLD_WARRIORS | Dwelling | 1 | orc warriors |
| 126 | STRONGHOLD_MILITARY_POST | Dwelling | 1 | Stronghold tiers 4–7 |
| 127 | NAGA_TEMPLE | — | 0 | **a live bank nobody uses**: guarded, and the hoard is artifacts and spells (see below) |

Seven of the eight values with no document are covered by a class instead
(`SIGN`, `SHIPYARD`, `SEER_HUT`, `PRISON`, `SHRINE_OF_MAGIC`, `MAGMA_SHRINE`,
`DWARVEN_WARREN`); `NAGA_TEMPLE` is the only value with no user of any kind —
and it is **not** dead. Given a document of its own on the generic class, with
the `NagaTemple` model and the `Text/Game/Buildings/NagaTemple/` strings that
ship for it, the game plays it as a full bank: *"Строение охраняется. Вы хотите
сразиться со стражей?"*, a garrison the engine picks (four stacks — nothing in
the document asks for them, the same rule as every other bank), and on a win
**three artifacts and two circle-5 spells**. Measured 2026-07-31 in the game
(`tools/probe-buildings.ts`); the art, the texts and the behaviour were all
there and only the document was missing.

So a mod gets a bank behaviour that no shipped object competes for.

The behaviour-carrying classes, for completeness:

| class | docs | what it is |
|---|---|---|
| `AdvMapShrineShared` | 4 | Shrine of Magic ×3 + the runic Magma Shrine |
| `AdvMapSeerHutShared` | 1 | quest giver |
| `AdvMapSphinxShared` | 1 | riddle: right answer rewards, wrong answer punishes |
| `AdvMapPrisonShared` | 1 | captive hero |
| `AdvMapCartographerShared` | 2 | land and water map sellers |
| `AdvMapSignShared` | 1 | signpost |
| `AdvMapShipyardShared` | 1 | shipyard |
| `AdvMapAbanMineShared` | 1 | abandoned mine: undead guard, resource unknown until cleared |
| `AdvMapDwarvenWarrenShared` | 2 | the dwarven mine (see 110) |
| `AdvMapStandShared` | 1 | Tieru's Hut — a set of `States` a script switches between; the one object of its class |

`AdvMapStandShared` is the one class the editor does not offer. It does nothing
on its own — the states are a campaign script's to switch, and its single object
carries no name and no message — so what it is ever wanted for is a building of
another class plus a Lua trigger on the visit, which every other class already
gives. See `BUILDING_CLASSES` in src/mods/buildings.ts.

## 6. What this means for a mod

A new building costs the game **nothing global** — no reference table, no
compiled ceiling, no patched executable, exactly like a dwelling. It is one
`*Shared` document plus its model, texts and icon, picking an existing
`BUILDING_*` behaviour.

What cannot be done by data: a new behaviour; a bank's guard; the reward of any
type not listed in section 3(c).

**Pick the class the behaviour lives on, not just the value.** A prison, a sign,
a shipyard, a seer hut, a shrine or a dwarven warren has to be a document of ITS
class; the same value on `AdvMapBuildingShared` is an object that greets a hero
with "unknown object" (section 2). Everything on the plain class — all 77 values
including `BUILDING_NAGA_TEMPLE` — is had by declaring the value.

Both of this section's `[~]` questions were answered in the game on 2026-07-31;
`tools/probe-buildings.ts` builds the probe (two definitions and their
placements, written into a map that already plays) if either needs re-running.

Scale is the same rule as for dwellings: adventure-map art is 1 tile = 2 world
units, and nothing in the format scales a model.

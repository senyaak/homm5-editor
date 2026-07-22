# What a freshly placed object looks like, measured

`docs/OBJECT_FIELDS.md` says which fields a type has and which values occur
across the shipped maps. It does not say what a **new** object should be set to,
because a shipped map only shows objects a designer already tuned.

The answer is not worth reasoning about — place one in the original editor, save,
and read what it wrote:

```bash
npm run object-defaults -- ../Maps/12.h5m
```

Objects dropped and left alone come out byte-identical apart from `Pos`, `Rot`
and `Shared`, so **a type whose bodies collapse to one variant is an untouched
default**. That is the signal the tool reports. Two variants mean something was
edited afterwards, and the diff says what.

Source so far: `Maps/12.h5m` — a map made in the original editor specifically to
harvest these: 93 statics, 19 monsters, 9 artifacts, 8 treasures, 6 mines, 5
heroes, 5 dwellings, 3 garrisons, 2 towns, 2 seer huts, 1 abandoned mine. Every
one of those types collapses to a single variant.

Still to place, by the name to look for in the original's palette:

| type | in the palette |
| --- | --- |
| `AdvMapBuilding` | the visitable buildings — Sanctuary, Observatory, Windmill, Fountain of Fortune… one type behind many icons, so it is the big one |
| `AdvMapShrine` | Shrine of Magic Incantation / Gesture / Thought — the spell teachers |
| `AdvMapPrison` | Prison |
| `AdvMapSphinx` | Sphinx (the riddle) |
| `AdvMapCartographer` | Cartographer |
| `AdvMapShipyard` | Shipyard |
| `AdvMapSign` | Sign, and the Ocean Bottle |
| `AdvMapHillFort` | Hill Fort |
| `AdvMapTent` | Border Guard / Keymaster's tent |
| `AdvMapDwarvenWarren` | Dwarven Warren (ToE) |

**Owner defaults to `PLAYER_1`, and nothing auto-increments.** The four heroes
are all `PLAYER_1`, which settles the question the two towns raised — they are
`PLAYER_1` and `PLAYER_2` because someone set the second, not because the editor
hands out the next free player. A mine is the exception: `PLAYER_NONE`, i.e.
unowned until captured.

## AdvMapMonster

```xml
<Custom>false</Custom>
<Amount>0</Amount>
<Amount2>0</Amount2>
<AttackType>ATTACK_ANY</AttackType>
<MoveType>MOVE_ANY</MoveType>
<DoesNotGrow>false</DoesNotGrow>
<MessageFileRef href=""/>
<Script/>
<Resources><Wood>0</Wood>…<Gold>0</Gold></Resources>
<ArtifactID>ARTIFACT_NONE</ArtifactID>
<Mood>MONSTER_MOOD_AGGRESSIVE</Mood>
<Courage>MONSTER_COURAGE_CAN_FLEE_JOIN</Courage>
<AllowQuickCombat>true</AllowQuickCombat>
<DoesNotDependOnDifficulty>false</DoesNotDependOnDifficulty>
<AdditionalStacks/>
<SingleMonsterNameFileRef href=""/>
<MultipleMonstersNameFileRef href=""/>
<RacesRandomGroupID>0</RacesRandomGroupID>
<relationsOverrides/>
```

**`Amount` is 0, not 1.** The roadmap assumed a new creature stack is "obviously
1"; it is not. Zero with `DoesNotDependOnDifficulty` false means *let the game
size the stack by difficulty*, which is why a map can be filled with monsters
without typing a number 19 times. A default of 1 would have been a plausible,
wrong, and tedious guess — this is the reason to measure rather than reason.

`Custom` false likewise means the stack is whatever `Shared` says, so a new
monster carries no army of its own.

## AdvMapStatic

```xml
<IsRemovable>false</IsRemovable>
<TerrainAligned>false</TerrainAligned>
<ScalePercent>100</ScalePercent>
```

All 93 identical. Decor has nothing to default beyond this, which matches the
editor being usable for decor already.

## AdvMapTown

The long one. Notable defaults, the rest being empty elements:

```xml
<PlayerID>PLAYER_1</PlayerID>          <!-- see below -->
<ShipTile><x>0</x><y>0</y></ShipTile>
<Specialization/>                       <!-- empty: the validator complains about it -->
<buildings>
  <Item><Type>TB_TOWN_HALL</Type><InitialUpgrade>BLD_UPG_1</InitialUpgrade><MaxUpgrade>BLD_UPG_4</MaxUpgrade></Item>
</buildings>
<spellIDs> … every SPELL_* in the game … </spellIDs>
<RndSource>RND_NONE</RndSource>
<LinkToPlayer>PLAYER_NONE</LinkToPlayer>
<CanCaptureOnlyNotVisit>false</CanCaptureOnlyNotVisit>
<AllowQuickCombat>true</AllowQuickCombat>
<GarrisonBlockedForAI>false</GarrisonBlockedForAI>
```

Three things a template would have got wrong:

- **`spellIDs` is the full spell list, not empty.** A town's mage guild may
  offer anything by default; the field is a filter, and an empty one is not
  "no restriction", it is "no spells".
- **`buildings` holds one entry**, the town hall, upgradeable to 4 — a town
  starts buildable, not bare.
- **`Specialization` is empty**, and the original's own save-time validator then
  reports "There are towns without specialization!". So the default is a state
  the editor itself considers incomplete. Ours should default the same way and
  say the same thing (see the validation item in ROADMAP), not invent a
  specialisation to keep quiet.

The two towns differ only in `Pos`, `Shared` and `PlayerID` (`PLAYER_1`,
`PLAYER_2`) — the second was set by hand, see the note on owners above.

## AdvMapHero

```xml
<PlayerID>PLAYER_1</PlayerID>
<Experience>0</Experience>
<armySlots/>
<artifactIDs/>
<isUntransferable/>
<Editable>
  <NameFileRef href=""/><BiographyFileRef href=""/>
  <Offence>0</Offence><Defence>0</Defence><Spellpower>0</Spellpower><Knowledge>0</Knowledge>
  <skills/><perkIDs/><spellIDs/>
  <Ballista>false</Ballista><FirstAidTent>false</FirstAidTent><AmmoCart>false</AmmoCart>
  <FavoriteEnemies/><TalismanLevel>0</TalismanLevel>
</Editable>
<OverrideMask>0</OverrideMask>
<PrimarySkillMastery>MASTERY_NONE</PrimarySkillMastery>
<LossTrigger><Action><FunctionName/></Action></LossTrigger>
<AllowQuickCombat>true</AllowQuickCombat>
<Textures><Icon128x128/><Icon64x64/><RoundedFace/><LeftFace/><RightFace/></Textures>
<PresetPrice>0</PresetPrice>
<BannedRaces/>
```

Everything zero and every list empty, gated by `OverrideMask` 0: the hero is
whatever its `Shared` definition says. `Editable` is not a set of starting stats
but a set of **overrides**, and the mask says which of them count — so writing
stats into a new hero without touching the mask would change nothing, and
clearing the mask on an edited hero silently reverts them. Worth confirming
which bit means which field before the hero property panel is built.

`armySlots` empty means the hero comes with its class's default army, not with
no army — same shape as the monster's `Custom` false.

## AdvMapMine

```xml
<PlayerID>PLAYER_NONE</PlayerID>
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
<armySlots/>
<CreatureSwapBlockedForAI>false</CreatureSwapBlockedForAI>
```

## AdvMapAbanMine

```xml
<AvailableResources>
  <Item>0</Item><Item>0</Item><Item>1</Item><Item>1</Item><Item>1</Item><Item>1</Item><Item>1</Item>
</AvailableResources>
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
```

Seven flags in the resource order used by `<Resources>` (wood, ore, mercury,
crystal, sulfur, gem, gold) — so wood and ore are off and the five precious ones
are on. That matches the game: an abandoned mine turns out to be a precious-
resource mine, never a sawmill. A positional flag list with no names in it, which
is exactly the kind of field a hand-written template gets wrong.

## AdvMapArtifact

```xml
<armySlots/>
<MessageFileRef href=""/>
<spellID>SPELL_NONE</spellID>
<RandomShiftRadius>0</RandomShiftRadius>
<untransferable>false</untransferable>
```

`armySlots` on an artifact is the guard standing on it — empty, so a placed
artifact is unguarded by default.

## AdvMapTreasure

```xml
<IsCustom>false</IsCustom>
<Amount>0</Amount>
<MessageFileRef href=""/>
```

Same shape as the monster: `Amount` 0 with `IsCustom` false means the game
decides the pile, not that the pile is empty.

## AdvMapDwelling

```xml
<PlayerID>PLAYER_NONE</PlayerID>
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
<RandomCreatures>true</RandomCreatures>
<creaturesEnabled/>
<RndSource>RND_NONE</RndSource>
<LinkToPlayer>PLAYER_NONE</LinkToPlayer>
<LinkToTown/>
```

`RandomCreatures` **true** with `creaturesEnabled` empty: a new dwelling rolls
its creature. Empty here is not "nothing" again — the same trap as the town's
spell list, in the opposite direction.

## AdvMapGarrison

```xml
<PlayerID>PLAYER_NONE</PlayerID>
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
<armySlots/>
<CollectableArmy>false</CollectableArmy>
<AllowQuickCombat>true</AllowQuickCombat>
<TownType>TOWN_HEAVEN</TownType>
```

`TownType` decides which faction's garrison art and creatures apply, and it
defaults to `TOWN_HEAVEN` — the first of the enum, not a neutral value. A
garrison placed and forgotten is a Haven garrison.

## AdvMapSeerHut

Almost all of it is one `<Quest>` block, which is the same structure the map's
objectives use — so whatever we build for quests serves both. The defaults worth
naming:

```xml
<Kind>OBJECTIVE_KIND_MANUAL</Kind>
<Timeout>-1</Timeout> <Holdout>-1</Holdout> <CheckDelay>-1</CheckDelay>
<InstantVictory>false</InstantVictory>
<TargetGlance><Target><Type>ADV_TARGET_NONE</Type>…</Target><Radius>10</Radius><Duration>5000</Duration></TargetGlance>
<Award><Type>AWARD_NONE</Type>… every award field present and zero …</Award>
<TakeContribution>false</TakeContribution>
<CanUncomplete>false</CanUncomplete>
<IsInitialyActive>true</IsInitialyActive>   <!-- their spelling -->
<IsInitialyVisible>true</IsInitialyVisible>
<IsHidden>false</IsHidden> <Ignore>false</Ignore>
<ShowCompleted>true</ShowCompleted> <NeedComplete>true</NeedComplete>
<AllowMultipleActivations>true</AllowMultipleActivations>
<AllowMultipleCompletions>true</AllowMultipleCompletions>
</Quest>
```

`-1` is "no limit" for the three timers. The `Award` block carries **every**
award kind at once — resources, attribute, artifact, spell, army slot, spell
points, morale, luck, skill — with `Type` selecting which one is read. So a new
quest is a full award record set to nothing, and the editor's job is to write
`Type` plus the one field it names, not to prune the rest.

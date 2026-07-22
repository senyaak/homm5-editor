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
harvest these, 93 statics, 19 monsters, 2 towns. Other types need a map that
places them; re-run the tool and add a section.

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
`PLAYER_2`). Whether the editor assigns the next free player automatically or
the user set them is not established by one map — worth checking on the next
sample before we copy the behaviour.

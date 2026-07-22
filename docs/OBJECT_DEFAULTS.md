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

Source: `Maps/12.h5m` — a map made in the original editor specifically to harvest
these: 93 statics, 19 monsters, 13 buildings, 9 artifacts, 9 treasures, 6 mines,
5 heroes, 5 dwellings, 4 shrines, 3 garrisons, 2 towns, 2 seer huts, 2 tents, 2
cartographers, and one each of abandoned mine, prison, sphinx, sign, hill fort,
dwarven warren and shipyard. Every type collapses to a single variant — the
buildings only split because their `<Name>` was typed in by hand.

**All 21 types are covered.**

**One type is many objects.** `AdvMapBuilding` alone covers Sanctuary, Redwood
Observatory, Windmill, Fountain of Fortune, Dwarven Treasury — **and every
teleport**: Whirlpool, Monolith One Way Entrance/Exit, Monolith Two Way,
Subterranean Gate In/Out. A teleport is not its own map type, it is a building
whose `Shared` says so. That is the general shape here: the map object carries
placement and overrides, the `Shared` definition carries what the thing *is*.
Which is also why one measured default per type is enough, and why a palette
entry cannot be guessed from the type name.

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

`-1` is "no limit" for the three timers, and `IsInitialy…` is their spelling, not
a typo of ours — it has to be written back exactly. The `Award` block carries **every**
award kind at once — resources, attribute, artifact, spell, army slot, spell
points, morale, luck, skill — with `Type` selecting which one is read. So a new
quest is a full award record set to nothing, and the editor's job is to write
`Type` plus the one field it names, not to prune the rest.

## AdvMapBuilding

```xml
<PlayerID>PLAYER_NONE</PlayerID>
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
<GroupID>0</GroupID>
<showCameras/>
```

Four fields for the widest type on the map — everything a visitable building
does lives in its `Shared`.

**`GroupID` does not pair teleports, or at least the editor never sets it.**
Placed side by side, two whirlpools, a monolith entrance and its exit, a
two-way monolith pair and a subterranean gate in/out all came out `GroupID` 0.
So a pair is a pair by *kind* — both ends share the monolith colour or the gate
type — and `GroupID` is what would separate a second, independent pair of the
same kind. That reading is not yet confirmed; what is confirmed is that placing
teleports needs no id from us, and that writing one would be a change, not a
default.

The user labelled them by hand (`enter`, `exit`, `two-way-one`…) — that is the
`<Name>` handle Lua addresses, see docs/NAMES_AND_SCRIPTING.md, and it is empty
by default on every type.

## AdvMapShrine

```xml
<SpellID>SPELL_NONE</SpellID>
```

`SPELL_NONE` is "roll a spell of this shrine's circle", the circle being the
`Shared` (Shrine_Of_Magic_1/2/3). Setting it is how a shrine is made to teach a
specific spell.

## AdvMapPrison / AdvMapSphinx

```xml
<PrisonedHero/> <RandomHero>true</RandomHero>
<Riddle/>       <RandomRiddle>true</RandomRiddle>
```

The same pattern as the dwelling: an empty slot plus a `Random…` flag that is
**true**, so a placed object is complete and random until someone fills it in.

## AdvMapSign

```xml
<MessageFileRef href=""/>
```

## AdvMapHillFort

```xml
<CreaturesUpgradesFilter>
  <ForbiddenBasicUpgradeTiers/><ForbiddenAlterUpgradeTiers/><NotUpgradeable/><ForbiddenUpgrades/>
</CreaturesUpgradesFilter>
```

All four lists empty, i.e. nothing forbidden — a fort that upgrades everything.
The same block a town carries.

## AdvMapTent

Nothing beyond the fields every object has. A Border Guard and a Keymaster's
Tent differ only by `Shared` (`Border_Guard_5`, `Keymaster_Tent_5` — the number
is the barrier colour), so there is no default to get wrong.

## AdvMapDwarvenWarren

```xml
<PlayerID>PLAYER_NONE</PlayerID>
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
<armySlots/>
<CreatureSwapBlockedForAI>false</CreatureSwapBlockedForAI>
```

Identical to `AdvMapMine`, field for field — the ToE warren is a mine with its
own type.

## AdvMapCartographer

```xml
<CaptureTrigger><Action><FunctionName/></Action></CaptureTrigger>
<Cost>4000</Cost>
```

The one default on any type that is a **price**, and it is the same 4000 for
both the land cartographer and the water one — so the price lives on the placed
object, not in `Shared`, and a map with cheap cartographers is a map where every
one of them was edited.

## AdvMapShipyard

```xml
<ShipTile><x>4</x><y>0</y></ShipTile>
```

Where the ship appears, as an offset from the shipyard — not `0,0` like the
town's `ShipTile`, but four tiles along. A default a template would have
zeroed, putting the boat inside the building.

---

## Where these live now

Not in this file — it is the explanation, not the source. The values are JSON
Schema `default` keywords in `src/objects.schema.json`, beside the `title` and
`x-widget` of the field they belong to, and `src/defaults.ts` applies them to a
newly placed object. One place, read by both the placement code and the property
panel.

The split that makes it work: the **donor** (a real object of the same type,
from this map or a shipped one — `src/donors.ts`) supplies the FIELD SET, which
differs per type, per game version and per mod; the **schema** supplies the
VALUES. Hence two rules in `src/defaults.ts`:

- a field the donor does not have is never created — the donor is the authority
  on what this type carries here, and it is also why one `Editable` default
  serves both the hero's fourteen fields and the town's two;
- a field with no measured default keeps what the donor wrote, and
  `tools/test-defaults.ts` prints those by name rather than letting them pass
  unnoticed.

Two things could not be constants and so are not `default`s:

- **`<Name>`** — generated per placement (`MONSTER_001`), because ours are never
  empty even though the original's are. See `HommMap.nextName()`.
- **A town's `spellIDs`** — the default is *every spell the installation has*,
  which depends on the install and any mod. Marked `x-defaultAll`; the app
  resolves it from the registry.

`npm run test-defaults -- ../Maps/12.h5m` places one object of every type and
diffs it against this map, field by field. All 21 match.

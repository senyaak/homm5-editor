# Artifact effects, stats and sets — what data, script and exe each control

The base recipe for *adding* an artifact (record, shared, icon, ceiling patch,
map's `<artifactIDs>`) lives in the maps repo, `Maps/sod/docs/ARTIFACTS.md`.
This document is the other half: what a new artifact can *do* — which knobs are
data, which behaviours a script can build, and which are compiled into the
executable and closed. Researched 2026-07-27 from the ToE data
(`a2p1-data.pak`, the addon layer that overrides base files), the shipped
script manuals (`Editor Documentation/HOMM5_*.pdf`), strings pulled out of
`bin/H5_Game.exe`, and how NAF and MMH5.5 do it.

## The three layers

A fourth layer — patching or hooking the engine itself — is where the port is
headed, so that a new artifact is indistinguishable from a shipped one rather
than emulated from outside. What that costs, and where the engine's own
artifact code can be cut into, is in
[ENGINE_INTERNALS.md](ENGINE_INTERNALS.md).

| layer | controls | ceiling |
|---|---|---|
| **data** (`.xdb` in the mod archive) | identity, price, slot, the six hero stats, set *membership*, every set effect's *numbers*, a handful of named constants (the Necromancer's Pendant among them) | cannot invent new *behaviour* |
| **script** (`advmap-common.lua` hook) | anything the adventure API can express: stats, skills, spells, creatures, resources, movement, custom abilities | no equip trigger (poll instead); a fixed list of mutable things; combat numbers out of reach |
| **exe** | every special property of the 97 shipped artifacts, keyed by id; the ten set behaviours and their thresholds | closed. A new id gets nothing and cannot borrow |

## The record: 22 fields, four more than we first documented

Every record in `GameMechanics/RefTables/Artifacts.xdb` has exactly the same
fields — verified by histogram over all 97, no record carries anything extra,
no spell references, no ability hooks anywhere. Beyond the known
name/description/model/`Type`/`Slot`/icon/`CostOfGold`/`AIValue`/`HeroStatsModif`:

- **`CanBeGeneratedToSell`** — false excludes the artifact from merchants and
  random generation. False on the 8 quest/scripted items (GRAAL, ANGEL_WINGS,
  BOOTS_OF_LEVITATION, GOLDEN_SEXTANT, ARTIFACT_FREIDA, ARTIFACT_PRINCESS,
  ARTIFACT_RING_OF_THE_SHADOWBRAND, ARTIFACT_NONE). Set it false on
  plot artifacts so shops never sell them.
- **`ArtifactShared`** — href to the `AdvMapArtifactShared` map object. The
  link is *mutual*: the shared names the artifact back through `<ArtifactID>`.
- **`AvailableForPresets`** / **`PresetPrice`** — the duel-preset shop. False
  only on the four skill tomes; prices are −1 / 0 / 300–2000 gold.

`Type` spread: 28 MINOR, 37 MAJOR, 31 RELIC, 1 GRAIL. Slots: PRIMARY 14,
SECONDARY 11, HEAD 10, CHEST 9, FEET 9, SHOULDERS 11, NECK 8, FINGER 14,
MISCSLOT 8, INVENTORY 3 (the Grail and the two "carried person" tokens).

## What data can say

### The six stats

`HeroStatsModif` — Attack/Defence/Knowledge/SpellPower/Morale/Luck, plain
integers, negative allowed (the shipped cursed items use it). This is the
whole vocabulary of a record's own effect.

### Named constants an artifact id reads

The exe hardcodes *which* artifact triggers a behaviour, but some magnitudes
live in `GameMechanics/RPGStats/DefaultStats.xdb` and can be retuned:

- `combat/HeroSkills/Necromancer/Necromancy`: **`NecroPendantBonus` = 10**
  (the Pendant's +necromancy %) and
  **`NecroPendant_CreatureCostDisountPercents` = 10** (its dark-energy
  discount; the typo is canonical). Beside them: `RaisePercentBase`,
  `RaisePercentPerSkillLevel`, `NecromancyAmplifierBonus`, `GrailBonus`,
  `EnergyBase`, `EnergyPerNecromancyAmplifier`,
  `CreaturePowerPointsForOneEnergy`, and the full dead→undead
  `TransformTable` — the whole necromancy economy is data.
- `adventure`: `ChestMinorArtifactChance` = 4,
  `SacrificialAltar_ArtifactCostOfGoldToExpCoef` = 0.5,
  `Marketplace_ArtifactSellCostOfGoldCoef` = 0.5.
- `Banks`: which artifacts creature banks pay out, per difficulty.

So: the *strength* of the Pendant's specials can be changed; the *hook* cannot
be moved to another id.

### Per-map switches

Two lists in the map's `<AdvMapDesc>` gate artifacts at the map level:

- **`<artifactIDs>`** — which artifacts exist on this map at all (see the base
  recipe; an artifact outside the list is refused everywhere on that map).
- **`disabledArtifactSets`** — sits among the map-desc fields (next to
  `MapRumours`, `dialogs`, `teams` in the exe's field table): a per-map list
  disabling artifact sets. The stock editor exposes it; our reader should
  carry it through.

## Sets

### Where and what

`DefaultStats.xdb`, block `<ArtifactSets><Sets>` — ten `<Item>` entries. Full
shape (the Lion set, smallest complete example):

```xml
<Item>
    <Effect>ARTFSET_EFFECT_LIONS</Effect>
    <Artifacts>
        <Item>
            <Artifact>CROWN_OF_COURAGE</Artifact>
            <CombinesAtPuton>true</CombinesAtPuton>
            <CombinesAtBackpack>false</CombinesAtBackpack>
        </Item>
        <!-- … one Item per member … -->
    </Artifacts>
    <NameFileRef href="ArtifactSets/Lions_Name.txt"/>
    <DescriptionFileRef href="ArtifactSets/Lions_Desc.txt"/>
    <CombinedDescriptionsFileRefs>
        <Item href=""/>
        <Item href=""/>
        <Item href="ArtifactSets/Lions_Desc3.txt"/>
    </CombinedDescriptionsFileRefs>
    <CombinedHeroClassBonusesDescs>
        <Item>
            <HeroClass>HERO_CLASS_KNIGHT</HeroClass>
            <BonusDescFileRef href="ArtifactSets/Lions_Desc2_Knight.txt"/>
        </Item>
    </CombinedHeroClassBonusesDescs>
    <CombinedIcons>
        <Item/>
        <Item href="/Textures/HeroScreen/Artifacts/Lion_Hide_Cape.xdb#xpointer(/Texture)"/>
        <Item href="/Textures/HeroScreen/Artifacts/Lion_Hide_Cape.xdb#xpointer(/Texture)"/>
    </CombinedIcons>
</Item>
```

The three `Combined*` arrays are **per-piece-count**: index N (0-based) is
"N+1 pieces worn"; an empty href means no tier at that count. That is *display
only* — the mechanical thresholds are compiled into the exe per `Effect` enum.
`CombinesAtPuton`/`CombinesAtBackpack` exist per member but are
uniformly true/false across all shipped data (a backpack-counted set piece is
untried territory). Set texts live in `GameMechanics/RPGStats/ArtifactSets/*.txt`
(relative hrefs resolve beside DefaultStats.xdb); tooltip framing in
`Text/Tooltips/ArtifactSets/` (a2p1-texts.pak).

### The ten sets, their effects and thresholds

| Effect enum | set (pieces) | fires at | behaviour (constants in §below) |
|---|---|---|---|
| DRAGONISH | Power of the Dragons (8) | 2/4/6/8 | +all stats; tier-7 buffs; more stats; free tier-7 weekly |
| DWARVEN | Dwarven (4) | 2/4 | army 40% magic-proof (+Runemage SP%); buffs last 10 turns |
| LIONS | Lion (3) | **3 only** | Knight: hero attacks demoralize target |
| MAGIS | Magi (4) | 2/4 | army casters ×2 SP; Wizard: cheaper ATB after hero cast |
| NECROMANCERS | Necromancer (4) | 2/4 | enemy −1 speed (+Banshee riders); bad-morale enemies −20% att/def, +20% necromancy, −25% raise cost |
| EDUCATIONAL | Enlightenment (2) | 2 | +15% experience |
| HUNTERS | Hunter (2) | 2 | shooters −30% ATB cost |
| OGRES | Ogre (2) | 2 | army +3 att / +2 HP; Barbarian ATB rider |
| RUNIC | Runic (2) | 2 | +1 all stats; **Warlock** (sic) Elemental Vision ×2 |
| DEMONIC | Demonic (2) | 2 | +5 attack; Demon Lord +25% gating |

Class riders (the `2Necromancer`-style constants) apply only to that class.
The set *debuffs* are implemented as hidden spells — `SPELL_ARTFSET_LIONS_DEMORALIZED`
and `SPELL_ARTFSET_NECROMANCERS_DEBUFF` exist in the exe's spell table.

### All 31 tunable constants

`<ArtifactsSetsEffectsConsts>` at the bottom of DefaultStats.xdb — flat
name→number pairs; the naming is `<Set>_<threshold>[<Class>]_<what>`. The exe
knows which constant belongs to which enum+threshold; you can retune every
number, you cannot add a constant or a new effect kind.

| constant | value |
|---|---|
| Dragonish_2_AllStats | 1 |
| Dragonish_4_Creature_Tier | 7 |
| Dragonish_4_Creature_Attack | 5 |
| Dragonish_4_Creature_Defence | 5 |
| Dragonish_4_Creature_HitPoints | 20 |
| Dragonish_6_AllStats | 3 |
| Dragonish_8_Creature_Tier | 7 |
| Dragonish_8_Creature_Count | 1 |
| Dwarven_2_Creature_MagicProofPercents | 40 |
| Dwarven_2Dwarf_SpellpowerPercents | 10 |
| Dwarven_4_Creature_SpellsBuffsTurns | 10 |
| Lions_2_HeroAttack_DeMorale | 2 |
| Magis_2_Casters_SpellpowerMultiplier | 2 |
| Magis_4_2Wizard_AfterCastATBLessPercents | 10 |
| Necromancers_2_EnemyCreature_DeSpeed | 1 |
| Necromancers_2Necromancer_BansheeWhail_DeMorale | 1 |
| Necromancers_2Necromancer_BansheeWhail_DeLuck | 1 |
| Necromancers_2Necromancer_BansheeWhail_DeInitiativeMultiplier | 2 |
| Necromancers_2Necromancer_BansheeWhail_ATBLessPercents | 2 |
| Necromancers_4_EnemyCreature_BadMoralePenaltyToAttackDefencePercents | 20 |
| Necromancers_4Necromancer_NecromancyBonusPercents | 20 |
| Necromancers_4Necromancer_NecromancyCreatureCostDisountPercents | 25 |
| Educational_2_GainExperienceBonusPercents | 15 |
| Hunters_2_ShootersATBLessPercents | 30 |
| Ogres_2_Creature_Attack | 3 |
| Ogres_2_Creature_HitPoints | 2 |
| Ogres_2Barbarian_HeroAttack_ATBLessPercents | 30 |
| Runic_2_AllStats | 1 |
| Runic_2Warlock_ElementalVisionMultiplier | 2 |
| Demonic_2_Attack | 5 |
| Demonic_2DemonLord_GatingBonusPercents | 25 |

(`BansheeWhail`, `Disount`, `Hummer` — the typos are canonical, reproduce them.)

### A new set

A new `<Item>` in `<Sets>` is data, so a new set *exists* — membership,
tooltips, per-count texts and icons all work from the entry alone. Its
*mechanics* come from `<Effect>`, and there the choice is:

- **borrow a shipped enum** — the new set behaves exactly like that set
  (same thresholds, same constants — retuning a constant changes the donor
  set too, they share it);
- **`ARTFSET_EFFECT_CUSTOM`** — enum value **0**, used by no shipped set.
  Confirmed from the code: the set counter is called from 25 sites and their
  indices run 1–10, so **nothing in the executable implements index 0**. It is
  a set the engine parses, counts and draws, whose effect is ours to supply —
  from Lua via `GetArtifactSetItemsCount(hero, 0, 1)`, or from a native hook.
  (Still to confirm in game: that the data parser accepts the name, and what
  happens if two sets share one enum.)

Either way the real bonuses of a scripted set come from the script, and the
script has first-class support for exactly this (next section).

## The script toolbox

Global hook: `scripts/advmap-startup.lua` runs on every adventure map and ends
with `doFile("/scripts/advmap-common.lua")` — a mod overrides the latter. A
`startThread` + `sleep` polling loop is steadier than `SetTrigger` (one
handler slot per trigger kind; a map's own script would take it).

### Knowing what the hero has

| call | gives |
|---|---|
| `HasArtefact(hero, id, onlyEquipped=0)` | possession. **The third argument is real but undocumented** — with 1 the engine checks only the equipped slots and never opens the backpack (read out of the code, [ENGINE_INTERNALS.md](ENGINE_INTERNALS.md#hasartefact-has-a-third-argument-worn-versus-carried)). Worn-state detection therefore needs no set at all |
| `GetArtifactSetItemsCount(hero, setID, onlyCombined=1)` | **worn count** of a set's members; `onlyCombined=0` counts the backpack too. Useful for tiered set bonuses |
| `GiveArtefact(hero, id, bindToHero=0)` | grant; `bindToHero=1` makes it untransferable |
| `RemoveArtefact(hero, id)` | take away (errors if absent — guard with `HasArtefact`) |

`setID` is the **`ARTFSET_EFFECT_*` enum value**, not a position in the
`<Sets>` list — the engine's own necromancy code calls it with 5 for the
Necromancer set, and 5 is where `NECROMANCERS` sits in the enum. A custom set
is therefore index 0.

### What a script can change on a hero

- `ChangeHeroStat(hero, statID, delta)` — deltas on STAT_ATTACK / STAT_DEFENCE
  / STAT_SPELL_POWER / STAT_KNOWLEDGE / STAT_LUCK / STAT_MORALE /
  STAT_MOVE_POINTS / STAT_MANA_POINTS / STAT_EXPERIENCE (experience only
  upward). Values clamp at 0 and at move/mana maxima. Read back with
  `GetHeroStat`.
- Skills and perks: `GiveHeroSkill`, `HasHeroSkill` (true also when granted by
  an artifact), `GetHeroSkillMastery`. No RemoveHeroSkill — a granted skill
  stays; `TakeAwayHeroExp` strips skills but *randomly*, it is not an undo.
- Spells: `TeachHeroSpell`, `KnowHeroSpell`. **No forget-spell call** — NAF
  ran into the same wall and made spell-granting artifacts permanent-by-design
  ("Ancient Relics").
- Army: `AddHeroCreatures` / `RemoveHeroCreatures` / `GetHeroCreatures`.
- `MakeHeroNecromancer(hero, level)` — any hero raises undead after combat at
  the given necromancy level (no skill needed, none granted). The honest
  script equivalent of "+necromancy" for a non-necromancer; for a necromancer,
  add stacks directly after battles instead.
- `ControlHeroCustomAbility(hero, CUSTOM_ABILITY_1..4, mode)` — up to four
  activatable buttons in the hero's spellbook; activation fires
  `CUSTOM_ABILITY_TRIGGER` with `(heroName, abilityID)`. Names, descriptions
  and icons come from `GameMechanics/RPGStats/Skills.xdb`. The way to give an
  artifact an *activated* power.
- Economy and misc: `SetPlayerResource`/`GetPlayerResource` (daily-income
  artifacts), `GiveExp`, `OpenCircleFog` (vision artifacts),
  `GiveHeroWarMachine`/`RemoveHeroWarMachine`.

### Events

Adventure triggers: `NEW_DAY_TRIGGER`(0), `PLAYER_ADD_HERO_TRIGGER`(1),
`PLAYER_REMOVE_HERO_TRIGGER`(2), `OBJECTIVE_STATE_CHANGE_TRIGGER`(3),
`OBJECT_TOUCH_TRIGGER`(4), `OBJECT_CAPTURE_TRIGGER`(5),
`REGION_ENTER_AND_STOP_TRIGGER`(6), `REGION_ENTER_WITHOUT_STOP_TRIGGER`(7),
`HERO_LEVELUP_TRIGGER`(8), `WAR_FOG_ENTER_TRIGGER`(9),
`TOWN_HERO_DEPLOY_TRIGGER`(10), plus `CUSTOM_ABILITY_TRIGGER`.

**There is no equip/unequip trigger and no hero-screen event.** A worn-state
bonus is a polling thread: each tick read the state
(`GetArtifactSetItemsCount` for set members, `HasArtefact` otherwise),
diff against the last tick, apply/remove deltas with `ChangeHeroStat`, and
keep the bookkeeping in `SetGameVar`/`GetGameVar` so it survives save/load.
Anything granted while worn must be *undone by the script* when the artifact
leaves — which is why reversible bonuses (stat deltas) age better than
irreversible ones (skills, spells).

### Combat

A combat script (`SetHeroCombatScript(hero, ref)`, or per-arena) sees the
battle through the COMBAT API — and the exe registers far more of it than the
manual admits ([EXE_LUA_REGISTRY.md](EXE_LUA_REGISTRY.md)): beside the
documented `GetAttackerHero`/`Get*Creatures`/`AddCreature`/`Finish` there are
undocumented `setATB`, `UnitCastAimedSpell`/`UnitCastAreaSpell`/
`UnitCastGlobalSpell`, `commandDoSpell`, `SummonCreature`,
`SetUnitManaPoints`, `displace`, `addUnit`/`removeUnit`. So a combat script
*can* move ATB, cast any spell through a unit, summon and reposition stacks —
an artifact's combat effect can be "on combat start, cast X / shift ATB by Y"
(signatures need in-game probing; none of this is in the manuals). What
remains out of reach is the damage formula itself — there is no damage hook,
so a literal "+50% fire damage" stays exe-only. On the adventure side,
undocumented `GetLastSavedCombatIndex` makes post-combat detection clean
(poll it, then read the combat through the `GetSavedCombat*` family). NAF
adds from experience: combat-script tricks break in multiplayer (tactical
scripting is prohibited there) — single-player only.

### Possible vs impossible, in one place

| want | verdict |
|---|---|
| ±primary stats, luck, morale while worn | script (poll + `ChangeHeroStat`), fully reversible |
| +movement, +mana, daily gold/resources | script, natural fits (`STAT_MOVE_POINTS`, `SetPlayerResource` on new day) |
| +% necromancy on a new artifact | **natively, and cheaper than expected.** The raise percentage is one sum ([ENGINE_INTERNALS.md](ENGINE_INTERNALS.md#the-necromancy-percentage-in-full)) whose last term already is "worn pieces of a set ≥ threshold → add a constant from data". Putting the Cloak in the shipped Necromancer set gets +20% with no patch at all; a hook adds a term of our own. Script fallback for a hero *without* the skill: `MakeHeroNecromancer` (the engine consults it only when the skill is 0) |
| grant a spell / skill while worn | one-way only — no removal calls; treat as permanent (NAF's compromise) |
| activated artifact power | `ControlHeroCustomAbility` + `CUSTOM_ABILITY_TRIGGER` |
| +% fire (or any element) damage | **impossible for a new id.** Exe-only (the Trident/Icicle/Cape family); no damage hook in any script API |
| ATB/initiative effects, combat-start spell casts | combat script, via undocumented `setATB` / `UnitCast*` (single-player; signatures to be probed) |
| new set with own thresholds/behaviour | UI and membership as data; behaviour scripted (thresholds are then whatever the script checks) |
| dark energy grants | **impossible** — getter exists, setter does not (full exe function table checked); raise creatures directly instead |
| backpack-passive artifact | trivially scriptable — poll `HasArtefact` and skip the worn check (NAF ships this as a feature) |
| auto-combining artifacts | script: detect all parts via `HasArtefact`, `RemoveArtefact` them, `GiveArtefact` the combined one (NAF does exactly this, with a one-day delay) |

## How the big mods do it

Both confirm the layering rather than escape it:

- **NAF** (New Artifacts Framework, heroesworld.ru): states outright that
  standard artifact properties cannot be bound to new items — only
  strategic-mode scripts. Ships backpack-passives, uncombinable-slot items and
  auto-combining "Ancient Relics" (collect all parts → merged next day,
  bound to hero); spell-granting artifacts are permanent because spells cannot
  be unlearned; notes tactical-mode scripting is unavailable in multiplayer.
- **MMH5.5**: 103 new artifacts, all effects through their Lua framework
  (near-complete Lua 4.0 library on both adventure and combat maps); artifact
  ids declared in their `advmap-startup.lua`; mapmaker knobs like
  `H55_RemoveTheseArtifactsFromBanks` are script variables.

Sources: [NAF thread](https://forum.heroesworld.ru/showthread.php?t=12252),
[MMH5.5 scripting tutorial](https://www.moddb.com/mods/might-magic-heroes-55/tutorials/mmh55-mapmaking-scripting-console-commands),
[MMH5.5 artifact release](https://www.moddb.com/mods/might-magic-heroes-55/news/mmh55-the-big-artifact-release-rc15-beta-1),
[MMH5.5 on ModDB](https://www.moddb.com/mods/might-magic-heroes-55).

## Recipes

**A new set** (e.g. the King of the Dead cloak set):

1. Add the artifacts (base recipe in the maps repo).
2. Append an `<Item>` to `<ArtifactSets><Sets>` in our override of
   `DefaultStats.xdb`: members, texts, per-count icons.
   `Effect`: `ARTFSET_EFFECT_CUSTOM` once verified, else the closest shipped
   enum (knowing its thresholds and shared constants come with it).
3. Script the bonuses in `advmap-common.lua`: a thread polls
   `GetArtifactSetItemsCount(hero, setIndex, 1)` per player hero, diffs
   against the remembered count, applies tiered `ChangeHeroStat` deltas.
4. Remember: one archive for everything — a second archive touching
   `types.xml` or `DefaultStats.xdb` silently loses (mods replace files,
   never merge).

**A custom property on a single artifact:** same loop with
`HasArtefact` (possession-only granularity) — or make it a one-piece set
to get worn-detection.

## To verify in game (open questions)

- [ ] `ARTFSET_EFFECT_CUSTOM` parses, draws the set tooltip, fires nothing.
- [ ] `GetArtifactSetItemsCount` addresses an added set (by index?) and counts
      our artifacts.
- [ ] An 11th set's tooltip/UI renders at all (the manager may cap at ten).
- [ ] `CombinesAtBackpack=true` actually counts backpack pieces for the exe
      effects (never used in shipped data).
- [ ] `disabledArtifactSets` round-trips through our map reader/writer.

Micro-artifacts (Academy) mirror the big pattern: shells and prefixes are data
(`MicroArtifactShells/Prefixes.xdb`), the 11 effect magnitudes
(`MicroArtifactEffects.xdb` ids) are exe-hardcoded per id — same wall, smaller
bricks.

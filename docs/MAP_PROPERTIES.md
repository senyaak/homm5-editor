# Map properties — the original's "Adventure Map Properties"

Reference for the map-level settings the original editor exposes, what each one
does, and where it lives in `map.xdb`. It backs two surfaces in this editor:

- **Tree** — a left-hand panel (in place of the object list) that edits the raw
  `<AdvMapDesc>` as a property tree: every field, including the containers, no
  curation. The complete, power-user view. Nothing is hidden and nothing is
  guessed — you see the file.
- **Dialog** — a friendly, clickable native `<dialog>` with the original's eight
  tabs. Curated: the common settings with proper controls (dropdowns, checkbox
  lists, team grid). What most editing goes through.

Both drive the same in-memory `map.xdb`, so edits flow through undo / dirty /
save the same way object edits do.

## Where the data is, in one sentence

Everything the map *currently* holds is in `map.xdb` and is already parsed. What
is **not** in the map is the *universe* each picker chooses from — the full list
of spells, artifacts, heroes, races, and ambient-light presets. Every one of
those sources is now located: the ID lists in
`Editor Documentation/HOMM5_A2_IDs_for_Scripts.pdf`, the `/MapObjects` hero
files, and the light presets in `data/Lights/_(AmbientLight)/` — plus optional
localized display names from the text resources.

## Storage model, shared by several tabs

The enable/disable tabs (Spells, Artifacts, Heroes) store a **list of the
enabled items**, not a per-item flag:

- `spellIDs`   — `<Item>SPELL_MAGIC_ARROW</Item>` … (enabled spells)
- `artifactIDs`— `<Item>SWORD_OF_RUINS</Item>` … (enabled artifacts; note: the
  map stores the **bare** name, while the script IDs in the PDF carry an
  `ARTIFACT_` prefix — `ARTIFACT_SWORD_OF_RUINS`)
- `AvailableHeroes` — `<Item href="/MapObjects/Academy/Astral.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)"/>` …

So a full list = "all checked", an empty list = "all unchecked". To draw the
checkboxes we need the **full roster** to check against; the map only tells us
which are on. In map 12: 353 spells and 97 artifacts enabled, 0 heroes.

> Roster counts differ by source: the map's enabled `spellIDs` holds 353 and
> `artifactIDs` 97, while the A2 PDF lists 240 `SPELL_*` and 89 `ARTIFACT_*`
> script IDs (the map list also carries combat/ability entries). The most
> reliable universe is therefore **harvested from a fully-enabled shipped map**,
> with the PDF as the human-readable cross-check.

---

## Tab 1 — General Map Properties

| Control | `map.xdb` | Notes / status |
|---|---|---|
| Restrict hero level to *N* | `HeroMaxLevel` | 0 = unrestricted. **Works today.** |
| Ambient Light + Script Name | `GroundAmbientLights[0]` (ref) — **not** `AmbientLight` | See below: the dropdown picks a **preset** referenced by `GroundAmbientLights[0]`; the top-level `AmbientLight` is a rarely-used inline override. |
| Has Underground Level | `HasUnderground` (+ a second terrain file) | Toggling generates/removes an entire floor — a terrain operation, not a simple flag. Read-only in the dialog for now. |
| Ambient Light For Underground | `UndergroundAmbientLights[0]` (ref) | The floor-1 equivalent; `UndergroundAmbientLight` is its inline override. |

### Ambient Light, precisely (the one gap — now closed)

There are two mechanisms and the dropdown uses the **reference**, not the inline
block:

- `GroundAmbientLights[0]` / `UndergroundAmbientLights[0]` — an `<Item href="/Lights/_(AmbientLight)/0_Default_AmbientLight.xdb#xpointer(/AmbientLight)"/>`
  pointing at a **preset**. This is what the General-tab dropdown reads and writes.
- `AmbientLight` / `UndergroundAmbientLight` (top level) — an optional **inline**
  copy of the whole lighting definition (`LightColor`, `AmbientColor`, `Sky`,
  `Fog*`, `SkyDome`, …), used when a map overrides a preset. Empty on most maps.

**Preset roster** (the dropdown's universe): `data/Lights/_(AmbientLight)/*.xdb`
— **297** presets. Each carries `<InternalName>` (e.g. `Default`) and a
localized `<NameFileRef>` (e.g. `0_Default_name.txt`); the dropdown label
"Haven Light (Grass)" is that name, with the bracketed terrain hint. So the
dropdown = enumerate the folder, show the name, write the chosen preset's href.
| Map Name | `NameFileRef` → `name.txt` | The visible name lives in a sibling text file (UTF-16LE + BOM), a **separate document** from `map.xdb`. Read-only until that document has its own undo/save path. |
| Map Description | `DescriptionFileRef` → `description.txt` | As above. |

Ambient Light, per the practical guide, controls the level's sunniness, shadows,
and the sky reflected in water. Each preset name carries a bracketed hint of the
terrain it suits.

## Tab 2 — Players Properties

One `<Item>` per player in `players` (always 8, in `PCOLOR_*` order). The
dialog edits one selected player at a time.

| Control | `players/Item/…` | Universe |
|---|---|---|
| Player (slot) | `Colour` (`PCOLOR_*`), position 0–7 | fixed 8 slots / `PLAYER_1…8` (PDF) |
| Race | `Race` (`TOWN_*`) | Town type IDs (PDF): NO_TYPE + 8 factions |
| Main Town | `MainTown` (object ref) | towns **placed on this map** |
| Generate Hero In Town | `HeroInTown` (bool) | — |
| Main Hero | `StartHero` / `MainHero` (ref) | heroes on the map / roster |
| Human Playable | `CanBeHumanPlayer` (bool) | — |
| Computer Playable | `CanBeComputerPlayer` (bool) | — |
| Reserve Heroes List | `ReserveHeroes` (list of hero refs) | hero roster |

Also carried per player (surfaced in the tree, not the dialog):
`ActivePlayer`, `Behaviour` (`PB_RANDOM`…), `CaptureAbility`, `DefaultBonus`
(`PLAYER_BONUS_*`), `CanChangeBonus`, `TavernFilter`
(`BannedHeroesRaces` / `BannedHeroes` / `AllowedHeroes`),
`VictoryMessageRef` / `DefeatMessageRef`, `CanBeDisabled`, `Attractors`,
`AddHeroTrigger` / `RemoveHeroTrigger`, `DenyFogOfWarForAllies`.

## Tab 3 — Teams

A radio grid: each player → one team (1–8). Stored as `players/Item/Team`
(int; `0` = no team). The "Teams" master checkbox is the root `CustomTeams`
(bool) — off means the engine assigns teams, on means the grid is honoured.
**Data all present.**

## Tab 4 — Heroes

Checkbox list of the whole hero roster; `AvailableHeroes` holds the enabled
refs (see the storage model above). Buttons: Reset / Check All / Uncheck All.

- **Universe**: the 118 `*.(AdvMapHeroShared).xdb` files under
  `/MapObjects/<Race>/` — we ship the ability to enumerate these.
- **Names**: the tab shows localized names; resolving ref → name needs the text
  resources. Fallback: the file basename (`Astral`, `Faiz`, …).

## Tab 5 — Spells

Checkbox list of every spell; `spellIDs` holds the enabled ones. Check All /
Uncheck All. Universe harvested from a fully-enabled map (or the PDF's 240
`SPELL_*`). Names localized, fallback to the enum id.

## Tab 6 — Artifacts

Checkbox list of every artifact; `artifactIDs` holds the enabled ones. Check
All / Uncheck All, plus an **Untransferable** master checkbox.

- `artifactIDs` — enabled artifacts (bare names).
- `isUntransferable` — the "cannot be carried between missions" set/flag.
- `disabledArtifactSets` — disabled artifact **sets** (universe = the set
  roster, from game data).

## Tab 7 — Script

`MapScript` is an href to a `<script>` wrapper xdb
(`href="mapscript.xdb#xpointer(/Script)"`) that in turn references a Lua file.
The "Edit Script" button opens it. Full editing is **Phase 5** (Monaco + the
HoMM V Lua API from `HOMM5_A2_Script_Functions.pdf`); for now the reference is
shown.

## Tab 8 — Rumours

`MapRumours` is a list; each `<Item>` is:

```xml
<Item>
  <Text href="Rum1.txt"/>      <!-- the rumour text, a sibling txt file -->
  <Weight>100</Weight>          <!-- relative frequency -->
  <TownType>TOWN_HEAVEN</TownType>
</Item>
```

Add / Edit / Remove / Remove All. The text is a txt file, the same separate-
document concern as Map Name/Description.

---

## Gap analysis — "is everything there, or is more needed?"

**In the map already (parsed, editable now):** the *state* of every tab — hero
level, players and their every field, teams, the enabled spell/artifact/hero
lists, ambient-light definitions, the script ref, rumours. The tree can edit all
of it today through the generic reader.

**Needed from game data before the dialog's pickers are complete** — every
source is now located:

1. **Rosters (the checkbox/dropdown universes)** — none of these are in the map:
   - Spells, Artifacts, Artifact sets — harvest from a full map; cross-check vs.
     `HOMM5_A2_IDs_for_Scripts.pdf`.
   - Heroes — enumerate `/MapObjects/*/*.(AdvMapHeroShared).xdb` (118 files).
   - Races / Players — `TOWN_*` / `PLAYER_*` enums from the same PDF.
   - **Ambient-light presets** — `data/Lights/_(AmbientLight)/*.xdb` (297),
     display name from each preset's `InternalName` / `NameFileRef`. **Found.**
2. **Localized display names** (heroes/spells/artifacts/races) — from the text
   resources (`texts.pak`). Optional: the dialog works with raw IDs first, names
   are a polish pass.
3. **Two text-file sub-documents** — Map Name/Description and rumour texts live
   in sibling `.txt` files. Editing them wants the same undo/save-as-document
   plumbing the terrain floors already have.
4. **Script editing** — Phase 5 (Lua).

So the answer is **everything is here**: the map holds the state, and every
picker universe is either in the map, the shipped `MapObjects`/`Lights` folders,
or the ID PDF. Nothing is left to reverse-engineer for this dialog — it is
wiring, plus two small text-document subsystems and (later) Lua.

---

## The rest of the tree (beyond the eight tabs)

The original's dialog covers eight tabs, but `<AdvMapDesc>` carries more, and the
**tree** surface exposes all of it. What the dialog does not reach, annotated:

- `Resources` — `PointLights`, `SavesFilenames`.
- `moons` — three `<Item>` (moon `State` + `RotationRate`); `RandomMoons` (bool)
  overrides them.
- `ScenarioInformation` — up to 8 entries, the **lobby goal text** shown on the
  scenario-selection screen (`CaptionFileRef` / `DescriptionFileRef` per slot,
  `Kind = OBJECTIVE_KIND_SCENARIO_INFO`). Full objective struct (Award, Target
  glance, triggers) but used here only for display.
- `Objectives` — the real **victory/loss conditions**: `Primary` / `Secondary`,
  each split `Common` vs `PlayerSpecific[0..7]`. Each objective has a `Kind`
  (`OBJECTIVE_KIND_DEFEAT_ALL`, …), `Award`, `TargetGlance`, `InstantVictory`,
  `DieInWeekWithoutTowns`, etc. A whole editor of its own (Phase 4).
- `CustomMapGoal` / `CustomGoal` — a custom goal overriding the first common
  primary objective.
- `NewDayTrigger`, `WarFogEnterTrigger`, per-player `AddHeroTrigger` /
  `RemoveHeroTrigger`, `PWLTutorialHintTrigger` — Lua `FunctionName` hooks.
- `TavernFilter` (per player): `BannedHeroesRaces` (banned hero races),
  `BannedHeroes` (banned heroes, script names), `AllowedHeroes` (allowed even if
  their race is banned).
- `sRMGProps` — random-map-generator settings (`RMGmap`, `InitialParams`:
  `MapSize`, `WaterAmount`, `MonsterLevel`, per-player race, multipliers, …).
- `MoonCalendarModifications` — `BlockMonstersWeeks`.
- `ImportantArtifacts.PreservingArtifacts` — artifacts that fall from a hero on a
  lost battle (rather than being lost) so they stay on the map.
- `AdditionallyRollableHeroes` — scenario heroes that should still be rollable.
- `Music` (adventure music, not combat), `Weather`, `Wind`, `PreLight`, `Birds`
  / `BirdsAmount`, `BorderSize`, `BanTransparency`, `StartScene`, `PWLPicture`,
  `LoadingScreenSound`, `thumbnailImages`, `dialogs`, `tiles` (the map's terrain
  tile set), `regions`.

None of these block the eight-tab dialog; they are why the **tree** exists —
so everything in the file is reachable, dialog or not.

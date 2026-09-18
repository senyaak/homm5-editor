# A faction of our own — the plan

*Where the ninth faction stands on 2026-09-17, what is still unknown, and
the order the rest is done in. The engine's side of the story — every
address, every table, every launch that taught something — is in
[engineInternals/FACTIONS.md](engineInternals/FACTIONS.md); this is the
work list.*

## Where it stands

A twelfth `TownType` (`TOWN_TEST = 11`) starts and plays, through a probe
(`_tmp/town12-probe.ts`, `town12-units.ts`, `town12-siege-map.ts` — not in
the tree, main worktree only) and code that IS in the tree:

- **the race** is selectable and starts: the picker's five accessors, the
  type's name and the picker's icon live in the DLL, read from
  `bin/homm5-editor-races.txt` (`native/faction/race-order.c`,
  `src/mods/race-order.ts`); `TownTypesInfo`, `TownSpecs`, `RMGPresetTable`
  are widened as data plus the executable's ceilings;
- **the town** is a copy of a shipped one under `Factions/<name>/`
  (`src/mods/town-files.ts`): screen, buildings, texts, icons, build grid;
  its dwellings hire the faction's row; its siege is assembled from any
  towns' parts with any creature on the towers; its icons are drawn
  (`src/format/paint.ts`, `src/mods/faction-icons.ts`); its named towns
  come from a list;
- **the creatures** are the creature mod's, 7 × 3 with upgrade links.

Still the donor's: the hero (Haven's Brem with `TownType` changed), the
building names and descriptions, the race's own texts, the interior's
building models, the exterior stage models, the magic guild's schools
(a field, never set), and every compiled effect a special building has.

## Principles, already paid for

- **Nothing grows in the executable.** A table the engine indexes by race
  lives in the DLL, filled from a file the editor writes; the executable's
  own is left as shipped. The twelfth slot written over a jump table's
  padding cost four launches: no `.reloc` entry, so under ASLR it pointed
  into whatever the padding became. ([[new-engine-tables-live-in-our-dll]])
- **Every file of the faction is the faction's**, copied under its folder
  with the hrefs repointed — except what the engine knows by identity (the
  terrain's textures, the one `CragTerrain` material) and what belongs to
  another entity (cameras, characters, shots, the biome's scenery).
- **Art is drawn, not borrowed.** A placeholder from another town confuses
  the reading of what is ours.
- **The faction entity in the editor comes last.** A dialog for a thing we
  cannot yet fully describe would be rewritten with every discovery below;
  the probe stays the harness until the list of what a faction IS stops
  changing.

## The registries a faction touches

What the probe patches today, and the faction builder patches tomorrow —
every one of these is a place a new type has to be written into, and a
place to clean when the faction is removed:

| keyed by | where | what |
|---|---|---|
| ordinal | `types.xml` `ETownType`/`ERace`, `__RACE_COUNT` | the type itself |
| ordinal | `GameMechanics/RefTables/TownTypesInfo.xdb` + exe ceiling | the record |
| ordinal | `GameMechanics/RefTables/RMGPresetTable.xdb` + exe push | the generator's row |
| ordinal | `UI/UIGameRoot.(UIGameRoot).xdb` `town_buildings_<n-3>` | the build grid |
| ordinal | exe `0xB4E730` clamp (`cmp ecx,7`) | index → type past the eight |
| ordinal | DLL races file (order, icon, tooltip, name) | the picker, the name |
| name | `UI/MPWait/PlayersList/Item/Races.(WindowRelatedTextures).xdb` + `Texts` | picker tile, tooltip |
| name | `UI/CombatScreen-Heavy/ATBBar/AdditionalIcons.(WindowRelatedTextures).xdb` | tower portrait |
| name | the race's texts (to be found — the town window's "Race:" line) | texts |
| membership | `MapObjects/_(AdvMapSharedGroup)/Towns/any.xdb` | random towns |
| membership | `MapObjects/_(AdvMapSharedGroup)/Heroes/Any.xdb` | random heroes |
| membership | `GameMechanics/RefTables/TownSpecs.xdb` + `ETownSpec` + exe ceiling | named towns |
| membership | `GameMechanics/RefTables/Creatures.xdb` (`CreatureTown`) | the row |

Compiled and out of reach for now: the special buildings' effects, the
grail's, the racial screens (necromancy, rage, runes…), `AIRacesValues`
and the other eight-wide arrays the engine indexes by race.

## The order

### 1. The town, finished

The town is the faction's face and most of its rules; it is done first and
fully, in the probe, one launch per question.

- **1a. The building tree — DONE, launched (launch 19, 2026-09-17 22:00: the edited tree on the build screen, the Bone Pit built, a clean log).** `TownSpec.buildings`,
  by `TB_<TYPE>` or `TB_<TYPE>/<level>`: `name`, `description`, `cost` (the
  resources named), `devLevel`, `requires` (the list, whole), `slot` (the
  grid cell); `null` drops the building with every level above it — before
  the copy walks, so its record, texts and icon never enter the copy — and
  the grid loses the cell, or the slot. A survivor that needed a dropped one
  is refused until re-parented. `tools/test-town-buildings.ts`. The probe's
  `TEST_TOWN` carries an example (no shipyard, no Capitol, no Stables, the
  arena on the citadel, the training grounds renamed and moved) — **to
  launch:** does the build screen draw the edited tree, and does the game
  mind a town without a Capitol or a shipyard.
- **1b. Buildings of our own — the model (settled 2026-09-17).** A town is
  a BASE every faction has and cannot lose — the hall ×4, the fort ×3, the
  marketplace and silo, the blacksmith, the tavern, the guild ×5 (spellbook
  or warcries, item 1c), seven dwellings ×2, the grail; the shipyard is the
  one optional base building — of which only the tree (1a) is edited; plus
  up to ten buildings of ours in `TB_SPECIAL_0…9`, which the engine treats
  as numbered slots whose meaning is compiled per (town, slot): the same
  `TB_SPECIAL_3` is Academy's artifact merchant and Necropolis's graves
  (`scripts/advmap-startup.lua` lists the pairs; the magnitudes sit in
  `DefaultStats.xdb` `TownBuildingBonuses` under names like
  `Stronghold_GarbagePile_GoblinGrowthAddition`; the screens are compiled
  classes — `CHavenTraining`, `CStrongholdSlaveMarket`…). For a type of
  ours no branch fires, so a special of ours is data plus what WE hang on
  it. A building of ours is:
  - **data** — the record (cost, dependencies, level, texts, icon), its cell
    on the build grid, and in the town screen an `ArenaModObject` named by
    `ModObjectName` (a model per upgrade level, level 0 empty), a static
    camera `<Name>_cam`, an `AIGeometry` pick volume, locators — the
    interior's models are in WORLD coordinates (one Maya scene), so a model
    of ours stands where we put it (1d);
  - **a passive effect** — a FORM for what we know and the engine computes
    (growth +N of a tier, resources per day, a hero stat while owned, luck
    or morale in a siege, a percentage…): native, in the DLL, from the
    config the editor writes — the same split the artifacts already use
    (numbers native, events Lua); anything else — Lua, for modders;
  - **a click** — the town screen's left jog-dial has fixed buttons, each
    a game message the engine handles (`enter_hall`, `enter_market`…, ONE
    `enter_special` whose target is compiled per town and whose skin is
    picked by town ORDINAL out of eight `VisualStates`, and `buy_artifacts`
    shared by Academy's merchant and Stronghold's shelter); a click on the
    model goes through the record's type. Ours: a message the DLL catches
    and routes to Lua (`QuestionBox`/`MessageBox` today; our own window
    functions later).
  - **an API "building built"** — a DLL hook on `CUpgradeTownBuildingCmd`
    (the replicated command, so every client sees it) calling into Lua; an
    extended trigger "new day + has building" on top of it, later.
  - **The grail**: the racial part is compiled per town like a special; the
    common +5000 gold and +50% growth are NOT in `DefaultStats` — code, and
    whether inside or outside the race switch is unknown (launch).
  - **The AI**: what it builds is a compiled valuation (the race-indexed
    arrays of §4); a faction has to say what its AI builds and when.
  - **Lua in multiplayer** is off (no machine is created — engine gate
    `0x7223E0`), which would make every Lua effect single-player; the fix
    is to REVIVE the engine's own dead door — `CWorldScriptSystem`
    `0xA4B6A0`, the world-side machine written for exactly this and never
    called, with `CRunScriptCallbackCmd` beside it — not to forbid Lua.
    Separate item; the Pandora box already depends on Lua.
  **Launch 19 (22:00):** a special of a type the engine never compiled
  BUILDS — the Bone Pit (Haven's `TB_SPECIAL_1` renamed, recosted, moved)
  went up with nothing in the log; in the town screen it was built in the
  CENTRE of the town, inside the castle's own model, so which model it got
  was not seen — to look at again once a model of ours stands in the open
  (1d). **The `EnterSpecial` button was neither drawn
  nor active** for the ninth type — no ninth skin, no compiled target —
  so the jog-dial slot is free for a button of ours. A click on the model
  opens the engine's own info box — name, description, our drawn icon —
  with no hook at all, so "a building you can look at" is complete in
  data; only a click that DOES something needs the button and its message.
  **The click — DONE, launches 22–27 (2026-09-18): the skin, the enable, the click, the town's name, the Lua run inside the click, the box on the town screen (`H5EMessageBox`).** As built: `TownSpec.buildings[…].button = { lua }`
  → a ninth skin and a ninth click on the shipped `EnterSpecial` button
  (`src/mods/town-button.ts`), a row in `bin/homm5-editor-buildings.txt`,
  and `native/faction/town-button.c` registering `enter_own` on the town
  screen through the engine's own registrar, enabling the button by the
  building's presence through the engine's own `0x854030`, and saying
  `<lua>("<town>")` to the map's Lua. The map calls `H5ETownButtons()` once
  at its start (the click has no Lua context to reach the map by); the
  click ticks the scheduler once, so the Lua runs inside it; the map's own
  `MessageBox` only queues for the adventure screen, so a box in town is
  `H5EMessageBox(text[, header])`, shown on the screen that is up
  (engineInternals/FACTIONS.md, launches 22–27). **The faction's Lua is the
  mod's, on every map** (`TownSpec.script` → `scripts/homm5-editor/
  faction-<file>.lua`, loaded by the mod's `advmap-common.lua`), never a
  map's own script — launch 28, another map: "Value was NIL" at every click.
  The tooltip's `<value=special>` is the building's name for its level
  (launch 30). Nothing of the button is left.
  **Still unknown:** the grail's common bonuses. Launch 20, the AI's first
  turn, crashed — not the tree: the ceiling patcher had raised the wrong
  table's accessor (engineInternals/FACTIONS.md, "The table half").
- **1c. Magic — READ (2026-09-17), nothing launched.** Two separate
  things, and neither is a field of the town:
  - **The guild's spells.** The town's `MagicSchool_0/1` (shared `+0x124`,
    `+0x128`; Light/Dark when unset) are the two FAVOURED schools; a
    `CAdvMapTown` virtual (`0xAC3B50`) answers them plus the other two of
    the four combat schools (Destructive, Dark, Light, Summoning). The pool
    is the spell table by `Level` and `MagicSchool`, so a spell of ours
    with a school and a level is drawn like any other; a school of OURS is
    not (the enum, the skills, the book's tabs are compiled). Set the two
    schools in the spec and stop there.
  - **Warcries.** Stronghold has NO guild: its `TB_MAGIC_GUILD` slot on the
    grid has no cells, its five guild records are free level-0 stubs with
    no icon and no `UIObjectName` (the engine wants a record per level, the
    screen never shows one), and warcries are taught by the Hall of Trial —
    `TB_SPECIAL_1` ×3 levels, a special like any other, compiled per
    (STRONGHOLD, SPECIAL_1) and opened by the `enter_special` button. The
    HERO side is `IHero::GetClass() == HERO_CLASS_BARBARIAN` (vtable slot
    `+0x258`; its answers are compared to 1…8 and to nothing else, so it
    is the class), at sixteen sites: `0x70CC7A` (which spellbook to open —
    `CCreateOrcsSpellBook` vs `CCreateSpellBook`, both `UIGameRoot`
    fields), `0x850793` `0x8507CC` `0x859893` `0x8598BE` `0xACBD02`
    `0xB84414` `0xBCBD7A` `0xBCC863` `0xC1F910` `0xC2A408` `0xD16CE7`
    `0xD35B86` `0xD36576` `0xD366D1` `0xD3BE09` `0xD47787`. So "a faction
    of warcries" = a town with the guild stubbed the way Stronghold's is
    (data, the copier can do it), a building of ours that teaches warcries
    (a form; the Hall's routine is what it would call), and a class of
    ours the DLL answers "barbarian-like" for at those sixteen places —
    a `class → warcries` column of the classes file. Not started.
- **1d. The screen's own models — DONE, launched (21: the graves stand on the shipyard's spot, lit, the camera flies to them; they floated at first — placed by the lowest vertex, which for a town model is the bottom of a hidden pedestal, so the ground is the widest level now; the hover is the shipyard's hull, so the ground beside them lights up too — a hull of our own is the remaining debt).**
  `BuildingEdit.model` (`src/mods/town-screen.ts`): a `Model` document from
  anywhere (another town's screen, an adventure-map object) is copied under
  `Factions/<file>/buildings/<name>/`, its positions moved — the one array a
  geometry file keeps a coordinate in, the edit every baked map building
  goes through — to `place: 'TB_SHIPYARD'` (where the dropped donor building
  stood: its level-1 model's ground centre, its camera and its pick hull
  reused) or to `at: {x, y, z}` outright (the donor building's camera moved
  by as much; no pick hull — the AI hull is a container the geometry tools
  do not rewrite), optionally `across` scene units wide; an
  `ArenaModObject` named `<file>_<type>` with the model at every level, a
  camera `<name>_cam`, both listed in the ArenaDesc, every record of the
  type pointed at the name. **To launch:** is it lit (the lightmap is baked
  per ArenaDesc uid), picked, flown to. The probe puts the Necropolis graves
  on the shipyard's spot.
- **1e. The exterior — DONE (2026-09-18, launches 31–32).** `TownSpec.exterior`:
  another town's whole `Exterior` or a mix per stage, gate named separately
  (town-files.ts, `EXTERIOR_STAGES`). The stage is `0xAC7980`: hall ≤ 2 →
  walls (0 none, 1 fort or citadel, 2 castle) + 3 with the guild; hall 3 →
  6 + walls; hall 4 → 9. Launch 32 showed Necropolis, Dungeon and Haven
  stages in turn. **Debt:** a black stripe before the entrance on the
  Necropolis stages only — not looked into. **Found on the way:** the sign
  over an owned town (`PlayerColourSchemes.xdb`, capture-marker.ts) — done,
  the red skull stands over the town.
- **1f. Texts.** Building names and descriptions, the town name, the
  race's own name — written by the copy from the spec, the way the named
  towns already are. **To find:** the text the town window's "Race:" line
  reads, now that the type's name is honest.

### 2. Heroes

Heroes are already a thing the editor makes (`HeroSpec`, classes, skills,
specializations); the faction reuses them. What is specific:

- a hero of the race is one with `TownType` ours and `ScenarioHero` false,
  listed in `Heroes/Any.xdb` (the random pool) — check that the hero
  builder does the listing;
- his class is one of ours or a shipped one; his starting army is the
  race's tier 1–3 base creatures (engine, works);
- **spellbook or warcries** — item 1c's finding, applied per faction;
- towns of the race are drawn for a hero of it; a hero "without a town"
  (a class not tied to a race) is the ordinary case for reuse.

### 3. Fixes: large addresses

The executable is not `LARGEADDRESSAWARE`: 2 GB, and a faction's copied
town plus 21 creatures' art leave ~800 MB free in the menu. A one-bit
patch of the PE header, offered as a separate entry in the fixes list —
optional, off by default, next to the H5_DLL ports.

### 4. Research still open

- 8-wide compiled arrays indexed by race (`AIRacesValues`, morale between
  races, the tavern's order): which ones a twelfth race reads past the end
  of, and which the DLL has to own. The players-state builder and the
  hero lists are already read; the AI's valuation is not.
- The generator with nine races: `RMGPresetTable` is widened, the port
  (`src/rmg/`) reads the table — does a zone of race 11 come out?
- Multiplayer: the races file and the mod must match on every client;
  what the lobby compares.
- Lua: scripts name types by number; `TOWN_TEST` exists in `types.xml`
  only for the serializer.

### 5. The faction entity in the editor — last

When 1–4 have stopped changing the list above: `FactionSpec` in the mod
model, `faction-files.ts` writing every registry in the table, the races
file written by the install, a window in the editor with the creature
row, the town (donor, siege, icons, buildings), the heroes, the named
towns; the probe deleted. The rule from the creature mod applies: the
example lives in the editor first, the mod follows the working scheme.

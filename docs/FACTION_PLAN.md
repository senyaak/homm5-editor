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
- **1c. Magic — DONE as "no magic" (2026-09-18, launches 35–38; launch 39 confirmed it: no guild on the build screen, the dial's guild button dark, an empty ordinary book on the Bone Lord).** Warcries were built end to end and rolled back: a warcry is a charge of rage, and rage is the Horde's. What stands: a class without magic (`HeroClassSpec.magic: 'none'`, two gates of `CanLearnSpell`, `native/faction/magic-kind.c`) and a town without a guild (`TownSpec.magic: 'none'`, Stronghold's stubs); a guild town sets `magicSchools` and stops there. On the way: the compiled feature table behind every special building is the extension's (`native/faction/town-features.c`, `BuildingEdit.grants`/`from`). All of it in engineInternals/FACTIONS.md. The reading that led there, two separate The sites are scanned, not listed: nineteen for the class (the three the list below lacks are the book chooser's), nine for the guild's side of the town; `native/faction/magic-kind.c` answers at all of them for `bin/homm5-editor-magic.txt`, the copier takes Stronghold's stubs and hall (`TownSpec.magic`, `BuildingEdit.from`), the probe's Test town shouts and the Knight is the A/B class. See engineInternals/FACTIONS.md, "Warcries: where the engine asks". The reading that led there, two separate
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
- **1f. Texts — DONE (2026-09-18, launches 33–34).** Building names and
  descriptions were already `BuildingEdit`; the race as such is
  `TownSpec.race` (town-type-info.ts): the type's record in
  `TownTypesInfo` copied from the donor and made ours — `textType` is
  the "Race:" line and every place a type is written out
  (`TownTypeFormats.xdb` is dead data, unread by the exe), the walls'
  names out of the copy, four kingdom-overview icons drawn, the neutral
  creature (the tier-2 base everywhere), silo income, native war machine,
  moat damage and spells. **Music** is a row per `<race>` in
  `Sounds/_(Music)/TableRaceMusic.xdb` — a type without one is silent
  everywhere (launch 33); `race.music` names whose set to take. A
  creature has FOUR icon sizes; the creature copy took only the 128 (the
  hero window drew the donor's face over a recoloured creature).

### 2. Heroes

Heroes are already a thing the editor makes (`HeroSpec`, classes, skills,
specializations); the faction reuses them. What is specific:

- a hero of the race is one with `TownType` ours and `ScenarioHero` false,
  listed in `Heroes/Any.xdb` (the random pool). The hero builder writes the
  two fields and does NOT list him — listing is membership, the faction's
  business like `Towns/any.xdb`: `src/mods/shared-groups.ts` does both
  (2026-09-18), the probe calls it, the faction entity (§5) will;
- his class is one of ours or a shipped one; his starting army is the
  race's tier 1–3 base creatures (engine, works);
- **spellbook or warcries** — item 1c's finding, applied per faction;
- towns of the race are drawn for a hero of it; a hero "without a town"
  (a class not tied to a race) is the ordinary case for reuse.

### 2b. An effect of our own — the proof of concept (Senya, 2026-09-18)

Every shipped special's effect is a row of the feature table now (`grants`),
so the next question is an effect the engine never had: a REFUGEE CAMP in
the guild's place — three levels, a slot of hires that a new week fills with
a random creature. The shape is the extension's: the building is data
(`TownSpec.buildings`, a record with levels, a model, a button if it needs
one), the effect a term of the DLL — `OnBuildingBuilt` says it stands, the
new-week hook puts a stack into the town's hire slots, the hire screen shows
it. Done after §3–4, and if it works, any faction can be made for real.

Read 2026-09-19, the doors (not launched): a town's hire slots are a vector of
16-byte entries `{count, vector<creature>}` on the town's base subobject
(`+0xF8` of the whole; the vector at base `+0x50`, a sibling at `+0x5C`).
`SetDwellingCreatures(creature, count)` is the base's virtual `+0xFC`
(`0xACBB70`: find the entry whose list holds the creature, set its count —
a creature no entry lists is silently nothing, which is what Lua's
`SetObjectDwellingCreatures` reaches through `CSetDwellingCreaturesCmd`).
An entry is ADDED by `0xAC39C0(town, &vector<int>)` — the build function
`0xAC7FF0` calls it for a dwelling's creatures (`0xAC3320`) and again for
the upgrade (record `+0xA8`); an entry whose first creature is already
listed is not added twice. So the camp is: `OnBuildingBuilt` for our
special → `0xAC39C0` with one random creature; the new-week hook → write
the entry's creature and count in place. Whether the hire screen draws an
eighth entry is the launch's first question.

**Read 2026-09-22 — the game's own refugee camp, and the shape decided
(Senya: a hire screen of our own, its data in a store of ours, not the
town's hire vector; so no eighth slot at all).**

The shipped camp is `MapObjects/Special/RefugeeCamp.xdb`, an
`AdvMapDwellingShared` of `Type BUILDING_REFUGEE_CAMP` (94) with a POOL of
38 creatures (`creatures`, record `+0xFC`), `RandomType` specific. Its
init (`0xD0E2D0`) builds NO hire entries from the pool for types 0x54,
0x5E (camp) and 0x5F (conflux) — the other dwellings get one entry per
listed creature (`0xD0E4C0`, with the race filter at `+0x128` and the
random-level dice). The camp's entry is rolled by `0xD0E610(fraction,
flag)`: the world's RNG (`dwelling+0x10 → vt+0x20`, scaled to [0,1) at
`0xD0EBE8`) picks `pool[int(n·fraction)]`, the entries vector
(`dwelling+0x11C`, 16-byte `{count, vector<creature>}`) is cleared and
given that one, its count = the creature record's weekly growth
(`record+0xA8`). Caller `0xD0E870`, the new-week refresh (four callers).
The random-RACE dwelling resolution (`0xD0F9B0`) rolls a race out of
`0xB4E700` = `mov eax,8` — a random-race dwelling on a map never rolls a
race of ours (a dwelling of a SET race does, through `DWELLINGS_<RACE>`).

The hire screen is ONE screen for towns, dwellings and caravans:
`HIRE_CREATURES` in `UIGameRoot`'s `<screens>` (`UI/HireCreatures/`, the
entries in a scrollable `ElementsContainer` — as many as the source
gives). It is asked for with `CCreateHireScreen` (`0x838700`, `ret 24h`:
`ecx` = the screen's `+0x5F4` object's `vt[0]()`, `edx` = its `+0x1C`,
then the HIRE SOURCE, the hero, the army, an `int*`, the sound-screen
builder (`0x6F1710` a dwelling's, `0x6F1740(shared)` a town's), a pointer
and three bools) — the dwelling visit at `0x767107` and the town's hire
at `0x7875B0` and `0x84FB60` build it. The source is a VIRTUAL BASE both
`CAdvMapTown` and `CAdvMapDwelling` have: `obj + 4 + vbtable[0xC]` (the
town's at 852, the dwelling's at 352), five slots, the dwelling's real
functions behind adjustor thunks:

| slot | dwelling | what |
|---|---|---|
| +0x00 | `0xD0FFE0` | `vector<Entry>* Entries()` — `this-0x44` |
| +0x04 | `0xD0FFF0` | `CopyEntries(vector<Entry>* out)` |
| +0x08 | `0xD100D0` | `Take(creature, count)` — the entry listing it, minus count, floor 0, then `0xBB49C0(this)` |
| +0x0C | `0xD10150` | `Available(creature)` — the entry's count |
| +0x10 | `0xD101B0` | `Items(vector<Item44>* out)` — the screen's lines, 0x2C bytes each |

`CHireWindow::Init` (`0x83E340`, arg4 = the source) calls +0x00 and
+0x10; the buy is `CHireCreaturesCmd` (`0x8456F0`: player, hero, army,
source, creature, count, bool — refcounted pointers), whose Execute
(`0xC60240`) asks the source `Available(creature) ≥ count`, `0xB433E0(army,
creature)` for room, pays through the player (`vt+0x94/+0x138/+0x180`),
`Take`s, and adds the stack (`0xAB9790`) to the army (`vt+0xC`). Before
that it walks `source+4+vbtable[8]` (the object base) → `vt+4` → `vt+4`
and compares with the hero's owner (`vt+0x2C`) — the refcount/owner shape
a source of ours has to carry, as the count window's controller carries
its (`native/ui/count-window.c`). The command's serializer (`0x797F30`)
writes the four objects by id — a source without a world id is a
single-player thing, which Lua already is.

So the camp of ours: a hire-source object of ours (five slots + the base
shape), its entries from a store of ours keyed by town (game vars, or the
DLL's), the screen asked for exactly as the dwelling visit asks, from the
town button (Lua → `H5ECampScreen(town)`); the weekly roll ours. The
town's own hire vector is never touched.

**The pieces (Senya, 2026-09-22):** the roll is FULL RANDOM over every
creature the game has — the mod's own included, read off the creature
table at its ceiling, not a list — with filters as arguments (the
building's camp will ask tiers 3–6 later). So:

1. DLL → Lua: `H5ECreatureCount([minTier, maxTier])` and
   `H5ECreatureAt(n [, minTier, maxTier])` — every creature there is,
   filtered, asked as a count and an index; Lua rolls from it. (First built
   as ONE call answering all the ids for `{ H5ECreatures(3, 6) }` to gather —
   in this dialect such a table keeps only the first result: launch 49
   pushed 119 and counted a pool of 1, which is why every camp sold
   footmen.)
2. DLL → Lua: `H5EHireScreen(creature, count, …)` — the game's own hire
   screen over a list of ours, one line per creature; and the event
   `H5EHireBought(creature, count)` back when the player presses hire, heard
   at the window's own "hire" rather than at the command (the window builds
   the same command to ask "may he?", and listening there sold the whole
   stock on opening — launches 44–48). The stock itself is the Lua's game
   vars; the DLL keeps nothing past the screen.
3. The faction's Lua: the camp with three levels for the test town — new
   week (NEW_DAY, day 1): per town with the building, roll and stock;
   the button → the screen → write the count back; the level of the
   building sets the stock (or the tiers).

#### As built, 2026-09-22…25 (launches 42–50) — WORKS

Senya's rule, and the shape everything below follows: **the DLL lends
primitives and events; every piece of logic is Lua.** The extension holds
no state past an open screen and knows nothing of camps; the same doors
serve a caravan, a black market or a quest reward written tomorrow.

**The doors (native/lua/creatures.c, native/ui/hire-screen.c):**

| Lua | what |
|---|---|
| `H5ECreatureCount([minTier, maxTier])` | how many creatures the table holds in those tiers, the mod's own included (read to the ceiling the installer set) |
| `H5ECreatureAt(n [, minTier, maxTier])` | the id of the Nth of them, 1-based, table order; nothing past the last |
| `H5ECreatureTier(c)`, `H5ECreatureGrowth(c)`, `H5ECreatureTown(c)` | record `+0x8C`, `+0xA8`, `+0x98` |
| `H5ECreatureCost(c [, resource])` | the price of one; gold by default (resources at record `+0xB0`, see below) |
| `H5EHireScreen(creature, count, price, …)` | the game's own hire screen over that list, on the town screen that is up; THREE a line — the price in percent of the creature's own cost, all seven resources scaled alike, rounded down (100 ordinary, 200 double, 0 free); lines until they run out, the order the script's, one line per creature |
| `H5EHireOpen()` | 1 while a screen of ours is up |
| event `H5EHireBought(creature, count)` | said to the map (one line + one scheduler tick, as the town button does) when the player presses hire AND the screen's checks passed — the script pays, gives, writes down what is left |
| `H5EHireCost(creature, count [, resource])` | what that many cost on the open screen in one resource (WOOD 0 … GOLD 6, gold by default) — the number the screen showed and checked |
| `H5EHirePay(creature, count)` | take that price from the buyer, the engine's own way (the payer's "pay if you can", which the screen's resource bar hears); 1 when paid or free, 0 when short. Inside `H5EHireBought` only — a line the script gives away it simply does not pay for |
| `H5EHireLeft(creature, count)` | what the open screen has left of a creature — the script says it after it sold; the window reads the list again the moment the event returns |

**The camp (src/mods/camp-script.ts → `TownSpec.script`):** the button's
function `BonePit(town)` reads the building's level
(`GetTownBuildingLevel(town, TOWN_BUILDING_SPECIAL_1)` — the Lua name, not
`TB_SPECIAL_1`); on the first click of a new week it rolls ALL THREE offers
at once — three DIFFERENT creatures of tiers 3–6, drawn without putting back
(each draw picks among the indices left and steps over the taken ones),
count = the creature's weekly growth — and keeps them in game vars under
`h5e.<fn>.<town>.c1/n1…c3/n3`, so a save carries them. The level only OPENS
one, two or three of them (an upgrade never re-rolls) and sets the price
it hands the screen with every line: 200, 100, 50 percent. `H5EHireBought`
pays with `H5EHirePay` (stopping when that fails),
`AddObjectCreatures(town, …)` (the garrison, hero or not), takes the count off
the first slot of that creature and says `H5EHireLeft`. A price per line is
the point (Senya, 2026-09-25): a tier cheaper, a first tier free, free for a
hero with some skill — the script decides at each opening. `tools/test-camp-script.ts`
lints it, checks every name it shouts against `advmap-startup.lua`, and
tries every outcome of the draw for pools of one to eight.

**Inside the screen — the hire source.** An object of ours laid out as a
dwelling's: the entries vector `{count, vector<creature>}` 0x44 bytes before
it (so the engine's own `Entries`, `CopyEntries` and `Items` run on it
unchanged), our `Take` and `Available`, stubs that log for the other
eleven slots. Its vbtable `[1]` and `[2]` both lead to **the town's real
object base** — the screen casts that base to `IAdvMapTown` (`0x840833`)
and reads liveness, refcount and owner off it; a block of ours there died
in VCRUNTIME (launch 43). The request is built with the town button's own
arguments (`0x84FD4D`: `number` is the address of a preselected creature
id, 0 here; the army is `object→vt90→vt04→vt2C`).

**Inside the screen — where a sale is heard.** `CHireWindow` carries an
interface at `+0x40` whose first two virtuals both build the same
`CHireCreaturesCmd` from `(object, creature, count)`:

- `+0x00` (`0x83E9F0`) — the DEED: hands it to `Do`; called by the hire
  button (`+0x4422CF`);
- `+0x04` (`0x83ED70`) — the QUESTION: hands it to `CanDo`, answers in `al`
  whether the button may be on; the window's refresh asks it over and over,
  counting down from the stock (`+0x43F5DC`: 10, 10, 9, 8 … 1).

Both are detoured: for a window whose source (interface `+0x1C` == 1,
`+0x20`) is ours, the question is answered THE ENGINE'S WAY — the three
calls `Execute` makes (`0xC6030E` what is left, `0xB433E0(army, creature)`
room, and money unless the free byte is set — asked on the purse itself,
seven ints at `payer+0x3C`, as `0xA462C0` asks it, because the payer's
`vt+0xE0` that Execute calls is "pay if you can" and PAYS),
fed from the words around the interface (payer `-0x0C`, army `-0x04`, free
byte `+0x08`) and the LINE's price — so the button goes dark where the
engine's own would. The deed asks the same once more and, if it passes,
only says `H5EHireBought`: the script sells and says what is left. The
price the window draws comes from `0xABA5A0(line, int out[7])` (the refresh,
`0x83F6F9`, on the selected line at `window+0x1A0`), which is replaced whole
— for a line of ours on our screen it is the line's price, so the panel shows
it and paints it red when it is too much. The third gesture
is "hire all" — the interface's `+0x10` (`0x83E7F0`, `(manager,
vector<{creature, count}>*)`, `ret 8`), which builds one
`CHireMultipleCreaturesCmd` (vtable `0xF72C84`) whose Execute (`0xC604C0`)
runs a `CHireCreaturesCmd` per line through the generic runner `0xBF8BF0`.
For a list of ours it is taken like the single hire: each line of the plan
asked afresh (the money the line before spent is already gone —
`SetPlayerResource` is immediate) and told to the map. The command's own
`Execute` (`0xC60240`) is detoured too, and since neither purchase of ours
ever builds a command that runs, what reaches it is a QUESTION — the
window's plan for "hire all" is checked through `CanDo`, which runs Execute
(via `0xBF8BF0`) — and it is answered, with the command's own payer
(`+0x10`), army (`+0x14`) and free byte (`+0x24`). A wall answering "no" to
everything left "hire all" dead (launch 52).

**The traps, each paid for by a launch:**

1. *The screen emptied itself on opening* (launches 44–48). The first
   detour sat on `Execute` and called every arrival a sale; the window's
   first "may he hire ten?" sold ten. A question is not a purchase — listen
   at the gesture.
2. *The price was 0* (launch 46). The `Cost` struct starts at record
   `+0xAC`, but its first word is not a resource: its serializer
   (`0xA82480`) writes Wood at `+4` … Gold at `+0x1C`, so gold is at
   `+0xC8`. Execute itself reads `+0xC8`.
3. *Always a footman, in every slot* (launches 45–49). `{ H5ECreatures(3,6) }`
   — one call pushing 119 ids — became a table of ONE in this dialect; the
   script counted a pool of 1 while `random` gave 23 and 38. Lists go to
   Lua as a count and an index. (Memory: homm5-lua-table-keeps-one-result.)
4. *Buying in the second slot took from the first* (launch 49). The engine
   tells lines apart by the creature alone — the command says "this many of
   that". Hence the three different creatures, the screen dropping a
   repeated creature, and the purchase taking from one slot only.
5. *Bought twice out of ten* (launch 44) — skipping Execute skipped its
   `Available ≥ count` guard; the deed clamps now.
6. *`AddObjectCreatures` does not add* — it queues a command on the adventure
   map (`0x5DAA50` ends with the map's `vt+0x04`), and the world runs its
   queue after the screen closes. Reading the garrison back a line later
   always says the old number; it is right on the next visit.
7. *`TB_SPECIAL_1` is not a Lua name* (launch 42) — see the linter TODO.
8. *The camp could not be upgraded* — `slot` moved only level 1's grid
   cell; levels 2–3 stayed on the donor's cell and were dropped
   (`moveGridCell` moves every level on the cell now, test-faction-mod).
9. *A creature of ours showed as townless* (launch 50: the Test Lich Master,
   "no town" in the tooltip, the random dwelling's picture). The hire screen
   finds a creature's dwelling by walking its town's `buildings` for a
   `TownBuildingSharedStats` whose `Creature` (`+0x9C`) OR `Creature2`
   (`+0xA0`) is it (`0x849170`, via `0xAC0CB0` = the `TOWN_ANY` group). The
   copier wrote `Creature` and left `Creature2` — the expansion's second
   upgrade — as the donor's, so the Test town's upgraded dwellings went on
   hiring Haven's Zealots and Seraphs, and its own second upgrades had no
   dwelling at all. `TownSpec.dwellings[tier].alternate` now fills it
   (`CREATURE_UNKNOWN`, shipped data's own "none", when a tier of ours names
   no second one), the Factions window has a third selector per tier, and
   `test-town-buildings` checks all three. Neutrals (the elementals) are
   townless by right and keep the random picture.
10. *The screen sold what the script refused* (launch 51: five executioners
    at double price, 1000 each with 959 in the purse — the screen counted
    5 → 0, the script took nothing and gave nothing). The deed took from the
    list before the script decided, and the screen priced by the record. Now
    the script says what is left, and the screen knows the line's price.
11. *A full army swallowed the purchase* (launch 51: seven stacks, the
    purchase went through, the creatures were gone). The engine asks
    `0xB433E0` for room; our question did not. It does now.
12. *"Hire all" did nothing* (launch 52). It is a gesture of its own and a
    command of its own, and its plan is checked through Execute — which our
    wall answered "no". Taken at the gesture; Execute answers questions.
13. *An install that did not happen* (launches 51–52): the installer cannot
    replace `bin/homm5-editor.dll` while the game is open (EBUSY), and a
    launch then tests yesterday's DLL. The load report's own lines say which
    build is in (`answered out of the list` vs `the engine's way`).
14. *Money gone with nothing bought* (launch 53: only "+" and "−" on the
    count). The money question called the payer's `vt+0xE0` — CPlayer's
    `0xC05720`, which compares the purse (`+0x3C`) with the cost AND
    subtracts it — and the window asks on every refresh, so every click
    paid the line's price. The question reads the purse now; nothing pays
    but `H5EHirePay`.
15. *The resource bar kept the old purse.* `SetPlayerResource` is a command
    queued on the adventure map (`0x5CF357` → the map's `vt+4`), which the
    open screen does not hear; the engine's own payment tells its listener
    (`payer+0x144`). Hence `H5EHirePay`, through that payment.

**Open:** the screen's left tabs (caravans…) show; hiding them is a flag
on `H5EHireScreen`, later.
Opening from the adventure map (a dwelling's visit, `0x767107`) is not
written — only from the town screen.

**TODO, after the camp (Senya, 2026-09-22): the shipped refugee camp's
pool.** `MapObjects/Special/RefugeeCamp.xdb` lists 38 creatures by name
(tiers 3–6 of the six original races; Fortress and Stronghold were never
added), and the roll is `pool[int(38·r)]` — a creature the mod adds never
shows up there. Fix: the mod build writes its own copy of the record with
the pool extended, through the same tier filter the extension's
`H5ECreatureCount`/`H5ECreatureAt` apply (tiers 3–6).

**TODO (Senya, 2026-09-23): the Lua linter should know the game's
constants.** `src/script/lua-lint.ts` checks GRAMMAR — blocks, `return;`,
`false`, the library names this engine does not register — and knows
nothing of the vocabulary a map is written against. So
`GetTownBuildingLevel(town, TB_SPECIAL_1)` passed it and the game said
"Value was NIL when getting global with name 'TB_SPECIAL_1'" at every
click (the Lua name is `TOWN_BUILDING_SPECIAL_1`; `luaBuildingName()` in
src/mods/camp-script.ts converts one to the other). The check exists for
the camp's script only — `tools/test-camp-script.ts` reads
`scripts/advmap-startup.lua` and refuses a shouted name it does not
declare. It belongs in the linter, for every script the editor writes or
lints: read the declarations out of the mounted `advmap-startup.lua`
(they are data, so a mod or a map may add to them), warn on an ALL-CAPS
name that is neither declared nor assigned in the file, and keep it a
WARNING — the vocabulary is the install's, not ours.
### 2c. A stage per building — later (Senya, 2026-09-19)

The exterior has ten stages, chosen by the engine from the hall, the walls
and the guild (`0xAC7980`, item 1e). A faction of ours should be able to
show a model of the town for ANY building built — the stage table grown
past ten in the DLL, the chooser ours, `TownSpec.exterior` naming a model
per building. Not started; after the faction entity (§5) stands.

### 2d. Arenas of our own — later (Senya, 2026-09-19)

A battle arena of ours (the field a fight is drawn on: ground, obstacles,
lighting, the siege layout) — the same shape as an own exterior stage or an
own screen: a scene of ours where a shipped one stood. Guides exist on the
net for authoring arenas for this game; read them first. After the faction's
own siege parts, which are arena work too.

### 2e. The town screen as a scene to edit — decision pending (2026-09-19)

Senya's picture: a dialog that RENDERS the town screen — the location loaded,
the buildings appearing on it — where a building can be switched off and
MOVED, and its pick hull moved with it (what the shipyard's spot and the
graves did by numbers). What it takes: the ArenaDesc scene drawn (static
models under the baked lightmap, cameras, one ArenaModObject per building
and level), a drag that rewrites the model's positions (the one array a
geometry keeps a coordinate in — what `place`/`at` already do), and an
AIGeometry hull WRITTEN for the moved model (today a hull is a container the
geometry tools do not rewrite: the shipyard's hull serves the graves — the
open debt). The renderer for it is the asset editor's scene switch
(SLICE_asset_editor.md on `fx/engine-playback`, §2: one renderer, the map
and the arena as backgrounds, TransformControls from the three.js editor);
a viewer of its own here would be a second renderer to keep in step. The
recommendation on record: build it AS that switch when the asset editor's
foundation stands, not before; until then the data side keeps going (siege
parts of ours, music of ours), which needs no viewer.

### 3. Fixes: large addresses — DONE (2026-09-19, `src/exe/large-address.ts`, the `large-addresses` flag in the Crashes group, off by default)

The executable is not `LARGEADDRESSAWARE`: 2 GB, and a faction's copied
town plus 21 creatures' art leave ~800 MB free in the menu. A one-bit
patch of the PE header, offered as a separate entry in the fixes list —
optional, off by default, next to the H5_DLL ports.

### 4. Research still open

The AI's race-indexed values are not only a crash to avoid: once read,
they are a faction's AI PARAMETERS — what it builds and when, what it
values — and a field of the faction entity (§5) later, editable like the
rest.

- 8-wide compiled arrays indexed by race — **SWEPT 2026-09-19** (FACTIONS.md,
  "What the executable compiled per race"): every `switch (type - 3)` in
  the image, with what its default arm hands a ninth race. Three matter
  and are rows of the races file now (`native/faction/race-traits.c`,
  fields of `FactionSpec`): the AI's worth of a skill (`0xD96BB0` reads
  `AIRacesValues` for the hero's race, −1 for ours → `ai.skillsLike`, and
  `ai.skillValues` per skill), the race's alignment (`0xB43E80`, 18
  callers — morale, joining, six creature bonuses; ours neutral →
  `alignment`), the random-dwelling group (`DWELLINGS_<RACE>`, two
  compiled switches, empty for ours → `mapDwellings`, the group document
  and its `RPGRoot` entry written). There is no "morale between races"
  table — the morale is the alignment plus a same-race test — and the
  tavern's order is the enum's. Everything else the sweep found is stats
  (Ubi.com W/L keys), the engine's own generator (an unknown race becomes
  random), or the town screen (already ours). Not launched: an AI player
  of the race (Senya's half).
- The generator with nine races — **DONE 2026-09-19** (`src/rmg/races.ts`).
  Where a ninth race enters the engine's generator: a player's slot (the
  lobby's list, `RaceCount()` — both the extension's file with the DLL in),
  a template's `<Setting>` naming it, and the random town's and dwelling's
  draws over `RaceCount`; NOT the surface/underground zone lists, which are
  eight constants pushed in `LoadTemplate` (a non-player zone is never ours,
  in the game or in the port). The port now takes the enum from the
  install's `types.xml` (`RACE_TEST`, its `TOWN_TEST`) and the slot list
  from `bin/homm5-editor-races.txt` when the executable imports the
  extension, so the dialog offers the ninth race and a generation with it
  matches the game's. The preset row is the faction build's clone of the
  donor's.
- Multiplayer: the races file and the mod must match on every client;
  what the lobby compares. STILL OPEN — it is the lobby's business
  (h5e-lobby, the agent in native/net/): a client whose races file is one
  row short seats a different picker, and a client without the mod has no
  town for the type. The cheap answer is the mod archive's hash and the
  races file's hash carried in the room's description, compared by our
  lobby before a game starts; not begun.
- Lua — DONE 2026-09-19: the faction's script defines `TOWN_<NAME>` as the
  game's Lua numbers towns (from zero: `GetTownRace` answers the type less
  three), so a map script compares `GetTownRace(t) == TOWN_TEST` like any
  shipped one.
- The launch of 2026-09-19 (an AI player of the race, two weeks): the AI's
  level-ups ask the hook skill by skill and get Necropolis's values; every
  stack's morale under a hero of the race read 0, which the morale function
  (`0xB45C80`, per stack: +1 the hero's race, −2 the opposite side, −1 for
  an opposite stack in the army, +1 an army of one race, −1 three races)
  does not predict — the alignment hook logs its askers now; the next
  launch says whether the morale ever asks about race 11.

### 5. The faction entity in the editor — started 2026-09-19

Started before §3–4 by decision (2026-09-19): the registries stopped
changing at 1e/1f, and what §2b–§4 add are FIELDS (an effect of ours, AI
parameters, a stage per building), which a dialog grows by a widget, not
by a rewrite. The dialog is a build grid like the game's (one building
per cell, a level per cell, a dependency below its requirement in the
same column with no building between); "donor" is a button that fills
everything from a shipped town, as the creature dialog's is. The e2e that
builds the probe's "Bone Court" through the palette is the probe's
replacement.

**Files of our own (2026-09-19).** Senya: "our own" is the same copy from
another source — wherever the form takes a donor's, it takes a file of
ours. Done: a building's screen model, an exterior stage's model
(own-files.ts mounts the folder as a data root), every icon as a picture,
the picker's tooltip and a named town's bonus text, the siege parts
(siege-parts.ts: an object of ours shaped as the donor's, per ruin level).
the race's tracks (`RaceSpec.tracks`, loose .ogg files under Music/H5E/).
the gate hull (`ExteriorMix.gates` as an AIGeometry file), the capture sign
and flag (`pictures.capture`, per colour or for all).
the ambient loop and the buildings' clicks (`RaceSpec.sounds`, uid-keyed binaries in the archive).
Not done, said
honestly: the town SCREEN itself (the ArenaDesc scene — background, lightmap,
cameras — stays the donor's; ours replace its buildings one by one; a whole
scene of ours is the asset editor's business, item 2e).

When 1–4 have stopped changing the list above: `FactionSpec` in the mod
model, `faction-files.ts` writing every registry in the table, the races
file written by the install, a window in the editor with the creature
row, the town (donor, siege, icons, buildings), the heroes, the named
towns; the probe deleted. The rule from the creature mod applies: the
example lives in the editor first, the mod follows the working scheme.

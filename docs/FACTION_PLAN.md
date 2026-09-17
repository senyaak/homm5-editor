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

- **1a. The building tree.** Every record's `dependencies`, `Cost`,
  `DevLevelNeeded`, the grid's slot positions, the upgrade chains — all
  data in the copied records and `TownBuildDefinition`. `TownSpec` gets a
  `buildings` description the copy applies (rename, recost, re-parent,
  drop a building, drop a whole slot).
- **1b. Custom buildings.** `ETownBuilding` has `TB_SPECIAL_0…9`; a town
  uses four or five. A building of ours in a free slot needs: a record, a
  place on the grid (`UIObjectName`), a model in the screen
  (`ModObjectName` — an `ArenaModObject` added to the interior's object
  list, with a model copied from anywhere), an icon, texts. **Unknown:**
  what the engine does when a special of a type it never compiled is
  built — nothing, most likely, which makes it an inert building we can
  hang an effect on ourselves (a DLL hook on the build event, or a Lua
  trigger where Lua runs — not in multiplayer). One launch answers it.
- **1c. Magic.** `MagicSchool_0/1` in the shared document are the guild's
  two schools — set them. **Unknown:** how the guild draws its spells per
  level (`UndividedSpells.xdb`? the spells' own school and level?) and
  whether a school of ours reaches it. **Unknown, and the one that
  matters:** where the engine decides spellbook versus warcries — the
  class record has no such field and Stronghold's town names Light/Dark
  like everyone's, so it is compiled, probably on the hero's `TownType ==
  TOWN_STRONGHOLD`. Found, it becomes one more column of the races file.
- **1d. The screen's own models.** Replace an interior building's model
  with one copied from another town or object; the interior's lightmap is
  keyed by the `ArenaDesc`'s uid in `bin/Lightmaps` — **unknown** whether
  a changed scene needs its own (the engine may bake).
- **1e. The exterior.** The ten stage models on the map: another town's,
  or a mix by level, the way the siege mixes.
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

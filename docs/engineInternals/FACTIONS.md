# A faction, and what a ninth one would cost

Read out of `H5_Game_H5E.exe` and `data.pak` on 2026-08-20, to answer one
question: is adding a faction like adding a spell or a creature, or is it a
different kind of thing? It is a different kind of thing. A spell is an entry
in a list the engine walks; a faction is a **dimension the engine's own
structures are sized by**. Nothing found here says a ninth faction is
impossible — but every step past the data is an executable patch, and this
page is the map of where those patches would go.

Nothing on this page is implemented in the editor. The probe at the end has
run (2026-09-17) and its verdict is recorded there; the rest records what was
measured so that a decision can be made from facts.

## One warning about the wrapped executable

`bin/H5_Game.exe.orig` is the Steam build: it carries a `.bind` section and
its `.text` is **encrypted** (Shannon entropy 8.000 — pure ciphertext). Its
`.rdata` however is byte-identical to our unwrapped copy at 99.99%. So a
string scan of the `.orig` *finds every string and no code reference to any
of them* — which reads exactly like "the engine never uses this", and cost
this investigation a wrong conclusion for a day (the town-hall screens below
were declared ordinal-addressed on that evidence). Measure code against
`bin/H5_Game_H5E.exe` only. String VAs are valid in both.

## The enum is closed, and says so

`types.xml` declares `TownType` with explicit ordinals:

```
TOWN_SPECIAL=0  TOWN_RANDOM_TYPE=1  TOWN_NO_TYPE=2
TOWN_HEAVEN=3   TOWN_PRESERVE=4     TOWN_ACADEMY=5   TOWN_DUNGEON=6
TOWN_NECROMANCY=7  TOWN_INFERNO=8   TOWN_FORTRESS=9  TOWN_STRONGHOLD=10
```

Fortress and Stronghold are appended at the end — each expansion added one
ordinal *and shipped a new executable*. The parallel `Race` enum is the same
list under other names (`typedef ETownType ERace;` says the comment) and ends
with **`__RACE_COUNT = 11`**. That terminator is the decisive difference from
every table we have extended: neither `CreatureType`, `SpellID`,
`ArtifactID` nor `HeroClass` has one. A `__COUNT` member exists for one
purpose — `something[__RACE_COUNT]` arrays and loop bounds compiled
throughout the image. Raising a count that code *compares against* is what
`src/exe/table-limit.ts` does; raising a count that code *allocated with* is
a different class of patch, one site at a time.

The compiled evidence of that sizing, all in `.rdata`/`.text`:

- `DWELLINGS_HAVEN` … `DWELLINGS_STRONGHOLD` (≈`0xbba370`) — the RMG's
  dwelling groups, exactly eight, no ninth slot;
- four parallel eight-wide UbiStats key arrays `W_*`, `L_*`, `H_*`, `G_*`
  (≈`0xbe4b84`);
- a console help string `"Towns: 1 = Haven, … 8 = Stronghold"` (`0xb5ccec`);
- `Skills.xdb`'s `<AIRacesValues>` — a struct with one **named field per
  race**, so a ninth race means a new field in a compiled chunk layout
  (skipping it only costs AI skill weighting).

## The table half is cheap, and already our shape

`/GameMechanics/RefTables/TownTypesInfo.xdb` is a reference-table-backed enum
exactly like `HeroClass`: enum item list, name→value map,
`ref_table_num_objs`/`MinElements`/`MaxElements` all saying 11, and a data
record per town (moat damage and spells, silo income, native war machine,
icons — nothing structurally hard). The registration site pushes the count as
`push 11` (imm8), and there is **one live accessor**: `mov eax,11; ret` at
`0xa9f0e0`, with six call sites (`0x8a10b3`, `0x8a6f3b`, `0xb95aeb`,
`0xb95d70`, `0xb9632e`, `0xd8ebf1`). Both are the two numbers
`table-limit.ts` already knows how to move; a `TOWN_TYPE_TABLE` spec is ~6
lines. Note this accessor sits *inside* the block HERO_CLASSES.md once called
dead — that page carries the correction.

`/GameMechanics/RefTables/RMGPresetTable.xdb` registers as `push 12`
(11 + `__RACE_COUNT`) and must move in lockstep.

## The town hall: solved, and by name

The first pass concluded the town-hall screens were addressed by position in
`UIGameRoot`. That was the wrapped-executable artifact above; the truth
measured against the clear binary:

**Screens resolve by name.** `LoadScreen(id)` at `0x6CDE40` (80 call sites)
funnels into `0x5BF010`, which linearly scans the `screens` vector
(`UIGameRoot+0x44`, 24-byte elements, ID string object at `+0x04`) with a
length check and a `memcmp`. Order in the `.xdb` is irrelevant; the ID must
match a literal compiled into the executable.

**The per-race town halls are dead.** Of the 95 screen IDs in
`UI/UIGameRoot.(UIGameRoot).xdb`, 76 have their literal in the binary and 19
do not — and the 19 are precisely the vanilla-H5 generation:
`N_TOWN_HALL_SCREEN_ID` and all six `_HAVEN…_INFERNO` variants,
`N_TOWN_BUILD_SCREEN_ID`, `N_HERO_SCREEN2_ID`, `N_FORT_SCREEN_ID`, the old
campaign and splash screens. The engine cannot ask for a name it does not
contain. The `UI/TownHall/<Race>.(WindowScreen).xdb` assets still ship, which
is what made them look alive; Fortress and Stronghold never got one, which is
the tell.

**What actually opens** is the generic `TOWN_BUILD_SCREEN` →
`UI/TownBuildNew.(WindowScreen).xdb`. The town controller's constructor
(`0x856ee0`) caches exactly two screens — `N_TOWN_SCREEN_ID` and
`TOWN_BUILD_SCREEN` — and the per-race content comes from the
`townBuildDefinitions` array (`UIGameRoot+0x144`, accessor `0x5C1FB0`, same
scan-by-name): the populate paths (`0x86c8a0`, `0x870c08`) take the town's
type, subtract 3 (`0xB4E720`), `sprintf` it through `"town_buildings_%d"`
(`0xf7506c`), and look the result up. This is how Nival added the expansions'
towns: `town_buildings_6` (dwarven) and `town_buildings_7` (stronghold) are
plain array items in the data — no new fields, no new screens, no new code.

So a ninth faction's town hall is **one data file** —
`UI/TownBuildNew/Towns/<race>.(TownBuildDefinition).xdb`, the building-slot
grid, ~330 lines by the stronghold example — plus an item
`town_buildings_8`. The `sprintf` produces the name for free once a town
reports type 11. No executable patch at the UI layer.

## Where the executable patches actually are

- **`0xB4E730`** — the index→townType conversion, `lea eax,[ecx+3]` guarded
  by `cmp ecx,7; jbe` — index 8 degrades to `TOWN_NO_TYPE`. Twelve callers.
  This is the first thing that must move.
- **`0xA96243`** — the townType switch with an 11-entry jump table at
  `0xA96338` (`cmp edx,0Ah; ja default`). A ninth faction needs a twelfth
  slot; note `TOWN_RANDOM`/`TOWN_SCRIPT_ONLY` are registered by a separate
  routine near `0xa9651e`, so the new number is not simply "next".
- The inverse `0xB4E720` (`lea eax,[ecx-3]; ret`, 16 callers) needs no
  change.
- **Racial mechanics are compiled classes**, one set per race:
  `AVCHavenTraining`, `AVCStrongholdSlaveMarket`,
  `AVCNecropolisTransformCreature`, the Inferno and Dungeon sacrifice
  screens; the racial resources themselves (necromancy, gating, rage, runes,
  training). ToE's own precedent for a new race's special screen was a new
  string literal plus new code — that path is not data-extensible.
- **Grail and special-building effects are compiled by name**
  (`Stronghold_GarbagePile_GoblinGrowthAddition` and friends).
- **The RMG's race knowledge is engine-side**: `RMGRaceTable.xdb` ships
  empty, and the dwelling groups are the eight-wide compiled array above.

Unresolved tail, honestly: 12 of the 80 `LoadScreen` call sites take the id
as a parameter rather than an adjacent literal (`0x641f63`…`0x6cdf88`).
Their callers were not traced; the argument still lands in the same
`memcmp` scan, so a compiled name is still required somewhere, but a table
of ids feeding them has not been ruled out.

## The size of the data, for scale

956 `.xdb` files carry a `TOWN_*`/`RACE_*`/`HERO_CLASS_*` token
(GameMechanics 514, Maps 242, MapObjects 177, RMG 19, Campaigns 4); on top of
that ~4,500 `UI/TownHall/*` files and ~1,400 text entries are per-faction by
directory. A placed `AdvMapTown` has no `TownType` field of its own — the
faction lives entirely in which `MapObjects/<Race>.(AdvMapTownShared).xdb`
it points at, and that one file ties together the map models, the town
screen, the siege arena and all ~36 building records. And the naming is
inconsistent per subsystem, so there is no single string to substitute:
Necromancy/Necropolis, Preserve/Rampart/Sylvan, Dwarves/Fortress,
Stronghold/Orcs, Haven/NewHaven.

## Verdict, and the probe that would settle it

Possible — nothing found is a wall — but it is executable work of a kind the
spell and creature ceilings never needed: the two patch sites above, then one
site per `__RACE_COUNT`-sized structure as each is met, then native code for
any racial mechanic the new faction is to have — and that is the path this
tool takes. The mod scene's workaround — replace an existing faction in
place, keeping its ordinal — exists precisely because of this ledger, and is
not ours: a ninth faction means a ninth slot, with the arrays reallocated
and the mechanics added natively through the extension (see
[EXTENSION.md](EXTENSION.md)).

The cheap decisive experiment, in the spirit of
[EXTENSION.md](EXTENSION.md)'s two probes: raise `TownType` to 12 with a
twelfth record that is a byte-for-byte clone of Heaven's, patch
`TownTypesInfo` 11→12 with its accessor, `RMGPresetTable` 12→13, the clamp
at `0xB4E730` and the jump table — and just load a map. That answers whether
11 is an allocation or a bound, for a day's work, without authoring a single
asset.

**Built and installed 2026-08-26** (`_tmp/town12-probe.ts`, untracked): the
archive `H5E/town12-probe.h5u` carries types.xml (+`TOWN_TEST`=11,
+`RACE_TEST`=11, `__RACE_COUNT`→12, both tables' declared sizes moved) over
the editor mod's copy by mtime, plus both ref tables with the cloned Heaven
record; the executable got all four patches. What the build taught:

- `TOWN_TYPE_TABLE` is now a real spec in `table-limit.ts`, and the test
  covers it. `RMGPresetTable` deliberately has NO spec: it ships no live
  accessor, and once the town table sits at 12 the value-anchored accessor
  search for {12, 13} would find the TOWN accessor (`0xa9f0e0`, now
  returning 12) and write the RMG count into it. Its push moves by
  `findLoadSite` alone.
- The `cmp edx,0Ah; ja +0xa1; jmp [edx*4+…]` shape occurs FOUR times
  byte-identically — `MAE_*`, `AWARD_*` and `ARTFSET_EFFECT_*` have twin
  switches (`0xa9b703`, `0xa9eae3`, `0xceb443`) — so any signature for the
  town switch must carry the jump table address `0xa96338`, and the probe
  additionally verifies slot 3 pushes the literal `TOWN_HEAVEN` string.
- All four jump tables are followed by int3 padding, so the twelfth slot is
  written over `0xa96364` and points at Heaven's own handler: townType 11
  stringifies as `TOWN_HEAVEN`, which is what a clone should say.

## The probe ran: 11 is a bound, and the race picker has its own ledger

Run 2026-09-17 (`_tmp/town12-probe.ts`, installed 2026-08-26). **The game
starts and loads a map with `TownType` at 12** — the table registration,
its accessor, the clamp and the jump table were the whole cost of *existing*.
Nothing sized by `__RACE_COUNT` fell over at startup.

What did not happen: the twelfth town does not appear in the scenario
setup's race picker. That picker is not driven by `TownType` at all but by
a second, smaller ledger — the **eight-race UI order** — and every part of
it is compiled:

- **`0x1090E0C`** (`.data`) — `int[8] = {3, 8, 7, 4, 6, 5, 9, 10}`: the
  picker's order, Haven → Inferno → Necropolis → Sylvan → Dungeon → Academy
  → Fortress → Stronghold. Three code references, all below.
- **`0xB4E700`** — `RaceCount() { return 8; }`. Sixteen callers: the wait
  screen's logic (`0x8f22ca`, `0x8f22ee`), the players-state builder
  (`0xb8db88`), the console (`0xb53dcd`, `0xb554cc`), the engine's RMG
  (`0xc3b6f2`…`0xc3b89b`, `0xc80864`…`0xc80a46`) and two more at
  `0xd0fa47`/`0xd0fae6`.
- **`0xB4E760`** — `TownOfIndex(i)`: `cmp ecx,8; jae → TOWN_NO_TYPE`, else
  the table. Seven callers, six of them the players-state builder.
- **`0xB4E740`** — `IndexOfTown(t)`: linear scan of the table, bound 8,
  −1 when absent. Three callers, all the players-state builder.
- **`0xB4E7D0`** — a `{kind, index}` selector: kind 3 reads the table,
  anything else is `index + 3`. Four callers.

How the picker uses it (`0xB8DA60`, the builder of the per-player state the
wait screen edits): for every player it walks `i = 0 … RaceCount()−1`, tests
bit `i` of that player's **allowed-race bitmask** (built a few lines earlier
from the map's player records, through `IndexOfTown`), and `push_back`s
`TownOfIndex(i)` into the player's `vector<TownType>` at `+0x50`. The arrows
(`CMPWaitItem` → action 3 → `CMPWaitChangeRequest` →
`CMPUbiComWaitHostLogic::+0x14`, race branch at `0x8f351d`) step an index
through *that vector*; index −1 is "random" (`TOWN_RANDOM_TYPE = 1`), and
`CanChangeRace` is simply `vector.size() > 1`. The item's own textures are a
compiled `map<TownType, texture>` built in its constructor (`0x8f8480`…)
from the names `race_haven` … `race_stronghold` in
`UI/MPWait/PlayersList/Item/Races.(WindowRelatedTextures).xdb` — note the
literals `rece_necropolis` and `rece_fortress`, typos the data file repeats.

So a twelfth `TownType` exists to the engine but is invisible to the player
until this ledger is nine wide: a nine-entry table somewhere with room (the
words after `0x1090E0C` belong to neighbouring statics — `0.5, −1, −1, 25.0`
repeats before it too — so the table is relocated, not extended in place),
the three displacements re-pointed, `RaceCount` → 9, the two `cmp …,8`
bounds → 9, a `race_test` item in both `Races.(…).xdb` files and a tenth
literal for the constructor's map. That last one is the only part that is
not a number: the constructor's texture map is compiled name by name, so the
twelfth town's picker icon needs either a new literal in code or a hook that
adds the entry after construction — `homm5-native` territory, and the first
thing on this page that is.

Where this leaves the ledger: `TownType` (11 → 12, done), the picker (8 → 9,
above), and then whatever the next screen meets — the hero picker for the
chosen race, the starting bonus, the town screen (`town_buildings_%d`, no
patch), and the `__RACE_COUNT`-sized arrays the RMG and the AI weights own.

## The picker is ours now: the second step of the probe

Built 2026-09-17, same day, and not as an in-place widening. The table
**moved out of the executable**: `native/faction/race-order.c` reads
`bin/homm5-editor-races.txt` (one `race <townType> [pickerTexture]` line per
entry, in picker order — `src/mods/race-order.ts` writes it) and detours the
four accessors onto readers of that table. None of the four ever returns into
the engine's code: each is the whole function, so the compiled eight stay
where they are, unread. The icon is the constructor detoured — the engine's
runs first, then every row naming a texture is looked up through the item's
own related-textures widget and put into the same map the same way
(`operator[]` at `0x8FAE20`, the refcount raised, the byte cleared).

The probe (`_tmp/town12-probe.ts`) now also ships, in `town12-probe.h5u`, a
`race_test` item in both `Races.(…).xdb` lists with its two texts, a hero of
the race — Haven's Alaric copied to `MapObjects/Test/` with one field changed
— and a **town** of it: Heaven's `AdvMapTownShared` copied to
`MapObjects/Test.(AdvMapTownShared).xdb` with `Type=TOWN_TEST`, added to
`MapObjects/_(AdvMapSharedGroup)/Towns/any.xdb`. That group is what a map's
random town is drawn from — the engine takes the member whose `Type` is the
player's race — and it is why the probe needs no map of its own: the
players-state builder makes a player's choices from the races of what he owns
(reserve heroes, then towns, then heroes on the map; nothing at all means
every race), and for a town of `TOWN_RANDOM_TYPE` it walks `RaceCount()`
indices through `TownOfIndex`, skipping the map's banned list. Any shipped
multiplayer map with random towns puts the twelfth town in front of the
arrows. (A first cut built a map from Rules Test — no towns, and a player who
already owns heroes of fixed races gets no choice at all. Wrong map.) The
town screen's `town_buildings_8` is added to the editor mod's `UIGameRoot`,
pointing at Haven's grid.

Two things here are read from the code and not yet seen in the game: that the
hero record's word at `+0x164` is his `TownType` (it is what `IndexOfTown` is
handed for each owned hero, and `TownType` is the only race-shaped field the
hero's reader writes), and what happens after "Test" is chosen — the starting
hero of a race with one hero, the bonus, the first town screen. The launch
says.

## What a race needs before its first turn

Read out of three launches on 2026-09-17, each one screen further:

- **The picker's tooltip** is compiled like its icon: the constructor's helper
  `0x8F6B00` fills `map<TownType, String>` at the item's shared tooltip object
  (`+0x108`, map `+0x30`) from `race_tooltip_haven` … `race_tooltip_stronghold`.
  A row's third word in the races file is put there the same way.
- **A random town becomes the race's town** through `RPGRoot`'s `TOWN_ANY`
  group (`MapObjects/_(AdvMapSharedGroup)/Towns/any.xdb`): `0xAC0CB0` walks
  the members and returns the `AdvMapTownShared` whose `Type` (`+0xFC`) is the
  race. So a town of ours is a shared in that group and nothing else.
- **A random hero of the race** comes from `HEROES_ANY`
  (`…/Heroes/Any.xdb`): `0xB911E0` takes a member whose `TownType` (`+0x164`,
  now confirmed) is the race **and whose `ScenarioHero` (`+0x1FC`) is false**.
  The first hero of the probe was Alaric, a scenario hero — the race had
  nobody, the player started with nothing and was out before the first turn,
  and the adventure screen came up for the next player, an AI, whose
  `CPlayer` has no log list (`+0x624`, made only for humans by
  `CPlayer::Init` at `0xC0312A`); `0x6DA580` asks that list for a kind-0x26
  entry without a null check and dies at `0xBF9684`. A launch with Haven on
  the same map was fine, which is what pointed at the race.
- A map's roster (`AvailableHeroes`) is explicit on every shipped map, so the
  probe's map (S1 under its own folder) lists the race's hero too.

**A fifth accessor, found by the hero picker (2026-09-17, launch six):**
`0xB4E710` — `IsRealTown(t) { return (unsigned)(t - 3) <= 7; }`, seventeen
callers. The wait screen's hero arrows call it before reading the race's
list (`0xB8D798`), so a twelfth town showed no heroes at all — the list
itself was fine (one entry, Brem, in the ninth of the `0x1207BE0` vectors)
— and the game then started its first turn with player 2. It is detoured
onto "is in our table" with the other four. The probe's state log
(`IPlayer::SetState`, `+0x650`) is what showed player 1 never becoming
active; the player dumps showed him otherwise whole.

## The race plays (2026-09-17, launch nine)

Two more widths after `IsRealTown`, and then the twelfth town started a game:

- **`TownSpecs`** (`GameMechanics/RefTables/TownSpecs.xdb`, 255): a random
  town becomes a town of the player's race by drawing a specialization with
  `TownType == race` (`0xB543E0`, the least-used first); none means no town,
  and no town means no hero (`HeroInTown`) and a player out before turn one.
  `TOWN_SPEC_TABLE` in `table-limit.ts` (push imm32, accessor `0xD268D0`).
- **Creatures of the race**: the hero's starting army (`0xC26FA0`) is the
  tier-1..3 BASE creatures whose `CreatureTown` is his race; none reads
  record 0 and dies at `0xC2E487`. Three through the editor's own creature
  mod (`_tmp/town12-units.ts`: ids 181–183, Necropolis donors, ceiling 184).

The start ledger, complete: TownType (11→12) · the picker's five accessors
(`RaceCount`, `TownOfIndex`, `IndexOfTown`, the selector, `IsRealTown`) ·
`TownSpecs` · creatures with `CreatureTown`. The probe's instruments stay in
`native/faction/start-probe.c` (`--log faction/start-probe`).

**What a town is** (read out of `Heaven.(AdvMapTownShared).xdb`): the shared
(Type, ten exterior stage models, tiles, `Interior` = the ArenaDesc town
screen, `Combat` = the siege arena, `buildings`, `MagicSchool_0/1`, icons),
~36 `TownBuildingSharedStats` records (Type `TB_*`, upgrade, cost,
dependencies, `Creature` for a dwelling, `ModObjectName` in the interior,
`UIObjectName` on the build screen, icon, texts), the `TownBuildDefinition`
grid + `town_buildings_N`, the `TownTypesInfo` record, `TownSpecs`, and
7 tiers × 3 creatures behind the dwellings. Compiled by name and left for
later: the specials' and grail's effects, the racial screens.

## The town is a copy (2026-09-17, launches ten to twelve)

`src/mods/town-files.ts`: the shipped town named by `donor` (found by its
`Type` in `Towns/any.xdb`) is copied whole by `copyArt` under
`Factions/<file>/town/`, structure preserved, and the top document moves out
to `Factions/<file>/<file>.(AdvMapTownShared).xdb` with absolute hrefs into
the tree; the build grid (`UIGameRoot`'s `town_buildings_<ordinal-3>`) is
copied beside it, and a palette link written. Haven: 1517 files, 79 MB,
fresh uids for every geometry, skeleton, animation and sound.

The copy has two boundaries, both learned by launching:

- **`stopAt` by document kind** — `CamerasSet`, `Character`, `CreatureVisual`,
  `Shot`, `AdvMapDesc`, `ArenaObstaclesGroup`. The default camera set names
  every combat camera in the game, hence every hero and creature that has one
  (9479 files, 380 MB without the stop); the siege towers' shooter is a
  creature; the siege scenery and obstacles are the biome's. Left in place and
  referenced by absolute path.
- **`leave` by path** — `Textures/Terrain/**` and the one
  `_(Material)/dev/Test/Malkovsky/CragTerrain.(Material).xdb`. Every exterior
  model carries a ground pad in the underground floor's texture, the skin the
  object shows on the rock floor; on the surface the engine hides it, and it
  knows the pad by that MATERIAL (one document, 458 models). Copied, it was a
  slab of rock under the town on grass; leaving the texture alone changed
  nothing (launch eleven); leaving the material did (twelve).

The town screen, the build screen and the siege all open out of the copy.

**Named towns.** A random town of the race is drawn a `TownSpecialization`
(name, history, one compiled `TOWN_BONUS_*`) from `TownSpecs`, the least-used
first; Haven ships twenty for random towns. `buildNamedTowns` writes one
document and two texts each under `Factions/<file>/towns/`,
`patchTownSpecTable` / `patchTownSpecTypes` list them (`ETownSpec` in both
shapes, the table's size), and the executable's ceiling follows through
`TOWN_SPEC_TABLE`. The probe reads them from `_tmp/test-towns.json`.

Still Haven's inside the copy: the 14 dwelling records' `Creature`, the
building texts and icons, the magic schools (a spec field), the race's name
in the town window (the name switch's twelfth slot points at Haven's handler).

## The twelfth slot lied under ASLR (2026-09-17, launches 14–17)

Three sieges of the copied town died at three different addresses, and the
log stopped without a report each time. The reports were widened (every
exception is written now, the C++ throws included, with the address space
left — `native/core/faults.c`), and the fourth siege said `0x80000003`, a
breakpoint, at the runtime address that maps to `0xDF627D`: int3 padding,
with `edx = 11`. The town-name switch (`0xA96240`) jumps through a table of
eleven; the first probe had written a twelfth slot over the padding after
it, a raw dword pointing at TOWN_HEAVEN's handler. That dword is in no
`.reloc` entry, so when the loader puts the image anywhere but `0x400000` —
most launches — the eleven shipped slots move and ours stays, pointing into
whatever the padding became. The siege was merely the first thing to ask for
the name at an unlucky base.

The name is the DLL's now: `town_name_hook` (`race-order.c`) answers a type
past the compiled eleven from the races file, whose second word is the
enum's spelling — `race 11 TOWN_TEST race_test race_tooltip_test` — and the
executable's switch is left as shipped. One more table that grows in our
DLL, not in the executable ([[new-engine-tables-live-in-our-dll]]).

With the name honest, one more registry keyed by it showed itself: the
initiative bar's tower portraits, `UI/CombatScreen-Heavy/ATBBar/
AdditionalIcons.(WindowRelatedTextures).xdb`, `TOWN_HEAVEN → Tower_Heaven`
— a type absent from it queues as a white square. `patchTowerIcons` adds
ours, with a drawn portrait.

## The town, filled (launches 13–18)

- **Dwellings** hire the faction's own row: `TownSpec.dwellings` by tier,
  base for `BLD_UPG_1`, upgrade for `BLD_UPG_2`; the second upgrade is the
  creature's own `Upgrades`. The creature model carries the links now
  (`stats.base`, `stats.upgrades`, `PairCreature` from them); a preset
  drops the donor's links, so a copy of the Archer does not upgrade into
  the game's Marksman.
- **The siege** is data through and through. `siege: TownType` takes
  another town's whole `Combat` block; `siege: { arena, walls, gate, towers,
  moat }` assembles one from five — the buildings stand at the same tiles
  in all eight towns (walls 11/13, 10/11, 10/5, 11/3; towers 12/15, 12/1,
  16/8; gate 10/8), each is one self-contained item, and the arena's object
  list is rewired to the parts' objects by what the arena's own building
  named (Dungeon's big tower is `s_central_tower`). Launched: Inferno's
  field with Necropolis walls, Dungeon towers, Academy's gate, Sylvan's moat.
  `siegeShooter` puts any Character and Shot on the towers — the faction's
  Skeleton Archer, out of the creature mod's copy.
- **Icons** are drawn, not borrowed: `src/format/paint.ts` (a small vector
  painter, supersampled) and `src/mods/faction-icons.ts` (one theme; 36
  building pictograms by type and level, the town's two, the race tile, the
  tower portrait). `TownSpec.icons` repoints every building record and the
  town's own icons to `Factions/<file>/icons/`.

- **The tree** is the spec's (`TownSpec.buildings`, not launched yet): a
  building's record is edited in the copy — texts written over the copy's
  own text files (one per record, none shared), cost by resource, town
  level — and its cell moved on the grid. A drop is done on the donor's
  document BEFORE the walk (the record is unlisted, so nothing it alone
  reached is copied) and on the grid (the cell, or the slot when it was
  the last); a level drops the levels above it. `requires` is written into
  the donor's record before the walk too, else the walk would reach the
  dropped record through the old list (the first run of the test caught
  exactly that: the Stables came along as the arena's dependency). A survivor depending on a
  dropped record is refused, since the engine would read a missing href.

Registries keyed by the type's NAME, for the faction mod to keep in one
list: the picker's textures and texts, the initiative bar's tower portraits.
By ORDINAL: `town_buildings_N`, `TownTypesInfo`, `RMGPresetTable`. By
membership: `Towns/any.xdb`, `Heroes/Any.xdb`, `TownSpecs`.

## Special buildings, the town screen, and magic (2026-09-17, read only)

- **`TB_SPECIAL_0…9` are numbered slots.** A record is data (cost,
  dependencies, level, texts, icon, `ModObjectName`, `UIObjectName`, grid
  cell); the MEANING of a slot is compiled per (town type, slot) — the same
  `TB_SPECIAL_3` is Academy's artifact merchant, Necropolis's Unearthed
  Graves, Stronghold's Travellers' Shelter (`scripts/advmap-startup.lua`
  lists every pair). The magnitudes are data under compiled names —
  `DefaultStats.xdb` `RPGStats/adventure/TownBuildingBonuses` (`adventure`
  at `+0x58`, the block at `+0xD4` of it: `Heaven_GrailLuckBoost` first,
  `Stronghold_GarbagePile_GoblinGrowthAddition` last) — and the screens
  are classes (`CHavenTraining`, `CStrongholdSlaveMarket`,
  `CNecropolisTransformCreature`, the Inferno/Dungeon sacrifice screens).
  No data ties a slot to an effect; a type of ours falls through every
  switch.
- **In the town screen** a building is an `ArenaModObject` named by the
  record's `ModObjectName` (`upgrades[level].ruins[ruin].Model`, level 0
  empty), a static camera `<Name>_cam`, an `AIGeometry` pick volume
  (`-geom-AI`), locators for creatures; the models are exported from one
  Maya scene in WORLD coordinates (`placement` all zero). The left jog-dial
  (`UI/TownScreen/`) is a fixed set of buttons, each an `ARSendGameMessage`
  the engine handles by name — `enter_hall`, `enter_fort`, `enter_market`,
  `enter_tavern`, `enter_blacksmith`, `enter_magic_guild`,
  `enter_shipyard`, `upgrade_creatures`, ONE `enter_special` (its target
  compiled per town; its skin one of eight `VisualStates` picked by town
  ordinal) and `buy_artifacts` (Academy's merchant and Stronghold's
  shelter alike).
- **Magic.** `MagicSchool_0/1` of the shared (`+0x124`, `+0x128`) are the
  guild's favoured schools; `0xAC3B50` (a `CAdvMapTown` virtual, no direct
  caller) returns them and the other two of {Destructive 0, Dark 1, Light
  2, Summoning 3}, defaults Light/Dark. Stronghold has no guild in data:
  no grid cells, five free stub records. Warcries are the Hall of Trial
  (`TB_SPECIAL_1` ×3) on the town side and `IHero::GetClass() ==
  HERO_CLASS_BARBARIAN` (slot `+0x258`, compared only to 1…8 across the
  executable) on the hero side, at sixteen sites listed in
  `FACTION_PLAN.md` §1c; `0x70CC7A` picks `CCreateOrcsSpellBook` over
  `CCreateSpellBook` (`UIGameRoot` `OrcsSpellBook` / `SpellBook`).



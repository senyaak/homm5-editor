# A faction, and what a ninth one would cost

Read out of `H5_Game_H5E.exe` and `data.pak` on 2026-08-20, to answer one
question: is adding a faction like adding a spell or a creature, or is it a
different kind of thing? It is a different kind of thing. A spell is an entry
in a list the engine walks; a faction is a **dimension the engine's own
structures are sized by**. Nothing found here says a ninth faction is
impossible — but every step past the data is an executable patch, and this
page is the map of where those patches would go.

Nothing on this page is implemented. The editor has no faction support and
this document proposes none; it records what was measured so that a decision
can be made from facts.

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
any racial mechanic the new faction is to have. The mod scene's answer —
replace an existing faction in place, keeping its ordinal — exists precisely
because of this ledger (and there is real headroom inside a faction:
`TB_SPECIAL_0..9` is ten special-building slots, Academy uses four).

The cheap decisive experiment, in the spirit of
[EXTENSION.md](EXTENSION.md)'s two probes: raise `TownType` to 12 with a
twelfth record that is a byte-for-byte clone of Heaven's, patch
`TownTypesInfo` 11→12 with its accessor, `RMGPresetTable` 12→13, the clamp
at `0xB4E730` and the jump table — and just load a map. That answers whether
11 is an allocation or a bound, for a day's work, without authoring a single
asset. It has not been run.

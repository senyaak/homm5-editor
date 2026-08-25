# Porting the random map generator

The goal is not "an editor that can make a random map". It is **understanding
the one Nival wrote** — the generator that lives in `H5_Game.exe` — well enough
to run it in TypeScript and get the same map back. A faithful port is the only
version that can be checked; anything looser is a new generator wearing the old
one's templates, and there is no way to tell a misreading from a design choice.

So the shape of this work is: read a phase out of the executable, write it down
here, port it, check it against a real run, move to the next phase.

## Where this stands, and how to pick it back up

**Nine phases run in lockstep with the engine**, from the seed to draw
18491: CreateMap, the map-created step, LoadTemplate, GenerateGameZones,
FillZones, CalcBorderTiles, FillTerrain, PlaceTowns, FillDistToTownsTable
and ZoneConnections. Every one that draws matches the traced editor run
draw for draw; the two that do not draw are held to the engine's output
instead — the terrain masks byte for byte, the towns and guards to their
positions, armies, moods and minted instance names in `map.xdb`.

**Next is `MainObjects`** — the per-zone fill, fourteen steps deep (mines,
hero, dwellings, upgrade buildings, prisons, cartographer, shrines, resource
and treasury buildings, luck/morale, shops, road, statics, then treasures
and chests), and after it the roads, the additional objects, the treasure
blocks and finally emitting the `.h5m`. The roads phase is also what closes
the one open difference in the terrain masks: Inferno's Dead_Land is a
secondary ROAD tile of land class, and it steals weight from Lava wherever a
road runs.

**The reference the suites compare against** is an ordered editor run of
seed 1785351845 (template S1P2Z2M1, small, 2 players, no underground, no
water). It is game content, so it is not committed:

```bash
npm run rmg-reference                       # is it in place?
npm run rmg-reference -- game/Maps/<run>.h5m  # lay it out again
```

Without it the comparison halves of the suites say so and skip; the draw
counts still run. The draw trace itself (`bin/homm5-editor-rmg.log`, written
when the oracle config says `trace`) is what `npm run rmg-diff-draws`
replays, and it is the instrument to reach for the moment a phase's counter
disagrees.

**That trace now exists, and the whole run is measured.** Seed 1785351845 end
to end is **92,438 draws**, and where they go is no longer a guess:

| | draws |
| --- | --- |
| everything through ZoneConnections — ported | 18,491 |
| MainObjects, fourteen steps in each of four zones | 1,548 |
| roads | 381 |
| statics, the second loop over the zones | **69,378** |
| treasure blocks | 2,640 |

The statics are three quarters of the generator's whole number stream, which
is worth knowing before deciding what to port in what order.

That log ended there for a reason that was in our own code, not the engine's:
the trace switched itself off at the twelfth counter reading, and the twelfth
reading is the door of MainObjects. **It now ends where the run does** — at
`at %g temp db destroyed`, the last line the generator prints.

**And the run is now read step by step.** The twelve counter readings say
nothing about the inside of MainObjects, so the oracle reads the generator's
own narration instead: all 34 "at %g …" lines go through one formatter, and
each of those calls is patched to take the draw counter on the way past. A
run therefore writes

```
step <draws so far> <zone, or -1> <what just finished>
```

for every phase tail and for every one of the fourteen steps in every zone —
which is what turns MainObjects from one number into fourteen. The addresses
are generated and checked, never typed: `npm run test-rmg-log-sites` holds the
table in `native/rmg/oracle.c` to what the editor executable actually says,
address and arity both, and `--c` prints the table to paste when a build moves.

## Where everything is

**The algorithm is compiled into two executables, and no data file describes it.**
Both `H5_Game.exe` and `H5_MapEditor.exe` carry the whole generator — the same
`NRMG` classes, the same phase log, the same everything.

That is worth stating plainly because this document first claimed the opposite,
on the strength of one string: `"RMG log: %s"` is absent from the editor. True,
and it proves nothing — the editor holds every other string the generator has,
and the same `NRMG` classes.

**The editor is the better oracle, for one reason that matters more than the
rest: its generator screen has a seed field.** Typing 1785351845 into it
produced a map recording exactly that, so a specific map can be *ordered*. The
game cannot do this — its screen fills the seed in before `GenerateMap` runs,
and the map only ever reports what it was given.

| | game | map editor |
| --- | --- | --- |
| the seed | reported only | **typed in** |
| window | fullscreen | a window |
| the phase log | to a callback that goes nowhere | destination not yet found |

Two guesses about the editor died on the way here, and both are worth recording
so nobody retraces them. `rmg.txt` is **not** where the editor writes its log:
it goes through the same loader as `rand_trn.txt` and `objects.txt`, all three
read, none written — leftovers of an input format from before the `.xdb` files.
Where the phase log actually goes is still unknown.

**The number stream is the same in both.** The editor runs the identical LCG —
`0x343FD`, `0x269EC3`, shift 23, mask `0x7FFFFFFF` — with its counter at
`0x13D8F38` and the same five-byte accessor (`0xcfd3a0`, against `0xeb1550` in
the game). So `src/rmg/random.ts` is measured against both.

**And the oracle now lives in both.** `install-native --editor` prepares
`H5_MapEditor_H5E.exe` — our copy, our import, the shipped file untouched, no
unwrap needed since the editor ships its code in the clear. The extension
recognises the editor from inside (the counter accessor's six bytes at the
editor's address, computed against the loaded base) and installs the oracle
and nothing else — every other hook is built against the game's image. All
five editor addresses were read the way the game's were: the seed region is
the same pattern down to `[esi+90h]`, only here the screen actually fills it,
so a typed seed reaches `run seed` in the log and the map alike. Phase draw
counts from an ordered editor run — the thing runs 3–5 could not give — land
in the same `bin/homm5-editor-rmg.log`.

**The data, on the other hand, is already ours** — plain XML under
`data-unpacked/RMG/`, unpacked from `a2p1-data.pak`:

| Path | What it holds |
| --- | --- |
| `RMG/Templates/*.xdb` | 22 templates: zones, their sizes and contents, and the connections between them |
| `RMG/Params/Default.xdb` | the global knobs — obstacle counts, mine guard levels, zone radius |
| `RMG/Tiles/<town>/*` | the terrain tiles each town's zone is painted with |
| `RMG/CustomArmyTemplates/` | 244 army templates — what a guard is made of |
| `GameMechanics/RefTables/RMGPresetTable.xdb` | per-race presets |
| `RMG/TownRandomSpecGroup.xdb` | which town specialisations may be rolled |

A template is a declaration and nothing more. `S1P2Z2M1.xdb`, the smallest:

```xml
<Item>
  <Index>1</Index><Size>10</Size><Town>true</Town>
  <Mines><Item>1</Item>…</Mines>
  <TreasureDensity>15</TreasureDensity>
  <TreasureBlocksTotalValue>10000</TreasureBlocksTotalValue>
</Item>
…
<Connections><Item><SourceZoneIndex>1</SourceZoneIndex><DestZoneIndex>2</DestZoneIndex>
  <GuardStrenght>12</GuardStrenght><Guarded>true</Guarded></Item></Connections>
```

**The output is an ordinary map.** The generator writes `map.xdb`
(`AdvMapDesc`), `GroundTerrain.bin` and a minimap into `data/RMGTemp/CurrentMap/`
and packs them as `Maps/RMG/<GUID>/…` inside a `.h5m`. That is the format the
editor already reads and writes, so the port needs no new file work — only the
decisions that fill it.

## What the executable says about itself

The generator narrates. Every phase reads the random-number counter on the way
past and reports what it just finished, with seconds:

```
Rnd Counter(GenerateGameZones): %d.
at %g start points set
```

`docs/RMG_CODE_MAP.md` is that narration pulled out of the binary by
`npm run rmg-map`, and `npm run test-rmg-map` fails when the executable stops
saying it. The pipeline it recovers, in order:

1. `CreateMap` — the empty map
2. `LoadTemplate` — the chosen template
3. `GenerateGameZones` — zones grown from start points
4. `FillZones` — every tile assigned to a zone
5. `CalcBorderTiles` — distance-to-border table
6. `FillTerrain` — the terrain processor paints it
7. `PlaceTowns`
8. `FillDistToTownsTable`
9. `ZoneConnections` — the guarded passages, and teleports where no tiles are free
10. `MainObjects` — the per-zone fill (below)
11. roads, statics, additional objects, treasure blocks
12. saved

Inside one zone, `MainObjects` runs in this order — mines, hero, dwellings,
upgrade buildings, prisons, cartographer, shrines, resource buildings, treasury
buildings, luck/morale objects, shops, road, big statics, one-tile statics, then
treasures and chests. Order matters: whatever is placed first gets the good
tiles, and the "Can't place …" lines in the map are the constraints, stated by
the code that gave up on them.

It also states its own types, through RTTI: `CRandomMapGenerator`, `CRandomMap`,
`CGameZone` with `Subterra`/`Dwarven`/`SubInferno`/`WaterBordered` subclasses,
`CTerrainProcessor`, `CMonsterSetter`, `CTreasureBlockDistributor`.

## The oracle needs a VANILLA install, and the real one is not

`C:\Projects\homm5-editor-rmg\game` — a whole install, copied, ignored by
git, and named to every tool as `--game <that path>`. The work itself now
lives in `main`, in the worktree beside the real install; the vanilla copy
stayed where it was, because what it is for has not changed.

The reason is not tidiness — it is that **the generator reads the data the
install has mounted**. The real install carries the editor's own mod: the
creature ceiling is 181 rather than the shipped 180, artifacts 103 rather
than 97, and ten archives are mounted between `H5E/` and `UserMODs/`. A
guard-setting branch that walks creature ids to the ceiling would therefore
see a creature the reference run never could, and any map ordered there
diverges from the port for reasons that have nothing to do with the port.
`npm run rmg-oracle -- --game <dir>` says all of this in seven lines and
costs a second; it is the thing to run BEFORE asking anyone to launch
anything.

So: tools and tests run from wherever the checkout is, and `--game` points
at the vanilla copy. The two are independent — the copy is an install, not a
branch.

The copy is **vanilla on purpose** — no `UserMODs`, no `h3-mod`, no `H5E`, and
the extension's effects config removed. A mod can change the very data the
generator reads, and what is being measured here is the shipped generator.

Which install is meant is **said**, never guessed from where the checkout sits
(`tools/game-dir.ts`) — from a worktree the guess would name whatever folder the
worktrees happen to live in, and the tool would either fail on a nonsense path
or, worse, quietly work on the shared install.

```bash
# using the copy that exists
npm run rmg-oracle -- --game C:/Projects/homm5-editor-rmg/game

# making another one, if it is ever needed
robocopy "<install>" <copy> /E /XD homm5-editor UserMODs h3-mod H5E screenshots
npm run unpack-data -- <copy>                     # into this checkout's data-unpacked/
npm run install-native -- --game <copy> --editor  # both executables, ours only
```

`--editor` is what prepares `H5_MapEditor_H5E.exe`, our copy of the editor
with our library imported. It is worth having in the REAL install too, since
that is where maps get generated by hand — just do not mistake what it
produces there for a reference.

**This copy is for the generator, not for `npm test`.** Point the suite at it —
`HOMM5_GAME=…/game npm test` — and `test-dialog-scene` fails on two checks, both
saying "none on this install": the campaign archives it reads scenes out of were
never copied. That is the copy being what it is meant to be, not a fault. The
whole suite belongs against a real install; only the RMG suites and the oracle
belong here.

**A half-copied install is a broken one**, and it does not look broken until the
game refuses to start. The executable carries two raised ceilings — 181
creatures, 100 artifacts — and the creatures and artifacts that fill them live
in `H5E/homm5-editor.h5u`. Copy the executable without the archive and the game
comes up with *"Empty pointer to creature # 180"*. They are one pair. A vanilla
oracle therefore needs the ceilings put **back** to the shipped 180 and 97
(`setCreatureLimit` / `setArtifactLimit`), not just the archive left out.

`npm run rmg-oracle` checks exactly that, plus the things a run needs to say
anything: our extension imported, the oracle's config in place, somewhere for
the map to be saved. `--seed <n>` writes the config; `--read` reads the last run
back. It costs a second and it is the thing to run **before** asking anyone to
launch a game.

## How a port is checked

This is the part that makes the exercise possible at all.

**Every generated map records the seed it grew from** — `sRMGProps/RMGstartseed`,
next to `RMGversion` and the whole `InitialParams` block. So a real run is
reproducible input, not a one-off.

**The counter is a lockstep check.** The engine counts every draw and prints the
count at each phase boundary. A port that has read a phase correctly reaches the
next boundary with the same count; one that has not says exactly *which* phase
went wrong — something a differing map never does.

**Neither is reachable from the game as it ships**, which is what the extension
is for (`native/rmg/oracle.c`). The screen has no seed field, and the counter
is formatted into a line handed to a log callback that goes nowhere. Two hooks
fix both, and they install only when `bin/homm5-editor-rmg.txt` exists:

- the **seed**, patched at its one call site — the run's seed is forced (so the
  same map can be asked for twice) and written down either way;
- the **counter accessor**, detoured. It is read twelve times, all inside
  `GenerateMap`, one per phase boundary — so twelve numbers in order *are* the
  phase-by-phase reading, with no format string to parse. The Nth call is the
  Nth boundary.

Both land in `bin/homm5-editor-rmg.log` as `run seed <n> <forced>` and
`phase <i> <draws>`.

**Forcing does not reach the game's own screen**, and the second run showed why:
the seed arrived in `[edi+0x90]` already set, so the fallback to `time()` — the
thing the hook replaces — never ran. Something upstream of `GenerateMap` fills
that field in. The hook still reports honestly (log and map agreed on
`1785534994`), and the map records the seed either way, so a run is still
reproducible input; it just cannot be *ordered* from the game. The editor can
order one, which is the other reason it is the better oracle.

**`npm run diff-map` compares the result.** The editor already has it.

Three rungs, in order of what they prove:

1. the port's own tests — properties, and constants read back out of the binary
2. draw counts matching a real run, phase by phase
3. `diff-map` of a generated `.h5m` against ours from the same seed

### The generator is deterministic — checked, not assumed

The whole exercise rests on "same seed, same map", and that was an assumption
until run 5 tested it: the same seed, twice, everything else untouched.

Identical — heights, ground flags, passability and all seven texture masks, and
`map.xdb` first differs at its GUID, which means every one of the 1,556 objects
matched. `GroundTerrain.bin` differed by exactly one byte out of 169,757, at an
offset no parser reads (`0x41` against `0x61` — one bit); uninitialised, and it
reaches nothing.

Two different seeds, for contrast, agree on almost nothing: 9,033 heights
differ, and even the texture palette changes shape — 7 layers against 12, drawn
from different tile sets.

So a port can be held to the map, byte for byte, and `--compare` is the thing
that holds it there.

### The reference runs so far

Kept in `_tmp/oracle/` (not committed — game content).

| run | from | seed | template | size | what it is for |
| --- | --- | --- | --- | --- | --- |
| 1 | game | 1785351845 forced, map recorded 1785534414 | `S3-5P2Z7N2.2` | large | how the mismatch was found |
| 2 | game | 1785534994, log and map agreed | `S0-1P2Z2K3.1T` | tiny | the pairing fixed |
| 3 | **editor** | **1785351845** | `S1P2Z2M1` | small | **the reference** |
| 4 | editor | 1000 | `S1P2Z2M1` | small | a second seed, same everything else |
| 5 | editor | 1785351845 again | `S1P2Z2M1` | small | the determinism check |

Runs 3–5 are the useful ones: same template, same size, same settings, so the
only variable is the seed. Run 3 is what the port is written against — ordered
rather than observed, so it can be asked for again — and run 4 is what stops the
port from being fitted to one lucky case.

**The races are drawn, not chosen — and the port now derives them.** Run 3
came out Inferno and Academy, run 4 Fortress and Dungeon, with the same
settings. The draw is LoadTemplate's, not CreateMap's as first guessed: two
phases into the stream, `below(8)` against a hardcoded surface list — and the
ported chain, given nothing but seed 1785351845 and the template, answers
**Inferno and Academy** (`test-rmg-load-template`). The first prediction of
something a reference map RECORDED, and it held.

## The port

One module per idea, under `src/rmg/`. Written to be read: the reason a number
is what it is belongs next to the number.

| Module | Holds | State |
| --- | --- | --- |
| `random.ts` | the 64-bit LCG, five entry points, the draw counter | **done**, constants verified against the binary |
| `template.ts` | reading `RMGTemplate` | **done**, all 22 shipped templates parse |
| `create-map.ts` | `CreateMap` — underground, size, players | **done**, offsets pinned via the XML reader |
| `map-setup.ts` | the "map created" step — strength, water, floors | **done**, six draws bracketed by run 1 |
| `load-template.ts` | `LoadTemplate` — floors, races, players, zone classes | **done**, 22 draws reconciled; derives run 3's races |
| `params.ts` | reading `RMGParameters` | **done**, held to `Params/Default.xdb` field by field |
| `zones.ts` | `GenerateGameZones` | **done**, reconciled against run 1 |
| `fill-zones.ts` | `FillZones` | **done, held in lockstep**: an editor trace matched all 18,459 draws |
| `border-tiles.ts` | `CalcBorderTiles` | **done** — drawless, held to the definition and the reference chain |
| `preset-table.ts` | `RMGPresetTable` Tiles + AdvMapTile documents | **done** for what the painter reads |
| `terrain.ts` | `FillTerrain` | **done** — held to the reference file's masks byte for byte |
| `towns.ts` + `town-data.ts` | `PlaceTowns` | **done** — 16 draws, and both towns land where the engine put them |
| `dist-to-towns.ts` | `FillDistToTownsTable` | **done** — drawless; its side effect is what later phases see |
| `connections.ts` | `ZoneConnections`, land passages and guards | **done** — three guards on the engine's own tiles; teleports unported |
| `mines.ts` | the mines step's candidate machinery | the four first picks land; placement, guards and piles next |
| `objects/*.ts` | `MainObjects`, one file per placement step | |
| `treasure.ts` | `CTreasureBlockDistributor` | |
| `armies.ts` + `creatures.ts` | `CMonsterSetter::SetMonster` and its tables | **done** — the reference's three guards, creature for creature |
| `emit.ts` | the finished map, handed to `src/map/` | |

### The number stream, and why it comes first

`src/rmg/random.ts`. A random map is a long chain of decisions each reading the
next number, so the stream has to be exact before any phase above it can be
judged — a phase read perfectly still produces a different world if the numbers
under it are different.

It is a 64-bit LCG using MSVC's own `rand()` constants, with **five** ways in —
one step of the state each, and each slicing that step differently:

```
state = state * 0x343FD + 0x269EC3        (mod 2^64)

next()            = (state >> 23) & 0x7FFFFFFF            0xeb13a0
next63()          =  state        & 0x7FFF_FFFFFFFFFFFF   0xeb1360
below(n)          = ((state >> 16) & (2^47 - 1)) % n      0xeb13e0
between(lo, hi)   = lo + below(hi - lo + 1)               0xeb1450
betweenFloat(a,b) = a + (next() / 2^31) * (b - a)         0xeb14d0, in float
```

Plus `0xeb1330` to seed (and reset the counter) and `0xeb1350` to read the state
back, neither of which draws.

`between` is the engine's own function, not a composition — but it composes to
exactly this, empty range included: `hi < lo` makes the span zero, and it
returns `lo` having drawn nothing.

`betweenFloat` is computed in SINGLE precision — the scale, the multiply and
the add are all `ss` instructions. In JavaScript that means `Math.fround`
around every step. Skip it and the answer is right to seven digits and wrong
after, which is the drift that surfaces a thousand draws later as a different
map. (An earlier draft of this document claimed the `k == %2.2f` in the zone
log line comes from `betweenFloat`; reading the phase showed k is a constant
0.9 decayed by 3% per retry pass, and `betweenFloat`'s known caller is
FillZones, at 0xeaa3ba.)

Three details that a reasonable-looking port gets wrong:

- **`below(n)` is not `next() % n`.** It takes a different slice of the same
  state. The wrong slice gives numbers in the right range that are the wrong
  numbers, and nothing shows it until a map diverges a thousand draws later.
- **The seed is sign-extended into the state** (`cdq`), so `(int32)seed`, not
  `(uint32)seed`.
- **`below(0)` draws nothing at all** — the engine returns before touching the
  state. A "place zero of these" loop therefore leaves the stream where it found
  it, and a port that draws anyway diverges only when a template happens to ask
  for none of something.

`npm run test-rmg-random` checks the properties *and* reads the multiplier, the
increment, both shifts and both masks back out of `.text` by byte pattern — so
the test fails if the reading was wrong or the build is different, rather than
agreeing with whoever typed the expectation.

One thing that test taught: neighbouring seeds share their **first** draw. The
gap of 1 becomes 0x343FD after one multiply and the low 23 bits are thrown away,
so the difference is invisible for a step or two. When comparing against a real
run, a single matching number proves nothing — a sequence does.

### Phase 1 — `CreateMap`, and the rule it establishes

Three draws, always — and it took two readings to name them right. The first
draft had the field pairs inverted and the draws in the wrong order,
invisible because every reference run supplied both parameters and all three
draws were discarded `next()`s; walking the SRMGTemplate XML reader
(0xB9BC90) finally pinned the offsets — MinPlayers +0x78, MaxPlayers +0x7C,
MinMapSize +0x80, MaxMapSize +0x84. As the engine actually has it:

```
underground requested-random ? below(2) : next()      the FIRST draw
size    unset ? Min + below(span), halved
                for two floors           : next()     the SECOND
players unset ? Min + below(span)        : next()     the THIRD
```

**A supplied parameter is not a draw skipped.** The engine draws either way
and discards the number when it already has one. This is the rule the whole
port hangs on: a phase that draws "only when it needs a number" runs the
counter short before anything interesting has happened, and every later phase
then reads different numbers — a wrong map for a reason that has nothing to
do with the code that made it. The corollary that makes the port robust:
**every RNG entry steps the state exactly once**, so a supplied parameter
changes the value it yields and nothing downstream.

The "fourth draw at 0xeab5a2" the first reading left unported is not a fourth
at all: the coin REPLACES the first `next()` when the operator asked for a
random underground — which is why every reference run spends exactly three.
And the clamp is on the PLAYERS, copied as written rather than as expected:

```
if (players > MaxPlayers || players < MinPlayers) players = MinPlayers
```

Too many players falls back to the **minimum**. The engine's bug, kept, with
a test naming it deliberate.

Still open here: the units↔size-index conversions (the generator's vt+0x14 /
vt+0x18) — which is also what the template's 5..14 "size" range measures —
and the forced-underground fit checks for a map too small for its players.

#### Map sizes, pinned down

The size that reaches the map is an index into a table at `0xff291c`:

| index | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tiles | 72 | **96** | 136 | 176 | 216 | 256 | 320 |

The reference map is 96×96, so index 1 — and the map is always square, both
dimensions read the same entry. Past index 6 the table is other data.

### Phase 2 — the "map created" step, six draws of scene-setting

`0xE9FFC0`, ported in `src/rmg/map-setup.ts`; run 1's counters bracket it at
3..9. In order: monster strength (`below(3)` or a discarded `next()` when
supplied), water (`below(2)` likewise), an angle `betweenFloat(0, 2π)` whose
reader is unfound, a raw `next()` whose PARITY later makes the underground
Dwarven — the dwarven caves are a 50/50 of one roll — the surface ambient
light (`below(5)` against RMGParameters' list), and `below(10) > 6` for the
bird ambience. This is also where the floor vector is built: **1 + gen[0x1D]
elements** — the CreateMap underground bit IS the floor count, which pinned
the relation zones.ts used to take on faith.

### Phase 2½ — `LoadTemplate`, where the zones come into being

`0xEA1D40`, ported in `src/rmg/load-template.ts`; the reading reconciles
against run 1 exactly (1 + 7×2 + 7 = 22 = 31 − 9), which also proves the
sorts, hash inserts and the CTerrainProcessor / CMonsterSetter /
CTreasureBlockDistributor constructors draw nothing. The budget:

```
draws = [two floors: one per zone]      floor balancing
      + 1                               the subterra coin, spent regardless
      + per zone: Setting ∈ {SPECIAL, RANDOM_TYPE, NO_TYPE} ? 2 : 1
      + one per zone                    the base constructor's next() → +0x13C
      + [two floors: 2·⌊W·H/R²⌋]        a light grid drawn and thrown away
```

Zones are created in **ascending Index order** — sorted by Size descending to
deal floors (LPT balancing: coin only when the floors are within a tile,
discarded draw otherwise), then by Index ascending to build. Both sorts are
the same odd gap-halving strided merge whose ties emit the RIGHT element,
modelled 1:1 in `engineSort` because the tie order decides floor deals —
exact by construction, not yet held to a two-floor oracle run.

The races: a concrete Setting is kept (one discarded draw); the three
"random" Settings draw from hardcoded lists — surface `[HEAVEN, PRESERVE,
ACADEMY, DWARF, INFERNO, NECROMANCY, STRONGHOLD]` plus DUNGEON only on a
one-floor map, underground `[DUNGEON, INFERNO, DWARF, NECROMANCY]` — and
spend one more either way. A player-start zone seats the next player; a slot
the operator filled with a concrete race wins over the drawn one, a RANDOM
slot takes it. This is where run 3's Inferno-and-Academy comes from, and the
port derives it from the seed.

The underground's flavour: Dwarven when the map-setup parity said so, else
one coin — for the whole map — decides Subterra against SubInferno. Water
makes floor-0 zones WaterBordered and copies the template's `Shipyard` bit
(in the schema with default TRUE, written by no shipped file — the reader
walk found it, and template.ts now parses it).

Named holes: the concrete-race branch appends a player entry without
checking the operator's (nothing shipped reaches it; copied as read); who
pre-fills the player vector upstream, and what later reads zone+0x13C and
the map-setup angle.

### Phase 3 — GenerateGameZones, where the blobs begin

Read from `0xEA2760` (thiscall on CRandomMapGenerator, the only caller
`GenerateMap` at 0xeab86d). Ported in `src/rmg/zones.ts`; the phase gives
every zone a start point and a radius, and FillZones later grows the blobs
out from those points. The reading **reconciles against run 1 exactly**:
176×176, one floor, one pass — 1234 draws predicted from the shape below,
1234 counted by the oracle. That also proves no draw site on that path went
unread.

The shape: `tiles/100` candidate points are drawn once (`below(W)` then
`below(H)` each — the only RNG entry this phase uses is `below`). Then a
retry loop: Fisher–Yates shuffle of the points, radii recomputed from a
coefficient k, then per floor — another shuffle (spent even on an empty
floor, even after a failure) and each zone takes the first point that fits.
`k` starts at 0.9f and decays by 0.97f after every pass, which is what the
`k == %2.2f` in the log line actually is — not a drawn number. Budget:

```
draws = 2n + P · (n−1) · (1 + F)      n = ⌊tiles/100⌋, F floors, P passes
```

(P > 1 is exercised by the port's tests but not yet by an oracle run.)

A point fits when it keeps R tiles from the border (equality passes; the
rejections are strict) and does not overlap a zone **already placed this pass
on the same floor** — the engine's overlap scan walks every floor but stops
at the zone itself, and a cross-floor pair cannot fail the check, so zones on
different floors overlap freely. A failed placement costs no draws, and after
one failure the rest of the pass places nothing.

The radius: `R = trunc(sqrt(fl(fl(size · fl(tiles·k)) / sizeSum)) / 3.0)`,
`fl` marking single precision (the sqrt and the /3.0 are genuinely double);
sizeSum is the template's zone sizes accumulated **in float, in file order**.
With the generator's `+0x1D` byte set ("two floors" — set by CreateMap's
unported coin flip at 0xeab5a2, or forced when the map is small for its
players), R stretches by 1.41421354f. For the reference setup (S1P2Z2M1,
96×96) that yields R = 15 for all four zones — a prediction to hold against
the editor once the counter hook moves there.

**Zone order is a hash_map's order, and it is not the obvious one.** The
floor's zones live in an STLPort-style hash_map: bucket = index %
bucketCount, head insertion, buckets iterated ascending; 13 buckets, growing
to 29 on the fourteenth insert (prime table at 0xF49470). Shipped indices
reach 15, so in a small table zone 14 iterates before zone 2 — and a shipped
15-zone template sits in a rehashed 29-bucket table where those indices stop
colliding and the order is plain ascending again. `floorIterationOrder`
models exactly this and **refuses** the one unread path (a collision after a
rehash, whose within-bucket order depends on how the rehash re-inserted); the
suite proves no shipped template reaches it even if all its zones landed on
one floor.

Also read on the way: **the zone constructor itself draws once** (`next()`
into zone+0x13C) — those draws belong to LoadTemplate's budget, one per zone.
The questions this section once left open were answered by reading
LoadTemplate: floors come from `1 + gen[0x1D]` (Phase 2), zones' floors from
the Size-descending deal (Phase 2½), item+0x10 **is** the XML `<Size>`
(pinned through the generated reader), and `twoFloors` and the floor count
are one bit — the port now takes a single parameter.

### Phase 4 — FillZones, where the blobs get their shape

Read from `0xEA94C0`; ported in `src/rmg/fill-zones.ts`. Run 1 spent 106,717
draws here, and the structural half reconciles exactly: `⌈fl(width·√3f)⌉`
sweeps — 305 on 176×176 — at two `below(2)` coins each (the scan direction
per axis), leaving 106,107 jitter draws that only a lockstep run can confirm
number by number.

Three steps own a tile: **paint** — strictly inside a zone's circle (distance
from the truncated start point, single precision), first zone in the floor's
hash order wins, everything else −1; **grow** — an unassigned tile joins the
zone owning ≥3 of its 8 neighbours, no draw; **jitter** — an assigned tile ≥6
from the border with no unassigned neighbour and ≥3 neighbours of one other
zone flips to it with probability ~0.6 (`betweenFloat(0,1) > 0.4f`, the draw
spent either way), but only while that zone is under quota:
`sizeOther/sizeOwn > countOther/countOwn`, both divisions single precision.
Decisions queue up per sweep and apply at its end, and the areas the jitter
reads are the *previous* sweep's snapshot — zero before the first, where the
ratio is NaN and a strict `comiss` refuses without drawing: **sweep one costs
exactly two draws**, a prediction the first editor-oracle run can check.
Areas converge to the template's Size proportions; on the reference chain —
now the FULL chain, every phase from the seed — the port ends with
2324/2305/2293/2294 tiles for four Size-10 zones, zero left unassigned, and
the boundary counters **3, 9, 22, 388, 19116** (`test-rmg-load-template`) —
the numbers an editor-oracle run of seed 1785351845 must log, phase by phase.

Tie-breaks are the same 13-bucket hash containers as the zone order, down to
`-1` hashing into bucket 8, and the port models them rather than taking a
plain maximum. Named holes: the grid's initial −1 is assumed (whoever builds
the floor writes it; unread), and the engine checks the jitter's 6-tile
margin against the dimension pair SWAPPED relative to the neighbour bounds —
indistinguishable on the square maps it makes, so the port refuses rectangles
rather than guess which reading is faithful.

### Phase 5 — CalcBorderTiles, how deep a tile sits

Read from `0xEA90D0`; ported in `src/rmg/border-tiles.ts`. No draws — the
traced run shows 18459 on both sides of it, and the reading agrees: the only
calls in its body are malloc and free. It fills the floor's second grid
(floor+0xE0, int32, initialised to −1 by the map-created step — which is
also where the ZONE grid gets its −1, closing the hole fill-zones assumed):
per tile, the TRUNCATED EUCLIDEAN distance to the nearest border tile of its
OWN zone, borders themselves 0. A border tile has one of its four orthogonal
neighbours off the map or in another zone; the algorithm is a brute-force
minimum over the floor's border list, differences/squares/sum/min in single
precision, the sqrt alone in double, `cvttss2si` at the end. A zone−1 tile
matches nothing and keeps the minimum's seed, 10000.0f.

The table is what every placement phase later filters by — `dist > R/2` for
a zone's deep core, `dist >= 1` to stay off the border — so its truncations
decide the candidate sets, and through them the draw counts of the phases
that DO draw. On the reference chain: 808 border tiles, deepest 22.

### Phase 6 — FillTerrain, the ground gets its look

Read from `CTerrainProcessor::Process` (0xED0AD0) with the dwarven-only
pre-step 0xED17F0; ported in `src/rmg/terrain.ts` with `preset-table.ts`
reading the RMGPresetTable Tiles blocks and the AdvMapTile documents it
names. The phase paints ONLY texture masks — heights, flags and passability
belong to someone later (the 9.0 height base of RMG maps has no writer found
yet). Process draws nothing; the pre-step draws one below(8), dwarven
two-floor maps only (`dwarvenCoarse`).

Per vertex of the (size+1)² plane: the clamped tile's zone paints its ground
tile at 255 — chosen by THE CONSTRUCTOR'S ROLL (zone+0x13C, the draw whose
reader was unknown since LoadTemplate): odd or empty-pool takes the preset's
DefaultTile, even takes OtherTiles[roll % n]. On floor 0, vertices with both
coordinates in [1, size−2] get borders: the first DIAGONAL foreign-zone
neighbour paints the transitive tile (RMGParameters' DefaultTransitiveTile;
the Intensity knob is never read — the weights are the literals 128 and 255)
when the races differ, then the first ORTHOGONAL one paints it again at 255.
Haven and Preserve count as one race. PaintTile keeps layers keyed by href
path, ordered by ascending Priority, and STEALS: past 255, every same-class
layer at another priority loses twice the overflow.

Held to the reference file, not to itself: on the traced run's
GroundTerrain.bin the Sand-Dunes, Sand_Cracked and DarkGround masks are
byte-identical, and Lava differs on exactly the 175 vertices where the file's
Dead_Land sits — Inferno's SECONDARY ROAD tile, still land-class, painted by
the roads phase that will steal from Lava when it is ported. The orientation
that makes this work is pinned by probing the file at the corners and zone
starts: the plane lies plane[a·(size+1)+b] in the port grid's own
coordinates.

### Phase 7 — PlaceTowns, and the three points that are not the same point

Read from `0xEA5B70` with `CGameZone::PlaceTown` (0xEB4CB0); ported in
`src/rmg/towns.ts`, with `town-data.ts` reading the building documents and
the specialisation pool. Sixteen draws on the reference run, and the port
spends the same sixteen and lands where the engine landed: both towns
(22,33 and 68,59), both rotations, both specialisations (Styx, Mans), the
decoration over Inferno's entrance — and all three `item_<id>` instance
names, which are minted from two draws apiece and therefore prove the draw
ORDER, not just the count.

The phase walks the TEMPLATE's zones in file order, and a zone without a
town gets its centroid computed instead (single precision, the tile list's
mean). A zone with one runs a retry loop: a tile from the pool — the zone's
tiles, in the order FillZones collected them, keeping only depth > R/2 — and
a quarter-turn, both drawn. Then three gates, none of which draws: a frame,
a depth of at least (2·R)/3, and the rotated footprint (inside the zone, on
free tiles, none of them against the border). A frame or depth refusal keeps
the tile in the pool; a footprint refusal drops it.

**Three points, and telling them apart is the whole phase.** The drawn TILE
is the town's Pos, its footprint anchor and what gets reserved. The ENTRY —
tile + rot(activeTiles[0]), the tile a hero walks in through, (1,-6) on
every shipped town — is what the frame and depth gates measure, and what the
next phase grows its wave from. The FLAG point — tile + rot(1,-1), a literal
in the code — only positions the decoration. The reference forced this
apart: zone 1's town stands on a depth-9 tile with the gate at 10, while its
entry is 15 deep, and zone 2's refused attempt sat on a depth-9 tile whose
entry was 8. Reading the gate as measuring the town's own tile would have
refused the town the engine placed.

The offsets are pinned through the building's generated reader, the same way
the template's were: +0x54 blockedTiles, +0x60 holeTiles, +0x6C activeTiles,
+0x84 PossessionMarkerTile. The footprint checks three lists at three
depths — blockedTiles and activeTiles at 1, the marker at 3 — and holeTiles,
the largest list of the three, is checked by nothing.

One named hole: the neutral-town guard (a town in a zone with no player)
draws and is unported, since every reference town belongs to someone.

### Phase 8 — FillDistToTownsTable, and the tiles it takes away

An inline loop in GenerateMap (0xeabc01) calling `CGameZone::FillDistToTown`
(0xEC06E0) per zone; ported in `src/rmg/dist-to-towns.ts`. No draws.

From each zone's centre — a town's ENTRY point, or a townless zone's
centroid — a wave spreads through that zone's own tiles only, four ways at
cost 2 and four diagonally at 3, an integer stand-in for 2·√2. Other zones
are walls, so an arm of a zone walled off from its own centre is never
reached.

**And then it is taken away.** Every tile of the zone still unreached is
written −2 into the ZONE grid: it stops belonging to anyone, and every later
phase sees a smaller zone. That side effect is the phase's real output — the
distance table itself has no reader this port has found yet, while the
disowning is visible to everything downstream. On the reference map nothing
is disowned (all four zones are connected to their centres), so the
behaviour is implemented from the reading and exercised only by the suite's
own split-zone case.

### Phase 9 — ZoneConnections, where the zones are joined

Read from `0xEA3930` (the passages proper are `0xEC1630`); ported in
`src/rmg/connections.ts`, with the guards coming from `armies.ts`. Sixteen
draws, and the port spends them on the engine's own tiles: all three guards
land where the map has them (49:51, 63:34, 41:89), with the same armies, the
same instance names and the same moods — and the counter ends at 18491,
exactly where the trace has it.

A passage is found by SCANNING, not by any distance table. A tile qualifies
when it keeps 5 tiles from the map edge (`JunctionMinBorderDistance`), has
exactly ONE foreign value among its eight neighbours, and that value appears
3 to 5 times — a straight stretch of border, not a corner and not a place
where three zones meet. Unassigned tiles count as a value of their own, so a
tile touching both a neighbour and a hole is not a candidate. Candidates
collect per neighbour in scan order and live in a hash map, so a zone
bordering several others visits them in bucket order; a neighbour with 7
candidates or fewer is skipped. One draw picks the tile, the guard costs
four or five more, and both sides mark the pair done — the neighbour adopts
the tile of its own adjacent to the mouth, orthogonals before diagonals.

**Both sides stamp depth 1** on the mouth and its own-zone orthogonal
neighbours, which is how the later phases learn to keep a passage clear.

The reference forced the passage rule into shape the same way the towns
were: with three positions to hit and 16, 35 and 28 candidates to hit them
in, no wrong rule survives.

Unported and named: **teleports**. A connection with no land passage — a
different floor, or a border too thin — gets a monolith or a gate pair from
the phase's second pass. Every reference connection was dug on land, so that
path has never been measured; the port reports the connections it could not
dig rather than inventing what the engine would do with them.

### The four grids a level carries

Every step from MainObjects on reads and writes these, so they are worth one
place too. A level is `world->0x34 + floor*0x120`, and each grid is a flat
buffer plus a table of row pointers — the buffer is what `CreateMap`
(`0xE9FFC0`) fills, the table is what everything else indexes through, which
is why the same grid has two offsets.

| grid | filled with | what it holds |
| --- | --- | --- |
| `+0xC0` / `+0xC4` | −1 | the zone id of each tile — `FillZones` |
| `+0xD0` / `+0xD4` | 0 | what occupies the tile |
| `+0xE0` / `+0xE4` | −1 | distance to the zone border — `CalcBorderTiles` |
| `+0xF0` / `+0xF4` | −1 | room: distance to the nearest point of a zone's list |

**The border table is not permanent.** `CalcBorderTiles` writes 0 on a border
tile and the truncated Euclidean distance elsewhere, which is what
`border-tiles.ts` ports — but `0xEC1500`, the placer that prisons, the
cartographer, shrines, resource buildings, treasuries and luck/morale objects
all go through, writes **1** into it at the object's tile and at its same-zone
neighbours. So a step reads a table the steps before it have already dented,
and the order of the steps is part of what each one sees.

**What occupies a tile**, as the values that are actually written:

| value | written by |
| --- | --- |
| 0 | nothing — the initial state |
| 2 | an object's footprint, and a mine's resource pile |
| 4 | a guard |
| `0x08` `0x10` `0x20` | a road — three kinds, from the three calls to the router `0xEC0B60` |
| `0x80` `0x100` `0x82` `0x40` `0x400` | written, meaning not established |

A tile counts as FREE when `t == 0 || (t & 0x38)` — untouched, or carrying a
road. That is the same `0x38` the room recompute is called with elsewhere, and
it is exactly the three road bits.

**The room grid** is recomputed on demand by `0xEC28E0(mask, allZones)`, and
it does not measure distance to occupied tiles. For every tile of the floor it
takes the minimum Euclidean distance to the nearest point in whichever of the
zone's point lists the mask selects — `0x04` is the list at `zone+0x68`,
`0x02` is `+0x5C`, `0x08`/`0x10`/`0x20` are the three road lists, `0x40` and
`0x400` filter `+0xCC` by the matching occupancy bit. A tile belonging to no
zone gets 1000; with `allZones` clear, tiles of other zones are left alone.
The mines step calls it as `(4, 0)`.

`0xEC2EB0(list)` is its companion: the **maximum** room value over a list of
points, counting only those in the zone with a border distance above 2 and an
occupancy that is not 2.

**One engine quirk, to be reproduced rather than corrected.** The final
`cvttss2si` in `0xEC28E0` (at `0xEC2E37`) converts `xmm0`, not the minimum
accumulated on the stack. When no list iteration ran for a tile — because
every selected list was empty — `xmm0` still holds whatever the previous tile
left in it. The first mine of a zone is placed when nothing has been added to
`zone+0x68` yet, so this is not a corner nobody reaches.

### `RMGParameters`, offset by offset

Every phase from here on reads this structure by offset, so the whole map is
worth having in one place. It is read out of the executable twice over, which
is why it is a fact and not a layout that happens to line up:

- the **xdb serialiser**, `0xB9E5D0`, which pushes each field's name next to
  the address it writes — `lea eax,[edi+<offset>]` … `push <name>`;
- the **reflection descriptor table** built at `0xB9CA00`, where the offset
  arrives as a literal in `edx` beside the field's type and size.

The two agree, and the fields add up to `0x21C` without a hole — the size the
table registers for the structure. `SRMGParameters` sits at offset 0 of the
object (its RTTI locator says so, and the loader's first instructions take
`ecx` unadjusted), so these are offsets from the pointer itself.

| off | field | off | field |
| --- | --- | --- | --- |
| `+0x44` | RMGVersion | `+0x98` | GroundTerrainLight |
| `+0x48` | Mine1LevelMinRadius | `+0xA0` | UndergroundTerrainLight |
| `+0x4C` | Mine1LevelMaxRadius | `+0xA8` | PointLightParams (0x28) |
| `+0x50` | Mine2LevelMinRadius | `+0xAC` | …ZoneRadius |
| `+0x54` | Mine2LevelMaxRadius | `+0xB0` | …MinDist |
| `+0x58` | Mine3LevelMinRadius | `+0xB4` `+0xB8` | …zMin, zMax |
| `+0x5C` | Mine3LevelMaxRadius | `+0xBC` `+0xC0` | …LightRadiusMin, Max |
| `+0x60` | BasicLeverGuardPower | `+0xC4` | …Colors |
| `+0x64` | ConnectionGuardLevel | `+0xD0` … `+0x12C` | the eight text refs |
| `+0x68` | Mine1LevelGuardLevel | `+0x130` | CreatureStackParams (0x10) |
| `+0x6C` | Mine2LevelGuardLevel | `+0x134` … `+0x13C` | …Basic, Min, MaxAmount |
| `+0x70` | MineGoldGuardLevel | `+0x140` `+0x148` | Default Surface / Subterra tile |
| `+0x74` | JunctionMinBorderDistance | `+0x150` `+0x158` | DeepWaterTile, DeepWaterBottom |
| `+0x78` | TeleportMinBorderDistance | `+0x160` | DefaultTransitiveTile |
| `+0x7C` | TeleportMaxBorderDistance | `+0x168` | TransitiveTileIntensity |
| `+0x80` | DistBetweenLakes | `+0x16C` | MapSizeNames |
| `+0x84` | DistBetweenTreasureBlocks | `+0x1A8` | Templates |
| `+0x88` | CreatureMinStackAmount | `+0x1CC` | MonsterStrenghtNames |
| `+0x8C` | CreatureMaxStackAmount | `+0x1D8` | ResourceMineColors |
| `+0x90` | MinDistanceBetweenBigObjects | `+0x1E4` | MonsterLevelCoef |
| `+0x94` | MinDistanceBetweenTreasureBlocks | `+0x1F0` | ShipyardGuardsLevelCoef |
| | | `+0x1F4` | GroundTerrainLights |
| | | `+0x200` `+0x208` | Obelisk, Grail |
| | | `+0x210` | WaterTreasures |

The step that reads one of these reaches it through `0xEAFF80`, a lazy getter
that dynamic-casts the resource to `SRMGParameters` and caches the result.

### Phase 10 — MainObjects, the per-zone fill

Not ported yet. What follows is the reading of the code and of the reference
map — the shape to port against, and it is marked where it is a reading of
behaviour rather than of the code.

**It is two loops over the zones, not one.** `0xEA3F80` (called from
`0xEABE09`) walks every zone and runs twelve steps inside each; `0xEA5450`
(from `0xEABFC4`) walks them again for the two statics steps. The `ret` at
`0xEA543A` is where the first one ends — the bytes after it are a jump table
for the switch at `0xEA46AC`, and the second function starts at `0xEA5450`.
That is why the reference map reads zone by zone through the buildings and
then has 1,325 statics in one block at the end: the statics are a second pass.

**Both loops open with one draw, whatever happens.** With `this->0xB5` set,
`below(count)` picks a zone to favour; without it, `next()` is drawn and
thrown away (`0xEA3FE5` / `0xEA3FF0`). A port that skips the draw in the
second case is one number out for the whole phase.

The zone's parameters are an array element of **0x74 bytes**, and each step
takes its own field of it. The steps, in the order the code runs them:

| step | worker | its field | skipped when |
| --- | --- | --- | --- |
| mines | `0xEB5C50`, then `0xEBD700` for abandoned | `+0x20`, `+0x2C` | — |
| hero | `0xEB5B30` | — | never runs; draws nothing |
| dwellings | `0xEB8C10` | `+0x30` | — |
| upgrade buildings | `0xEC00F0`, `0xEBFFC0`, `0xEB96D0` | `+0x3C` | the first two only in the favoured zone, and only with `this->0xB5` |
| prisons | `0xEBD1C0` | `+0x48` | — |
| cartographer | `0xEBD4B0` | `+0x4C` | — |
| shrines | `0xEBE1C0` | `+0x54` | — |
| resource buildings | `0xEBE540` | `+0x5C` | — |
| treasury buildings | `0xEBECB0` | `+0x60` | — |
| luck/morale | `0xEBF090` | `+0x58` | — |
| shops | `0xEBF540` | `+0x50` | — |
| road, and the treasures with it | `0xEBF930`, `0xEA57B0`, `0xEC05B0` | `+0x70`, whole element | treasures and chests only on the surface |
| big statics | virtual, zone vtable `+0x34` | — | second loop |
| one tile statics | virtual, zone vtable `+0x30` | — | second loop |

Two of those are worth saying out loud. **`0xEC04D0` is a stub** — its whole
body is `ret 4`, so the `+0x70` field reaches nothing. And **the statics steps
are virtual**: `CGameZone` answers with `0xEBAA70`/`0xEBBBD0`, and Subterra,
Dwarven, SubInferno and WaterBordered each have their own, so a subterranean
zone fills itself differently from a surface one.

A zone whose id does not resolve (`0xE9FF00` at `0xEA414A`) is skipped whole,
step for step.

**What the reference map already says about the first step.** Twelve of its
eighteen mines are the six resource mines of the two town zones, always in
this order — Sawmill, Ore_Pit, Alchemist_Lab, Crystal_Cavern, Sulfur_Dune,
Gem_Pond — and the zones without a town get Sawmill, Ore_Pit and a Gold_Mine
instead. Every mine comes as a THREE: the mine, a guard exactly two tiles
away on one axis, and one or two piles of its own resource next to the guard.
Sawmill 32:21, guard of 3 Footmen at 30:21, Wood at 30:20. The guard is
`SetMonster`, which is ported and checked already, so what this step still
needs is where the mine goes and which one it is.

`zone->0xF4` is the FLOOR, read rather than guessed: every use of it indexes
the level array by `0x120` (`lea ecx,[eax+eax*8]; shl ecx,5`). So "treasures
and chests only when it is zero" means only on the surface.

**Not read out of the code, only observed**: what `this->0xB5` and `this->0xB0`
mean. The addresses of individual draws inside the workers were attributed by
address range rather than by walking each function, so a draw listed under a
worker may belong to a small callee of it.

#### The first step — mines, read out of `0xEB5C50`

The function is two near-identical halves: types 0–1 in one, 2–6 in the other.
Addresses below are the first half's; the second's mirror them.

**The types are a table, and the order is just its indices.** Seven strings at
`0x121C670` (0x20 apart, filled by the static initialiser at `0x4D5810`):
Sawmill, Ore_Pit, Alchemist_Lab, Crystal_Cavern, Sulfur_Dune, Gem_Pond,
Gold_Mine. The count of each comes from the zone's parameter field `+0x20` —
a vector of ints, of which only `begin` is ever read, because the number of
types is the hardcoded 7. A count of zero skips that type, which is the whole
of why a town zone gets six mines and a zone without one gets three: the
counts differ, the order does not.

The only place a type is asked about at all is `0xEB6F8D` — index 6 takes its
guard from `MineGoldGuardLevel`, everything else from `Mine2LevelGuardLevel`.

**Candidates are gathered once per zone**, before the loop over mine types and
not once per mine, into two lists: the near one for types 0–1 and the far one
for 2 and up. The scan runs the first grid index outer and the second inner,
and a tile qualifies when it is inside the map, belongs to this zone, and its
`+0xE4` value is **above 1**. Then, and only if the zone has a town:

    near list   Mine1LevelMinRadius < d < Mine1LevelMaxRadius
    far list    Mine2LevelMinRadius < d < Mine2LevelMaxRadius

Strict on both sides, both lists, and otherwise the same test on the same
iteration — so a tile can land in both.

**`d` is measured from the TOWN**, not from where the zone was seeded. The pair
at `zone+0x0C`/`+0x10` is written in exactly one place in the generator —
`0xEB4FBF` and `0xEB4FD8`, inside the slot `PlaceTowns` calls — and
`GenerateGameZones` never touches it. That same function sets `zone+0xF8`,
which is what "has a town" means, and a zone with `+0xF8 == 0` skips the rings
entirely, putting every one of its tiles into both lists.

Which parameter is at which offset is **read out of the executable**, not
inferred — see the offset map below. The ones this step uses:

| offset | field | value in `Default.xdb` |
| --- | --- | --- |
| `+0x48` `+0x4C` | `Mine1LevelMinRadius` / `MaxRadius` — the near ring, types 0–1 | 7, 20 |
| `+0x50` `+0x54` | `Mine2LevelMinRadius` / `MaxRadius` — the far ring, types 2–6 | 15, 40 |
| `+0x60` | `BasicLeverGuardPower` | 1000 |
| `+0x68` `+0x6C` `+0x70` | `Mine1LevelGuardLevel`, `Mine2LevelGuardLevel`, `MineGoldGuardLevel` | 2, 9, 18 |

**And the guard offsets are measured on top of that.** Every one of the eighteen mine guards in the reference run was
rebuilt from its recorded draws at `BasicLeverGuardPower × the type's level` —
2000, 9000 and 18000 — and all eighteen came out the engine's own army,
creature for creature (`test-rmg-armies`). A wrong offset does not survive
that eighteen times.

It also caught a bug in `SetMonster` that three guards could not. The strength
multiply **truncates where the product lands**, and does not round back to a
float first: `0.9f` is 0.89999997615814208984375, so a guard power of 2000
scales to 1799.99995… and truncates to **1799**, not 1800. Only one guard in
the whole run can show that — the Familiar at 23, because 1799/75 is 23 while
1800/75 is exactly 24, and it is the only single stack whose division comes
out exact. The other three (17, 42, 25) hold either way.
**A zone with no town (`zone->0xF8 == 0`) skips the rings entirely** and puts
every one of its tiles into both lists.

**Then, per mine**, the zone recomputes the room grid with `(4, 0)` — distance
to the nearest point of its `+0x68` list — takes its maximum over the
candidates through `0xEC2EB0`, and filters. The filter is **one test and
nothing else**: `+0xF4 > threshold`, strictly. Not the zone, not the border
distance, not the occupancy — those three appear in `0xEC2EB0`, where they
decide what counts towards the maximum, and nowhere else. The threshold is a
signed `trunc(2 × max / 5)`, so a maximum of 0 gives a threshold of 0 and
keeps whatever has any room at all.

The filtered list is built fresh from the ORIGINAL list each time, so a
candidate struck out by a failed fit is back for the next mine.

**What is in `+0x68` before the first mine is placed, and it is not empty.**
`0xEC2F90` — the routine that stamps an object onto the level — makes three
passes: the first pushes into `zone+0x5C` and marks occupancy **2**, the second
and third push into `zone+0x68` and mark occupancy **4**. So *the `+0x68` list
is exactly the tiles marked 4*. And two phases have already run it before
MainObjects: `PlaceTowns`, through the slot at `0xEB4CB0`, and
`ZoneConnections`, through `0xEB7C60` at `0xEB854D`. A zone with no town still
has whatever its passage guards left there — which is why the room filter bites
in a zone that never saw a town.

**Two draws per ATTEMPT, not per mine**: `below(number of candidates)` picks a
tile and `below(4)` picks a quadrant of rotation. If the object does not fit
there, that candidate is struck out of the list and the pair is drawn again;
an empty list is the `cant place mine %s at zone %d` line.

**The guard costs no draws to place** — its tile is the first of the mine
footprint's four orthogonal neighbours, starting from the quadrant the mine
was rotated to, that is free. If none is, there is no guard at all and
`SetMonster` is never called. It is called as `SetMonster(&out, power,
&guardPos, angle)` with `power = <that level> × BasicLeverGuardPower`, and its
own four or five draws are already ported (`armies.ts`).

**The piles are eight neighbours and an 80% coin.** Their type is a parallel
table at `0x121C830` — Wood, Ore, Mercury, Crystal, Sulfur, Gems, Gold, the
same indices. Starting two past the guard's direction, each of the eight
neighbours of the mine's last footprint tile is tried: it must be free, it
must be **within 2.0 of the GUARD** — which is why the piles hug the guard and
not the mine — and then `betweenFloat(0,1)` must come out under 0.8. Two is
the hard ceiling.

That last rule is what the reference map shows: Ore_Pit at 6:23 with its guard
at 6:21 has its two Ore piles at 5:21 and 7:21, both against the guard, and
every other mine in the map agrees.

**Both of those doors are now closed by measurement.** `0xEC3510` draws
nothing — a failed fit is followed straight by the next pair — and `0xEB3990`
draws exactly two, which are the object's name. The traced run says so
directly, and how it can be read that precisely is the next section.

#### The mines step, draw for draw

Every object the generator creates is named `item_<signed int32>`, minted from
two `below(65535)` draws, and the reference map records that name. So a pair
of consecutive draws composing a name the map has IS the moment that object
was created — and **all 1,556 objects in the reference find their pair**. That
is what `npm run rmg-decode-draws` does with the trace, and it turns an
anonymous stream into a labelled one.

Zone 1's 75 draws, in full:

```
18492  n  1893595527              the loop's prologue draw, thrown away
18493  b         587              the tile
18494  b           3              the quadrant
18495  b       33794  Mine Sawmill
18496  b       23405     "
18497  f      0.0737              the guard's roll — under 0.6, so several stacks
18498  b           0              which army template
18499  b        1214  Monster Footman
18500  b        3701     "
18501  f      0.1886              a pile is rolled for — under 0.8, so it lands
18502  b       47730  Treasure Wood
18503  b        9017     "
18504  f      0.8662              the second neighbour rolls over 0.8: no pile
18505  b          36              the next mine's tile
...
18541  b          42              a tile that did NOT fit
18542  b           3              its quadrant, drawn before the fit was tested
18543  b         123              so the candidate is struck out and a pair drawn again
18544  b           3
18545  b       26211  Mine Sulfur_Dune
```

Which gives the cost exactly: **1** for the loop's prologue, **2 per attempt**
at a tile, **2** for the mine's name, **4 or 5** for the guard, **1** per pile
rolled and **2** more for each that lands. Zone 1: 1 + 14 + 12 + 24 + 10 + 14
= 75, and the boundary says 75.

Two things the data settles that the code only suggested. Every pile that
landed rolled 0.1886, 0.7641, 0.3076, 0.5571, 0.1160, 0.4472 or 0.2214, and
every one that did not rolled 0.8662, 0.8545 or 0.9702 — the 0.8 is not just a
constant in the image, it is the constant this run obeyed, with no exception.
And all six guard rolls came out under 0.6, which is why every guard here cost
four draws rather than five.

#### The candidate list, and the four numbers it has to satisfy

What is still needed to PORT the step is not the accounting but the candidate
list: `below(587)` only reproduces if the list holds the same tiles in the same
order. The run gives four independent tests of that — the first mine of each
zone, where the list is at its least disturbed:

| zone | the draw | the Sawmill landed at | has a town |
| --- | --- | --- | --- |
| 1 | 587 | 32:21 | yes |
| 2 | 458 | 75:76 | yes |
| 3 | 305 | 53:8 | no |
| 4 | 631 | 15:88 | no |

Three things are settled by those, because getting them wrong misses by
hundreds rather than by a tile:

- **The scan order.** The other way round puts zone 1's tile at index 22
  instead of 587.
- **The ring is measured from the town, not from the zone's start point.** From
  the start point the ring holds 688 tiles and the tile is at 147; from the
  town it holds 950 and the tile is at 706, which the room filter then brings
  to 587 exactly. (The code says the same — `zone+0x0C` is written only by
  `PlaceTowns` — so this is two independent readings agreeing.)
- **A zone with no town really does drop the ring** and offer every tile it
  has: zone 4 lands on 631 → 15:88.

**The whole step is now ported and runs LIVE** — `src/rmg/mines.ts`, and
`test-rmg-mines` lets the same rng that ran the chain keep drawing through
zone 1's entire mines step: 74 draws later the counter stands on the step
boundary the trace recorded, with all six mines, every guard and every pile
on the reference map's tiles, matched by the names their draws minted.

The placement half, read out of `0xEC3510`/`0xEB3990` and the piles block:

- **The fit test** (`0xEC3510`, no draws): blocked tiles and the marker need
  the map, the zone, occupancy EXACTLY 0 — a road blocks a mine even though
  it counts as free elsewhere — and border distance ≥ 1; **active tiles need
  border ≥ 3**. The marker's (0,0) pair is skipped. Floor 1 adds a five-tile
  edge margin, unmeasured — the reference has no underground.
- **Creation** (`0xEB3990`) mints the name — two `below(65535)` — BEFORE the
  factory runs, so a failed creation has already spent them. The only free
  failure is a shared path without "Shared" in it.
- **The guard seat** costs no draws: first free orthogonal of the footprint's
  last active tile, starting from the quadrant's direction. Free here IS the
  road-lenient test. No seat — no guard, no SetMonster; the engine then still
  runs the piles against an UNINITIALISED guard position (the jump skips the
  only writes to that slot) — stale stack, which the port declines to
  reproduce and documents instead.
- **The piles**: eight neighbours, from two past the guard's direction; free
  first, then within 2.0 of the guard, and only then the 0.8 roll — a
  candidate failing either test spends nothing. Two is the ceiling, counted
  after successful creation.
- **Abandoned mines** (`0xEBD700`): a count of zero spends nothing.

The candidate machinery underneath: `test-rmg-mines` also replays each zone's
recorded first draw into the list this port builds, and the tile it picks is
the reference map's Sawmill, zone for zone. What closed the last two was not a new rule but the
reading of the connections phase's stamping:

- a dug passage puts ONE tile into each side's `+0x68` — the digger its mouth
  (which is also the guard's tile), the neighbour its adopted tile. That is
  exactly what `zoneConnections` already returns as `passages`, so the room
  points are the towns' occupancy-4 tiles plus the passages, and nothing new
  had to be built;
- the adoption offsets are MAP-coordinate pairs — dx moves x, the second grid
  index — and the port had been applying them to (row, column). Zone 2 pinned
  it: of the twenty-five points in the mouth's 5×5 neighbourhood, exactly one
  lands its draw, and it is the tile the x-first order adopts. Fixed in
  `connections.ts`, and the sabotage check (swapping the axes back) fails
  zones 2 and 3 and no others.

**The instrument for measuring it** is the step boundary — see below.

## Tools

```bash
npm run rmg-map            # rewrite docs/RMG_CODE_MAP.md from the executable
npm run test-rmg-map       # fail if it drifted
npm run test-rmg-random    # the number stream, against the binary's constants
npm run test-rmg-template  # the template reader and CreateMap, against the 22 shipped templates
npm run test-rmg-params    # the RMGParameters reader, against Params/Default.xdb
npm run test-rmg-zones     # GenerateGameZones: budgets, radii, the hash order model
npm run test-rmg-fill-zones # FillZones: sweeps, the drawless first sweep, determinism
npm run test-rmg-load-template # the engine sort, the full chain, run 3's races from the seed
npm run test-rmg-border-tiles # CalcBorderTiles: the definition by hand, the reference table
npm run test-rmg-terrain   # FillTerrain: the masks against the real GroundTerrain.bin
npm run test-rmg-towns     # PlaceTowns: the towns, against the reference map.xdb
npm run test-rmg-dist-to-towns # FillDistToTownsTable: the 2-and-3 wave, and what it disowns
npm run test-rmg-armies    # SetMonster: the recorded draws replayed into the recorded guards
npm run test-rmg-connections # ZoneConnections: the passages, against the reference map.xdb
npm run test-rmg-mines     # the mines candidate lists: four first picks land the reference Sawmills
npm run test-rmg-log-sites # the oracle's step boundaries, against the editor executable

node tools/reverse/rmg-log-sites.ts --exe <editor> --c   # the table, to paste

npm run rmg-decode-draws -- --step mines   # the draws, with the objects they made
npm run rmg-decode-draws -- --from 18491 --to 18566 --count

node tools/reverse/trace.ts show 0xeab460 --bytes 0x600    # read a phase
node tools/reverse/vtable.ts CGameZone                     # a class's virtuals
```

All of them need the **unwrapped** executable (`npm run unwrap-exe`); the
shipped one ships its code encrypted and disassembles to noise. Where the game
is has to be SAID — `--game <dir>` or `HOMM5_GAME`, never guessed from where the
checkout sits (`tools/game-dir.ts`), which from a worktree would be wrong.

# Porting the random map generator

The goal is not "an editor that can make a random map". It is **understanding
the one Nival wrote** — the generator that lives in `H5_Game.exe` — well enough
to run it in TypeScript and get the same map back. A faithful port is the only
version that can be checked; anything looser is a new generator wearing the old
one's templates, and there is no way to tell a misreading from a design choice.

So the shape of this work is: read a phase out of the executable, write it down
here, port it, check it against a real run, move to the next phase.

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

## This branch works against its own copy of the game

`game/` — a whole install, copied, ignored by git, and named to every tool as
`--game game`. Everything here reads and writes that one.

The reason is not tidiness. Getting anything out of the generator means
installing a native extension and reading what it wrote, and the real install is
**shared**: another session, another branch, the editor someone has open right
now. Installing from a branch into it replaces a DLL that somebody else's work
depends on, and the first sign of it is their session breaking. A worktree
isolates the repository and nothing else; the install needs isolating
separately.

The copy is **vanilla on purpose** — no `UserMODs`, no `h3-mod`, no `H5E`, and
the extension's effects config removed. A mod can change the very data the
generator reads, and what is being measured here is the shipped generator.

Which install is meant is **said**, never guessed from where the checkout sits
(`tools/game-dir.ts`) — from a worktree the guess would name whatever folder the
worktrees happen to live in, and the tool would either fail on a nonsense path
or, worse, quietly work on the shared install.

```bash
robocopy "<install>" game /E /XD homm5-editor UserMODs h3-mod H5E screenshots
npm run unpack-data -- game            # into this worktree's own data-unpacked/
npm run install-native -- --game game  # into game/bin, never the shared install
npm run rmg-oracle -- --game game      # …and check the copy is consistent
```

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
| `terrain.ts` | `CalcBorderTiles` + `FillTerrain` | |
| `towns.ts` | `PlaceTowns` | |
| `connections.ts` | `ZoneConnections`, guards and teleports | |
| `objects/*.ts` | `MainObjects`, one file per placement step | |
| `treasure.ts` | `CTreasureBlockDistributor` | |
| `monsters.ts` | `CMonsterSetter` and the army templates | |
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

node tools/reverse/trace.ts show 0xeab460 --bytes 0x600    # read a phase
node tools/reverse/vtable.ts CGameZone                     # a class's virtuals
```

All of them need the **unwrapped** executable (`npm run unwrap-exe`); the
shipped one ships its code encrypted and disassembles to noise. Where the game
is has to be SAID — `--game <dir>` or `HOMM5_GAME`, never guessed from where the
checkout sits (`tools/game-dir.ts`), which from a worktree would be wrong.

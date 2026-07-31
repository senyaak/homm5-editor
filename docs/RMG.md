# Porting the random map generator

The goal is not "an editor that can make a random map". It is **understanding
the one Nival wrote** — the generator that lives in `H5_Game.exe` — well enough
to run it in TypeScript and get the same map back. A faithful port is the only
version that can be checked; anything looser is a new generator wearing the old
one's templates, and there is no way to tell a misreading from a design choice.

So the shape of this work is: read a phase out of the executable, write it down
here, port it, check it against a real run, move to the next phase.

## Where everything is

**The algorithm is in the game executable, and nowhere else.** `H5_MapEditor.exe`
does not contain a single one of the generator's strings — the shipped editor
cannot generate a map. There is no library to call and no data file that
describes the procedure.

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

`game/` — a whole install, copied, ignored by git, named by `.env`. Everything
here reads and writes that one.

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

```bash
robocopy "<install>" game /E /XD homm5-editor UserMODs h3-mod H5E screenshots
npm run unpack-data          # into this worktree's own data-unpacked/
npm run install-native       # into game/bin, never the shared install
npm run rmg-oracle           # …and check the copy is consistent
```

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
is for (`native/homm5-editor.c`). The screen has no seed field, and the counter
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

**`npm run diff-map` compares the result.** The editor already has it.

Three rungs, in order of what they prove:

1. the port's own tests — properties, and constants read back out of the binary
2. draw counts matching a real run, phase by phase
3. `diff-map` of a generated `.h5m` against ours from the same seed

## The port

One module per idea, under `src/rmg/`. Written to be read: the reason a number
is what it is belongs next to the number.

| Module | Holds | State |
| --- | --- | --- |
| `random.ts` | the 64-bit LCG and the draw counter | **done**, constants verified against the binary |
| `data/template.ts` | reading `RMGTemplate` | next |
| `data/params.ts` | reading `RMGParameters` | next |
| `zones.ts` | `GenerateGameZones` + `FillZones` | |
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

It is a 64-bit LCG using MSVC's own `rand()` constants:

```
state = state * 0x343FD + 0x269EC3        (mod 2^64)
next()      = (state >> 23) & 0x7FFFFFFF
below(n)    = ((state >> 16) & (2^47 - 1)) % n
```

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

## Tools

```bash
npm run rmg-map            # rewrite docs/RMG_CODE_MAP.md from the executable
npm run test-rmg-map       # fail if it drifted
npm run test-rmg-random    # the number stream, against the binary's constants

node tools/reverse/trace.ts show 0xeab460 --bytes 0x600    # read a phase
node tools/reverse/vtable.ts CGameZone                     # a class's virtuals
```

All of them need the **unwrapped** executable (`npm run unwrap-exe`); the
shipped one ships its code encrypted and disassembles to noise. From a worktree,
`.env` names the install — `src/game/install.ts` is the one place that decides
where it is.

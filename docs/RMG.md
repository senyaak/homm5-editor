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

**The whole FIRST LOOP of `MainObjects` runs LIVE** — all four zones,
every step, from the phase door to the loop's last draw at 20039
(`test-rmg-road`): mines, dwellings, upgrade buildings, shrines, the four
price-list steps, the treasures block and the zone ROAD, zone after zone
on the one rng, each step landing on its traced boundary. Hero draws
nothing ever; prisons and the cartographer cost zero by template.

**The ROADS PHASE runs LIVE too** (`0xEBA690`, `test-rmg-roads-phase`):
its 381 coins land on the traced 20420 across all four zones — town
entries and passage points wired into the 0x08 network, mine actives
into the 0x10 one, every tile of both kinds confirmed under the
reference's painted road masks.

**The STATICS run in FULL LOCKSTEP — all four zones** (`0xEA5450` →
the zone vtable's `+0x34`/`+0x30`, `test-rmg-statics`): every one of
the eight traced step boundaries lands, the phase ends on 89798, and
all **1,325 statics stand where their minted names stand in the
reference**, rotations included. Getting there took two live
measurements (the oracle's `grids` and `field` dumps) and surfaced the
biggest find of the port so far: **the game and the editor are
different compilations with different float arithmetic in the road
wave** — and the reference is the EDITOR's, so the editor's x87
arithmetic is the one the port speaks (see the road section). Every
road list of every zone is now byte-identical to the engine's own dump.
**The TREASURE BLOCKS close the run** (`0xEA3AE0` → `0xEBA420`,
`test-rmg-treasure-blocks`): all eight traced boundaries land — the
growth and the fill of each zone — the phase ends on **92438, the whole
reference run**, and its 58 treasures and 24 artifacts stand where their
minted names stand in the reference map, each of the 28 blocks guarded.
Additional objects cost nothing on a surface-only template, which the
trace and the code agree on, so **every draw the reference run spends is
now accounted for**.

**The ROAD PAINTER closes the terrain** (`0xECE3E0`,
`test-rmg-road-painter`): the road networks become the SandRoad,
LavaRoad and Dead_Land layers, and with them the last open difference in
the masks — Dead_Land's theft from Lava — falls in line. **All seven
layers of the reference `GroundTerrain.bin` are now byte-identical, with
no forgiveness clause left.**

**The HEIGHT PLANE closes the float half of ALL THREE references**
(`0xECF760` → `heights.ts`, `test-rmg-heights`, replaying through the
shared full-run driver `tools/rmg-run.ts`): every vertex of the surface,
island and underground floor-0 planes — 24,147 across the three files —
bit for bit. The plane starts at the level constructor's
6.0 (`0xEB2B60`), the statics add the mountain relief cones, and the
late pass lays a sin/cos base field capped at +3.0 over it — the 9.0
plateau is those two numbers — then dents roads and lakes, melts craters
under Inferno towns (-1.0 within 8) and Inferno dwellings (-2.5 within
2.5), flattens every non-static object's footprint to its average
(Academy towns and dwellings hover and are skipped), floods each lake
body to its corner minimum - 0.1, and smooths thrice. The pass needed
the biggest arithmetic fact since the road wave, and it is visible in
the file itself: **the reference is the EDITOR's x87 arithmetic** —
double intermediates, one rounding per store — which is why the plateau
survives the smoothing at exactly 9.0 where the game's own SSE kernel
would drift it by 1.9e-6 per pass. Phase 15 below has the details.

**The MAP.XDB EMITTER closes ALL THREE documents** (`emit.ts`,
`test-rmg-emit`): 860,435 + 529,998 + 873,921 bytes, each byte for byte.
The blank skeleton (`buildBlankMap`) is patched at its known value-level
spots — the drawn ambient light (and the fixed Tests/underground light
plus a second minimap thumbnail on two-level maps), the text refs, the
active player slots, the emptied rosters, the live `sRMGProps`, the
dialogs camera — and the objects render through one fixed body per
AdvMap type, in the run's slot order, `Rot` as `%g` of the stored f32.
Inputs that are not the generator's come from outside: the GUID
(CoCreateGuid), the MapName (typed into the dialog), the dialogs camera
and the shipyards' ShipTile (both derivations unread). The facing rules
the byte-diffs taught: a mine's guard and piles record the seat walk's
`(q + j) * pi/2` UNNORMALISED (a q=2 seat found straight ahead writes
the full 2*pi); an upgrade building's guard records the building's own
rotation; a teleport's guard the teleport's (8/8); a shipyard's guard
one quarter BEHIND the facing (4/4). A tier >= 3 dwelling reuses
descriptor 3 and writes `creaturesEnabled[tier - 3]` — the underground
run's OrcishDwelling04 is the live case. Underground towns wear their
four faction-coloured point lights and the lit crystals their one, both
rendered from the run's records.

**The GROUND FLAGS need no port.** The flags plane is `CTerrain+0x24` —
the level's byte vertex grid the port already computes: a surface floor
is the constructor's uniform 16 forever (`0xEB2B60`, the same call that
fills the heights 6.0 — and whose underground branch turned out to be
the long-missing writer of the massif frame `createVertexHeights` had
reconstructed from measurement), and the underground floor is the massif
carve's byte grid, which matches the reference plane 5,329/5,329.

**The PASSABILITY plane is PORTED, and all four reference files are now
byte-identical outright.** It cost two wrong verdicts before the right
one, so the road is worth keeping.

The first verdict said the game's RMG never writes the plane and that
all-ones is therefore exactly what the generator produces. False: a map
ordered from the GAME'S OWN in-game generator (it lands in
`<game>/H5E/`, where the game writes, not `<game>/Maps/`, where the
editor does) carries 1,874 zeros of 5,329. The second guess was that the
derivation must be a 3D scene query, and that porting it meant a
collision subsystem. Also false, and three fitted rules had already said
the plane was not a function of anything the port held — the objects'
declared footprints 79.6%, the occupancy grid 82.4% / 75.9%, the terrain
slope 70.1% / 74.7%.

What settled it was the oracle, not more reading: a `pass` probe that
counts the plane's zeros at every step boundary. The plane reads ALL
ONES on every boundary of the surface run — zones filled in, main
objects, roads, all four zones' statics, additional objects, treasure
blocks — and 3,930 zeros at "finished creating map", with the draw
counter at 92,438 on both sides. One drawless window, between the log
sites `0xEAC0C3` and `0xEAC21F`.

The code in that window loops the LEVELS (stride 0x120), walks each
level's chained table at `level+0xAC` / `+0xB0` — a pointer array of
list heads, `[node]` the next link, `[node+8]` the payload — and calls
the payload's virtual slot `+0x38` (`0xEAC185`). The payload is a
**CGameZone**, read off the live object because no vtable in the
executable would say so: not one AdvMap class implements `+0x38` with
anything but a `ret` thunk, and a sweep of all 2,314 RTTI classes
returns 201 small look-alikes. So this is a per-ZONE pass, which is
exactly why no per-object rule could fit it.

The slot itself (editor `0xBF9BC0`) recomputes the room grid with mask
0x3C — the statics sweep's own list — then walks the zone's `+0xCC`
tiles and marks

    room > 2,   or   room <= 2 and border == 0

where "mark" is `0x7949A0` on `map+0x60`, whose whole body is
`plane_rows[floor][a][b] = 0`. A water-bordered zone overrides the slot
(`0xC069E0`) with the same walk and the condition turned into an AND —
`room > 2 and border > 1`, the coast left alone the way every other
water rule keeps off it.

Two things the byte comparison decided rather than the reading: the
plane's rows are indexed the way the texture masks are (the engine's own
indices are transposed against the file, as the river plane's already
were), and the plane's sense is the opposite of its name — it starts at
1 and this pass writes 0 into the OPEN ground. Ported in
`passability.ts`; both halves of the rule were checked by sabotage (228
and 117 bytes move for the base rule, 433 for the water one) and the
suite no longer exempts anything but the single uninitialised engine
byte.

**GroundTerrain.bin ASSEMBLES WHOLE** (`emit-terrain.ts` — the blank
writer generalised to N layers, its multi-layer counters read off the
reference framing and verified to the byte: `E_i = 2N + 2·len_i + 53`
per layer, a `01 E 02 F 01` bridge between layers, `D = 2·region + 1`):
ALL FOUR reference terrain files — the surface one, the island one
(water plane included), the underground run's surface floor and
UndergroundTerrain.bin — are byte-identical but for ONE
uninitialised byte: the 0x0e record's
payload, the same byte the determinism check once caught flipping
between identical runs.

**The LAKE TERRAIN PAINTER is read and ported** (`0xECE680`, thiscall on
the same CTerrainProcessor, called once per zone from the lakes head's
tail at `0xEBCA90` and BEFORE the head's decorations; drawless). It is
the same function whose own tail (`0xECEE65`) does the 0x82 deep-water
conversion the statics already needed — that half stays in `growLakes`,
the terrain half is `paintLakes` / `stampZoneLakeRiver` in `terrain.ts`.
The documents are the PRESET'S, not the params': `WaterTile` (`+0x64`)
and `WaterBottomTile` (`+0x70`) — Haven's are exactly the reference's
two new layers, `/RMG/Tiles/Water/Water.xdb` and
`/RMG/Tiles/Haven/River-bed_grass.xdb`, and the five races that name a
WaterTile are the five the lakes gate opens for. (The offsets fall out
of the Tiles block's own chain: the shared refs are 8 bytes with their
`*Strenght` int behind each, so RoadTile 0x4C, SecondaryRoadTile 0x58,
WaterTile 0x64, WaterBottomTile 0x70, OtherTiles 0x7C, WaterCoastTile
0x88, OneTileSmallBlockers 0x90.)

Per blob tile, in the head's collection order, the engine first counts
how many of the four ORTHOGONAL neighbours are themselves blob tiles —
a linear rescan of the whole vector per neighbour — and then:

* paints the WaterTile at the four corners, the LITERAL 150 (0x96;
  `TransitiveTileIntensity` is unread here too — and, it turns out,
  everywhere). Water.xdb is priority
  253 TT_SMALL_WATER and alone in its class, so a rim vertex painted
  once keeps 150 and an interior one painted again overflows to 255 —
  the reference's 28 and 129 on the nose;
* stamps the river plane, but ONLY where room > 3 AND at least THREE
  orthogonal neighbours are lake — the blob's interior, the rim left
  dry. The 4x4 half-tile block at (2x, 2y) takes
  `min(255, (min(room, border) - 1) * 60)`. Unlike the sea's stamp
  there is NO guard against the plane's dimensions, and unlike the
  sea's blur no `1 <= x,y <= size-3` either: a lake sits deep inside
  its zone by construction, so the engine never needed one;
* paints the WaterBottomTile at the same four corners at
  `min(200, (min(room, border) - c) * k)` — c/k are 4/15 when the
  setting race is RACE_NECROMANCY (`cmp [ebp+18h],7`) and 2/30 for
  everyone else. Nothing clamps this from BELOW: a shallow tile asks
  for a negative weight and PaintTile takes it down its subtract
  branch.

Then the blur, the sea's verbatim: `k = 0..2*count-1` over
`list[k % count]`, two in-place sub-passes per tile (distance 2, then
distance 1), each cell `(N + S + E + W + 2*C) / 6`.

The room and border readings travel WITH the blob (`lakeRoom` /
`lakeBorder` off the statics sweep) because the painter runs inside the
statics while the layers only exist once fillTerrain has been replayed,
and every zone behind this one recomputes the room grid. `zone+0xEC` —
the value the painter hands `0xE9FF00` — is the ZONE'S OWN ID, not a
race: the call is the zone lookup (the same one whose failure at
`0xEA414A` skips a zone whole), and the preset comes from the resolved
`zone+0x20`, which is the terrain-race entry FillTerrain paints the
ground from. That was left open when the phase was first written down
and is now settled; the oracle's grids dump reads the same field as an
id (`native/rmg/oracle.c`, the zone-mismatch guard). Each of the three
readings above was
checked by sabotage: 4 bytes move for the 150, 198 for the bed ladder,
551 for the river value, all of them inside the underground run's
surface file and nowhere else.

**The port is complete as a generator.** `npm run rmg-pack` orders a map and
writes the `.h5m`, and against the reference the archive's 17 entries come out
15 byte-identical with the other two apart by the two amounts named below —
one uninitialised engine byte in the terrain file, ten channel bytes in the
minimap.

**Two things were decided next, and both are done.**

1. **An oracle on demand.** Every order but the three references has no map
   from the engine to be compared against, and that is what `S2-3P2Z7N2`
   showing 15 of 20 means. The command line was the first place to look and it
   has been read to the end: the editor takes no switch that generates
   anything — but it carries a CONSOLE COMMAND that does, with parameters of
   its own. "Ordering a generation from outside the dialog" below is what was
   found, what it can be told, and what it still cannot.
2. **What every template and params field is for** — "Which fields the engine
   actually reads" below. Every field of `RMG/Params/Default.xdb`, of a
   template and of its zones has been put to two questions: does any
   instruction in either executable read it, and does changing it change the
   map. **Sixteen of the parameters' fifty-five feed nothing**, along with the
   template's `GraalOnMap` and `Underground` and its zones'
   `RedwoodObservatoryDensity` and `DenOfThieves`; `BuffPoints` is read and
   handed to a worker whose whole body is `ret 4`. All four of the claims that
   were stated more strongly than they were earned — `TransitiveTileIntensity`,
   both `*RoadTileStrenght`, the observatories' `&params[i]` — came out TRUE,
   and are now settled over the whole image and against the engine rather than
   over one function. Two things it left open: `CanBeWater` is unread by the
   code and unreachable by the probe, because the console command has no water
   switch; and a launch's SECOND order does not repeat its first, which is a
   trap for the batch and an unexplained piece of engine state.

**What is next, and it is a run rather than a reading.** The oracle exists now:
any order can be given to the engine and the map it makes compared with the
port's, byte for byte. What has never been done is asking it of the templates
nobody has ordered — the port is held to THREE references and there are
twenty-two templates.

1. **The sweep.** Every template, one seed, no minimap, one launch per order:

   ```bash
   node tools/rmg-batch.ts --game <dir> --orders orders.txt
   node tools/rmg-diff-map.ts --game <dir> game/bin/rmg-batch/<n>
   ```

   Each order reads `RMG/Templates/<name>.xdb -seed 1785351845 -size 1
   -resource 1 -exp 1 -pokeb 148 0`, the last of which is the minimap tick.
   TWO differences are known in advance and are not findings: the
   `caption-text` numbering (two bytes of `map.xdb`) and, if a monster level
   is ever ordered, the port's MEDIUM-only setup.

2. **A second seed over every template that passed.** One seed is one path: a
   template that agrees once is not a template that agrees. This is the same
   trap that put two wrong numbers in the `-size` table, and it costs another
   twenty-two launches to avoid.

3. **Then the debts, in the order the sweep prices them** — the `caption-text`
   counter, the minimap's ten channel bytes, monster levels other than MEDIUM.

4. **Water, as a second dimension**, once `GenerateMap`'s first argument is
   identified. It is also the only way to reach a zone's `CanBeWater`, the one
   field of the format the sweep of readers could not settle.

### The sweep, run

Twenty-two orders, twenty-two launches, seed 1785351845, no minimap. The engine
made all twenty-two. It also **clamps the size**: `-size 1` came back as SMALL
for the small templates, MEDIUM for `S2-*`, LARGE for `S3-*` and HUGE for
`S6-*`/`S7-*`, so an order below a template's own range is raised to it rather
than refused — the comparison is still honest because `rmg-diff-map` reads the
size back out of the map it is given.

| the template | what the port reproduces |
| --- | --- |
| `S1P2Z2M1`, `S1-2P2-4Z4K1S`, `S1-3P2-4Z5V` | **everything.** 12 of 13 entries byte-identical, the 13th being the two `caption-text` bytes that are known |
| `S0-1P2Z2K3.1T`, `.2T`, `T`, `S1P2Z3K5.1`, `S1-2P2Z7V2`, `S2-4P2Z7B2`, `S3-4P2-4Z4K1M` | **every object, every text, every terrain plane but one.** `map.xdb` differs by the known `caption-text` bytes alone; masks, ground flags, passability and the river plane are identical; only HEIGHTS differ, by 4 bytes on `S1-2P2Z7V2` and by a few thousand on the rest |
| the other eleven | `map.xdb` still differs wholesale — the object layer diverges |
| `S7-22P2-8Z15K2.4c` | the port refuses it: fifteen zones, and the fourteenth would rehash the queue whose order has never been read |

**Ten of twenty-one, up from four**, and the four were every template whose
towns matched its players. What moved the other six was one routine — the
garrison below. The cartographer and the zero possession marker moved six
more; the table above is the state before those two.

**The standing count is TWENTY-ONE of twenty-one.** Every template the port
accepts now reproduces the whole object layer, down to the two `caption-text`
bytes that are known; three of them — `S1-2P2-4Z4K1S`, `S1-3P2-4Z5V` and the
reference — are byte-identical through the terrain as well, and the rest differ
only in the height plane, by anything from 4 bytes to a few thousand. The port
refuses `S7-22P2-8Z15K2.4c` outright, and that refusal is the whole of what is
left of the sweep.

**A debt the count hid, and where it went.** `S3-5P2-8Z8K2M` used to differ by
five bytes, only two of them the `caption-text` numbering: three object AMOUNTS
were off by one or two — a monster's 16 against 18, a treasure's 29 against 27
and 12 against 13, in a map of 2.9 MB. Nothing was drawn there, so it was
arithmetic, and it was the smallest handle on that arithmetic anyone had. It
turned out to be the same single rounding as the guard below: `S3-5P2-8Z8K2M`
and `S2-4P2Z7B2` both came down to two bytes with it, without either being
looked at.

#### A zone's PRESET is not always its race's

`S3-5P4Z12B4` diverges in the towns pass, and the draw that disagrees is the
decoration over a town's entrance: the engine draws `below(3)` where the port,
reading `OverTownCenterObjects` as empty for that race, draws nothing.

The zone is 12, its race is Dungeon, and Dungeon's list in the preset table IS
empty — in both paks. So the list the engine drew from is not Dungeon's. The
oracle now says whose it is: alongside the room points, `zp <zone> <preset>
<count>` prints the pointer at `zone+0x20` and the length of its `+0xE4`. Two
zones of one race share one preset, so the pointers identify the rows without
reading a name, and they turn out to sit 488 bytes apart in race order:

```
zp 1 387397552 3     zp 5  387395600 3     zp 9  387398040 -1
zp 2 387396088 -1    zp 6  387395600 3     zp 10 387397552 3
zp 3 387396088 -1    zp 7  387398040 -1    zp 11 387395600 3
zp 4 387396088 -1    zp 8  387398528 3     zp 12 387395112 3
```

Eleven zones hold the preset of their own race. Zone 12 holds `387395112`,
one step BELOW Preserve's — race 3, Haven. And the decoration the engine
placed over that town is `LeafDownBig`, which is Haven's list at index 2,
exactly the `2 of 3` it drew.

Its town and its garrison are Dungeon's all the same: the town document is
`Dungeon`, and the guard it got is an Assassin, a Dungeon tier-1 creature. So
the zone carries the race for its TOWN separately from the preset it PAINTS
and decorates from, and the port has only one of the two.

And the rule is in the code, at `0xeb4c70` — the zone's own setter, which
fills BOTH pointers:

```
mov ecx,[esi+18h]              the zone's race
call 0xBA18A0                  its preset row
mov [esi+1Ch],eax              +0x1C = the race's own
call 0xBA18A0
cmp dword ptr [esi+18h],6      is the race DUNGEON?
mov [esi+20h],eax              +0x20 = the same, by default
jne done
cmp dword ptr [esi+0F4h],0     is it on the SURFACE?
jne done
mov ecx,3                      then entry 3, HAVEN
call 0xBA18A0
mov [esi+20h],eax
```

The port already had that rule — `LoadedZone.terrainRace`, comment and all.
What it did not have was the town pass READING it: `placeTowns` looked the
preset up once, by the zone's own race, and used it for both the town
prototype and the decoration. The prototype is right that way — zone 12
builds a Dungeon town and a Dungeon creature guards it — and the decoration
is not.

The three subclass zones override the same slot wholesale: Subterra paints as
Dungeon (`0xec4910`, `mov ecx,6`), and the Dwarven and SubInferno ones set
their own constants at `0xec6ef6` and `0xec9170`.

**What the first pass thought the line was.** Before the towns pass was read,
the four templates that matched were exactly the four whose towns equal the
order's players, and the count of ZONES looked like the divider because it
happens to correlate. It was not: the divider was a town nobody owns, and the
reference template has none. Two of anything is the case where a rule cannot be
observed, and the reference had been the only witness for a long time.

**And the near miss is one plane.** For the three `S0-1P2Z2K3*` maps the only
difference in the whole file set is the height plane: 404 vertices of 9409 on
`.2T` (max delta 0.065), 583 on `T` (0.565), 816 on `.1T` — and that last one
is not noise. Around tile (43,76) the engine digs a bowl to 5.73 where the port
leaves the plateau at 8.92, a 3.19 drop over a five-tile core with a wide
skirt, while every other plane of the same file agrees. So the heights carry
two separate debts: a smoothing pass that drifts in the third decimal, and at
least one feature the port does not carve at all.

#### A second seed, because one seed is one path

Twenty-two more launches at seed 987654321, `game/bin/rmg-seed2/`. **All
twenty-one templates the port accepts reproduce the object layer again** — every
`map.xdb` differs by the two `caption-text` bytes and nothing else — and two of
them, `S1-2P2-4Z4K1S` and `S1-2P2-8Z8K2S`, come out byte-identical through the
terrain as well. The twenty-second refuses in the port's own words
(`HashQueue: a 14th zone would rehash`), which is the refusal working.

This is what the first sweep could not say. A template that agrees once agrees
on one path through the stream; the same template on another seed walks
different zones, different races, different templates for its guards. The
height plane moves with the seed as expected — 22888 bytes on
`S6-11P2-8Z8K2.4a` against 4695 on the first seed, 1 byte on `S1-3P2-4Z5V` —
and stays the only thing that moves.

**The heights, measured rather than described.** With the object layer settled
the plane is the only thing left, and it holds two different debts — told apart
by looking at the smallest case and the largest.

- **The smallest is rounding.** `S1-2P2Z7V2` differs in FOUR vertices, each by
  exactly one ulp and each one ulp HIGH: `0x412e32d9` against `0x412e32d8` at
  (82,62), and three more in a row at y=64. Nothing to carve there — a product
  or a sum landing on the other side of the last mantissa bit, the same shape
  of thing as the guard budget above.
- **The largest is a feature.** `S0-1P2Z2K3T` differs in 736 vertices, and they
  are not scattered: they are one bell centred on vertex (36,80), 0.565 deep at
  the peak and fading to nothing by eight tiles out — the exact shape the
  smoothing pass makes of a single local dent. Our side reads a flat 9.0 across
  the whole blob, so the engine dug something we never dug. What sits there is a
  4x4 `Lava/Mountains/Hellpikes_4x4_1` static at (34,80), whose footprint covers
  the peak — and the bowl at (43,76) on `.1T` (3.19 deep) is very likely the
  same rule.

##### The relief cone is not the rule: what the engine selects, read and measured

The static that raises a cone was worth reading rather than guessing, and the
reading clears the cone of both bells. The sweep's accept path
(`0xebc123..0xebc152`) gates `0xED1660` on two tests and nothing else:

- **`0xEB3120`** — `find("Mountain")` over the string at `SAdvMapStaticShared`
  `+0x20`, the shared's own resource path (the helper tests that container for
  empty first; the dynamic_cast at `0xebbe4d` names the class). It is the same
  shape as `0xEB3180`, the `"Crater"` test the big spacing rule already uses —
  so the discriminator is the PATH, not a family field, not the visibility
  type, not the model.
- **the count** — `((end - begin) & ~7) > 0x78` over the `+0x54` vector, which
  is `blockedTiles` (the vector the fit and the `1/(n+1)` roll read as well).
  The elements are 8 bytes, so the gate is exactly **more than 15 blocked
  tiles**.

Both are what the port already writes, and the note above was wrong on both
halves: `/MapObjects/Lava/Mountains/Hellpikes_4x4_1.…xdb` DOES carry "Mountain"
(the folder is `Mountains`), and it fails on the count — the shared declares 13
`blockedTiles`, not the 16 its 4x4 name suggests (its `holeTiles` hold 16). The
engine skips it for the same reason the port does.

The natural experiment says the same from the other side. This run also places
23 `Sand/Sandmountains/*` statics whose PATH has no "Mountain" (that folder is
lower-case) while their model href and their `ObjectTypeFileRef` both do, six of
the seven types with n > 15. If the engine read either of those strings, every
one of them would carry a cone. Not one vertex differs anywhere near them.

**And the bells are not cones at all.** Measured rather than described: the
whole plane holds exactly TWO clusters, and adding or removing any single cone
for any static within 20 tiles flattens neither.

- (36,80), peak **-0.565**, 174 vertices, sum -17.5 — the engine sits LOWER
  there, which no cone can do; a smooth bowl with no plateau.
- (25,39), peak +0.27, 409 vertices, sum +36 — a **disc of exactly +0.161**,
  radius ~8, soft-edged. That is the INFERNO TOWN CRATER at (26,40) setting its
  disc to one value: both sides flatten the same 193 vertices, and the engine's
  average is 0.161 higher — about 31 units of height it holds inside the disc
  and we do not. What sits inside is road dents and cone slopes, so what the
  crater's own walk sees of those is the next thing to read. The bowl at (36,80)
  is a separate debt.

`_tmp/bell-*.ts` hold the probes: the cluster walk, the cone toggle, and a
Landweber inversion of the late pass (the pass is affine, so `theirs - ours` is
the smoothed image of one delta added before it).

##### The census: exactly what is left, template by template

`_tmp/height-census.ts` walks all 21 accepted templates against the second
sweep's maps and reports the height plane's differing vertices as CLUSTERS,
at a 1e-4 tolerance so the one-ulp noise stays out of the way.

| | |
| --- | --- |
| **byte-clean planes** | 9 of 21 — slots 1, 4, 6, 7, 9, 11, 15, 16, 17 |
| **noise only (< 0.07)** | 4 — slots 2, 8, 14, 18 |
| **real debt** | 8 — slots 3 (0.56), 5 (1.25), 10 (3.04), 12 (0.58), 13 (5.25), 19 (1.39), 20 (0.99), 21 (6.05) |

Every one of the eight is one or two contiguous clusters, never scatter. Two
shapes, and the second is the whole remaining story:

1. **The crater plateaus** — a soft-edged disc offset by a constant, sitting on
   an Inferno town. The disc is right (193 vertices on slot 3, and no radius,
   centre or `>`/`>=` variant fits better); the AVERAGE it is set to differs,
   so the debt is really shape 2 hiding inside the disc.
2. **Basins the base field digs.** On slot 13 the engine's plane falls to 3.0
   where ours holds 9.0 — a 30-tile bowl 5.25 deep. Reading `theirs` back
   through the formula, the engine behaves as if `dist` there were 44 where our
   border table says 28. On slot 5 the sign is the other way: WE dig to 7.0
   where the engine holds a flat 9.0. Same term, both directions.

**The base field itself is not the bug**, and that is now read rather than
assumed. `0xECF9A0`, line by line: the dist comes from `floor+0xE4` at
`[min(inner, W-1)][min(outer, H-1)]`, the zone from `floor+0xC4` at the SAME
pair, the sign flips when the zone object's `+0x18` is 7 or 8 (`0xF4A9BC` is
-1.0f), the divisors are 3, 10, 42, 13, 29, the noise is divided by the f64
0.15000000596046448, 12.0 is added and `minsd` caps at 3.0, the value lands at
`(outer, inner)` and the road dent (`occ & 0x18`, read `occ[outer][inner]`) hits
the TRANSPOSED corners. Every constant read out of the binary matches the port.
`CalcBorderTiles` writes `+0xE4` and `recomputeRoom` writes `+0xF4`, so the room
grid does not overwrite the border table, and nothing else in the RMG range
stores into `+0xE4`.

Swapping the zone/dist read to the mirrored tile was tried against all four
combinations: it takes slot 5 to ZERO and slot 10's worst from 3.04 to 0.63,
while making slot 13 and slot 8 worse. So the read is not simply transposed
either — something makes the same term reach for a different tile on some maps,
and that is the next thing to find.

##### Everything the late pass adds, read rather than assumed

Since the debt is additive — a plane 5 units lower cannot come from a smoothing
mask, because smoothing a flat field leaves it flat — the whole additive chain
was read out of the binary. It is all faithful:

- **The craters (`0xED0240`) are complete.** Two sub-passes and no third: an
  INFERNO town (the shared's `+0xFC` == 8) walks the floor's `0xC8`/`0xCC`
  extent, takes `sqrt((obj+0x44 - (o+1))² + (obj+0x48 - (n+1))² + (obj+0x4C)²)`,
  keeps the point when `8.0f` (`0xF4BB30`) is strictly greater, and hands the
  list to `0xEB2420` with `-1.0f`; the dwellings (`+0xEC` in {0x48..0x4B}, all
  four compared one after another) do the same with **no** minus-one, radius
  `2.5f` (`0xFAFE90`) and `-2.5f`. `0xEB2420` sums with `addss`, divides by the
  point count, adds the delta and writes back, indexing `rows[second][first]` —
  which is what `setToAverage` does.
- **The border test (`0xEA90D0`) marks what the port marks.** Each of the four
  orthogonal neighbours is bounds-checked first and an out-of-range one jumps to
  the SAME "this is a border" target as a differing zone, so the map edge does
  make a border tile; the reads are `grid[r±1][c]` and `grid[r][c±1]` against
  the tile's own zone, with no off-by-one anywhere.
- **The port's grid convention is the engine's.** Asked of the mines rather than
  assumed: on `S3-4P2-4Z4K1M` every mine of the southern group reads `grid[y][x]
  == 4` and `grid[x][y] == 1`, and zone 4's centroid under `[y][x]` is where
  those mines are. So rows are y, the base field's `min(inner)` IS y, its
  `min(outer)` IS x, and the value lands on the vertex's own tile.

**What the debt actually looks like.** Landweber-inverting slot 13's late pass
(80 iterations, residual rms 5.5e-4) recovers the delta that would have to be
added BEFORE the pass. It is one smooth cone: centred on (123,45), about 19
tiles across, 5.4 deep at the peak, with a slope near 1/3 — and it stops well
inside zone 1 rather than at the zone's edge. Read back through `-dist/3`, the
engine behaves as if `dist` there were 45 where our table says 28.

45 is exactly the distance from (123,45) to the map's north edge, and 28 is the
distance to the zone-2 boundary at y=73 that our table actually uses. But no
border rule explains it: recomputing the table with the map edge excluded, with
unassigned neighbours excluded, or both, fits WORSE than what we have (mean
|diff| 11.7 against 9.5), the room grid fits far worse (35.0), and the plain
distance to the map edge fits best of a bad lot (5.8, worst 24.8). The needed
field is not a distance to any border set — it is our table plus a cone. That
cone is the next thing to name.

Ruled out along the way, so nobody retries them: a missing or extra relief cone
(toggling every static within 20 tiles moves nothing), a lake (slot 5 has no
lake tiles at all and carries the same shape; slot 13's lakes sit 20 tiles west
of its bowl), and the preset-Mountains pass (its cones are unconditional and its
objects are in the matching layer, so both sides raise them).

A note for whoever picks this up: `tools/diff-terrain.ts` compares the planes
with a 1e-4 tolerance and will call a one-ulp plane "ok", while `rmg-diff-map`
counts bytes and will not. Both are right; use the byte count to find that
there is something, and the plane comparison to find out what.

#### One guard of eleven thousand: where a float rounds and the engine does not

`S6-11P2-8Z8K2XL` was the last template to disagree, and the disagreement was
**one object**. Its map holds 11222 of them; a field-by-field comparison of the
two object lists — kind, id, position, shared href, every amount — found a
single row apart:

```
ours    AdvMapMonster item_-444688924 (183,231) Stronghold/Hag        10 10 20 34
theirs  AdvMapMonster item_-444688924 (183,231) Necropolis/Lich_Master 5  5 12
```

Same tile, same rotation, same minted id — so every draw around it landed the
same way, and the two sides were choosing from the SAME position in the stream.
The trace says what they chose among:

```
#655526  tb 33 of 106  |  tb 1 of 107
```

A treasure-block guard, the army branch: `below(candidates)` over the army
templates whose `[MinPower, MaxPower]` contains the scaled power. The engine
had 106 of them and the port 107.

**The budget is recoverable from the stacks**, without guessing. Theirs is
`race_TOWN_NECROMANCY_tier5.3` (Lich_Master 1, Nosferatu 1, Poltergeist 2,
weighted 2960): amounts 5/5/12 mean `k = 5` and a remainder of two
Poltergeists, so its budget was in `[15462, 15793)`. Ours is
`race_TOWN_STRONGHOLD_tier4.5` (weighted 1517) with `k = 10` and four extra
Goblin Defilers — budget exactly **15489**. And 15489 is, to the unit, the
`MinPower` of `race_TOWN_DUNGEON_tier5` — the 107th candidate, the one the
engine did not have.

**So the question was one unit of arithmetic**, and the chain is short:

```
value  = trunc(d * TreasureBlocksTotalValue / sum)   = 7649
power  = trunc(value * 2.5f + 0.5f)                  = 19123
scaled = trunc(power * 0.9f)                         = 17210
budget = trunc(scaled * 0.9f)                        = 15489 or 15488
```

`17210 * 0.9f` is `15488.99958968…`, and the nearest float to that is 15489
exactly — so a port that rounds the product to a float before truncating gets
15489 and one candidate more. This one did, on that line alone: the line above
it, the strength scaling, had been written the other way years earlier, with a
comment explaining why (the reference run's Familiar guard is 23 strong, and
`2000 * 0.9f` truncates to 1799 unrounded and 1800 rounded). The two lines now
agree, and the map agrees with the engine.

**What was ruled out first, and how.** The value could have been wrong instead
— it comes from the block's distance to its town over the zone's sum of those
distances. Biasing that sum by one for the zone did fix this guard and broke
two others (`(211,188)` and `(225,189)`), and the arithmetic of THOSE two pins
the sum at exactly the port's 1608: no integer distance and no sum near it can
give both. So the value was right and the scaling was not.

One honest tension is left. In the GAME executable this multiply is
`mulss` + `cvttss2si`, which rounds — but every measured run here is the
EDITOR's, and both of the readings that touch it (the Familiar guard in the
reference and this guard in `S6-11P2-8Z8K2XL`) say the editor's build
truncates the product where it lands. The port follows the measurement.

#### The zone's tile LIST is not the zone's tiles

The pool a step draws from is `zone+0xCC`, and it is **built once**: `0xEB7790`
walks the level grid and keeps every cell of the zone, its one caller is the
tail of FillZones (`0xeaa609`, right after the sweep's grow and flip lists are
painted back into the grid), and nothing rebuilds it afterwards. The port
derived it from the grid instead, at the moment each step ran — which is the
same list only until something dents the grid, and two later phases do:

- **FillDistToTownsTable disowns** (`0xEC06E0`'s tail): every tile of a zone
  its wavefront never reached is written **-2** in the grid. The list keeps it.
- **the water carve takes the rim** — already modelled, because the island run
  forced it; the carve edits the list in place, which is why `water.kept` was
  the port's only `tiles` until now.

So the engine draws from a pool that includes tiles the grid says belong to
nobody, and a port that rebuilds the pool has a SHORTER one with no differing
draw to say why. That is exactly how `S3-5P4Z12B4` diverged: 348 candidates
against 346 at zone 1's first dwelling, both sides at threshold 16, and 15
would have given 404 — so the threshold was never the question.

**Read, not inferred.** The oracle's `points` dump now also prints the list:
`zt <zoneId> <count>` and `ztt` with the tiles, fifty to a line (they are FLOAT
pairs — `cvtdq2ps` at 0xeb7858). Against the port's own `zoneTiles` the answer
was flat: nine zones identical to the tile, and zones 1, 3 and 6 exactly two
tiles longer — six tiles in all, every one of them reading -2 in the port's
grid, and all six inside one 3x3 pocket at (71..73, 80..82) that the towns'
wavefront had walled off.

**Which steps read the list, and which do not.** Every step that says "the
zone's tiles" in this document means `+0xCC` unless it is one of the two below:

| walks `+0xCC` | walks the GRID |
| --- | --- |
| dwellings, prisons, cartographers, the price lists, upgrade buildings, treasures and chests | the mines (`0xeb5cd0`: two counted loops over the grid dims, `[+0xC4]` compared to `zone+0xEC`, border `[+0xE4] > 1`) |
| the lakes' seed scan (`0xebc2c9`), the preset mountains' first loop (`0xebcb18`), the big-statics sweep, the one-tile bucket scan and its border fence (`0xEBAA70`) | the lake blob's wavefront and the road relaxation, which are grid sweeps in both |

The cheapest witness is the one-tile **fence**, because its difference is
DRAWN: the pass spends a `below(4)` on every entry of the list before any test,
so two extra tiles are two extra draws. That is what caught it — the engine at
draw 186583 drawing one more quadrant than the port had.

**And it moved the divergence four times in a row**, each fix uncovering the
next place the same reading had been missed: 158277 (dwellings) → 165184 (the
big-statics sweep) → 186583 (the one-tile fence) → 239928 (the preset
mountains) → **none**. `S3-5P4Z12B4` now replays all 354661 draws of the
engine's trace and writes a `map.xdb` that differs in the two `caption-text`
bytes alone; 57 bytes of its height plane remain, which is the standing debt of
sixteen other templates.

### Where each template's run first turns differently

`tools/rmg-diff-draws.ts` now takes the order out of a generated map
(`--from <run>`), replays the chain or the whole run (`--full`), and prints
**the limit each `below()` was called with** beside its value. That last part
is what made the rest readable: "the engine drew 2 and the port drew 5" says
only that they disagree, while `tb 2 of 3 | tb 5 of 30` says what each side
was choosing among, and the phase counters say where it was standing.

Eighteen of the twenty-two were traced this way, one launch each. **Seven have
a chain that matches the engine draw for draw**, limits included:
`S0-1P2Z2K3.1T`, `.2T`, `T`, `S1P2Z2M1`, `S1-3P2Z7V3`, `S2-3P2Z7N2`,
`S3-5P2Z7N2.2`. The other eleven diverge inside the towns pass. The split is
exact, and it is not the zone count the sweep first suggested:

| | towns declared | chain |
| --- | --- | --- |
| the seven | exactly 2, the same as the order's players | matches to the last draw |
| the eleven | 3 or more | diverges in the towns pass |

#### What the four draws are: a town nobody owns is GUARDED

Read, not inferred. `PlaceTowns` itself draws nothing — every draw between
"Rnd Counter(PlaceTowns)" and "at %g towns placed" is made inside
`CGameZone::PlaceTown` (the editor's vt+0x20, `0xc04120`) — so the oracle now
brackets that call, and `SetMonster` (`0xed2330` in the game, `0x792bc0` in the
editor, found by its own complaint "no monster set at town, power: %d") with
it. On `S1P2Z3K5.1` the brackets say:

```
pt  13779 1000     town 1, PLAYER_1   ─┐ 13 draws
pto 13792 1                            ┘
pt  13792 1000     town 2, PLAYER_2   ─┐  7 draws
pto 13799 1                            ┘
pt  13799 20000    town 3, PLAYER_NONE ┐ 11 draws
sm  13805 20000      SetMonster        │  ── 4 of them, drawing 20, 3, 20, 3
smo 13809 1                            │
pto 13810 1                            ┘  and then the specialisation, of 20
```

So the port was not four draws short of a specialisation — it was missing a
whole call, and its specialisation landed four draws early. The two agreed at
draw 13806 by accident: the engine's `below(20)` there is `SetMonster`'s spread
and the port's is the specialisation pick, and two different routines drawing
the same limit produce the same number.

**The condition is the owner, and it is in the code**: at `0xeb577f` the game
reads `cmp dword ptr [edi+0F0h],0` and skips the guard when it is not zero —
zone `playerNo` 0 means nobody, and only that town is guarded. The power is the
caller's first argument, and the two values seen say what it is made of:
`zone.townGuardStrenght × params.basicLeverGuardPower` — the template's zones
carry 1, 1 and 20, the parameter is 1000, and the brackets show 1000, 1000 and
20000. Both fields are already read by the port.

**But this is NOT the `setMonster` the port has.** The ported one opens with a
`betweenFloat` and can spend `10 + below(30)`; the town's guard spends
`below(20)`, `below(candidates)`, twice, and no float at all. `0xed2330` is its
own routine — the log string says "at town".

**Ported, in `src/rmg/town-guard.ts`.** One stack per tier from 1 up, stopping
at seven or when the power runs out:

```
spread = below(20)
count  = ((spread + 20) * (9 - tier)) >> 1     -- a shift, so an odd product
pool   = creatures of THIS tier and THIS race, in table order,   loses its half
         minus ids 0, 89 and 114
count  = min(count, power / creature.power)    -- and this is the last tier
power -= creature.power * count
```

The race the pool filters on is the zone's own: the engine's switch at
`0xeb5788` maps races 3..10 to town types 3..10, which is the identity — the
two enums in `types.xml` are the same list, and the one place their NAMES
differ is 9, `RACE_DWARF` against `TOWN_FORTRESS`.

It is checked against the map, not just the draw count. `S1P2Z3K5.1`'s Academy
town draws 13 and 15 of twenty: `(13+20)*8/2` is 132 Gremlin Saboteurs at 105
each, `20000 - 105*132` is 6140, and `6140/180` is 34 Marble Gargoyles — which
is that town's garrison in the engine's own file, slot for slot. The whole run
now matches draw for draw, all 90 364 of them, and the map differs by the two
`caption-text` bytes and the height plane.

**A town nobody owns costs the engine two draws the port does not spend.** On
`S1-2P2-4Z4K1S` (4 towns, 2 players) the extra pair — `below(3)` then
`below(20)` — appears after the specialisation draw of the THIRD and FOURTH
towns and after neither of the first two, and those are exactly the two whose
`playerNo` is 0. On `S1P2Z3K5.1` (3 towns, 1 of them unowned) the same pair
appears twice rather than once, so the trigger is established and the COUNT is
not: what the pair is drawing is a reading of the towns pass that has not been
done. Until it is, every template with more towns than players is stopped at
its first unowned town, and nothing downstream of that can be judged.

#### The cartographer, and a possession marker that is not one

Two more steps of the same sweep, each found the same way and each closing
several templates.

**`0xEBD4B0`, the cartographer**, between the prisons and the shrines: the
prisons placer's twin — the same 0xEC1500 candidate helper, the same attempt
loop, the same two draws minting the name — with the template zone's
`LandCartographer` (+0x4C, the field right after Prisons) for a count and a
fixed `AdvMapCartographerShared` for an object. Five of the twenty-two
templates ask for one, in exactly one zone each, and the reference asks for
none, which is why a whole step of MainObjects was missing without a single
suite noticing. Its `Cost` of 4000 is the type's default and is not drawn.

**A possession marker of (0,0) is no marker.** `S1-2P2-8Z8K2S` diverged with
nothing in the trace to explain it: seven zones identical draw for draw, then
zone 8 drew a tile from a pool of 447 where the engine drew from 511. A pool
is not drawn, so the trace could only say that the two disagreed.

What decides a pool is the room, and what decides the room is the zone's
`+0x68` point list — the distances are measured FROM it, and it never costs a
draw. So the oracle dumps it: `points` in the config writes `rp <zone>
<count>` and the pairs at "connections created", the one boundary where the
list is the input MainObjects will read. (They are floats, unlike the ints
every other dump carries.)

Seven zones matched point for point. Zone 8 held four points in the engine and
five in the port, and the extra one was the town's possession marker — a
Stronghold, the one shipped town whose marker offset is (0,0), which is the
town's own tile. The engine neither marks it nor counts it. Measured, not
derived: the engine's own list says so and the instruction that refuses it has
not been found.

**The three that were worse than they looked.** `S1-3P2Z7V3`, `S2-3P2Z7N2` and
`S3-5P2Z7N2.2` had a chain that matched completely and still wrote a map that
differed wholesale — a SECOND bug, downstream of everything the chain does.
`--full` named it for the first of them, and it was the cartographer:

```
FIRST DIVERGENCE at draw 33971, in the port's zone 5 resourceBuildings → treasuryBuildings
  engine: tb 243 of 258        a tile, straight away
  port:   tb 0 of 7            an item picked from a list of seven
```

A priced-list step draws `below(count)` for the item, then tile and rotation
per attempt, then two draws to mint the name — the port's zone 1 shows the
shape and the engine agreed with it there. In zone 5 the port spends NOTHING
between the mines and the treasury, while the engine places one more thing
first: tile, rotation, a retry, a mint, and no item pick at all. So the port
is skipping a step the engine runs, and the step it skips does not choose from
a list.

**The four biggest are untraced.** `S6-11P2-8Z8K2.4a`, `S6-11P2-8Z8K2XL`,
`S7-15P2-8Z9K2.4b` and `S7-22P2-8Z15K2.4c` are 256-tile maps, and a traced run
of one writes tens of megabytes and outlives a five-minute clock. They declare
8, 8, 9 and 14 towns against two players, so the rule above PREDICTS the towns
pass for all four — predicts, not measures.

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

**A SECOND reference exists for the underground.** The same seed ordered on
template **S0-1P2Z2K3.1T** (tiny 72×72, 2 players, underground on, no
water) — templates carry an explicit `<Underground>` flag and the dialog
filters by it, so the surface template could not simply be re-ordered. The
run is 70,799 draws and it measures what the surface one never enters:
floor balancing (zone 1 lands underground), the underground terrain
(`UndergroundTerrain.bin`, laid out beside the other two files), the
PRISONS step (8 and 6 draws — always zero before), additional objects
live (85 draws: zone 1's treasures and chests, played late behind the
floor gate) and the two-floor treasure blocks (3,103). Lay it out with
`npm run rmg-reference -- --underground <map.h5m>` into
`_tmp/oracle/reference-underground/`; a heavier acceptance run of the same
seed on S2-3P2Z7N2 (245,577 draws, four underground zones) is saved in
`game/Maps/1785351845uuu.h5m` and stays in the log for later.

**A THIRD reference exists for water.** The same seed on the same surface
template, with the ONE remaining setting flipped: the dialog's water
CHECKBOX. Checking it records `WaterAmount = WATER_ISLAND_MAP` — the enum
is tri-state (`NONE`/`PRESENT`/`ISLAND_MAP`) but the dialog can only order
0 or 2; the middle `WATER_PRESENT` arises only when water is left to the
`below(2)` coin, which no ordered run can do. Unlike the underground,
water is a per-order parameter, not a template flag — `RMGTemplate` has no
water field, and no shipped template has a zone with `CanBeWater=true`,
which does NOT stop the water from coming (so `CanBeWater` gates something
narrower, still unread). The run is 65,421 draws (`1785351845w.h5m`,
boundaries in `_tmp/oracle/island-run-boundaries.txt`, trace archived as
`_tmp/oracle/log-water-island-run.log`); the map places Shipwrecks — the
first live sighting of a `WaterTreasures` consumer — and its terrain
carries the water layers (188,739 bytes against the surface run's
169,757). Lay it out with `npm run rmg-reference -- --water <map.h5m>`
into `_tmp/oracle/reference-water/`.

**The island run is in FULL LOCKSTEP — all 65,421 draws**
(`test-rmg-water`): every draw matches the trace in kind and value, every
traced boundary lands (the first loop per zone, the roads phase at
20,511, all eight statics boundaries, the blocks' growth and fill per
zone), and every named object of the run — 834 checked — stands on its
reference tile: water treasures, monoliths, shipyards, the loop's
objects, 638 statics (rotations included) and the treasure blocks. The
shipyards wire into the road networks through `+0xC0` with
`roads-phase.ts` unchanged, and the island's road lists came out
byte-identical to the oracle's grids dump — all twelve, the unpainted
0x20 corridors included. The occupancy grid at the roads boundary
matches the dump in ALL 9,216 cells. Water changes NOTHING through FillZones and the towns (the
supplied WaterAmount costs one discarded draw either way); what it adds,
read out of the executable and ported:

- **The water border pass** (`water-border.ts`) — the block at 0xEABB1D
  between "towns placed" and the dist-to-towns tables: a SEA DEPTH by
  size index (the 0xEAC3C0 jump table: 2/3/4/5/7/8/10 for indices 0..6,
  else 3 — the small run's index 8 falls to the default 3), then every
  floor-0 zone's vtable `+0x24` — a one-instruction ret on CGameZone,
  the carve on CGameWaterBorderedZone (0xECB7D0). The carve is drawless:
  tiles with border < depth leave the zone grid (-1) into a sea vector,
  EVERY zone tile's border takes += (1 - depth), the `+0xCC` list is
  rebuilt keeping adjusted border >= 0 (the border == depth-1 RIM stays
  listed while the grid disowns it — the grid alone no longer derives the
  list, so the chain carries it), and the rest goes to the `+0x148` water
  ledger. The treasure tail (0xECDB20) spends exactly five draws per
  placement, count = trunc(len(rebuilt `+0xCC`) / 200): candidates are
  sea tiles inside [1, dim-2] and at least 5.0 from every earlier
  placement (`+0x154`), then below(candidates), below(len(WaterTreasures
  — params `+0x210`)), below(4) x pi/2, and the mint. All 36 landed.
- **Island connections** — the land digger finds no adjacency across the
  sea (0 draws, all three template connections unconnected), so the
  second sweep serves them: the vtable's `+0x2C`, which on
  CGameWaterBorderedZone (0xECCB30) is the UNDERGROUND TELEPORT PASS
  (0xEB7C60 — `teleports.ts`, reused verbatim: Monolith_Two_Way pairs on
  GroupID with guards) plus, under the zone's `+0x164` Shipyard bit, ONE
  SHIPYARD (0xECC0A0 — `shipyards.ts`). The shipyard: candidates from
  the rebuilt list with border in [2,3] strictly inside depth+3 margins,
  room (the shared ensureRoom) filtered by trunc(4*max/5) with
  0xEC2EB0's gates (a border-2 tile counts toward the pool but not the
  maximum); ONE below per fit attempt — the facing is not drawn, the
  shipyard TURNS toward the town entry (or the zone's tile centroid,
  singles arithmetic) by quadrant; the stamp's actives join the zone's
  `+0xC0` connection points (the roads phase will wire the shipyard in),
  a 5x5 halo turns occupancy 0 into 1, and the guard seats from the last
  active through the shared EIGHT table from 2q — power =
  BasicLeverGuardPower x ConnectionGuardLevel x 20, the 20 an immediate
  (0xECC901), not a read of ShipyardGuardsLevelCoef. The seat joins
  `+0x98`.

**What the carve does to the first loop.** The rebuilt `+0xCC` is the
candidate list every list-fed step reads, and after the carve the grid
no longer derives it: the RIM (original border == depth-1) keeps list
membership with grid -1 — and the room recompute writes zoneless cells
1000, so a rim tile passes EVERY room threshold and sits in every pool
until the fit's zone test rejects it. The placers now take an optional
`tiles` list (`ZoneFill` serves the carve's kept list on water runs;
no-water runs still derive from the grid, which is the same list there
by construction). Two more water-only facts, each found as a one-draw
divergence: the shipyard's stamp pushes its actives and marker into the
zone's `+0x68` like every 0xEC2F90 stamp (the mines' room sees the
shipyard), and the budget denominators (`resourceBuildings`,
`luckMorale`) count the LIST, rim included.

**The statics with a sea.** The big sweep is the BASE code — the
WaterBordered `+0x34` slot is `0xEBBBD0` itself — but the FIT it calls is
the vtable's `+0x44`, and there the water zone answers with `0xECD840`:
the base tests plus **border >= 3 on every blocked tile** (the statics
keep off the coast) and no zone test or floor margin. Candidates come
from the rebuilt `+0xCC`. The one-tile step IS overridden (`+0x30` →
`0xECCB50`): the base cascades, constants and strictness included, with
NO border fence pass and a bucket gate of occupancy exactly 0 AND border
at least 3 (`statics-one-tile.ts` / `placeWaterOneTileStatics`). The
lakes head runs and finds zero seed candidates on every island zone —
the carved borders never reach its border > 5 gate.

**The blocks and the two facts the last draw taught.** The treasure
blocks run on the shared machinery with the kept lists and the sextant
in the artifact pool (its id-10 gate is the water flag). Zone 4 ran one
draw short until the oracle's occupancy dump named the cause — of all
9,216 cells exactly FOUR differed, the four shipyard guard seats:
**the shipyard's guard writes NO occupancy** (unlike the price-list
guards' 4), so the halo's 1 stays and a free room-1 cell beside the
shipyard road hands the seed scan one more (gate-rejected) below(8).
And the room recompute is LIST-driven (`0xEC28E0` reads the zone's
vectors), so a RIM tile in the list gets its real distance, not the
zoneless 1000 — only the blocks' seed scan can see the difference,
every other reader hides the rim behind a border gate.

**The water terrain — the whole of the island's GroundTerrain.bin, byte
for byte** (`test-rmg-water`'s terrain tail): all NINE texture layers
(the surface seven plus the two the water adds) and the river plane,
12,597 wet half-vertices. The 19 KB the file grew by is exactly the two
extra mask blocks; everything else rides in planes both files carry. The
writers, read from the executable:

- **The carve's own marks** (inside 0xECB7D0, per tile in `+0xCC` order,
  right after the border adjustment): adjusted border in (-depth, 0)
  paints the params' **DeepWaterBottom** (`+0x158` — River-bed) on the
  tile's four corner vertices, adjusted border in {0,1} (the unsigned
  `cmp ..,1 / ja` at 0xECBADE) paints the PRESET's **WaterCoastTile**
  (`+0x88` — Inferno's is its Dead_Land, the same document its
  SecondaryRoadTile names; the shipped table has one empty entry and the
  fallback is DeepWaterBottom, 0xECBB79). Both bands push the LITERAL
  200 — TransitiveTileIntensity is never read here either, nor anywhere
  else in the image. The paint
  arithmetic makes the reference bytes: the bottom tile's priority 20
  puts the zone tile's own 255 in its class-0 base, so one 200 clamps to
  255 and steals 400 — River-bed is {0,255} and the water fringe loses
  its other land layers — while the coast tile's priority 60 usually
  finds base 0 and keeps the bare 200. Port: `WaterMark`s recorded by
  `carveWaterBorder`, replayed by `terrain.ts`'s `paintWaterMarks`.
- **The sea layer and the river plane** (`0xECF080` — the terrain
  processor's sea half, called once per zone from the carve's tail at
  0xECBD2A with that zone's sea vector, before the `+0xCC` rebuild).
  Per sea tile: the params' **DeepWaterTile** (`+0x150` — Water.xdb) at
  the four corners, the literal 200 again — interior vertices reach 255
  on their second paint, the one-vertex ring around the deep sea keeps
  200; then the river-plane stamp: the 4x4 half-tile block at (2x, 2y)
  takes `v = 7 - border` (adjusted, so the sea always lands the > 5
  branch = 255; the v*80 ladder is dead code on this path). Then the
  blur: `k = 0..2*count-1` walks the vector TWICE (`list[k % count]`),
  skipping tiles outside 1 <= x,y <= size-3 (the guard that keeps the
  unguarded kernel reads in bounds); per tile two in-place sub-passes
  over its block, cells row-major — a DISTANCE-2 kernel (the four
  neighbours one full TILE away on the half-grid), then a distance-1
  kernel, both `(N + S + E + W + 2*C) / 6` unsigned (the 0xAAAAAAABh
  magic). The engine's in-memory plane came out TRANSPOSED against the
  file; the kernels and visit order transpose with it, so the port
  (`stampZoneSeaRiver`) holds the plane in file orientation. The stamp
  must run at carve time — the seed reads the border as the carve just
  adjusted it, and the connections dent the grid later — so the chain
  stamps per zone inside the water block while the corner paints replay
  at fillTerrain time (`paintSeaCorners`; the two touch disjoint state).

The late pass `0xECF760` (called at 0xEAC206, after the road painter)
turned out NOT to be about the sea: it is the surface HEIGHT plane —
Phase 15, now ported (`heights.ts`, bit-identical on the surface
reference). The vertex WATER KIND — a DIFFERENT plane from passability,
which the RMG fills in its own last pass (above) — is derived
from the painted texture classes at terrain-build time (0xA20143:
classes 3/4 → 1, land/road → 0).

**The dialogs camera is not a hole — it is a CONSTANT.** All three
ordered references carry the same Rod/Pitch/Yaw and the same anchor at
96 tiles and at 72, with water and without, and a map ordered from the
GAME's own generator carries it too (to the digits its build prints).
The anchor settles it: (94.785, 59.4308) sits OFF a 72-tile map and is
written there all the same, while a hand-made Nival map carries a
completely different camera. `RMG_CAMERA` in `emit.ts`; the suite no
longer lifts it from the reference.

**The shipyards' ShipTile is PORTED — nothing is lifted from a
reference any more.** The placer (`0xECC0A0`) averages the zone's `+0xCC`
tiles into a centroid, takes the shipyard minus it and picks a quadrant
angle off the dominant axis (pi/2 when dx <= 0, 3pi/2 when dx > 0, 0 when
dy >= 0, pi when dy < 0, all plus pi/2). That angle never reaches the
search — it is stashed for the object's own Rot, which the port already
reproduced.

`0xCB1960` is a SEARCH, not a formula: 46 entries of 16 bytes at
`0x10918E0`, each an OUTER offset pair and an INNER one a step back
toward the yard, ordered as a ring — the ±4 rows first, then the corners,
then the sides. It returns the OUTER pair of the first entry whose outer
tile is water and whose inner tile is neither water nor a transition;
finding nothing drops the shipyard candidate outright, so a placed yard
always has one.

The predicate looked like four tests and collapses to one. `0x9EC3C0`
reads the four corner vertices of the GROUND FLAGS plane (`+0x24`,
clamped to `[0, dim-2]`): all zero takes an early exit, otherwise it asks
whether they DIFFER (`0x9EB9E0`, the same four bytes — that is the
"transition" arm) and whether a texture layer of the right class covers
the vertex (`0x9EBAE0`, a walk of the same 0x18-byte layer records
PaintTile keeps). A surface floor's flags are the constructor's uniform
16 forever, so they are never all zero, never differ, and the layer arm
is unreachable — which is also what spares the port from having to build
its texture layers mid-run. What is left is the river half-grid, sampled
at the tile's CENTRE cell (2y+1, 2x+1) against 0x8C.

Ported in `shipyards.ts` as `shipTile`, and all three map.xdb stay
byte-identical with it computed instead of read back. Each part was
checked by sabotage: reversing the ring moves 7 lines, dropping the
inner-tile condition moves 3, and the threshold turns the water run red
at 0x80 and at 0xC0 — ±1 around 0x8C does not move, so the reference
pins the constant to a band and the exact byte comes from the
instruction. The float plane at `+0x54` guards the predicate's tail
(`> 0.0` refuses) but its dims gate the read and no generated map
allocates it; that arm and the two flag arms are named as unexercised
rather than claimed.

**The minimap DDS is DATA, and now it is READ.** `minimap_floor_%02d.dds`
is 256x256 BGRA8, uncompressed, one mip. The statistics said "data" —
9,997 distinct RGB against four distinct alphas, top colours a unit apart
(1a1b26 and 1b1c27), a flat area wobbling 126/127 with a period of three
— but statistics could not say WHICH data, and the fit that tried
("dominant layer's MinimapColor, halved, sampled linearly from the vertex
grid") peaked at 74.9% over all eight orientations and settled nothing.
Everything below is disassembly instead, and it explains every one of
those statistics.

**The chain.** `0xEA30D0` is the RMG's minimap step (its only caller is
`0xEA7DFD`, its own only callees below are `0xDD0C70` and `0xDD1BD0`). It
builds a `CSimplePosConverter` (RTTI locator `0x103DA28`) over the map,
calls `0xDD0C70` to DRAW, `0xDD1BD0` to WRITE the `.dds` and its
`Texture` `.xdb`, and patches `thumbnailImages` into both documents.

**Two layers per floor, not one.** `0xDD0C70` sizes two images per floor
through `0xDCFD40` — the image is `+0x18` buffer, `+0x1C` row pointers,
`+0x20`/`+0x24` width/height, `+0x28` side, `+0x2C` dirty:

- the TERRAIN layer, square of side `N = desc[+0x4C] - 2 * desc[+0x1DC]`,
  one pixel per playable tile;
- the ICON layer, square of side 256, zero-filled, where the objects go
  (`Town_%d`, `Mine_%d`, `Object_%d`, `UnderworldExitEnter`, placed by
  `0xDD3440` and `0xDCFDE0`).

**The terrain pass** is `0xDD0660`, small enough to state whole. With
`A = desc[+0x4C]`, `B = desc[+0x1DC]`, `N = A - 2B`, for pixel `(x, y)`:

```
tile = (tx, ty) = (B + x, B + (N - 1 - y))        ; row index is N-1-outer

colour = 0xFF000000                               ; opaque black
if terrain[+0x64] and byteGrid[ty][tx] > 0x15:    ; leave it black
elif water(0x9EC480, tx, ty):  colour = this[+0x14]        ; one flat colour
else:
    rec = tileDoc(0x9EB800, tx, ty)
    colour = 0xFF<<24 | trunc(rec[+0x64]*255)<<16
                      | trunc(rec[+0x68]*255)<<8
                      | trunc(rec[+0x6C]*255)
if askMask(0xAD13C0) and not 0x9EC3C0(tx, ty):  R, G, B >>= 1
```

`rec[+0x64]` is the `MinimapColor` triple (`AdvMapTile+0x64`, named at
`0x9EECF5`); the multiplier is the float 255.0 at `0xF4A1E8` and the
convert (`0x949FF0`) is `cvttss2si` — TRUNCATION, not rounding. So the
colour does not arrive halved: the halving is a per-tile DARKENING of
`R`, `G` and `B` (`>>1` each, alpha untouched), applied where the bit
mask from `0xAD13C0` says to ask and `0x9EC3C0` answers no. Reading a
zone's flat colour as "MinimapColor / 2" was right by accident — both
zones sampled happened to be darkened ones, and the reference carries the
undarkened form of the very same terrains as well.

**The sampling is Lanczos-3, not linear.** `0xDD1BD0` copies both layers
into one 0x20-byte pair (terrain at `+0x00`, icons at `+0x10`), then
resamples EACH to 256x256 through `0x9743A0` with mode 6. The filter
table at `0x975154` sends 6 to `0x975800` with support 3.0 (`0xF4C7B8`),
and `0x975800` is `sinc(x) * sinc(x/3)`, pi at `0xFA3DD8`. The icon layer
is already 256, so `0x9743A0` takes its equal-size early exit into a
plain copy; the terrain layer is the one that scales — 94 into 256 on the
reference run, measured below, which is where the wobble comes from.

**Then the two merge, icon over terrain**, one pixel at a time at
`0xDD2590`: `out = icon.a ? icon : terrain`, bytes kept in place. Terrain
pixels always carry alpha 0xFF and the icon layer starts at zero, so an
alpha the resample cannot account for belongs to an icon — which is what
"four distinct alphas" was.

**The mapping the icons use** is the pos converter's `0xDCFB00`, and it
agrees with the terrain pass:

```
out.x =       (in.x - B) * 256 / (A - 2B)
out.y = 256 - (in.y - B) * 256 / (A - 2B)
```

— the same border offset, the same y flip. North is up, as
[MAP_PROPERTIES.md](MAP_PROPERTIES.md) has it.

**Which tile document a tile gets** is `0x9EB800`, and it is two walks of
the same list. `0x9ED3E0` goes over the tile's texture layers from the TOP
down, keeps a running transparency (`remaining *= 1 - coverage/255`) and
scores each layer by `remaining_before * coverage`; the best score wins and
its document is returned. Only layers whose `Type` is 10 or 11 are
considered — `TT_SMALL_WATER` and `TT_BIG_WATER` by `types.xml`. If the
winner's score does not beat 32.0 of 255 (`0xF4BB38`), `0x9ED2A0` runs the
identical walk with the gate INVERTED — every layer that is NOT water — and
that answer is used instead. So: the dominant WATER layer if it covers
more than about an eighth of the tile, otherwise the dominant land layer.
Coverage itself (`0x9ED7D0`) is a bilinear sample of the layer's byte mask
at the tile CENTRE (`+0.5` on both axes, `0xF4A0B0`), each fetched byte
first widened as `b >= 0x80 ? 0xFF : b * 2` — so the mask is a vertex grid
and the centre reads as the average of four.

**Two of the three arms are dead on generated maps — but only on those.**
`0x9EC480` returns true when the float plane at `terrain[+0x58]` is at
most 0.0 AND all four of the tile's ground-flag corners are zero, and flag
0 is SEA ([TERRAIN_FORMAT.md](TERRAIN_FORMAT.md)). A generated floor never
digs one: the flags plane of BOTH references — the surface run and the
WATER run — is 16 at all 9409 vertices, because the RMG's water is
texture layers of `TT_SMALL_WATER`/`TT_BIG_WATER` over ordinary ground,
which the tile-document rule picks up by itself. The black arm needs a
flag above `0x15` = 21 in that same plane, and 16 is not. So what remains
for an RMG map is the tile document's `MinimapColor`, halved or not —
and the water reference bears that out: its minimap is 1906 pixels of
`027cf9`, exactly `trunc(Water.xdb's MinimapColor * 255)`, while the flat
colour the in-game path passes (`0xFF027DF9` at `0x108E8CC`) shows up 17
times in 65536, which is blend spatter and not a fill.

On an AUTHORED map with a real dug sea the arm does fire, so the editor's
own minimap will need the colour the RMG path never reaches for.

**And the halving predicate is one the port already has.** `0x9EC3C0` is
the shipyard's water test, ported as `shipTile` in `shipyards.ts`. So the
rule reads: a tile is darkened when the mask bit is set and the tile is
NOT water.

**The darkening mask is the PASSABILITY PLANE.** `0xAD13C0` returns
`container[+0x20] + floor * 0x58 + 0x10` — the first of three 0x18-byte
bitmasks in a per-floor record (`+0x10`, `+0x28`, `+0x40`; the second has
its own accessor at `0xAD13D0`, the third a bit setter inside `0xAD12A0`).
`0xAD0F50` is what writes the first two, and `0xA4F6D0` is what calls it:
a double loop over every tile of a floor that builds a small descriptor
`{ type, ?, kind, …, flag }` and hands it over. The first mask ends up SET
when

- the tile is in the border ring — the bounds test against
  `terrain[vtbl+0x68]()` jumps straight to `kind 5`;
- `0x9EBCB0` says `terrain[+0x6C][ty][tx] == 0` — `kind 3`;
- `0x9EC570` says the tile's four ground-flag corners are all zero, or
  `0x9EBAE0` finds a layer of its class over the vertex — `kind 2`, and
  the descriptor's type is written as 11, `TT_BIG_WATER`;
- `0x9EB9E0` says the four corners DIFFER — `kind 3` again;
- the type is 9, `TT_NONE`, or the descriptor's `+0x10` is 1,

and CLEAR for `kind 1` (plain ground) and `kind 4` (the tile fell inside
some object's footprint list, `[obj+0xBC]`). `0xAD2530` sets a bit,
`0xAD2160` clears one — the two look identical to a fast read and are
opposites.

`terrain[+0x6C]` is the plane allocated at `0x9EC1C0` on `([+0]+1) ×
([+4]+1)`, a vertex-sized u8 grid ADDRESSED PER TILE — which is exactly
the passability plane of
[TERRAIN_FORMAT.md](TERRAIN_FORMAT.md), 0 blocked and 1 walkable, and
exactly how `classifyTiles` in `src/terrain/passability.ts` already reads
it. So the minimap darkens impassable tiles, and the port already holds
the grid it needs.

**Checked against the reference**, `game/Maps/178535184522222.h5m` (the run
`_tmp/oracle/reference/` was built from — its `map.xdb` and
`GroundTerrain.bin` hash equal):

- the SOURCE SIDE IS 94, measured, not assumed. Scoring every candidate N
  by how well the "pure colour" columns line up with `(i + 0.5) * 256 / N`
  gives 16.1 for 94 against about 2 for every other N from 88 to 100 —
  and 94 is `TileX - 2 * BorderSize` = `96 - 2`. So `desc[+0x4C]` is
  `TileX` and `desc[+0x1DC]` is `BorderSize`. The old "256/96 = 8/3" was
  the right shape and the wrong numbers.
- the top colours are `trunc(MinimapColor * 255)` EXACTLY, in both forms:
  Dunes full `ffd854` (359 px) and halved `7f6c2a` (3226), Sand_Cracked
  `af9574` / `574a3a`, InfernoBricks `4d3634` / `261b1a`. Both forms of the
  same terrain appear, which is what proves the halving is per-tile and not
  a property of the colour. Truncation is what makes them exact —
  the earlier "one unit off in R" was rounding in the reading, not in the
  engine.
- the four alphas are 253, 254, 255 and 11: the terrain layer's uniform
  0xFF comes back off the Lanczos pass as 253/254 (the filter runs on all
  four channels and the result is truncated), and 11 is 18 pixels of icon.
- and the darkening IS the passability plane. Of the 3010 tiles whose
  pixel is a pure colour, "halved exactly when the plane reads 0" holds
  for 95.4% — and every one of the 138 misses is the same way round: a
  tile the plane calls walkable that came out darkened anyway, which is
  what the mask's OTHER set arms (border ring, `TT_NONE`, the layer arm)
  are for. Not one tile the plane calls blocked came out undarkened, so
  the `kind 4` arm — the one that would brighten an object's footprint —
  never fires on a generated map, and is named as unexercised rather than
  claimed.

**And then the engine was asked directly.** `native/rmg/minimap-probe.c`
puts four detours on the editor's image — the build, the terrain pass, the
flat-colour predicate and the icon lookup — under the `minimap` word in
`homm5-editor-rmg.txt`, and logs only between the build's entry and exit so
the editor's own minimap panel stays out of it. One ordered run turned four
inferences into readings:

- **the side and the border are the engine's own numbers.** `mm side 94`,
  `mm border 1`. The 94 that was scored off the reference picture, and the
  border that pinned `desc[+0x4C]` and `desc[+0x1DC]`, are now stated
  rather than fitted.
- **the flat colour is 0x00000000.** Not the `0xFF027DF9` the in-game
  callers pass: the RMG's owner never fills its `+0xA0`, so the argument
  arrives zero. The last unread value in the whole drawer, and it is
  nothing.
- **the flat-colour arm is dead, measured.** `mm sea test calls 8836` —
  94², every tile — against `mm sea test true 0`. Not one tile in a whole
  map, which is what "the ground flags are 16 everywhere" predicted.
- **the icon lists pair as read.** 22 names in order: `Town_1`, `Town_2`,
  then eighteen `Mine_0` with two `Object_0` among them, and no
  `UnderworldExitEnter` on a one-floor map. One list, drained once, with
  the name chosen per object — exactly the count and the kinds that
  matching icon pixels against the reference had found.

**The mask is the passability plane, and it is more than that.** The probe
dumps the mask the pass was handed, 96x96. Against the passability plane of
the map that same run produced: 7706 tiles of 9216 agree, **1510 are set
where the plane says walkable, and NOT ONE is clear where the plane says
blocked**. So the mask CONTAINS the blocked tiles exactly and adds to
them — which is the shape the code has, `0x9EBCB0` being one of five arms
that set. 1069 of the extra 1510 touch a blocked tile, so most of the
surplus is a rim; 441 are away from one and 157 sit within four tiles of
the map edge. What is left to name is which arm draws that rim — on a
generated map only the border ring, the layer walk `0x9EBAE0` and a
`TT_NONE` tile can, since uniform-16 flags rule out the other two. A
count per `kind` inside `0xAD0F50` is one hook and one more run.

**The widened probe closed the terrain half outright.** Two windows — the
build and the write — with the mask, the ground flags, the plane at
`terrain[+0x6C]` and the finished 94x94 LAYER all dumped, plus the icon
blits and the resampler's arguments. One run:

- **`terrain[+0x6C]` IS the passability plane**: 9409 bytes equal, 0
  different, against the plane of the map that same run wrote. The 95.4%
  the picture could support is now an identity.
- **the ground flags are 16 on all 9409 vertices**, which is the premise
  two of the arguments above rest on, now stated for this map rather than
  carried over from two others.
- **the colour rule is exact.** Of 8836 tiles in the layer, every one is
  either a `MinimapColor` truncated at 255 (3776) or exactly its half
  (5060). No third case, no black, and alpha is 0xFF on all of them.
- **the halving rule is exact.** "Darkened exactly when the mask bit is
  set" holds for 8836 tiles of 8836. Tile for tile, not sampled through a
  resample. (The water exemption is not exercised here — this template
  has none.)
- **the resample is the engine's own statement**: `dst 256 256, src 94 94,
  filter 6` for the terrain layer and `256 256, 256 256, filter 6` for the
  icon layer, which is the equal-size early exit taken as a copy.
- **the icon anchor is confirmed to the pixel.** `mm blit at 59 171` and
  `179 95` for the two towns are exactly the centres the Town_1 and
  Town_2 stamps were found at by matching pixels, and `84 201` is the
  first mine's.

So the mask is the only thing left with a gap in it: it CONTAINS the
blocked tiles exactly (0 clear-only) and adds 1510 more. Those extra tiles
are not a terrain kind — they carry the same documents in the same
proportion as the rest of the map — so what draws them is positional: the
border ring, the layer walk `0x9EBAE0`, or a `TT_NONE` tile, the three
arms uniform-16 flags leave open.

**The surplus is OBJECTS, and the tile pass alone never could have made
it.** Reading the last two arms out of `0xA4F6D0`'s chain finished the
list and then contradicted it:

- `0x9EBAE0` walks the tile's texture layers, casts each to `SAdvMapTile`
  and, for any whose `Type` is 0x0B (`TT_BIG_WATER`), tests that layer's
  mask at the tile's four corners — so it is "does big water cover this
  tile". It feeds `kind 3`, not `kind 2`; the earlier reading had it under
  the wrong one.
- `0x9EC570` is three tests, not one: all four ground-flag corners zero,
  OR `0x9EBAE0`, OR the RIVER half-grid at the tile's centre cell
  `(2y+1, 2x+1)` above `0x8C` — the same river reading the shipyard
  predicate ends on. It alone gives `kind 2`, and writes `TT_BIG_WATER`
  into the descriptor's type.
- `0x9EB4D0`, which fills that type on the ordinary path, returns the
  winning layer's `Type` or 9 (`TT_NONE`) when the point is out of bounds
  or no layer wins at all.

On the run's map every one of those is inactive. The seven painted layers
are Sand-Dunes, Sand_Cracked, Dead_Land, Lava, DarkGround, SandRoad and
LavaRoad — no `TT_BIG_WATER` among them; the flags are uniformly 16, so
neither the all-zero corners nor `0x9EB9E0` nor `0x9EBAC0` can fire; no
tile is a river tile, or the halving would have disagreed somewhere and it
agreed 8836 times out of 8836; and every tile got a real colour, so
nothing came back `TT_NONE`. The border ring fits at NO width: scored for
margins 0 to 16, every width from 2 up leaves walkable tiles inside the
ring with the bit CLEAR, which a ring cannot do.

So the per-tile pass cannot be the whole story, and it is not: `0xAD12A0`
has six callers besides it, and `0xAD0F50`'s FIRST arm — before any
`kind` is looked at — sets BOTH masks when the descriptor's `+0x10` is 1.
`0xA4FF00` is one of those callers and it does set a 1 into the descriptor
it passes. That is object registration, and the measurement agrees: of the
1510 surplus tiles 33% sit exactly ON an object's position and 87% within
one tile of one, against 7% and 51% for the walkable tiles that stay
clear.

So the mask a port has to reproduce is **the blocked tiles of the
passability plane, plus the tiles the map's objects occupy** — with the
water, river and border arms there for maps that have them. Named as
measured rather than read: which `+0x10` the caller sets, and how far an
object's registration reaches beyond its `Pos`, are the two pieces still
taken from the correlation instead of the code.

**AND THEN IT WAS READ, AND IT IS EXACT.** The two pieces above that were
taken from correlation are now taken from the code, and the result checks
against the engine's own mask dump with nothing left over.

Virtual slot `+0xB4` is the **blocked**-tiles list. All the AdvMap classes
reach it through the same virtual-base vtable, where every slot is an
adjustor thunk onto a one-instruction getter: `+0xA4` is `0xAD0700`
(`lea eax,[ecx-78h]`, the packed key), `+0xB4` is `0xAD06F0`
(`lea eax,[ecx-68h]`) and `+0xB8` is `0xAD0800` (`lea eax,[ecx-5Ch]`) — two
adjacent `{begin, end, capacity}` vectors of signed (dx, dy) byte pairs.
Which of the two is which comes from what they stamp: `CWorld`'s register
(`0xA55C10`, vtable `+0x14C`) calls `0xA4FF00` on the `+0xB4` list, which
writes `descriptor+0x10 = 1`, and then `0xA500D0` on the `+0xB8` one, which
writes 2 (or 3 when the object's own `[vt+0x3C]` says it is not currently
interactive). `0xAD0F50` sets BOTH of the first two masks for type 1 —
the same path naturally impassable terrain takes — while only type 2 reaches
the third mask (`0xAD1344`), which is the active/entrance one. So the mask
the minimap darkens by is the BLOCKED footprint, and the entrance tiles are
not in it.

Nothing rotates those pairs on the way out: every consumer — `0xA4FF00`,
`0xA500D0`, `0xAD2970`, `0xAD9EF0`, `0xADA100`, `0xADB172`, `0xCB1545`,
`0xC05DF2` — does `movsx` on the byte and adds it straight to the object's
tile. The vector is a per-INSTANCE member (the document sits behind its own
pointer at `-0x70`), so the rotation is baked in when it is filled, and the
port gets there by turning the shared document's `blockedTiles` the same way
the height pass does.

The registration is also LIVE rather than cumulative. `CWorld` pairs
`+0x14C` (register) with `+0x150` / `+0x154`, and `0xA55C60` is a real
unregister: it copies the tile's descriptor, writes the owner and the type
back to 0 and puts it back, which sends `0xAD0F50` down its clearing path.
The movers call them around a move (`0xB296A2`/`0xB296B8` and again at
`0xB29930`, `0xB32760`). So the mask holds the objects that are STANDING —
which on a freshly generated map is all of them, but the port should not
read it as "every object ever placed".

**Checked**: the port's mask — the passability plane's zeros plus every
floor-0 object's rotated blocked footprint, statics included — against the
probe's 96x96 dump of the mask the terrain pass was handed: **9,216 tiles of
9,216, not one either way**. The statics matter: they are 1,325 of the
1,556 objects and their footprints are 1,078 of the mask's 1,510 tiles over
the plane, and since the run record carries no blocked list for a static the
port reads it from the shared document (`Chain.footprint`). With that mask
the terrain layer stands at **8,783 tiles of 8,836 identical to the
engine's**, and the 53 that are left are the document question above, not
the darkening.

Proven: every address, offset and arithmetic step above is read out of
`bin/H5_Game_H5E.exe`, and the four points above are measured off the
reference file.

**The icons are the game's own art, copied pixel for pixel.** `0xDD00E0`
first collects the objects worth an icon, and the drawer then runs a loop
per collected list.

WHICH objects, and into which of THREE lists — one per loop, each with
its own name:

- `[obj+0x04]()` hands back a component whose `[+0x08]()` says yes — the
  OWNERSHIP one, the thing that lets a player flag the object. These are
  the `Town_%d` / `Mine_%d` / `Object_%d` ones.
- else the shared document dynamic-casts to `SAdvMapBuildingShared` and
  its `Type` (`+0xEC`, the field the registrar at `0xADFCA3` names and
  stamps with the class id `0x16130CC1`) is 0x27 —
  `BUILDING_SUBTERRA_GATE` by `types.xml`. These get
  `UnderworldExitEnter`.
- and a list of its own for `Type` 0x63 and 0x64, the two campaign
  citadels, drawn with a fixed `Town_1`.

That is the whole rule, and it is why the reference's third dwelling gets
no icon: a refugee camp cannot be flagged. The gate list is NOT dead
either — the underground reference carries one `Subterranean_Gate_In` and
one `Subterranean_Gate_Out`, and its two minimaps carry exactly one
`UnderworldExitEnter` stamp each, matching all 60 pixels.

Worth knowing for the port: the drawer gets those runtime components at
all because `0xDD0C70` BUILDS A GAME first — it fills a creation record
(the name `no-id`, seed `0x75BCD15` = 123456789) and calls `0xB8D020`,
`0xB8CE10` and `0xB90140`, saying `Failed to initialize players!` when
that goes wrong. That is also why the darkening mask exists by the time
the terrain pass runs. A port has no such instance and has to compute the
same grids itself.

The NAME is built with `sprintf` and looked up by string:

- `Town_%d` when the object's shared document answers `[vtbl+0x3C]`;
- else `Mine_%d` when `[vtbl+0x8C]()->[vtbl+0x24]()` gives `0x16130CC3`
  or `0x16130CC5` — the class ids the registrars stamp right after the
  names `AdvMapMineShared` (`0xAE4073`) and `AdvMapAbanMineShared`
  (`0xAE49E6`), so the test is "is this an ordinary or an abandoned mine";
- else `Object_%d`.

`%d` is the owner from `[obj+0xC]`, and an owner above 8 skips the object
outright — 0 neutral, 1..8 the players. `0xDD3440` resolves the name
against the `SWindowRelated` resource's named list (`[+0x44]..[+0x48]`,
0x18 bytes an entry, `strncmp` at `0xF415D8`), which on disk is
`UI/AdventureScreen-FPP-2/MinimapTextures.(WindowRelatedTextures).xdb` —
55 entries pointing into `Textures/AdventureScreen-FPP-2/MinimapIcons/`.
All of them are uncompressed BGRA8 with one level: `Town_%d` 15x16,
`Hero_%d` 10x10, `Mine_%d` and `UnderworldExitEnter` 9x9, `Object_%d`
6x6, plus `Caravan_%d` and `Caravan_stopped_%d`.

The ANCHOR is the object's footprint centroid, not its `Pos`.
`0xDCFF70` takes the object's world point (`[obj+0xA0]`), halves it —
world units are two to the tile — and `floor`s it (`0x94AC3A` is the CRT
`floor`), then adds the mean of the offsets in its two footprint lists
(`[obj+0xB4]` and `[obj+0xB8]`, `i8` pairs). That point goes through the
pos converter of `0xDCFB00`.

The BLIT is `0xDCFDE0`: the icon's top-left lands at
`(trunc(px) - trunc(w/2), trunc(py) - trunc(h/2))`, and each pixel whose
own alpha byte is non-zero is copied as a whole dword — no blending, no
scaling — with the destination clipped per pixel against the image's side.
That is why the file's alphas are the icons' own.

**Checked**: the reference map holds 18 `AdvMapMine` and 2 `AdvMapTown`,
and the reference minimap holds exactly 18 `Mine_0` stamps and one
`Town_1` and one `Town_2`, each matching all 60 (or 178) of its
non-transparent pixels EXACTLY, at exactly one place in the image. Feeding
each mine's own `Pos` through the converter and the anchor rule lands
within a pixel or two of where its stamp is — the mines' footprints are
symmetric, so their centroid is their `Pos`; the two towns sit about a
tile off, which is the centroid term doing its work. `Object_0` matches
twice — the Imp Crucible and the Workshop, both flaggable dwellings —
and nothing else matches at all: not the third dwelling, a refugee camp,
and no heroes, caravans or underworld entrance on a one-floor map.

**THE RESAMPLE IS PORTED, and it is exact.** `0x9743A0` turned out to be
Schumacher's zoom.c with the half-pixel correction, and it is now
[`src/rmg/resample.ts`](../src/rmg/resample.ts) line for line: contribution
tables per axis, `center = (i + 0.5) / scale - 0.5`, `left = ceil(center -
width)` (`0xF044CD`), `right = floor(center + width)` (`0x94AC3A`), a
REFLECTING edge (`j < 0` mirrors to `-j`, `j >= n` to `2n - j - 1`),
horizontal into a (dst.width x src.height) image and then vertical, every
channel `trunc(sum + 0.5)` clamped to a byte. The weights are never
normalised, which is exactly why a layer of uniform alpha 255 comes back as
253 and 254.

The filter needed one more thing read. `0x975800` is
`sinc(x) * sinc(x/3)`, but its sine is NOT the CRT's: `0x9573B0` is a
513-entry table at `0xFA2898` with linear interpolation, scaled by the float
512/(2*pi) at `0xF4DC88`. The entries are not `(float)sin(...)` either —
entry 1 is 0.012271500 where the correctly rounded value is 0.012271538,
five ulps out — so the table has to be READ rather than recomputed, and five
ulps is worth a few hundred pixels of a 256x256 image. It is
[`src/exe/sine-table.ts`](../src/exe/sine-table.ts), and it is the one thing
in the port that reads the executable to GENERATE rather than to patch.

**Checked against the reference, and it holds byte for byte.** Feeding the
ENGINE'S OWN 94x94 layer — the probe's `mmi` dump — through the port's
resampler and comparing with `minimap_floor_01.dds` out of
`178535184522222.h5m`: **64,018 pixels of 65,536 identical**, and the 1,518
that differ form 26 blobs that are precisely the icon stamps the engine
merges afterwards and this comparison leaves out — two 15x15 towns of 178
pixels, eighteen 9x8 mines of 60, two objects of 38 and 36. Eight stray
single-channel pixels remain, and their sums sit 2e-2 to 3e-1 away from a
rounding boundary, which no floating-point difference could move: they are
the probe run's layer against the reference run's, one uninitialised byte
apart.

**The tile-document walk is ported too**, coverage and all: `0x9ED7D0`'s
bilinear with its byte widening, `0x9ED3E0` / `0x9ED2A0` with the running
transparency, the 32.0 water gate. Two things the comparison settled that
had been carried on trust:

- **the plane's orientation is `plane[y * (size + 1) + x]`** — the port's
  `markPassability` output against the probe's dump of `terrain[+0x6C]`,
  9,409 equal and 0 different, where the transposed reading gives 3,212
  different;
- **a tile is darkened exactly where that plane reads 0**, and the 1,509
  tiles the engine darkens on top of those are the objects — the same
  surplus the mask dump showed, now seen from the other side, with not one
  tile darkened by us that the engine leaves bright.

**What is still open is 53 tiles of 8,836**, and it is worth stating
narrowly. Our walk and the engine's picture disagree on 53, every one of
them at a zone boundary and every one of them resolving to Sand-Dunes, the
LOWEST-priority layer of the seven. The engine's own numbers rule out the
obvious explanations: the reference file's layer order is ascending priority
(read out of `GroundTerrain.bin`), the roads prove the walk visits the
highest priority first (at a road tile SandRoad 255 beats Sand-Dunes 255,
which only a descending walk gives), and **searching ALL 5,040 permutations
of the layer vector under both scorings — `remaining * coverage` and
coverage alone — the best any fixed order achieves is 33 wrong, never 0**.
So the difference is not the order and not the tie-break: it is in what the
drawer SEES. The likeliest candidate is that the minimap is drawn from the
masks before something the save then normalises, and the one measurement
that would settle it is a probe that logs, for a named disputed tile, each
layer's coverage as `0x9ED7D0` returns it. That is one hook and one run.

**AND THE 53 WERE THE BASE LAYER.** The probe was widened onto the vector the
drawer actually walks — every record's document and its whole mask plane —
and one run said it outright: **six of the seven masks are byte-identical to
`GroundTerrain.bin`'s, and the seventh, the lowest-priority one, reads 255 on
all 9,409 vertices where the file has it on 4,668.** The map is created with
one ground under all of it and the zones paint on top; nothing carves the
base back, because the painter only takes from layers of the same class at a
DIFFERENT priority once a vertex would pass 255, which a single 255 never
does. The file then stores the base cut down to where it still shows. So the
live terrain and the saved file disagree about exactly one layer, and the
drawer reads the live one.

That is worth 53 tiles and not one more: at a zone boundary the top layer
covers two corners of four — coverage 127, score 127 — and the base, taken at
the transparency the top layer left, scores 255 * 0.50196 = 128. Which is why
the base wins there and only there, and why no order of the seven could ever
have fitted it: with the file's masks the base has nothing to win with.
**The terrain layer is now 8,836 tiles of 8,836 against the engine's own.**

Two things the same run settled about the ICONS:

- **the anchor is the mean over BOTH footprint lists.** Feeding each object's
  tile plus the mean of its rotated `blockedTiles` AND `activeTiles` through
  the converter lands all 22 of the run's blits exactly; blocked alone lands
  8, and the two lists' means summed lands 1. (The blit's own arguments are
  the CENTRE — the half-size subtraction happens inside `0xDCFDE0`.)
- **the flaggable gate is two calls and a switch, and it is READ.** The run
  places three `AdvMapDwellingShared` objects and the engine draws two icons:
  the REFUGEE CAMP is passed over, and nothing in the data separates it — not
  `PossessionMarkerTile` (every building has one, Windmill and Temple
  included), not `EffectWhenOwned` (Windmill and Temple have one, Crypt does
  not), not `RandomType`, not any field of the instance in `map.xdb`, and
  there is no ownership table in `GameMechanics/RefTables`. The executable
  says why. `[obj+0x04]` is `GetFlagged()` (`0xAD0230`, the subobject at
  `+0xC8`; null for monsters, treasures, statics and heroes). Then `[+0x18]`
  is `GetDwelling()`, and a TOWN's and a MINE's return null (`0xAC0309` /
  `0xD2A40C`, both `jmp 0x4797F0`) — a null ACCEPTS, which is why they always
  carry an icon. Only a dwelling reaches the predicate `0xD0F960`, whose whole
  body is a dynamic_cast to `SAdvMapDwellingShared` and three subtractions on
  the `Type` at `+0xEC`: `0x54` BUILDING_FIRE_LAKE, `0x5E`
  BUILDING_REFUGEE_CAMP, `0x5F` BUILDING_ELEMENTAL_CONFLUX all return false,
  everything else true. A literal set in the code, kept nowhere — the
  predicate re-reads the document every call — and the same three appear again
  in `CAdvMapDwelling`'s constructor at `0xD0F1D5`. They are the three neutral
  "buy creatures here" dwellings. The shipped `types.xml` agrees with the three
  literals to the number — BUILDING_FIRE_LAKE 84, BUILDING_REFUGEE_CAMP 94,
  BUILDING_ELEMENTAL_CONFLUX 95 against `0x54`, `0x5E`, `0x5F`, with
  BUILDING_IMP_CRUCIBLE 73 and BUILDING_WORKSHOP 85 outside the set — so the
  port can key on the names and the data says the same thing the code does.

**THE WHOLE FILE, THEN** (`test-rmg-minimap`): 262,272 bytes against the
reference's, the **header byte-identical** — the engine declares its single
mip in the flags and the caps as well as the count, so `writeDDS` learned to
say so when asked — and **10 channel bytes of 262,144 different**, each a
single channel by one.

Those ten are named rather than forgiven, and the naming is most of the work:
three horizontal intermediates come out 4e-5 above a `.5` boundary where the
engine has them below, and the vertical pass spreads each over its column —
flipping the one intermediate byte at (126, row 2) reproduces that whole
column, 0 rows differing. What it is NOT: the filter (the editor's `0x7911C0`
and the game's `0x975800` were both read, they differ only in `x * (1/3)`
against `x / 3` and in x87 against float32, and neither variant moves a
byte); the sine (both builds carry the SAME 513-entry table and the same
scale, byte for byte, and the true `sin` is worse over the picture as a whole
— 6,299 bytes against 5,801); the sine's argument (over all 6,144 of them,
rounding the product once through 80 bits and twice through a double give the
same float — checked by two-product, 0 disagreements); or the accumulation
(the engine keeps four 80-bit accumulators in the x87 stack, and the disputed
sum is 200.50003562139992 under exact compensated summation, the same to the
last bit as ours). So the difference is smaller than any arithmetic this port
can name, and the next step is to emulate the x87 filter exactly rather than
to guess again.

Still unread: where `this[+0x14]`'s flat colour comes from on the RMG path
(`0xEA30D0` copies it from its owner's `+0xA0`). It costs the `.h5m`
nothing, because the arm that would use it never fires on a generated map
— but it is not a hole the EDITOR can leave open, since an authored map
with a dug sea reaches it.

Worth more than the `.h5m` alone: the editor needs the same picture.

Named holes: what a failed 0xEB43D0 creation skips; the water hash
detail that made `floorIterationOrder` take its key as size_t (the
sea's -1 hashes to bucket 8 of 13).

What remains of the water reference is the `.h5m` emission for all three
references — the ground flags and the passability derivation (the
heights closed on all three runs, sea band included: the base field
reads the carve-adjusted border and the seaward dist term digs below the
plateau exactly as the file has it).

**The underground run is in FULL LOCKSTEP — all 70,799 draws**
(`test-rmg-underground`): the chain to 4475 —
which took four finds the surface run could not make — then every step
boundary of all three zones' first MainObjects loop, with all 106 named
objects on their reference tiles. What the run surfaced, each proven by
its boundary:

- **an underground town wears four point lights.** The subterranean zone
  subclasses put a WRAPPER in vt+0x20 (`0xEC6250`/`0xEC84C0`/`0xECAAB0`)
  around PlaceTown, and a successful placement pays two draws for the set:
  `z = 5 + below(3)`, `Radius = 12 + below(10)` — the reference town's
  z 6 and Radius 12 are those two draws verbatim (`towns.ts`);
- **teleports** (`teleports.ts`, `0xEB7C60`): each endpoint zone places
  its own half, paired by nothing but GroupID = min·100 + max; the type
  is floors alone — Monolith_Two_Way on one floor, Gate_In above and
  Gate_Out below across floors. Candidates are the zone's tiles at
  border 3..9 (LITERALS — the Teleport*BorderDistance params are never
  read) filtered by room > 2max/3; the guard takes the connection's
  power over sqrt(2), rounded to nearest. The pair lands tile-for-tile
  with the reference, guards included;
- **prisons** (`prisons.ts`, `0xEBD1C0`): the 0xEC1500 family with a
  fixed shared, no guard, RandomHero written true and the hero itself
  never drawn — and an exhausted pool skips the instance where dwellings
  abandon the step;
- **the price lists buy from the TERRAIN race.** `[zone+0x20]` is the
  terrain preset — the same one that paints the ground — so the
  underground zone's dwarven town buys from the DUNGEON lists while its
  dwellings stay dwarven (`[zone+0x1C]`). On the surface the races
  agree, which is why four zones of lockstep never told them apart: the
  treasury boundary here is what did (an affordable prefix of 7 where
  the dwarven list holds 6);
- **abandoned mines** (`0xEBD700`, in `mines.ts`): their own worker
  after the ordinary mines, fed by the zone record's AbandonedMines
  (`+0x2C`) and the preset's AbandonedMine shared. Candidates once —
  frame, border > 1, and under the town flag the ring
  `Mine3LevelMin/MaxRadius` (25..45, strict) — then per instance a room
  threshold of `trunc(4*max/5)`, the only 4/5 in the family. No guard,
  no piles, AvailableResources = [0,0,1,1,1,1,1] drawlessly, actives
  into the roads' mine vector;
- an underground zone runs **no observatories mark and no treasures**:
  the observatories spend their draws unmarked between "shops" and the
  road boundary, and treasures/chests wait for additional objects.

**The underground STATICS run in FULL LOCKSTEP — all three zones**
(6471 → 67611, three quarters of the run): every traced boundary lands
and all 1,190 statics stand where their minted names stand, point-lit
crystals included. The subterranean overrides came apart into four
finds, each measured live (details in Phase 12):

- **the massif carve** (`0xED11D0`, drawless): the underground floor is
  vertex-height rock (byte/float grids, floor 18.0, rock 36.0, an edge
  ramp) carved into massifs wherever a 9×9 occupancy patch is clean —
  the port's float grid came out byte-identical to the reference
  `UndergroundTerrain.bin`, all 5,329 vertices;
- **Subterra's `+0x34`** is the base sweep behind the carve; its `+0x30`
  is the base one-tile skeleton plus a rock filter, survival pre-rolls
  (0.7/0.6/0.9/0.9) and two-draw point lights on Crystals;
- **the LAKES ran for real** (zone 2 resolves HEAVEN): they exposed the
  `+0x5C` stamped-blocked ledger (the room masks' bit 0x02, written by
  the stamp itself), the DEEP WATER pass (blob interiors turn 0x82 and
  refuse the fit), the deco jitter's axes, list HOLES (a self-closed
  `<Item/>` draws but creates nothing), the mountains' transient 0x100
  and their end-of-pass conversion to 2 — and re-read `zone+0x18` as the
  RESOLVED race (the surface's Inferno zone merely had zero seed
  candidates).

Still ahead of the underground run: additional objects (85 draws) and
the two-floor treasure blocks (3,103), then emitting the `.h5m`.

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

### Ordering a generation from outside the dialog

Every order but the three references is unverifiable, and the reason has
always been the same: an order costs a person clicking through the generator
screen. So the question was whether the editor can be TOLD to generate. It
can — just not the way it was looked for.

**The editor's own command line is one token wide, and it is not ours.**
`H5_MapEditor_H5E.exe` is an MFC application: `WinMainCRTStartup` (`0xf46536`)
hands `AfxWinMain` (MFC71 ordinal 1207) the command line, and
`CEditorApp::InitInstance` — vtable `0x1180dfc` slot `+0x30`, the function at
`0xde6d40` — reads `m_lpCmdLine` from `[this+0x48]` exactly ONCE, at
`0xde6e2e`. What it does with it is the whole surface: strip surrounding
quotes, and then

- empty → start normally;
- non-empty and another instance is running → forward it by `WM_COPYDATA`
  (`0x96ee40`) and exit;
- `-reg` (`0x4892e0` is `operator!=` against the literal at `0x1180eec`) →
  nothing here; the string is consumed by the association registration at
  `0xde5d60` instead;
- anything else → `0xdede00`, which is either "open this document" or, when
  the config value `map_editor_mode` is set, "open this `.xdb`".

`GetCommandLineA` has a single caller in the whole image (`0x52d227`, inside
`0x52d200`) and uses it only to derive the executable's own folder. So the
absence is proved the way this document requires absences to be proved: not
"no switch was found" but "the only reader of the command line was read, and
both of its branches go elsewhere".

**What exists instead is a console command.** `rmg`, aliased `generatemap`,
registered at `0x73d2d0` (a static initialiser, so it is there from startup in
BOTH executables) against the handler at `0x73ce20`. Its parameters are wide
strings and its parser is `0x73c910`:

| written | field | default | what it is |
| --- | --- | --- | --- |
| the first non-switch word | the template href | — | `#xpointer(/RMGTemplate)` is appended when absent; "Couldn't find template " if it does not resolve |
| `-players <n>` | `props+0x20` | 2 | |
| `-size <n>` | `props+0x28` | 2 | |
| `-underground <n>` | `props+0x25` | 0 | stored as a bool; reaches the request's `+0x0D`, which is also what the dialog's template filter reads |
| `start` | `props+0x2C` | absent | play the map once it exists |

The handler copies those into the settings struct the generator takes (built
by `0x467e10`, no vtable, ~0xA8 bytes, size at `+0x10`, underground at
`+0x11`, players at `+0x1C`) and calls `CRandomMapGenerator::GenerateMap`
straight — the editor's vtable `0x117203c` slot `+0x4`, the function at
`0xcf9930`, which is the same `[esi+0x90]`-then-`time()` seed region the
oracle already detours. **There is no seed parameter** — but the map IS saved,
which reading the handler did not say and running it did: the engine's own
narration ends "map saved", and the sixteen documents are in
`data\RMGTemp\CurrentMap\`.

**And a line can be said to the console without a person.** `0xe342b0` executes
one, and its `this` IS the `std::wstring` holding it — the cleanest door in the
image. 79 commands are registered through `0xe33010`, `rmg` and `generatemap`
among them. Its neighbour `0xe345f0` executes a whole cfg — it prints
`Executing `, and `InitInstance` calls it three times before anything else, on
`..\profiles\startup.cfg` (which does not exist on disk), `editor_a2.cfg` and
`p2pdir.cfg` — but a cfg only SETS VALUES: `setvar map_editor_mode = 1` through
it lands, `rmg` and `exit` through it do nothing at all. Measured both ways;
see the four traps below.

**So the shape of the oracle is settled, and its one real gap is named.** The
engine will generate on command, with the template, the players, the size and
the floor count all ordered, and it saves what it made — but the three cfg
files run at the TOP of `InitInstance`, before the data storage exists, which
is too early for a template to resolve, and the command takes no seed. Both are
ours to close from the extension already imported into the editor: `0xdede00`
is the same command line arriving at the END of `InitInstance`, and the seed
hook is already installed.

**All three are closed** — `native/rmg/cli.c`. The engine's own map beside any
order, and **one launch under every map**:

```
H5_MapEditor_H5E.exe --rmg
```

with `bin/homm5-editor-rmg-orders.txt` holding THE order — several maps are
ordered by `tools/rmg-batch.ts`, which relaunches the editor for each and keeps
them in `bin/rmg-batch/<n>/`:

```bash
node tools/rmg-batch.ts --game <dir> --orders orders.txt
```

A file holding several lines has its first one run and the rest reported
untouched, which is the mechanism refusing the mistake rather than a comment
asking the reader not to make it. One order to a line:

```
RMG/Templates/S1P2Z2M1.xdb -seed 1785351845
RMG/Templates/S1P2Z2M1.xdb -seed 1785351845 -size 1
```

Each order is the engine's own `rmg` line plus our `-seed`, `-resource` and
`-exp`, all three taken out before the line is handed over (an unknown switch
would be read as part of the template's name). The DLL reads the ask off `GetCommandLineA` at load — early
enough to turn the oracle on for the run, which is why a batch never comes back
with no readings in it — and says the lines from a detour on `0xdede00`, the
moment the editor was going to open a document. Then the process ends.

Four addresses, all the editor's, all checked against their bytes first —
written here as this document writes them, and in the C file as RVAs, which is
what a detour takes: `0xdede00` (the argument site, seven bytes and two whole
instructions, the second one's operand relocated), `0xe342b0` (`Execute`, whose
`this` IS the wide string), `0x407d00` (`wstring(begin, end)`), `0x4031d0` and
`0xe33520` (a narrow string and the engine's named-value lookup, which are the
self-test). Neither string is freed afterwards, deliberately: the deleter is
behind an import thunk the loader rewrites, and a wrong free in a process about
to exit costs more than the buffer.

**And the command does not order the same map the dialog does — until it is
made to.** The first CLI order of the reference's own seed and template came
out 970 draws short and a different map, and the two `sRMGProps` blocks
differed in exactly two lines: `RESOURCE_NORMAL`/`EXP_NORMAL` against the
reference's `RESOURCE_LITTLE`/`EXP_LITTLE`.

That is not a property recorded after the fact. The console handler builds the
RMG request with `0x467E10` and fills three of its fields — the size at
`+0x10`, the underground at `+0x0D`, the players at `+0x18` — leaving the rest
at the constructor's defaults, and two of those defaults are the multipliers at
`+0x98` and `+0xA0`, both **NORMAL**. The enum runs MISERABLE, LITTLE, NORMAL,
LOTS, MUCH from zero, so NORMAL is 2 and the constructor's `mov [esi+98h],edi`
with `edi = 2` is where the difference comes from. The record lives on the
handler's stack, so nothing outside can reach it — which is why `-resource` and
`-exp` are applied by a detour on that constructor (`native/rmg/cli.c`), the
values stashed while the order is parsed and written the moment the request is
built.

**With them said, the batch reproduces the reference exactly.** The same order
with `-resource 1 -exp 1` lands on **92438**, the reference's own count, and
`rmg-diff-map` puts the port's map against the engine's at **13 of 15 entries
byte-identical** — `GroundTerrain.bin` among them — with the minimap's ten
channel bytes and one numbering difference left. The numbering is the port's:
the engine's CLI-ordered run emits two caption texts and calls the objectives'
`caption-text-0/1`, while the port, fitted to a dialog-ordered reference that
emitted two more before them, calls the same two `caption-text-2/3`. The
counter should follow what is actually emitted; it does not yet.

**The rest of that record, put to the engine one field at a time.** `-poke
<offset> <value>` and `-pokeb` write any offset of the request (decimal), which
turns a guess about a field into a launch instead of a rebuild — and it earned
its place immediately, because the first four offsets derived from the copy
gave three right answers and one wrong one.

| request | field | how it was shown |
| --- | --- | --- |
| `+0x0D` | underground | the console handler writes it; the generator reads `+0x1D` |
| `+0x10` | map size | generator `+0x20`, the index into the size table at `0xFF291C` |
| `+0x18` | players | the handler writes it |
| `+0x50` | monster strength | `-monsters 2` records `MONSTER_LEVEL_STRONG`; default 1 is MEDIUM |
| `+0x94` | minimap | poked to 0, the map records `<Minimap>false` |
| `+0x95` | random towns | poked to 1, the map records `<RandomTowns>true` |
| `+0x98` `+0xA0` | the two multipliers | they reproduce the reference exactly |
| `+0xA5` | grail | poked to 1, the map records `<Grail>true` |

**And WATER is not in that record at all** — which is a finding, not a gap in
the reading. Every other field of the map's `InitialParams` has a place there;
`WaterAmount` has none, and eleven offsets were poked a launch apiece to be
sure. The generator takes its water from `GenerateMap`'s first stack ARGUMENT
instead: `0xCF9B9E` reassigns `esi` to `[ebp+8]` and only then reads `+0x58` as
the amount, promoting 1 to 2 and setting the water bit at `+0xA6` that
`LoadTemplate` branches on. That object is not the request — poking the request
at `+0x58` kills the editor, because there `+0x54` is the players vector and
`+0x58` is its `end`. So the batch cannot order water yet, and there is no
`-water` switch: a switch that silently does nothing is worse than none. What
would close it is identifying that argument, which is one focused reading and
not a guess.

**Four things this cost, each of them a measurement rather than a guess, and
each of them a trap the next person would fall into.**

- **A SPACE in the editor's command line kills it.** `H5_MapEditor_H5E.exe foo`
  puts up "Can't load foo file"; `"foo bar"` dies at `0x5f9d22` with every
  register zero, long before the argument reaches anything of ours — proved by
  running the same line with the detour deliberately not written. That is why
  the orders live in a file and the command line is the bare `--rmg`.
- **The return value of `Execute` means nothing.** It answers -1 to `help`, to
  `rmg`, and to a `setvar` that demonstrably lands. So the batch does not read
  it; it asks a question with two engine-owned halves instead — `setvar h5e_door
  = 7` through the door, then the engine's own `0xe33520` lookup — and writes
  `door 7` before the first order. Without that check the first three sessions
  read "the door does not work" off a number that never meant it.
- **A cfg is not a way to run a command.** `0xe345f0` executes
  `..\profiles\*.cfg` and is the path `map_editor_mode` itself arrives by, but
  it only *sets values*: `setvar` through it lands, `exit` and `rmg` through it
  do nothing at all.
- **The template is a PATH, not a name.** `rmg S1P2Z2M1` does nothing;
  `rmg RMG/Templates/S1P2Z2M1.xdb` generates. A leading slash also does nothing.

**And the command saves.** `rmg` writes the map itself, to
`data\RMGTemp\CurrentMap\` — the same sixteen documents a `.h5m` holds, loose,
overwritten by the next order. So each order's files are copied to
`bin\rmg-runs\<n>\` before the next one runs, which is the byte comparison the
port had for exactly one order until now.

**The first thing the batch answered.** Seed 1785351845 on `S1P2Z2M1` at three
sizes, ONE LAUNCH EACH:

| `-size` | what the map records | draws |
| --- | --- | --- |
| 0 | `MAP_SIZE_TINY` | 50,150 |
| 1 | `MAP_SIZE_SMALL` | 91,468 |
| 2 (the default) | `MAP_SIZE_MEDIUM` | 200,217 |

So **`-size` is the dialog's own MapSize index**, and the conversion `vt+0x18`
that `rmg-pack`'s `--size` is guarded behind is a conversion of that index — the
question the guard names is answered on the ordering side, whatever the reading
of `vt+0x18` turns out to say.

**Two of those three numbers were wrong the first time, and the way they were
wrong is the whole argument for one launch per order.** The first version of
this table came out of ONE launch of three orders, and read 49,660 / 91,114 /
200,217. Re-measured a launch at a time, only the row that had been that
launch's FIRST order survives — MEDIUM, 200,217, unchanged — while SMALL and
TINY, which had been its second and third, move to 91,468 and 50,150. A batch
that shares a process reports its first order honestly and every one after it
with the previous run's leavings mixed in, and the numbers it gives are
plausible, stable and wrong. The table above is the re-measurement.

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

**AND THE ARCHIVE IS WRITTEN.** `tools/rmg-pack.ts` orders a map and produces
the `.h5m`:

```bash
npm run rmg-pack -- --game <dir> --seed 1785351845
npm run rmg-pack -- --game <dir> --seed 7 --template S0-1P2Z2K3.1T --size 72 --underground
```

The step between the phases and the archive is `tools/rmg-build.ts`, and it
exists because three suites had each grown their own copy of the same replay —
fill the terrain, paint the water marks and the sea corners, then the lakes,
then the roads, then run the height late pass. That is one function now, and
the file list it returns is the whole map: `map.xdb`, `map-tag.xdb`, the
eleven texts, `GroundTerrain.bin` (and the underground one), a minimap `.dds`
and `.xdb` per floor, and the empty `1.test` the engine writes as a marker.
The two values the generator does not make come in as arguments — the GUID
(`CoCreateGuid`) and the map's name (typed into the dialog).

**Checked entry by entry** (`test-rmg-pack`): ordered with the reference's own
GUID and name, **15 of the 17 entries are byte-identical, and the other two
differ by exactly the two amounts this document already names** — the one
uninitialised byte in `GroundTerrain.bin`'s 0x0e record, and the minimap's ten
channel bytes. That holds through the archive as well as before it: packing
the map and reading the entries back out gives the same two.

The archive's own bytes are not the engine's and are not aimed at, for the two
reasons above: one DOS stamp per run, and a deflate stream zlib -9 cannot
reach. What the game reads is the entry set, their names and their contents,
and those are the engine's.

**AND ANY GENERATED MAP IS NOW AN ORACLE.** A map carries its own order —
`sRMGProps` records the seed, the template, the size, the water, the players,
the GUID and the name — so `npm run rmg-diff-map -- <map.h5m>` reads all of it
back, replays the run and says which of the entries the port reproduces. No
seed has to be typed and no reference has to be laid out: order a map in the
editor, save it, point this at it.

What it says about the maps to hand:

- three separately saved maps of the REFERENCE order come out **16 of 17**,
  the odd one the minimap's named ten bytes;
- a fourth of the same order comes out 14 of 17, and the two extra are
  `caption-text-0/1.txt`: that map carries a localised default string where
  the others carry the map's name. Something about how it was saved, not
  about what was generated — worth knowing, not yet read;
- **`S2-3P2Z7N2`, 96x96, seven zones, two floors — an order the port has
  never been checked against — runs to completion** (240,548 draws, 1,945
  objects) and writes all 20 entries, with the texts and the map tag
  byte-identical; `map.xdb`, both terrain files and both minimaps do not
  match. So the port is exact on what it was built against and diverges on a
  template it has not seen, which is what an untested claim looks like when
  it is finally tested.
- two of the maps carry no `<Template>` at all, so they were not made by this
  path — the in-game generator's output is a thread of its own.

**The SEED is a parameter now, and that is worth saying plainly.** Until this
step the chain was hard-wired to 1785351845 — the port had never been run on
anything else, because every check it has is against that one order.
`ChainOptions.seed` opens it, and six other seeds generate end to end without
a stumble, each a different map (54,344 to 100,281 draws where the reference
spends 92,438). What that does NOT say is that those maps are the engine's:
there is no oracle for them short of ordering the same seed in the editor and
diffing. So `test-rmg-pack` asks of two of them only what can be asked without
one — the run completes, the seventeen entries are there, the terrain parses
with its passability plane, the minimap is a 256x256 surface — and the rest is
named as unchecked rather than assumed. (The startable rules flag every RMG
map, the ENGINE'S OWN included, for having no player colours: a random map is
coloured when it is started, so that check says nothing here either way.)

**The archive itself cannot be byte-identical, and should not be aimed at.**
Both references are 17 entries in case-insensitive name order, every one
deflated (method 8) with general-purpose flags 0x2, made-by 0x14, version
needed 20, external attributes 0x20, no extra fields and no comments. Two
things then put it out of reach. Every entry carries the SAME DOS stamp —
the wall clock of the run, `5d18:98b8` on the surface reference and
`5d1a:ba11` on the water one — so two runs of the same seed differ. And
the deflate stream is not zlib's: sweeping level, strategy, memLevel and
windowBits over both references matches the stored bytes on nothing, and
on the minimap DDS the game's encoder BEATS zlib -9 (128,145 bytes against
129,368), so it is a stronger encoder rather than a differently-tuned
zlib. The bar for `packProject` is therefore the entry set, their names,
their order and their CONTENTS byte for byte — which is what the game
reads — not the archive's own bytes.

### What of an ORDER the port actually honours

The template is not the question: `template.ts` reads it whole — every zone's
Size, Town, Mines, Dwellings, Prisons, AbandonedMines, Shipyard, CanBeWater,
CanBePlayerStart, Wide, its TreasureDensity, TreasureChestDensity,
TreasureBlocksTotalValue, ShrinePoints, ShopPoints, BuffPoints,
UpgBuildingsDensity, ResourceBuildingsDensity, RedwoodObservatoryDensity,
LuckMoralBuildingsDensity, LandCartographer, DenOfThieves, GraalOnMap and
TownGuardStrenght, plus MinPlayers/MaxPlayers, MinMapSize/MaxMapSize,
Underground and every connection with its GuardStrenght, Guarded and TwoWay.
Those fields are the generator's input — **most of them.** Five of the ones
named above reach nothing at all: `GraalOnMap`, `Underground`,
`RedwoodObservatoryDensity`, `DenOfThieves` and, in the sense that matters,
`BuffPoints`. "Which fields the engine actually reads" below is the sweep that
settled it, on the code and then on the engine.

The ORDER — what the dialog around the template asks for — is a different
matter, and until now most of it was pinned to the references' values without
saying so:

| the dialog asks | the port |
|---|---|
| seed | ordered (`--seed`) |
| template | ordered (`--template`) |
| underground | ordered (`--underground`) |
| water | ordered (`--water`, 0/1/2) |
| players | ordered (`--players`) — a DRAWN value, and it feeds zone loading |
| monster level | ordered (`--monsters`) — it scales every connection guard |
| water | **not orderable from the command** — the setting is not in the record the command fills; see below |
| **map size** | **not orderable.** The dialog's size reaches `createMap` in the TEMPLATE's own units and the conversion is `vt+0x18`, unread. The chain orders the references' 8; `--size` lays out the grid only, and `rmg-pack` refuses a size the references never used unless `--unchecked` says to do it anyway |
| **ResourceMultiplier, ExpMultiplier** | **ordered** (`-resource`, `-exp`) — and they are not cosmetic: see below |
| monster level | **ordered** (`-monsters`) — the PORT still only models MEDIUM, so `rmg-diff-map` says so and the difference is now measurable rather than untestable |
| RandomTowns, Grail, StartHero | not ordered — `map.xdb` carries the references' fixed values |

And the settings that ARE ordered are ordered, not checked: only the three
reference orders have a map from the engine to be compared against. `npm run
rmg-diff-map` is what turns any other order into a check — order it in the
editor, save it, point the tool at the file.

## Which fields the engine actually reads

A data format read out of an executable comes with a second question behind
every field: does anything CONSUME it? The XML says what may be written, the
serialiser says where it lands, and neither says whether one instruction ever
looks at it again. Answering that for the whole of `RMG/Params/Default.xdb` and
the whole of a template is what this section records — twice over, once by
reading the code and once by changing the file and generating the map again,
because a claim about the code is worth exactly one experiment.

### The three instruments

**`tools/reverse/struct-fields.ts` — the field map, out of the serialiser.**
Every xdb-backed structure has one function that walks its fields and says the
two things a map needs in the same breath: `lea eax,[edi+<offset>]`, where the
value goes, and `push <"Name">`, what the file calls it. So the map is READ,
not inferred from the XML's order or from sizes guessed by type:

```bash
node tools/reverse/struct-fields.ts --at 0xb9e5d0   # SRMGParameters, 0x44..0x21C
node tools/reverse/struct-fields.ts --at 0xb9b520   # one template zone, 0x04..0x74
node tools/reverse/struct-fields.ts --at 0xb9c1a0   # SRMGTemplate, 0x50..0x8A
```

Two idioms live in those functions and the difference decides the answer. A
plain field pushes its address as an argument, so the `lea` comes BEFORE the
name; a nested one opens a block named by the string and only then writes into
the field, so the `lea` comes AFTER. Pairing on "the last lea" alone reads the
second kind one field out of step — every text reference in `SRMGParameters`
came out twelve bytes low, `MapName` at `MapDescription`'s offset and so on
down the block — and the listing looks perfectly reasonable while being wrong.
The pairing takes the nearest unclaimed address in either direction, the one
before first, and it is why the map closes at `0x21C` with no hole, which is
the size the reflection table registers. There are TWO serialisers for most
structures, one that reads the file into the object and one that writes it
back, and only the reader carries real offsets — the writer builds each value
in a temporary and gives every field the same `[esp+0Ch]`. A listing where
every offset is equal is that one.

**`tools/reverse/struct-use.ts` — who reads which field, over the whole image.**
`trace.ts field 0x44` answers for every structure at once, because an offset is
just a number; that is fine for finding a lead and useless for "nothing reads
this", which is the claim a sweep exists to make. So this one starts from the
DOOR — the place the pointer comes from — taints the register, walks each
caller forward and writes down every `[tainted + N]`:

```bash
node tools/reverse/struct-use.ts --getter 0xeaff80 --cast 0x10b70d4 --min 0x44 --fields 0xb9e5d0
node tools/reverse/struct-use.ts --cast 0x10b3350 --min 0x40 --fields 0xb9c1a0
node tools/reverse/struct-use.ts --cast 0x10b3350 --deref 0x5c --min 0x4 --fields 0xb9b520
```

Three kinds of door, and the second is why the first alone lies. `--getter`
roots at every call to the function that returns the pointer. `--cast` roots at
every `dynamic_cast` to the class's RTTI type descriptor — the same door after
the compiler INLINED the getter, which in the game build it does everywhere
hot: rooted at the calls alone, `SRMGParameters` came out with eleven fields
nothing reads, four of them read by an inlined copy of its own getter, the mine
guard levels among them. `--deref <offset>` moves the question one step in, to
what a pointer field leads to: a template's zones have no door of their own,
they are reached by walking a stride from `template+0x5C` and by nothing else.
`--fields` joins the result against the field map, so the answer comes out in
the file's own words and ends with the list of fields nothing read.

What the sweep cannot see it says out loud. A pointer that leaves the walk —
pushed as an argument, moved to `ecx` for a method call — is printed under
ESCAPES, and an absence is only earned once those are accounted for; in the
parameters' case every one of them is the getter's own cache store or the
resource release, except three `push`es that turned out to be a leaked taint
rather than the pointer. A door that leads to no read at all is printed too.

**The type descriptors**, which are what `--cast` is given:

| class | game | editor | getter (game / editor) |
| --- | --- | --- | --- |
| `SRMGParameters` | `0x10B70D4` | `0x129DF0C` | `0xEAFF80` / `0xCFB010` |
| `SRMGTemplate` | `0x10B3350` | `0x128CEE0` | inlined / `0x87F770` |
| `STable_RMGPreset_Race` | `0x10B70AC` | — | — |

The editor build keeps a real getter for each and inlines it once beside it
(`0xCF7D7E` writing the `+0x54` cache, `0xCF6EEA` writing the `+0x4C` one),
plus a non-caching holder-assign for the template at `0x87E8A0`; the game build
inlines both everywhere. `--cast` covers all of it either way.

**`tools/rmg-field-probe.ts` — and then the engine is asked.** A loose file
under `<game>/data/` wins over the copy inside `data.pak`, which is measured
rather than assumed: cutting `Mine1LevelMaxRadius` from 20 to 8 moved a mine
from x=32 to x=18 and repainted 23,640 bytes of terrain. So each field gets a
value far from the shipped one, the same order is generated again, and the
output is compared:

```bash
node tools/rmg-field-probe.ts --game <dir> --control    # fields the sweep says ARE read
node tools/rmg-field-probe.ts --game <dir> --unread     # fields it says are not
node tools/rmg-field-probe.ts --game <dir> --template --unread
```

A template is copied to `data/RMGProbe/Probe.xdb` and ordered from there, so
the game's own `RMG/Templates` — which the native generator lists — is never
touched; the loose file is removed again when the probe ends.

The controls are the point. A probe that reports "no change" for everything is
a broken probe, and the only way to know the difference is to run it on fields
that must move the map: `Mine1LevelMaxRadius`, `DistBetweenTreasureBlocks` and
`JunctionMinBorderDistance` each rewrite tens of thousands of terrain bytes, a
template's zone-0 `TreasureDensity` and `Prisons` likewise.

**One order per launch, and the extension now enforces it.** A launch's SECOND
order does not repeat its first: two identical orders in one process came out
with different statics — the divergence begins in the statics block of
`map.xdb`, Mountains against Hellpikes, with the draw counters still agreeing
at the border-table step, so it is state surviving between generations rather
than a different number stream. Why it survives is an open question; that it
does is measured, and it had already put two wrong numbers in the `-size`
table. So the loop moved OUT of the extension into `tools/rmg-batch.ts`, which
starts the editor again for every order. One order per launch IS reproducible: twice over, the whole output matched except the
`RMGguid`, which is drawn fresh every time, and ONE byte of `GroundTerrain.bin`
at offset 160305 — the uninitialised byte the port already knew about. The
probe subtracts exactly those two and nothing else.

### `RMGParameters` — sixteen of its fifty-five fields feed nothing

Read in both builds, and each read located: the six mine radii, the four guard
levels and `BasicLeverGuardPower`, `JunctionMinBorderDistance`,
`DistBetweenTreasureBlocks`, both terrain lights and the point-light block bar
one field, six of the eight text references, all five tile references,
`MapSizeNames`, all four objective and water texts, `MonsterStrenghtNames`,
`GroundTerrainLights`, `Obelisk`, `Grail` and `WaterTreasures`.

Ten of the sixteen are numbers, and a number can be put to the engine as well
as to the disassembler. Nothing reads these — no instruction in the game build,
none in the editor build — and changing each one leaves the generated map
identical byte for byte. The eleventh row is `MinDist`, which lives inside
`PointLightParams` rather than at the top level and so is not one of the
sixteen:

| field | shipped | probed with | verdict |
| --- | --- | --- | --- |
| `RMGVersion` | 37 | 99 | inert |
| `TeleportMinBorderDistance` | 2 | 9 | inert |
| `TeleportMaxBorderDistance` | 10 | 30 | inert |
| `DistBetweenLakes` | 10 | 40 | inert |
| `CreatureMinStackAmount` | 5 | 40 | inert |
| `CreatureMaxStackAmount` | 70 | 9 | inert |
| `MinDistanceBetweenBigObjects` | 15 | 2 | inert |
| `MinDistanceBetweenTreasureBlocks` | 5 | 25 | inert |
| `TransitiveTileIntensity` | 200 | 250 | inert |
| `ShipyardGuardsLevelCoef` | 20 | 40 | inert |
| `PointLightParams/MinDist` | 11 | 40 | inert on a surface map |

The remaining six the sweep finds no reader for are beyond the probe's reach,
being text or lists rather than numbers: `ScenarioCaption`,
`ScenarioDescription`, `CreatureStackParams` (all three of its fields),
`Templates` (empty in the shipped file), `ResourceMineColors` and
`MonsterLevelCoef` (also empty).

`MonsterLevelCoef` and `ShipyardGuardsLevelCoef` are the strongest verdicts in
the table: **no instruction in the generator's whole address range even uses
their displacements** (`+0x1E4`, `+0x1F0`), so there is nothing left to check by
hand. The shipyard guard was already suspected — it is `BasicLeverGuardPower ×
ConnectionGuardLevel × 20` with the 20 an immediate at `0xECC901` — and this
settles it over the image rather than over one function.

**`TransitiveTileIntensity` is settled, and the earlier claim was right for the
wrong reason.** It was written down twice as "never read here", meaning in the
paint step; the honest version needed the whole image, and it now has one. Ten
instructions in the generator's range carry the displacement `+0x168` and every
one was looked at: four are `mov dword ptr [esi+168h],<string>` in an unrelated
constructor, six are the price-list walk at `0xEB975F` reading a vector's
`begin`/`end` pair at `+0x168`/`+0x16C` of a different object. The 200 in the
file reaches nothing, and 250 changes no byte of the map.

`CreatureMinStackAmount`, `CreatureMaxStackAmount` and the whole
`CreatureStackParams` block being inert is worth pausing on, because the names
promise the opposite: guard stack sizes come from somewhere else entirely — the
`SetMonster` path the port already models, `BasicLeverGuardPower × the type's
level` — and these three numbers are a design that was never wired up.

### `SRMGTemplate` — `GraalOnMap` and `Underground` are dead

The template object is `0x50` of base and then ten fields:

| off | field | read by |
| --- | --- | --- |
| `+0x50` | Name | the editor's template list |
| `+0x5C` `+0x60` `+0x64` | Zones — begin, end, capacity | everything |
| `+0x68` `+0x6C` | Connections — begin, end | the connections phase |
| `+0x74` | **GraalOnMap** | **nothing** |
| `+0x78` `+0x7C` | MinPlayers, MaxPlayers | the eligibility filter and the player draw |
| `+0x80` `+0x84` | MinMapSize, MaxMapSize | the same two |
| `+0x88` | **Underground** | **nothing** |
| `+0x89` | TestTemplate | the eligibility filter |

`GraalOnMap` and `Underground` are parsed by the serialiser, given defaults by
the constructor (`0x8800FE`, `0x880117` in the editor), copied field for field
when a template object is copied (`0x881195`), and then branched on by no
instruction in either executable. Setting each to `true` in a template and
ordering the same map produces the identical output — while zone 0's
`TreasureDensity` and `Prisons` in the same file rewrite twenty-odd thousand
bytes of terrain, so the probe was not asleep.

That a map has an underground is the ORDER's business — the dialog's checkbox
and our `-underground` switch decide it, and `create-map.ts` already takes it
from the request. The Grail is placed by the upgrade-buildings step in the
favoured zone regardless of the flag. So the two fields are data the format
carries and the engine ignores.

**But "the template's `Underground` is dead" is not the same sentence as "the
underground and the template have nothing to do with each other", and the
second one is false.** Ask for an underground in the dialog and templates
disappear from the list — which is an observation about the UI, and the filter
explains it without reading the field. At `0xCF7B58` the requested size is
DOUBLED before it is matched against the template's `MinMapSize`/`MaxMapSize`,
and the template is additionally required to have `MaxMapSize >= 10`; the plain
comparison at `0xCF7B38` is the other branch. Doubling the area is exactly what
a second floor costs, so the underground choice narrows the offered templates
through their SIZE RANGE. The link is real and it is indirect: the engine
consults `MinMapSize` and `MaxMapSize`, never `Underground`.

**And the flag is named, not guessed.** The branch is selected when
`[ebx+0x0C]` is clear and `[ebx+0x0D]` is set, and `+0x0D` of that record is
where the console command's own handler puts the value of `-underground`
(`0x73CEDB`, the settings built one instruction earlier by `0x467E10`; the
slots are named by `net-probe --frame`, not counted by eye). So the record is
the RMG request, `+0x0D` is the underground, and asking for one doubles the
size the template's range has to contain. The first version of this paragraph
had the condition backwards — "both clear" — which is what reading a
`cmp`/`jne` pair without following the fall-through gets you.

The eligibility filter deserves a name, because it is why `MinPlayers`,
`MaxMapSize` and `TestTemplate` are read at all: at `0xCF7B17` the editor walks
the template list rejecting anything with `TestTemplate` set, then anything
whose size range does not contain the chosen size and whose player range does
not contain the chosen count. That is the DIALOG's list, not the generator —
and the console command bypasses it, which is why `rmg` will happily generate
from a template the dialog would not have offered.

### The template's ZONE — three of its twenty-five feed nothing

A zone item is `0x74` bytes and twenty-five fields, and the item pointer is
never handed out by a getter: it is `template+0x5C` plus a multiple of the
stride, which is why the sweep needs `--deref`. Nine sites in the whole image
step by that stride, all of them between `0xEA1D40` and `0xEA5B70`.

| off | field | read by |
| --- | --- | --- |
| `+0x04` | Index | the per-zone driver, `0xEA414A` |
| `+0x08` | Setting | LoadTemplate, `0xEA2358` — compared against 1, 2, 0 |
| `+0x0C` | **CanBeWater** | **nothing found** |
| `+0x10` | Size | LoadTemplate's floor balancing |
| `+0x14` | CanBePlayerStart | LoadTemplate, `0xEA2370`/`0xEA23DF`/`0xEA243B` |
| `+0x15` | Town | the town step, `0xEA5CB0` |
| `+0x18` | TownGuardStrenght | the town step, `0xEA5FC6` — × `BasicLeverGuardPower` |
| `+0x1C` | Shipyard | LoadTemplate, `0xEA2526`, water branch only |
| `+0x20` | Mines | the mines step, `0xEB6030` — the address is formed at `0xEA4228` |
| `+0x2C` | AbandonedMines | the abandoned-mines step |
| `+0x30` | Dwellings | the dwellings step, `0xEB8C2C` — address formed at `0xEA456B` |
| `+0x3C` … `+0x64` | the eleven density and points fields | their price-list workers |
| `+0x68` | **DenOfThieves** | **nothing** |
| `+0x6C` | **RedwoodObservatoryDensity** | **nothing** |
| `+0x70` | BuffPoints | read, and thrown away — see below |

**The observatory claim was right, and now it is earned.** `0xEBF930` IS the
observatory and den-of-thieves step — its two static holders resolve
`Redwood_Observatory` and `Den_Of_Thieves` — and it IS handed the whole zone
item at `0xEA52FE`. It then never reads it: its argument is only reachable as
`[ebp+8]`, its body contains no such reference, and `ebp` is repurposed as a
general register partway through. Both numbers come from somewhere else
entirely — the observatory count is **the zone's tile count ÷ 1000 + 1**
(`0xEBF948`), and the den of thieves is **a 2-in-10 roll**, once per zone, on
non-start zones only (`0xEBFC3C`). So the two densities in every shipped
template are decoration: changing zone 0's from 100 to 400 and its
`DenOfThieves` from 1 to 9 leaves the map identical.

**`BuffPoints` is why READ and CONSUMED are two words.** The driver does read
`+0x70` and does pass it — to `0xEC04D0`, whose entire body is `ret 4`. The
static sweep therefore counts it read, and the probe finds it inert, and both
are right about different things.

**`CanBeWater` is the one field neither instrument settles.** No read of `+0x0C`
appears anywhere: LoadTemplate's every dereference of the item was enumerated
(`+4`, `+8`, `+0x10`, `+0x14`, `+0x1C`) and this is not among them, and the
water branch is taken on a GENERATOR-level flag instead. But the console
command has no water switch, so every map this batch can order is dry, and a
probe on a dry map could not tell an unread field from an unreachable one. It
stands as unread by the code, unprobed by the engine.

### The preset table — the road strengths reach nothing

`RMGPresetTable.xdb` carries a `*Strenght` int behind each of its four tile
references, 100 in every race. The road painter puts the literal 255 at a
tile's four corners, which is what made them suspect; the probe settles it.
Changing **every** occurrence in the document — all nine races at once —
changes no byte of the map, for `RoadTileStrenght`, `SecondaryRoadTileStrenght`,
`WaterTileStrenght` and `WaterBottomTileStrenght` alike.

The control that makes those four mean something is `GuardStrenght`: changing
every one of its 484 occurrences DOES move `map.xdb`, so the loose file is
being read and the probe is not asleep. It is also the limit of this
particular probe — it is document-wide, so it cannot separate the vector where
`GuardStrenght` is live (upgrade buildings, pushed into `0xED3200`) from the
four where it is dead, and the earlier finding about those four stands
untouched by it.

Three fields of the preset's statics block — `SetProbability`,
`ConcurentProbability`, `BorderWidth` — also came out inert, but only five
races carry that block and the reference order may not use one of them, so
that is a lead rather than a verdict.

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
| 6 | editor | 1785351845 again | `S1P2Z2M1` | small | **the water reference** — the water checkbox on, everything else run 3 |

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
| `terrain.ts` | `FillTerrain`, the road painter `0xECE3E0`, the water and LAKE painters | **done** — every mask layer of all four reference files, byte for byte |
| `towns.ts` + `town-data.ts` | `PlaceTowns` | **done** — 16 draws, and both towns land where the engine put them |
| `dist-to-towns.ts` | `FillDistToTownsTable` | **done** — drawless; its side effect is what later phases see |
| `connections.ts` | `ZoneConnections`, land passages and guards | **done** — three guards on the engine's own tiles; teleports unported |
| `placement.ts` | the machinery every placement worker shares: room, filter, fit, stamp | **done** — read out of mines, confirmed against dwellings |
| `mines.ts` | the mines step: rings, guards, piles | **done, live in zone 1** — 74 draws to the boundary, every object on the reference tile |
| `dwellings.ts` | the dwellings step | **done, live in zone 1** — 8 draws to the boundary; mode 1 and tier ≥ 3 unported |
| `upgrade-buildings.ts` | the upgrade-buildings step, and the guard wrapper `0xED3200` | **done** — zone 1's zero-draw exit live; the townless zones' budgets held by arithmetic, their live run waits |
| `shrines.ts` | the shrines step: the hardcoded table over the generic placer | **done, live in zone 1** — 5 draws to the boundary |
| `price-lists.ts` | the generic price-list placer and the four preset-vector steps' budget rules | **done, live in zone 1** — ten objects to the shops boundary at 18653 |
| `treasures.ts` | the zone tail: observatories, the Den roll, treasures/chests | **done, live in zone 1** — 9 draws to 18662; chests a measured no-op |
| `road.ts` | the zone road: the chain, the wave, the coin-tied walk | **done, live in all four zones** — 928 coins to the loop's end at 20039 |
| `objects/*.ts` | the remaining `MainObjects` steps, one file each | |
| `treasure-blocks.ts` | `CTreasureBlockDistributor`: the growth `0xED5650` and the fill `0xED49D0` | **done, live in all four zones** — 2,640 draws to the run's end at 92438 |
| `teleports.ts` | the connections phase's second sweep `0xEB7C60` | **done, live on the underground run** — the pair tile-for-tile; serves the island connections unchanged |
| `water-border.ts` | the water carve and treasures — `0xECB7D0` and its tail `0xECDB20` | **done, live on the island run** — 36 treasures by name |
| `shipyards.ts` | the shipyard `0xECC0A0` — the `+0x2C` override's tail | **done, live on the island run** — 4 shipyards and their guards by name |
| `prisons.ts` | the prisons step `0xEBD1C0` | **done, live on the underground run** — 8 and 6 draws |
| `artifacts.ts` | the artifact table the distributor's pool is built from | **done** — cost and the generated flag, in id order |
| `armies.ts` + `creatures.ts` | `CMonsterSetter::SetMonster` and its tables | **done** — the reference's three guards, creature for creature |
| `heights.ts` | the height plane: relief cones, the late pass `0xECF760` | **done, bit-identical** on all three references — 24,147 vertices |
| `emit.ts` | the map.xdb emitter: per-type object bodies over the blank skeleton | **done — all three references byte-identical** |
| `emit-texts.ts` | the archive's UTF-16LE texts from the Params word files | **done — all three references byte-identical** |
| `emit-terrain.ts` | the GroundTerrain.bin writer, N layers | **done** — all four reference terrain files BYTE-IDENTICAL |
| `passability.ts` | GenerateMap's last pass — the zone slot `+0x38` | **done** — the plane exact on all four files |

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

Still open here: the two units↔size-index conversions themselves — the block
that calls them is read and written down below, and what is left is naming the
class they hang off. The forced-underground fit check IS read: a template
whose MinMapSize exceeds the units of size index 6 gets `settings[0x1C] =
0x100`, which is the path that then skips the underground coin.

**The size fit, read** (`0xEAB460`, the engine's `createMap`; it has no direct
callers, so it is reached through the generator's own vtable at `0xFF3C60`).
The block around the size draw is this, and it names both conversions:

```
if (template.maxMapSize != 1):
    maxUnits = settings->vt[0x14](6)        ; size INDEX 6 -> template units
    if (template.minMapSize > maxUnits):    ; the template wants more than the
        settings[0x1C] = 0x100              ; biggest map there is
    elif settings[0x1C]:                    ; an underground was asked for
        settings[0x1C] = 0
        settings[0x1D] = below(2) != 0      ; 0xEAB5A2 — the coin that REPLACES
                                            ; the first next(), not a fourth draw
next()                                      ; 0xEB13A0
if settings[0x1E]:                          ; the size was left to the generator
    units = template.minMapSize + below(template.maxMapSize - template.minMapSize + 1)
    twoFloors = settings[0x1C] == 0 and settings[0x1D] != 0
    size = settings->vt[0x18](twoFloors ? units / 2 : units)   ; units -> INDEX
    this[0x20] = size
```

So `vt+0x14` turns a size index into the template's own units and `vt+0x18`
turns units back into an index, and the two-floor halving happens on the
UNITS, before the conversion — which is what
[`create-map.ts`](../src/rmg/create-map.ts) already models. What the index
then means is settled: it indexes the table at `0xFF291C`, read into a map as
72 / 96 / 136 / 176 / 216 / 256 / 320, and `0xE9FFE4` is where the engine
takes `[edx*4 + 0xFF291C]` and stores it as the map's TileX.

Still open, and now narrowed to one thing: the two conversions belong to the
SETTINGS object (`arg2`), not to the generator, so its class has to be named
before its slots can be read. Until then a size other than the references'
cannot be ordered, and `rmg-pack` says so instead of guessing.

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
(in the schema with default TRUE; two shipped templates write it —
S0-1P2Z2K3.2T and S3-5P2-8Z8K2M, every zone, always true — the rest rely
on the default; template.ts parses it).

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
the road painter (Phase 14), whose theft closes the difference. The orientation
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

**The border table is not permanent, but only two phases dent it.** An
earlier version of this note blamed `0xEC1500`; a full write-site sweep
(every `+0xE4` store in the RMG range) corrects it. `CalcBorderTiles`
writes 0 on a border tile and the truncated Euclidean distance elsewhere
(`border-tiles.ts`); after it, ONLY ZoneConnections writes — **1** on the
passage mouth and its same-zone orthogonals from both sides (`0xEC1F6B`,
`0xEC1FDE` for the digger; `0xEBA613`, `0xEBA66B` for the neighbour, the
latter with no bounds test at all) — which `connections.ts` already ports —
plus `CGameWaterBorderedZone`'s vtable `+0x24` override (`0xECB8F3`,
water only, and it also disowns `+0xC4` tiles). `0xEC1500` and `0xEC2F90`
only READ it; no placement worker dents it. That is why the road's costs
are exact with nothing but the connections' dents reproduced.

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
| upgrade buildings | `0xEC00F0` (Grail), `0xEBFFC0` (Obelisks), `0xEB96D0` | `+0x3C` | the Grail only in the favoured zone; both firsts only with `this->0xB5` |
| prisons | `0xEBD1C0` | `+0x48` | — |
| cartographer | `0xEBD4B0` | `+0x4C` | — |
| shrines | `0xEBE1C0` | `+0x54` | — |
| resource buildings | `0xEBE540` | `+0x5C` | — |
| treasury buildings | `0xEBECB0` | `+0x60` | — |
| luck/morale | `0xEBF090` | `+0x58` | — |
| shops | `0xEBF540` | `+0x50` | — |
| BuffPoints stub | `0xEC04D0` — whole body `ret 4` | `+0x70` | always a no-op |
| observatories + Den roll | `0xEBF930` | takes `&params[i]`, NEVER reads it | — |
| treasures, then chests | `0xEA57B0` → `0xEB9DC0` | `+0x40`, `+0x44` | underground (`zone->0xF4 != 0`) — they run later, in additional objects |
| road | `0xEC05B0` → `0xEC0B60` | — | — |
| big statics | virtual, zone vtable `+0x34` | — | second loop |
| one tile statics | virtual, zone vtable `+0x30` | — | second loop |

**The statics steps are virtual**: `CGameZone` answers with
`0xEBAA70`/`0xEBBBD0`, and Subterra, Dwarven, SubInferno and WaterBordered
each have their own, so a subterranean zone fills itself differently from a
surface one.

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

#### The second step — dwellings, read out of `0xEB8C10`

`0xEB8C10..0xEB96C2`, called from the zone loop at `0xEA4576` with the zone
params' `+0x30` vector — the template's seven per-tier counts — and one byte,
`generator+0xA5`. It is the mines step stripped to its skeleton, and the step
boundaries hold it live: zone 1 spends 8 draws (three attempts, two failed
fits), zone 2 spends 6, zones 3 and 4 with all-zero counts spend nothing.
`test-rmg-dwellings` runs zone 1 through the same rng that ran the chain and
lands the counter on 18574 with ImpCrucible on the reference tile, minted
name and all.

What is the same as mines, instruction for instruction: the room recompute
`0xEC28E0(4,0)` and the maximum `0xEC2EB0` per instance, the fit test
`0xEC3510` with the same six arguments, the name mint `0xEB3990`, the stamp
`0xEC2F90`, and the attempt loop — `below(candidates)`, `below(4)` for the
quadrant (the rotation is `q·π/2`, drawn before the fit is tested), strike
and redraw on failure.

What is different, and each difference is load-bearing:

- **The candidates are every tile of the zone.** No rings, no radii, no
  border test: the list is `zone+0xCC`, built once back in FillZones by
  `0xEB7790` (its only caller) with nothing but a zone-membership test, and
  never rebuilt. `RMGParameters` is never touched — `0xEAFF80` is absent.
- **The threshold divisor is 3, not 5** — `trunc(2·max/3)` at `0xEB8CD3`
  (`imul` by `0x55555556`, no `sar`) against the mines' `2·max/5`.
- **No guard, no piles.** `SetMonster` and `betweenFloat` are never called;
  the whole cost is 2 per attempt and 2 for the name.
- **An exhausted candidate list is terminal for the STEP** — the
  `Can't place dwelling %s at zone #%d, floor %d (town at %d:%d)` block at
  `0xEB9647` has no edge back into either loop, so one failure abandons every
  remaining instance and tier of that zone. (Whether mines behave the same is
  unread — their failure block is separate.)
- **The descriptor is the race preset's `Dwellings` list**, `RMGPresetTable`'s
  four hrefs the zone keeps at `+0x1C→+0x28`, indexed `min(tier, 3)` — which
  is why zone 1 (Inferno) placed ImpCrucible and zone 2 (Academy) Workshop. A
  hole in the table skips the instance, no draws spent.

**The worker is two-moded on `generator+0xA5`**, and every traced run has it
zero. Mode 0 with tier < 3 sets no properties at all — exactly the reference
map's dwellings, `PLAYER_NONE` with empty `RndSource`/`LinkToTown`. Unported
and unmeasured, said rather than hidden: mode 1 swaps the descriptors for the
seven `/MapObjects/Random/RandomDwellingN` stand-ins (`0x121C570`, filled by
`0x4D5A60`) and, when the zone has a town, sets `RndSource = 2` and
`LinkToTown` to the town at `zone+0xFC`; mode 0 with tier ≥ 3 reuses
descriptor 3 and switches its creature on via `creaturesEnabled[tier-3]`.

**One trap for a future comparison**: the reference has THREE `AdvMapDwelling`
items, and only two are this step's. The RefugeeCamp at 29:75 is minted at
draw 19821 — inside zone 4's SHOPS step, whose price list
(`NewShopBuildings`) carries two dwelling-typed entries, RefugeeCamp and
ElementalConflux. Counting item types against this step counts one too many.

#### The price-list placers — upgrade buildings (`0xEB96D0`) and shrines (`0xEBE1C0`)

One shape, two workers, and four more steps (resource, treasury,
luck/morale, shops) share it with their own preset vectors. A points budget
buys objects off a priced list: per object, `below(affordable prefix)`
picks the type, then the dwellings-shaped body — room recomputed, filter
`room > trunc(2·max/3)` over the `zone+0xCC` tiles, two draws per attempt,
two for the name — and `spent += Value` until the budget clears nothing.
The prefix is a LEADING scan that breaks at the first element with
`Value + spent > points`, so list order is load-bearing: the shipped
upgrade list's tail (SpellMentor 20, SacrificeAltar 10) sits behind the
Value-40 wall and is unreachable until the budget clears it. Exhausted
candidates abandon the step whole, dwellings-style. Both live in zone 1
(`test-rmg-upgrade-shrines`): upgrade buildings as a measured zero-draw
exit, shrines to the boundary at 18579 with `Shrine_Of_Magic_2` on the
reference tile.

**Upgrade buildings, what is its own:**

- **The budget** is `trunc(len(zone+0xCC) · trunc(density · mult) / 10000)`
  (`0x68DB8BAD` magic at `0xEB96F8`), density = the template's
  `UpgBuildingsDensity` raw. `mult` is the `{0.2, 0.5, 1, 2, 4}` ladder
  (jump table `0xEA543C`) indexed by `generator+0xB0`, applied at the CALL
  SITE and to no other step. The traced run's draw counts pin the index to
  1 (× 0.5): 2302·20/10000 = 4 points against a cheapest Value of 8 is the
  whole of why a town zone spends nothing — towns are never consulted.
  Zones 3 and 4 get 11 points, an affordable prefix of six, and exactly one
  building each (12 and 31 draws decompose as 1+2·2+2+5 and 1+2·12+2+4).
  What writes `+0xB0` is unread.
- **The list** is `[zone+0x20]+0x168` — 0x14-byte records `{_, href,
  loaded, Value, GuardStrenght}`, which is the preset's
  `NewUpgradeBuildings` (the offset map of `[zone+0x20]` matches the xdb
  field order across four sibling steps: `NewLuckMoraleBuildings +0x144`,
  `NewShopBuildings +0x150`, `NewResourceGivers +0x15C`,
  `NewUpgradeBuildings +0x168`).
- **The guard** goes through `0xED3200` — its ONLY caller in the image —
  not the mines' inline seat, and the two differ in both anchors: the base
  tile is the object's position plus the FIRST active-tile offset rotated
  by the angle (mines: the LAST stamped tile), and EIGHT directions are
  tried from index `2q`, orthogonals then diagonals (mines: four
  orthogonals). Freeness is the road-lenient test, no border or zone check.
  Power = `BasicLeverGuardPower × GuardStrenght`; SetMonster's own
  `power < 100` gate spends nothing, but the seat is taken and occupancy 4
  written regardless. The guard tile joins `zone+0x98` — which the room
  machinery never reads (mask 4 selects `+0x68`), so guards do NOT steer
  later room; the treasure blocks phase is the ledger's one reader, and
  keeps its piles 8 tiles away from every seat in it (Phase 13).
- **A suspected infinite loop, never reached**: a failed mint (`0xEB9B37`)
  skips the accounting and re-enters with an identical candidate list.

**Shrines, what is its own:**

- **Points are raw** — `ShrinePoints` pushed verbatim (`0xEA4B8B`), no
  scaling; under 6 the step returns before any draw.
- **The list is hardcoded**, mines-style: `Shrine_Of_Magic_1/2/3` at costs
  `{6, 10, 12}` (records `0x121CA90`, costs `0xFF4C94`, static init
  `0x4D5B40`). The preset's `NewShrines` vector is never read by this
  worker — which is why the reader in `preset-table.ts` does not carry it.
  The loop condition hardcodes the 6 (`0xEBE4BF`), not `cost[0]`.
- **The candidate filter is the shared helper `0xEC1500`** (ten callers:
  prisons, cartographer, shrines, resource, treasury, luck/morale, shops,
  road and two more — upgrade buildings is NOT among them, it inlines), and
  it adds a **border distance ≥ 1 gate** the inline filters do not have.
  Measured, not just read: dropping the gate moves zone 1's boundary by 14
  draws.
- **No guard, ever**: SetMonster is called by none of the `0xEC1500`
  family. And no SpellID — the reference's `SPELL_NONE` is the shared
  document's default.

**The other four — resource (`0xEBE540`), treasury (`0xEBECB0`),
luck/morale (`0xEBF090`), shops (`0xEBF540`) — are the same body with the
preset's own vectors**, and the traced run's 240 draws over 33 objects
replay against the model without one mismatch (`test-rmg-price-lists`
holds zone 1's ten live). What the four settle:

- **The budget rule follows the template field's SUFFIX.** `…Points`
  fields arrive raw (treasury `TreasureBuildingPoints`, shops
  `ShopPoints`); `…Density` fields scale as `trunc(tiles · density /
  10000)` (resource), and luck/morale adds 40 to the density INSIDE the
  product — `add eax,28h` at `0xEBF0C6` before the multiply — which is
  why a density-0 zone still builds (2279·40/10000 = 9 points). No
  `{0.2,0.5,1,2,4}` ladder anywhere here: that is the upgrade-buildings
  call site's alone.
- **The vector-offset map closes**: `NewLuckMoraleBuildings +0x144`,
  `NewShopBuildings +0x150`, `NewResourceGivers +0x15C`,
  `NewUpgradeBuildings +0x168`, **`NewShrines +0x174` — read by nobody**,
  `NewTreasuryBuildings +0x180`.
- **`GuardStrenght` is dead data in these four vectors.** Twelve traced
  objects carry a non-zero one and none drew a guard; the only `+0x10`
  read in the family is upgrade buildings' push into `0xED3200`.
- **The stop is `list[0].Value + spent <= points`** — the FIRST element,
  like upgrade buildings; the shrines' hardcoded 6 is that list's own
  `cost[0]` and a quirk of that worker alone.
- **An entry need not be a building.** Shops ship two dwelling hrefs
  (ElementalConflux, RefugeeCamp) and place them as plain objects — the
  worker casts to the shared BASE type, and no dwelling properties are
  set. The one exception is treasury, whose working descriptor is cast to
  `SAdvMapBuildingShared`: a non-building entry there aborts the step
  silently, with no log line. Nothing shipped reaches it.
- **Only upgrade buildings logs on success** (`building #%s(%d) set…`) and
  logs its budget up front; these four emit nothing but their failure
  line. Every price-list worker also push_backs the minted name record
  into `[zone+0x134]+0x40`, a ledger whose consumer is unread.

#### The zone tail — observatories, treasures, chests (`0xEBF930`, `0xEA57B0` → `0xEB9DC0`)

Read whole and replayed against the trace: the four zones' 9/15/5/5 draws
account draw for draw (`test-rmg-treasures` holds zone 1 live to 18662).

**Observatories (`0xEBF930`).** Takes `&params[i]` and never reads it —
`RedwoodObservatoryDensity` and `DenOfThieves` are DEAD template fields.
Places `trunc(len(zone+0xCC) / 4000) + 1` Redwood Observatories (the
divisor is read out of the magic multiply; every traced zone lands N = 1)
through the `0xEC1500` machinery with a 100-attempt cap per object. Then
**the Den roll**: a zone with no player (`zone+0xF0`, the 1-based player
number) draws `below(10)` and on 0 or 1 places one Den of Thieves the same
way. Both town zones skip the roll and both townless zones took and missed
it (9, 8) — the measurement that pins the gate.

**Treasures and chests (`0xEB9DC0`, behind the `0xEA57B0` dispatcher).**
Surface zones only — the dispatcher sits behind `zone->0xF4 == 0`, and the
additional-objects phase later calls the same dispatcher for the
underground zones. The worker prefilters `zone+0xCC` once by border ≥ 1,
takes `count = trunc(len(RAW list) · trunc(density · ladder) / 10000)` —
TreasureDensity on the `{0.2,0.5,1,2,4}` ladder indexed by
`generator+0xA8` for treasures, TreasureChestDensity by `+0xB0` for
chests — and per object: room + filter (room > trunc(2·max/3), border ≥ 1,
**occupancy ≠ 2** — this inline filter's own gate; roads and guard tiles
are acceptable seats), then the TYPE: `below(9)` over the table at
`0x121C910` — Campfire, **Chest**, Crystal, Gems, Gold, Mercury, Ore,
Sulfur, Wood — so a drawn treasure can be a Chest, and **the chests step
is the same body with the type fixed at index 1**, 4 draws per object
instead of 5. Amounts are never drawn and never written (the reference's
`Amount 0` is the document default). Exhaustion abandons the step. In this
template the chests step scales to zero everywhere; the reference's 31
chests all come from the treasure-blocks phase — counting `Chest` objects
against the chests step counts 31 too many.

#### The road (`0xEC05B0` → `0xEC0B60`) — ported, live in all four zones

Zone 1 spends 234 draws here, zones 2–4 265/222/207, and every one is the
same coin: **`below(2)`, once per walked tile, the only RNG in the block**
(`0xEC12D9`) — it flips whether the 8-neighbour scan runs forward or
backward, pure tie-breaking on a strict compare. No mints, no objects.
`src/rmg/road.ts`; `test-rmg-road` runs the whole first loop of
MainObjects live to 20039 on the strength of it. One honest limit: the
draw counter is BLIND to the coin's sense — either pick of a tie is a
path of the same length — so the coin direction is held by reading alone
until the road masks can be compared.

**What it connects**: the zone's `+0x68` points, each routed to its
NEAREST LATER sibling in list order — **and then one more**: `argmin`
starts at 0, so the last iteration, whose inner loop is empty, routes
`points[n−1]` back to `points[0]` and CLOSES the chain. n calls for n
points; missing the closing route is what a first port came out 17–32
draws short by, zone for zone. The list must be in the engine's PUSH
order, and the full write-site sweep says it has exactly four feeders:
`0xEC2F90`'s passes 2 and 3 (actives, then the non-zero marker — towns
included, via `0xEB4CB0`'s stamp call: actives then marker, NO entry or
flag point), the digger's mouth (`0xEC26EA` in `0xEC1630`) and the
neighbour's adopted tile (`0xEBA5DB` in `0xEBA470`) — plus the Grail's
inlined seat (`0xEC03F5`), favoured-zone only. Guards push `+0x98`, never
`+0x68` — measured, too: adding them to the list breaks the mines' own
lockstep. One divergence kept in mind: `0xEC2F90` has NO bounds clamp on
its pushes where the port's stamp clamps — an object stamped against the
map edge would differ.

**The route** (`0xEC0B60(zone, from, to, kindBit, outList)`): a float cost
grid cached at `zone+0xA4..+0xB0`, filled with 1000.0, `cost[from] = 0`,
both endpoints' occupancy saved and zeroed; then a repeated full-grid
sweep (Bellman-Ford flavour, no queue) relaxing 8 neighbours with step
`1.0 (orth) / 1.41 (diag) + (100 − border)/100`, plus `(5 − border)` when
border < 5 — propagation is gated to the zone's own tiles but relaxation
writes into neighbours of any zone. `pure road algo failed.` fires at
sweep 800 and is not fatal; 2000 breaks. Then the walk descends from `to`
by `(int)cost` — TRUNCATED comparison, far coarser than the field — one
coin per tile, OR-ing the kind bit into occupancy (`0x20` here, lists:
`0x08 → zone+0x74`, `0x10 → +0x80`, `0x20 → +0x8C`; the first two belong
to the later roads phase at `0xEBA690`). Quirks to reproduce: the endpoint
occupancy is restored only on a clean finish (a walk that steps out of
bounds loses it), and the sweep's neighbour bounds check swaps the axes —
harmless on square maps only.

**Where roads land for comparison**: not in `map.xdb` — they are terrain
layers in `GroundTerrain.bin`. The reference's road layers: SandRoad 607
vertices, LavaRoad 131, Dead_Land 175 (the Inferno SECONDARY road tile of
land class — the layer `test-rmg-terrain` already books as "the roads
phase's"), plus Lava's 175 missing vertices resolving. Those masks,
byte for byte, are the acceptance target once the painter is reached.

### Phase 11 — the roads phase (`0xEBA690`) — ported, live

`src/rmg/roads-phase.ts`, `test-rmg-roads-phase`: 381 draws, 20039 →
20420, every one the router's coin — the phase calls nothing that draws
except `0xEC0B60`. The driver is an **inline loop in GenerateMap**
(`0xEABE7D..0xEABF53`, printing "at %g roads created" at `0xEABF61`):
floors ascending, each floor's zones in the level hash_map's bucket order
— the order `floorIterationOrder` already models — calling `0xEBA690`
non-virtually per zone. (A standalone copy of the driver at `0xEA3DC0`
has no callers.) Between "main objects set" and the loop: two callback
invocations, no draws — the phase has NO prologue draw.

Per zone, after a cost-grid cache ensure that is a no-op by now
(`0xEBA69F`), three parts:

**The seed** (`0xEBA6EB`). With byte `zone+0xF8` set — "has a town",
written by PlaceTown right after its stamp — the town ENTRY at `zone+0xC`
(the same point Phase 8 grows from) is pushed into `zone+0x74`, the 0x08
list. Otherwise element 0 of `zone+0xC0` is, if any. Nothing seeded means
the phase does nothing for this zone.

**Loop 1 — connections, kind 0x08** (`0xEBA710`). Each point of
`zone+0xC0` in index order is routed to its nearest point of the GROWING
0x08 list — every element scanned, single-precision distance, strict `<`,
best from 1000.0f, argmin from 0 — with one gate this loop alone has
(`0xEBA7FE`): both endpoints' truncated coordinates must lie inside the
map, or the route is silently skipped. `0xEC0B60(zone, from = network,
to = connection, 0x08, outList = zone+0x74)`: the wave grows FROM the
network, the walk descends from the connection point, and the walked
tiles join the list — later connections attach to earlier roads. A zone
seeded from its own `C[0]` routes it to itself for zero coins.

**Loop 2 — mines, kind 0x10** (`0xEBA883`). Each point of `zone+0x11C`
in index order finds its nearest road tile by a SAMPLED scan: the 0x08
list at indices ≡ 5 (mod 13) (`0xEBA8D5`, magic `0x4EC4EC4F`), then the
same best continued over the 0x10 list at indices ≡ 7 (mod 11)
(`0xEBA967`, magic `0xBA2E8BA3`). The route runs REVERSED — `from` = the
MINE point, `to` = the road tile, `outList = zone+0x80` — and has NO
bounds gate. Reachable quirk, kept: when no sampled index exists at all,
argmin is still 0 and the route goes to `road08[0]`, the seed, no
distance ever measured.

**Who fills the inputs** (write-site sweep): `zone+0xC0` gets the
digger's mouth (`0xEC2563` in `0xEC1630`), the neighbour's adopted tile
(`0xEBA5B8` in `0xEBA470`) — the same pushes ZoneConnections makes to
`+0x68`/`+0x98`, so `conn.passages` in push order IS this vector — and
teleport actives (`0xEB7C60` stamps via `0xEC2F90` with
`outList = zone+0xC0`; not ported, no surface-only template reaches it).
`zone+0x11C` is fed by the mines step's two stamp sites (`0xEB640F`,
`0xEB6E8F`) and the abandoned-mine placer (`0xEBE077`): stamp pass 2
pushes each ACTIVE tile into the caller's outList when non-null — every
other placer passes 0 — so the vector is every mine's actives in stamp
order, which `PlacedMine.actives` now carries. `zone+0x74`/`+0x80` have
no other feeder anywhere in the RMG range: they start empty, this phase
alone fills them, and the room-recompute masks read them afterwards —
the road painter does NOT: it scans the occupancy bits, which is why a
network's seed tile (in the list, but never walked) stays unpainted.

**Side writes**: none beyond the router's — occupancy `|= 0x08/0x10`
along walks, endpoint occupancy zeroed and OR-restored on a clean
finish. No border dents, no `+0x68`/`+0x98` pushes, no `RMGParameters`
or template reads: the 0x08/0x10 split is hardwired by loop.

The proof is the boundary alone — 130/115/65/71 coins across zones 1–4,
landing on 20420 — because per-zone boundaries are not narrated for this
phase and roads leave no `map.xdb` objects. Sabotage-checked: shifting
loop 2's sampling phase by one moves the boundary to 20424. The masks in
`GroundTerrain.bin` vouch for this phase too: every 0x08 and 0x10 tile
of all four zones lies under the painted road vertices (Phase 14), while
the zone road's 0x20 tiles are never painted at all — so the masks can
arbitrate the roads phase but not the zone road.

### Phase 12 — the statics (`0xEA5450` → vtable `+0x34`/`+0x30`)

`src/rmg/statics-big.ts`, `src/rmg/statics-one-tile.ts`,
`test-rmg-statics`. **Zone 1 runs in LOCKSTEP end to end** — big statics
to 40826, one-tile to 44537, 269 objects — and with ONE road tile
substituted (below) zone 2 does too: all 604 statics of zones 1–2 land
on the reference by minted name and tile. Zones 3–4 carry similar
road-corridor differences, awaiting the `grids` measurement.

**The driver** (`0xEA5450`, sole caller `0xEABFC4`): zones in TEMPLATE
ENTRY order (the 0x74-stride params array, entry+0x4 the zone id), big
statics (`+0x34` = `0xEBBBD0`) then one-tile (`+0x30` = `0xEBAA70`) per
zone, NO prologue draw and no `this->0xB5` read — the phase starts on
the roads boundary exactly. Subterra/Dwarven/SubInferno/WaterBordered
override both slots; the Subterra pair is read and ported (below), and
the underground run drives it in lockstep.

**What the underground run corrected in this phase's first reading**
(each held by the run's boundaries and by-name checks):

- **`zone+0x18` is the RESOLVED race.** The surface trace showed no
  lake draws for its Inferno zone because the seed scan found ZERO
  candidates — indistinguishable from a closed gate until a zone with
  candidates (the underground's HEAVEN zone 2) opened it.
- **The `+0x5C` stamped-blocked ledger** — the room masks' bit 0x02 —
  is written by the stamp `0xEC2F90` itself: every stamped blocked cell
  joins it, in stamp order, raw coordinates (no bounds check — and the
  occupancy write wraps through the grid's contiguous x-major buffer).
  A mine's piles and the treasures write their 2s directly and stay
  out. `0xEC28E0`'s full bit dispatch: 0x02 `+0x5C`, 0x04 `+0x68`,
  0x08/0x10/0x20 the three road lists, 0x40/0x400 occupancy-filtered
  `+0xCC` tiles (byte/dword-wide tests); the all-zones flag recomputes
  the LEVEL against the CALLING zone's lists, not each zone's own.
- **The LAKES** (`0xEBC260`, mask 0x3E): after the blob, the lake
  painter's tail (`0xECE680` → `0xecee65`) converts DEEP WATER: every
  level cell in 1..dim−2 with ≥ 3 of its 8 neighbours at EXACTLY 0x80
  turns 0x82, two-phase — and 0x82 & 0x3E = 2, so statics stand on a
  lake's rim, never in its interior. The seed decorations jitter with
  the FIRST below(5) on the pair's `a` field (the file's Y); the
  over-lake one-tilers keep list HOLES (a self-closed `<Item/>` is
  picked for three draws and creates nothing — `below(len)` counts it).
  Decorations and one-tilers write no occupancy and push nothing.
- **The MOUNTAINS** (`0xEBCAF0`) have NO recompute — candidates read
  the room grid the lakes head left (stale if the gate never opened);
  type is drawn BEFORE the quadrant; the fit is the shared vt+0x44;
  0x100 per blocked cell is TRANSIENT (mountains overlap freely within
  the pass, only the 4.0 rule separates them) and the WHOLE accumulated
  set turns 2 after the pass; the relief cone fires unconditionally per
  placement.

### The subterranean statics — Subterra `+0x34`/`+0x30`, the carve

`src/rmg/massif-carve.ts`, the subterranean branches of
`statics-big.ts`/`statics-one-tile.ts`; driven by `test-rmg-underground`.

**The carve** (`0xED11D0`, reached from vt+0x40 = `0xEC4A50`/`0xEC7050`/
`0xEC92B0` — Subterra, Dwarven and SubInferno share it; SubInferno's
`+0x34` lacks the vt+0x40 call, unexplained): DRAWLESS, floor 1
hardcoded. The underground level carries two VERTEX grids `(dim+1)^2`
(`level+0x24` bytes, `level+0x14` floats; floor 1 starts 0x10/18.0 with
a rock frame — the low edges ramp 36/30/24 over bytes 32/26/21, the far
edge lines are plain wall — floor 0 starts 0x20/36.0). The carve walks
the 3×3-tile lattice: a clean 9×9 occupancy patch (byte mask 0x3E)
raises its 4×4 vertex block to rock (0x20/36.0), smooths the 16
surrounding lattice cells (`0xEB27D0` — bilinear over four fixed
corners, `trunc/9` bytes, float += delta·1.125; OOB corners read 0x20)
and stamps the patch 0x40; one conversion pass then turns EXACTLY-0x40
cells to 2 — so only the first subterranean zone's call carves. The
port's float grid is byte-identical to the reference
`UndergroundTerrain.bin`, all 5,329 vertices, frame and smoothing
included.

**Subterra big statics** (`+0x34` = `0xEC4A70`): the carve, then the
base sweep VERBATIM — same crater rule, rotations, fit, acceptance,
stamp — minus the relief cone and the "Mountain" test. Dwarven's
(`0xEC7070`) is the carve alone; SubInferno's (`0xEC92D0`) is Subterra's
body without the carve call.

**Subterra one-tile statics** (`+0x30` = `0xEC50C0`; SubInferno's
`0xEC9920` is an instruction-identical clone): the base skeleton — same
bucket thresholds, same cascade constants and strictness — with three
changes. A ROCK + BOUNDS filter everywhere (the corner vertex byte
above 0x10 is rock, read in the vertex grids' own transposed
convention; tiles must sit in 1..dim−2), tested BEFORE any draw. A
SURVIVAL pre-roll opens every pass — fence ≥ 0.7, near ≥ 0.6, mid and
far ≥ 0.9, equality survives — and in near/mid/far it comes BEFORE the
below(4) quadrant (the base drew below(4) first). Created blockers and
nonblockers go through vt+0x3C (`0xEC6280`): a resource path containing
"Crystal" takes a point light for two draws — z = zMin + below(zMax −
zMin), radius likewise from `PointLightParams` — colour drawless,
`Colors[zoneId % count]`. Dwarven's `+0x30` (`0xEC7090`) is its own
four-pass wall-and-pillar layout over the carve (FireColumns at
`%10==5` seats, Fakels one ring further, a drawless Dwarf_Column
forest, lights on "Fakel"/"FireColumn") — read in full, unported until
a dwarven-underground reference exists.

**Big statics** — three parts. The LAKES prologue (`0xEBC260`) gates on
`zone+0x18` ∈ {HEAVEN, PRESERVE, NECROMANCY, INFERNO, DWARF,
STRONGHOLD} and floor 0 — and the reference shows the gate CLOSED for
its resolved-Inferno zone, so `+0x18` is read as the TEMPLATE'S Setting
race (RACE_RANDOM_TYPE everywhere here), not the resolved one; its
write site is unchased, and a fixed-race template is where lakes first
run for real. Inside (held by reading alone): room recompute mask 0x3E
(`+0x5C` has NO writer anywhere in the RMG range — effectively 0x3C);
seed candidates = zone tiles with room > 5, border > 5, local maximum
of room over 8 neighbours (ties PASS — only a strictly greater
neighbour disqualifies, `0xebc380`); one betweenFloat per structural
candidate, accepted on roll < 0.4f strict THEN ≥ 20.0 from every
accepted seed (the roll is spent either way); seeds join `zone+0xB4`.
The blob grows drawlessly (chamfer +2/+3, occupancy 0x80, 13 waves);
`0xEC3B30` decorates seeds (OverLakeCenterObjects) and `0xEC3E00` rolls
below(10) ≤ 5 per COLLECTED LAKE TILE (OverLakeOneTileRandomObjects).
The preset-MOUNTAINS pass (`0xEBCAF0`, `Mountains` — empty for both
reference races) places with the statics fit, stamps occupancy 0x100
(reads back as 0 through the byte-wide fit) and raises the relief cone
(`0xED1660`: height += 2·(3.5 − r) under blocked offsets with r < 3.5,
also fired by sweep-placed "Mountain" statics with > 15 blocked tiles).

**The sweep**: room recompute mask 0x3C (`+0x68` actives + all three
road lists), candidates = zone tiles with room > 1 in `+0xCC` order,
built once; outer loop the preset's `BigStatics` in FILE ORDER (the
shipped tables order big→small), inner the candidates — NO tile draw.
"Big" is blocked count n > 10. A big "Crater" candidate keeps 15.0 from
every `zone+0xB4` point before any work. Big: 4 free rotations (angle =
attempt·π/2); small: ONE drawn below(4) — the phase's below-dominated
bulk. A passing fit costs one betweenFloat, accepted iff roll <
1/(n+1) single-precision strict; then the mint (two below), the
standard stamp, big positions into `+0xB4`, and the relief for big
Mountains. Placed candidates are not struck from the list.

**The statics fit** (`0xEC39D0`, vtable `+0x44`, drawless): per rotated
blocked offset — bounds [0, dim) (the dims swapped against the sweep's,
square-safe); the 5-margin ONLY at floor == 1; occupancy byte & 0x3E
== 0 (roads and objects block; lake 0x80 and mountain 0x100 pass); room
≥ 2 SIGNED (`jl`), so the −1 a never-recomputed cell keeps from
CreateMap fails it — and NO zone test, which is why the room grid's
staleness is modelled (the level's ONE persistent grid in the chain,
`ensureRoom`/`recomputeRoom` in placement.ts: each recompute writes its
own zone's tiles and 1000 to zoneless ones, everything else keeps the
last writer's values).

**One-tile statics** (`0xEBAA70`): room recompute mask 0x3C, then a
drawless bucket scan of `+0xCC` (occupancy EXACTLY 0, border ≠ 0; room
2 → near, 3–4 → mid, > 4 → far), then four passes: (1) the border
FENCE — every zone tile draws below(4) first (the trace's bare filler);
survivors (border == 0, occupancy ∈ {0,1,8,0x10,0x20}) ALWAYS get an
object, the betweenFloat only selects the list (< 0.4 blockers, else
big objects, else blockers; both empty = the engine's division by
zero); a "FireDot" blocker takes the MAP angle — `mapSetup`'s
betweenFloat(0, 2π), finally consumed — occupancy = 2 written over
roads; (2) near — below(4) + base roll, cascade with fresh rolls and
free fallthrough on empty lists: base < 0.15 big objects, else < 0.4
blockers, else < 0.6 nonblockers (occupancy 1, the step's only 1); (3)
mid — base < 0.3 big objects, else < 0.5 blockers, no nonblockers; (4)
far — base ≤ 0.5 (the one gate where EQUALITY passes) and big objects
only. No budget: the step ends when the passes run out of tiles.

**The corridor hunt, and what it found.** The road walk is one coin per
tile and equal-length corridors cost the same coins, so the draw
counter cannot see WHICH tiles a route walked — but the statics can:
the room recompute reads the road lists, and the fit reads occupancy.
Zone 2's divergence came down to ONE road tile (the engine walks the
ortho 61:62, the port's field made the diagonal 60:62 the unique
minimum), and no reading of the walk could produce that choice — so
the field itself was measured. Two oracle instruments came out of it
(native/rmg/oracle.c, config keywords): `grids` dumps the engine's own
road lists (`rl`/`rt`) and all four level grids (`zg`/`oc`/`bd`/`rm`)
at the roads boundary — it proved border, zone grid and room BYTE-EXACT
and pinned the differences to road tiles alone; `field` detours the
EDITOR's router (RVA 0x7FB1B0, found by its "pure road algo failed."
string) and dumps the cost field of a named route right after its wave.
The field dump showed the first ortho step from the start already one
ulp below the port's — an exact round-to-nearest TIE under the ported
composition — and the re-read of the editor's own wave explained it:
**the editor is compiled x87 where the game is SSE. The editor's step
is `(100−b) * 0.01f` (fmul) carried in DOUBLE with ONE rounding at the
store and the compare in double; the game's is `/100.0f` (divss) with
per-operation single rounding.** The reference map is the editor's, so
road.ts now implements the editor's arithmetic — after which every road
list of every zone is byte-identical to the dump, every statics
boundary lands, and the walk's every tie resolves the engine's way with
the port's own coin sense. The moral for every phase after this one:
when a traced run and a read-out-of-the-game-exe port disagree at one
ulp, ask WHICH BUILD generated the trace.

Speaking the editor's arithmetic is a choice of MEASURABILITY, not of
correctness: ordered runs can only be made in the editor (the game
offers no way to set the generation parameters), so the editor is the
only build a port can be held to. The GAME's wave builds DIFFERENT maps
from the same seed. The day the port serves the in-game RMG screen
(network play), it will need a build switch — game arithmetic vs editor
arithmetic in the router — deliberately deferred until then.

### Phase 13 — the treasure blocks (`0xEA3AE0` → `0xEBA420`) — ported, live

The generator's last phase, and the one that finishes the reference run:
2,640 draws from 89798 to **92438**, every boundary of every zone landed
(`test-rmg-treasure-blocks`).

**Read the LIVE function.** `0xED3F00` carries the phase's log string and
looks exactly like its body — and nothing calls it, and it is in no
vtable. An older redaction left as a COMDAT duplicate; it picks its
artifacts from a different pool (`+0x4C`/`+0x58` by a value threshold
where the live one filters `+0x70` by a cost window). The live path is
`0xEBA420` → `0xED3EB0` (a five-argument setter, no logic) and
`0xED49D0`, which begins by calling the growth `0xED5650`.

**Additional objects (`0xEA59E0`) cost nothing here.** Its per-zone body
sits behind `zone+0xF4 != 0` — the floor — so a surface-only template
never enters it, and the trace agrees: 89798 to 89798.

**A block is a spot beside a road.** `0xEBA420` first recomputes the room
grid with mask **0x38** — the three road lists alone — so throughout this
phase `room` is the distance to the nearest road tile. Then `0xED5650`
walks `zone+0xCC` and a seed must be:

| gate | the test | before or after the draw |
| --- | --- | --- |
| free | occupancy 0 (bit 0 is never written, so this is "untouched" — a road tile does NOT qualify) | before |
| beside a road | `room == 1`, exactly | before |
| away from the town | `(dy² + dx²) > 3.0f`, the SQUARE against 3 | before |
| — | **`below(8)`** — where the eight-neighbour walk starts | — |
| unguarded | no neighbour carries occupancy 4 | after |
| on an edge | at least TWO free neighbours with `room > 1` | after |
| spaced | `DistBetweenTreasureBlocks` (8) from every block already grown, and from every point of `zone+0x98` | after |

So the phase's whole draw budget is decided by three tests, and the
draw is spent on seeds that go on to fail four more.

**`zone+0x98` is the guards' ledger, and this phase is its only
reader.** ZoneConnections opens it with each passage guard's seat and
each tile adopted from a neighbour; the mines step and the upgrade
buildings add their seated guards. Nothing else ever reads it — which is
why earlier sections called it a ledger no one reads. It is what keeps
the piles off the roads' guarded junctions.

**The spot grows** into those of the seed's eight neighbours that are
free, at `room >= 1`, touch at least two footprints (occupancy 2) and no
guard. Fewer than two grown points and the seed is dropped; the seed
tile itself is not one of the points. The block records the SEED's raw
coordinates — no centroid is computed — and `trunc(distance to town)`.

**Then the value.** Once every block of the zone exists, the zone
record's `TreasureBlocksTotalValue` is split: in a zone WITH a town by
each block's distance to it (`trunc(dist * total / Σdist)`, so the far
blocks are the rich ones), in a townless zone evenly. Integer division
throughout, truncating toward zero. A block under **600** is then
skipped whole — no guard, no artifact, no piles, no draws.

**Filling a block**, in order:

1. the guard, on the seed tile, at `trunc(value * 2.5f + 0.5f)` of power
   through the ported `SetMonster` — 4 or 5 draws. Its facing is
   `-atan2(accX, accY)` over the directions to the block's own points and
   to every surrounding tile carrying a footprint or a guard, both
   accumulators nudged by `0.01f` so a null vector still has an angle;
2. the artifact — **one draw, always**. Candidates are the pool's
   artifacts whose cost, IN FIFTHS, satisfies `c + 500 < value` and
   `c * 7 > value`; `below(candidates)` picks one and the block pays `c`
   out of its value. With no candidate the engine still spends a
   `below(1)`, and that is the draw the trace shows as 0;
3. the piles, one per grown point, in growth order. `perPoint =
   (value / points) / 100`, both divisions integer. `perPoint <= 1` is a
   chest of 1 and costs no extra draw; otherwise `perPoint > 10` redraws
   it as `below(6) + 7`, a block of three points or more flips
   `below(2)` for a chest, and a resource otherwise takes `below(7)`
   over Wood, Ore, Mercury, Crystal, Sulfur, Gems, Gold. Each pile then
   spends `betweenFloat(0, 1)` on its rotation and two `below(65535)`
   minting its name.

**The artifact lands on the point at index 1 and only there**, and that
point gets nothing else. The pool itself is built in the distributor's
constructor `0xED3B80`: every artifact whose `CanBeGeneratedToSell` is
true, in ascending id order, id 0 skipped outright and id 10 (the
sextant) behind a context flag — 89 of the vanilla 97.

The phase writes NOTHING: no occupancy, no room points, no border. It
only reads, and hands its objects to the map.

### Phase 14 — the road painter (`0xECE3E0`) — ported, live

`paintRoads` in `src/rmg/terrain.ts`, `test-rmg-road-painter`. The pass
that turns the road networks into terrain layers — and with it **all
seven layers of the reference `GroundTerrain.bin` are byte-identical,
the roads-in-waiting forgiveness clause in `test-rmg-terrain` no longer
carrying anything.**

**Where it runs.** Not in the roads phase: GenerateMap calls it at
`0xEAC1FE`, on the same `CTerrainProcessor` (`map+0x60`) that ran
FillTerrain, AFTER "treasure blocks set" and just before "finished
creating map" (the water pass `0xECF760` — height −0.5 on the 0x80 bits
— follows it). Late, but nothing between the roads phase and it touches
the road bits: the statics fit refuses occupied tiles, roads included,
and the treasure blocks write nothing — so the port paints right after
the roads phase and the masks come out the same. In the editor build the
tail is an un-inlined function: `0xCEFC20`, painter at `0x7951F0`, same
logic instruction for instruction (x87 codegen aside).

**How it paints.** One scan of the occupancy grid per floor — outer loop
the SECOND port index, inner the first (`0xECE632`/`0xECE622`, the
reverse of FillTerrain's vertex walk) — and `test al, 18h`: only the
0x08 and 0x10 bits paint, the zone road's 0x20 never. A tile with 0x08
takes its zone's RoadTile (preset `+0x4C`), else the SecondaryRoadTile
(`+0x58`); the zone is the TILE's own from the zone grid, found through
GetZone and silently skipped when missing. The tile paints its FOUR
corner vertices at the literal 255 — `RoadTileStrenght` and
`SecondaryRoadTileStrenght` sit in the data at 100 and are never read,
the same fate as `TransitiveTileIntensity`, all three of them settled
over the whole image and then on the engine ("Which fields the engine
actually reads") — through the ordinary PaintTile, which is the whole of the layer arithmetic:

- Dead_Land (Inferno's secondary, `TT_LAVA`, priority 60) shares Lava's
  class, so its 255 overflows the 255 base and strips Lava — the 175
  stolen vertices, vertex for vertex;
- SandRoad (240) and LavaRoad (244) share the ROAD class, and a border
  vertex both networks touch keeps whichever combination the scan order
  dictates: at 34:63 the sand tile scans first, builds no base for the
  later lava paint, and the file holds BOTH at 255; at 51:50 and 52:50
  the lava corner scans first and the later sand paint strips it. The
  scan order is load-bearing, and those three vertices are its proof.

Because the occupancy decides, a network's SEED tile — pushed into the
road list but never walked, so never given its bit — stays unpainted,
which the reference masks confirm at both town entries. No draws: the
counter stands at 20420 through the whole pass, and the suite holds all
seven layers to the file byte for byte, 607 SandRoad, 131 LavaRoad and
175 Dead_Land vertices among them.

### Phase 15 — the height plane (`0xECF760`) — ported, bit-identical

`src/rmg/heights.ts`, `test-rmg-heights` — the whole surface reference
plane, all 9,409 vertices bit for bit. GenerateMap calls the pass ONCE
at 0xEAC206, right after the road painter; it touches floor 0 only (the
underground floor's heights are the massif carve's). The chain:

1. **The plane starts at 6.0** — the level constructor `0xEB2B60` fills
   the float grid with 6.0 for a surface floor (and builds the
   underground rock frame the massif port had to measure from the
   reference: fill 36.0/0x20, interior carved to 18.0/0x10, low edges
   ramped 36/30/24 — the same final state `createVertexHeights` writes).
2. **The statics add the mountain cones** (`0xED1660`, `coneRelief`):
   per rotated blocked tile within 3.5 of the static, ONE vertex takes
   `+2·(3.5 − r)`.
3. **The base field** (`0xECF9A0`): per vertex,
   `min(sin(o/10)·sin(o/42)·cos(n/13)·sin(n/29) / 0.15f ± dist/3 + 12, 3)`
   is ADDED — the cap makes 6+3 = the 9.0 plateau everywhere except
   NECROMANCY/INFERNO zones, whose dist term is negated (they dig toward
   the zone interior). Road tiles (occupancy 0x18) dent their four
   corners −1.0 in the same walk; the dist/zone reads are transposed
   with clamps against the write, which on the square map makes both
   land on the vertex's own tile.
4. **Lake dents**: every 0x80 tile takes −0.5 on its corners and leaves
   the smoothing mask.
5. **Craters** (`0xED0240`): an INFERNO town sets every vertex within
   8.0 (of the position minus one) to their average −1.0; the INFERNO
   dwellings (BuildingType 0x48..0x4B — DemonGate, ImpCrucible, Kennels,
   the military post) do the same within 2.5 at −2.5.
6. **The footprint flatten** (`0xED06D0`, runs twice — before the first
   smooth and after the second): every non-static floor-0 object zeroes
   the mask under its rotated footprint (shared blockedTiles + the FIRST
   activeTiles entry, quarter-turned by `0xABE1D0` — x87 round-half-even
   of rot/(π/2)+0.25) and sets the footprint's closed vertex set to its
   average. The closure appends, through two STLPort hash_maps whose
   bucket order fixes the vector, one vertex BELOW each column's lowest
   and one RIGHT of each row's rightmost — the sanctuary's flat set is
   what proved the axes. ACADEMY towns and the ACADEMY dwellings
   (BuildingType 0x51, 0x55..0x57) hover and are skipped.
7. **Smooth ×2** (`0xEB2580`, kernel 0.8 centre / 0.025 neighbours),
   the mask refilled to all-ones between them.
8. **The lake flood** (`0xECFE40`): each 8-connected 0x80 body is set,
   all four corners of every member tile, to its corner minimum −0.1.
9. **Smooth #3** (kernel 0.2/0.1), mask = ones minus the footprints —
   which is why the flattened sets survive to the file exactly.

**The arithmetic is the EDITOR's x87, and the file proves it.** The
game's SSE codegen does the kernel per-tap in single precision, which
drifts a constant-9 neighbourhood by +1.9e-6 per 0.8-pass; the reference
holds 4,414 vertices at EXACTLY 9.0. The editor keeps intermediates on
the x87 stack (53-bit precision) and rounds ONCE at each store — a sum
of nine f32 products is exact in double, so the plateau comes back
bit-perfect. The port therefore computes every chain in double over f32
operands and rounds only into the plane — the same law the road wave
established, now governing a whole file plane. The object positions'
engine order is (+0x44, +0x48) = the port's (y, x) — the same (a, b)
convention the town centres already used.

The water and underground runs replay through the same functions with
NOTHING water- or floor-specific added: the base field reads the
carve-adjusted border table and the post-carve zone grid (a sea tile's
zone is -1, so no race flip, and its negative dist term digs below the
plateau), and the underground map's floor-0 plane is the same machinery
over its own grids — the town-object floors decide which towns the
craters and flattens see (`towns.ts` now records the floor). The shared
full-run driver `tools/rmg-run.ts` is what collects the object list in
slot order for all three runs — and is the emitter's foundation. Still
separate: the ground-flags/passability planes, a reverse target on the
save path.

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
npm run test-rmg-dwellings # the dwellings step live in zone 1: 8 draws to the boundary, ImpCrucible on its tile
npm run test-rmg-upgrade-shrines # upgrade buildings' zero-draw exit and shrines live to 18579; the townless budgets by arithmetic
npm run test-rmg-price-lists # resource, treasury, luck/morale and shops live to 18653, ten objects on the reference tiles
npm run test-rmg-treasures # the zone tail live to 18662: one observatory, below(9)=6 -> Ore, chests a no-op
npm run test-rmg-road      # the WHOLE first loop of MainObjects live: four zones, every boundary, to 20039
npm run test-rmg-roads-phase # the roads phase live: both loops, all four zones, to 20420
npm run test-rmg-statics   # the statics live: eight boundaries to 89798, 1325 objects on the reference tiles
npm run test-rmg-treasure-blocks # the treasure blocks live: growth and fill per zone, to 92438 — the whole run
npm run test-rmg-road-painter # the road painter: all seven GroundTerrain.bin layers byte-identical
npm run test-rmg-underground # the WHOLE two-floor run: the carve, the lakes for real, 1423 objects to 70799
npm run test-rmg-heights   # the height plane: all three references' floor-0 planes, bit for bit
npm run test-rmg-emit      # the map.xdb emitter: all three documents, byte for byte
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

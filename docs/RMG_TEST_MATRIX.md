# The RMG test matrix

What to put to the engine, and why those and not others. The two tables below
are GENERATED — `node tools/rmg-matrix.ts tables` prints them from the shipped
templates themselves, so a change in the data shows up here rather than being
quietly out of date. `node tools/rmg-matrix.ts orders <block>` prints the orders
that go with them, in the form `tools/rmg-batch.ts --orders` reads.

**How a row is checked.** One order, one editor launch (a launch's second
generation does not repeat what its first would have made alone — see
`tools/rmg-batch.ts`), then `tools/rmg-diff-map.ts` on the folder it left. The
map carries its own order in `sRMGProps`, so nothing has to be typed twice and
nothing can be compared against the wrong seed. A row PASSES when every entry
of the archive is byte-identical; anything else is a divergence with a named
first byte.

**Why three seeds.** One seed proves a path, not a rule: a placement that
happens to fit on every candidate, a roll that never lands near a threshold and
a zone that never touches its neighbour all look like agreement. Three is the
cheapest number that has actually caught things here — the class veto took a
second seed to find a contested tile, and the whole-level room recompute took an
eighth.

**What the blocks are for.** The parameters split in two. Those that change the
map's SHAPE — template, size, players, underground, water — have to be swept per
template, because each template's zones, sizes and races reach different code.
Those that only SCALE its contents — monsters, resource, exp — feed multipliers
that every template shares, so one template each is enough and two is
generosity.

### The templates, and what an order may say to each

| template          | zones | players | MinMapSize | smallest, 1 floor | smallest, 2 floors |
|-------------------|-------|---------|------------|-------------------|--------------------|
| S0-1P2Z2K3.1T     | 3     | 2..2    | 4          | 72                | 72                 |
| S0-1P2Z2K3.2T     | 4     | 2..2    | 4          | 72                | 72                 |
| S0-1P2Z2K3T       | 2     | 2..2    | 2          | 72                | 72                 |
| S1-2P2-4Z4K1S     | 4     | 2..4    | 5          | 72                | 72                 |
| S1-2P2-8Z8K2S     | 8     | 2..8    | 10         | 96                | 72                 |
| S1-2P2Z7V2        | 7     | 2..2    | 12         | 136               | 96                 |
| S1-3P2-4Z5V       | 5     | 2..4    | 10         | 96                | 72                 |
| S1-3P2Z7V3        | 7     | 2..2    | 12         | 136               | 96                 |
| S1P2Z2M1          | 4     | 2..2    | 5          | 72                | 72                 |
| S1P2Z3K5.1        | 3     | 2..2    | 5          | 72                | 72                 |
| S2-3P2Z7N2        | 7     | 2..2    | 20         | 176               | 96                 |
| S2-4P2Z7B2        | 7     | 2..2    | 20         | 176               | 96                 |
| S3-4P2-4Z4K1M     | 4     | 2..4    | 28         | 176               | 136                |
| S3-5P2-8Z8K2M     | 8     | 2..8    | 30         | 176               | 136                |
| S3-5P2Z7N2.2      | 7     | 2..2    | 30         | 176               | 136                |
| S3-5P4Z12B4       | 12    | 2..4    | 28         | 176               | 136                |
| S3-6P2-4Z9B3      | 9     | 2..4    | 28         | 176               | 136                |
| S4-6P2-8Z8K2L     | 8     | 2..8    | 36         | 216               | 136                |
| S6-11P2-8Z8K2.4a  | 8     | 2..8    | 60         | 256               | 176                |
| S6-11P2-8Z8K2XL   | 8     | 2..8    | 60         | 256               | 176                |
| S7-15P2-8Z9K2.4b  | 9     | 2..8    | 70         | 320               | 216                |
| S7-22P2-8Z15K2.4c | 15    | 2..8    | 70         | 320               | 216                |

### The parameters, and the values each takes

| parameter    | how an order says it    | values                                                                                                         |
|--------------|-------------------------|----------------------------------------------------------------------------------------------------------------|
| template     | the order's first word  | 22 shipped, as a path under RMG/Templates                                                                      |
| seed         | -seed                   | any int32 but 0 — the dialog draws it, the console may name it                                                 |
| size         | -size                   | 0..6 = 72, 96, 136, 176, 216, 256, 320 (TINY/SMALL/MEDIUM/LARGE/EXTRALARGE/HUGE/IMPOSSIBLE), lifted by the fit |
| players      | -players                | the template's MinPlayers..MaxPlayers, clamped again by the map                                                |
| underground  | -underground            | 0 or 1 — the ORDER decides the second floor, never the template                                                |
| water        | -water                  | 0..2 = WATER_NONE, WATER_PRESENT, WATER_ISLAND_MAP — the dialog orders 0 or 2; 1 comes only from the coin      |
| monsters     | -monsters               | 0..4 = WEAK, MEDIUM, STRONG, VERY_STRONG, IMPOSSIBLE                                                           |
| resource     | -resource               | 0..4 = MISERABLE, LITTLE, NORMAL, LOTS, MUCH                                                                   |
| exp          | -exp                    | 0..4 = MISERABLE, LITTLE, NORMAL, LOTS, MUCH                                                                   |
| random towns | dialog, or -pokeb 149 1 | on/off — a race per town, hashed from its name; ported, byte-exact. The players' races are an input            |
| grail        | dialog, or -pokeb 165 1 | on/off — a Graal and one obelisk pass per zone; ported, byte-exact                                             |

### The blocks, and what each costs

  A    66 runs — every template, smallest size, one floor
  B    66 runs — every template, two floors
  C   114 runs — every template, one size up and the largest
  D    66 runs — water 2, every template — already run on two seeds
  E    36 runs — players min and max, where the range is wider than one
  F    72 runs — monsters, resource and exp across all five rungs, two templates
  =    420 runs in all (rows x 3 seeds), one editor launch each

## Running a block

```
node tools/rmg-matrix.ts orders A > _tmp/matrix-A.txt
node tools/rmg-batch.ts --game <dir> --orders _tmp/matrix-A.txt --keep _tmp/matrix-A
for i in $(seq 1 66); do node tools/rmg-diff-map.ts --game <dir> _tmp/matrix-A/$i; done
```

A run takes about a minute at 96 tiles and about two at 256, so a block is
measured in hours and the whole matrix in most of a day. The editor holds the
display while it runs; nothing else should be using it.

## What has been measured so far

Not the matrix — the corpus that grew out of the port itself, which the matrix
is meant to replace with something systematic:

- every map the GAME generated into `game/H5E/` (17 archives, 20 to 26 entries
  each) byte-identical, except `ГСК-001`, whose archive was saved after being
  painted on in the editor;
- all 22 shipped templates at their smallest size, one floor — block A's shape,
  one seed each rather than three;
- eight seeds of `S1P2Z2M1 -underground 1`, and six two-level orders on
  `S1-2P2-8Z8K2S`, `S2-3P2Z7N2`, `S1P2Z3K5.1`, `S3-5P2-8Z8K2M`, `S3-6P2-4Z9B3`
  and `S1-3P2Z7V3` from small to large — block B's shape;
- nine size probes across the fit's rungs and both floor counts — block C's
  shape, and what the fit was read from;
- water: all 22 templates with `-water 2`, on TWO seeds (`bin/rmg-water/`,
  `bin/rmg-water2/`), 44 of 44 byte-identical — block D in full, two seeds of
  its three; the second seed is what found the `%g` exponent padding, the
  editor's x87 `betweenFloat` and the shipyard's ship test (`RMG.md`, "The
  water sweep, first run"). `-water 1` is not a
  row: the dialog cannot order it;
- **block E, run as written (12.09.2026)**: 36 of 36, after two of them were
  not — `S7-15P2-8Z9K2.4b` at seed 1001 (two objects minted one name; the
  engine's second creation replaces the first's document) and
  `S7-22P2-8Z15K2.4c` at seed 2002 (`Math.hypot` an ulp under the engine's
  `sqrtss`, one room candidate short). Both in `RMG.md`'s 12.09 entry; the
  orders are `tools/rmg-matrix.ts orders E`, the maps in `_tmp/matrix/E/`;
- **block F, run as written (12.09.2026)**: 72 of 72, first time — the four
  multiplier rungs nobody had ordered, on both templates, three seeds.

So every block has been run: A, D, E and F in full, B and C as a sample rather
than a sweep. What the runs found is in `RMG.md` under the dates; the matrix
itself has no red cell left, and the next divergence will come from an order
nobody has typed — a two-level order on a template B did not reach, a size C
did not.

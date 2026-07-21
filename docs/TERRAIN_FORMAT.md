# GroundTerrain.bin — format notes

Reverse-engineered from data: all 232 shipped maps, plus clean samples authored
in the original editor specifically to isolate one mechanic at a time. Every
claim below is backed by a measurement, and the numbers are quoted so they can
be re-checked.

Reader: `src/terrain.ts`. Writer: `src/terrain-blank.ts` (from scratch),
`writeTerrain` in `src/terrain.ts` (in-place edits). Consumer: `src/scene.ts`.

---

## Container

A stream of self-describing arrays. Each is introduced by a framing group:

```
01 08 <u32 W>      dimension marker
02 08 <u32 W>      the same value again
03 <u32 sizeB>     length: len = (sizeB - 1) / 2
<len bytes of data>
```

`W` is the grid side **in vertices**. For a map of `T` tiles the main grid is
`V = T + 1`, but **not every plane lives on it** — see the river plane, which is
`W = 2V − 1`. A parser that only looks for `V²`-sized arrays silently skips data;
that cost a lot of time here.

### Exact byte layout (framing, header, sizes)

The reader above only needs to *locate* planes, so it ignores the bytes between
them. Writing a file from nothing needs all of it. Decoded from pristine blanks
the original editor exports at every size, cross-checked to be byte-identical:

**Anchor + size prefix.** Each array's size prefix is `sizeB = 2·byteLen + 1`
(`03 <sizeB:u32>`). Immediately before most arrays sits a **block wrapper** that
scopes the array *and* its framing:

```
<tag:u8> <2·byteLen + 35 : u32> 01
```

`+35 = 2·17 + 1` — it wraps the 17 framing bytes (16-byte anchor + the trailing
`01`) around `byteLen` of data. The `<tag>` bytes run in a fixed order for a
given structure (`02` first mask, `05` height, `07`/`08` the u8 planes, `0a`
water, `0d`/`0e`/`0f`/`10` in the trailer) — field indices, in effect. A texture
mask is additionally followed by its tile-path string:
`03 <2·(len+2):u8> 03 <2·len:u8> <path>`.

**Header (50 bytes).**

```
04 08 <04000000>      format tag + layer-format marker (=4)
01 <A:u32>            A = 2·fileLen − 33   (whole-file running size)
01 <B:u32>            B = A − 10
02 08 <tiles:u32>     TileX
03 08 <tiles:u32>     TileY
04 <D:u32>            D
02 08 <numLayers:u32> count of texture-mask layers
01 <E:u32>            E
02 <F:u32>            F = 2·N + 35
01
```

`A`/`B` count bytes to the file end; `D`/`E`/`F` are counters keyed off `N`. For
the fixed **blank** structure they close to `D = 2N + 201`, `E = 2N + 179`,
`F = 2N + 35` (fitted and verified across all seven sizes). In a general map
`D`/`E`/`F` are cumulative sub-tree sizes, so they also depend on layer count and
string lengths.

**The trailer.** After the last plane comes a trailer. In an *edited* map it is
another framed array on a **coarse `d × d` grid**, `d = round((V−1)/3) + 1`
(73→25, 97→33, 137→46 …), whose data is **content-independent** — an identical
synthetic ramp (`i·67 mod 256`) in every map, blank or shipped — so it reads as a
default LOD layer the engine fills, not authored data. A **fresh blank** instead
carries a fixed **51-byte** trailer (three empty framed sub-blocks + the end
marker `00 00 02 00 05 00`).

## Planes, in order

| plane | type | size | meaning |
|---|---|---|---|
| texture masks | u8 | V² | one per layer, weight 0–255; an ASCII path to `(AdvMapTile).xdb` follows |
| **height** | f32 | V² | the only f32 plane |
| **ground flags** | u8 | V² | first u8 plane AFTER height — the key to everything |
| reserved | u8 | V² | all zero on every map seen |
| **river plane** | u8 | (2V−1)² | half-tile grid, graded values |
| passability | u8 | V² | 0/1 |

Indexing is `y * W + x` throughout.

---

## Heights are discrete levels, not a field

The ground is built from **flat steps**. Share of cells whose four corners sit at
one height: **92.5%** (map 12), 68.8% (A1M5), 12.3% (A2C2M3 — smoothing was used
there).

Reference values:

- **`2.0` is the DEFAULT ground level**, not sea. On map 12 that is 4730 of 5329
  vertices. Mistaking 2.0 for sea level produced two wrong models before the
  authored sample settled it.
- **`0.0` is a bed dug by `lower`.** Always exactly 0.
- **`1.6` is the shore ring** the editor lays between bed and ground (90 vertices
  on map 12). It is the waterline.

The fill level is **not recorded** in the format. We use `1.5`, just under the
ring — at 1.6 the shore submerges: 92 vertices below water against 32 above,
versus 122 above and 2 below at 1.5.

## Ground flags — the key

```
0   water          (lower dug the bed to 0 and marked it)
16  ordinary ground
32  plateau
bit 3 (8)   ramp   — a deliberate walkable incline
bit 6 (64)  appears on the steepest ground
```

Evidence:

- **Flag 0 is sea.** 59 of 232 maps carry it, and height under it is always
  exactly 0. The names corroborate: `BoatArena` is 100% flag 0,
  `SmallSpecialArena_Sea` 66.7%, every `Beach_*` 43–53%, `Grass_Lake` 15.8%.
- **Bit 3 is ramp.** Vertices carrying it sit on a slope essentially always:
  flag `8` 100%, `24` 97.4%, `56` 100% — against 38.3% for plain ground `16`.
- On the authored map 12 the correspondence is exact: flag 0 covers precisely the
  49 vertices at height 0, flag 32 precisely the 50 at height 5.05.

### A cut is a change of ground KIND, not steepness

This is the central finding and it is not obvious. **Every** cell straddling a
kind boundary carries a step of ≥ 0.8: **200 of 200** (map 12), **216 of 216**
(A1M5), **16 of 16** (A2C2M3). Meanwhile cells wholly inside one kind reach
**12.4** of relief and are still smooth hillside.

So a hill that was raised and then smoothed must NOT be cut, however much
steeper its slope is than a cliff's. Judging by height wrecks the terrain: by
that criterion A2C2M3 turned into a staircase across 25.2% of its cells, against
roughly 4% real cuts.

The rule: **cut where water meets land or a plateau meets ground.** Ramps stay
smooth even across a boundary.

### Cuts are not level

A plateau dropped onto uneven ground inherits that unevenness — the cut flows
with the terrain, and raising one side of the plateau raises the cut with it.
Flattening a cell's two sides to mean heights therefore produces rectangular tabs
studding the rim. Corners keep their own heights, and each break point carries
**two** heights: where the upper surface meets it and where the lower one does.

---

## Two unrelated kinds of water

Easy to conflate, and conflating them sends the whole model sideways.

**Rivers** are texture brushes (`Bog`, `LavaFlow`, `Water` — the Rivers category
in the original editor) plus a dedicated **plane on a half-tile `(2V−1)²` grid**.
Its values are graded (255 in open water, small along the edge), which is what
gives soft shorelines. It agrees with the water tile texture on 91.7% of
vertices against 2.7% elsewhere.

**Sea** is flag 0 — a dug basin. It has nothing to do with the river plane.

Map 12 separates them: it has sea while its river plane is **entirely empty**.

## The water textures pair up the same way

| file | colour | addressing | role |
|---|---|---|---|
| `Water.dds` | `[0,15,15]` dark | **CLAMP** | the **sea's** sheet |
| `Water_TNL.dds` | `[0,64,79]` blue | WRAP | the **river** brush |
| `Bog_TNL` / `Lava_TNL` | `[59,69,18]` / `[154,42,11]` | WRAP | bog / lava |

The `_TNL` suffix marks a tiling brush. `Water.dds` is CLAMP, so it cannot tile
and was never a brush. The `Water.xdb` tile nevertheless points at it, so a tile
resolving to a CLAMP texture takes its `_TNL` sibling instead.

---

## Rendering (`src/scene.js`, `renderer/app.js`)

- **Layers composite by the tile's `<Priority>`** rather than being averaged.
  Priority is a real paint order: grass 10–14, roads 111–113, rocks 193–210,
  river bed 277. Averaging washes everything out — grass at weight 255 over
  ground at weight 255 yields 50/50 mud. Compositing took green-dominant pixels
  from 26.5% to 51.3%.
- `<MinimapColor>` is a fallback only. It gets the hues right and the detail
  entirely wrong.
- **Box-filter textures when downsampling.** Point sampling 1024→256 discards
  15/16 of the image and turns grass and gravel into noise.
- Cliffs use `Terrain/Rock.dds` projected sideways; projected downward it smears
  into streaks along the face.
- **Do not tag textures `SRGBColorSpace`** while the shader is custom. The GPU
  then decodes them to linear on sample and nothing encodes back: a 0.255 grey
  arrives as 0.053 and a cut face renders at rgb 19 instead of 94. That was the
  "black cliffs".

---

## Debugging

`tools/view-terrain.js <map.xdb> out.html` builds a standalone viewer that
**lifts the shader straight out of `renderer/app.js`** and exposes `measure()`,
which reads pixels back from the framebuffer and reports mean colour plus the
share of dark/mid/bright pixels.

This is not a luxury. The "why are the cliffs black" question was answered three
times by reading the shader, plausibly and wrongly each time. Measuring settled
it immediately.

Caveat: the viewer lifts the shader but **not the material setup** — which is
exactly the gap the `colorSpace` bug hid in. Worth pulling material creation in
as well.

## Synthesizing a file from scratch (New Map)

`src/terrain-blank.ts` (`buildBlankTerrain(tiles)`) writes a complete blank
`GroundTerrain.bin` for any New Map size (72…320), byte-for-byte identical to the
editor's own output. A fresh map is the **simplest** instance of the container:

```
header(50)
  Grass mask   (u8,  N)   all 0xFF   + Grass tile path        (a single layer)
  height       (f32, N)   all 2.0
  ground flags (u8,  N)   all 16     (tier 1, ordinary ground)
  zero plane   (u8,  N)   all 0
  water        (u8,  W²)  all 0
trailer(51)
```

Only `N`, `4N` and `W²` scale, so the whole file is exactly `fileLen = 272 + 7·N
+ W²`. The editor's output is **byte-deterministic** (two same-size blanks are
equal), which is what makes a byte-exact generator possible. `npm run
test-terrain-blank` checks each size is a well-formed, flat container and — given
pristine blanks via `HOMM5_BLANKS` or a dir arg — that all seven are identical.

> **Open question.** One early two-level Tiny "blank" carried the *full*
> multi-layer form (a `Dirt/DarkGround` base under Grass and the big coarse
> trailer) though it was never painted; every other fresh blank has the simple
> structure above. The trigger for the richer form isn't pinned down (it is not
> the paint brush). The **simple structure is the canonical New Map output** and
> the one we generate.

## Not implemented

- **Adding a texture layer to an existing map** — inserting a new mask array plus
  its tile-path string into the stream and recomputing the cumulative header
  counters. Editing an existing layer's mask, heights and flags is done
  (`writeTerrain`), and creating a whole blank file is done
  (`buildBlankTerrain`), but growing the layer set of an authored map is not.
- **`UndergroundTerrain.bin` for a from-scratch second floor** — same container,
  wired up when New Map's "two level" option is built.

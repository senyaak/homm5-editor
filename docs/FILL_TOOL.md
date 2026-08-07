# The fill tool

Painting an area and turning it into a wood: the original editor's **Fills**
tab, read out of `bin/H5_MapEditor.exe`, and what ours does with it.

A fill is not a map feature. Nothing in a `.h5m` says "there is a wood here" —
the tool plants ordinary `AdvMapStatic` objects and forgets it was ever
involved. That is why the painted area is scratch state on our side too
(`renderer/features/fill.ts`) and why the whole fill is a single undo step: the
gesture was one click, and what it left behind is a few hundred trees.

## Where the recipes live

`<game>/Editor/FillPresets.xml`, loose on disk beside the game rather than in a
pak, loaded into an NDb table the binary calls `FillPreset`. The shipped file
holds nine presets, all named `…(test)`, most of them one layer deep. Ours adds
`assets/fill-presets.xml` in the same format — the parser (`src/fill/preset.ts`)
reads either, and a preset moved between the two files behaves identically.

The fields, from the original's own field registration (0x5274b0 for a
candidate, 0x527cb0 for a layer):

```xml
<Presets><Item>
  <Name>Birch Wood</Name>
  <Layers><Item>
    <objects><Item>
      <Object><Type>AdvMapStaticShared</Type><ID>Grass\Tree\Birch\Birch01</ID></Object>
      <Size>0.6</Size> <Probability>0.35</Probability> <NoRandomAngle>false</NoRandomAngle>
    </Item></objects>
    <Dispersion>1</Dispersion> <Width>0.75</Width> <NoRandomAngle>false</NoRandomAngle>
  </Item></Layers>
</Item></Presets>
```

| field | offset in the original's struct | what it means |
| --- | --- | --- |
| `Dispersion` | layer +0x14 | grid spacing in tiles — smaller is denser |
| `Width` | layer +0x18 | how much further from the edge the **later** layers start |
| `Size` | candidate +0x10 | radius in tiles, kept clear of the edge and of other objects |
| `Probability` | candidate +0x14 | chance a lattice point keeps its candidate |
| `NoRandomAngle` | +0x04 on both | stand it at its authored facing |

`ID` is a path under `MapObjects` with Windows separators and no extension; the
file is `<ID>.(<Type>).xdb` and the reference a placed object carries is that
path with `#xpointer(/<Type>)` on the end.

## What the tool does

The brush (0x48fd60) marks tiles into a scratch mask — x1/x3/x5/x7 or a dragged
rectangle, with `GetAsyncKeyState(VK_SHIFT)` deciding paint from rub-out. The
work is one function, `0x490a70`, and it runs like this:

1. The mask becomes an outline: corners XOR'd across the marked cells
   (0x490420, a marching-squares pass) plus the bounding box. A mask that is not
   one simply-connected blob is refused outright — *"Selection has holes or
   selection is more than one region!"*.
2. Layers are applied **last first**.
3. Layer `i` is held clear of the edge by `Σ Width[j], j < i` — every EARLIER
   layer's width, not its own. That is what makes a preset read as bands: grass
   at width 0 covers the whole patch, bushes start half a tile in, trees a
   further three quarters.
4. Candidates sit on a regular lattice of the layer's `Dispersion`, starting
   half a step in from the bounding box. There is no jitter: the scatter comes
   entirely from the draw and the two rejections below.
5. At each lattice point, in this order:
   - draw a candidate from the layer, uniformly (`Probability` does **not**
     weight this draw);
   - reject if the distance to the outline is `<= inset + Size`;
   - reject with probability `1 - Probability`;
   - reject if some already-placed object `p` has `distance * 0.9 < Size` or
     `distance * 0.9 < p.Size`. First come, first served — which is why the
     layer order in (2) matters.
6. Survivors are placed: a random group resolves to a member, the facing is
   drawn from steps of 22.5°, and the whole batch goes down as one operation.

## What we do differently

Three deliberate departures, all in `src/fill/plan.ts`:

- **Sixteen facings, not fifteen.** The original draws `rand() % 15`, multiplies
  by π/8, and so can never produce the sixteenth step of a full turn.
- **The whole group, not all but one.** Picking a member of a random group is
  `rand() % (count - 1)` in the original, so the last member is unreachable.
- **Holes and separate blobs are allowed.** The original needs a single closed
  contour to walk. Ours measures the distance to the painted area's own cell
  SIDES, which needs no contour: a ring keeps its clearance from the inner rim
  as much as from the outer one, and two blobs painted in one go both fill.

Everything else — the ordering, the accumulated widths, the uniform draw, the
0.9 slack on the clearance — is kept, because it is what makes a preset written
for the original look the way it was meant to.

## Where the code is

| file | what it holds |
| --- | --- |
| `src/fill/preset.ts` | the file format, and the href a `Type` + `ID` names |
| `src/fill/plan.ts` | the algorithm: painted cells + preset + seed → placements |
| `electron/channels/fill.ts` | which presets this machine has, and placing the plan |
| `renderer/features/fill.ts` | the panel, the brush, the outline on the ground |
| `tools/test-fill.ts` | the rules, checked against an independent geometry pass |
| `e2e/fill.spec.ts` | the whole stack, driven through the window |

Planning is deterministic in (cells, preset, seed). The panel draws a fresh seed
per click, so two fills differ; a test pins one down and gets the same wood
every time.

# SLICE — Painting over an object-heavy map: the counters agree, the file does not

> **Status:** narrowed 2026-07-29. What blocked the release is fixed and green —
> see [docs/E2E_RECONSTRUCTION.md](docs/E2E_RECONSTRUCTION.md) for the two causes
> (a brush gate that lied, and a chain that painted ground under objects it had
> not placed yet). This file keeps what is left over, which no longer blocks
> anything and is no longer reproduced by the suite.

## 1. What is left

Stage 4 was re-run several times over the map a previous run had finished —
2600 objects on it, all twelve texture layers present. With the gate fixed it
still came out wrong, and this is the part that is not explained:

- The brush's own counters agreed exactly, every layer: `asked = painted =
  sent`, `refused 0`. So every click reached the brush, painted a vertex, and
  was handed to the main process.
- The file disagreed all the same — around 5300 vertices over 8 layers.
- The shape of the disagreement is **displacement, not loss**: `used_grass` lost
  255 at exactly 99 vertices and gained it at exactly 99 others. `stoneroad`
  gained 68 vertices of 255 in a line, and lost none.
- Best whole-map alignment between built and fixture is 0,0 — so it is not one
  uniform shift of everything.

Counters cannot see this: a click that lands on the wrong vertex is still a
vertex painted and sent. The same stage from a blank map is exact, 128 971
strokes, so whatever this is needs a heavy map.

## 2. Where to look

- `vertexAtClient` → `groundPointAtClient`: under the plan camera the ground
  point is arithmetic, not a raycast, and was measured exact for all 9409
  vertices — on a light map. Worth repeating on a populated one.
- Whether the view moves mid-stage. `e2e/c1m1/004-textures.spec.ts` now checks
  this per layer (`whereIsIt`) and never fired from a blank map; it has not been
  run to completion over a populated one.
- Whether a stroke can be committed with a strength read after the value moved
  on — the stage changes `#tilestrength` between groups.

## 3. Why it still matters

The suite no longer paints over a populated map, so nothing here is on the
critical path. But a PERSON does exactly that — opens a finished map and
retouches the ground — and if a click can land on a neighbouring vertex there,
that is a real defect with no test covering it.

Cheapest repro: copy the finished reconstruction aside, open it, paint a known
block of vertices with the burst helper from `e2e/paint-burst.spec.ts`, and read
the mask back. Minutes, not the 20 a full stage costs.

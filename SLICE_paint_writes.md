# SLICE — Three quarters of the vertex writes never arrive

> **Status:** found and measured 2026-07-29, not diagnosed. The C1M1 texture
> stage paints 112,908 vertices and the saved file holds a fraction of them.
> Nothing about painting has changed since 23 July, and the chain had not been
> run since, so this has been broken for about a week without anyone seeing it.
> **It blocks the release of 0.5.0** only in the sense that the suite is red:
> the tag `v0.5.0` already exists, its CI run failed on an unrelated flake since
> fixed, and the plan is to re-point that tag once this is green rather than to
> burn a version number.
> When it ships, fold the finding into
> [docs/E2E_RECONSTRUCTION.md](docs/E2E_RECONSTRUCTION.md) and retire this file.

Reading first: [docs/E2E_RECONSTRUCTION.md](docs/E2E_RECONSTRUCTION.md) (what
the chain proves and how a stage is written),
[docs/TERRAIN_FORMAT.md](docs/TERRAIN_FORMAT.md) (what a texture layer is).

---

## 1. Scope

1.1. **In:**

- а) **Find where a click's write is lost.** Three places it can go: the click
  never reaches the canvas handler, the handler paints but the commit to the
  main process is dropped or coalesced away, or the write lands and something
  later overwrites it. Each is a different fix and the measurement below does
  not tell them apart.
- б) **A repro that costs seconds, not eleven minutes.** The stage is the
  symptom, not a test: paint N vertices with known values through the same
  helpers, read the file back, count. Something like `tools/test-paint-burst.ts`
  driving the window, or a `@nodata` spec small enough to keep.
- в) **Fix it.** Then C1M1 stage 4 and everything after it (`005`…`014`) run
  again, which is the actual proof this project rests on.
- г) **A guard that fails fast.** Whatever the cause turns out to be, the cheap
  repro from (б) stays in the suite, so the next regression costs one minute
  rather than a week of nobody noticing.

1.2. **Out (deferred — "потом"):**

- а) Making the stage faster. Eleven minutes for 112,908 clicks is the price of
  driving the real UI, and it is not what is wrong here.
- б) Batching the paint API so a stage can write many vertices in one call.
  That would hide this bug rather than fix it — the point of the chain is that a
  person's gestures produce the map.

## 2. Why — what was measured

2.1. **The stage runs to the end and reports its work.** Twelve layers, 112,908
vertex writes, no error, no timeout. Save is pressed, the Save button goes
disabled, the file is read back.

2.2. **The file holds a fraction.** Per layer, non-zero values in the built file
against the fixture it is compared with:

| layer | individual clicks | built | fixture |
| --- | --- | --- | --- |
| road (rect at 255) | 0 | 9409 | 9409 ✔ |
| dirt/ground | 103 | 103 | 103 ✔ |
| grass/dark_grass (rect at 255) | 4820 | 5123 | 5123 ✔ |
| grass/grass | 4083 | 3187 | 4083 ✘ |
| grass/flowers | 2005 | 518 | 2005 ✘ |
| grass/used_grass | 3009 | 817 | 3009 ✘ |
| grass/field | 498 | 143 | 498 ✘ |
| sand/river-bed | 726 | 104 | 726 ✘ |
| water/water | 502 | 69 | 502 ✘ |
| grass/stoneroad | 308 | 68 | 308 ✘ |

2.3. **The two that look clean are the two that cannot show it.** `road` and
`dark_grass` were filled by their rectangle at 255, so a lost click changes a
value rather than leaving a zero, and counting non-zeros sees nothing. The
layers whose rectangle was 0 show the loss directly: roughly **three quarters of
individual vertex writes do not reach the file**, at every size from 308 clicks
to 4083.

2.4. **A rectangle drag always lands.** Every `rect` write is exact. Whatever is
lost is lost per click, not per stroke.

2.5. **Not from the work of 2026-07-28/29.** `src/terrain.ts`,
`src/terrain-layer.ts`, `e2e/tiles.ts` and the stage itself were last touched on
22–23 July; that day's changes are the mod folder, the map picker, the dialogs
and the paths. The chain simply had not been run since — which is its own
lesson, and why `maxFailures: 1` and a full run before a tag are now the rule.

## 3. Model — where a painted vertex goes

```
click on the canvas          renderer: paint into the GPU mask, queue a commit
   → pendingCommits          renderer: batched, awaited by settle()
      → IPC paint            main: writes the bytes it owns
         → Save              main: the file
```

Each arrow is a place a write can vanish, and the measurement above is taken at
the end of the last one. The first suspect is the middle: the queue is the only
part that deliberately drops work (it coalesces), and it is the only part whose
behaviour depends on how fast the clicks arrive — which is exactly the variable
here.

## 4. Touchpoints

| File | Why it is in the picture |
| --- | --- |
| [renderer/app.ts](renderer/app.ts) | The canvas handler, the paint path and `pendingCommits` — the queue and whatever coalesces it. |
| [e2e/tiles.ts](e2e/tiles.ts) | `clickAt`, `settle`, `armBrush` — the harness half of the same question. |
| [src/terrain.ts](src/terrain.ts) | Where the bytes are written; the last place a value could be overwritten. |
| [e2e/c1m1/004-textures.spec.ts](e2e/c1m1/004-textures.spec.ts) | The symptom, and the thing that goes green when this is fixed. |
| a new cheap repro | §1.1(б) — the thing that should have caught this in July. |

Verification is the stage itself, once: the fixture's twelve layers must match
the built file exactly, which is what it already asserts.

## 5. Open questions (need a call before code)

5.1. **Is the loss in the renderer or in the main process?** A counter on both
ends answers it in one run: how many paints the renderer performed against how
many the main process applied. Do this before reading any code.

5.2. **Does it depend on rate?** The stage clicks as fast as Playwright can. If
a small delay between clicks makes the loss go away, the answer is a queue that
drops under load, and the fix is in that queue — not in the handler.

5.3. **How long has it been broken?** Checking the same stage at `v0.4.0` and
`v0.3.0` costs eleven minutes each and would say whether this arrived with the
terrain-panel refactor (`b83a74e`, 23 July) or earlier. Worth it only if the
cause is not obvious from 5.1.

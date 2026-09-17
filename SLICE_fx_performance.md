# SLICE — What the particle effects cost, and what to do about it

> **Status:** measured twice — statically on 2026-07-28 (§1) and live on
> 2026-09-17 (§1a, `e2e/fx-perf.spec.ts`) — and the plan REWRITTEN on the live
> numbers. Playing an object's baked effect works and looks right
> ([docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md)); what it costs is now
> known: the frame is CPU-bound, and the effects are a third of it. The plan
> (§3) is three steps, each smaller than the one it replaces: stop spreading
> phases, draw every copy of an effect from one simulation, and put the
> recording on the GPU so the simulation is a lookup. Nothing is built yet.
> When it ships, fold the surviving facts into
> [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) and retire this file.

Reading first: [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) (what the data
is and why playback is interpolation, not simulation),
[renderer/viewport/particles.ts](renderer/viewport/particles.ts) (one playing system),
[renderer/viewport/fx.ts](renderer/viewport/fx.ts) (`loadFx`, `advanceFx`),
[renderer/viewport/instancing.ts](renderer/viewport/instancing.ts) (how the
static objects already draw every copy of a model in one call) and
[renderer/viewport/perf.ts](renderer/viewport/perf.ts) (`view.perf()`, the
instrument).

---

## 1. The measurement

A2S1 unpacked under `data-unpacked/`, scene built through `buildScene` with
animation off — the same path `map:load` takes. Counted statically: how many
systems the renderer would create, and the sizes `createFxSystem` derives from
each baked effect.

| | effects | all the rest of the scene |
| --- | --- | --- |
| draw calls per frame | **607** (surface; never culled) | 831 |
| triangles | negligible (quads) | 0.85 M |
| GPU buffer traffic per frame | **1.83 MB → ~109 MB/s at 60 fps** | 0 (static) |
| JS iterations per frame | **183 123** | 0 |
| textures | **1384 atlases = 644 MB** | shared per material |

Surface floor: 2731 placed objects, **607** particle systems. Underground: 150
objects, 85 systems. 692 systems over **128** distinct effects; the commonest
effect is placed **182 times**. Peak instance slots across all systems: 43 611
— so at the busiest moment ~24% of the particles scanned per frame are alive,
and usually far fewer.

Two more numbers from the same run: **3338** image decodes on load (each frame
of each system's texture table, twice — colour and alpha), and 5.7 MB of
particle texture data-URIs inside the 62.8 MB scene payload (only 1.1 MB of it
distinct, over 94 unique frames).

Reproducing it needs no repo change: build the scene, walk
`floors[].instances`, look up `geoms[inst.g].fx`, and for each payload redo the
sizing maths at the top of `createFxSystem` (`overlap`, `n = maxAlive *
overlap`) plus `bytesFor(textures.length)` from `buildAtlas`'s grid.

## 1a. The live measurement (2026-09-17)

`npm run test-e2e-fast -- e2e/fx-perf.spec.ts` — A2C1M1 opened in the real app,
five seconds watched with effects on and five with them off, on an RTX 3080 at
2434×1379 and pixel ratio 1.75. Readings land in `_tmp/perf/A2C1M1.json`.

| | effects on | effects off |
| --- | --- | --- |
| frame p50 / p95 / max | **19.1** / 20.6 / 30.2 ms | 11.9 / 13.5 / 16.7 ms |
| our JS of that (p50) | **18.7 ms** | 11.6 ms |
| … `advanceIdle` | 3.8 | 3.7 |
| … `advanceFx` | **4.3** | 0 |
| … `renderer.render` (three's CPU side) | **10.6** | 7.8 |
| draw calls | 861 | 557 |
| triangles | 647 k | 624 k |
| systems on the active floor | 313 | |
| instance slots / alive | 30 600 / ~11 900 | |
| atlases | **626, all distinct, 311 MB** | |
| memory (working set) | renderer 503 MB · GPU process 412 MB | |
| `map:load` | 11.6 s; effects ready 0.1 s later | |

What it settles:

* **The frame is CPU-bound.** JS is the whole frame; the GPU is waiting on us.
  Not fill rate, not SwiftShader (the adapter is checked and asserted).
* **Effects cost ~7 ms of 19: 4.3 in `advanceFx` and ~2.8 in `render`** for the
  ~300 extra draws (three's per-call CPU work). Both halves matter; neither is
  all of it.
* **The other 11.6 ms are not effects** — `advanceIdle` 3.7 and `render` 7.8 for
  557 calls (~14 µs a call, shadow pass included). Out of scope here, noted in
  §7 so it is not lost.
* **No long frames.** Nothing over 50 ms, so LoAF attributes nothing; the
  sections timer is the attribution.
* §2.1 confirmed: 626 atlases and not one shared. 311 MB rather than the 644 MB
  estimated statically (the estimate sized every system's full frame table).

## 2. Where the cost actually is

2.1. **644 MB of atlases where 76 MB would do.** `buildAtlas` runs inside
`createFxSystem`, which runs **per placement** — 182 campfires build 182
identical pairs of canvases. There are 79 distinct frame tables among the 692
systems. And the payload object is *literally shared*: `loadFx` reads
`geomFx.get(inst.g)`, one list per geom, so every copy of a campfire passes the
same `FxInstancePayload`. A cache keyed on that object is correct by
construction — no content hashing needed. This also accounts for the 3338 load
-time image decodes, which are awaited one after another on the main thread.

2.2. **Nothing is ever culled.** `mesh.frustumCulled = false` in
[renderer/viewport/particles.ts](renderer/viewport/particles.ts), and the comment says why: the
positions live in instance attributes, so three.js cannot derive bounds, and a
fire popping in at the screen edge is worse than the draw call. But the bounds
*are* derivable — from the recording. `max(|pos|) + max(size)/2` over every key
of every particle is a bounding-sphere radius per uid, computed once in
`transferEffect` and scaled by the instance's `scale`. The premise the comment
rests on holds for three.js, not for us.

2.3. **`advanceFx` steps every system regardless of the camera.** The precedent
for the fix is twenty lines up the same file: `advanceIdle` in `visible` mode
tests the object's origin against the frustum and skips posing. For effects the
skip is safe *by construction of the sampler* — `sample` only ever walks its
cursor forward, and a slot resets its cursors when its trigger number changes
(`slot.k !== k || f < slot.lastF`), so a system that returns to view after any
number of skipped frames catches up on its own. That is the objection worth
writing down, because it is the one that would otherwise stop the change.

2.4. **The whole buffer is uploaded, not the live part.** `a.needsUpdate =
true` with no range means, in three r160, a `bufferSubData` over all
`n = maxAlive * overlap` slots — even when three particles are alive, even when
none are. `addUpdateRange(0, w * itemSize)` (the r159+ API; `updateRange` is
deprecated to r169) bounds it by what was actually written.

2.5. **The inner loop walks the dead.** Every frame each slot scans every
particle of the recording and rejects most on `f < p.birth || f > p.death`. An
alive-list per frame, built once at bake time next to `maxAlive`, removes the
scan rather than making it cheaper.

2.6. **The same simulation is computed 182 times.** Copies of one effect differ
only in phase (`(at * 0.37) % 3` in `loadFx`) and in their object matrix. The
attribute buffers they produce are otherwise identical.

2.7. **60 Hz work on 30 Hz data.** `rate` is 30 in 98% of the library; frames
between the keys are interpolation of the same two keys either way.

## 3. Model — three steps, in the order they pay

The old plan (in git before 2026-09-17: dedupe the atlases, cull per system,
bound the upload, step at 30 Hz, an alive index, and only then one draw per
effect) optimised a per-system loop. The loop is the problem. The static
objects already answer it — `instancing.ts` draws 2258 objects as 229 calls
by giving every copy of a model a slot in one `InstancedMesh` — and the
effects can be drawn the same way, once one obstacle of our own making is
removed.

3.1. **Stop spreading phases.** `loadFx` gives every copy of an effect a phase
`(at * 0.37) % 3` so identical objects don't flicker in lockstep. That is our
invention, not the game's (EFFECTS_FORMAT.md names it among "some of what this
editor does around the recording is our own invention"); nothing in the
recording has it, and it is the one thing that makes two campfires compute
different frames. Remove it: every copy of an effect is at the same `t`. A
map editor does not need its campfires out of step. Smallest change, and the
precondition for everything after.

3.2. **One batch per effect payload.** `geomFx.get(inst.g)` hands every copy
of a geom the *same* `FxInstancePayload` object, so the batch key is that
object — no hashing. One simulation per payload per frame writes one set of
particle attributes; the copies ride as a per-copy matrix, exactly as
`GeomBatch` does it. 313 systems → one per distinct payload (~80–130 on
A2C1M1). Falls out for free: **one atlas per effect** (the 311 MB become the
distinct set, ~40 MB), one `dispose()` owner, and `advanceFx` walks batches,
not placements.

*Glued effects are the same batch.* A glued system's matrix is
`bone.matrixWorld × glueLocal`, recomputed each frame (`followBone`) — the
particles are in the effect's own frame either way. In a batch that copy's
slot is rewritten each frame (`setMatrixAt` + `needsUpdate`, as `syncInstance`
does on a drag) instead of once at load. No second path.

*The shader takes a second level of instancing.* Today the instances ARE the
particles and the object matrix is one uniform. With copies there are
particles × copies: expand to `n × copies` instances with a copy index in an
attribute and the copy matrices in a small float texture — `gl_InstanceID / n`
picks the matrix. The attribute buffers stay `n` wide; only the index runs
over copies.

3.3. **The recording on the GPU, sampled by time.** After 3.1 the frame at
time `t` is a pure function of the bake — no wind, no phase, no randomness.
`advanceFx` today walks cursors and lerps five channels for every alive
particle every frame (the 4.3 ms). Precompute instead: the recording is 30 Hz
(98% of the library) and an endless effect is a trigger train with a period
(EFFECTS_FORMAT.md), so after warm-up the composite is periodic with `period
× rate` frames — a campfire is 90 frames, and a one-shot is its length. Bake
those frames once per payload into a `DataTexture` of `frames × slots` texels
(position, size/rotation, colour, tile — packed to ~24 bytes a slot); per
frame, `uFrame` changes and the vertex shader reads its slot at that row, dead
slots collapse to a zero quad. `advanceFx` becomes "compute the frame number
per batch" and the per-frame upload is gone.

Memory is the number to check first: `Σ over payloads of periodFrames × slots
× 24 B`. A campfire with 300 slots is ~650 KB; the map-wide sum is expected in
the tens of MB against the 311 MB of atlases it sits beside. Any long,
many-particle effect that breaks the budget is a static count over the bank
before a line is written.

What the old list becomes: atlas dedupe — falls out of 3.2. Culling — a batch
is the whole effect, so per-copy culling is gone; per-batch bounds (from the
keys) are possible later, but with 3.3 a culled batch saves one draw of
trivial quads and nothing else. `addUpdateRange` and the 30 Hz step — no
upload and no per-frame sampling to bound. Alive index — the bake is the
index.

## 4. Touchpoints

| File | Change |
| ---- | ------ |
| [renderer/viewport/fx.ts](renderer/viewport/fx.ts) | 3.1: drop the phase argument. 3.2: `loadFx`/`spawnFx`/`removeFx` group by payload; `advanceFx` walks batches and rewrites glued slots. |
| [renderer/viewport/particles.ts](renderer/viewport/particles.ts) | 3.2: `createFxSystem` → `createFxBatch(payload, baked, copies[])`, copy matrices in a float texture, `gl_InstanceID / n` in the shaders. 3.3: the frame table bake and the `uFrame` lookup replacing `update()`'s loop. |
| [renderer/core/state.ts](renderer/core/state.ts) | `Floor3D.fx` holds batches; the `Instance → slot` map beside it. |
| [src/scene/effects.ts](src/scene/effects.ts) | 3.3 only, if the bake moves off the renderer thread: emit the period frames from `transferEffect`. |
| [renderer/app.ts](renderer/app.ts) | `fxSystems()` reports per copy from its batch (the e2e hook keeps its shape). |
| [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) | The "one instanced draw per ParticleInstance of each placed object" sentence stops being true at 3.2; the phase-spread sentence at 3.1. |

## 5. Confirmed before coding

Done, 2026-09-17 — §1a. Of the five questions this section asked: the split
of calls (5.1) is 861/557; where the frame goes (5.2) is the sections timer,
since no frame is long enough for LoAF; effects on vs off (5.3) is 7 ms of 19,
so the frame is worth the work but is not only effects; the machine is on its
GPU (5.5, asserted by the spec). 5.4 — does culling change what the user
sees — no longer applies: nothing is culled per system.

What the spec keeps asserting after each step: not SwiftShader, and that the
readings happened. The ceilings — frame p95, `render.calls`, atlas bytes,
GPU-process working set — are set from `_tmp/perf/A2C1M1.json` once a step
has moved them, so that a later change cannot quietly give them back.

## 6. Cost, order, and what could go wrong

Held by the suite as before: `e2e/object-effects.spec.ts` (placing, gluing,
retrigger timing), `e2e/shipped-map-scene.spec.ts` (systems arrive),
`e2e/undo.spec.ts`, the `fxSystems()` hook (`alive`, `visible`, world position
per copy — a glued eye that stops following the head is an assertion), and
now `e2e/fx-perf.spec.ts` for the numbers.

| Step | Size | Risk | Held by |
| --- | --- | --- | --- |
| 3.1 no phases | 15 min | none visible | `object-effects.spec.ts`; eyes: campfires in step |
| 3.2 one batch per payload | half a day | medium | `fxSystems()` per copy, glue, place/delete/undo; `fx-perf`: atlases = distinct, calls down ~200 |
| 3.3 frame table on the GPU | half a day – a day | medium | `object-effects` timing half; `fx-perf`: `advanceFx` → ~0, upload gone |

Three places where the estimate can slip:

6.1. **Deleting one copy of a batch** (3.2). Today a system is disposed with
its object. In a batch a deleted copy is a slot to compact — as
`removeInstance` does for `GeomBatch` — and the LAST copy disposes the batch
and its atlas. `undo.spec.ts` is the guard.

6.2. **Where the copy matrices live** (3.2). Copies per payload on A2C1M1 peak
at 182; a `mat4[182]` is 728 vec4 uniforms, over the WebGL2 minimum of 256
for a vertex shader — so the matrices go in a small float texture (4 texels a
copy) and the vertex shader fetches. Decide this before writing the shader,
not after.

6.3. **Which frame a copy is on** (3.3). `fx.offset`, `speed`, `endCycle`,
`cycleCount` and `retrigger` are all per payload, so one frame number serves
the batch — but the retrigger path (`t % retrigger`) and a finite train that
has finished are two clocks the lookup has to reproduce exactly. The timing
half of `object-effects.spec.ts` measured them once; it is the oracle.

## 7. Noted, not in scope

* `advanceIdle` is 3.7 ms a frame on A2C1M1 with nothing moving on screen —
  as much as all the effects' sampling. Its `visible` mode already skips
  off-screen bodies; what it spends on the rest is unmeasured.
* `renderer.render` is 7.8 ms for 557 calls without effects, ~14 µs a call —
  three's CPU submission plus the shadow pass. Fewer calls (merging materials
  across geoms, or a `BatchedMesh`) is the lever; it is the same instancing
  question one level up.
* `map:load` is 11.6 s. The worst number on the page, and not in a frame.

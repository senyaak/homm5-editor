# SLICE — What the particle effects cost, and what to do about it

> **Status:** measured, nothing built yet. Playing an object's baked effect
> works and looks right ([docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md)); what
> it costs was never counted. It was counted on 2026-07-28, on a shipped map,
> and the effects turn out to be heavier than the entire rest of the scene on
> every axis at once — draw calls, per-frame CPU, buffer traffic and texture
> memory. This slice says where the cost is, what it would take to remove it,
> in what order (§6, costed), and — importantly — what to confirm with a live
> profile before touching anything (§5). The plan is agreed and waiting for a
> go-ahead; nothing here is started. When it ships, fold the surviving facts into
> [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) and retire this file.

Reading first: [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) (what the data
is and why playback is interpolation, not simulation),
[renderer/particles.ts](renderer/particles.ts) (one playing system),
[renderer/app.ts](renderer/app.ts) (`loadFx`, `advanceFx`, the render loop).

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
[renderer/particles.ts](renderer/particles.ts), and the comment says why: the
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

## 3. Model — the order that pays

Each step stands alone; none of them needs the next to exist.

3.1. **Dedupe the atlases** — a `WeakMap<FxInstancePayload, Promise<Atlas>>` in
[renderer/particles.ts](renderer/particles.ts). 644 MB → 76 MB, 3338 decodes →
~380. Smallest change here, largest number.

3.2. **Give a system bounds and let it be culled** — radius per uid from the
bake (§2.2), `frustumCulled` back on, and `advanceFx` skipping what the frustum
rejects (§2.3). 607 draws and 183k iterations become whatever is on screen.

3.3. **Bound the upload** — `addUpdateRange` (§2.4), and no `needsUpdate` at
all when the system wrote nothing this frame and wrote nothing last frame.

3.4. **Step effects at the bake rate** — a 30 Hz accumulator in `advanceFx`.
Half the CPU, no visible change by construction (§2.7).

3.5. **Alive-index per frame** (§2.5), and then **one draw per effect, not per
placement**: copies sharing a uid and a quantised phase bucket produce one set
of attributes; the per-copy object matrix rides as a second instanced attribute.
182 campfires → 1 draw and 8 simulations, and the whole map → ~128 draws. This
is a rewrite of `createFxSystem`'s shape, so it comes last and only if the
profile still asks for it.

3.6. **Retire the canvas/data-URI path** — the main process already decodes the
DDS; shipping RGBA as typed arrays into a `DataTexture` over the existing `map:fx`
channel removes the PNG round trip, the sequential image decodes, *and* the
two-texture split, which exists only because a browser canvas premultiplies
(see the `buildAtlas` comment). Halves particle texture memory again.

## 4. Touchpoints

| File | Change |
| ---- | ------ |
| [renderer/particles.ts](renderer/particles.ts) | Atlas cache by payload identity (3.1); bounding sphere from the bake instead of `frustumCulled = false` (3.2); `addUpdateRange` (3.3). |
| [renderer/app.ts](renderer/app.ts) | `advanceFx`: frustum skip mirroring `advanceIdle`'s `visible` mode, 30 Hz accumulator (3.2, 3.4). |
| [src/scene/effects.ts](src/scene/effects.ts) | `transferEffect`: emit the bounding radius and the per-frame alive index alongside `maxAlive` — both are one pass over data already walked (3.2, 3.5). |
| [electron/main.ts](electron/main.ts) | Only for 3.6: ship frame textures as RGBA typed arrays over `map:fx` rather than data-URIs in the scene payload. |
| [src/scene/scene.ts](src/scene/scene.ts) | Only for 3.6: `particleTextureUris` stops encoding PNG. |
| [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) | Fold in whatever survives; the "one instanced draw per ParticleInstance of each placed object" sentence in §1 stops being true at 3.5. |

## 5. Confirm before coding

The numbers above are static — they say how much of everything is created, not
where the frame goes. Reading a renderer instead of measuring it has produced a
plausible and wrong diagnosis three times in this project already, so:

5.1. **`renderer.info.render.calls` / `.triangles` in the HUD.** Should read
~1400 calls on A2S1's surface and confirm the 607/831 split.

5.2. **Where the frame actually goes**, through the **Long Animation Frames
API** rather than a hand-rolled timer — it is the grown-up version of the
`JANK_MS` warning already in the render loop, and it names the culprit instead
of the symptom:

```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries())
    console.warn(`LoAF ${e.duration|0}ms · blocking ${e.blockingDuration|0}ms`,
      `render ${(e.styleAndLayoutStart - e.renderStart)|0}ms`,
      e.scripts.map((s) => `${s.name} ${s.duration|0}ms @${s.sourceURL}:${s.sourceCharPosition}`));
}).observe({ type: 'long-animation-frame', buffered: true });
```

`scripts[]` attributes to a function and a source position, and
`renderStart`/`styleAndLayoutStart` split our code from the paint. If `advanceFx`
does not show up here, 3.4 and 3.5 are not worth their risk and the whole slice
is 3.1 + 3.2.

5.3. **The `showFx` toggle is already the experiment.** FPS with effects on
versus off is the upper bound on everything here. If the difference is small
but the editor is still heavy, the cost is not in the frame at all — it is the
644 MB (3.1 alone) or fill rate, and then the first thing to try is
`setPixelRatio(1)` on a hidpi screen, which is a settings knob rather than a
rewrite.

5.4. **Open: does culling change what the user sees?** The comment defending
`frustumCulled = false` is about a fire appearing at the screen edge. With a
real bounding sphere that specific pop cannot happen, but a system whose
particles travel far from its origin (smoke drifting, a tall phoenix flame)
needs the radius to come from the *keys*, not from the placement — which is what
§2.2 says, and what the implementation has to be checked against visually, on a
map with drifting smoke, before the culling is trusted.

5.5. **The instruments, and why not Web Vitals.** LCP, CLS and the rest measure
a document: here the canvas appears instantly and empty, nothing reflows, and
only INP (does a click on the palette answer) means anything. What corresponds
to them for this editor is a different set, and every piece of it is already
reachable without a dependency:

| Question | Instrument |
| --- | --- |
| Is the frame slow, and because of what? | `long-animation-frame` (§5.2) |
| How many draws, how many triangles? | `renderer.info.render` — mind `info.autoReset`, read it after `render()` |
| How much GPU memory? | DevTools → Rendering → **Frame Rendering Stats** (an overlay, nothing to write) |
| Which process is heavy? | `app.getAppMetrics()` from main — the gpu process is listed separately, so 644 MB shows up as its RSS |
| **Are we even on the GPU?** | `app.getGPUInfo('complete')` / `getGPUFeatureStatus()`. Already called with `'basic'` in `electron/main.ts`, and there is already a SwiftShader switch — so "we are silently on software rendering" costs nothing to rule out and **invalidates every other measurement**. Check it first. |
| What does the GPU process actually do? | `contentTracing` → Perfetto: texture uploads, shader compiles, swap waits. Electron-only; a web page cannot see this. |
| How much JS memory? | `performance.measureUserAgentSpecificMemory()` (needs cross-origin isolation) |
| Per-draw GPU time | `EXT_disjoint_timer_query_webgl2` by hand — three's `resolveTimestampAsync` landed well after r160. Availability is one line: `renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2')` |

The four worth keeping permanently, once measured: **p95 frame time** (a mean
FPS hides exactly the stutter being chased), `render.calls`, gpu-process RSS,
and `map:load` wall time — that last one is 13.5 s on A2S1 and is a worse
number than anything in a frame.

## 6. Cost, order, and what could go wrong

Estimates are for the way this repo is actually worked: written here, held by
the e2e suite, argued about on screenshots where the suite cannot judge.

**The suite already covers this ground**, which is what makes the cheap steps
cheap: `e2e/effects.spec.ts`, `e2e/effect-timing.spec.ts` and
`e2e/glued-effects.spec.ts`, plus the `fxSystems()` debug hook in
`renderer/app.ts`, which reports `alive`, `visible` and the world position of
every system on the active floor. "The campfire went out", "the wrong thing got
culled" and "the glued eye stopped following the head" are assertions, not
screenshot reviews.

| Step | Size | Risk | Held by |
| --- | --- | --- | --- |
| §5 measurements | 30–40 min | none | is itself the result |
| 3.1 atlas dedupe | ~1 h | medium | `fxSystems().alive` + deleting a placed object |
| 3.3 `addUpdateRange` | 15 min | none | nothing visible may change |
| 3.4 30 Hz step | 20 min | low | `effect-timing.spec.ts` |
| 3.2 bounds + culling | 2–3 h | medium | `test-effects` + `visible` from the hook + eyes on smoke |
| 3.5 alive index | ~1.5 h | low | `test-effects` |
| 3.5 one draw per effect | half a day – a day | high | all of the above |
| 3.6 RGBA instead of PNG | half a day | medium | eyes on fire |

**Two sittings.** The first is ~2 hours — measurements, then 3.1 + 3.3 + 3.4:
that is where the 644 MB and the whole upload traffic live, and only 3.1 risks
anything. The second is half a day for 3.2. Then stop and re-profile: after
those two the picture changes enough that planning 3.5/3.6 now would be
guessing. A day of work covers ~90% of the problem **if** §5 confirms the
diagnosis.

Three places where the estimate can slip:

6.1. **`dispose()` against a shared atlas** (3.1). Every system currently
disposes its own textures; share them and the first deleted campfire blanks the
other 181. Needs a refcount, or ownership moved to the cache and cleared when
the map closes. That is the whole substance of the step — the rest is fifteen
lines.

6.2. **Which space the radius lives in** (3.2). three computes the bounding
sphere in geometry space and pushes it through `matrixWorld`, which here is set
by hand (`matrixAutoUpdate = false`). And the radius must come from the keys,
not the placement, or drifting smoke gets culled while still visible — §5.4.

6.3. **Premultiplication** (3.6). The two-texture split exists solely because a
canvas premultiplies; walking back in without watching the fire is how the
flames come out blue a second time.

Minor, but it bites exactly at 3.3: `package.json` pins `three@^0.160.0` against
`@types/three@^0.185.1`, so the types describe an API newer than the runtime.
`addUpdateRange` does exist in r160 (checked in `node_modules`), but the next
call taken on the types' word may typecheck and fail at runtime.

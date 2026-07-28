# SLICE — What the particle effects cost, and what to do about it

> **Status:** measured, nothing built yet. Playing an object's baked effect
> works and looks right ([docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md)); what
> it costs was never counted. It was counted on 2026-07-28, on a shipped map,
> and the effects turn out to be heavier than the entire rest of the scene on
> every axis at once — draw calls, per-frame CPU, buffer traffic and texture
> memory. This slice says where the cost is, what it would take to remove it,
> and — importantly — what to confirm with a live profile before touching
> anything. When it ships, fold the surviving facts into
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
| [src/effects.ts](src/effects.ts) | `transferEffect`: emit the bounding radius and the per-frame alive index alongside `maxAlive` — both are one pass over data already walked (3.2, 3.5). |
| [electron/main.ts](electron/main.ts) | Only for 3.6: ship frame textures as RGBA typed arrays over `map:fx` rather than data-URIs in the scene payload. |
| [src/scene.ts](src/scene.ts) | Only for 3.6: `particleTextureUris` stops encoding PNG. |
| [docs/EFFECTS_FORMAT.md](docs/EFFECTS_FORMAT.md) | Fold in whatever survives; the "one instanced draw per ParticleInstance of each placed object" sentence in §1 stops being true at 3.5. |

## 5. Confirm before coding

The numbers above are static — they say how much of everything is created, not
where the frame goes. Reading a renderer instead of measuring it has produced a
plausible and wrong diagnosis three times in this project already, so:

5.1. **`renderer.info.render.calls` / `.triangles` in the HUD.** Should read
~1400 calls on A2S1's surface and confirm the 607/831 split.

5.2. **`performance.now()` around `advanceFx`** in the render loop. Separates
the CPU simulation (§2.5, §2.6) from everything on the GPU side. If it is under
a millisecond, 3.4 and 3.5 are not worth their risk and the whole slice is
3.1 + 3.2.

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

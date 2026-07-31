# Skeletons and animations (`bin/animations`, `bin/Skeletons`) — notes

Status: **decoded.** The bone hierarchy with its rest pose and the
position/orientation/scale-shear curves all read, and creatures and buildings
play their idle on the map. Skin weights turned out to live in our own mesh
container, not here (§4).

Three formats stack up here, and they are documented apart because only the
innermost one is about animation at all:

| | |
|---|---|
| **GR2_FORMAT.md** | the Granny container — header, sections, relocations, the self-describing type tree |
| **OODLE1_FORMAT.md** | the compression most of that container is packed with |
| this file | what the decoded structures mean, and how the editor plays them |

Confidence: **[OK]** = verified against a redundancy in the data · **[~]** =
strong heuristic, not yet proven.

## 1. Where the data lives and how it is referenced

Unlike everything else under `bin/`, these are **not** Nival's container: they
are RAD Game Tools' **Granny GR2** (GR2_FORMAT.md), written by "Granny Standard
Exporter, SDK version 2.5.0.5" out of Maya 6.

```
<object>.(AdvMapXxxShared).xdb  →  <Model href=".../X.(Model).xdb">
X.(Model).xdb                    →  <Skeleton>…<uid>610D4B81-…</uid>   → bin/Skeletons/<uid>
                                    <Geometry>…<uid>04293182-…</uid>   → bin/Geometries/<uid>
_(AnimSet)/…/X-adv.(AnimSet).xdb →  <Item><Kind>idle00</Kind>
                                      <Anim href="X-adv-idle00.xdb#xpointer(/BasicSkelAnim)">
X-adv-idle00.xdb                 →  <uid>532BB512-…</uid>              → bin/animations/<uid>
```

Two things worth knowing before hunting for files:

* An adventure-map model has its **own** animation set, named `…-adv`, and it
  usually holds exactly ONE animation: `idle00`. The combat ones (`-arena`) carry
  attack/move/hit/death. So idle on the map is a single clip per object. **[OK]**
* `bin/Skeletons/` can be **ignored**. An animation file carries its own copy of
  the skeleton it animates, so a single read gives bones, rest pose and curves
  together. That mattered before Oodle1 was ported, when the standalone
  skeletons were unreadable; it is still the simpler path. **[OK]**

## 2. Skeleton **[OK]**

`Skeletons[] → Bones[]`, each bone: `Name`, `ParentIndex` (-1 for the root),
`Transform`, `InverseWorldTransform` (`Real32[16]`).

The `Transform` layout and the row-vector matrix convention it implies are the
container's, and are written up in GR2_FORMAT.md §7. What matters here is the
consequence: a bone's world matrix is `local · parentWorld`, composed
child-first, and `checkSkeleton` measures that against the file's own inverse
bind matrices rather than trusting it.

**The exporter's rotated root frame.** Some files (10 of 206 sampled — a hero
with cloth and a tail was the first) store inverse binds sitting in a frame
rotated -90° about X relative to the bone transforms, while the root bone's own
transform stays identity. It is one constant matrix for the whole skeleton, not
a per-bone error. It cancels out as long as the editor computes its own inverse
binds from the same rest pose it animates (`inverseBindMatrices`), which is what
it does — so the invariant that is actually tested is "every bone agrees on ONE
frame", not "the frame is the identity".

**Which copy of the skeleton is the BIND pose.** The same rig is stored in two
places and they are NOT the same pose: the standalone file under
`bin/Skeletons/<uid>` (named by the Model's `<Skeleton>`) holds the pose the
mesh was skinned in, while the copy inside an animation file holds the pose
that clip **starts from**. Same bones, same names, same order — only the rest
transforms differ. Inverse binds must come from the model's own copy: built
from the animation's, they look right exactly as long as the clip happens to
start near the bind pose — most adventure idles do — and shred the mesh when it
does not (the addon Combat Mage's stance sits 167° from bind; the Air Elemental
came apart into chunks). Tracks address bones by name, so a clip plays on
either copy. When a model names no readable skeleton, the animation's copy is
the only one there is, and the clip-start pose stands in for bind.

The two rigs need not even be the same size: a Footman's arena clip carries 45
bones against the model's 39, a Steel Golem's 53 against 46 — the surplus is
combat props. The clip covers every model bone by name and the extras are
simply never asked for; requiring identical rigs left both creatures posing as
the T of their bind skeleton while the clip played on the wrong copy. The one
guard kept is coverage — a clip that tracks under half of a rig's bones is
addressing some other naming scheme.

**A model with an empty `<Skeleton/>` is not skinned at all**, whatever its
AnimSet says: the Gold Mine ships a seven-bone `idle00` AND an empty skeleton
element (its `<MeshAnimated/>` list is empty too), and skinning its meshes
against the clip's own skeleton scattered the gold across the hill. The
declaration is the contract; the AnimSet's existence is not.

## 3. Animation **[OK]**

`Animations[] → TrackGroups[] → TransformTracks[]`. An animation has `Duration`
(seconds) and `TimeStep` (the authoring frame interval, 0.0167 = 60 fps). A
transform track is one bone by name, with three curves.

SDK 2.5 predates Granny's compressed curve formats, so a curve is the simple
one: `Int32 Degree`, `Real32[] Knots`, `Real32[] Controls`, stored inline in the
track (20 bytes each). `Knots` are times in seconds; `Controls` holds
`controls.length / knots.length` values per knot — **3** for a position, **4**
for a quaternion, **9** for scale-shear. Measured over 17366 tracks: every curve
is 3, 4 or 9 wide and every knot lies inside `[0, duration]`.

Degrees in the shipped library: **0** (a channel that never moves — by far the
most common), **1** (linear), **2** (quadratic, what rotations use) and a little
**3**. Degrees 0 and 1 are evaluated exactly. Degree ≥2 is a B-spline whose
controls are *not* points the curve passes through; `sampleCurve` evaluates it
over a knot vector clamped at both ends, and quaternions are renormalized after
blending. **[~]** — this is the one place where "looks right" is currently the
only check.

**Fast bones outrun the default sample rate.** The bake grid is 15 fps, and the
Air Elemental's vortex bone turns ~171° between two such samples — slerp then
takes the short way each frame and the creature reads as jerking. `bakeClip`
callers re-bake at doubled rates (up to 60 fps) while any bone still steps more
than 45° between samples; only the clips that need it grow.

Adventure-map idles are long and slow: the earth elemental's is 5.167 s over 29
bones, ~130 quaternion keys per bone.

## 4. Skin weights are in OUR mesh container, not in the GR2 **[OK]**

The per-position 24-byte block (record tag 4 in `bin/Geometries/<uid>`), long
described in GEOMETRY_FORMAT.md as "normals and tangents", is the vertex-to-bone
binding:

| bytes | field |
|---|---|
| 0–15 | 4 × `float32` weights |
| 16–19 | 4 × `uint8` weights, the same values quantized (255 = 1.0) |
| 20–23 | 4 × `uint8` bone indices into the skeleton's bone list |

The oracle: across all 546 positions of the earth elemental the four floats sum
to exactly 1.000, with no exceptions, and every index falls inside 0..28 for a
29-bone skeleton. Unused slots carry weight 0 and repeat a filler index.

## 5. How the editor plays it

Off by default — `Settings.idleAnimation` is `off`/`visible`/`all`, and the
toolbar's **Idle stance** button cycles it. `off` is decided in the main process
and decides what the scene is built out of (no bones, no binding, no clip: an
animated model's payload roughly halves). Leaving `off` does not reopen the
map: the main process replays the open map's models through a fresh resolver
with animation on (`map:idle-skins`) and the renderer grafts the payloads onto
the geometries already on the GPU — deterministic resolution keeps the geom
indices aligned, and both ends check vertex counts before trusting a payload.
`visible` and `all` only decide how much of it keeps moving.

An animated object cannot ride the instanced batches — those draw one model many
times from a single matrix buffer, and every copy poses independently — so it
leaves its batch and becomes its own `SkinnedMesh` (`renderer/skinning.ts`).
One draw call each, which is why the middle mode exists.

**The bind-matrix trap, since it cost a debugging round.** three.js's shader
computes `bindMatrixInverse * Σ w (bone.matrixWorld * boneInverse) * bindMatrix *
p` and then applies `modelViewMatrix`. The bones are children of the mesh, so
their world matrices already carry the object's placement — which means
`bindMatrix` must be the **identity**, or the placement is applied twice. And the
inverse binds are handed over **element for element, not transposed**: ours are
row-vector matrices stored row-major, three.js wants the column-vector form
stored column-major, and those two differ by a transpose twice over, so the
arrays are identical. Transposing "into three.js's convention" threw vertices
1100 units off a 4-unit model.

## 6. Verification

Four layers, each checking what the one below cannot see. All skip themselves
when the game data is not unpacked.

* `npm run test-oodle` — the decompressor, against the game's own duplicate: a
  skeleton stored packed under `bin/Skeletons/` and again plain inside the
  animation that plays on it must come out identical, bone for bone. **This is
  the one that decides whether a change to `src/format/oodle.ts` is right** — a failure
  count is not a measure of correctness here, and optimising for one has already
  produced a decoder that threw nothing and corrupted everything (OODLE1_FORMAT.md).
* `npm run test-gr2` — the format, against redundancies the data itself carries:
  header arithmetic, one bind frame per skeleton (median error 4e-7; the deep
  cloth chains reach 7e-4 through float32 accumulation), curve widths, knots
  inside the clip, and the rest pose skinning to itself.
* `npm run test-idle` — the maths the GPU will run, by driving the renderer's own
  `renderer/skinning.ts` and comparing against three.js's `applyBoneTransform`,
  the CPU twin of the skinning shader. This is what caught the transposed binds.
* `npx playwright test idle-stance` — the real app: that objects take an animated
  body, leave the batched draw, and that the clock actually turns. A skeleton
  built and never stepped draws a frozen creature and passes everything else.

## 7. Still open

* Exact degree-2/3 B-spline evaluation against the engine's own (§3). (The two
  packed sections that used to fail — the `ShamanOfNommads` idle among them —
  decode since the decay-gate fix; the whole library is now byte-exact,
  OODLE1_FORMAT.md §4.4.)
* Only `idle00` is ever played. Every clip an AnimSet names is read, including
  the combat sets, but nothing surfaces or plays them.
* `bin/effects/*` turned out to be a **baked particle simulation** and is now
  decoded — see EFFECTS_FORMAT.md. Unrelated to skeletal animation; effect
  *models* already render as static geometry.

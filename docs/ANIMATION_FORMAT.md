# Skeletons and animations (`bin/animations`, `bin/Skeletons`) — notes

Status: **decoded.** The container, the bone hierarchy with its rest pose, and
the position/orientation/scale-shear curves all read, and the Oodle1 compression
the rest of the library hides behind is ported too (§3) — so effectively every
skeleton and every adventure-map idle clip is reachable. Skin weights turned out
to live in our own mesh container, not here (§6).

Confidence: **[OK]** = verified against a redundancy in the data · **[~]** =
strong heuristic, not yet proven.

## 1. Where the data lives and how it is referenced

Unlike everything else under `bin/`, these are **not** Nival's container: they
are RAD Game Tools' **Granny GR2**, written by "Granny Standard Exporter, SDK
version 2.5.0.5" out of Maya 6. `bin/granny2.dll` ships with the game (32-bit).

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

## 2. Container **[OK]**

Implemented in `src/gr2.ts`. Header, little-endian 32-bit flavour (the only one
shipped, checked across all 5656 files):

| offset | field |
|---|---|
| 0 | 16-byte magic `b867b0ca f86db10f 84728c7e 5e19001e` = LE32 |
| 16 | `headerSize` — equals `88 + 44 × sectionCount`, the cheap self-check |
| 32 | `version` (6 in every shipped file) |
| 44 | `sectionArrayOffset` — **relative to byte 32**, not to the file |
| 48 | `sectionCount` |
| 52/60 | root type reference / root object reference, each `(section, offset)` |
| 68 | `typeTag` (`0x80000010`–`0x80000015` here) |

Each 44-byte section entry gives compression, file offset, stored size,
decompressed size, and a relocation table. **Pointers are not stored inline**: a
pointer field holds nothing useful, and the section's relocation table says, per
pointer-field offset, which `(section, offset)` it targets. A field with no
relocation entry is a null pointer.

The payoff, and the reason `src/gr2.ts` is short for what it does: **a GR2
describes itself**. The file carries a tree of type definitions — 32 bytes per
member: kind, name pointer, element-type pointer, array width — so structures are
read *by field name* (`Bones`, `ParentIndex`, `InverseWorldTransform`) instead of
by guessed offsets, which is how the mesh container had to be done.

## 3. Compression: the Oodle1 tail **[OK]**

Census over the whole shipped library:

| directory | files | payload compressed | plain |
|---|---|---|---|
| `bin/Skeletons` | 2247 | **2247** | 0 |
| `bin/animations` | 3409 | 592 | **2817** |

Compression type 2 is **Oodle1** (RAD's own LZ + adaptive arithmetic coder),
ported in `src/oodle.ts` from the open specification at
`LunaticInAHat/liboodle` (Unlicense), which documents the format down to
pseudocode and names HoMM5 as an example. `GrannyFile` decompresses on the way
in; `isUnreadable` is what a caller checks, and it means "there is data here we
cannot see", not "this file is compressed".

**It decodes the library.** Of 2839 packed files, 2837 come apart; of the 106
idle clips an animation set actually names, 105 do. The two holdouts are one
building idle (`ShamanOfNommads`) and one animation nothing references.

* Correct, not merely quiet: the game ships the same skeleton twice — packed
  under `bin/Skeletons/`, and again plain inside the animation that plays on it.
  Decompressed, the two agree bone for bone, name for name, parent for parent,
  and the floats reproduce each file's own inverse bind matrices to 1e-4.
* A section that fails leaves `data` null and the object falls back to its still
  mesh, exactly as before the port existed.

**Three rules were settled by measurement, not by reading.** All three are the
kind that leave a decoder producing plausible output for thousands of bytes
before it collapses:

1. The renormalisation interval is `max(128, min((alphabetSize - 1) * 2,
   decayThreshold / 2 - 32))`, which is NOT a clamp — the two differ exactly
   when the upper bound falls below 128, and that happens for one coder in the
   scheme: the four-symbol one coding the low two bits of an offset. As a clamp
   it renormalises every 96 symbols where the encoder used 128. This alone was
   the difference between 80% of sections and 99%.
2. The three streams of a section share ONE bit reader (they are not
   byte-aligned blocks — the coder never flushes between them), while their LZ
   state — byte counter, match window, literal-coder choice — restarts for each.
3. But the OUTPUT buffer is shared, and a match may reach back across a stream
   boundary. That is how the last stream starts at all: its own counter is zero,
   so every offset alphabet is one symbol wide and the only encodable offsets
   are 1 to 4 — the tail of the previous stream. Twenty-two files open on
   exactly that match.

**A warning about how to test this.** "The section decoded without throwing" is
not a measure of correctness, and optimising for it actively misleads. Bounding
the offset digits by the room the window leaves — which is what the arithmetic
plainly implies — takes the library from 2 failures to 0 and *silently corrupts
every skeleton it touches*: bone names come out as runs of `gggg`. That was
caught only by going back to the duplicate-skeleton oracle. Judge changes here
by `npm run test-oodle`, never by a failure count.

The other route, if the residual proves stubborn: `bin/granny2.dll` exports
`GrannyDecompressData`, but it is 32-bit and the editor's Node is 64-bit — a
process cannot load a DLL of the other bitness, so it would need a small 32-bit
sidecar over stdio. It would also make the editor depend on the game install.

## 4. Skeleton **[OK]**

`Skeletons[] → Bones[]`, each bone: `Name`, `ParentIndex` (-1 for the root),
`Transform`, `InverseWorldTransform` (`Real32[16]`).

A Granny `Transform` is 68 bytes: a flag word (bit 0 position, bit 1
orientation, bit 2 scale-shear), `Real32[3]` position, `Real32[4]` quaternion
stored **x, y, z, w**, and a `Real32[9]` scale-shear. A component whose flag is
clear is the identity, whatever bytes are in the slot.

**Matrix convention:** row-major, translation in the LAST ROW — the row-vector
convention (`v' = v · M`), not the column-vector one graphics code assumes. So
composition runs child-first: `world = local · parentWorld`. The 3×3 is
`scaleShear · rotation`. None of this is assumed: `checkSkeleton` measures it
against the file's own inverse bind matrices, and every other combination of
transpose/order is off by order 1.

**The exporter's rotated root frame.** Some files (10 of 206 sampled — a hero
with cloth and a tail was the first) store inverse binds sitting in a frame
rotated -90° about X relative to the bone transforms, while the root bone's own
transform stays identity. It is one constant matrix for the whole skeleton, not
a per-bone error. It cancels out as long as the editor computes its own inverse
binds from the same rest pose it animates (`inverseBindMatrices`), which is what
it does — so the invariant that is actually tested is "every bone agrees on ONE
frame", not "the frame is the identity".

## 5. Animation **[OK]**

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

Adventure-map idles are long and slow: the earth elemental's is 5.167 s over 29
bones, ~130 quaternion keys per bone.

## 6. Skin weights are in OUR mesh container, not in the GR2 **[OK]**

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

## 7. How the editor plays it

Off by default — `Settings.idleAnimation` is `off`/`visible`/`all`, and the
toolbar's **Idle stance** button cycles it. `off` is decided in the main process
and decides what the scene is built out of (no bones, no binding, no clip: an
animated model's payload roughly halves), so leaving `off` needs the map
reopened; `visible` and `all` only decide how much of it keeps moving and switch
live.

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

## 8. Verification

Three layers, each checking what the one below cannot see. All skip themselves
when the game data is not unpacked.

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

## 9. Still open

* The Oodle1 tail (§3).
* Exact degree-2/3 B-spline evaluation against the engine's own (§5).
* `bin/effects/*` is a **different, still-unknown format** — not GR2, and not the
  Nival record container either (a leading size word and then floats). Unrelated
  to skeletal animation; effect *models* already render as static geometry.

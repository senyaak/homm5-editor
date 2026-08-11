# HoMM5 geometry format (`bin/Geometries/<uid>`) — reverse-engineering notes

Status: **textured meshes decoded**. Container grammar, vertex positions, the
vertex-split remap, the triangle index buffer and **UVs** are decoded and
verified (0 stray edges; UV edge-continuity confirmed). The authored **normals**
are read from the file too — the first of the three packed byte vectors each
render vertex ends with, §5. Textures (`.dds`,
DXT1/3/5) decode via `src/format/dds.ts`. The per-submesh material split is decoded
too: a mesh that uses several materials stores each material's slice as its own
group, and each group is emitted as its own mesh, one-to-one with the model's
material list (see §4). This document records exactly what is known so the work
is resumable and auditable.

**Writing is decoded too, and proven** (§6): every one of the 3572 shipped
geometries decodes and re-encodes byte for byte through `geometry-write.ts`, so
meshes of our own are authored rather than sculpted out of donors.

Confidence: **[OK]** = verified byte-exact on real assets · **[~]** = strong
heuristic, not yet byte-exact.

## 1. Where meshes live and how they're referenced

`data.pak` (a ZIP) contains, for each object:

```
<object>.(AdvMapStaticShared).xdb   →  <Model href=".../X.(Model).xdb">
X.(Model).xdb                        →  <Materials>… <Texture href=".../*.dds">
                                        <Geometry><uid>AA93C8D1-…</uid>
                                                  <Size>/<Center>   (bounding box)
bin/Geometries/AA93C8D1-…            →  the binary mesh (filename = uid, UPPERCASE)
```

The `.xdb` files are plain XML. The bounding box in the `Geometry` block is the
key to decoding the binary: decoded vertex positions must fit it. **[OK]**

## 2. Container grammar **[OK]**

The binary is a tree of records. Every record is `<tag byte> <size field>
<payload>`, and the size field is width-flagged: an **even** byte IS twice the
length, an **odd** one means a u32 sits there and the length is `(v − 1) / 2`.
The "scalar int32" form written `tag 08 <u32>` is that same rule with the size
byte 8 — not a form of its own. §6.1 states the rule the writer follows and the
measurement behind it.

A payload is either **more records** or a **leaf** (a raw typed array). The
engine knows which from its compiled schema; §6.2 lists the paths that matter.

This is the *same* container family as `GroundTerrain.bin`; there the array
marker byte is fixed `0x03`, here it varies — which is why a terrain-tuned
scanner misses these arrays.

### Header of the mountain sample, decoded

```
@0   tag4 int=4          format/version
@6   tag1 block 52832 B  whole payload
@16  tag2 int=2          MESH BLOCK COUNT — declared, and always right  [OK]
@22  tag1 block 26404 B  the first block
@43  tag1 int=307        VERTEX COUNT of the positions block that follows [OK]
@49  tag2 block 3684 B   positions = 307 × 12 = 307 × vec3<f32>          [OK]
@54  … 307 vertices …
```

## 3. Vertex positions **[OK]**

* Layout: `count × vec3<f32>` = `count × 12` bytes, non-interleaved (positions
  are their own array; normals/uvs live in separate leaves — planar layout).
* The `count` is the `tag 08 <u32>` scalar immediately preceding the block.
* **Validation:** decoded min/max match `Center ± Size/2` from the `.xdb`
  exactly. Verified on the mountain (307 v, box 24×24×10.7) and 6 bushes.

`src/geometry.js → extractPositionArrays()` implements this and is the reliable
entry point today.

## 4. Mesh reconstruction **[OK]**

The tree makes the mesh structure explicit. Each mesh node holds a sequence of
`{ int=count, leaf }` children (mountain sample, one half):

| child | count | leaf | role |
|---|---|---|---|
| tag2 | 307 | 307×vec3<f32> | **positions** — unique XYZ, fit the bbox |
| tag3 | 493 | 493×20 B | interleaved attribute stream (not plain XYZ) |
| tag4 | 307 | 307×24 B | **skin binding** — 4 float weights, then 4 quantized weights and 4 bone indices as bytes (see ANIMATION_FORMAT.md §4) |
| tag5 | 493 | 493×u16 (all < 307) | **remap**: render-vertex → position index |
| tag6 | 493 | 493×u16 | render vertex → the FIRST render vertex at that position (§6.4) |
| tag7 | 564 | 564×3×u16 (all < 493) | **indices** — triangle list |

The engine performs a **vertex split**: 307 unique positions expand to 493 render
vertices (so each can hold its own normal/uv), addressed through the remap. To
draw:

```
renderVertex[i].position = positions[ remap[i] ]      i ∈ [0, 493)
triangles reference renderVertex indices (0..492)
```

Selecting the correct remap is unambiguous: it is the `u16` leaf whose every
value is `< positionCount`. Reconstructed this way the mountain has **0 stray
edges** (max edge ≈ 4.8 on a 24-unit mesh); the bushes likewise. Implemented in
`src/scene/geometry.ts → extractMeshesStructured()`; `node tools/mesh-to-obj.js`
writes OBJ and prints the edge-length check.

**Material groups.** A named mesh (one `<MeshNames>` entry) is a tag-1 block of
the outer record, but a mesh that uses more than one material stores each
material's slice as its **own** tag-1 group inside that block — so one block can
hold several groups, `MaterialQuantities[i]` of them for mesh `i`. Each group is
a full mesh node (its own positions/remap/indices as above) and is emitted as a
separate mesh, which lines the meshes up one-to-one with the model's `<Materials>`
list in order. Reading only a block's first group drops every extra slice: the
crystal cavern's crate is one group and its crystals a second on the same mesh,
so the crystals went missing until the decoder walked all groups
(`decodeMeshGroup` per group).

Many files hold the same shape **twice**, and it long read as an LOD copy —
`extractMeshes` still de-duplicates. It is not a copy: the outer block declares
how many mesh blocks follow and the count always matches, and two blocks that
look identical can differ in one byte of the skin array, which binds them to
different bones (§6.3).

## 5. Attributes and texture **[OK]**

Per render vertex the 20-byte attribute stream (tag3) is:

| bytes | field | decode |
|---|---|---|
| 0–3 | **UV** | 2× int16 ÷ 2048 (V spans [0,1], U tiles). Confirmed by UV edge-continuity |
| 4–7 | (zero / uv2 slot) | unused here |
| 8–11 | **normal** | byte ×3 + pad, `(b − 128) / 127` |
| 12–15 | tangent | same packing |
| 16–19 | binormal | same packing |

**Which of the three is the normal is measured, not assumed** — and it had been
assumed wrong until 08.2026, with the decoder reading byte 12. The measurement
(`_tmp/normcensus.ts`): over 1790 mesh groups sampled from the shipped
geometries, the triple at 8 has mean dot **0.294** with the face normal of the
triangles that use it, while 12 and 16 sit at **−0.050** and **0.005** —
perpendicular to the surface's normal, which is what a tangent and a binormal
are. Inside one vertex all three decode to unit length for 100% of vertices and
are mutually orthogonal (mean |dot| 0.002 between any pair): that is what says
the trailing twelve bytes are a basis rather than three unrelated fields.

Why the average is 0.294 rather than ~0.9: the shipped triangle lists do not
keep a consistent winding, so a signed comparison against the face normal
cancels on roughly a quarter of the faces. The ratio between the three
candidates is the discriminator, not the absolute number.

The decoder prefers these authored normals and recomputes only the ones that
arrive zero-length (`repairZeroNormals`) — averaging every normal over the faces
at a vertex smooths the hard edges a modeller put there. UVs are read by
`extractMeshes`; `tools/mesh-to-obj.js` emits a full `v`/`vt`/`vn` OBJ.

**Which faces are drawn: `<Is2Sided>`.** A `<Material>` carries it beside
`<AlphaMode>` and `<AddPlaced>`, and it is false in **11209** of the 11639
shipped materials — the engine culls the faces turned away, and only 430
materials ask for both sides (foliage cards, banners, grass tufts: a single
sheet of triangles that has to be seen from behind). It is not a saving, it is
part of the picture: a camera INSIDE a body sees straight through it, because
its near faces are behind the eye and its far ones are turned away. Four of
C1M1's dialogue cameras pull back into the ridge of mountains that lines the
arena — shot 22 has the eye five units inside `Mountain12x12` — and drawn
two-sided those shots are the inside of a rock rather than the scene.

The culled side is the counter-clockwise-out one three.js keeps by default:
every closed body on that stage has a **positive signed volume** (Mountain12x12
1089, Mountain10x10 391, the Sanctuary 54), and the negative ones are the sheets
of grass, which are the two-sided materials anyway. Per-triangle winding
compared against the *authored* normals is a much weaker signal — 65% agreement
whichever kind of part it is measured on — so the volume is what settles it.

Textures are `.dds` — 1024² **DXT3** for the mountain. `src/dds.js` decodes
DXT1/3/5 to RGBA. `tools/render-textured.js` samples the texture per face and
proves the mesh + UVs + texture all line up (see the rendered previews).
Reference chain: `Model.xdb` → `Material` → `Texture` → `*.tga.xdb` → `.dds`.

## 6. Writing: a mesh of our own **[OK]**

The container is **closed**: `src/scene/geometry-write.ts` decodes a geometry
file and re-encodes it, and on **all 3572 shipped geometries the result is byte
for byte the original** (`node tools/test-geometry-write.ts --all`). That is the
whole proof, and it took no game run at all — the earlier attempt, rebuilding a
mesh inside a donor's container, cost six of them and drew nothing every time.

### 6.1 The grammar, exactly

Every record is `<tag byte> <size field> <payload>`, and the size field is
**width-flagged**:

| first byte | meaning |
|---|---|
| even, `s` | the payload is `s / 2` bytes and starts at the next byte |
| odd | a u32 sits here; the payload is `(v − 1) / 2` bytes and starts 4 bytes on |

The writer picks the compact form whenever the payload fits in 127 bytes, and
that rule is **measured**: across every shipped file no record of 127 bytes or
less uses the long form, and none longer uses the short one. `tag 08 <u32>` — the
"scalar" of §2 — is just this rule with `s = 8`, not a separate form.

Whether a payload holds more records or raw data is in the engine's compiled
schema. Ours is one set of paths (`CONTAINERS` in geometry-write.ts); everything
outside it round-trips as bytes, which is why the writer is exact even on fields
we have never looked at.

### 6.2 The tree, in full

```
/4                     u32 version (always 4)
/1                     root
  /2                   the mesh list
    /2                 u32 block count
    /1  …              one block per named mesh (<MeshNames> order)
      /2               u32 group count
      /1  …            one group per material slice:
        /2  positions  count × float3      the only array with coordinates
        /3  vertices   count × 20 bytes    uv, uv2, normal, tangent, binormal
        /4  skin       count × 24 bytes    empty on some static meshes
        /5  remap      count × u16         render vertex → position
        /6  first twin count × u16         render vertex → first one at that position
        /7  triangles  count × 3 u16       into the render vertices
        /8  { /2: u32 }                    zero in all 14550 shipped groups
        /9  u32                            triangle count (0xffffffff when none)
        /10 float                          a small length, see below
        /11 byte                           0 in a third of groups, junk elsewhere
        /12 u32                            0xffffffff in most
  /3                   one byte (1 in 3137 files, 64 in 422)
/0 /2 /5               three empty records closing every file
```

An array is framed as `1: u32 count` then `2: data`; an **empty** array keeps
the count record and drops the data record entirely.

### 6.3 The doubled payload was never a copy

§4 said the file "stores the whole payload twice". It does not: the outer block
**declares** how many mesh blocks follow, and the count always matches
(3572 of 3572 files). Two blocks that look identical differ where it matters —
in 55B3D719 the two are the same shape bound to **different bones**, one byte
apart in the skin array. De-duplicating by shape drops a real mesh.

### 6.4 Field 6 is not a copy of field 5 either

They are equal in only 754 of 2501 groups. The rule, and it reproduces the
shipped array **exactly in all 14542 groups checked**:

> `field6[i]` = the index of the FIRST render vertex standing at the same
> position as `i` — `i` itself when it is that first one.

It is how split vertices find their way back to each other, which is what
anything working per corner rather than per drawn point (skinning, smoothing)
needs. The narrower rule — same position *and* same attributes — holds in only
441 groups, so the position alone decides.

### 6.5 The junk fields

Fields 10..12 are **uninitialised memory** in part of the library: the geometry
of an empty model (B2448D7C) holds `"icle"`, `"I"` and `"ance"` there — slices
of the string `"(ParticleInstance)"` left on the exporter's stack. A field the
exporter is willing to leave as garbage is one the engine does not depend on.

Field 10 is a length all the same, where it is a number at all: over 1690 groups
measured against their own geometry it correlates **0.95** with the mean edge
length (at a ratio of about a third) and sits below all but ~4% of the edges. A
flat 6×6 plane of nine quads stores exactly `2.0` — its quad size and its
shortest edge. So a mesh of ours declares its shortest edge, which is both the
clearest sample's value and inside the shipped range.

### 6.6 What authoring looks like

```ts
const cube = boxGroup([0, 0, 1], [0.55, 0.55, 0.55]);   // 8 positions, 24 render vertices
const bin  = buildGeometry([[rotateGroup(cube, tilt, [0, 0, 1])]]);
const xml  = modelDocument({ uid, bbox: groupBBox([cube]), materials: [{ texture }] });
```

Six faces cannot share vertices — each corner needs three normals and three
texture coordinates — which is exactly what the remap is for: eight corners
stored once, referenced four times each. Winding is counter-clockwise seen from
outside, giving a positive signed volume; that is the convention every closed
shipped mesh follows and the one that decides which side a single-sided material
culls (§5).

The Pandora's Box is the first object built this way: model, geometry document
and texture, nothing copied (`src/mods/pandora-files.ts`).

### 6.7 Never write an inline reference

A model may carry its materials and geometry in its own file, as
`href="#n:inline(Material)"`, and the first documents of ours did. **The game
crashed loading the map.** Our own crash handler wrote the fault address; the
code there compares three bytes — `#`, `n`, `:` — takes that branch, calls a
resolver and dereferences the result **without testing it**:

```
0x9aa7cb  cmp byte ptr [ecx],23h      ; '#'
0x9aa7d4  cmp byte ptr [ecx+1],6Eh    ; 'n'
0x9aa7de  cmp byte ptr [ecx+2],3Ah    ; ':'
…
0x9aa80d  call 0094AB92h              ; resolve
0x9aa812  mov esi,eax                 ; …whatever it answered
0x9aa817  cmp byte ptr [esi+60h],0    ; ← esi = 0, access violation
```

What it resolves through is the element's own `id`: **all 4385 inline
references in the shipped models carry `id="item_<guid>"`, and not one lacks
it.** Ours had none.

Rather than guess what an id must be, our documents use the other shipped form
— materials and geometry as **documents of their own, referenced by path**,
which is how `Artefakt.(Model).xdb` is written and how 1277 shipped models point
at their geometry. `tools/test-pandora.ts` fails the build if any inline
reference appears without an id.

Two smaller conventions worth matching while writing documents, both measured:
an opaque DXT1 texture says `CONVERT_ORDINARY` (325 shipped DXT1 textures do,
12 say `CONVERT_TRANSPARENT`), and a DXT1 mip chain **stops at 8×8** rather than
running to 1×1 — every one of the 328 shipped DXT1 surfaces does.

## 7. Still open

* Exact UV2 / tangent-basis decode (only base UV is needed for texturing).
* Skeletons (`bin/Skeletons/`) and animations (`bin/animations/`) are a separate
  format — RAD's Granny GR2 (**docs/GR2_FORMAT.md**), packed with Oodle1
  (**docs/OODLE1_FORMAT.md**); what the structures mean is
  **docs/ANIMATION_FORMAT.md**. The vertex-to-bone binding they need, though,
  lives in this container: it is the tag-4 block above.

## 8. Tools

| tool | purpose |
|---|---|
| `tools/test-geometry-write.ts` | the round trip (`--all` for every shipped file) and the box's own checks |
| `tools/tree-geometry.js` | print the container as an indented record tree |
| `tools/walk-geometry.js` | flat sequential record walk (grammar sanity check) |
| `tools/inspect-geometry.js` | locate the position buffer by bbox match |
| `tools/extract-mesh.js` / `extract-mesh2.js` | positions + candidate indices → OBJ |
| `tools/mesh-to-obj.js` | Model.xdb → full v/vt/vn OBJ + edge-length check |
| `tools/render-textured.js` | textured per-face SVG preview (uses src/dds.js) |
| `tools/obj-to-viewer.js` | standalone canvas viewer for an extracted OBJ |

## 9. Reference

WindBell's 2009 terrain analysis (same container family):
heroescommunity.com thread TID=32009. No public tool decodes the mesh geometry
outbound; the community pipeline (Maya 6.0 + MECP + editor CUDE plugin) only
imports *into* the game.

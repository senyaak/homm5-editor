# HoMM5 geometry format (`bin/Geometries/<uid>`) — reverse-engineering notes

Status: **textured meshes decoded**. Container grammar, vertex positions, the
vertex-split remap, the triangle index buffer and **UVs** are decoded and
verified (0 stray edges; UV edge-continuity confirmed). Normals are computed
from geometry (the packed stored normals are imprecise). Textures (`.dds`,
DXT1/3/5) decode via `src/dds.js`. Per-submesh material split remains open.
This document records exactly what is known so the work is resumable and auditable.

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

The binary is a tree of records. Every record starts with a 1-byte **tag** in
`0x01..0x0f`. The byte after the tag selects the payload:

| form | bytes | meaning |
|---|---|---|
| scalar int32 | `tag 08 <u32 LE>` | a number (counts, flags, version) |
| length-prefixed block | `tag <u32 sizeB> <body>` | `byteLen = (sizeB − 1) / 2`; `sizeB` is always odd |

A block body is either a **node** (more records) or a **leaf** (a raw typed
array). The engine knows which from its compiled schema; we infer it from
context (a leaf's `byteLen` equals a just-declared count × a known stride).

This is the *same* container family as `GroundTerrain.bin`; there the array
marker byte is fixed `0x03`, here it varies — which is why a terrain-tuned
scanner misses these arrays.

### Header of the mountain sample, decoded

```
@0   tag4 int=4          format/version
@6   tag1 block 52832 B  whole payload
@16  tag2 int=2          (mesh/part count)
@22  tag1 block 26404 B  first half  ── the payload is stored TWICE [~]
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
| tag4 | 307 | 307×24 B | per-position normals / uv block |
| tag5 | 493 | 493×u16 (all < 307) | **remap**: render-vertex → position index |
| tag6 | 493 | 493×u16 | second remap (different attribute set) |
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
`src/geometry.js → extractMeshes()`; `node tools/mesh-to-obj.js` writes OBJ and
prints the edge-length check.

The file stores the whole payload **twice** (identical halves — LOD/copy);
`extractMeshes` returns the de-duplicated set.

## 5. Attributes and texture **[OK]**

Per render vertex the 20-byte attribute stream (tag3) is:

| bytes | field | decode |
|---|---|---|
| 0–3 | **UV** | 2× int16 ÷ 2048 (V spans [0,1], U tiles). Confirmed by UV edge-continuity |
| 4–7 | (zero / uv2 slot) | unused here |
| 8–19 | packed normal / tangent / binormal | 3× (signed byte ×3 + pad); imprecise |

Normals are **computed** from the triangle geometry instead of using the packed
ones (`computeNormals` in `src/geometry.js`). UVs are read by `extractMeshes`;
`tools/mesh-to-obj.js` emits a full `v`/`vt`/`vn` OBJ.

Textures are `.dds` — 1024² **DXT3** for the mountain. `src/dds.js` decodes
DXT1/3/5 to RGBA. `tools/render-textured.js` samples the texture per face and
proves the mesh + UVs + texture all line up (see the rendered previews).
Reference chain: `Model.xdb` → `Material` → `Texture` → `*.tga.xdb` → `.dds`.

## 6. Still open

* Per-submesh material assignment (`MeshNames` / `MaterialQuantities` in the .xdb)
  when a mesh has more than one material.
* Exact UV2 / tangent-basis decode (only base UV is needed for texturing).
* Skeletons (`bin/Skeletons/`) and animations (`bin/animations/`) — Tier D, not
  needed for a map editor (a static bind pose suffices).

## 7. Tools

| tool | purpose |
|---|---|
| `tools/tree-geometry.js` | print the container as an indented record tree |
| `tools/walk-geometry.js` | flat sequential record walk (grammar sanity check) |
| `tools/inspect-geometry.js` | locate the position buffer by bbox match |
| `tools/extract-mesh.js` / `extract-mesh2.js` | positions + candidate indices → OBJ |
| `tools/mesh-to-obj.js` | Model.xdb → full v/vt/vn OBJ + edge-length check |
| `tools/render-textured.js` | textured per-face SVG preview (uses src/dds.js) |
| `tools/obj-to-viewer.js` | standalone canvas viewer for an extracted OBJ |

## 8. Reference

WindBell's 2009 terrain analysis (same container family):
heroescommunity.com thread TID=32009. No public tool decodes the mesh geometry
outbound; the community pipeline (Maya 6.0 + MECP + editor CUDE plugin) only
imports *into* the game.

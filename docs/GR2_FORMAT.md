# Granny GR2 container (`bin/Skeletons`, `bin/animations`) — notes

Status: **decoded** (`src/gr2.ts`). Everything else under `bin/` is Nival's own
record container (see GEOMETRY_FORMAT.md); these two directories are not. They
are RAD Game Tools' **Granny GR2**, written by "Granny Standard Exporter, SDK
version 2.5.0.5" out of Maya 6. The game ships `bin/granny2.dll` (32-bit) to
read them.

What the files *contain* — bones, rest poses, curves — is in
ANIMATION_FORMAT.md. What they are *packed with* is in OODLE1_FORMAT.md. This
file is the container between the two.

Confidence: **[OK]** = verified against a redundancy in the data · **[~]** =
strong heuristic, not yet proven.

## 1. Why this one is different from every other format here

**A GR2 describes itself.** The file carries a tree of type definitions naming
every field of every structure it stores, so a reader walks it *by field name* —
`Bones`, `ParentIndex`, `InverseWorldTransform` — instead of by offsets inferred
from bounding boxes and stride arithmetic, which is what the mesh container
required. That is why `src/gr2.ts` is short for what it does, and why almost
nothing in it is a guess.

The cost is one layer of indirection: pointers are not usable as stored.

## 2. Header **[OK]**

Little-endian 32-bit flavour only. It is the only one the game ships, checked
across all 5656 files, and pointer size is baked into every structure size, so a
second flavour would mean a second layout table.

| offset | field |
|---|---|
| 0 | 16-byte magic `b867b0ca f86db10f 84728c7e 5e19001e` = LE32 |
| 16 | `headerSize` — equals `88 + 44 × sectionCount`, the cheap self-check |
| 32 | `version` (6 in every shipped file) |
| 36 | `fileSize` (matches the file exactly) |
| 40 | CRC |
| 44 | `sectionArrayOffset` — **relative to byte 32**, not to the file |
| 48 | `sectionCount` |
| 52 / 56 | root type reference: section, offset |
| 60 / 64 | root object reference: section, offset |
| 68 | `typeTag` (`0x80000010`–`0x80000015` here) |

**The trap:** `sectionArrayOffset` is relative to the info header at byte 32.
Read as file-absolute, every field of every section comes out shifted by eight
bytes — which still parses, and still looks plausible. The tell is `headerSize`
no longer equalling `88 + 44 × sectionCount`.

## 3. Sections **[OK]**

44 bytes each:

| offset | field |
|---|---|
| 0 | compression: 0 stored, 1 Oodle0, 2 Oodle1 |
| 4 / 8 | data offset in the file / stored size |
| 12 | decompressed size |
| 16 | alignment |
| 20 / 24 | `stop0` / `stop1` — where the 32-bit and 16-bit runs end (§5) |
| 28 / 32 | relocation table offset / count |
| 36 / 40 | mixed-marshalling table offset / count |

## 4. Relocations: why a pointer is never dereferenced **[OK]**

A pointer field in the stored data holds nothing useful. Each section carries a
relocation table — 12 bytes per entry: the offset of the pointer FIELD within
this section, then the `(section, offset)` it targets — and that table is what a
reader follows. **A field with no relocation entry is a null pointer.**

Two consequences worth knowing:

* The tables live outside the compressed payload, so they are readable even when
  a section is not. That makes them a ground truth: while chasing a
  decompression bug, the relocation entries can locate a structure in output you
  do not yet trust.
* Offsets are per section, so a reference is a pair, never a number.

## 5. How a section is split, and why it matters **[OK]**

Granny sorts a section's contents by field width — 32-bit fields first, then
16-bit, then bytes — and compresses each run as its own stream. `stop0` and
`stop1` are where those runs end **in the decompressed data**, and they are the
only record of how long each stream is. A run can be (and the middle one usually
is) empty.

Strings therefore live in the LAST run. A section whose final stream fails to
decompress still yields correct numbers and no names at all — which reads, at
first glance, exactly like a decoder that has gone wrong everywhere.

## 6. The type tree **[OK]**

`rootType` points at a list of members, 32 bytes each in the 32-bit layout:

| offset | field |
|---|---|
| 0 | member kind (the enum below; 0 ends the list) |
| 4 | name pointer |
| 8 | pointer to the element's own type definition |
| 12 | array width for fixed scalar arrays (`Real32[3] Origin`) |
| 16 | `Extra[3]` |
| 28 | unused |

Member kinds, in the SDK's enum order — the index IS the stored tag:

```
0 End           6 (removed)            12 UInt8           18 NormalUInt16
1 Inline        7 ReferenceToVariantArray  13 BinormalInt8 19 Int32
2 Reference     8 String               14 NormalUInt8     20 UInt32
3 ReferenceToArray  9 Transform         15 Int16          21 Real16
4 ArrayOfReferences 10 Real32           16 UInt16         22 EmptyReference
5 VariantReference  11 Int8             17 BinormalInt16
```

Sizes in the 32-bit layout: `Reference` 4, `ReferenceToArray` 8 (count + pointer),
`ArrayOfReferences` 8 (count + pointer to pointers), `VariantReference` 8 (type +
object), `ReferenceToVariantArray` 12, `String` 4, `Transform` 68, `Real32` 4,
the 8-bit kinds 1, the 16-bit kinds 2, `Int32`/`UInt32` 4 — each times the array
width. `Inline` is the referenced structure's own size.

Type definitions are **recursive** — a bone's `ExtendedData` can point at a type
already being read — so a reader must publish the in-progress member list before
filling it, or it recurses forever.

## 7. `Transform`, and the matrix convention **[OK]**

68 bytes: a flag word (bit 0 position, bit 1 orientation, bit 2 scale-shear),
`Real32[3]` position, `Real32[4]` quaternion stored **x, y, z, w**, and a
`Real32[9]` scale-shear. **A component whose flag is clear is the identity**,
whatever bytes sit in its slot.

Matrices are row-major with the translation in the LAST ROW — the row-vector
convention (`v' = v · M`), not the column-vector one graphics code assumes. So
composition runs child-first: `world = local · parentWorld`, and the 3×3 is
`scaleShear · rotation`.

None of that was assumed. `checkSkeleton` measures it against the file's own
inverse bind matrices, and every other combination of transpose and order is
wrong by order 1. Handing those matrices to three.js needs no transpose at all,
for the reason spelled out in ANIMATION_FORMAT.md §7.

## 8. Verification

`npm run test-gr2` reads a stride-spread sample of the library and checks only
redundancies the data itself carries: the header arithmetic above, one bind
frame per skeleton, curve widths, and knots inside their clip. It skips itself
when the game data is not unpacked.

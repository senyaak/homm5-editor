# Oodle1 decompression — notes

Status: **ported** (`src/oodle.ts`), 2837 of the 2839 packed files in the
library. Oodle1 is RAD Game Tools' old LZ-over-adaptive-arithmetic codec, and it
is what the compressed sections of a Granny GR2 are packed with — every file
under `bin/Skeletons/`, and a sixth of `bin/animations/`.

Written from the open specification at `LunaticInAHat/liboodle` (Unlicense),
which documents the format down to pseudocode and names Heroes of Might and
Magic V as an example of it. The alternative was calling `GrannyDecompressData`
in the game's own `bin/granny2.dll` — but that DLL is 32-bit and the editor's
Node is 64-bit, and a process cannot load a DLL of the other bitness, so it
would have needed a sidecar process and a dependency on the game install.

The container this sits inside is GR2_FORMAT.md; what the decompressed bytes
mean is ANIMATION_FORMAT.md.

## 1. Census

| directory | files | packed | plain |
|---|---|---|---|
| `bin/Skeletons` | 2247 | **2247** | 0 |
| `bin/animations` | 3409 | 592 | **2817** |

Of the 106 idle clips an animation set actually names, 105 decode. The two
holdouts in the whole library are one building idle (`ShamanOfNommads`) and one
animation nothing references; both fail mid-stream. A section that fails leaves
its data null, and the object falls back to its still mesh.

## 2. Block header

Each compressed section opens with **three 12-byte headers** — one per stream,
36 bytes total — followed by all three streams' bits back to back.

| word | bits | field |
|---|---|---|
| 0 | 0–8 | `litAlphabetSize` (256 in practice) |
| 0 | 9–31 | `windowSize` (262143 = 256 KiB − 1) |
| 1 | 0–8 | `uniqLitCount` — distinct literals this stream uses |
| 1 | 19–38 | `largest1KOffset` — **stored in bytes, always a multiple of 1024** |
| 2 | 24–31 / 16–23 / 8–15 / 0–7 | `uniqRepLens[0..3]` |

`largest1KOffset` is used as a count of kilobytes: taken as the byte value it
would exceed the coder's alphabet — 11264 against 257 — and the coder would
never learn a symbol at all.

## 3. Three layers

1. **Bitstream.** Produces fixed-point numbers in [0, 1) against a
   caller-chosen denominator. Its oddity is the "7+1 split": each input byte
   contributes its top seven bits to the register immediately and holds its LSB
   back until the next byte arrives. The register and its modulus stay under
   2^31, so plain arithmetic is exact in a double — no 32-bit bitwise operator,
   which would go signed.
2. **Symbol coder.** Adaptive arithmetic coder that learns as it goes, with an
   ACTIVE alphabet of frequency-proportional spans, a PROBATIONARY one of
   symbols seen since the last renormalization, and an escape at index 0 leading
   to either. Weights decay (halve, dropping the exhausted) and renormalize
   (spans rebuilt from weights) on their own thresholds.
3. **LZ.** Literals and (length, offset) repeats through ~330 of those coders,
   chosen by context: 4 literal coders by output position mod 4, 65 length
   coders by the previous length code, and three offset digits —
   `offset = kilo·1024 + quad·4 + byte`, with the four-byte digit's coder
   selected by the kilobyte digit.

Repeat lengths: code 1..60 → length 2..61, then 61 → 128, 62 → 192, 63 → 256,
64 → 512. There is no length between 62 and 127.

## 4. The three rules that were measured, not read

All three leave a decoder producing *plausible* output for thousands of bytes
before it collapses somewhere unrelated, which is what made them expensive.

1. **The renormalization interval is `max(128, min((alphabetSize − 1) · 2,
   decayThreshold / 2 − 32))`, and that is NOT a clamp.** The two forms differ
   exactly when the upper bound falls below 128, which happens for one coder in
   the whole scheme: the four-symbol one coding the low two bits of an offset,
   whose decay threshold of 256 puts its upper bound at 96. Written as a clamp
   it renormalizes every 96 symbols where the encoder used 128, drifts after
   about a hundred matches, and the stream then decodes plausibly for thousands
   of bytes before an offset lands before the start of the data. This one line
   was the difference between 80% of sections and 99%.
2. **The three streams share ONE bit reader.** They are not byte-aligned blocks
   — the coder never flushes between them — so a stream transition lands
   mid-byte. Restarting the reader at any byte boundary (measured: every offset
   within ±10, and an exhaustive scan of one whole section) decodes to noise.
3. **But the output buffer is shared, and a match may reach back across a stream
   boundary.** The LZ state — byte counter, match window, literal-coder choice —
   restarts per stream, so at the start of the last stream every offset alphabet
   is one symbol wide and the only encodable offsets are 1 to 4: the tail of the
   previous stream. Twenty-two files open on exactly that match.

## 5. How to test a change here — and how not to

**"The section decompressed without throwing" is not a measure of correctness,
and optimising for it actively misleads.**

Bounding the offset digits by the room the window leaves is what the arithmetic
plainly implies: given the kilobyte and byte digits, the four-byte digit cannot
claim more than `(reach − kilo·1024 − byte) / 4`. It takes the library from two
failing sections to zero — and *silently corrupts every skeleton it touches*,
bone names coming out as runs of `gggg`. Three further changes were stacked on
top of it, each judged by how few sections threw, before the duplicate-skeleton
oracle caught the lot: 0 of 6 skeletons intact where the committed decoder had
6 of 6.

The oracle: **the game ships the same skeleton twice** — packed under
`bin/Skeletons/`, and again plain inside the animation that plays on it.
Decompressed, the two must agree bone for bone, name for name, parent for
parent, with the floats reproducing each file's own inverse bind matrices to
1e-4. An arithmetic decoder that is nearly right produces noise, not
near-agreement, so nothing about that can happen by accident.

Run `npm run test-oodle`. Judge by that, never by a failure count.

## 6. Ruled out, so nobody pays twice

Measured and rejected while hunting the residual: the stream-transition rule
(four models compared), the per-stream reset of LZ state, decay (disabling it
changes nothing — it barely runs), the probationary path (every variant far
worse), the polarity of its selector bit, the unique-symbol counts of every
coder, the offset reconstruction, the window bound (±1), treating a
single-symbol alphabet as uncoded, and the repeat-length table (confirmed
identical to the reference).

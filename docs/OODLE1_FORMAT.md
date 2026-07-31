# Oodle1 decompression — notes

Status: **ported** (`src/format/oodle.ts`), byte-exact against the game's own decoder
on every packed section in the library — all 2839 files, all 5678 sections.
Oodle1 is RAD Game Tools' old LZ-over-adaptive-arithmetic codec, and it is what
the compressed sections of a Granny GR2 are packed with — every file under
`bin/Skeletons/`, and a sixth of `bin/animations/`.

Written from the open specification at `LunaticInAHat/liboodle` (Unlicense),
which documents the format down to pseudocode and names Heroes of Might and
Magic V as an example of it. The alternative was calling `GrannyDecompressData`
in the game's own `bin/granny2.dll` — but that DLL is 32-bit and the editor's
Node is 64-bit, and a process cannot load a DLL of the other bitness, so it
would have needed a sidecar process and a dependency on the game install.

The DLL did end up mattering, twice, both times offline (§5): a throwaway
32-bit C# shim turned it into a byte-exact oracle for the whole library, and
when the spec ran out, disassembling its decoder (capstone on the `.text`
section; `_GrannyOodle1Decompress@20` → the symbol coder at `0x50046530`)
settled what the real codec does. Nothing at runtime touches it.

The container this sits inside is GR2_FORMAT.md; what the decompressed bytes
mean is ANIMATION_FORMAT.md.

## 1. Census

| directory | files | packed | plain |
|---|---|---|---|
| `bin/Skeletons` | 2247 | **2247** | 0 |
| `bin/animations` | 3409 | 592 | **2817** |

All of it decodes, including every one of the 106 idle clips an animation set
names. The two files that once failed mid-stream — the `ShamanOfNommads`
building idle and the `Quarok_Mounted-arena-happy` hero clip — were the loud
symptom of the decay-gate rule (§4.4); twenty more sections were decoding
*silently wrong* past ~54 KB until the same fix. A section that cannot be read
still degrades the same way: data left null, the object falls back to its still
mesh.

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

## 4. The four rules that were measured, not read

All four leave a decoder producing *plausible* output for thousands of bytes
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
4. **Decay fires when the *renormalization threshold* crosses the decay
   threshold — not when the live total does.** The open spec (and its reference
   implementation) write `if total >= decayThreshold`; the DLL compares the
   coder's `nextRenormalize` instead (`cmp ax, [esi+8]` at `0x50046540`, with
   `ax` holding the threshold). The two agree except when the threshold sits
   one or two units below the decay threshold and the total steps over both at
   once — escapes add 2 — which happens once in tens of thousands of decodes.
   Each such decay ran one cycle early, the model drifted, and the drift stayed
   invisible while the quantized spans still rounded to the same values: every
   animation whose coders lived long enough (~85 KB of output and up, 22
   sections) decoded plausible bytes to ~54 KB and garbage after, and nothing
   below that size was touched at all. Found by correlating first-wrong-byte
   positions against a trace of model events (12 of 13 sat one op after a
   first `len0` decay), then reading the real condition out of the
   disassembly. This was the last divergence from the DLL: with it fixed the
   port is byte-exact on the entire library.

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

The first oracle: **the game ships the same skeleton twice** — packed under
`bin/Skeletons/`, and again plain inside the animation that plays on it.
Decompressed, the two must agree bone for bone, name for name, parent for
parent, with the floats reproducing each file's own inverse bind matrices to
1e-4. An arithmetic decoder that is nearly right produces noise, not
near-agreement, so nothing about that can happen by accident.

That oracle has a blind spot, and it bit: skeletons are small, and a model
drift that needs ~50 KB of output to surface (§4.4) passes every skeleton
comparison while corrupting a fifth of the big animations. The oracle that
closed it is the game's own decoder: a ~30-line C# shim compiled with the
32-bit `csc.exe` that ships in every Windows (`-platform:x86`) P/Invokes
`_GrannyDecompressData@32` from `bin/granny2.dll` and writes the true bytes to
disk; compare ours against them over the whole library. When even that only
says *where* the two diverge, not *why*, the last resort is reading the DLL
itself — python + capstone, walk the PE exports to `_GrannyOodle1Decompress@20`,
and the decoder's whole call tree (decode `0x50046530`, decay `0x50046790`,
renormalize `0x50046480`) is a few hundred instructions that map one-to-one
onto the spec's pseudocode — close enough to diff by eye against your own code.

Run `npm run test-oodle`. Judge by that, never by a failure count.

## 6. Ruled out, so nobody pays twice

Measured and rejected while hunting the last divergences: the stream-transition
rule (four models compared), the per-stream reset of LZ state, the decay
*mechanics* — escape weight kept or rounded up, drops at zero only or none at
all, probationary symbols spared, the heaviest-symbol tie and swap rules — all
variants scored against the DLL over a 99-section corpus and every one lost to
the gate condition in §4.4, the probationary path (every variant far worse),
the polarity of its selector bit, the unique-symbol counts of every coder, the
offset reconstruction, the window bound (±1), treating a single-symbol alphabet
as uncoded, and the repeat-length table (confirmed identical to the reference —
including in the DLL, as the jump table at `.rdata:0x5d62c`).

Also checked against the disassembly and found identical to the spec: the
decay loop itself, renormalize (including the `0x20000 / total, >> 3` quanta
trick and the rapid-interval doubling), the escape/probationary/new-symbol
paths and their +2 weights, the escape close when the alphabet completes, and
the bitstream. The DLL stores spans biased by `0x8000` and walks them with an
unrolled stride ladder instead of a scan — representation choices, not format.

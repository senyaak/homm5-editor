# Matching the engine number for number

For ports that must reproduce the engine exactly (the random map generator,
[RMG.md](../RMG.md)).

## Arithmetic

- Everything matches but the last bits → read the FPU control word (and MXCSR)
  in that place, in that process, before any new hypothesis. The map editor
  runs at `0x0C7F`: single precision, round toward zero. Emulate by rounding
  the exact result (Dekker products, remainders), not a rounded double
  (`src/exe/x87.ts`).
- One case in hundreds wrong, exactly on a boundary, divisor not a power of
  two → suspect round toward zero first.
- One source fitted by two different formulas (game vs editor) → stop fitting
  and read the code: it is one code at two precisions.
- Never `Math.hypot` where a distance is truncated or compared with an
  integer; use `tileDistance()` (`fround(sqrt(dx*dx+dy*dy))`).
- Hold every field at the engine's width, taken from the instruction
  (`or dword`, `[eax+ecx*4]`), not from the known values.

## Comparing two runs

- Count the differing records first: one = a boundary (invert the arithmetic
  from the record itself; check by sabotaging a neighbour), many = data.
- Two sides drawing from the same bound: bracket the suspected procedure with
  the draw counter at entry and exit; log the bound, not only the value.
- Branches that cost the same draws are invisible to a stream differ: compare
  the STATE at the phase boundary, not the stream.
- Align series by content: try shifts −2…+2, take the longest prefix on an
  independent quantity, print the shift used.
- List the settings no reference varies; everything they branch is unverified
  — order the extreme values and compare.
- An order-dependent tie-break over a symmetric set is unverified until a case
  that distinguishes the order exists; name that condition and look for it.
- A branch read cleanly that "does not fire" in a measurement: look where its
  effect is not masked (clamps, zeroing, tolerances) before removing it.
- Two consumers of one field disagree → find the writes between their reads.

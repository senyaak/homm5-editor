# Matching the engine number for number

A port that must reproduce the engine exactly — the random map generator is
byte-for-byte — fails in ways that look like logic and are arithmetic, order,
or the comparison itself. Each rule here cost days on the RMG port
([RMG.md](../RMG.md)).

## Arithmetic

- **The FPU mode is process state.** The same instructions give different
  numbers under a different control word, and the disassembly does not show
  it. The map editor runs at `0x0C7F` — SINGLE precision and round TOWARD ZERO
  (Direct3D sets it when it creates the device) — and ten minimap bytes
  disagreed for weeks while filter, sine table and summing were each
  "cleared". If everything matches but the last bits, read the control word
  (and MXCSR) in that place and that process: a three-line detour with
  `fnstcw`. Emulate by rounding the EXACT result (Dekker for a product, the
  remainder for a quotient), not an already rounded double — double rounding
  is wrong in about a quarter of the boundary cases. `src/exe/x87.ts`.
- **Round toward zero is the suspect when one case in hundreds sits exactly on
  a boundary** (a whole pixel, a whole tile) and the divisor is not a power of
  two. Truncation only breaks an approach to the boundary from ABOVE with a
  positive sum — which is why the other "whole" anchors held.
- **Two fitted forms for one source are one code at two precisions.** The game
  and the editor needed two different "only forms of thirteen that explain the
  bytes"; both were precision artefacts of one loop. As soon as one source has
  two models, stop fitting and read the code.
- **`Math.hypot` is inexact**: `Math.hypot(99, 20)` is 100.99999999999999. The
  engine computes `sqrtss(dx*dx + dy*dy)`, exact for whole tiles, and every
  consumer truncates or compares with a strict integer bound — so one ulp is
  "a candidate or none". Use `tileDistance()` (`fround(sqrt(dx*dx+dy*dy))`).
- **Hold a field at the engine's width.** A `Uint8Array` for a dword field
  dropped bit `0x400`, and a far-away `cmp …,40h` then matched a tile it
  should not have — the symptom surfaced three phases away. Take the width from
  the instruction (`or dword`, `[eax+ecx*4]`), never from the set of known
  values.

## Comparing two runs

- **One record differing out of thousands is a boundary**, not broken data —
  data errors come in batches. Invert the arithmetic from the record itself
  (a guard's stacks give the budget to an interval; a trace's `below(n)` gives
  another; they meet in one). Check the alternative by sabotaging a neighbour:
  shift the sum by one and see what else breaks.
- **Bracket the call when values collide.** A value trace only says "differs",
  not where, when two places draw from the same bound — they gave the same
  number by chance and parted on the next. A detour writing the draw counter at
  a procedure's entry and exit names whose draws they are. Log the BOUND, not
  only the value: "from 3 against from 30" names the loop.
- **Equal-cost branches are invisible to a counter.** If accepting and
  rejecting both cost one draw, the stream stays in step and the first
  reported difference is far from the cause (the differ named draw 53561; the
  cause was 200 draws earlier in another procedure). "The stream matched" is
  not "the STATE matched" — dump the state at the phase's boundary and compare
  it whole.
- **Align two series by content, not by numbering.** 0-based against 1-based,
  an extra group at the start, a step before the loop: an off-by-one gives a
  coherent wrong story (3899 "disagreements" where there were none). Try
  shifts −2…+2, take the one with the longest matching prefix on an
  independent quantity, and print "aligned with shift N, K matched".
- **A setting no reference varies hides its branches.** All 88 compared maps
  were MEDIUM monsters; WEAK and IMPOSSIBLE showed a separate garrison table, a
  fall-through between branches, and three different "< 100" gates — and a
  port that had been broken the whole time. List the settings the references
  never vary, call everything they branch unverified, and order the EXTREME
  values.
- **Symmetry hides traversal order.** Visiting eight neighbours or four sides
  in the wrong order gives the same elements and counts until a tie is
  decided by order ("first maximum", "insert at head"). The last diverging
  template needed two zones sharing a hash bucket — impossible under fourteen
  zones. Treat any order-dependent tie-break as unverified until a case that
  distinguishes it exists.
- **A fix that improves the count can still be wrong.** Two errors alibi each
  other: a swapped noise index was invisible while "digging" was off, and
  turning the digging on looked worse. A branch read cleanly in the
  disassembly that "does not fire" in a measurement is a question — find where
  its effect is not masked (clamped, zeroed, compared with a tolerance).
- **Two readers of one field disagree → a write between their reads**, not
  wrong arithmetic in the one that "does not fit". Find the field's writers;
  an early exit in a writer ("angle unchanged — return") makes the call order
  the answer.

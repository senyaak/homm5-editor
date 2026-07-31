// The generator's source of chance, as the executable computes it.
//
// EVERYTHING ELSE IN THE PORT DEPENDS ON THIS. A random map is a long sequence
// of decisions, each one reading the next number; get the number stream wrong
// and every later phase diverges no matter how faithfully it was ported. So
// this is the one module that has to be exact before any other can be judged.
//
// WHAT IT IS. A 64-bit linear congruential generator with the constants MSVC's
// own `rand()` uses (0x343FD / 0x269EC3), widened from 32 bits to 64 and with a
// bigger shift to match. Read at 0xeb13a0 in the unwrapped executable:
//
//     state = state * 0x343FD + 0x269EC3      (mod 2^64)
//     return (state >> 23) & 0x7FFFFFFF
//
// The state is seeded SIGN-EXTENDED (`cdq` at 0xeb1330): a negative seed fills
// the high half with ones rather than zeros, so `(int32)seed` and not
// `(uint32)seed` is what enters the state.
//
// THE COUNTER IS NOT DECORATION. The engine increments a counter on every draw
// and logs it at the end of each phase — "Rnd Counter(FillZones): %d.". That
// makes it the cheapest possible check on a port: run the same seed through
// both and compare counts phase by phase. A mismatch says *where* the reading
// went wrong, which a differing map never does. So `draws` is kept exactly as
// the engine keeps it — incremented by the two drawing functions and by nothing
// else, and NOT by seeding.
//
// See docs/RMG.md and docs/RMG_CODE_MAP.md.

const MULTIPLIER = 0x343fdn;
const INCREMENT = 0x269ec3n;
const MASK64 = (1n << 64n) - 1n;

/** `(state >> 16)` keeps 47 bits — the dividend `below()` works from. */
const MASK47 = (1n << 47n) - 1n;

export class RmgRandom {
  /** The 64-bit state. BigInt because 64-bit wrap-around is the whole point. */
  private state: bigint;

  /** How many numbers have been drawn — the engine's "Rnd Counter". */
  draws = 0;

  /** The seed as the map records it (`sRMGProps/RMGstartseed`). */
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    // Sign-extended, exactly as `cdq` does it at 0xeb1330.
    this.state = BigInt.asUintN(64, BigInt(this.seed));
  }

  /** Advance the state. Every draw goes through here, counter included. */
  private step(): bigint {
    this.draws++;
    this.state = (this.state * MULTIPLIER + INCREMENT) & MASK64;
    return this.state;
  }

  /**
   * The plain draw — 31 bits, `0 .. 0x7FFFFFFF` (0xeb13a0).
   *
   * Safe as a JS number: 31 bits fit with room to spare.
   */
  next(): number {
    return Number((this.step() >> 23n) & 0x7fffffffn);
  }

  /**
   * A number below `limit` (0xeb13e0), the engine's workhorse.
   *
   * It is NOT `next() % limit`: it takes a different 47-bit slice of the state
   * and takes the remainder of that. Using the wrong slice gives numbers in the
   * right range that are the wrong numbers — a bug that looks like nothing at
   * all until a map diverges a thousand draws later.
   *
   * `limit === 0` returns 0 *without drawing*, the way the guard at 0xeb13e5
   * returns before touching the state — so a zero-count loop leaves the stream
   * where it found it.
   */
  below(limit: number): number {
    if (limit === 0) return 0;
    const value = (this.step() >> 16n) & MASK47;
    return Number(value % BigInt(limit >>> 0));
  }

  /** Inclusive range, the form most call sites want. */
  between(low: number, high: number): number {
    return low + this.below(high - low + 1);
  }
}

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

/**
 * 1/2^31, the float at 0xff4aa0 — what turns a 31-bit draw into `0 .. 1`.
 *
 * Written as the division rather than the decimal the disassembler prints:
 * 4.656612873077393e-10 is that number rounded to a float, and rounding a
 * decimal back is one more thing that can be off by an ulp.
 */
const SCALE = Math.fround(1 / 2 ** 31);

import { DOUBLES } from './arith.ts';
import type { Arith } from './arith.ts';

/** One float32 and its bits — the hook's union, spelled in JavaScript. */
const FLOAT_BITS = new Float32Array(1);
const INT_BITS = new Int32Array(FLOAT_BITS.buffer);

export class RmgRandom {
  /** The 64-bit state. BigInt because 64-bit wrap-around is the whole point. */
  private state: bigint;

  /** How many numbers have been drawn — the engine's "Rnd Counter". */
  draws = 0;

  /**
   * When set, hears every draw: which entry drew and what came out — the
   * port's half of the oracle's `trace` lines (kinds `tn`/`t6`/`tb`/`tf`).
   * `between` reports as `b` because the engine's own between draws through
   * below, and the trace mirrors what the detours see. For `f` the value is
   * the FLOAT'S BITS, matching the hook's union trick.
   *
   * `limit` comes with a `b` draw and is the half that identifies the call
   * site: two sides drawing different numbers only disagree, while "one of 3
   * against one of 30" names which loop they are in.
   */
  onDraw: ((kind: 'n' | '6' | 'b' | 'f', value: number, limit?: number) => void) | null = null;

  /** The seed as the map records it (`sRMGProps/RMGstartseed`). */
  readonly seed: number;

  /**
   * Which machine the one float draw is computed on.
   *
   * `betweenFloat` is the only arithmetic in this class, and it is the most
   * seed-critical float in the generator: one ulp parted `S3-5P2Z7N2.2` at
   * draw six. The editor computes it at double precision and rounds once at
   * the store; a host running at `0x0C7F` rounds every step toward zero
   * instead. See `arith.ts`.
   */
  arith: Arith = DOUBLES;

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
    const value = Number((this.step() >> 23n) & 0x7fffffffn);
    this.onDraw?.('n', value);
    return value;
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
    const value = Number(((this.step() >> 16n) & MASK47) % BigInt(limit >>> 0));
    this.onDraw?.('b', value, limit);
    return value;
  }

  /**
   * Inclusive range (0xeb1450) — the form most call sites want.
   *
   * The engine has this as its own function rather than composing it, and it
   * composes to exactly this: same 47-bit slice, same remainder, plus the low
   * end. Including the empty case — `high < low` makes the span 0, and the
   * engine returns `low` having drawn nothing, which is what `below(0)` does
   * here.
   */
  between(low: number, high: number): number {
    return low + this.below(high - low + 1);
  }

  /**
   * The whole 63-bit state (0xeb1360), returned as a BigInt.
   *
   * A third slicing of the same step: no shift at all, just the low word and
   * the high word with its top bit cleared. Rare, but a phase that uses it and
   * gets `next()` instead would be off by everything.
   */
  next63(): bigint {
    const state = this.step();
    const value = (state & 0xffffffffn) | (((state >> 32n) & 0x7fffffffn) << 32n);
    // The hook logs the low 31 bits — enough to recognise, cheap to carry.
    this.onDraw?.('6', Number(value & 0x7fffffffn));
    return value;
  }

  /**
   * A fractional number in `a .. b` (0xeb14d0).
   *
   * This is where `Zone #%d … k == %2.2f` comes from, so getting it exactly
   * right matters for the very first phase that grows anything.
   *
   * The engine draws the same 31 bits as `next()` and interpolates — and the
   * two builds do it differently, which is the trap this port has walked into
   * four times now. The GAME (`0xEB14D0`, SSE) puts the draw through
   * `cvtpd2ps` FIRST, so a 31-bit integer is squeezed into a float's 24-bit
   * mantissa before anything else, and every step after it is an `ss`. The
   * EDITOR (`0xCFD330`, x87) keeps the whole thing on the stack —
   *
   *     fild [esp]              ; the full 31 bits, no rounding
   *     fld b; fsub a; fmulp    ; draw * (b - a)
   *     fmul [1172694h]         ; * 2^-31, exact, a power of two
   *     fadd a
   *
   * — and rounds once, where the caller stores the result. The reference maps
   * are the EDITOR's, so this port speaks the editor's arithmetic: one
   * `Math.fround` at the end and none in the middle. The difference is a
   * single ulp and it is not cosmetic — it is what parted `S3-5P2Z7N2.2` at
   * the second seed's water order, at draw SIX of the whole run.
   */
  betweenFloat(a: number, b: number): number {
    // The engine's betweenFloat steps the state itself rather than calling
    // next(), so the trace must show ONE 'f', not an 'n' inside an 'f' — the
    // draw is inlined here for the same reason.
    const draw = Number((this.step() >> 23n) & 0x7fffffffn);
    // One instruction per step, in the order the disassembly above has them:
    // `fsub`, `fmulp`, `fmul`, `fadd`, and the caller's store. Under DOUBLES
    // that is `Math.fround(draw * (b - a) * SCALE + a)` to the bit — the
    // operations are the plain ones and only the store rounds.
    const ar = this.arith;
    const value = ar.store(ar.add(ar.mul(ar.mul(draw, ar.sub(b, a)), SCALE), a));
    if (this.onDraw) {
      FLOAT_BITS[0] = value;
      this.onDraw('f', INT_BITS[0]);
    }
    return value;
  }
}

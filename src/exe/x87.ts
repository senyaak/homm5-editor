// The editor's floating-point unit, as it is actually configured.
//
// Everything the map editor computes in x87 goes through a control word that
// is NOT the compiler's default: **precision control = single (24-bit) and
// rounding control = toward zero**. So `fmul`, `fdiv`, `fadd` do not keep 64
// bits of mantissa and do not round to nearest — each one lands on a float,
// and always the float NEARER TO ZERO.
//
// That is measured, not deduced. `native/rmg/minimap-probe.c` hooks the
// engine's own table sine (the editor's `0xED3A80`) and logs its argument and
// its answer; **6208 of 6208 calls of one minimap build** come out of this
// module's arithmetic exactly, and eight of them come out of doubles. The
// same log under round-to-nearest gets 2104.
//
// WHY THE FPU IS IN THAT STATE is not settled here and does not need to be —
// Direct3D is the usual reason a Windows process ends up at single precision,
// and the editor makes a device before it does anything else. What matters is
// that the reference maps were made by a process in this state, so the port
// speaks it wherever the answer is close enough to a boundary to care.
//
// WHERE IT IS USED. The minimap, which is the one place a rounding boundary
// has ever moved a byte of a reference file: the Lanczos filter, the sine
// under it and the resampler's own sums. The generator's arithmetic is left in
// doubles, where 136 reference maps say it belongs — a value that reaches a
// map as an integer or a tile index is not sensitive to the last bit, and
// changing it would be a change nothing measured asked for.
//
// HOW THE OPERATIONS ARE BUILT. Truncating a double is not enough: the x87
// computes the EXACT product (or sum, or quotient) and truncates that, while a
// double multiply has already rounded to 53 bits. The two differ whenever the
// exact value sits just below a 24-bit boundary and the double rounds up to
// it — and with an argument like `x * (1/3)` that is not rare at all, because
// a third of a dyadic x is often exactly a 24-bit number. So every operation
// here computes its own error term (Dekker's splitting) and truncates the
// exact result.

/** 2^27 + 1 — Dekker's splitting constant for the exact product. */
const SPLIT = 134217729;

/** The exact product of two doubles as a head and a tail. */
function twoProduct(a: number, b: number): [number, number] {
  const p = a * b;
  const ca = SPLIT * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = SPLIT * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  return [p, al * bl - (((p - ah * bh) - al * bh) - ah * bl)];
}

/** The exact sum of two doubles as a head and a tail. */
function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

/** The gap between neighbouring 24-bit values around `a` — `a` is not zero. */
function ulp24(a: number): number {
  const m = Math.abs(a);
  let e = Math.floor(Math.log2(m));
  // log2 is not exact at the binade edges; step onto the right one.
  if (2 ** e > m) e--;
  else if (2 ** (e + 1) <= m) e++;
  return 2 ** (e - 23);
}

/**
 * A double rounded to a 24-bit mantissa TOWARD ZERO.
 *
 * This is the store, not the operation: use it where the engine keeps a value
 * it computed elsewhere. For arithmetic use the four below, which truncate the
 * EXACT result rather than a result that has already been rounded once.
 */
export function tr24(v: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const s = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const u = ulp24(a);
  return s * (Math.floor(a / u) * u);
}

/** The largest 24-bit value not beyond `hi + lo`, where the pair is exact. */
function truncateExact(hi: number, lo: number): number {
  if (!Number.isFinite(hi) || hi === 0) return hi + lo === 0 ? hi : tr24(hi + lo);
  const sign = hi < 0 ? -1 : 1;
  let t = tr24(hi);
  const u = ulp24(hi) * sign;
  // `t - hi` is exact — they are within one 24-bit step of each other — so
  // comparing it with `lo` compares `t` with the exact value.
  if (sign > 0) {
    if (t - hi > lo) t -= u;                    // t overshot the exact value
    else if (t + u - hi <= lo) t += u;          // and the next one still fits
  } else {
    if (t - hi < lo) t -= u;
    else if (t + u - hi >= lo) t += u;
  }
  return t;
}

/** `fmul` under this control word: the exact product, truncated to a float. */
export function mul24(a: number, b: number): number {
  const [hi, lo] = twoProduct(a, b);
  return truncateExact(hi, lo);
}

/** `fadd` under this control word. */
export function add24(a: number, b: number): number {
  const [hi, lo] = twoSum(a, b);
  return truncateExact(hi, lo);
}

/** `fsub` under this control word. */
export function sub24(a: number, b: number): number {
  return add24(a, -b);
}

/**
 * `fdiv` under this control word.
 *
 * The quotient is checked by its remainder rather than by another error term:
 * `t` is right when `a - t*b` has the sign of `b` (so `t` is on the near side
 * of the exact quotient) and `a - (t+u)*b` does not.
 */
export function div24(a: number, b: number): number {
  const q = a / b;
  if (!Number.isFinite(q) || q === 0) return q;
  const step = ulp24(q) * (q < 0 ? -1 : 1);
  let t = tr24(q);
  /** Is `|v*b|` past `|a|` — that is, is `v` too far from zero to be the answer? */
  const over = (v: number): boolean => {
    const [hi, lo] = twoProduct(v, b);
    const [s, e] = twoSum(hi, -a);
    const d = s + (e + lo);
    // `v*b` and `a` share a sign, so "past" is away from zero on a's side.
    return a > 0 ? d > 0 : d < 0;
  };
  if (over(t)) t -= step;
  else if (!over(t + step)) t += step;
  return t;
}

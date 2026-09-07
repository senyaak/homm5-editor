// The generator's arithmetic, as a choice between two machines.
//
// WHY THERE ARE TWO. The x87 control word is process state, and the two hosts
// that run this generator do not carry the same one. The editor's generator
// runs at `0x027F` — double precision, round to nearest, the compiler's
// default — from the seed hook through all twelve phase boundaries; that is
// read out of the running editor at every boundary and it never moves
// (`native/rmg/oracle.c`). The GAME's maps say otherwise: every float they
// carry is the value the data holds with its last digit cut off rather than
// rounded, which is round-toward-zero, and a process with a Direct3D device
// usually carries `0x0C7F` — single precision (24-bit) and toward zero.
//
// So a map made in the editor and a map made in the game are made by two
// different machines, and the same order gives two different maps: the game
// spends 78,322 draws in `FillZones` where the port (and the editor) spend
// 78,287. Neither is a bug. The port has to be able to be either.
//
// WHAT THIS IS NOT. It is not a conversion. `DOUBLES` is the arithmetic 136
// reference maps were checked against and it stays the default; every site
// that takes an `Arith` computes exactly what it computed before when handed
// that one. `X87` is the second machine, and it is worth nothing until a map
// the GAME made comes out of it.
//
// The single-precision operations themselves are `src/exe/x87.ts`, which the
// minimap has spoken since the Lanczos filter was measured — the editor's
// MINIMAP is at `0x0C7F` even though its generator is not. This module only
// chooses.

import { add24, div24, mul24, sub24, tr24 } from '../exe/x87.ts';

/** Which machine a run computes on. */
export type ArithName = 'double' | 'x87' | 'sse';

/**
 * One arithmetic.
 *
 * The operations are the ones an x87 instruction does in one go, so that a
 * ported expression can be written the way the disassembly reads it: an
 * `fmul` is `mul`, and its result is what the next instruction receives. In
 * `DOUBLES` every one of them is the plain JavaScript operator, so a site that
 * routes through here is unchanged until the run asks for the other machine.
 */
export interface Arith {
  readonly name: ArithName;
  mul(a: number, b: number): number;
  div(a: number, b: number): number;
  add(a: number, b: number): number;
  sub(a: number, b: number): number;
  sqrt(a: number): number;
  /**
   * What a value becomes when it is STORED — assigned to a `float` variable,
   * pushed as a `float` argument, written to a `float` field.
   *
   * This is where the two machines differ even when no arithmetic happened.
   * At `0x027F` the register holds 53 bits and the store rounds them to the
   * NEAREST float, which is `Math.fround` and is what every `fl(...)` in this
   * generator already means. At `0x0C7F` the register held 24 bits to begin
   * with and the store rounds TOWARD ZERO, so an expression that has been
   * through the operations below is already there.
   */
  store(a: number): number;
}

/** The compiler's default, and what the editor's generator runs on. */
export const DOUBLES: Arith = {
  name: 'double',
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  sqrt: (a) => Math.sqrt(a),
  store: (a) => Math.fround(a),
};

/**
 * `fsqrt` at single precision, toward zero.
 *
 * `Math.sqrt` is correctly rounded as a double, and truncating that to 24 bits
 * is the right answer except when the exact root sits just below a 24-bit
 * boundary and the double rounded up to it. The test for that is exact in
 * doubles for the values this generator deals in: if the truncated root
 * squared is already greater than the argument, the root before it is the one
 * x87 would have landed on.
 */
function sqrt24(a: number): number {
  if (!(a > 0) || !Number.isFinite(a)) return Math.sqrt(a);
  const r = tr24(Math.sqrt(a));
  return mul24(r, r) > a ? tr24(r - Math.abs(r) * 2 ** -24) : r;
}

/** Single precision, toward zero — the machine the game's maps were made on. */
export const X87: Arith = {
  name: 'x87',
  mul: mul24,
  div: div24,
  add: add24,
  sub: sub24,
  sqrt: sqrt24,
  store: tr24,
};

/**
 * The GAME's build, which is a different compiler and not a different mode.
 *
 * `FillZones` in `H5_Game_H5E.exe` holds 74 floating-point instructions and
 * every one of them is SSE — `divss`, `mulss`, `comiss`, and a `sqrtsd` whose
 * answer is handed straight back through `cvtsd2ss`. The one `fstp` in the
 * whole function only unloads a value the callee had already rounded to
 * single. PC and RC do not reach SSE, so the control word this process carries
 * cannot move anything here: what moves things is that EVERY intermediate
 * lands on a float32, where the editor's x87 keeps its stack.
 *
 * So the truncated decimals in a map the game wrote and the extra draws its
 * generator spends are two different findings. The first is the control word,
 * reaching the printf that still runs on x87. The second is this.
 */
/**
 * AND IT ROUNDS TOWARD ZERO. The paragraph above was written with "PC and RC
 * do not reach SSE" in mind, which is true of the x87 control word and beside
 * the point: the CRT's `_controlfp(_RC_CHOP, _MCW_RC)` sets the x87 word AND
 * MXCSR together, and the game's process carries `0x0C7F` on the x87 side —
 * so its SSE side chops too. The road cost field, read out of the live game
 * (`tools/rmg-diff-field.ts`), says so in the first cell: the engine holds
 * `1.94` as `0x3ff851eb`, the float BELOW, where `0.94f + 1.0f` is an exact
 * tie that nearest-even would have rounded UP to `0x3ff851ec`; every other
 * differing cell sits below the nearest-rounded value as well, by one ulp
 * where one operation happened and by eleven where a hundred did.
 *
 * Single precision with every operation rounded toward zero is exactly what
 * the x87 machine below computes, `sqrt` included: `sqrtsd` under the same
 * MXCSR truncates in double and `cvtsd2ss` truncates again, and truncation
 * composes. So the GAME's machine is the 24-bit one, and what distinguishes
 * it from a `0x0C7F` x87 is only where values get rounded — after every
 * operation here, where an x87 could carry a wider exponent — which is
 * nothing this generator's magnitudes reach.
 */
export const SSE: Arith = {
  name: 'sse',
  mul: mul24,
  div: div24,
  add: add24,
  sub: sub24,
  sqrt: sqrt24,
  store: tr24,
};

/** By name, for an option that arrives as a string. */
export function arithFor(name: ArithName | undefined): Arith {
  return name === 'x87' ? X87 : name === 'sse' ? SSE : DOUBLES;
}

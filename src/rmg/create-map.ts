// `CreateMap` — the first phase: whether there is an underground, how big the
// map is, and how many players it has. In that order, which took two readings
// to get right.
//
// Read from 0xeab537..0xeab616 in the unwrapped game executable; the field
// offsets were finally pinned by walking the SRMGTemplate XML reader
// (0xB9BC90): MinPlayers +0x78, MaxPlayers +0x7C, MinMapSize +0x80,
// MaxMapSize +0x84. The first draft of this file had the pairs INVERTED and
// the draws in the wrong order — invisible on runs 3–5 because both
// parameters were supplied and all three draws were discarded next()s, which
// is exactly why the docs said "confirm before trusting a drawn value".
//
// THE PART THAT MATTERS FOR EVERY LATER PHASE: three draws, always:
//
//     underground requested-random ? below(2) : next()   the FIRST draw
//     size    unset ? Min + below(span), halved for
//                     two floors                : next()  the SECOND
//     players unset ? Min + below(span)         : next()  the THIRD
//
// A supplied parameter is not a draw skipped — the engine draws anyway and
// discards the number. And the "fourth draw at 0xeab5a2" the first reading
// left unported is not a fourth at all: the coin REPLACES the first next()
// when the operator asked for a random underground, which is why every
// reference run spends exactly three.
//
// The clamp is on the PLAYERS, copied as written rather than as expected:
//
//     if (players > MaxPlayers || players < MinPlayers) players = MinPlayers
//
// A count above the maximum falls back to the MINIMUM. The engine's bug, so
// the port keeps it, with a test naming it deliberate.
//
// BOTH NAMED HOLES ARE CLOSED, and neither was arithmetic. `vt+0x14` and
// `vt+0x18` are the generator's own slots, `0xEADE20` and `0xEADE90`, and they
// are two hardcoded tables — see `SIZE_UNITS` and `unitsToSize` below. With
// them the size fit at `0xEAB616` reads out whole, and so does the
// forced-underground branch behind it.
//
// What is pinned: the size that reaches the map is an index into the table at
// 0xff291c — 72, 96, 136, 176, 216, 256, 320 tiles — and the reference map is
// 96×96, index 1.

import type { RmgRandom } from './random.ts';

/**
 * The engine's size table at `0xff291c` — tile counts in the enum's order, and
 * the INDEX is what the request carries and what the water depth is chosen by.
 */
export const MAP_SIZES = [72, 96, 136, 176, 216, 256, 320] as const;

/**
 * `0xEADE20` — a size index in the template's own units. NOT a formula: a
 * seven-way jump table, read case by case and with the table's own dwords
 * checked so the order is the file's rather than the listing's.
 *
 * The numbers are the tile count squared over a thousand, rounded — 96x96 is
 * 9.2 and the table says 10 — but the engine holds the rounded constants, so
 * the port holds them too and there is no divisor to argue about.
 */
export const SIZE_UNITS = [5, 10, 18, 31, 47, 66, 102] as const;

/** `0xEADE90` — the other way, and it is a ladder of five compares. */
export function unitsToSize(units: number): number {
  if (units < 8) return 0;
  if (units < 15) return 1;
  if (units < 25) return 2;
  if (units < 40) return 3;
  if (units < 60) return 4;
  return units < 90 ? 5 : 6;
}
import type { RmgTemplate } from './template.ts';

export interface MapRequest {
  /** How many players, or undefined to let the template decide. */
  players?: number;
  /** Map size, or undefined to let the template decide. */
  size?: number;
  /** The operator asked for the underground to be a coin flip (gen+0x1C). */
  randomUnderground?: boolean;
  /** The underground, stated outright — read only when the coin is not asked for. */
  underground?: boolean;
}

export interface CreatedMap {
  players: number;
  size: number;
  /** gen+0x1D — one floor or two. The floor count IS this bit plus one. */
  twoFloors: boolean;
}

export function createMap(template: RmgTemplate, request: MapRequest, rng: RmgRandom): CreatedMap {
  // Draw one: the underground. The coin only spins when the operator asked
  // for a random one; otherwise the number is drawn and dropped like every
  // other supplied parameter.
  let twoFloors: boolean;
  if (request.randomUnderground) {
    twoFloors = rng.below(2) !== 0;
  } else {
    rng.next();
    twoFloors = request.underground ?? false;
  }

  // Draw two: the size. Drawn in the template's own UNITS, halved when two
  // floors share the map, and turned into an index by `unitsToSize` — the
  // conversion is `0xEADE90` and it is read now, so the drawn path no longer
  // hands the units on as if they were an index.
  let size: number;
  if (request.size === undefined) {
    const units = template.minMapSize + rng.below(template.maxMapSize - template.minMapSize + 1);
    size = unitsToSize(twoFloors ? Math.trunc(units / 2) : units);
  } else {
    rng.next();
    size = request.size;
  }

  // Draw three: the players — and the engine's misclamp lands here, not on
  // the size as the first reading had it.
  let players: number;
  if (request.players === undefined) {
    players = template.minPlayers + rng.below(template.maxPlayers - template.minPlayers + 1);
  } else {
    rng.next();
    players = request.players;
  }
  if (players > template.maxPlayers || players < template.minPlayers) players = template.minPlayers;

  // THE SIZE FIT, `0xEAB616`, and it runs on whatever the size ended up being
  // — supplied or drawn, after the players, not before. The map has to carry
  // the template's own MinMapSize in units, and TWO FLOORS COUNT TWICE:
  //
  //     if (units(size) * floors < MinMapSize) size = unitsToSize(MinMapSize)
  //
  // Measured against the engine on nine orders: `-size 0` on a template whose
  // Min is 60 comes back HUGE, and `-size 3` on the SAME template with an
  // underground comes back LARGE and stays there — 31 units over two floors is
  // 62, which clears 60. There is no upper bound here: `-size 6` on a template
  // whose Max is 14 gives 320x320 and the engine does not complain. The
  // DIALOG is where the upper bound lives — it filters the template list by
  // `Min <= units * floors <= Max`, which is why ticking the underground
  // swaps small templates for large ones rather than the other way round.
  const total = SIZE_UNITS[size] === undefined ? 0 : SIZE_UNITS[size]! * (twoFloors ? 2 : 1);
  if (total < template.minMapSize) {
    const straight = unitsToSize(template.minMapSize);
    if (straight <= 5) {
      size = straight;
    } else {
      // A template that wants more than the biggest map there is gets an
      // underground FORCED and half its units, capped at EXTRALARGE. No
      // shipped template reaches this — the largest MinMapSize is 70 — so it
      // is ported from the instructions and untested by any map here.
      const half = unitsToSize(Math.trunc(template.minMapSize / 2));
      size = half >= 4 ? 4 : half;
      twoFloors = true;
    }
  }

  return { players, size, twoFloors };
}

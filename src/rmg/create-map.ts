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
// Named holes, still open:
//   - the units-to-size-index conversions (the generator's vt+0x14/vt+0x18)
//     are unread, so what the template's 5..14 range measures stays open; a
//     DRAWN size is returned in those units, halved (integer, op unverified)
//     when two floors share the map;
//   - the forced-underground fit checks (map too small for its players) are
//     unported — they need the same two virtuals.
//
// What is pinned: the size that reaches the map is an index into the table at
// 0xff291c — 72, 96, 136, 176, 216, 256, 320 tiles — and the reference map is
// 96×96, index 1.

import type { RmgRandom } from './random.ts';
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

  // Draw two: the size. Drawn in the template's own units, and with two
  // floors sharing the map the units are halved before the engine converts
  // them to a size index (the conversion itself is the unread vt+0x18).
  let size: number;
  if (request.size === undefined) {
    size = template.minMapSize + rng.below(template.maxMapSize - template.minMapSize + 1);
    if (twoFloors) size = Math.trunc(size / 2);
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

  return { players, size, twoFloors };
}

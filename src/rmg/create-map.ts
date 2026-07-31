// `CreateMap` — the first phase, and the one that settles how many players the
// map has and how big it is.
//
// Read from 0xeab537..0xeab616 in the unwrapped game executable.
//
// THE PART THAT MATTERS FOR EVERY LATER PHASE: it draws three times, and
// throws most of them away. A parameter the operator supplied is not a draw
// skipped — the engine draws anyway and discards the number:
//
//     next()                                        always, discarded
//     players unset ? Min + below(span) : next()     the else DRAWS
//     size    unset ? Min + below(span) : next()     likewise
//
// Get that wrong — draw only when a value is needed — and the counter is short
// by one or two before anything interesting has happened, so every phase after
// it reads different numbers and the map is different for a reason that has
// nothing to do with the code being wrong. Which is why this phase is worth its
// own file despite deciding two integers.
//
// The clamp afterwards is copied as written, not as expected:
//
//     if (size > MaxMapSize || size < MinMapSize) size = MinMapSize
//
// A size ABOVE the maximum falls back to the minimum, not to the maximum. That
// reads like a bug, and it is the engine's bug, so the port keeps it.

import type { RmgRandom } from './random.ts';
import type { RmgTemplate } from './template.ts';

export interface MapRequest {
  /** How many players, or undefined to let the template decide. */
  players?: number;
  /** Map size, or undefined to let the template decide. */
  size?: number;
}

export interface CreatedMap {
  players: number;
  size: number;
}

export function createMap(template: RmgTemplate, request: MapRequest, rng: RmgRandom): CreatedMap {
  // The unconditional one. Nothing reads its result — in this build the value
  // is dropped the instruction after it arrives. Kept because the state has to
  // move, not because the number is used.
  rng.next();

  let players: number;
  if (request.players === undefined) {
    players = template.minPlayers + rng.below(template.maxPlayers - template.minPlayers + 1);
  } else {
    rng.next();
    players = request.players;
  }

  let size: number;
  if (request.size === undefined) {
    size = template.minMapSize + rng.below(template.maxMapSize - template.minMapSize + 1);
  } else {
    rng.next();
    size = request.size;
  }

  if (size > template.maxMapSize || size < template.minMapSize) size = template.minMapSize;

  return { players, size };
}

// NOT PORTED, and said out loud rather than left as a silence: there is a
// fourth draw at 0xeab5a2 — `below(2)`, a coin flip stored in a flag — reached
// only when a byte of the parameter block is already set when the phase starts.
// Nothing in the three reference runs took that path (all three spent exactly
// three draws), so what sets that byte is unknown, and guessing would put an
// invented condition in the one place the counter is currently trustworthy.
// A run that spends four draws here is the thing to look for.

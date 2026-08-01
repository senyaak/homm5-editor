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
// UNVERIFIED, and load-bearing only on the paths no reference run has taken:
// which template fields the ranges come from. The code reads `[edi+0x78]`,
// `[edi+0x7c]`, `[edi+0x80]` and `[edi+0x84]`, and this port calls them
// MinMapSize/MaxMapSize/MinPlayers/MaxPlayers — inferred from the order the
// fields appear in the XML, not from the structure layout, which has not been
// recovered yet. Two things say the guess is at least self-consistent: the
// `MaxPlayers == 1` test at 0xeab537 behaves for a two-player template, and the
// values are only read when the operator supplied nothing, which none of runs
// 3-5 did. Confirm before trusting a drawn player count or size.
//
// A related thing IS pinned down: the size that reaches the map is an index
// into a table at 0xff291c — 72, 96, 136, 176, 216, 256, 320 tiles — and the
// reference map is 96×96, index 1. The template's own 5..14 range therefore is
// NOT an index into that table, and what it is remains open.
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
